import { openDB } from 'idb';
import { AnyState, call, Err, Ok, PersistAdapter } from 'starfx';

import { getBackPersitenceWorker } from '../workers/worker-factory';

const dev = import.meta.env.NODE_ENV === "development" || import.meta.env.NODE_ENV === "test";
const PERSIST_DATABASE_VERSION = 17;

global.TextDecoder = TextDecoder;
global.TextEncoder = TextEncoder;

let tenantKey: string | null = null;
let hydrated = false;

export function setTenantKey(key: string) {
  if (tenantKey !== key) {
    dev && console.log("[dev.] Tenant key changed", key);
  }
  tenantKey = key;
}

export function getTenantKey() {
  return tenantKey;
}
export function setFxStoreHydrated(value: boolean) {
  hydrated = value;
  dev && console.log("[dev.] setHydrated", value);
}

export function getFxHydrated() {
  return hydrated;
}

export function createTenantPersistor<AppState extends AnyState>(
  idbName: string,
  tenantKey: string,
) {
  setFxStoreHydrated(false);
  setTenantKey(tenantKey);
  return createIDBRawStorageAdapter<AppState>(idbName);
}

export function withTenant(key: string) {
  return key + (tenantKey ? `:${tenantKey}` : "");
}

export const openDbfn = (pName: string) => {
  const _ = getTenantKey();
  const dbName = withTenant(pName);

  // the pName when comming from worker contains the suffix also.
  // that is because tenantKey is not set in that context.
  const strCount = (dbName.match(/:/g) || []).length;
  if (strCount > 1) {
    throw new Error("Invalid tenant key");
  }

  return openDB(withTenant(pName), PERSIST_DATABASE_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
      console.log(`Upgrading from version ${oldVersion} to ${newVersion}`);
      // If this is the first time setting up the database for this tenant
      if (oldVersion < PERSIST_DATABASE_VERSION) {
        if (!db.objectStoreNames.contains("raw")) {
          db.createObjectStore("raw");
        }
        if (!db.objectStoreNames.contains("blockMeta")) {
          db.createObjectStore("blockMeta");
        }
      }
      const versionStore = transaction.objectStore("raw");
      versionStore.put(PERSIST_DATABASE_VERSION, "schemaVersion");
    },
  });
};

export function createIDBRawStorageAdapter<S extends AnyState>(pName: string): PersistAdapter<S> {
  return {
    getItem: function* (key: string) {
      const idbStorage = openDbfn(pName);
      const storage = yield* call((yield* call(idbStorage)).get("raw", key));
      return Ok(storage || {});
    },
    setItem: function* (key: string, state: Partial<S>) {
      if (!hydrated) {
        dev && console.log("[dev.] Persistor not hydrated yet");
        return Ok(undefined);
      }
      const idbStorage = openDbfn(pName);
      try {
        yield* call((yield* call(idbStorage)).put("raw", state, key));
      } catch (err: any) {
        return Err(err);
      }
      const persistorWorker = getBackPersitenceWorker();
      if (persistorWorker) {
        persistorWorker.postMessage(Ok({ type: "/persist" }));
      }

      return Ok(undefined);
    },
    removeItem: function* (key: string) {
      const idbStorage = openDbfn(pName);
      yield* call((yield* call(idbStorage)).delete("raw", key));
      return Ok(undefined);
    },
  };
}

export const openDBForPeek = (fullName: string) => {
  const strCount = (fullName.match(/:/g) || []).length;
  if (strCount !== 1) {
    throw new Error("Invalid tenant key");
  }
  // Open or upgrade the IndexedDB database
  return openDB(fullName, PERSIST_DATABASE_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
      console.log(`Upgrading from version ${oldVersion} to ${newVersion}`);

      // List of required object stores
      const requiredStores = ["blockMeta", "raw"];
      // Create missing stores
      for (const storeName of requiredStores) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      }
      // Store schema version in the 'raw' store
      const versionStore = transaction.objectStore("raw");
      versionStore.put(PERSIST_DATABASE_VERSION, "schemaVersion");
    },
  });
};
