import type { PassiveNodeId } from "../../data/passive-tree";
import { SKILLS, type SkillId } from "../../data/skills";
import { SUPPORTS, type SupportId } from "../../data/supports";
import { dispatch, type PlayerAction } from "../../game/engine";
import { unspentPassivePoints } from "../../game/passive-tree";
import { supportIncompatibility } from "../../game/skills";
import type { GameState } from "../../game/state";
import { ARC_PULSE_KEEN_EDGE } from "./arc-pulse-keen-edge";
import { HEAVY_STRIKE_BRUTE_FORCE } from "./heavy-strike-brute-force";
import { RAPID_ASSAULT_BASTION } from "./rapid-assault-bastion";

export interface BuildPreset {
  /** CLI name for `--preset=`. */
  id: string;
  name: string;
  /** The first unlocked skill in this list is used. */
  skillPriority: SkillId[];
  /** Support slots are filled from the front of this list with unlocked, compatible supports. */
  supportPriority: SupportId[];
  /** Allocation order; each node must be adjacent to the origin or an earlier node. */
  passiveOrder: PassiveNodeId[];
}

export const PRESETS: readonly BuildPreset[] = [HEAVY_STRIKE_BRUTE_FORCE, ARC_PULSE_KEEN_EDGE, RAPID_ASSAULT_BASTION];

function run(state: GameState, action: PlayerAction): void {
  const result = dispatch(state, action);
  if (!result.ok) {
    throw new Error(`applyPreset: ${action.type} rejected (${result.reason})`);
  }
}

/**
 * Selects the preset's skill, fills support slots and allocates passives up to the points the
 * current level grants. Tool-only, but every change goes through `dispatch` like player actions.
 * Passives already allocated must be a prefix of `passiveOrder`.
 */
export function applyPreset(state: GameState, preset: BuildPreset): void {
  const { character } = state;
  const skillId = preset.skillPriority.find((id) => SKILLS[id].unlockLevel <= character.level);
  if (skillId === undefined) {
    throw new Error(`preset "${preset.name}" has no skill unlocked at level ${character.level}`);
  }
  run(state, { type: "set_active_skill", skillId });

  const supports = preset.supportPriority.filter(
    (id) => SUPPORTS[id].unlockLevel <= character.level && supportIncompatibility(skillId, id) === null,
  );
  const desired = character.supportIds.map((_, i) => supports[i] ?? null);
  if (desired.some((id, i) => id !== character.supportIds[i])) {
    // Clear first so a support moving between slots is never rejected as a duplicate.
    character.supportIds.forEach((_, slot) => run(state, { type: "set_support", slot, supportId: null }));
    desired.forEach((supportId, slot) => {
      if (supportId !== null) run(state, { type: "set_support", slot, supportId });
    });
  }

  for (const nodeId of preset.passiveOrder) {
    if (unspentPassivePoints(state) <= 0) break;
    if (!character.allocatedPassives.includes(nodeId)) run(state, { type: "allocate_passive", nodeId });
  }
}
