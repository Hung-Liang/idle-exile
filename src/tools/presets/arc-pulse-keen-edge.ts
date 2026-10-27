import type { BuildPreset } from "./index";

/** Lightning chain build for packs (plan §14.4 example preset). Heavy Strike until Arc Pulse unlocks. */
export const ARC_PULSE_KEEN_EDGE: BuildPreset = {
  id: "arc-pulse",
  name: "Arc Pulse + Keen Edge",
  skillPriority: ["arc_pulse", "heavy_strike"],
  supportPriority: ["keen_edge", "brute_force", "quickened"],
  passiveOrder: ["c1", "c3", "b1", "b3", "c5", "CN2", "c2", "c4", "c6", "CN1", "b4", "b5", "BN2", "BN1", "m1", "b7"],
};
