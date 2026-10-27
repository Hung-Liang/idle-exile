import type { BuildPreset } from "./index";

/** Physical-focused single-target build (plan §14.4 example preset). */
export const HEAVY_STRIKE_BRUTE_FORCE: BuildPreset = {
  id: "heavy-strike",
  name: "Heavy Strike + Brute Force",
  skillPriority: ["heavy_strike"],
  supportPriority: ["brute_force", "focused_blow", "quickened"],
  passiveOrder: ["m1", "b1", "m2", "m3", "b3", "MN1", "m5", "BN1", "b7", "m4", "b2", "b6", "c1", "c3", "c2", "c4"],
};
