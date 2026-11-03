import type { ModifierSpec } from "../game/modifiers";

export type MonsterAffixId =
  | "hasted"
  | "brutal"
  | "hulking"
  | "armored"
  | "warded"
  | "flaming"
  | "frozen"
  | "shocking"
  | "virulent"
  | "lacerating";

export interface MonsterAffixDefinition {
  id: MonsterAffixId;
  name: string;
  weight: number;
  /** Applied to the elite only (`life_max`, `damage`, `attack_speed`, `armor`, `resistance`, `gain_as_extra`, `ailment_chance`). */
  mods: ModifierSpec[];
}

// Plan §10.6.
export const MONSTER_AFFIXES: Record<MonsterAffixId, MonsterAffixDefinition> = {
  hasted: { id: "hasted", name: "Hasted", weight: 100, mods: [{ stat: "attack_speed", kind: "more", value: 20 }] },
  brutal: { id: "brutal", name: "Brutal", weight: 100, mods: [{ stat: "damage", kind: "more", value: 20 }] },
  hulking: { id: "hulking", name: "Hulking", weight: 100, mods: [{ stat: "life_max", kind: "more", value: 50 }] },
  armored: { id: "armored", name: "Armored", weight: 100, mods: [{ stat: "armor", kind: "increased", value: 150 }] },
  warded: {
    id: "warded",
    name: "Warded",
    weight: 100,
    mods: (["fire", "cold", "lightning"] as const).map((damageType): ModifierSpec => ({ stat: "resistance", kind: "flat", damageType, value: 30 })),
  },
  // v0.7.0: the elemental affixes also inflict their element's ailment.
  flaming: {
    id: "flaming",
    name: "Flaming",
    weight: 70,
    mods: [
      { stat: "gain_as_extra", kind: "flat", damageType: "fire", value: 20 },
      { stat: "ailment_chance", kind: "flat", damageType: "fire", value: 20 },
    ],
  },
  frozen: {
    id: "frozen",
    name: "Frozen",
    weight: 70,
    mods: [
      { stat: "gain_as_extra", kind: "flat", damageType: "cold", value: 20 },
      { stat: "ailment_chance", kind: "flat", damageType: "cold", value: 20 },
    ],
  },
  shocking: {
    id: "shocking",
    name: "Shocking",
    weight: 70,
    mods: [
      { stat: "gain_as_extra", kind: "flat", damageType: "lightning", value: 20 },
      { stat: "ailment_chance", kind: "flat", damageType: "lightning", value: 20 },
    ],
  },
  virulent: { id: "virulent", name: "Virulent", weight: 50, mods: [{ stat: "gain_as_extra", kind: "flat", damageType: "chaos", value: 15 }] },
  lacerating: {
    id: "lacerating",
    name: "Lacerating",
    weight: 60,
    mods: [{ stat: "ailment_chance", kind: "flat", damageType: "physical", value: 30 }],
  },
};

export type EliteRank = "magic" | "rare";

export interface EliteRankDefinition {
  /** Base chance (0..1) per non-boss monster, before the activity's elite bonus. */
  chance: number;
  /** Elites of this rank appear only at this monster level or above. */
  minMonsterLevel: number;
  /** Weights for the number of affixes. Index = affix count. */
  affixCountWeights: readonly number[];
  /** Applied on top of the affixes. */
  mods: ModifierSpec[];
  xpMult: number;
  /** Added to the activity's drop bonuses for this monster's drops. */
  quantityPct: number;
  rarityPct: number;
}

/** Rare is rolled first, then magic, from one draw. */
export const ELITE_RANKS: Record<EliteRank, EliteRankDefinition> = {
  magic: {
    chance: 0.08,
    minMonsterLevel: 1,
    affixCountWeights: [0, 1],
    mods: [{ stat: "life_max", kind: "more", value: 60 }],
    xpMult: 2,
    quantityPct: 100,
    rarityPct: 50,
  },
  rare: {
    chance: 0.02,
    minMonsterLevel: 8,
    affixCountWeights: [0, 0, 60, 40],
    mods: [{ stat: "life_max", kind: "more", value: 100 }],
    xpMult: 5,
    quantityPct: 300,
    rarityPct: 100,
  },
};
