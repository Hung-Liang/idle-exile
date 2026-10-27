// Global tuning constants. All values are provisional (plan §0).

export const MAX_LEVEL = 50;

/** Base life = base + perLevel × (level − 1). */
export const BASE_LIFE = { base: 100, perLevel: 12 } as const;

/** Character level at which each support slot unlocks, in slot order. */
export const SUPPORT_SLOT_LEVELS = [3, 10] as const;

export const INVENTORY_CAPACITY = 60;
export const LOG_CAPACITY = 200;

export const ZONE_REQUIRED_ENCOUNTERS = 10;
export const MAX_MAP_TIER = 5;

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

// --- Encounters (plan §4.3) ---

/** Weights for packs of 1, 2 and 3 monsters. */
export const PACK_SIZE_WEIGHTS: [number, number, number] = [50, 35, 15];

// --- Experience (plan §10.1) ---

export function xpToNextLevel(level: number): number {
  return Math.round(60 * level ** 1.85 + 40);
}

/** Before the archetype/boss XP multiplier and the level-difference penalty. */
export function monsterBaseXp(monsterLevel: number): number {
  return Math.round(8 * 1.09 ** (monsterLevel - 1));
}

export function xpSafeRange(characterLevel: number): number {
  return 3 + Math.floor(characterLevel / 10);
}

export const XP_PENALTY_PER_EXCESS_LEVEL = 0.15;
export const XP_MIN_MULTIPLIER = 0.05;

// --- Monster scaling (plan §10.2) ---

export function monsterBaseLife(monsterLevel: number): number {
  return Math.round(30 * 1.12 ** (monsterLevel - 1));
}

/** Per hit, physical-equivalent, before archetype multiplier and roll. */
export function monsterBaseDamage(monsterLevel: number): number {
  return 4 * 1.08 ** (monsterLevel - 1);
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
