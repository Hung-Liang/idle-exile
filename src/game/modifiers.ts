import type { StackId } from "../data/stacks";

export const DAMAGE_TYPES = ["physical", "fire", "cold", "lightning", "chaos"] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

export const ELEMENTAL_TYPES: readonly DamageType[] = ["fire", "cold", "lightning"];

export type Tag = DamageType | "elemental" | "attack" | "spell" | "single_target" | "chain" | "area";

export const STAT_IDS = [
  // offense
  "added_damage",
  "damage",
  "attack_speed",
  "cast_speed",
  "crit_chance",
  "crit_multiplier",
  "penetration",
  "gain_as_extra",
  "conversion",
  // ailments: the damage type selects the ailment (see data/ailments.ts); none = every ailment
  "ailment_chance",
  "ailment_effect",
  "ailment_duration",
  // defense
  "life_max",
  "armor",
  "resistance",
  "resistance_max",
  // recovery
  "life_on_hit",
  "life_recovery_on_clear",
] as const;
export type StatId = (typeof STAT_IDS)[number];

export const MOD_KINDS = ["flat", "increased", "more"] as const;
/** Negative "more" values express "less". */
export type ModKind = (typeof MOD_KINDS)[number];

export type SourceKind = "item" | "passive" | "skill" | "support" | "map" | "base" | "level_gap" | "elite";

export interface SourceRef {
  kind: SourceKind;
  id: string;
}

/** Pure boolean gates evaluated against the context. They never carry counters. */
export type Condition = { kind: "enemy_life_below_pct"; value: number };

export interface Modifier {
  stat: StatId;
  kind: ModKind;
  /** A `[min, max]` range is only valid for flat modifiers (e.g. added damage). */
  value: number | [number, number];
  damageType?: DamageType;
  /** All of these must be present in the context tags. */
  tags?: Tag[];
  condition?: Condition;
  /** Effective value is multiplied by `context.stacks[perStack]` (0 when missing). */
  perStack?: StackId;
  local?: boolean;
  source: SourceRef;
}

/** A modifier as written in content data; the source is attached when it is collected. */
export type ModifierSpec = Omit<Modifier, "source">;

export interface AggregateContext {
  tags: readonly Tag[];
  damageType?: DamageType;
  /** undefined → enemy-life conditions do not hold. */
  enemyLifePct?: number;
  /** Missing key = 0. */
  stacks: Readonly<Partial<Record<StackId, number>>>;
}

export interface AggregateResult {
  /** Sum of scalar flat values. */
  flat: number;
  /** Sum of flat values as a range; scalar flat values contribute to both ends. */
  flatRange: [number, number];
  /** Sum of increased values, in percent. */
  increased: number;
  /** Product of (1 + v/100) across more values. */
  more: number;
}

function conditionHolds(condition: Condition, context: AggregateContext): boolean {
  switch (condition.kind) {
    case "enemy_life_below_pct":
      return context.enemyLifePct !== undefined && context.enemyLifePct < condition.value;
  }
}

export function modifierMatches(mod: Modifier, stat: StatId, context: AggregateContext): boolean {
  if (mod.stat !== stat) {
    return false;
  }
  if (mod.damageType !== undefined && mod.damageType !== context.damageType) {
    return false;
  }
  if (mod.tags !== undefined && !mod.tags.every((tag) => context.tags.includes(tag))) {
    return false;
  }
  if (mod.condition !== undefined && !conditionHolds(mod.condition, context)) {
    return false;
  }
  return true;
}

/**
 * The single aggregation function for all modifier sources. Pure: it never reads or
 * writes stack counters beyond the given context, and never mutates its inputs.
 */
export function aggregate(mods: readonly Modifier[], stat: StatId, context: AggregateContext): AggregateResult {
  let flat = 0;
  let flatMin = 0;
  let flatMax = 0;
  let increased = 0;
  let more = 1;

  for (const mod of mods) {
    if (!modifierMatches(mod, stat, context)) {
      continue;
    }
    const multiplier = mod.perStack !== undefined ? (context.stacks[mod.perStack] ?? 0) : 1;

    if (Array.isArray(mod.value)) {
      if (mod.kind !== "flat") {
        throw new TypeError(`aggregate: range value is only valid for flat modifiers (${mod.stat}/${mod.kind})`);
      }
      flatMin += mod.value[0] * multiplier;
      flatMax += mod.value[1] * multiplier;
      continue;
    }

    const value = mod.value * multiplier;
    switch (mod.kind) {
      case "flat":
        flat += value;
        flatMin += value;
        flatMax += value;
        break;
      case "increased":
        increased += value;
        break;
      case "more":
        more *= 1 + value / 100;
        break;
    }
  }

  return { flat, flatRange: [flatMin, flatMax], increased, more };
}

/** `(base + flat) * (1 + increased/100) * more`. */
export function applyScalar(base: number, result: AggregateResult): number {
  return (base + result.flat) * (1 + result.increased / 100) * result.more;
}
