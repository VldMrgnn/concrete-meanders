import { openDB } from "idb";
import { type AnyState, Err, Ok, type PersistAdapter, call } from "starfx";

import { PERSIST_DATABASE_VERSION } from "../state/constants";

export const openDbfn = (pName: string) => {
  return openDB(pName, PERSIST_DATABASE_VERSION, {
    upgrade(db, oldVersion, newVersion) {
      console.log(`Upgrading from version ${oldVersion} to ${newVersion}`);
      if (oldVersion < PERSIST_DATABASE_VERSION) {
        if (!db.objectStoreNames.contains("persist")) {
          db.createObjectStore("persist");
        }
      }
    },
  });
};

export function createSimpleIDBAdapter<S extends AnyState>(pName: string): PersistAdapter<S> {
  const idbStorage = openDbfn(pName);
  return {
    getItem: function* get(key: string) {
      const storage = yield* call((yield* call(idbStorage)).get("persist", key));
      return Ok(JSON.parse(storage || "{}"));
    },
    setItem: function* get(key: string, s: Partial<S>) {
      const state = JSON.stringify(s);
      try {
        yield* call((yield* call(idbStorage)).put("persist", state, key));
      } catch (err: any) {
        return Err(err);
      }
      return Ok(undefined);
    },
    removeItem: function* get(key: string) {
      yield* call((yield* call(idbStorage)).delete("persist", key));
      return Ok(undefined);
    },
  };
}

export function createIDBSimpleAdapter<S extends AnyState>(dbName: string): PersistAdapter<S> {
  return {
    getItem: function* (key: string) {
      const idbStorage = yield* call(
        openDB(dbName, PERSIST_DATABASE_VERSION, {
          upgrade(db) {
            if (!db.objectStoreNames.contains("raw")) {
              db.createObjectStore("raw");
            }
          },
        })
      );
      const storage = yield* call(idbStorage.get("raw", key));
      return Ok(storage || {});
    },
    setItem: function* (key: string, state: Partial<S>) {
      const idbStorage = yield* call(
        openDB(dbName, PERSIST_DATABASE_VERSION, {
          upgrade(db) {
            if (!db.objectStoreNames.contains("raw")) {
              db.createObjectStore("raw");
            }
          },
        })
      );
      try {
        yield* call(idbStorage.put("raw", state, key));
        return Ok(undefined);
      } catch (err) {
        return Err(err instanceof Error ? err : new Error(String(err)));
      }
    },
    removeItem: function* (key: string) {
      const idbStorage = yield* call(
        openDB(dbName, PERSIST_DATABASE_VERSION, {
          upgrade(db) {
            if (!db.objectStoreNames.contains("raw")) {
              db.createObjectStore("raw");
            }
          },
        })
      );
      yield* call(idbStorage.delete("raw", key));
      return Ok(undefined);
    },
  };
}
