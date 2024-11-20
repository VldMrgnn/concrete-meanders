let persistenceWorkerInstance: Worker | null = null;
const hydrationWorkerInstance = new Map<string, Worker>();

export const startBackPersitenceWorker = () => {
  if (!persistenceWorkerInstance) {
    persistenceWorkerInstance = new Worker(new URL("./persistence.worker.ts", import.meta.url), {
      type: "module",
    });
  }
  return persistenceWorkerInstance;
};

export const terminateBackPersitenceWorker = () => {
  if (persistenceWorkerInstance) {
    persistenceWorkerInstance.terminate();
    persistenceWorkerInstance = null;
  }
};

export const getBackPersitenceWorker = () => {
  return persistenceWorkerInstance;
};

export const startBackHydrationWorker = (fileName: string) => {
  if (!fileName) {
    return;
  }
  if (!hydrationWorkerInstance.has(fileName)) {
    const worker = new Worker(new URL("./hydration.worker.ts", import.meta.url), {
      type: "module",
    });
    hydrationWorkerInstance.set(fileName, worker);
  }
  return hydrationWorkerInstance.get(fileName);
};
export const terminateBackHydrationWorker = (fileName: string) => {
  if (!fileName) {
    return;
  }
  const worker = hydrationWorkerInstance.get(fileName);
  if (worker) {
    worker.terminate();
    hydrationWorkerInstance.delete(fileName);
  }
};
export const getBackHydrationWorker = (fileName: string) => {
  if (!fileName) {
    return;
  }
  return hydrationWorkerInstance.get(fileName);
};

export const isBackHydrationWorkerStarted = (fileName: string) => {
  return hydrationWorkerInstance.has(fileName);
};

export const terminateAllBackHydrationWorkers = () => {
  hydrationWorkerInstance.forEach((worker) => {
    worker.terminate();
  });
  hydrationWorkerInstance.clear();
};
