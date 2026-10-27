import type { ItemClass } from "../game/equipment";

export type ItemBaseId = "rusted_blade" | "iron_maul" | "tempered_sabre" | "quilted_vest" | "iron_band";

export interface WeaponBaseValues {
  physical: [number, number];
  attacksPerSecond: number;
  /** Percent. */
  critChance: number;
}

export interface ItemBaseDefinition {
  id: ItemBaseId;
  name: string;
  itemClass: ItemClass;
  requiredLevel: number;
  weight: number;
  weapon?: WeaponBaseValues;
  armor?: number;
}

export const ITEM_BASES: Record<ItemBaseId, ItemBaseDefinition> = {
  rusted_blade: {
    id: "rusted_blade",
    name: "Rusted Blade",
    itemClass: "weapon",
    requiredLevel: 1,
    weight: 100,
    weapon: { physical: [4, 9], attacksPerSecond: 1.3, critChance: 5 },
  },
  iron_maul: {
    id: "iron_maul",
    name: "Iron Maul",
    itemClass: "weapon",
    requiredLevel: 1,
    weight: 100,
    weapon: { physical: [8, 15], attacksPerSecond: 0.9, critChance: 5 },
  },
  tempered_sabre: {
    id: "tempered_sabre",
    name: "Tempered Sabre",
    itemClass: "weapon",
    requiredLevel: 12,
    weight: 100,
    weapon: { physical: [11, 21], attacksPerSecond: 1.35, critChance: 5.5 },
  },
  quilted_vest: {
    id: "quilted_vest",
    name: "Quilted Vest",
    itemClass: "body",
    requiredLevel: 1,
    weight: 100,
    armor: 20,
  },
  iron_band: {
    id: "iron_band",
    name: "Iron Band",
    itemClass: "ring",
    requiredLevel: 1,
    weight: 100,
  },
};

export const STARTING_WEAPON_BASE: ItemBaseId = "rusted_blade";
