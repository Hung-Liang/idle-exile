import type { ItemClass } from "../game/equipment";
import type { DamageType, ModKind, StatId } from "../game/modifiers";

export type AffixCategory = "prefix" | "suffix";

export interface AffixModifierDefinition {
  stat: StatId;
  kind: ModKind;
  damageType?: DamageType;
  local?: boolean;
  /**
   * Integer roll range. For flat `added_damage` a single value `v` is rolled and the
   * modifier becomes `[v, round(v × ADDED_DAMAGE_MAX_FACTOR)]` (plan §8.5).
   */
  range: [number, number];
}

export interface AffixDefinition {
  id: string;
  /** At most one affix per group on an item. */
  group: string;
  category: AffixCategory;
  itemClasses: ItemClass[];
  requiredItemLevel: number;
  /** 1 = best. */
  tier: number;
  weight: number;
  modifiers: AffixModifierDefinition[];
}

export const ADDED_DAMAGE_MAX_FACTOR = 1.75;

/** Item level required for each tier; a 3-tier group uses T3–T1. */
export const TIER_ITEM_LEVELS: Record<number, number> = { 4: 1, 3: 12, 2: 25, 1: 38 };

const ARMOR_CLASSES: ItemClass[] = ["helmet", "body", "gloves", "boots"];
const DEFENSIVE_CLASSES: ItemClass[] = ["helmet", "body", "gloves", "boots", "amulet", "ring"];

interface GroupSpec {
  /** Affix id prefix; defaults to the group. Groups split by item class need distinct ids. */
  idPrefix?: string;
  group: string;
  category: AffixCategory;
  itemClasses: ItemClass[];
  modifier: Omit<AffixModifierDefinition, "range">;
  /** Best tier last: [T4, T3, T2, T1], or [T3, T2, T1] for 3-tier groups. */
  ranges: [number, number][];
  /** Overrides TIER_ITEM_LEVELS, keyed by tier. */
  itemLevels?: Record<number, number>;
}

function expandGroup(spec: GroupSpec): AffixDefinition[] {
  const tierCount = spec.ranges.length;
  return spec.ranges.map((range, i) => {
    const tier = tierCount - i;
    return {
      id: `${spec.idPrefix ?? spec.group}_t${tier}`,
      group: spec.group,
      category: spec.category,
      itemClasses: spec.itemClasses,
      requiredItemLevel: spec.itemLevels?.[tier] ?? TIER_ITEM_LEVELS[tier]!,
      tier,
      weight: 100,
      modifiers: [{ ...spec.modifier, range }],
    };
  });
}

const ADDED_ELEMENTAL_RANGES: Record<"fire" | "cold" | "lightning", [number, number][]> = {
  fire: [[2, 4], [5, 8], [9, 14], [15, 22]],
  cold: [[2, 4], [5, 8], [9, 14], [15, 22]],
  lightning: [[1, 5], [3, 10], [6, 17], [9, 27]],
};

const RESISTANCE_RANGES: [number, number][] = [[6, 11], [12, 17], [18, 23], [24, 30]];

