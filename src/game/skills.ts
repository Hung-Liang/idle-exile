import { SKILLS, type SkillId } from "../data/skills";
import { SUPPORTS, type SupportId } from "../data/supports";
import type { GameEvent } from "./events";
import { clampLifeToMax } from "./stats";
import { appendLog, type GameState } from "./state";

export type SkillError =
  | "unknown_skill"
  | "skill_locked"
  | "unknown_support"
  | "support_locked"
  | "support_incompatible"
  | "support_duplicate"
  | "invalid_support_slot";

/** Why `supportId` cannot support `skillId` (plan §7.2), or null when it can. */
export function supportIncompatibility(skillId: SkillId, supportId: SupportId): string | null {
  const tags = SKILLS[skillId].tags;
  const support = SUPPORTS[supportId];
  const missing = support.requiresTags.filter((tag) => !tags.includes(tag));
  if (missing.length > 0) return `requires ${missing.join(", ")}`;
  const excluded = support.excludesTags.filter((tag) => tags.includes(tag));
  if (excluded.length > 0) return `incompatible with ${excluded.join(", ")}`;
  return null;
}

/** The support slots after switching to `skillId`: incompatible supports become empty. */
export function supportsAfterSkillSwitch(supportIds: readonly (SupportId | null)[], skillId: SkillId): (SupportId | null)[] {
  return supportIds.map((id) => (id !== null && supportIncompatibility(skillId, id) !== null ? null : id));
}

/** Takes effect on the next attack. Incompatible supports are unequipped with a log entry. */
export function setActiveSkill(state: GameState, skillId: SkillId, events: GameEvent[]): SkillError | null {
  if (!Object.hasOwn(SKILLS, skillId)) return "unknown_skill";
  const character = state.character;
  if (character.level < SKILLS[skillId].unlockLevel) return "skill_locked";
  if (character.activeSkillId === skillId) return null;

  character.activeSkillId = skillId;
  appendLog(state, "info", `Switched skill to ${SKILLS[skillId].name}.`);
  events.push({ type: "skill_changed", timeMs: state.simTimeMs, skillId });

  const next = supportsAfterSkillSwitch(character.supportIds, skillId);
  next.forEach((id, slot) => {
    const removed = character.supportIds[slot];
    if (id === null && removed !== null && removed !== undefined) {
      appendLog(state, "info", `Unequipped ${SUPPORTS[removed].name}: ${supportIncompatibility(skillId, removed)}.`);
      events.push({ type: "support_changed", timeMs: state.simTimeMs, slot, supportId: null, removed });
    }
  });
  character.supportIds = next;
  clampLifeToMax(state);
  return null;
}

/** Puts `supportId` in `slot`, or empties the slot when null. A support may occupy one slot only. */
export function setSupport(state: GameState, slot: number, supportId: SupportId | null, events: GameEvent[]): SkillError | null {
  const character = state.character;
  if (!Number.isInteger(slot) || slot < 0 || slot >= character.supportIds.length) return "invalid_support_slot";
  if (supportId !== null) {
    if (!Object.hasOwn(SUPPORTS, supportId)) return "unknown_support";
    if (character.level < SUPPORTS[supportId].unlockLevel) return "support_locked";
    if (supportIncompatibility(character.activeSkillId, supportId) !== null) return "support_incompatible";
    if (character.supportIds.some((id, i) => i !== slot && id === supportId)) return "support_duplicate";
  }
  const removed = character.supportIds[slot]!;
  if (removed === supportId) return null;

  character.supportIds[slot] = supportId;
  clampLifeToMax(state);
  appendLog(
    state,
    "info",
    supportId === null ? `Removed ${SUPPORTS[removed!].name}.` : `Socketed ${SUPPORTS[supportId].name} in support slot ${slot + 1}.`,
  );
  events.push({ type: "support_changed", timeMs: state.simTimeMs, slot, supportId, removed });
  return null;
}
