import { INVENTORY_CAPACITY } from "../data/balance";
import { CURRENCIES, type CurrencyId } from "../data/currencies";
import { DROP_TABLES, SALVAGE_YIELDS, type DropTable } from "../data/drop-tables";
import { ITEM_BASES, type ItemBaseDefinition, type ItemBaseId } from "../data/item-bases";
import { uniqueAffixId, uniqueDropLevel, UNIQUES, type UniqueDefinition, type UniqueId } from "../data/uniques";
import { generateAffixes, rollAffixValues } from "./affixes";
import { getAffixDefinition } from "../data/affixes";
import { EQUIP_SLOTS, formatItemId, itemBase, RARITIES, SLOT_ITEM_CLASS, type ItemInstance, type Rarity } from "./equipment";
import type { GameEvent } from "./events";
import { improvesBuild } from "./evaluate";
import { filterAction } from "./loot-filter";
import { nextChance, nextInt, pickWeighted, weightedIndex, type RngState, type WeightedList } from "./random";
import { appendLog, type GameState } from "./state";

const BASE_LIST: readonly ItemBaseDefinition[] = Object.values(ITEM_BASES);
const CURRENCY_WEIGHTS: WeightedList<CurrencyId> = Object.values(CURRENCIES).map((c) => ({ id: c.id, weight: c.dropWeight }));

const UNIQUE_LIST: readonly UniqueDefinition[] = Object.values(UNIQUES);

const RARITY_LABEL: Record<Rarity, string> = { normal: "Normal", magic: "Magic", rare: "Rare", unique: "Unique" };

export function describeItem(item: ItemInstance): string {
  if (item.uniqueId !== undefined) {
    return `${UNIQUES[item.uniqueId].name}, ${itemBase(item).name} (ilvl ${item.itemLevel})`;
  }
  return `${RARITY_LABEL[item.rarity]} ${itemBase(item).name} (ilvl ${item.itemLevel})`;
}

/** Map-modifier drop bonuses, in percent; 0 outside maps. */
export interface DropBonuses {
  quantityPct: number;
  rarityPct: number;
}

/**
 * Uniform over equipment slots, then weighted over the class's bases with
 * `requiredLevel ≤ itemLevel` (plan §8.3). Slots without an eligible base are skipped.
 */
export function rollItemBase(itemLevel: number, rng: RngState): ItemBaseId {
  const slots = EQUIP_SLOTS.filter((slot) =>
    BASE_LIST.some((b) => b.itemClass === SLOT_ITEM_CLASS[slot] && b.requiredLevel <= itemLevel),
  );
  if (slots.length === 0) {
    throw new Error(`rollItemBase: no base available at item level ${itemLevel}`);
  }
  const itemClass = SLOT_ITEM_CLASS[slots[nextInt(rng, 0, slots.length - 1)]!];
  const bases = BASE_LIST.filter((b) => b.itemClass === itemClass && b.requiredLevel <= itemLevel);
  return pickWeighted(rng, bases.map((b) => ({ id: b.id, weight: b.weight })));
}

/** Uniques that can drop at this item level, by weight. */
export function eligibleUniques(itemLevel: number): WeightedList<UniqueId> {
  return UNIQUE_LIST.filter((def) => uniqueDropLevel(def) <= itemLevel).map((def) => ({ id: def.id, weight: def.weight }));
}

/** Allocates the next item id. The item is not added to the inventory. */
export function createUniqueItem(state: GameState, uniqueId: UniqueId, itemLevel: number, rng: RngState): ItemInstance {
  const def = UNIQUES[uniqueId];
  const affixes = def.lines.map((_, i) => {
    const affixId = uniqueAffixId(uniqueId, i);
    return { affixId, values: rollAffixValues(getAffixDefinition(affixId), rng) };
  });
  const id = formatItemId(state.nextItemId);
  state.nextItemId += 1;
  return { id, baseId: def.baseId, itemLevel, rarity: "unique", uniqueId, affixes };
}

/**
 * Allocates the next item id. The item is not added to the inventory. A unique roll with no
 * unique available at this item level becomes a Rare.
 */
