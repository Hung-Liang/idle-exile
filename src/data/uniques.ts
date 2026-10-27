import type { AffixDefinition, AffixModifierDefinition } from "./affixes";
import { ITEM_BASES, type ItemBaseId } from "./item-bases";

export type UniqueId =
  | "pilgrims_treads"
  | "emberbrand"
  | "stormcallers_loop"
  | "heart_of_the_mire"
  | "leechgrip"
  | "widowmaker"
  | "patient_blade"
  | "glasswork_band"
  | "prism_talisman"
  | "bastions_oath"
  | "sundered_crown";

export interface UniqueDefinition {
  id: UniqueId;
  name: string;
  baseId: ItemBaseId;
  /** Minimum item level at which it can drop; the base's required level when omitted. */
  dropLevel?: number;
  weight: number;
  /** Fixed lines, each rolled within its range. A fixed value uses `[v, v]`. */
  lines: AffixModifierDefinition[];
}

// Plan §8.9. Uniques use the existing stat pipeline; trade-offs come from "less" and negative lines.
export const UNIQUES: Record<UniqueId, UniqueDefinition> = {
  pilgrims_treads: {
    id: "pilgrims_treads",
    name: "Pilgrim's Treads",
    baseId: "worn_boots",
    weight: 100,
    lines: [
      { stat: "life_max", kind: "flat", range: [20, 30] },
      // No damage type: applies to every resistance, chaos included.
      { stat: "resistance", kind: "flat", range: [8, 12] },
      { stat: "life_recovery_on_clear", kind: "flat", range: [3, 5] },
    ],
  },
  emberbrand: {
    id: "emberbrand",
    name: "Emberbrand",
    baseId: "tempered_sabre",
    weight: 100,
    lines: [
      { stat: "damage", kind: "increased", damageType: "physical", local: true, range: [40, 60] },
      { stat: "conversion", kind: "flat", damageType: "fire", range: [50, 50] },
      { stat: "damage", kind: "increased", damageType: "fire", range: [20, 30] },
    ],
  },
  stormcallers_loop: {
    id: "stormcallers_loop",
    name: "Stormcaller's Loop",
    baseId: "copper_loop",
    weight: 100,
    lines: [
      { stat: "added_damage", kind: "flat", damageType: "lightning", range: [6, 10] },
      { stat: "damage", kind: "increased", damageType: "lightning", range: [20, 30] },
      { stat: "resistance", kind: "flat", damageType: "lightning", range: [-20, -20] },
    ],
  },
  heart_of_the_mire: {
    id: "heart_of_the_mire",
    name: "Heart of the Mire",
    baseId: "chain_hauberk",
    weight: 100,
    lines: [
      { stat: "life_max", kind: "flat", range: [60, 90] },
      { stat: "life_recovery_on_clear", kind: "flat", range: [5, 8] },
      { stat: "attack_speed", kind: "increased", range: [-10, -10] },
    ],
  },
  leechgrip: {
    id: "leechgrip",
    name: "Leechgrip",
    baseId: "riveted_gloves",
    weight: 100,
    lines: [
      { stat: "life_on_hit", kind: "flat", range: [6, 10] },
      { stat: "attack_speed", kind: "increased", range: [8, 12] },
      { stat: "life_max", kind: "flat", range: [-30, -30] },
    ],
  },
  widowmaker: {
    id: "widowmaker",
    name: "Widowmaker",
    baseId: "siege_mace",
    weight: 80,
    lines: [
      { stat: "added_damage", kind: "flat", damageType: "physical", local: true, range: [15, 25] },
      { stat: "crit_chance", kind: "increased", local: true, range: [50, 70] },
      { stat: "crit_multiplier", kind: "flat", range: [30, 40] },
      { stat: "attack_speed", kind: "more", range: [-15, -15] },
    ],
  },
  patient_blade: {
    id: "patient_blade",
    name: "The Patient Blade",
    baseId: "duelist_rapier",
    weight: 80,
    lines: [
      { stat: "damage", kind: "increased", damageType: "physical", local: true, range: [30, 50] },
      { stat: "attack_speed", kind: "increased", local: true, range: [10, 15] },
      { stat: "damage", kind: "more", condition: { kind: "enemy_life_below_pct", value: 35 }, range: [40, 40] },
    ],
  },
  glasswork_band: {
    id: "glasswork_band",
    name: "Glasswork Band",
    baseId: "silver_signet",
    weight: 60,
    lines: [
      { stat: "damage", kind: "more", range: [15, 20] },
      { stat: "life_max", kind: "more", range: [-15, -15] },
    ],
  },
  prism_talisman: {
    id: "prism_talisman",
    name: "Prism Talisman",
    baseId: "amber_locket",
    weight: 60,
    lines: [
      { stat: "gain_as_extra", kind: "flat", damageType: "fire", range: [8, 12] },
      { stat: "gain_as_extra", kind: "flat", damageType: "cold", range: [8, 12] },
      { stat: "gain_as_extra", kind: "flat", damageType: "lightning", range: [8, 12] },
    ],
  },
  bastions_oath: {
    id: "bastions_oath",
    name: "Bastion's Oath",
    baseId: "bastion_plate",
    weight: 50,
    lines: [
      { stat: "armor", kind: "increased", local: true, range: [100, 150] },
      { stat: "resistance_max", kind: "flat", range: [2, 4] },
      { stat: "damage", kind: "more", range: [-10, -10] },
    ],
  },
  sundered_crown: {
    id: "sundered_crown",
    name: "The Sundered Crown",
    baseId: "warlord_crown",
    weight: 50,
    lines: [
      { stat: "penetration", kind: "flat", tags: ["elemental"], range: [10, 15] },
      { stat: "crit_chance", kind: "increased", range: [30, 50] },
      { stat: "life_max", kind: "flat", range: [40, 60] },
    ],
  },
};

export function uniqueDropLevel(def: UniqueDefinition): number {
  return def.dropLevel ?? ITEM_BASES[def.baseId].requiredLevel;
}

/** Affix id of a unique's `index`-th line. */
export function uniqueAffixId(id: UniqueId, index: number): string {
  return `${id}_${index}`;
}

/**
 * Unique lines as affix definitions, so rolled values, Temper and display reuse the affix code.
 * They are kept out of `AFFIXES`, so random generation never draws them.
 */
export const UNIQUE_AFFIXES: Record<string, AffixDefinition> = Object.fromEntries(
  Object.values(UNIQUES).flatMap((def) =>
    def.lines.map((line, i): [string, AffixDefinition] => {
      const id = uniqueAffixId(def.id, i);
      return [
        id,
        {
          id,
          group: id,
          category: "prefix",
          itemClasses: [ITEM_BASES[def.baseId].itemClass],
          requiredItemLevel: 1,
          tier: 0,
          weight: 0,
          modifiers: [line],
        },
      ];
    }),
  ),
);
