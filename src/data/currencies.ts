export type CurrencyId = "kindle_shard" | "flux_shard" | "ascend_shard" | "temper_shard" | "graft_shard";

export interface CurrencyDefinition {
  id: CurrencyId;
  name: string;
  description: string;
  dropWeight: number;
}

export const CURRENCIES: Record<CurrencyId, CurrencyDefinition> = {
  kindle_shard: {
    id: "kindle_shard",
    name: "Kindle Shard",
    description: "Upgrades a Normal item to Magic.",
    dropWeight: 50,
  },
  flux_shard: {
    id: "flux_shard",
    name: "Flux Shard",
    description: "Rerolls all affixes of a Magic item.",
    dropWeight: 30,
  },
  ascend_shard: {
    id: "ascend_shard",
    name: "Ascend Shard",
    description: "Upgrades a Magic item to Rare, keeping its affixes and adding one.",
    dropWeight: 12,
  },
  temper_shard: {
    id: "temper_shard",
    name: "Temper Shard",
    description: "Rerolls the values of all affixes on a Magic or Rare item, keeping tiers.",
    dropWeight: 8,
  },
  graft_shard: {
    id: "graft_shard",
    name: "Graft Shard",
    description: "Adds one random affix to a Rare item with room for it.",
    dropWeight: 4,
  },
};
