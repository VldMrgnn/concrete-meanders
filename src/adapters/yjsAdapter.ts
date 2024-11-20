import sum from "hash-sum";
import { createTransform } from "starfx";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

import type { AppState } from "../types";

const base =
  import.meta.env.DEV ? import.meta.env.VITE_SERVICE : import.meta.env.VITE_SERVICE_PROD;
const wsBase = (base||'').replace("http", "ws");

const yDoc = new Y.Doc();
const yState = yDoc.getMap("state");

const provider = new WebsocketProvider(`${wsBase}/yadapter`, "starfx-room", yDoc);
provider.connect();
const watchedKeys: (keyof AppState)[] = ["test"];

export const transform = createTransform<AppState>();

transform.in = (state: Partial<AppState>) => {
  const origin = "starfx-local-update";
  yDoc.transact((transaction) => {
    for (const watchKey of watchedKeys) {
      const existingValue = yState.get(watchKey) as AppState[keyof AppState];
      // any fast comparer ....
      if (sum(existingValue) !== sum(state[watchKey])) {
        yState.set(watchKey, state[watchKey]);
      } else {
        console.log("filtered-out");
      }
    }
  }, origin);
  return state;
};

// Listen for Y.js updates
yState.observe((event, transaction) => {
  const origin = transaction.origin;
  const changes: Partial<AppState> = {};
  event.keysChanged.forEach((key) => {
    if (watchedKeys.includes(key as keyof AppState)) {
      (changes as any)[key] = yState.get(key) as AppState[keyof AppState];
    }
  });
  if (Object.keys(changes).length > 0) {
    if (origin === "starfx-local-update") {
      // console.log("Update originated from Starfx transform.in");
      void 0;
    } else {
      // console.log("Update originated externally");
      window.fx.dispatch({ type: "YJS_UPDATE", payload: changes });
    }
  }
});

// Sync provider status
provider.on("status", (event: any) => {
  console.log("WebSocket Provider status:", event.status); // Connected or Disconnected
});
