import type { DamageType } from "../game/modifiers";

export type MonsterId = "brute" | "skirmisher" | "ember_wisp" | "frost_husk" | "storm_shade" | "blighted";

export type BossId =
  | "gatewarden"
  | "mire_matron"
  | "rimebound"
  | "foreman_vael"
  | "slag_tyrant"
  | "mother_of_silt"
  | "prism_knight"
  | "hollow_regent";

export type MonsterDefId = MonsterId | BossId;

/** Multipliers apply to the level curves in balance.ts. */
export interface MonsterDefinition {
  id: MonsterDefId;
  name: string;
  lifeMult: number;
  damageMult: number;
  attacksPerSecond: number;
  /** Fractions of each hit per damage type; sums to 1. */
  damageSplit: Partial<Record<DamageType, number>>;
  armorMult: number;
  /** Percent. */
  resistances: Partial<Record<DamageType, number>>;
  xpMult: number;
}

export interface ArchetypeDefinition extends MonsterDefinition {
  id: MonsterId;
  /** The archetype may appear only in zones of at least this monster level. */
  minZoneLevel: number;
}

export interface BossDefinition extends MonsterDefinition {
  id: BossId;
}

export const MONSTERS: Record<MonsterId, ArchetypeDefinition> = {
  brute: {
    id: "brute",
    name: "Brute",
    lifeMult: 1.3,
    damageMult: 1.1,
    attacksPerSecond: 0.8,
    damageSplit: { physical: 1 },
    armorMult: 2.0,
    resistances: {},
    xpMult: 1,
    minZoneLevel: 1,
  },
  skirmisher: {
    id: "skirmisher",
    name: "Skirmisher",
    lifeMult: 0.7,
    damageMult: 0.6,
    attacksPerSecond: 1.6,
    damageSplit: { physical: 1 },
    armorMult: 0.5,
    resistances: {},
    xpMult: 1,
    minZoneLevel: 1,
  },
  ember_wisp: {
    id: "ember_wisp",
    name: "Ember Wisp",
    lifeMult: 0.8,
    damageMult: 0.9,
    attacksPerSecond: 1.0,
    damageSplit: { fire: 1 },
    armorMult: 0,
    resistances: { fire: 40 },
    xpMult: 1,
    minZoneLevel: 4,
  },
  frost_husk: {
    id: "frost_husk",
    name: "Frost Husk",
    lifeMult: 1.0,
    damageMult: 0.9,
    attacksPerSecond: 0.9,
    damageSplit: { cold: 1 },
    armorMult: 1.0,
    resistances: { cold: 40 },
    xpMult: 1,
    minZoneLevel: 8,
  },
  storm_shade: {
    id: "storm_shade",
    name: "Storm Shade",
    lifeMult: 0.8,
    damageMult: 0.9,
    attacksPerSecond: 1.1,
    damageSplit: { lightning: 1 },
    armorMult: 0,
    resistances: { lightning: 40 },
    xpMult: 1,
    minZoneLevel: 12,
  },
  blighted: {
    id: "blighted",
    name: "Blighted",
    lifeMult: 1.1,
    damageMult: 1.0,
    attacksPerSecond: 1.0,
    damageSplit: { physical: 0.5, chaos: 0.5 },
    armorMult: 1.0,
    resistances: { chaos: 25 },
    xpMult: 1,
    minZoneLevel: 17,
  },
};

/** Shared boss multipliers (plan §10.3); damage split, armor and resistances are per boss. */
const BOSS_BASE = { lifeMult: 8, damageMult: 1.5, attacksPerSecond: 0.8, xpMult: 10 } as const;

export const BOSSES: Record<BossId, BossDefinition> = {
  gatewarden: {
    ...BOSS_BASE,
    id: "gatewarden",
    name: "The Gatewarden",
    damageSplit: { physical: 1 },
    armorMult: 1.5,
    resistances: {},
  },
  mire_matron: {
    ...BOSS_BASE,
    id: "mire_matron",
    name: "Mire Matron",
    damageSplit: { physical: 0.6, fire: 0.4 },
    armorMult: 1.0,
    resistances: { fire: 30 },
  },
  rimebound: {
    ...BOSS_BASE,
    id: "rimebound",
    name: "The Rimebound",
    damageSplit: { physical: 0.4, cold: 0.6 },
    armorMult: 1.0,
    resistances: { cold: 40 },
  },
  foreman_vael: {
    ...BOSS_BASE,
    id: "foreman_vael",
    name: "Foreman Vael",
    damageSplit: { physical: 0.5, lightning: 0.5 },
    armorMult: 1.5,
    resistances: { lightning: 30 },
  },
  slag_tyrant: {
    ...BOSS_BASE,
    id: "slag_tyrant",
    name: "The Slag Tyrant",
    damageSplit: { physical: 0.4, fire: 0.6 },
    armorMult: 2.0,
    resistances: { fire: 40 },
  },
  mother_of_silt: {
    ...BOSS_BASE,
    id: "mother_of_silt",
    name: "Mother of Silt",
    damageSplit: { cold: 0.5, chaos: 0.5 },
    armorMult: 1.0,
    resistances: { cold: 30, chaos: 30 },
  },
  prism_knight: {
    ...BOSS_BASE,
    id: "prism_knight",
    name: "The Prism Knight",
    damageSplit: { fire: 1 / 3, cold: 1 / 3, lightning: 1 / 3 },
    armorMult: 1.5,
    resistances: { fire: 30, cold: 30, lightning: 30 },
  },
  hollow_regent: {
    ...BOSS_BASE,
    id: "hollow_regent",
    name: "The Hollow Regent",
    damageSplit: { physical: 0.4, lightning: 0.3, chaos: 0.3 },
    armorMult: 1.5,
    resistances: { lightning: 30, chaos: 30 },
  },
};

export function getMonsterDefinition(id: string): MonsterDefinition {
  if (Object.hasOwn(MONSTERS, id)) {
    return MONSTERS[id as MonsterId];
  }
  if (Object.hasOwn(BOSSES, id)) {
    return BOSSES[id as BossId];
  }
  throw new Error(`unknown monster definition "${id}"`);
}
