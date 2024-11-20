import type { FxStore } from "starfx";
import type { AppState } from "../state/store";
declare global {
  interface Window {
    fx: FxStore<AppState>;
  }
}
