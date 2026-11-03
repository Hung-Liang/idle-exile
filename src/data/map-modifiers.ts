import type { ModifierSpec } from "../game/modifiers";

export type MapModifierId =
  | "fortified"
  | "savage"
  | "scorching"
  | "draining"
  | "swarming"
  | "frenzied"
  | "plated"
  | "warded"
  | "frigid"
  | "crackling"
  | "toxic"
  | "enfeebling"
  | "smothering"
  | "brittle"
  | "unrelenting"
  | "teeming"
  | "afflicting";

export interface MapModifierDefinition {
  id: MapModifierId;
  name: string;
  description: string;
  quantityPct: number;
  rarityPct: number;
  /** Applied to every monster in the run (see `monsterStats` for the supported stats). */
  monsterMods: ModifierSpec[];
  /** Applied to the player's build for the run. */
  playerMods: ModifierSpec[];
  /** Replaces the pack-size weights (packs of 1, 2 and 3). */
  packSizeWeights?: [number, number, number];
  /** Increased chance for magic and rare monsters, in percent. */
  eliteChancePct?: number;
}

export const MAP_MODIFIERS: Record<MapModifierId, MapModifierDefinition> = {
  fortified: {
    id: "fortified",
    name: "Fortified",
    description: "Monsters have 40% more life.",
    quantityPct: 8,
    rarityPct: 5,
    monsterMods: [{ stat: "life_max", kind: "more", value: 40 }],
    playerMods: [],
  },
  savage: {
    id: "savage",
    name: "Savage",
    description: "Monsters deal 25% more damage.",
    quantityPct: 10,
    rarityPct: 5,
    monsterMods: [{ stat: "damage", kind: "more", value: 25 }],
    playerMods: [],
  },
  scorching: {
    id: "scorching",
    name: "Scorching",
    description: "Monsters gain 30% of damage as extra fire.",
    quantityPct: 8,
    rarityPct: 8,
    monsterMods: [{ stat: "gain_as_extra", kind: "flat", value: 30, damageType: "fire" }],
    playerMods: [],
  },
  draining: {
    id: "draining",
    name: "Draining",
    description: "Player has −15% to all resistances.",
    quantityPct: 10,
    rarityPct: 10,
    monsterMods: [],
    // No damage type: applies to every resistance.
    playerMods: [{ stat: "resistance", kind: "flat", value: -15 }],
  },
  swarming: {
    id: "swarming",
    name: "Swarming",
    description: "Larger packs.",
    quantityPct: 12,
    rarityPct: 0,
    monsterMods: [],
    playerMods: [],
    packSizeWeights: [20, 40, 40],
  },
  // --- v0.5.0 (plan §10.5) ---
  frenzied: {
    id: "frenzied",
    name: "Frenzied",
    description: "Monsters attack 25% faster.",
    quantityPct: 10,
    rarityPct: 5,
    monsterMods: [{ stat: "attack_speed", kind: "more", value: 25 }],
    playerMods: [],
  },
  plated: {
    id: "plated",
    name: "Plated",
    description: "Monsters have 100% increased armor.",
    quantityPct: 8,
    rarityPct: 5,
    monsterMods: [{ stat: "armor", kind: "increased", value: 100 }],
    playerMods: [],
  },
  warded: {
    id: "warded",
    name: "Warded",
    description: "Monsters have +25% fire, cold and lightning resistance.",
    quantityPct: 8,
    rarityPct: 5,
    monsterMods: (["fire", "cold", "lightning"] as const).map((damageType): ModifierSpec => ({ stat: "resistance", kind: "flat", damageType, value: 25 })),
    playerMods: [],
  },
  frigid: {
    id: "frigid",
    name: "Frigid",
    description: "Monsters gain 30% of damage as extra cold.",
    quantityPct: 8,
    rarityPct: 8,
    monsterMods: [{ stat: "gain_as_extra", kind: "flat", value: 30, damageType: "cold" }],
    playerMods: [],
  },
  crackling: {
    id: "crackling",
    name: "Crackling",
    description: "Monsters gain 30% of damage as extra lightning.",
    quantityPct: 8,
    rarityPct: 8,
    monsterMods: [{ stat: "gain_as_extra", kind: "flat", value: 30, damageType: "lightning" }],
    playerMods: [],
  },
  toxic: {
    id: "toxic",
    name: "Toxic",
    description: "Monsters gain 20% of damage as extra chaos.",
    quantityPct: 10,
    rarityPct: 10,
    monsterMods: [{ stat: "gain_as_extra", kind: "flat", value: 20, damageType: "chaos" }],
    playerMods: [],
  },
  enfeebling: {
    id: "enfeebling",
    name: "Enfeebling",
    description: "Player has 20% less maximum life.",
    quantityPct: 12,
    rarityPct: 10,
    monsterMods: [],
    playerMods: [{ stat: "life_max", kind: "more", value: -20 }],
  },
  smothering: {
    id: "smothering",
    name: "Smothering",
    description: "Player deals 20% less damage.",
    quantityPct: 10,
    rarityPct: 8,
    monsterMods: [],
    playerMods: [{ stat: "damage", kind: "more", value: -20 }],
  },
  brittle: {
    id: "brittle",
    name: "Brittle",
    description: "Player has −10% to all maximum resistances.",
    quantityPct: 12,
    rarityPct: 12,
    monsterMods: [],
    playerMods: [{ stat: "resistance_max", kind: "flat", value: -10 }],
  },
  unrelenting: {
    id: "unrelenting",
    name: "Unrelenting",
    description: "Player recovers 10% less of maximum life when an encounter is cleared.",
    quantityPct: 8,
    rarityPct: 8,
    monsterMods: [],
    playerMods: [{ stat: "life_recovery_on_clear", kind: "flat", value: -10 }],
  },
  teeming: {
    id: "teeming",
    name: "Teeming",
    description: "100% increased chance for magic and rare monsters.",
    quantityPct: 5,
    rarityPct: 15,
    monsterMods: [],
    playerMods: [],
    eliteChancePct: 100,
  },
  afflicting: {
    id: "afflicting",
    name: "Afflicting",
    description: "Monsters have +20% chance to inflict ailments.",
    quantityPct: 10,
    rarityPct: 8,
    monsterMods: [{ stat: "ailment_chance", kind: "flat", value: 20 }],
    playerMods: [],
  },
};
