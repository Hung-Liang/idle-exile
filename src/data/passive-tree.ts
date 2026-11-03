import type { ModifierSpec } from "../game/modifiers";

export type PassiveNodeId =
  | "origin"
  | "m1" | "m2" | "m3" | "m4" | "m5" | "MN1" | "KS1"
  | "c1" | "c2" | "c3" | "c4" | "c5" | "c6" | "CN1" | "CN2"
  | "b1" | "b2" | "b3" | "b4" | "b5" | "b6" | "b7" | "b8" | "BN1" | "BN2"
  | "a1" | "a2" | "a3" | "a4" | "AN1";

export const PASSIVE_ROOT: PassiveNodeId = "origin";

export interface PassiveNodeDefinition {
  id: PassiveNodeId;
  name: string;
  kind: "root" | "minor" | "notable" | "keystone";
  modifiers: ModifierSpec[];
}

/** Authoritative topology (undirected). Any rendered layout is illustrative only. */
export const PASSIVE_EDGES: [PassiveNodeId, PassiveNodeId][] = [
  // roots
  ["origin", "m1"], ["origin", "c1"], ["origin", "b1"], ["origin", "a1"],
  // Might
  ["m1", "m2"], ["m2", "m3"], ["m2", "m4"],
  ["m3", "MN1"], ["m3", "m5"], ["m4", "KS1"],
  // Celerity
  ["c1", "c2"], ["c1", "c3"], ["c2", "c4"], ["c4", "c6"],
  ["c3", "CN1"], ["c3", "c5"], ["c5", "CN2"],
  // Bastion
  ["b1", "b2"], ["b1", "b3"], ["b2", "b6"],
  ["b3", "b4"], ["b3", "BN1"], ["b4", "b5"], ["b5", "BN2"],
  ["b4", "b8"], // v0.7.0
  // Arcana (v0.6.0)
  ["a1", "a2"], ["a1", "a3"], ["a2", "a4"], ["a3", "AN1"],
  // cross-links
  ["m1", "b7"], ["b6", "b7"],
  ["m4", "c4"],
  ["a4", "c5"],
];

