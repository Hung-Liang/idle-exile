import type { BuildPreset } from "./index";

/** Defensive build: fast hits with life on hit and the Bastion branch. Heavy Strike until Rapid Assault unlocks. */
export const RAPID_ASSAULT_BASTION: BuildPreset = {
  id: "rapid-assault",
  name: "Rapid Assault + Bloodthirst (Bastion)",
  skillPriority: ["rapid_assault", "heavy_strike"],
  supportPriority: ["brute_force", "bloodthirst", "quickened"],
  passiveOrder: ["b1", "b3", "BN1", "b2", "b6", "b7", "m1", "b4", "b5", "BN2", "c1", "c3", "CN1", "m2", "m3", "m5"],
};
