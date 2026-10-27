/// <reference lib="webworker" />
import { simulateOffline, type OfflineProgress, type OfflineSummary, type OfflineWindow } from "../game/offline";
import type { GameState } from "../game/state";

export interface OfflineRequest {
  state: GameState;
  window: OfflineWindow;
}

export type OfflineResponse =
  | ({ type: "progress" } & OfflineProgress)
  | { type: "done"; state: GameState; summary: OfflineSummary }
  | { type: "error"; message: string };

/** Minimum real time between progress reports (plan §11.3). */
const PROGRESS_INTERVAL_MS = 100;

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** Yields to the event loop with a macrotask so the worker stays responsive between chunks. */
function macrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

scope.addEventListener("message", async (event: MessageEvent<OfflineRequest>) => {
  const { state, window } = event.data;
  try {
    const run = simulateOffline(state, window);
    let lastReport = performance.now();
    for (;;) {
      const step = run.next();
      if (step.done === true) {
        scope.postMessage({ type: "done", state, summary: step.value } satisfies OfflineResponse);
        return;
      }
      const now = performance.now();
      if (now - lastReport >= PROGRESS_INTERVAL_MS) {
        lastReport = now;
        scope.postMessage({ type: "progress", ...step.value } satisfies OfflineResponse);
      }
      await macrotask();
    }
  } catch (error) {
    scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) } satisfies OfflineResponse);
  }
});
