import { ADDED_DAMAGE_MAX_FACTOR, AFFIXES, getAffixDefinition, type AffixCategory, type AffixDefinition, type AffixModifierDefinition } from "../data/affixes";
import { AFFIX_CATEGORY_LIMITS, AFFIX_COUNT_WEIGHTS } from "../data/drop-tables";
import type { ItemClass, Rarity, RolledAffix } from "./equipment";
import type { ModifierSpec } from "./modifiers";
import { nextInt, weightedIndex, type RngState } from "./random";

/** Stable iteration order, so draws are reproducible. */
const AFFIX_LIST: readonly AffixDefinition[] = Object.values(AFFIXES);

/** Plan §8.7 step 2.2. */
export function eligibleAffixes(
  itemClass: ItemClass,
  itemLevel: number,
  categories: readonly AffixCategory[],
  presentGroups: ReadonlySet<string>,
): AffixDefinition[] {
  return AFFIX_LIST.filter(
    (def) =>
      def.itemClasses.includes(itemClass) &&
      def.requiredItemLevel <= itemLevel &&
      categories.includes(def.category) &&
      !presentGroups.has(def.group),
  );
}

/** One uniform integer draw per modifier. */
export function rollAffixValues(def: AffixDefinition, rng: RngState): number[] {
  return def.modifiers.map((mod) => nextInt(rng, mod.range[0], mod.range[1]));
}

function openCategories(rarity: Rarity, affixes: readonly RolledAffix[]): AffixCategory[] {
  const limits = AFFIX_CATEGORY_LIMITS[rarity];
  const used = { prefix: 0, suffix: 0 };
  for (const affix of affixes) {
    used[getAffixDefinition(affix.affixId).category] += 1;
  }
  return (["prefix", "suffix"] as const).filter((category) => used[category] < limits[category]);
}

/**
 * Draws one affix by weight among those allowed on the item and appends it. Returns false (and
 * changes nothing) when no affix is eligible.
 */
export function addRandomAffix(
  affixes: RolledAffix[],
  itemClass: ItemClass,
  itemLevel: number,
  rarity: Rarity,
  rng: RngState,
): boolean {
  const presentGroups = new Set(affixes.map((a) => getAffixDefinition(a.affixId).group));
  const pool = eligibleAffixes(itemClass, itemLevel, openCategories(rarity, affixes), presentGroups);
  if (pool.length === 0) {
    return false;
  }
  const def = pool[weightedIndex(rng, pool.map((d) => d.weight))]!;
  affixes.push({ affixId: def.id, values: rollAffixValues(def, rng) });
  return true;
}

/**
 * Plan §8.7: picks the target count by rarity, then adds affixes until the count is reached or
 * nothing eligible remains (a smaller count is not an error).
 */
export function generateAffixes(itemClass: ItemClass, itemLevel: number, rarity: Rarity, rng: RngState): RolledAffix[] {
  const affixes: RolledAffix[] = [];
  if (rarity === "normal") {
    return affixes;
  }
  const target = weightedIndex(rng, AFFIX_COUNT_WEIGHTS[rarity]);
  while (affixes.length < target && addRandomAffix(affixes, itemClass, itemLevel, rarity, rng)) {
    // keep drawing
  }
  return affixes;
}

function modifierValue(def: AffixModifierDefinition, rolled: number): number | [number, number] {
  if (def.stat === "added_damage" && def.kind === "flat") {
    return [rolled, Math.round(rolled * ADDED_DAMAGE_MAX_FACTOR)];
  }
  return rolled;
}

/** The modifiers a rolled affix grants, including the `local` flag. */
export function affixModifierSpecs(affix: RolledAffix): ModifierSpec[] {
  const def = getAffixDefinition(affix.affixId);
  return def.modifiers.map((mod, i) => {
    const spec: ModifierSpec = { stat: mod.stat, kind: mod.kind, value: modifierValue(mod, affix.values[i]!) };
    if (mod.damageType !== undefined) spec.damageType = mod.damageType;
    if (mod.local === true) spec.local = true;
    return spec;
  });
}
