import { itemBase, itemModifierSpecs, rarityRank, slotsForClass, type ItemInstance } from "./equipment";
import type { LootFilterRule } from "./state";

export type FilterAction = LootFilterRule["action"];

/** Every condition present on the rule must hold; a rule without conditions matches everything. */
export function ruleMatches(rule: LootFilterRule, item: ItemInstance): boolean {
  if (rule.minRarity !== undefined && rarityRank(item.rarity) < rarityRank(rule.minRarity)) {
    return false;
  }
  if (rule.minItemLevel !== undefined && item.itemLevel < rule.minItemLevel) {
    return false;
  }
  if (rule.slots !== undefined) {
    const slots = slotsForClass(itemBase(item).itemClass);
    if (!rule.slots.some((slot) => slots.includes(slot))) {
      return false;
    }
  }
  if (rule.hasStat !== undefined) {
    const stats = new Set(itemModifierSpecs(item).map((mod) => mod.stat));
    if (!rule.hasStat.some((stat) => stats.has(stat))) {
      return false;
    }
  }
  return true;
}

/** The first matching rule decides (plan §9.2). Items no rule matches are kept. */
export function filterAction(rules: readonly LootFilterRule[], item: ItemInstance): FilterAction {
  return rules.find((rule) => ruleMatches(rule, item))?.action ?? "keep";
}
