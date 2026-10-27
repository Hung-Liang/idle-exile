import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { PASSIVE_NODES, PASSIVE_ROOT, type PassiveNodeId } from "../src/data/passive-tree";
import { dispatch } from "../src/game/engine";
import { passivePoints, unspentPassivePoints } from "../src/game/passive-tree";
import { computeMaxLife } from "../src/game/stats";
import { createInitialState, type GameState } from "../src/game/state";
import { validateState } from "../src/game/validate";

const NODE_IDS = (Object.keys(PASSIVE_NODES) as PassiveNodeId[]).filter((id) => id !== PASSIVE_ROOT);

function stateAtLevel(level: number): GameState {
  const state = createInitialState(1);
  state.character.level = level;
  state.character.supportIds = level >= 10 ? [null, null] : level >= 3 ? [null] : [];
  state.character.life = computeMaxLife(state);
  return state;
}

describe("passive points", () => {
  it("grants one point every 3 levels, 16 at level 50", () => {
    expect(passivePoints(1)).toBe(0);
    expect(passivePoints(3)).toBe(1);
    expect(passivePoints(5)).toBe(1);
    expect(passivePoints(48)).toBe(16);
    expect(passivePoints(50)).toBe(16);
  });
});

describe("allocate_passive", () => {
  it("allocates a node adjacent to the origin and spends a point", () => {
    const state = stateAtLevel(6);
    const result = dispatch(state, { type: "allocate_passive", nodeId: "m1" });
    expect(result).toEqual({ ok: true, events: [{ type: "passive_allocated", timeMs: 0, nodeId: "m1" }] });
    expect(state.character.allocatedPassives).toEqual(["m1"]);
    expect(unspentPassivePoints(state)).toBe(1);
  });

  it("rejects non-adjacent, duplicate, root and unaffordable nodes", () => {
    const state = stateAtLevel(3);
    expect(dispatch(state, { type: "allocate_passive", nodeId: "m2" })).toEqual({ ok: false, reason: "passive_not_adjacent" });
    expect(dispatch(state, { type: "allocate_passive", nodeId: "origin" })).toEqual({ ok: false, reason: "unknown_passive" });
    expect(dispatch(state, { type: "allocate_passive", nodeId: "zz" as PassiveNodeId })).toEqual({ ok: false, reason: "unknown_passive" });
    dispatch(state, { type: "allocate_passive", nodeId: "m1" });
    expect(dispatch(state, { type: "allocate_passive", nodeId: "m1" })).toEqual({ ok: false, reason: "passive_already_allocated" });
    expect(dispatch(state, { type: "allocate_passive", nodeId: "m2" })).toEqual({ ok: false, reason: "no_passive_points" });
  });

  it("accepts cross-links: b7 is reachable from m1", () => {
    const state = stateAtLevel(6);
    dispatch(state, { type: "allocate_passive", nodeId: "m1" });
    expect(dispatch(state, { type: "allocate_passive", nodeId: "b7" }).ok).toBe(true);
  });

  it("clamps current life when Glass Edge lowers max life", () => {
    const state = stateAtLevel(15);
    for (const id of ["m1", "m2", "m4", "KS1"] as const) dispatch(state, { type: "allocate_passive", nodeId: id });
    expect(state.character.life).toBe(computeMaxLife(state));
    expect(state.character.life).toBeLessThan(computeMaxLife(stateAtLevel(15)));
  });

  it("any sequence of actions keeps the state valid and within the point budget", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.array(fc.oneof(fc.constantFrom(...NODE_IDS), fc.constant("reset" as const)), { maxLength: 40 }),
        (level, actions) => {
          const state = stateAtLevel(level);
          for (const action of actions) {
            dispatch(state, action === "reset" ? { type: "reset_passives" } : { type: "allocate_passive", nodeId: action });
          }
          expect(state.character.allocatedPassives.length).toBeLessThanOrEqual(passivePoints(level));
          expect(state.character.life).toBeLessThanOrEqual(computeMaxLife(state));
          const validation = validateState(state);
          expect(validation.ok ? [] : validation.errors).toEqual([]);
        },
      ),
    );
  });
});

describe("reset_passives", () => {
  it("refunds every point and does not heal", () => {
    const state = stateAtLevel(9);
    for (const id of ["b1", "b3", "BN1"] as const) dispatch(state, { type: "allocate_passive", nodeId: id });
    state.character.life = 50;
    const result = dispatch(state, { type: "reset_passives" });
    expect(result).toEqual({ ok: true, events: [{ type: "passives_reset", timeMs: 0 }] });
    expect(state.character.allocatedPassives).toEqual([]);
    expect(unspentPassivePoints(state)).toBe(3);
    expect(state.character.life).toBe(50);
  });

  it("is a silent no-op with nothing allocated", () => {
    const state = stateAtLevel(9);
    expect(dispatch(state, { type: "reset_passives" })).toEqual({ ok: true, events: [] });
    expect(state.log).toEqual([]);
  });
});
