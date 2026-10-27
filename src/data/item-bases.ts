import type { ItemClass } from "../game/equipment";

export type ItemBaseId =
  // weapons: a fast and a slow base per tier
  | "rusted_blade"
  | "iron_maul"
  | "tempered_sabre"
  | "war_hammer"
  | "duelist_rapier"
  | "siege_mace"
  | "obsidian_edge"
  | "titan_crusher"
  // helmets
  | "leather_cap"
  | "iron_helm"
  | "steel_visor"
  | "warlord_crown"
  // body armor
  | "quilted_vest"
  | "chain_hauberk"
  | "scale_cuirass"
  | "bastion_plate"
  // gloves
  | "wool_gloves"
  | "riveted_gloves"
  | "steel_gauntlets"
  | "titan_grips"
  // boots
  | "worn_boots"
  | "studded_boots"
  | "greaves"
  | "sentinel_sabatons"
  // amulets
  | "bone_charm"
  | "jade_pendant"
  | "amber_locket"
  | "onyx_talisman"
  // rings
  | "iron_band"
  | "copper_loop"
  | "silver_signet"
  | "gold_seal";

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

type BaseValues = Pick<ItemBaseDefinition, "weapon" | "armor">;

function base(id: ItemBaseId, name: string, itemClass: ItemClass, requiredLevel: number, values: BaseValues = {}): ItemBaseDefinition {
  return { id, name, itemClass, requiredLevel, weight: 100, ...values };
}

function weapon(physical: [number, number], attacksPerSecond: number, critChance: number): BaseValues {
  return { weapon: { physical, attacksPerSecond, critChance } };
}

// Bases are tiered at required levels 1 / 12 / 25 / 38 (plan §8.3).
export const ITEM_BASES: Record<ItemBaseId, ItemBaseDefinition> = {
  rusted_blade: base("rusted_blade", "Rusted Blade", "weapon", 1, weapon([4, 9], 1.3, 5)),
  iron_maul: base("iron_maul", "Iron Maul", "weapon", 1, weapon([8, 15], 0.9, 5)),
  tempered_sabre: base("tempered_sabre", "Tempered Sabre", "weapon", 12, weapon([11, 21], 1.35, 5.5)),
  war_hammer: base("war_hammer", "War Hammer", "weapon", 12, weapon([20, 36], 0.9, 5)),
  duelist_rapier: base("duelist_rapier", "Duelist Rapier", "weapon", 25, weapon([19, 36], 1.4, 6)),
  siege_mace: base("siege_mace", "Siege Mace", "weapon", 25, weapon([34, 62], 0.9, 5)),
  obsidian_edge: base("obsidian_edge", "Obsidian Edge", "weapon", 38, weapon([29, 54], 1.45, 6.5)),
  titan_crusher: base("titan_crusher", "Titan Crusher", "weapon", 38, weapon([52, 95], 0.9, 5)),

  leather_cap: base("leather_cap", "Leather Cap", "helmet", 1, { armor: 12 }),
  iron_helm: base("iron_helm", "Iron Helm", "helmet", 12, { armor: 40 }),
  steel_visor: base("steel_visor", "Steel Visor", "helmet", 25, { armor: 85 }),
  warlord_crown: base("warlord_crown", "Warlord Crown", "helmet", 38, { armor: 140 }),

  quilted_vest: base("quilted_vest", "Quilted Vest", "body", 1, { armor: 20 }),
  chain_hauberk: base("chain_hauberk", "Chain Hauberk", "body", 12, { armor: 70 }),
  scale_cuirass: base("scale_cuirass", "Scale Cuirass", "body", 25, { armor: 150 }),
  bastion_plate: base("bastion_plate", "Bastion Plate", "body", 38, { armor: 250 }),

  wool_gloves: base("wool_gloves", "Wool Gloves", "gloves", 1, { armor: 8 }),
  riveted_gloves: base("riveted_gloves", "Riveted Gloves", "gloves", 12, { armor: 28 }),
  steel_gauntlets: base("steel_gauntlets", "Steel Gauntlets", "gloves", 25, { armor: 60 }),
  titan_grips: base("titan_grips", "Titan Grips", "gloves", 38, { armor: 100 }),

  worn_boots: base("worn_boots", "Worn Boots", "boots", 1, { armor: 8 }),
  studded_boots: base("studded_boots", "Studded Boots", "boots", 12, { armor: 28 }),
  greaves: base("greaves", "Greaves", "boots", 25, { armor: 60 }),
  sentinel_sabatons: base("sentinel_sabatons", "Sentinel Sabatons", "boots", 38, { armor: 100 }),

  bone_charm: base("bone_charm", "Bone Charm", "amulet", 1),
  jade_pendant: base("jade_pendant", "Jade Pendant", "amulet", 12),
  amber_locket: base("amber_locket", "Amber Locket", "amulet", 25),
  onyx_talisman: base("onyx_talisman", "Onyx Talisman", "amulet", 38),

  iron_band: base("iron_band", "Iron Band", "ring", 1),
  copper_loop: base("copper_loop", "Copper Loop", "ring", 12),
  silver_signet: base("silver_signet", "Silver Signet", "ring", 25),
  gold_seal: base("gold_seal", "Gold Seal", "ring", 38),
};

export const STARTING_WEAPON_BASE: ItemBaseId = "rusted_blade";