export const PASSIVE_NODES: Record<PassiveNodeId, PassiveNodeDefinition> = {
  origin: { id: "origin", name: "Origin", kind: "root", modifiers: [] },

  m1: { id: "m1", name: "Honed Strikes", kind: "minor", modifiers: [{ stat: "damage", kind: "increased", damageType: "physical", value: 10 }] },
  m2: { id: "m2", name: "Weighted Blows", kind: "minor", modifiers: [{ stat: "damage", kind: "increased", value: 10 }] },
  m3: { id: "m3", name: "Brutal Edge", kind: "minor", modifiers: [{ stat: "damage", kind: "increased", damageType: "physical", value: 12 }] },
  m4: { id: "m4", name: "Heavy Hand", kind: "minor", modifiers: [{ stat: "crit_multiplier", kind: "flat", value: 15 }] },
  m5: { id: "m5", name: "Sharpened", kind: "minor", modifiers: [{ stat: "damage", kind: "increased", value: 10 }] },
  MN1: {
    id: "MN1",
    name: "Executioner",
    kind: "notable",
    modifiers: [{ stat: "damage", kind: "more", value: 40, condition: { kind: "enemy_life_below_pct", value: 30 } }],
  },
  KS1: {
    id: "KS1",
    name: "Glass Edge",
    kind: "keystone",
    modifiers: [
      { stat: "damage", kind: "more", value: 30 },
      { stat: "life_max", kind: "more", value: -30 },
    ],
  },

  c1: { id: "c1", name: "Quick Hands", kind: "minor", modifiers: [{ stat: "attack_speed", kind: "increased", value: 6 }] },
  c2: { id: "c2", name: "Keen Eye", kind: "minor", modifiers: [{ stat: "crit_chance", kind: "increased", value: 20 }] },
  c3: { id: "c3", name: "Flurry", kind: "minor", modifiers: [{ stat: "attack_speed", kind: "increased", value: 6 }] },
  c4: { id: "c4", name: "Precise", kind: "minor", modifiers: [{ stat: "crit_chance", kind: "increased", value: 25 }] },
  c5: { id: "c5", name: "Static Charge", kind: "minor", modifiers: [{ stat: "damage", kind: "increased", damageType: "lightning", value: 15 }] },
  c6: { id: "c6", name: "Deadly", kind: "minor", modifiers: [{ stat: "crit_multiplier", kind: "flat", value: 20 }] },
  CN1: {
    id: "CN1",
    name: "Momentum",
    kind: "notable",
    modifiers: [{ stat: "attack_speed", kind: "increased", value: 2, perStack: "momentum" }],
  },
  CN2: {
    id: "CN2",
    name: "Stormheart",
    kind: "notable",
    modifiers: [
      { stat: "damage", kind: "increased", damageType: "lightning", value: 20 },
      { stat: "penetration", kind: "flat", damageType: "lightning", value: 10 },
    ],
  },

  b1: { id: "b1", name: "Sturdy", kind: "minor", modifiers: [{ stat: "life_max", kind: "flat", value: 20 }] },
  b2: { id: "b2", name: "Hardened", kind: "minor", modifiers: [{ stat: "armor", kind: "increased", value: 15 }] },
  b3: { id: "b3", name: "Vital", kind: "minor", modifiers: [{ stat: "life_max", kind: "increased", value: 8 }] },
  b4: {
    id: "b4",
    name: "Ember Ward",
    kind: "minor",
    modifiers: [
      { stat: "resistance", kind: "flat", damageType: "fire", value: 10 },
      { stat: "resistance", kind: "flat", damageType: "cold", value: 10 },
    ],
  },
  b5: {
    id: "b5",
    name: "Grounded",
    kind: "minor",
    modifiers: [
      { stat: "resistance", kind: "flat", damageType: "lightning", value: 10 },
      { stat: "resistance", kind: "flat", damageType: "chaos", value: 7 },
    ],
  },
  b6: { id: "b6", name: "Plated", kind: "minor", modifiers: [{ stat: "armor", kind: "increased", value: 20 }] },
  b7: { id: "b7", name: "Bloodied", kind: "minor", modifiers: [{ stat: "life_on_hit", kind: "flat", value: 3 }] },
  b8: { id: "b8", name: "Steadfast", kind: "minor", modifiers: [{ stat: "ailment_avoidance", kind: "flat", value: 25 }] },
  BN1: { id: "BN1", name: "Unbroken", kind: "notable", modifiers: [{ stat: "life_recovery_on_clear", kind: "flat", value: 15 }] },
  BN2: {
    id: "BN2",
    name: "Bulwark",
    kind: "notable",
    modifiers: [
      { stat: "resistance_max", kind: "flat", damageType: "fire", value: 3 },
      { stat: "resistance_max", kind: "flat", damageType: "cold", value: 3 },
      { stat: "resistance_max", kind: "flat", damageType: "lightning", value: 3 },
    ],
  },

  a1: { id: "a1", name: "Spellweave", kind: "minor", modifiers: [{ stat: "damage", kind: "increased", tags: ["spell"], value: 12 }] },
  a2: { id: "a2", name: "Quick Incantation", kind: "minor", modifiers: [{ stat: "cast_speed", kind: "increased", value: 6 }] },
  a3: {
    id: "a3",
    name: "Affliction",
    kind: "minor",
    modifiers: [
      { stat: "ailment_chance", kind: "flat", damageType: "fire", value: 8 },
      { stat: "ailment_chance", kind: "flat", damageType: "cold", value: 8 },
      { stat: "ailment_chance", kind: "flat", damageType: "lightning", value: 8 },
    ],
  },
  a4: { id: "a4", name: "Arcane Flow", kind: "minor", modifiers: [{ stat: "damage", kind: "increased", tags: ["spell"], value: 12 }] },
  AN1: {
    id: "AN1",
    name: "Malediction",
    kind: "notable",
    modifiers: [
      { stat: "ailment_effect", kind: "increased", value: 30 },
      { stat: "ailment_duration", kind: "increased", value: 20 },
    ],
  },
};
