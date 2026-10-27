import {
  ARMOR_DR_CAP,
  ARMOR_RAW_FACTOR,
  LEVEL_GAP_MAX_LEVELS,
  LEVEL_GAP_PCT_PER_LEVEL,
  MAX_ATTACKS_PER_SECOND,
  monsterBaseArmor,
  monsterBaseDamage,
  monsterBaseLife,
  monsterBaseXp,
  MONSTER_DAMAGE_VARIANCE,
  RESISTANCE_DEFAULT_MAX,
  RESISTANCE_MIN,
  spellBaseDamage,
  SPELL_DAMAGE_SPREAD,
} from "../data/balance";
import { getMonsterDefinition } from "../data/monsters";
import type { SkillDefinition } from "../data/skills";
import { aggregate, applyScalar, DAMAGE_TYPES, type AggregateContext, type DamageType, type Modifier } from "./modifiers";
import { nextChance, nextFloat, type RngState } from "./random";
import { critChance, critMultiplier, damageTags, type PlayerBuild, type Stacks } from "./stats";

export type DamagePortions = Record<DamageType, number>;

function emptyPortions(): DamagePortions {
  return { physical: 0, fire: 0, cold: 0, lightning: 0, chaos: 0 };
}

export interface MonsterStats {
  name: string;
  maxLife: number;
  /** Mean damage per hit, before the ±variance roll. */
  damagePerHit: number;
  /** Fractions of each hit per type; sums to 1 unless map modifiers add extra damage. */
  damageSplit: Partial<Record<DamageType, number>>;
  attackIntervalMs: number;
  armor: number;
  resistances: Partial<Record<DamageType, number>>;
  /** Before the level-difference penalty. */
  xp: number;
}

const MONSTER_CONTEXT: AggregateContext = { tags: [], stacks: {} };

/** Levels the monsters are above the character, clamped to `[0, LEVEL_GAP_MAX_LEVELS]`. */
export function levelGap(monsterLevel: number, characterLevel: number): number {
  return Math.min(LEVEL_GAP_MAX_LEVELS, Math.max(0, monsterLevel - characterLevel));
}

/** Monster modifiers for a level gap: more life and more damage, `LEVEL_GAP_PCT_PER_LEVEL` each per level. */
export function levelGapMods(gap: number): Modifier[] {
  if (gap <= 0) return [];
  const value = gap * LEVEL_GAP_PCT_PER_LEVEL;
  const source = { kind: "level_gap", id: "level_gap" } as const;
  return [
    { stat: "life_max", kind: "more", value, source },
    { stat: "damage", kind: "more", value, source },
  ];
}

/**
 * `mods` are the monster's modifiers (map modifiers, level gap, elite rank and affixes):
 * `life_max`, `damage`, `attack_speed` and `armor` scale the base values, `resistance` adds to the
 * archetype's resistances per type, and `gain_as_extra` adds that percentage of each hit as the
 * given type, so the damage split may then sum to more than 1.
 */
export function monsterStats(defId: string, level: number, mods: readonly Modifier[] = []): MonsterStats {
  const def = getMonsterDefinition(defId);
  const aps = Math.min(MAX_ATTACKS_PER_SECOND, applyScalar(def.attacksPerSecond, aggregate(mods, "attack_speed", MONSTER_CONTEXT)));
  let damageSplit = def.damageSplit;
  let resistances = def.resistances;
  if (mods.length > 0) {
    damageSplit = { ...def.damageSplit };
    resistances = { ...def.resistances };
    for (const type of DAMAGE_TYPES) {
      const typed = { ...MONSTER_CONTEXT, damageType: type };
      const extra = aggregate(mods, "gain_as_extra", typed).flat;
      if (extra > 0) {
        damageSplit[type] = (damageSplit[type] ?? 0) + extra / 100;
      }
      const res = aggregate(mods, "resistance", typed).flat;
      if (res !== 0) {
        resistances[type] = (resistances[type] ?? 0) + res;
      }
    }
  }
  return {
    name: def.name,
    maxLife: Math.max(1, Math.round(applyScalar(monsterBaseLife(level) * def.lifeMult, aggregate(mods, "life_max", MONSTER_CONTEXT)))),
    damagePerHit: applyScalar(monsterBaseDamage(level) * def.damageMult, aggregate(mods, "damage", MONSTER_CONTEXT)),
    damageSplit,
    attackIntervalMs: Math.round(1000 / aps),
    armor: Math.max(0, applyScalar(monsterBaseArmor(level) * def.armorMult, aggregate(mods, "armor", MONSTER_CONTEXT))),
    resistances,
    xp: Math.round(monsterBaseXp(level) * def.xpMult),
  };
}

