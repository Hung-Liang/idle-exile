import { BASE_LIFE, LOG_CAPACITY, SUPPORT_SLOT_LEVELS } from "../data/balance";
import type { CurrencyId } from "../data/currencies";
import { CURRENCIES } from "../data/currencies";
import { STARTING_WEAPON_BASE } from "../data/item-bases";
import type { MapModifierId } from "../data/map-modifiers";
import type { EliteRank, MonsterAffixId } from "../data/monster-affixes";
import type { PassiveNodeId } from "../data/passive-tree";
import type { SkillId } from "../data/skills";
import type { StackId } from "../data/stacks";
import type { SupportId } from "../data/supports";
import type { ZoneId } from "../data/zones";
import { ZONE_ORDER } from "../data/zones";
import { EQUIP_SLOTS, formatItemId, type EquipSlot, type ItemId, type ItemInstance, type Rarity } from "./equipment";
import { CURRENT_SCHEMA_VERSION } from "./migrations";
import type { StatId } from "./modifiers";
import { createRngStates, type RngStates } from "./random";

export type Activity =
  | { kind: "zone"; zoneId: ZoneId }
  | {
      kind: "map";
      tier: number;
      /** Rolled at run start and persisted, so reloading cannot reroll them. */
      modifiers: MapModifierId[];
      encountersCleared: number;
    };

export type EncounterPhase = "fighting" | "transition" | "respawning";

export interface MonsterRuntime {
  defId: string;
  level: number;
  life: number;
  maxLife: number;
  nextAttackAt: number;
  alive: boolean;
  /** Absent = a normal monster (plan §10.6). */
  rank?: EliteRank;
  /** Present exactly when `rank` is. */
  affixes?: MonsterAffixId[];
}

/** Live encounter data. Runtime only: omitted from saves and rebuilt by the first `advance()`. */
export interface EncounterRuntime {
  /** Encounter index within the activity; the boss uses index = required count. */
  index: number;
  isBoss: boolean;
  phase: EncounterPhase;
  /** Sim ms; meaningful for `transition` / `respawning`. */
  phaseEndsAt: number;
  monsters: MonsterRuntime[];
  player: { nextAttackAt: number };
  /** Reset at encounter start. */
  stacks: Partial<Record<StackId, number>>;
  /**
   * Monster level minus character level at encounter start (see `levelGap`). Fixed for the
   * encounter so a mid-encounter level-up cannot make the result depend on how `advance()` is split.
   */
  levelGap: number;
}

export interface LootFilterRule {
  minRarity?: Rarity;
  slots?: EquipSlot[];
  minItemLevel?: number;
  /** Matches if the item has any of these stats. */
  hasStat?: StatId[];
  /** Matches if the item would be an upgrade over the current equipment (`improvesBuild`). */
  upgrade?: true;
  action: "keep" | "salvage";
}

export const LOG_KINDS = ["info", "combat", "death", "drop", "level_up", "error"] as const;
export type LogKind = (typeof LOG_KINDS)[number];

export interface CombatLogEntry {
  timeMs: number;
  kind: LogKind;
  text: string;
}

export interface ZoneProgress {
  encountersCleared: number;
  bossDefeated: boolean;
}

export interface GameState {
  schemaVersion: number;
  simTimeMs: number;
  rng: RngStates;
  nextItemId: number;

  character: {
    level: number;
    xp: number;
    life: number;
    activeSkillId: SkillId;
    /** Length = unlocked support slot count. */
    supportIds: (SupportId | null)[];
    allocatedPassives: PassiveNodeId[];
    equipment: Record<EquipSlot, ItemId | null>;
  };

  inventory: {
    /** Includes equipped items. */
    items: Record<ItemId, ItemInstance>;
    /** Unequipped items only, in display order. */
    order: ItemId[];
    currency: Record<CurrencyId, number>;
  };

  progression: {
    activity: Activity;
    zoneProgress: Partial<Record<ZoneId, ZoneProgress>>;
    unlockedZones: ZoneId[];
    /** 0 = maps locked; N = tiers 1..N playable. */
    unlockedMapTier: number;
    consecutiveDeaths: number;
    totalKills: number;
  };

  /** Runtime only — never persisted. */
  encounter: EncounterRuntime | null;

  settings: {
    autoAdvance: boolean;
    autoRetreat: boolean;
    lootFilter: LootFilterRule[];
  };

  /** Ring buffer, capped at LOG_CAPACITY. */
  log: CombatLogEntry[];
}

export function baseLife(level: number): number {
  return BASE_LIFE.base + BASE_LIFE.perLevel * (level - 1);
}

export function supportSlotCount(level: number): number {
  return SUPPORT_SLOT_LEVELS.filter((required) => level >= required).length;
}

export function defaultLootFilter(): LootFilterRule[] {
  return [{ minRarity: "magic", action: "keep" }, { action: "salvage" }];
}

export function createInitialState(seed: number): GameState {
  const startingZone = ZONE_ORDER[0]!;
  const weaponId = formatItemId(1);
  const level = 1;

  const equipment = Object.fromEntries(EQUIP_SLOTS.map((slot) => [slot, null])) as Record<EquipSlot, ItemId | null>;
  equipment.weapon = weaponId;

  const currency = Object.fromEntries(Object.keys(CURRENCIES).map((id) => [id, 0])) as Record<CurrencyId, number>;

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    simTimeMs: 0,
    rng: createRngStates(seed),
    nextItemId: 2,
    character: {
      level,
      xp: 0,
      life: baseLife(level),
      activeSkillId: "heavy_strike",
      supportIds: Array.from({ length: supportSlotCount(level) }, () => null),
      allocatedPassives: [],
      equipment,
    },
    inventory: {
      items: {
        [weaponId]: { id: weaponId, baseId: STARTING_WEAPON_BASE, itemLevel: 1, rarity: "normal", affixes: [] },
      },
      order: [],
      currency,
    },
    progression: {
      activity: { kind: "zone", zoneId: startingZone },
      zoneProgress: { [startingZone]: { encountersCleared: 0, bossDefeated: false } },
      unlockedZones: [startingZone],
      unlockedMapTier: 0,
      consecutiveDeaths: 0,
      totalKills: 0,
    },
    encounter: null,
    settings: {
      autoAdvance: true,
      autoRetreat: true,
      lootFilter: defaultLootFilter(),
    },
    log: [],
  };
}

/** Appends to the log ring buffer, dropping the oldest entries beyond LOG_CAPACITY. */
export function appendLog(state: GameState, kind: LogKind, text: string): void {
  state.log.push({ timeMs: state.simTimeMs, kind, text });
  if (state.log.length > LOG_CAPACITY) {
    state.log.splice(0, state.log.length - LOG_CAPACITY);
  }
}
