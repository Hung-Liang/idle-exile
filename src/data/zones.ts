import type { BossId, MonsterId } from "./monsters";

export type ZoneId =
  | "ashen_outskirts"
  | "drowned_fields"
  | "hollow_pines"
  | "saltworks"
  | "cinder_quarry"
  | "weeping_cistern"
  | "glass_ridge"
  | "spire_of_ruin";

export interface ZoneDefinition {
  id: ZoneId;
  name: string;
  monsterLevel: number;
  /** Equal spawn weights. */
  monsterPool: MonsterId[];
  bossId: BossId;
}

/** Campaign order is the order of `ZONE_ORDER`. */
export const ZONE_ORDER: readonly ZoneId[] = [
  "ashen_outskirts",
  "drowned_fields",
  "hollow_pines",
  "saltworks",
  "cinder_quarry",
  "weeping_cistern",
  "glass_ridge",
  "spire_of_ruin",
];

const ALL_ARCHETYPES: MonsterId[] = ["brute", "skirmisher", "ember_wisp", "frost_husk", "storm_shade", "blighted"];

export const ZONES: Record<ZoneId, ZoneDefinition> = {
  ashen_outskirts: {
    id: "ashen_outskirts",
    name: "Ashen Outskirts",
    monsterLevel: 1,
    monsterPool: ["brute", "skirmisher"],
    bossId: "gatewarden",
  },
  drowned_fields: {
    id: "drowned_fields",
    name: "Drowned Fields",
    monsterLevel: 4,
    monsterPool: ["brute", "skirmisher", "ember_wisp"],
    bossId: "mire_matron",
  },
  hollow_pines: {
    id: "hollow_pines",
    name: "Hollow Pines",
    monsterLevel: 8,
    monsterPool: ["brute", "skirmisher", "ember_wisp", "frost_husk"],
    bossId: "rimebound",
  },
  saltworks: {
    id: "saltworks",
    name: "Saltworks",
    monsterLevel: 12,
    monsterPool: ["brute", "skirmisher", "ember_wisp", "frost_husk", "storm_shade"],
    bossId: "foreman_vael",
  },
  cinder_quarry: {
    id: "cinder_quarry",
    name: "Cinder Quarry",
    monsterLevel: 17,
    monsterPool: ALL_ARCHETYPES,
    bossId: "slag_tyrant",
  },
  weeping_cistern: {
    id: "weeping_cistern",
    name: "Weeping Cistern",
    monsterLevel: 23,
    monsterPool: ALL_ARCHETYPES,
    bossId: "mother_of_silt",
  },
  glass_ridge: { id: "glass_ridge", name: "Glass Ridge", monsterLevel: 30, monsterPool: ALL_ARCHETYPES, bossId: "prism_knight" },
  spire_of_ruin: {
    id: "spire_of_ruin",
    name: "Spire of Ruin",
    monsterLevel: 37,
    monsterPool: ALL_ARCHETYPES,
    bossId: "hollow_regent",
  },
};
