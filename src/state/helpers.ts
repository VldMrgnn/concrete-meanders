import debug from "debug";
import { sleep } from "starfx";

import type { Next, Operation, ThunkCtx } from "starfx";
export function debounceEndpoints(timer: number = 1 * 1000, endpoints: string[]) {
  let timerIsRunning = false;
  function* startTimer(): Operation<void> {
    timerIsRunning = true;
    yield* sleep(timer);
    timerIsRunning = false;
  }
  return function* onIncoming(ctx: ThunkCtx, next: Next) {
    const actionName = (ctx?.name || "").split("[")?.shift()?.trim();
    if (!actionName) {
      yield* next();
      return;
    }
    if (timerIsRunning) {
      if (endpoints.includes(actionName)) {
        ctx.key = "debounce";
      }
    } else {
      if (endpoints.includes(actionName)) {
        timerIsRunning = true;
        ctx.key = "in";
        yield* startTimer();
      } else {
        ctx.key = "debounce";
      }
    }
    yield* next();
  };
}

export function shouldDownloadFile(
  idbTimestamp: number,
  backStoreTimestamp: number,
  deltaThresholdMs = 2000,
) {
  const timeDifference = backStoreTimestamp - idbTimestamp;
  // Check if the backend timestamp is significantly newer
  return timeDifference > deltaThresholdMs;
}

/**
 * If you want permanent logging statements then use this function to create a logger.
 *
 * const log = createLog('projects');
 * log('some logging statement');
 *
 * Then to see the log statements in the browser debugger, type this in the debugger:
 *  localStorage.debug = 'app:*';
 * // or localStorage.debug = 'app:projects'; to only see those log statements
 *
 * And then refresh the page.
 *
 * If you do not see logging statements, ensure your browser console is configureed to show "verbose" logs.
 */
export const createLog = (namespace: string) => {
  return debug(`app:${namespace}`);
};
