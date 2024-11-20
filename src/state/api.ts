import { createApi, createThunks, mdw } from "starfx";
import { schema } from "./schema";

import type { ApiCtx, Next } from "starfx";
import { createLog } from "./helpers";

import type { ThunkCtx } from "../types";
const log = createLog("fx");
function* debugMdw(ctx: ThunkCtx | ApiCtx, next: Next) {
  log(`${ctx.name}`, ctx);
  yield* next();
}

const service = import.meta.env.DEV
  ? import.meta.env.VITE_SERVICE
  : import.meta.env.VITE_SERVICE_PROD;
// http://localhost:9999/rest/api

export const thunks = createThunks<ThunkCtx>();
thunks.use(debugMdw);
thunks.use(mdw.err);
thunks.use(mdw.actions);
thunks.use(thunks.routes());

export const apis = createApi<ApiCtx>();
apis.use(debugMdw);
apis.use(mdw.err);
apis.use(mdw.api({ schema }));
apis.use(apis.routes());
apis.use(mdw.queryCtx);
apis.use(mdw.nameParser);
apis.use(mdw.fetch({ baseUrl: service }));
