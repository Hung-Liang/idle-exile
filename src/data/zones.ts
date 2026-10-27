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

export const ZONES: Record<ZoneId, ZoneDefinition> = {
  ashen_outskirts: { id: "ashen_outskirts", name: "Ashen Outskirts", monsterLevel: 1 },
  drowned_fields: { id: "drowned_fields", name: "Drowned Fields", monsterLevel: 4 },
  hollow_pines: { id: "hollow_pines", name: "Hollow Pines", monsterLevel: 8 },
  saltworks: { id: "saltworks", name: "Saltworks", monsterLevel: 12 },
  cinder_quarry: { id: "cinder_quarry", name: "Cinder Quarry", monsterLevel: 17 },
  weeping_cistern: { id: "weeping_cistern", name: "Weeping Cistern", monsterLevel: 23 },
  glass_ridge: { id: "glass_ridge", name: "Glass Ridge", monsterLevel: 30 },
  spire_of_ruin: { id: "spire_of_ruin", name: "Spire of Ruin", monsterLevel: 37 },
};
