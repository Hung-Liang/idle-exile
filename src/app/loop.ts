import { advance } from "../game/engine";
import type { GameEvent } from "../game/events";
import type { GameState } from "../game/state";

const TICK_MS = 250;
/** Wall-clock gaps longer than this (e.g. a stalled tab) are not simulated online. */
const MAX_DELTA_MS = 1_000;

export interface OnlineLoop {
  readonly running: boolean;
  /** Starts ticking with the current instant as baseline; time before it is never simulated. */
  start(): void;
  stop(): void;
  /** Advances by the wall-clock delta since the last tick, so the sim is accounted up to now. No-op when stopped. */
  flush(): GameEvent[];
}

/**
 * Online driver (plan §4.4): the only code that turns wall-clock deltas into `advance()` calls.
 * `perfNow` is injectable for tests.
 */
export function createOnlineLoop(
  state: GameState,
  onTick: (events: GameEvent[]) => void,
  perfNow: () => number = () => performance.now(),
): OnlineLoop {
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastTickPerf = 0;
  // Sub-millisecond remainders are carried so sim time does not drift from wall time.
  let carry = 0;

  function flush(): GameEvent[] {
    if (timer === null) return [];
    const now = perfNow();
    const delta = Math.min(MAX_DELTA_MS, now - lastTickPerf) + carry;
    lastTickPerf = now;
    const ms = Math.floor(delta);
    carry = delta - ms;
    return advance(state, ms).events;
  }

  return {
    get running() {
      return timer !== null;
    },
    start() {
      if (timer !== null) return;
      lastTickPerf = perfNow();
      carry = 0;
      timer = setInterval(() => onTick(flush()), TICK_MS);
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    flush,
  };
}
