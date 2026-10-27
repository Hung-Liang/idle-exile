import { ITEM_BASES, type ItemBaseDefinition, type ItemBaseId } from "../data/item-bases";
import { affixModifierSpecs } from "./affixes";
import { aggregate, applyScalar, DAMAGE_TYPES, type DamageType, type Modifier, type ModifierSpec } from "./modifiers";

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

export function rarityRank(rarity: Rarity): number {
  return RARITIES.indexOf(rarity);
}

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
  /** Locked items cannot be salvaged. Absent = unlocked. */
  locked?: true;
}

export function formatItemId(n: number): ItemId {
  return `i${n}`;
}

export function itemBase(item: ItemInstance): ItemBaseDefinition {
  return ITEM_BASES[item.baseId];
}

/** Slots an item of this class can be equipped in. */
export function slotsForClass(itemClass: ItemClass): EquipSlot[] {
  return EQUIP_SLOTS.filter((slot) => SLOT_ITEM_CLASS[slot] === itemClass);
}

export interface WeaponStats {
  /** Local-adjusted physical damage range. */
  physical: [number, number];
  /** Local added non-physical damage ranges; missing = none. */
  added?: Partial<Record<DamageType, [number, number]>>;
  attacksPerSecond: number;
  /** Percent. */
  critChance: number;
}

/** An item's contribution to the build after local modifiers are applied to its own base (plan §5.3). */
export interface ResolvedItem {
  /** Present for weapons only. */
  weapon: WeaponStats | undefined;
  /** Local-adjusted base armor. */
  armor: number;
  /** Non-local modifiers, which enter global aggregation. */
  globalMods: ModifierSpec[];
}

export function itemModifierSpecs(item: ItemInstance): ModifierSpec[] {
  return item.affixes.flatMap(affixModifierSpecs);
}

export function resolveItem(item: ItemInstance): ResolvedItem {
  const base = itemBase(item);
  const specs = itemModifierSpecs(item);
  const local: Modifier[] = specs.filter((s) => s.local === true).map((s) => ({ ...s, source: { kind: "item", id: item.id } }));
  const globalMods = specs.filter((s) => s.local !== true);
  const localStat = (stat: Modifier["stat"], damageType?: DamageType) =>
    aggregate(local, stat, damageType === undefined ? { tags: [], stacks: {} } : { tags: [], damageType, stacks: {} });

  let weapon: WeaponStats | undefined;
  if (base.weapon !== undefined) {
    const flatPhys = localStat("added_damage", "physical").flatRange;
    const incPhys = 1 + localStat("damage", "physical").increased / 100;
    const added: Partial<Record<DamageType, [number, number]>> = {};
    for (const type of DAMAGE_TYPES) {
      if (type === "physical") continue;
      const [min, max] = localStat("added_damage", type).flatRange;
      if (max > 0) added[type] = [min, max];
    }
    weapon = {
      physical: [(base.weapon.physical[0] + flatPhys[0]) * incPhys, (base.weapon.physical[1] + flatPhys[1]) * incPhys],
      attacksPerSecond: applyScalar(base.weapon.attacksPerSecond, localStat("attack_speed")),
      critChance: applyScalar(base.weapon.critChance, localStat("crit_chance")),
    };
    if (Object.keys(added).length > 0) weapon.added = added;
  }

  return { weapon, armor: applyScalar(base.armor ?? 0, localStat("armor")), globalMods };
}
