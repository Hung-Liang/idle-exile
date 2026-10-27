import type { ModifierSpec } from "../game/modifiers";

export type MapModifierId = "fortified" | "savage" | "scorching" | "draining" | "swarming";

export interface MapModifierDefinition {
  id: MapModifierId;
  name: string;
  description: string;
  quantityPct: number;
  rarityPct: number;
  /** Applied to every monster in the run (`life_max`, `damage`, `gain_as_extra`). */
  monsterMods: ModifierSpec[];
  /** Applied to the player's build for the run. */
  playerMods: ModifierSpec[];
  /** Replaces the pack-size weights (packs of 1, 2 and 3). */
  packSizeWeights?: [number, number, number];
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
};
