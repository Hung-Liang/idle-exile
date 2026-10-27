import type { DamageType, ModifierSpec, Tag } from "../game/modifiers";

export type SkillId = "heavy_strike" | "rapid_assault" | "arc_pulse" | "fireball" | "ice_nova" | "storm_lance";

/** A spell's own base values; spells ignore the weapon (plan §7.1). */
export interface SpellValues {
  /** Base time between casts, before cast speed. */
  castTimeMs: number;
  /** Percent. */
  critChance: number;
  /** Fractions of the base spell damage (`spellBaseDamage`) per type; sums to 1. */
  damageSplit: Partial<Record<DamageType, number>>;
}

export interface SkillDefinition {
  id: SkillId;
  name: string;
  unlockLevel: number;
  tags: Tag[];
  /** Damage effectiveness multiplier (1.6 = 160%). */
  effectiveness: number;
  modifiers: ModifierSpec[];
  chain?: {
    additionalTargets: number;
    /** "more" value applied to chained hits; negative = less. */
    chainedHitMore: number;
  };
  /** Present exactly for skills with the `spell` tag; attacks use the weapon instead. */
  spell?: SpellValues;
}

export const SKILLS: Record<SkillId, SkillDefinition> = {
  heavy_strike: {
    id: "heavy_strike",
    name: "Heavy Strike",
    unlockLevel: 1,
    tags: ["attack", "single_target"],
    effectiveness: 1.6,
    modifiers: [{ stat: "attack_speed", kind: "more", value: -20 }],
  },
  rapid_assault: {
    id: "rapid_assault",
    name: "Rapid Assault",
    unlockLevel: 4,
    tags: ["attack", "single_target"],
    effectiveness: 1.0,
    modifiers: [{ stat: "attack_speed", kind: "more", value: 60 }],
  },
  arc_pulse: {
    id: "arc_pulse",
    name: "Arc Pulse",
    unlockLevel: 8,
    tags: ["attack", "chain", "lightning"],
    effectiveness: 1.0,
    modifiers: [{ stat: "conversion", kind: "flat", damageType: "lightning", value: 100 }],
    chain: { additionalTargets: 2, chainedHitMore: -50 },
  },
  fireball: {
    id: "fireball",
    name: "Fireball",
    unlockLevel: 2,
    tags: ["spell", "single_target", "fire"],
    effectiveness: 1.0,
    modifiers: [{ stat: "ailment_chance", kind: "flat", damageType: "fire", value: 25 }],
    spell: { castTimeMs: 850, critChance: 6, damageSplit: { fire: 1 } },
  },
  ice_nova: {
    id: "ice_nova",
    name: "Ice Nova",
    unlockLevel: 10,
    tags: ["spell", "area", "cold"],
    effectiveness: 0.6,
    modifiers: [{ stat: "ailment_chance", kind: "flat", damageType: "cold", value: 30 }],
    spell: { castTimeMs: 900, critChance: 5, damageSplit: { cold: 1 } },
  },
  storm_lance: {
    id: "storm_lance",
    name: "Storm Lance",
    unlockLevel: 16,
    tags: ["spell", "single_target", "lightning"],
    effectiveness: 0.85,
    modifiers: [{ stat: "ailment_chance", kind: "flat", damageType: "lightning", value: 25 }],
    spell: { castTimeMs: 700, critChance: 9, damageSplit: { lightning: 1 } },
  },
};
