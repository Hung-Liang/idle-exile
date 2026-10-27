import type { Rarity } from "../game/equipment";
import type { CurrencyId } from "./currencies";

export interface DropTable {
  /** Chance (0..1) to drop `itemCount` items; 1 = guaranteed. */
  itemChance: number;
  itemCount: number;
  rarityWeights: Record<Rarity, number>;
  /** Chance (0..1) to drop `currencyCount` currencies; 1 = guaranteed. */
  currencyChance: number;
  currencyCount: number;
  /** Item level = monster level + this. */
  itemLevelBonus: number;
}

// Plan §9.1.
export const DROP_TABLES: Record<"normal" | "boss", DropTable> = {
  normal: {
    itemChance: 0.1,
    itemCount: 1,
    rarityWeights: { normal: 70, magic: 25, rare: 5, unique: 0.25 },
    currencyChance: 0.06,
    currencyCount: 1,
    itemLevelBonus: 0,
  },
  boss: {
    itemChance: 1,
    itemCount: 3,
    rarityWeights: { normal: 20, magic: 50, rare: 30, unique: 1 },
    currencyChance: 1,
    currencyCount: 2,
    itemLevelBonus: 2,
  },
};

/** Weights for the number of affixes, by rarity. Index = affix count. */
export const AFFIX_COUNT_WEIGHTS: Record<Rarity, readonly number[]> = {
  normal: [1],
  magic: [0, 50, 50],
  rare: [0, 0, 0, 0, 50, 35, 15],
  // Uniques have fixed lines and never draw random affixes.
  unique: [1],
};

export const AFFIX_CATEGORY_LIMITS: Record<Rarity, { prefix: number; suffix: number }> = {
  normal: { prefix: 0, suffix: 0 },
  magic: { prefix: 1, suffix: 1 },
  rare: { prefix: 3, suffix: 3 },
  unique: { prefix: 0, suffix: 0 },
};

export interface SalvageYield {
  currencyId: CurrencyId;
  /** 0..1; 1 = guaranteed. */
  chance: number;
}

// Plan §9.4. Each entry is rolled independently, in order, from the `craft` stream.
export const SALVAGE_YIELDS: Record<Rarity, SalvageYield[]> = {
  normal: [{ currencyId: "kindle_shard", chance: 0.2 }],
  magic: [
    { currencyId: "kindle_shard", chance: 1 },
    { currencyId: "flux_shard", chance: 0.3 },
    { currencyId: "cleanse_shard", chance: 0.1 },
  ],
  rare: [
    { currencyId: "flux_shard", chance: 1 },
    { currencyId: "ascend_shard", chance: 0.2 },
    { currencyId: "temper_shard", chance: 0.1 },
    { currencyId: "graft_shard", chance: 0.05 },
    { currencyId: "tumult_shard", chance: 0.15 },
    { currencyId: "sever_shard", chance: 0.03 },
  ],
  unique: [
    { currencyId: "tumult_shard", chance: 1 },
    { currencyId: "temper_shard", chance: 0.5 },
    { currencyId: "sever_shard", chance: 0.1 },
  ],
};
