import { emptyTally, tallyEvents, type EventTally } from "../game/offline";
import type { GameEvent } from "../game/events";
import type { GameState } from "../game/state";

export interface SessionStats {
  readonly tally: EventTally;
  /** Online sim time recorded since the last reset. */
  readonly elapsedMs: number;
  /** Counts one online tick. */
  record(state: GameState, events: readonly GameEvent[]): void;
  reset(): void;
}

/**
 * Online farming rates. Only sim time that passes between two ticks on the same state object
 * counts, so an offline settlement (which replaces the state) never inflates the rates.
 */
export function createSessionStats(): SessionStats {
  let tally = emptyTally();
  let elapsedMs = 0;
  let lastState: GameState | null = null;
  let lastSimTimeMs = 0;

  return {
    get tally() {
      return tally;
    },
    get elapsedMs() {
      return elapsedMs;
    },
    record(state, events) {
      if (state === lastState) elapsedMs += state.simTimeMs - lastSimTimeMs;
      lastState = state;
      lastSimTimeMs = state.simTimeMs;
      tallyEvents(tally, events);
    },
    reset() {
      tally = emptyTally();
      elapsedMs = 0;
    },
  };
}
