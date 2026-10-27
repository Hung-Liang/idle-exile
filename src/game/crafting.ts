import { CURRENCIES, type CurrencyId } from "../data/currencies";
import { getAffixDefinition } from "../data/affixes";
import { addRandomAffix, generateAffixes, rollAffixValues } from "./affixes";
import { itemBase, type ItemId, type ItemInstance } from "./equipment";
import type { GameEvent } from "./events";
import { describeItem } from "./loot";
import { clampLifeToMax } from "./stats";
import { appendLog, type GameState } from "./state";

export type CraftError = "item_not_found" | "no_currency" | "invalid_target";

/** Plan §9.3: whether the currency may be used on the item. Invalid targets consume nothing. */
export function canApplyCurrency(item: ItemInstance, currencyId: CurrencyId): boolean {
  switch (currencyId) {
    case "kindle_shard":
      return item.rarity === "normal";
    case "flux_shard":
    case "ascend_shard":
      return item.rarity === "magic";
    case "temper_shard":
      return item.rarity !== "normal" && item.affixes.length > 0;
  }
}

/** Mutates the item in place. All draws come from the `craft` stream. */
function applyCurrency(state: GameState, item: ItemInstance, currencyId: CurrencyId): void {
  const rng = state.rng.craft;
  const itemClass = itemBase(item).itemClass;
  switch (currencyId) {
    case "kindle_shard":
    case "flux_shard":
      item.rarity = "magic";
      item.affixes = generateAffixes(itemClass, item.itemLevel, "magic", rng);
      return;
    case "ascend_shard":
      item.rarity = "rare";
      // An item with nothing left to add still becomes Rare (plan §8.7 step 3).
      addRandomAffix(item.affixes, itemClass, item.itemLevel, "rare", rng);
      return;
    case "temper_shard":
      for (const affix of item.affixes) {
        affix.values = rollAffixValues(getAffixDefinition(affix.affixId), rng);
      }
      return;
  }
}

/** Uses one currency on an equipped or unequipped item. */
export function useCurrency(state: GameState, currencyId: CurrencyId, itemId: ItemId, events: GameEvent[]): CraftError | null {
  const item = state.inventory.items[itemId];
  if (item === undefined) return "item_not_found";
  if (state.inventory.currency[currencyId] < 1) return "no_currency";
  if (!canApplyCurrency(item, currencyId)) return "invalid_target";

  state.inventory.currency[currencyId] -= 1;
  applyCurrency(state, item, currencyId);
  clampLifeToMax(state);
  appendLog(state, "info", `Used ${CURRENCIES[currencyId].name} on ${describeItem(item)}.`);
  events.push({ type: "item_crafted", timeMs: state.simTimeMs, itemId, currencyId });
  return null;
}
