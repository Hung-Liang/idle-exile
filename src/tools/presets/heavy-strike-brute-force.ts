import type { PassiveNodeId } from "../../data/passive-tree";
import type { SkillId } from "../../data/skills";
import type { SupportId } from "../../data/supports";

export interface BuildPreset {
  name: string;
  skill: SkillId;
  /** Support slots are filled from the front of this list with unlocked, compatible supports. */
  supportPriority: SupportId[];
  /** Allocation order; each node must be adjacent to the origin or an earlier node. */
  passiveOrder: PassiveNodeId[];
}

/** Physical-focused single-target build (plan §14.4 example preset). */
export const HEAVY_STRIKE_BRUTE_FORCE: BuildPreset = {
  name: "Heavy Strike + Brute Force",
  skill: "heavy_strike",
  supportPriority: ["brute_force", "focused_blow", "quickened"],
  passiveOrder: ["m1", "b1", "m2", "m3", "b3", "MN1", "m5", "BN1", "b7", "m4", "b2", "b6", "c1", "c3", "c2", "c4"],
};
