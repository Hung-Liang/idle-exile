import type { ItemBaseId } from "../data/item-bases";

export const EQUIP_SLOTS = ["weapon", "helmet", "body", "gloves", "boots", "amulet", "ring1", "ring2"] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

export const ITEM_CLASSES = ["weapon", "helmet", "body", "gloves", "boots", "amulet", "ring"] as const;
export type ItemClass = (typeof ITEM_CLASSES)[number];

export const SLOT_ITEM_CLASS: Record<EquipSlot, ItemClass> = {
  weapon: "weapon",
  helmet: "helmet",
  body: "body",
  gloves: "gloves",
  boots: "boots",
  amulet: "amulet",
  ring1: "ring",
  ring2: "ring",
};

export const RARITIES = ["normal", "magic", "rare"] as const;
export type Rarity = (typeof RARITIES)[number];

/** `"i" + n`, allocated from `GameState.nextItemId`. */
export type ItemId = string;

export interface RolledAffix {
  affixId: string;
  values: number[];
}

export interface ItemInstance {
  id: ItemId;
  baseId: ItemBaseId;
  itemLevel: number;
  rarity: Rarity;
  affixes: RolledAffix[];
}

export function formatItemId(n: number): ItemId {
  return `i${n}`;
}
