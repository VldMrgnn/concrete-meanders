import { each, ensure, main, on, Operation, race, resource, sleep, type } from 'effection';
import IdemWeakMapIterable from 'idem-weak-iterable';
import { create } from 'jsondiffpatch';
import {
    call, createThunks, Err, keepAlive, mdw, Ok, parallel, put, request, run, spawn, take,
    takeEvery, takeLeading
} from 'starfx';

import { openDbfn, setTenantKey } from '../adapters/idb-tenants';
import { debounceEndpoints } from '../state/helpers';
import { isErr } from '../utils/basic';
import { withResolvers } from '../utils/with-resolvers';

import type { IDBPDatabase } from "idb";
import type { Result, ThunkCtx } from "starfx";
import type { AppState } from "../state/store";

type TPersistIDBName = {
  idb: string;
};
let persistorPaused = false;
let persistorPausedResolver = withResolvers<void>();
let storeName: string | undefined = undefined;
const storeNameResolver = withResolvers<string>();
let persistDB: IDBPDatabase<unknown> | undefined = undefined;
const persistDBResolvers = withResolvers<IDBPDatabase<unknown>>();

const timerMs = import.meta.env.NODE_ENV === "test" ? 100 : 1000;
const executionMap = IdemWeakMapIterable<AbortSignal, boolean>();

const base =
  import.meta.env.NODE_ENV === "development" ? import.meta.env.VITE_SERVICE : import.meta.env.VITE_SERVICE_PROD;
// const wsBase = base.replace("http", "ws");

const thunks = createThunks<ThunkCtx>();
thunks.use(mdw.err);
thunks.use(debounceEndpoints(timerMs, ["/pw/persist"]));
thunks.use(thunks.routes());

const parseMessageEvent = (event: MessageEvent) => {
  const { data } = event;
  if (isErr(data)) {
    return { error: data };
  }
  return data.value;
};

const setPersistStore = async (db: IDBPDatabase<unknown>) => {
  persistDB = db;
  persistDBResolvers.resolve(db);
};

const getPersistStore = async (): Promise<IDBPDatabase<unknown> | undefined> => {
  try {
    if (persistDB) return persistDB;
    if (!storeName) {
      console.warn("storeName not set. exiting for now");
      return undefined;
    }
    const [storeBaseName, tenantKeyInWorker] = storeName.split(":").map((x) => x?.trim());
    setTenantKey(tenantKeyInWorker);
    persistDB = await openDbfn(storeBaseName);
    setPersistStore(persistDB);
    return persistDB;
  } catch (error) {
    console.error("Failed to get persist store:", error);
    throw error;
  }
};

function* waitForIDBDataStore() {
  if (persistDB) return;
  const db = yield* call(() => persistDBResolvers.operation); // Suspend until db is set
  return db;
}

const closePersistStore = async () => {
  if (!persistDB) {
    return;
  }
  await persistDB.close();
  persistDB = undefined;
  storeName = undefined;
};

function* getIDBPersistedState() {
  yield* waitStoreName();
  yield* waitForIDBDataStore();
  const db = yield* call(() => getPersistStore());

  if (!db) {
    console.error("store not found [3]");
    return;
  }

  const prevBlockMeta = yield* call(() => db.getAll("blockMeta", "timestamp"));

  const timestamp = new Date().getTime();
  const blockMeta = {
    timestamp,
    tenant: storeName,
  };

  db.put("blockMeta", blockMeta.timestamp, "timestamp");
  db.put("blockMeta", blockMeta.tenant, "tenant");

  const [data] = yield* call(() => db.getAll("raw", "starfx"));
  if (!data) {
    return null;
  }
  Object.assign(data, { blockMeta });
  return {
    data,
    prevTimestamp: prevBlockMeta[0],
  };
}

function setStoreName(name: string) {
  if (storeName === name) return;
  storeName = name;
  storeNameResolver.resolve(name);
}
function* waitStoreName() {
  if (storeName) return; // no wait
  yield* storeNameResolver.operation; // wait
}

function* waitForUnlock() {
  if (!persistorPaused) return; // no wait
  yield* persistorPausedResolver.operation;
}

const setPersitorPaused = (value: boolean) => {
  persistorPaused = value;
  if (!value) {
    // Resolve and reinitialize the resolver for future usage
    persistorPausedResolver.resolve();
    persistorPausedResolver = withResolvers<void>();
  }
};

function* waitForExecSettle() {
  while (executionMap.keys().length) {
    yield* sleep(32);
  }
}

const startup = thunks.create<TPersistIDBName>(
  "/pw/startup",
  { supervisor: takeLeading },
  function* (ctx, next) {
    const { idb } = ctx.payload;
    setStoreName(idb);
    const db = yield* call(() => getPersistStore());
    if (!db) {
      console.error("Error opening DB for tenant");
      return;
    }
    yield* next();
  },
);

