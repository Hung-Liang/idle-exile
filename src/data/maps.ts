import type { BossId } from "./monsters";

export interface MapTierDefinition {
  tier: number;
  monsterLevel: number;
  /** Base drop bonuses in percent, before map modifiers. */
  quantityPct: number;
  rarityPct: number;
}

/** Plan §10.5. Index = tier − 1; the length must equal MAX_MAP_TIER. */
export const MAP_TIERS: readonly MapTierDefinition[] = [
  { tier: 1, monsterLevel: 40, quantityPct: 0, rarityPct: 0 },
  { tier: 2, monsterLevel: 42, quantityPct: 10, rarityPct: 10 },
  { tier: 3, monsterLevel: 44, quantityPct: 20, rarityPct: 20 },
  { tier: 4, monsterLevel: 46, quantityPct: 30, rarityPct: 30 },
  { tier: 5, monsterLevel: 48, quantityPct: 40, rarityPct: 40 },
];

export const MAP_REQUIRED_ENCOUNTERS = 12;

/** Weights for 0, 1 and 2 map modifiers per run. */
export const MAP_MODIFIER_COUNT_WEIGHTS: readonly number[] = [30, 50, 20];

/** No dedicated map bosses in the MVP: map runs reuse the campaign bosses (equal weights). */
export const MAP_BOSS_POOL: readonly BossId[] = [
  "gatewarden",
  "mire_matron",
  "rimebound",
  "foreman_vael",
  "slag_tyrant",
  "mother_of_silt",
  "prism_knight",
  "hollow_regent",
];

export function mapTier(tier: number): MapTierDefinition {
  const def = MAP_TIERS[tier - 1];
  if (def === undefined) {
    throw new Error(`unknown map tier ${tier}`);
  }
  return def;
}
