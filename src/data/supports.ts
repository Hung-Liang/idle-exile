import type { ModifierSpec, Tag } from "../game/modifiers";

export type SupportId =
  | "brute_force"
  | "quickened"
  | "keen_edge"
  | "ember_infusion"
  | "bloodthirst"
  | "focused_blow"
  | "concentrated_power"
  | "swift_casting"
  | "rupture"
  | "searing_touch"
  | "frostbite"
  | "overcharge"
  | "malice";

export interface SupportDefinition {
  id: SupportId;
  name: string;
  unlockLevel: number;
  /** The active skill must have all of these tags. */
  requiresTags: Tag[];
  /** The active skill must have none of these tags. */
  excludesTags: Tag[];
  modifiers: ModifierSpec[];
}

export const SUPPORTS: Record<SupportId, SupportDefinition> = {
  brute_force: {
    id: "brute_force",
    name: "Brute Force",
    unlockLevel: 3,
    requiresTags: ["attack"],
    excludesTags: [],
    modifiers: [{ stat: "damage", kind: "more", value: 25 }],
  },
  quickened: {
    id: "quickened",
    name: "Quickened",
    unlockLevel: 6,
    requiresTags: ["attack"],
    excludesTags: [],
    modifiers: [
      { stat: "attack_speed", kind: "more", value: 20 },
      { stat: "damage", kind: "more", value: -10 },
    ],
  },
  keen_edge: {
    id: "keen_edge",
    name: "Keen Edge",
    unlockLevel: 10,
    requiresTags: ["attack"],
    excludesTags: [],
    modifiers: [{ stat: "crit_chance", kind: "increased", value: 80 }],
  },
  ember_infusion: {
    id: "ember_infusion",
    name: "Ember Infusion",
    unlockLevel: 14,
    requiresTags: ["attack"],
    excludesTags: [],
    modifiers: [{ stat: "gain_as_extra", kind: "flat", damageType: "fire", value: 20 }],
  },
  bloodthirst: {
    id: "bloodthirst",
    name: "Bloodthirst",
    unlockLevel: 18,
    requiresTags: ["attack"],
    excludesTags: [],
    modifiers: [{ stat: "life_on_hit", kind: "flat", value: 4 }],
  },
  focused_blow: {
    id: "focused_blow",
    name: "Focused Blow",
    unlockLevel: 22,
    requiresTags: ["attack", "single_target"],
    excludesTags: ["chain"],
    modifiers: [{ stat: "damage", kind: "more", value: 35 }],
  },
  concentrated_power: {
    id: "concentrated_power",
    name: "Concentrated Power",
    unlockLevel: 3,
    requiresTags: ["spell"],
    excludesTags: [],
    modifiers: [{ stat: "damage", kind: "more", value: 25 }],
  },
  swift_casting: {
    id: "swift_casting",
    name: "Swift Casting",
    unlockLevel: 7,
    requiresTags: ["spell"],
    excludesTags: [],
    modifiers: [
      { stat: "cast_speed", kind: "more", value: 20 },
      { stat: "damage", kind: "more", value: -10 },
    ],
  },
  rupture: {
    id: "rupture",
    name: "Rupture",
    unlockLevel: 9,
    requiresTags: ["attack"],
    excludesTags: [],
    modifiers: [
      { stat: "ailment_chance", kind: "flat", damageType: "physical", value: 30 },
      { stat: "ailment_effect", kind: "increased", damageType: "physical", value: 20 },
    ],
  },
  searing_touch: {
    id: "searing_touch",
    name: "Searing Touch",
    unlockLevel: 12,
    requiresTags: [],
    excludesTags: [],
    modifiers: [
      { stat: "ailment_chance", kind: "flat", damageType: "fire", value: 30 },
      { stat: "ailment_effect", kind: "increased", damageType: "fire", value: 20 },
    ],
  },
  frostbite: {
    id: "frostbite",
    name: "Frostbite",
    unlockLevel: 15,
    requiresTags: [],
    excludesTags: [],
    modifiers: [
      { stat: "ailment_chance", kind: "flat", damageType: "cold", value: 30 },
      { stat: "ailment_effect", kind: "increased", damageType: "cold", value: 25 },
    ],
  },
  overcharge: {
    id: "overcharge",
    name: "Overcharge",
    unlockLevel: 18,
    requiresTags: [],
    excludesTags: [],
    modifiers: [
      { stat: "ailment_chance", kind: "flat", damageType: "lightning", value: 30 },
      { stat: "ailment_effect", kind: "increased", damageType: "lightning", value: 25 },
    ],
  },
  malice: {
    id: "malice",
    name: "Malice",
    unlockLevel: 24,
    requiresTags: [],
    excludesTags: [],
    modifiers: [
      { stat: "ailment_effect", kind: "increased", value: 40 },
      { stat: "ailment_duration", kind: "increased", value: 20 },
    ],
  },
};
