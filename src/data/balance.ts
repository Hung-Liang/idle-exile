// Global tuning constants. All values are provisional (plan §0).

export const MAX_LEVEL = 50;

/** Base life = base + perLevel × (level − 1). */
export const BASE_LIFE = { base: 100, perLevel: 30 } as const;

/** Character level at which each support slot unlocks, in slot order. */
export const SUPPORT_SLOT_LEVELS = [3, 10] as const;

export const INVENTORY_CAPACITY = 60;
export const LOG_CAPACITY = 200;

export const ZONE_REQUIRED_ENCOUNTERS = 10;
export const MAX_MAP_TIER = 10;

/** Auto-advance only enters an area once the character is at most this many levels below it. */
export const AUTO_ADVANCE_LEVEL_MARGIN = 2;

/** Capped at MAX_LEVEL, so map tiers above the level cap stay reachable by auto-advance. */
export function autoAdvanceLevel(monsterLevel: number): number {
  return Math.min(MAX_LEVEL, monsterLevel - AUTO_ADVANCE_LEVEL_MARGIN);
}

// --- Character (plan §6.1) ---

export const CHARACTER_BASE = {
  unarmedPhysical: [5, 8] as [number, number],
  unarmedAttacksPerSecond: 1.0,
  /** Percent; a weapon base overrides it. */
  critChance: 5,
  /** Percent. */
  critMultiplier: 150,
} as const;

export const RESISTANCE_DEFAULT_MAX = 75;
export const RESISTANCE_MIN = -100;
export const ARMOR_DR_CAP = 0.9;
/** dr = armor / (armor + ARMOR_RAW_FACTOR × raw_physical). */
export const ARMOR_RAW_FACTOR = 5;
export const CRIT_CHANCE_CAP = 95;
export const MAX_ATTACKS_PER_SECOND = 10;

// --- Timing (plan §4.1), integer sim ms ---

export const TRANSITION_MS = 1_000;
export const RESPAWN_MS = 5_000;

// --- Recovery and death (plan §6.5, §6.6) ---

/** Percent of max life recovered when an encounter is cleared, before `life_recovery_on_clear`. */
export const TRANSITION_LIFE_RECOVERY_PCT = 15;
export const DEATHS_BEFORE_RETREAT = 3;

// --- Level gap: monsters above the character's level gain more life and damage ---

export const LEVEL_GAP_PCT_PER_LEVEL = 4;
export const LEVEL_GAP_MAX_LEVELS = 10;

// --- Encounters (plan §4.3) ---

/** Weights for packs of 1, 2 and 3 monsters. */
export const PACK_SIZE_WEIGHTS: [number, number, number] = [50, 35, 15];

// --- Experience (plan §10.1) ---

export function xpToNextLevel(level: number): number {
  return Math.round(60 * level ** 2.25 + 40);
}

/** Before the archetype/boss XP multiplier and the level-difference penalty. */
export function monsterBaseXp(monsterLevel: number): number {
  return Math.round(8 * 1.09 ** (monsterLevel - 1));
}

export function xpSafeRange(characterLevel: number): number {
  return 3 + Math.floor(characterLevel / 10);
}

export const XP_PENALTY_PER_EXCESS_LEVEL = 0.06;
export const XP_MIN_MULTIPLIER = 0.2;

// --- Monster scaling (plan §10.2) ---

/**
 * Curve anchors as [monster level, value], ascending. Values between anchors are interpolated
 * geometrically (constant growth rate per level within a segment) and extrapolated with the
 * last segment's rate. M6 tuning replaced the single exponentials of plan §10.2: those grew
 * too slowly against early gear and too fast against capped endgame gear.
 */
export type CurveAnchors = readonly (readonly [number, number])[];

export function interpolateCurve(anchors: CurveAnchors, level: number): number {
  let i = 0;
  while (i < anchors.length - 2 && level > anchors[i + 1]![0]) i++;
  const [l0, v0] = anchors[i]!;
  const [l1, v1] = anchors[i + 1]!;
  return v0 * (v1 / v0) ** ((level - l0) / (l1 - l0));
}

export const MONSTER_LIFE_CURVE: CurveAnchors = [
  [1, 30],
  [8, 65],
  [17, 600],
  [30, 2200],
  [52, 5500],
];

/** Per hit, physical-equivalent. */
export const MONSTER_DAMAGE_CURVE: CurveAnchors = [
  [1, 4],
  [8, 6],
  [17, 28],
  [30, 75],
  [52, 115],
];

export function monsterBaseLife(monsterLevel: number): number {
  return Math.round(interpolateCurve(MONSTER_LIFE_CURVE, monsterLevel));
}

/** Per hit, physical-equivalent, before archetype multiplier and roll. */
export function monsterBaseDamage(monsterLevel: number): number {
  return interpolateCurve(MONSTER_DAMAGE_CURVE, monsterLevel);
}

/** Before the archetype armor multiplier. */
export function monsterBaseArmor(monsterLevel: number): number {
  return 3 * monsterLevel;
}

/** Each monster hit rolls ±this fraction. */
export const MONSTER_DAMAGE_VARIANCE = 0.2;

// --- Passive tree (plan §7.3) ---

/** One passive point every N levels (levels 3, 6, …, 48). */
export const PASSIVE_POINT_EVERY_LEVELS = 3;

// --- Item comparison reference (plan §8.8) ---

/** Pack DPS counts chain targets up to this pack size. */
export const EVALUATE_PACK_SIZE = 3;

/** Damage mix assumed by EHP; fractions sum to 1. Physical uses the zone's base monster hit. */
export const EVALUATE_DAMAGE_MIX = { physical: 0.4, fire: 0.15, cold: 0.15, lightning: 0.15, chaos: 0.15 } as const;

// --- Offline progression (plan §11) ---

/** Time away beyond this is not simulated. */
export const OFFLINE_CAP_MS = 8 * 3_600_000;
/** Sim time per `advance()` call in the chunked offline run. */
export const OFFLINE_CHUNK_MS = 60_000;
/** Hard safety cap per settlement; valid rules stay far below it (~400k worst case). */
export const OFFLINE_EVENT_BUDGET = 2_000_000;
/** Gaps up to this are settled silently, without a summary. */
export const OFFLINE_SUMMARY_MIN_MS = 60_000;