type TShutdownInput = {
  force?: boolean;
};
const shutdown = thunks.create<TShutdownInput>(
  "/pw/shutdown",
  { supervisor: takeLeading },
  function* (ctx, next) {
    const { force } = ctx.payload;
    if (force) {
      yield* call(() => abortAll.run());
    } else {
      yield* race([waitForExecSettle(), sleep(3000)]);
      yield* call(() => abortAll.run());
    }
    yield* call(() => closePersistStore());
    self.postMessage({ type: "shutdown", payload: "ok" });
    yield* next();
  },
);

type TCFetchOutput = {
  result: Result<any>;
};

function workersFetch({
  api,
  method = "GET",
  bailout = 5000,
  payload = {},
}: {
  api: string;
  method?: "GET" | "POST" | "PUT" | "PATCH";
  bailout?: number;
  payload?: unknown;
}): Operation<TCFetchOutput> {
  return resource(function* (provide) {
    let result: Result<unknown> | undefined = undefined;

    const externalAC = new AbortController();
    const signal = externalAC.signal;

    executionMap.set(signal, true);

    signal.onabort = () => {
      result = Err(new Error("aborted"));
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
          body: method !== "GET" ? JSON.stringify(payload) : undefined,
        });
        const data = res.ok ? yield* call(res.json()) : yield* call(res.text());
        result = res.ok ? Ok(data) : Err(data);
      } catch (error) {
        result = Err(error instanceof Error ? error : new Error(String(error)));
      }
    });

    const waitForResult = function* () {
      while (!result) {
        yield* sleep(32);
      }
    };
    yield* race([sleep(bailout), waitForResult()]);
    yield* provide({ result: result ?? Err(new Error("No result")) });
  });
}

const fetchTestData = thunks.create(
  "/pw/fetchTestData",
  { supervisor: takeLeading },
  function* (ctx, next) {
    const { result } = yield* call(
      workersFetch({
        api: `/s1/${storeName}`,
      }),
    );
    console.log("customfetch, result", result);
    yield* next();
  },
);

const abortAll = thunks.create("/pw/abortAll", { supervisor: takeEvery }, function* (ctx, next) {
  for (const signal of executionMap.keys()) {
    signal.dispatchEvent(new Event("abort"));
  }
  yield* next();
});

let prevJson: Partial<AppState> = {};
function* sendJson() {
  const persisedResult = yield* call(() => getIDBPersistedState());
  if (!persisedResult) {
    console.error("no data to persist");
    return;
  }
  const { data, prevTimestamp } = persisedResult;

  if (!data) {
    console.error("no data to persist");
    return;
  }

  if (!prevTimestamp) {
    const { result } = yield* call(
      workersFetch({
        api: `/persitor/v2/full/${storeName}`,
        method: "POST",
        payload: data,
      }),
    );
    prevJson = data as Partial<AppState>;
    console.log("full upload result", result);
    return Ok(undefined);
  }

  const jsondiffpatch = create();
  const delta = jsondiffpatch.diff(prevJson, data);
  prevJson = data as Partial<AppState>;
  if (delta && Object.keys(delta).length === 1 && "blockMeta" in delta) {
    // console.log("Only timestamp changed, skipping persist");
    return;
  }
  // const { result } =
  yield* call(
    workersFetch({
      api: `/persitor/v2/delta/${storeName}`,
      method: "POST",
      payload: delta,
    }),
  );

  // console.log("delta upload", result);
  return Ok(undefined);
}

const postDeltas = thunks.create("/pw/persist", { supervisor: takeLeading }, function* (ctx, next) {
  yield* waitForUnlock();

  if (ctx.key === "debounce") {
    yield* next();
    return;
  }
  yield* call(() => sendJson());
  yield* next();
});

function* taskManager() {
  const dispatcher = function* () {
    while (true) {
      const action = yield* take("*");
      const { type: actionType, payload } = action as {
        type: string;
        payload: unknown;
      };
      switch (actionType) {
        case "/startup":
          yield* spawn(() => startup.run(payload as TPersistIDBName));
          break;
        case "/shutdown":
          yield* spawn(() => shutdown.run({}));
          break;
        case "/abortWork":
          yield* spawn(() => abortAll.run());
          break;
        case "/persist":
          yield* spawn(() => postDeltas.run());
          break;
        case "/pause":
          setPersitorPaused(true);
          break;
        case "/resume":
          setPersitorPaused(false);
          break;
        // test and dev:
        case "/ping":
          console.log("ping");
          self.postMessage({ type: "/pong", payload: "ok" });
          break;
        case "/fetchTestData":
          yield* spawn(() => fetchTestData.run());
          break;
        case "/startup:test":
          yield* sleep(700);
          self.postMessage({ type: "/startup", payload: "started" });
          break;
        case "/shutdown:test":
          yield* sleep(700);
          self.postMessage({ type: "shutdown", payload: "ok" });
          break;
        default:
          console.log("actionType", actionType);
          break;
      }
    }
  };
  yield* spawn(() =>
    run(function* () {
      const group = yield* parallel([thunks.bootup, dispatcher]);
      yield* group;
    }),
  );
  for (const event of yield* each(on(self, "message"))) {
    const actionResult = parseMessageEvent(event);
    if (actionResult.error) {
      console.error(actionResult.error);
      continue;
    }
    yield* put(actionResult);
    yield* each.next();
  }
}
keepAlive([main(taskManager)]);
