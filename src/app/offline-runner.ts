import type { OfflineProgress, OfflineSummary, OfflineWindow } from "../game/offline";
import type { GameState } from "../game/state";
import type { OfflineRequest, OfflineResponse } from "./offline-worker";

export interface OfflineRun {
  result: Promise<{ state: GameState; summary: OfflineSummary }>;
  /** Terminates the worker; `result` then rejects and the caller's state stays untouched. */
  cancel(): void;
}

/** Runs the settlement off the main thread (plan §11.3). The input state is copied, never mutated. */
export function runOfflineInWorker(state: GameState, window: OfflineWindow, onProgress: (p: OfflineProgress) => void): OfflineRun {
  const worker = new Worker(new URL("./offline-worker.ts", import.meta.url), { type: "module" });
  let rejectRun: (error: Error) => void = () => {};

  const result = new Promise<{ state: GameState; summary: OfflineSummary }>((resolve, reject) => {
    rejectRun = reject;
    worker.addEventListener("message", (event: MessageEvent<OfflineResponse>) => {
      const message = event.data;
      switch (message.type) {
        case "progress":
          onProgress(message);
          return;
        case "done":
          worker.terminate();
          resolve({ state: message.state, summary: message.summary });
          return;
        case "error":
          worker.terminate();
          reject(new Error(`offline simulation failed: ${message.message}`));
          return;
      }
    });
    worker.addEventListener("error", (event) => {
      worker.terminate();
      reject(new Error(`offline worker crashed: ${event.message}`));
    });
  });

  worker.postMessage({ state, window } satisfies OfflineRequest);
  return {
    result,
    cancel() {
      worker.terminate();
      rejectRun(new Error("offline simulation cancelled"));
    },
  };
}