const GROUPS: GroupSpec[] = [
  // --- prefixes (plan §8.6) ---
  {
    group: "local_phys_flat",
    category: "prefix",
    itemClasses: ["weapon"],
    modifier: { stat: "added_damage", kind: "flat", damageType: "physical", local: true },
    ranges: [[2, 4], [5, 9], [10, 16], [17, 26]],
  },
  {
    group: "local_phys_inc",
    category: "prefix",
    itemClasses: ["weapon"],
    modifier: { stat: "damage", kind: "increased", damageType: "physical", local: true },
    ranges: [[15, 24], [25, 39], [40, 59], [60, 79]],
  },
  // Added elemental damage is local on weapons and global elsewhere: same group, split by class.
  ...(["fire", "cold", "lightning"] as const).flatMap((type): GroupSpec[] => [
    {
      idPrefix: `added_${type}_weapon`,
      group: `added_${type}`,
      category: "prefix",
      itemClasses: ["weapon"],
      modifier: { stat: "added_damage", kind: "flat", damageType: type, local: true },
      ranges: ADDED_ELEMENTAL_RANGES[type],
    },
    {
      group: `added_${type}`,
      category: "prefix",
      itemClasses: ["gloves", "ring"],
      modifier: { stat: "added_damage", kind: "flat", damageType: type },
      ranges: ADDED_ELEMENTAL_RANGES[type],
    },
  ]),
  {
    group: "life",
    category: "prefix",
    itemClasses: DEFENSIVE_CLASSES,
    modifier: { stat: "life_max", kind: "flat" },
    ranges: [[10, 19], [20, 34], [35, 54], [55, 79]],
  },
  {
    group: "armor_flat",
    category: "prefix",
    itemClasses: ARMOR_CLASSES,
    modifier: { stat: "armor", kind: "flat", local: true },
    ranges: [[10, 24], [25, 59], [60, 119], [120, 199]],
  },
  {
    group: "armor_inc",
    category: "prefix",
    itemClasses: ARMOR_CLASSES,
    modifier: { stat: "armor", kind: "increased", local: true },
    ranges: [[15, 29], [30, 49], [50, 74], [75, 100]],
  },
  {
    group: "damage_inc",
    category: "prefix",
    itemClasses: ["amulet"],
    modifier: { stat: "damage", kind: "increased" },
    ranges: [[8, 12], [13, 18], [19, 25], [26, 32]],
  },

  // --- suffixes ---
  {
    group: "local_attack_speed",
    category: "suffix",
    itemClasses: ["weapon"],
    modifier: { stat: "attack_speed", kind: "increased", local: true },
    ranges: [[5, 7], [8, 11], [12, 15], [16, 20]],
  },
  {
    group: "attack_speed",
    category: "suffix",
    itemClasses: ["gloves", "ring"],
    modifier: { stat: "attack_speed", kind: "increased" },
    ranges: [[3, 5], [6, 8], [9, 11], [12, 14]],
  },
  {
    idPrefix: "crit_chance_weapon",
    group: "crit_chance",
    category: "suffix",
    itemClasses: ["weapon"],
    modifier: { stat: "crit_chance", kind: "increased", local: true },
    ranges: [[10, 19], [20, 29], [30, 39], [40, 49]],
  },
  {
    group: "crit_chance",
    category: "suffix",
    itemClasses: ["amulet", "ring"],
    modifier: { stat: "crit_chance", kind: "increased" },
    ranges: [[10, 19], [20, 29], [30, 39], [40, 49]],
  },
  {
    group: "crit_multi",
    category: "suffix",
    itemClasses: ["weapon", "amulet"],
    modifier: { stat: "crit_multiplier", kind: "flat" },
    ranges: [[8, 14], [15, 21], [22, 29], [30, 38]],
  },
  ...(["fire", "cold", "lightning"] as const).map(
    (type): GroupSpec => ({
      group: `res_${type}`,
      category: "suffix",
      itemClasses: DEFENSIVE_CLASSES,
      modifier: { stat: "resistance", kind: "flat", damageType: type },
      ranges: RESISTANCE_RANGES,
    }),
  ),
  {
    group: "res_chaos",
    category: "suffix",
    itemClasses: DEFENSIVE_CLASSES,
    modifier: { stat: "resistance", kind: "flat", damageType: "chaos" },
    ranges: [[5, 10], [11, 16], [17, 23]],
    itemLevels: { 3: 15 },
  },
  {
    group: "life_on_hit",
    category: "suffix",
    itemClasses: ["weapon", "gloves", "ring"],
    modifier: { stat: "life_on_hit", kind: "flat" },
    ranges: [[1, 2], [3, 4], [5, 6], [7, 9]],
  },
];

export const AFFIXES: Record<string, AffixDefinition> = Object.fromEntries(
  GROUPS.flatMap(expandGroup).map((affix) => [affix.id, affix]),
);

export function getAffixDefinition(id: string): AffixDefinition {
  const def = AFFIXES[id];
  if (def === undefined) {
    throw new Error(`unknown affix "${id}"`);
  }
  return def;
}
