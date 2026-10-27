import type { CurrencyId } from "../data/currencies";
import type { PassiveNodeId } from "../data/passive-tree";
import type { SkillId } from "../data/skills";
import type { SupportId } from "../data/supports";
import type { ZoneId } from "../data/zones";
import type { EquipSlot, ItemId, Rarity } from "./equipment";
import type { Activity, EncounterRuntime } from "./state";

/** Emitted by `advance()` / `dispatch()` for the UI, log and tools. Never persisted. */
export type GameEvent =
  | { type: "encounter_started"; timeMs: number; index: number; isBoss: boolean }
  | { type: "monster_killed"; timeMs: number; defId: string; isBoss: boolean; xp: number }
  | { type: "encounter_cleared"; timeMs: number; index: number; isBoss: boolean }
  | { type: "player_died"; timeMs: number }
  | { type: "level_up"; timeMs: number; level: number }
  | { type: "zone_unlocked"; timeMs: number; zoneId: ZoneId }
  | { type: "map_tier_unlocked"; timeMs: number; tier: number }
  | { type: "activity_changed"; timeMs: number; activity: Activity }
  | { type: "item_dropped"; timeMs: number; itemId: ItemId; rarity: Rarity; outcome: "kept" | "salvaged" | "overflow" }
  | { type: "currency_gained"; timeMs: number; currencyId: CurrencyId; amount: number; source: "drop" | "salvage" }
  | { type: "item_equipped"; timeMs: number; itemId: ItemId; slot: EquipSlot; replaced: ItemId | null }
  | { type: "item_salvaged"; timeMs: number; itemId: ItemId }
  | { type: "item_crafted"; timeMs: number; itemId: ItemId; currencyId: CurrencyId }
  | { type: "skill_changed"; timeMs: number; skillId: SkillId }
  | { type: "support_changed"; timeMs: number; slot: number; supportId: SupportId | null; removed: SupportId | null }
  | { type: "passive_allocated"; timeMs: number; nodeId: PassiveNodeId }
  | { type: "passives_reset"; timeMs: number };

export type ScheduledEvent =
  | { kind: "phase_end"; time: number }
  | { kind: "player_attack"; time: number }
  | { kind: "monster_attack"; time: number; monsterIndex: number };

/**
 * Selects the earliest currently valid event, recomputed from state every time (plan §4.1).
 * Ties: encounter start / respawn, then the player attack, then monsters in ascending index.
 * Phase-end events only exist outside `fighting` and attacks only inside it, so the first
 * tie-break rule never competes with the others.
 */
export function nextScheduledEvent(encounter: EncounterRuntime): ScheduledEvent | null {
  if (encounter.phase !== "fighting") {
    return { kind: "phase_end", time: encounter.phaseEndsAt };
  }
  let best: ScheduledEvent = { kind: "player_attack", time: encounter.player.nextAttackAt };
  encounter.monsters.forEach((monster, monsterIndex) => {
    // Strictly earlier only: equal times keep the player or the lower monster index.
    if (monster.alive && monster.nextAttackAt < best.time) {
      best = { kind: "monster_attack", time: monster.nextAttackAt, monsterIndex };
    }
  });
  return best;
}
