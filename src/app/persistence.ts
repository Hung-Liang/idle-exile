import type { GameEvent } from "../game/events";
import { writeSave, type KeyValueStorage, type WriteResult } from "../game/save";
import type { GameState } from "../game/state";
import type { OnlineLoop } from "./loop";

/**
 * Plan §11.1: advances the sim up to this instant first, then saves with `lastActiveAt = now`,
 * so wall-clock time up to `lastActiveAt` has always been fed into `advance()`.
 */
export function flushAndSave(loop: OnlineLoop, storage: KeyValueStorage, state: GameState, now: number): WriteResult {
  loop.flush();
  return writeSave(storage, state, { savedAt: now, lastActiveAt: now });
}

/** Plan §12.5: events that trigger an immediate autosave (in addition to the 30 s timer). */
export function needsImmediateSave(events: readonly GameEvent[]): boolean {
  return events.some((event) => {
    switch (event.type) {
      case "level_up":
      case "item_equipped":
      case "skill_changed":
      case "support_changed":
      case "passive_allocated":
      case "passives_reset":
        return true;
      case "encounter_cleared":
        return event.isBoss;
      default:
        return false;
    }
  });
}
