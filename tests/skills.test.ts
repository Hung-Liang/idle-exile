import { describe, expect, it } from "vitest";
import { SKILLS, type SkillId } from "../src/data/skills";
import { SUPPORTS, type SupportId } from "../src/data/supports";
import { advance, dispatch } from "../src/game/engine";
import { evaluateState } from "../src/game/evaluate";
import { supportIncompatibility, supportsAfterSkillSwitch } from "../src/game/skills";
import { attackIntervalMs, collectBuild, computeMaxLife } from "../src/game/stats";
import { createInitialState, type GameState } from "../src/game/state";
import { validateState } from "../src/game/validate";

function expectValid(state: GameState): void {
  const result = validateState(state);
  expect(result.ok ? [] : result.errors).toEqual([]);
}

function stateAtLevel(level: number): GameState {
  const state = createInitialState(1);
  state.character.level = level;
  state.character.supportIds = level >= 10 ? [null, null] : level >= 3 ? [null] : [];
  state.character.life = computeMaxLife(state);
  return state;
}

describe("supportIncompatibility", () => {
  it("follows the requires / excludes tags of plan §7.2", () => {
    expect(supportIncompatibility("heavy_strike", "focused_blow")).toBeNull();
    expect(supportIncompatibility("arc_pulse", "focused_blow")).toBe("requires single_target");
    for (const skill of Object.keys(SKILLS) as SkillId[]) {
      for (const support of Object.keys(SUPPORTS) as SupportId[]) {
        if (support !== "focused_blow") expect(supportIncompatibility(skill, support)).toBeNull();
      }
    }
  });

  it("reports excluded tags", () => {
    // Synthetic: a skill with both required tags and the excluded one.
    const original = SKILLS.arc_pulse.tags;
    SKILLS.arc_pulse.tags = ["attack", "single_target", "chain"];
    try {
      expect(supportIncompatibility("arc_pulse", "focused_blow")).toBe("incompatible with chain");
    } finally {
      SKILLS.arc_pulse.tags = original;
    }
  });

  it("supportsAfterSkillSwitch empties only incompatible slots", () => {
    expect(supportsAfterSkillSwitch(["focused_blow", "keen_edge"], "arc_pulse")).toEqual([null, "keen_edge"]);
    expect(supportsAfterSkillSwitch(["focused_blow", null], "rapid_assault")).toEqual(["focused_blow", null]);
  });
});

describe("set_active_skill", () => {
  it("rejects locked and unknown skills", () => {
    const state = stateAtLevel(7);
    expect(dispatch(state, { type: "set_active_skill", skillId: "arc_pulse" })).toEqual({ ok: false, reason: "skill_locked" });
    expect(dispatch(state, { type: "set_active_skill", skillId: "nope" as SkillId })).toEqual({ ok: false, reason: "unknown_skill" });
    expect(state.character.activeSkillId).toBe("heavy_strike");
  });

  it("switches and unequips incompatible supports with a log entry", () => {
    const state = stateAtLevel(22);
    state.character.supportIds = ["focused_blow", "keen_edge"];
    const result = dispatch(state, { type: "set_active_skill", skillId: "arc_pulse" });
    expect(result.ok).toBe(true);
    expect(state.character.activeSkillId).toBe("arc_pulse");
    expect(state.character.supportIds).toEqual([null, "keen_edge"]);
    expect(state.log.some((e) => e.text.includes("Unequipped Focused Blow"))).toBe(true);
    expect(result.ok && result.events).toContainEqual(
      expect.objectContaining({ type: "support_changed", slot: 0, supportId: null, removed: "focused_blow" }),
    );
    expectValid(state);
  });

  it("is a no-op when the skill is already active", () => {
    const state = stateAtLevel(5);
    expect(dispatch(state, { type: "set_active_skill", skillId: "heavy_strike" })).toEqual({ ok: true, events: [] });
    expect(state.log).toEqual([]);
  });

  it("takes effect on the next attack mid-encounter", () => {
    const state = stateAtLevel(8);
    state.encounter = {
      index: 0,
      isBoss: false,
      phase: "fighting",
      phaseEndsAt: 0,
      monsters: [{ defId: "brute", level: 1, life: 1e9, maxLife: 1e9, nextAttackAt: 1e9, alive: true }],
      player: { nextAttackAt: 1000 },
      stacks: {},
      levelGap: 0,
    };
    dispatch(state, { type: "set_active_skill", skillId: "rapid_assault" });
    expect(state.encounter.player.nextAttackAt).toBe(1000);
    advance(state, 1000);
    expect(state.encounter.player.nextAttackAt - 1000).toBe(attackIntervalMs(collectBuild(state), {}));
    expect(state.encounter.monsters[0]!.life).toBeLessThan(1e9);
    expectValid(state);
  });
});

describe("set_support", () => {
  it("rejects invalid slots, locked, incompatible and duplicate supports", () => {
    const state = stateAtLevel(10);
    expect(dispatch(state, { type: "set_support", slot: 2, supportId: "brute_force" })).toEqual({ ok: false, reason: "invalid_support_slot" });
    expect(dispatch(state, { type: "set_support", slot: -1, supportId: null })).toEqual({ ok: false, reason: "invalid_support_slot" });
    expect(dispatch(state, { type: "set_support", slot: 0, supportId: "ember_infusion" })).toEqual({ ok: false, reason: "support_locked" });
    expect(dispatch(state, { type: "set_support", slot: 0, supportId: "bogus" as SupportId })).toEqual({ ok: false, reason: "unknown_support" });
    expect(dispatch(state, { type: "set_support", slot: 0, supportId: "brute_force" }).ok).toBe(true);
    expect(dispatch(state, { type: "set_support", slot: 1, supportId: "brute_force" })).toEqual({ ok: false, reason: "support_duplicate" });

    state.character.level = 22;
    dispatch(state, { type: "set_active_skill", skillId: "arc_pulse" });
    expect(dispatch(state, { type: "set_support", slot: 1, supportId: "focused_blow" })).toEqual({ ok: false, reason: "support_incompatible" });
    expect(state.character.supportIds).toEqual(["brute_force", null]);
    expectValid(state);
  });

  it("replaces and clears a slot", () => {
    const state = stateAtLevel(10);
    dispatch(state, { type: "set_support", slot: 0, supportId: "brute_force" });
    const result = dispatch(state, { type: "set_support", slot: 0, supportId: "keen_edge" });
    expect(result.ok && result.events).toEqual([
      expect.objectContaining({ type: "support_changed", slot: 0, supportId: "keen_edge", removed: "brute_force" }),
    ]);
    expect(dispatch(state, { type: "set_support", slot: 0, supportId: null }).ok).toBe(true);
    expect(state.character.supportIds).toEqual([null, null]);
    expect(dispatch(state, { type: "set_support", slot: 0, supportId: null })).toEqual({ ok: true, events: [] });
  });

  it("changes the evaluated DPS as the support predicts", () => {
    const state = stateAtLevel(3);
    const before = evaluateState(state).singleTargetDps;
    dispatch(state, { type: "set_support", slot: 0, supportId: "brute_force" });
    expect(evaluateState(state).singleTargetDps / before).toBeCloseTo(1.25, 1);
  });
});
