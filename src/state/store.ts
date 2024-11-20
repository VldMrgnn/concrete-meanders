import { createPersistor, createStore, parallel, persistStoreMdw, take } from "starfx";

import { createSimpleIDBAdapter } from "../adapters/idb-simple";
import { transform } from "../adapters/yjsAdapter";
import { apis, thunks } from "./api";
import { CONST_STORE_BASE_NAME } from "./constants";
import { setupDevTool, subscribeToActions } from "./devtools";
import { initialState } from "./schema";

const devtoolsEnabled = true;
const lName = CONST_STORE_BASE_NAME;

export type AppState = typeof initialState;

const persistor = createPersistor<AppState>({
  adapter: createSimpleIDBAdapter<AppState>(`p.${lName}`),
  allowlist: ["test", "tableA"],
  transform,
});

const store = createStore({
  initialState: initialState,
  middleware: [persistStoreMdw(persistor)],
});

const tasks = [
  function* devtools() {
    if (!devtoolsEnabled) return;
    while (true) {
      const action = yield* take("*");
      subscribeToActions({ action });
    }
  },
  function* () {
    while (true) {
      const action = yield* take("YJS_UPDATE");
      yield* store.update((s: AppState) => {
        for (const [key, value] of Object.entries(action.payload as Record<string, any>)) {
          // @ts-ignore
          (s as any)[key] = value;
        }
      });
    }
  },
];

export const setupState = (pName = "store") => {
  devtoolsEnabled && setupDevTool(store, { name: pName, enabled: true });
  store.run(function* () {
    yield* persistor.rehydrate();
    const group = yield* parallel([thunks.bootup, apis.bootup, ...tasks]);
    yield* group;
  });
  window.fx = store;
  return {
    store,
  };
};

export const fxDispatch = store.dispatch;
