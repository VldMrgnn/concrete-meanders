import { Err, Ok, each, main, on, resource, sleep } from "effection";
import IdemWeakMapIterable from "idem-weak-iterable";
import {
  type Result,
  call,
  createThunks,
  ensure,
  keepAlive,
  parallel,
  put,
  race,
  request,
  run,
  spawn,
  take,
  takeEvery,
  takeLeading,
} from "starfx";

import { openDBForPeek } from "../adapters/idb-tenants";
import { isErr, isOk } from "../utils/basic";

import type { Operation } from "starfx";
import type { AppState, ThunkCtx } from "../types";
// Constants
const base =
  process.env.NODE_ENV === "development" ? process.env.VITE_SERVICE : process.env.VITE_SERVICE_PROD;

// Execution tracking
const executionMap = IdemWeakMapIterable<AbortSignal, boolean>();

// Thunks setup
const thunks = createThunks<ThunkCtx>();
thunks.use(thunks.routes());

// Utility to parse messages
const parseMessageEvent = (event: MessageEvent) => {
  const { data } = event;
  if (isErr(data)) return { error: data };
  console.log("data", data);

  return data?.value;
};

// Abort all ongoing fetch operations
const abortAll = thunks.create("/pw/abortAll", { supervisor: takeEvery }, function* (_, next) {
  for (const signal of executionMap.keys()) {
    signal.dispatchEvent(new Event("abort"));
  }
  yield* next();
});

// Graceful shutdown operation
const shutdown = thunks.create<{ message: string; force?: boolean }>(
  "/pw/shutdown",
  { supervisor: takeEvery },
  function* (ctx, next) {
    const { message, force } = ctx.payload;
    if (force) {
      yield* call(() => abortAll.run());
    } else {
      yield* race([waitForExecSettle(), sleep(3000)]);
      yield* call(() => abortAll.run());
    }
    self.postMessage({
      type: "/terminate",
      payload: message,
    });
    yield* next();
  },
);

// Wait until all executions settles
function* waitForExecSettle() {
  while (executionMap.keys().length) {
    yield* sleep(32);
  }
}

// using https://developer.mozilla.org/en-US/docs/Web/API/Compression_Streams_API
function workersFetch({
  api,
  method = "GET",
  bailout = 5000,
}: {
  api: string;
  method?: "GET" | "POST";
  bailout?: number;
}): Operation<{ result: Result<unknown> }> {
  return resource(function* (provide) {
    let result: Result<any> | undefined;

    const externalAC = new AbortController();
    const signal = externalAC.signal;

    executionMap.set(signal, true);

    signal.onabort = () => {
      result = Err(new Error("Request aborted"));
    };

    yield* ensure(() => {
      executionMap.delete(signal);
    });

    yield* spawn(function* () {
      try {
        const res = yield* request(`${base}${api}`, {
          method,
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-forwarded-host": "jurnalgold.ro",
            "Accept-Encoding": "gzip",
          },
          signal,
        });

        if (!res.ok) {
          const errorData = yield* call(res.text);
          result = Err(new Error(errorData));
          return;
        }

        try {
          // Check for Content-Encoding header
          const encoding = res.headers.get("Content-Encoding");

          //list headers:
          console.log("headers", res.headers);
          //list encoding

          console.log("encoding", encoding);
          if (encoding !== "gzip") {
            // Fallback: Use plain response for non-GZIP responses
            const json = yield* call(() => res.json());
            result = Ok(json);
            return;
          }

          // Use Compression Streams API for GZIP decompression
          const decompressedStream = res.body
            ?.pipeThrough(new DecompressionStream("gzip"))
            .getReader();

          if (!decompressedStream) {
            result = Err(new Error("Decompression stream not supported"));
            return;
          }

          // Read decompressed content
          const decoder = new TextDecoder("utf-8");
          let jsonText = "";
          while (true) {
            const { done, value } = yield* call(() => decompressedStream.read());
            if (done) break;
            if (value) jsonText += decoder.decode(value, { stream: true });
          }
          jsonText += decoder.decode(); // Finalize decoding

          // Parse and store the result
          const parsedData = JSON.parse(jsonText);
          result = Ok(parsedData);
        } catch (error) {
          result = Err(error instanceof Error ? error : new Error(String(error)));
        }
      } catch (error) {
        result = Err(error instanceof Error ? error : new Error(String(error)));
      }
    });

    const waitForResult = function* () {
      while (!result) {
        yield* sleep(16);
      }
    };

    yield* race([sleep(bailout), waitForResult()]);
    yield* provide({ result: result ?? Err(new Error("No result")) });
  });
}

const getTheFile = thunks.create<string>(
  "/pw/getTheFile",
  { supervisor: takeLeading },
  function* (ctx, next) {
    const { payload } = ctx;

    const { result } = yield* workersFetch({
      api: `/persitor/v3/down/${payload}`,
      method: "POST",
      bailout: 5000,
    });

    if (isOk(result)) {
      const data = result.value as Partial<AppState> & {
        blockMeta: { timestamp: number; tenant: string };
      };
      const db = yield* call(() => openDBForPeek(payload));
      if (db) {
        if (data?.blockMeta?.timestamp && data?.blockMeta?.tenant) {
          db.put("blockMeta", data.blockMeta.timestamp, "timestamp");
          db.put("blockMeta", data.blockMeta.tenant, "tenant");
        }
        yield* call(() => db.put("raw", data, "starfx"));
      }
    }
    // anyway is nothing left to do here//
    yield* call(shutdown.run({ message: isOk(result) ? "ok" : "error", force: false }));
    yield* next();
  },
);

// Main worker logic
function* worker() {
  // Dispatcher to handle incoming actions
  const dispatcher = function* () {
    while (true) {
      const action = yield* take("*");
      const { type: actionType, payload } = action as {
        type: string;
        payload: unknown;
      };
      switch (actionType) {
        case "/start":
          yield* spawn(() => getTheFile.run(payload as string));
          break;
        case "/start:test":
          self.postMessage({ type: "test", payload: "ok" });
          break;
        default:
          console.log("Unknown action type:", actionType);
          break;
      }
    }
  };

  // Start dispatcher and handle incoming messages
  yield* spawn(() =>
    run(function* () {
      const group = yield* parallel([thunks.bootup, dispatcher]);
      yield* group;
    }),
  );

  for (const event of yield* each(on(self, "message"))) {
    const paramResult = parseMessageEvent(event);
    yield* put(paramResult);
    yield* each.next();
  }
}

keepAlive([main(worker)]);