export interface Defender {
  armor: number;
  /** Raw resistance per type; missing = 0. */
  resistances: Partial<Record<DamageType, number>>;
  /** Missing = the default maximum. */
  resistanceMax?: Partial<Record<DamageType, number>>;
}

/** `clamp(res − pen, min, max)`; penetration can only lower the result. */
export function effectiveResistance(res: number, penetration: number, max: number): number {
  return Math.min(max, Math.max(RESISTANCE_MIN, res - Math.max(0, penetration)));
}

/** Damage taken by one portion after armor or resistance (plan §6.3). Not floored. */
export function mitigatePortion(type: DamageType, raw: number, defender: Defender, penetration: number): number {
  if (raw <= 0) {
    return 0;
  }
  if (type === "physical") {
    const dr = defender.armor > 0 ? Math.min(ARMOR_DR_CAP, defender.armor / (defender.armor + ARMOR_RAW_FACTOR * raw)) : 0;
    return raw * (1 - dr);
  }
  const res = effectiveResistance(
    defender.resistances[type] ?? 0,
    penetration,
    defender.resistanceMax?.[type] ?? RESISTANCE_DEFAULT_MAX,
  );
  return raw * (1 - res / 100);
}

/** Life values are integers; every landed hit deals at least 1. */
export function finalDamage(sum: number): number {
  return Math.max(1, Math.floor(sum));
}

/** The per-attack part of the hit pipeline: steps 1–5 and 7 of plan §6.2. */
export interface AttackRoll {
  /** Post-conversion, post-effectiveness damage per type, before increased/more and crit. */
  portions: DamagePortions;
  crit: boolean;
  /** Percent. */
  critMultiplier: number;
}

/**
 * Steps 1–5 of plan §6.2 for a given damage roll `t ∈ [0, 1)`. Every step is linear in `t`, so
 * `t = 0.5` yields the expected portions (used by `evaluate.ts`).
 */
export function attackPortions(build: PlayerBuild, stacks: Stacks, t: number): DamagePortions {
  const { skill, mods } = build;
  const typed = (type: DamageType): AggregateContext => ({ tags: damageTags(skill, type), damageType: type, stacks });

  // 1. Base: weapon (local-adjusted) damage for an attack, or the level's spell damage split by
  // the skill for a spell, plus global added damage per type.
  const ranges = {} as Record<DamageType, [number, number]>;
  const spellAverage = skill.spell === undefined ? 0 : spellBaseDamage(build.level);
  for (const type of DAMAGE_TYPES) {
    const [addMin, addMax] = aggregate(mods, "added_damage", typed(type)).flatRange;
    let base: readonly [number, number];
    if (skill.spell !== undefined) {
      const average = spellAverage * (skill.spell.damageSplit[type] ?? 0);
      base = [average * (1 - SPELL_DAMAGE_SPREAD), average * (1 + SPELL_DAMAGE_SPREAD)];
    } else {
      base = type === "physical" ? build.weapon.physical : (build.weapon.added?.[type] ?? [0, 0]);
    }
    ranges[type] = [base[0] + addMin, base[1] + addMax];
  }

  // 2. Roll: one shared value for every type.
  const portions = emptyPortions();
  for (const type of DAMAGE_TYPES) {
    const [min, max] = ranges[type];
    portions[type] = min + t * (max - min);
  }

  // 3. Conversion: physical → other types, total capped at 100%.
  const conversion = emptyPortions();
  let totalConversion = 0;
  for (const type of DAMAGE_TYPES) {
    if (type !== "physical") {
      conversion[type] = Math.max(0, aggregate(mods, "conversion", typed(type)).flat);
      totalConversion += conversion[type];
    }
  }
  if (totalConversion > 0) {
    const scale = totalConversion > 100 ? 100 / totalConversion : 1;
    const physical = portions.physical;
    for (const type of DAMAGE_TYPES) {
      if (type !== "physical") {
        const moved = (physical * conversion[type] * scale) / 100;
        portions[type] += moved;
        portions.physical -= moved;
      }
    }
    portions.physical = Math.max(0, portions.physical);
  }

  // 4. Gain as extra, from post-conversion physical.
  const physical = portions.physical;
  for (const type of DAMAGE_TYPES) {
    if (type !== "physical") {
      portions[type] += (physical * Math.max(0, aggregate(mods, "gain_as_extra", typed(type)).flat)) / 100;
    }
  }

  // 5. Skill effectiveness.
  for (const type of DAMAGE_TYPES) {
    portions[type] *= skill.effectiveness;
  }

  return portions;
}