export function generateItem(state: GameState, itemLevel: number, rarity: Rarity, rng: RngState): ItemInstance {
  if (rarity === "unique") {
    const pool = eligibleUniques(itemLevel);
    if (pool.length > 0) {
      return createUniqueItem(state, pickWeighted(rng, pool), itemLevel, rng);
    }
    rarity = "rare";
  }
  const baseId = rollItemBase(itemLevel, rng);
  const affixes = generateAffixes(ITEM_BASES[baseId].itemClass, itemLevel, rarity, rng);
  const id = formatItemId(state.nextItemId);
  state.nextItemId += 1;
  return { id, baseId, itemLevel, rarity, affixes };
}

function rollRarity(table: DropTable, bonuses: DropBonuses, rng: RngState): Rarity {
  const rarityMult = 1 + bonuses.rarityPct / 100;
  const weights = RARITIES.map((r) => table.rarityWeights[r] * (r === "normal" ? 1 : rarityMult));
  return RARITIES[weightedIndex(rng, weights)]!;
}

export function addCurrency(state: GameState, currencyId: CurrencyId, amount: number): void {
  state.inventory.currency[currencyId] += amount;
}

/** Rolls salvage yields from the `craft` stream and credits them. Does not touch the inventory. */
export function salvageYield(state: GameState, item: ItemInstance, events: GameEvent[]): Partial<Record<CurrencyId, number>> {
  const gained: Partial<Record<CurrencyId, number>> = {};
  for (const entry of SALVAGE_YIELDS[item.rarity]) {
    if (nextChance(state.rng.craft, entry.chance)) {
      addCurrency(state, entry.currencyId, 1);
      gained[entry.currencyId] = (gained[entry.currencyId] ?? 0) + 1;
      events.push({ type: "currency_gained", timeMs: state.simTimeMs, currencyId: entry.currencyId, amount: 1, source: "salvage" });
    }
  }
  return gained;
}

/**
 * Applies the loot filter to a freshly generated item: kept items go to the end of the
 * inventory, salvaged ones yield currency. A kept item that does not fit is salvaged as overflow.
 */
export function receiveItem(state: GameState, item: ItemInstance, events: GameEvent[]): void {
  const action = filterAction(state.settings.lootFilter, item, () => improvesBuild(state, item));
  let outcome: "kept" | "salvaged" | "overflow" = action === "keep" ? "kept" : "salvaged";
  if (outcome === "kept" && state.inventory.order.length >= INVENTORY_CAPACITY) {
    outcome = "overflow";
  }
  if (outcome === "kept") {
    state.inventory.items[item.id] = item;
    state.inventory.order.push(item.id);
    appendLog(state, "drop", `Found ${describeItem(item)}.`);
  } else {
    salvageYield(state, item, events);
    if (outcome === "overflow") {
      appendLog(state, "drop", `Inventory full — salvaged ${describeItem(item)}.`);
    }
  }
  events.push({ type: "item_dropped", timeMs: state.simTimeMs, itemId: item.id, rarity: item.rarity, outcome });
}

/** Plan §9.1. Consumes only the `loot` stream (and `craft` for auto-salvage). */
export function rollMonsterDrops(
  state: GameState,
  monsterLevel: number,
  isBoss: boolean,
  bonuses: DropBonuses,
  events: GameEvent[],
): void {
  const rng = state.rng.loot;
  const table = DROP_TABLES[isBoss ? "boss" : "normal"];
  const quantityMult = 1 + bonuses.quantityPct / 100;
  const itemLevel = monsterLevel + table.itemLevelBonus;

  if (nextChance(rng, table.itemChance * quantityMult)) {
    const count = table.itemCount + (isBoss ? Math.floor((table.itemCount * bonuses.quantityPct) / 100) : 0);
    for (let i = 0; i < count; i++) {
      receiveItem(state, generateItem(state, itemLevel, rollRarity(table, bonuses, rng), rng), events);
    }
  }

  if (nextChance(rng, table.currencyChance * quantityMult)) {
    for (let i = 0; i < table.currencyCount; i++) {
      const currencyId = pickWeighted(rng, CURRENCY_WEIGHTS);
      addCurrency(state, currencyId, 1);
      appendLog(state, "drop", `Found ${CURRENCIES[currencyId].name}.`);
      events.push({ type: "currency_gained", timeMs: state.simTimeMs, currencyId, amount: 1, source: "drop" });
    }
  }
}
