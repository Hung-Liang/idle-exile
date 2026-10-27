import { advance } from "../game/engine";
import type { GameEvent } from "../game/events";
import type { GameState } from "../game/state";

const TICK_MS = 250;
/** Wall-clock gaps longer than this (e.g. a stalled tab) are not simulated online. */
const MAX_DELTA_MS = 1_000;

export interface LoopHandle {
  stop(): void;
}

/** Online driver: feeds wall-clock deltas into `advance()` (plan §4.4). */
export function startLoop(state: GameState, onTick: (events: GameEvent[]) => void): LoopHandle {
  let last = performance.now();
  // Sub-millisecond remainders are carried so sim time does not drift from wall time.
  let carry = 0;
  const id = setInterval(() => {
    const now = performance.now();
    const delta = Math.min(MAX_DELTA_MS, now - last) + carry;
    last = now;
    const ms = Math.floor(delta);
    carry = delta - ms;
    onTick(advance(state, ms).events);
  }, TICK_MS);
  return { stop: () => clearInterval(id) };
}