/** Consumes exactly two `combat` draws: the damage roll, then the crit roll. */
export function rollAttack(build: PlayerBuild, stacks: Stacks, rng: RngState): AttackRoll {
  const portions = attackPortions(build, stacks, nextFloat(rng));
  // 7. Crit: one roll per attack, drawn before any per-target work.
  const crit = nextChance(rng, critChance(build, stacks) / 100);
  return { portions, crit, critMultiplier: critMultiplier(build, stacks) };
}

export interface HitTarget extends Defender {
  /** Target's life percentage before this hit. */
  lifePct: number;
  /** Percent more damage taken, e.g. from shock (plan §6.8); missing = 0. */
  damageTakenMorePct?: number;
}

/** How many living monsters one use of the skill hits: all for area, 1 + chains for chain, else 1. */
export function skillTargetCount(skill: SkillDefinition): number {
  if (skill.tags.includes("area")) return Infinity;
  return 1 + (skill.chain?.additionalTargets ?? 0);
}

/**
 * Per-target part of the pipeline: steps 6 and 8 of plan §6.2 per type, after mitigation and
 * before the target's damage-taken modifier and the final floor. Damaging ailments scale from these.
 */
export function hitPortions(
  build: PlayerBuild,
  roll: AttackRoll,
  stacks: Stacks,
  target: HitTarget,
  chained: boolean,
): DamagePortions {
  const { skill, mods } = build;
  const result = emptyPortions();
  for (const type of DAMAGE_TYPES) {
    let value = roll.portions[type];
    if (value <= 0) {
      continue;
    }
    const ctx: AggregateContext = { tags: damageTags(skill, type), damageType: type, enemyLifePct: target.lifePct, stacks };
    const scaling = aggregate(mods, "damage", ctx);
    value *= (1 + scaling.increased / 100) * scaling.more;
    if (roll.crit) {
      value *= roll.critMultiplier / 100;
    }
    if (chained && skill.chain !== undefined) {
      value *= 1 + skill.chain.chainedHitMore / 100;
    }
    const penetration = aggregate(mods, "penetration", ctx).flat;
    result[type] = mitigatePortion(type, value, target, penetration);
  }
  return result;
}

/** The hit's total after mitigation and the target's damage-taken modifier, before the final floor. */
export function sumHit(portions: DamagePortions, target: HitTarget): number {
  let sum = 0;
  for (const type of DAMAGE_TYPES) {
    sum += portions[type];
  }
  return sum * (1 + (target.damageTakenMorePct ?? 0) / 100);
}

/** Per-target part of the pipeline: steps 6 and 8 of plan §6.2, before the final floor. */
export function hitDamage(
  build: PlayerBuild,
  roll: AttackRoll,
  stacks: Stacks,
  target: HitTarget,
  chained: boolean,
): number {
  return sumHit(hitPortions(build, roll, stacks, target, chained), target);
}

/** Steps 6 and 8 of plan §6.2. Returns the final integer damage. */
export function resolveHit(
  build: PlayerBuild,
  roll: AttackRoll,
  stacks: Stacks,
  target: HitTarget,
  chained: boolean,
): number {
  return finalDamage(hitDamage(build, roll, stacks, target, chained));
}

/** Consumes exactly one `combat` draw (the ±variance roll). Returns raw damage per type. */
export function rollMonsterHit(stats: MonsterStats, rng: RngState): DamagePortions {
  const factor = 1 + (2 * nextFloat(rng) - 1) * MONSTER_DAMAGE_VARIANCE;
  const total = stats.damagePerHit * factor;
  const portions = emptyPortions();
  for (const type of DAMAGE_TYPES) {
    portions[type] = total * (stats.damageSplit[type] ?? 0);
  }
  return portions;
}

export function mitigateHit(portions: DamagePortions, defender: Defender): number {
  let sum = 0;
  for (const type of DAMAGE_TYPES) {
    sum += mitigatePortion(type, portions[type], defender, 0);
  }
  return finalDamage(sum);
}
