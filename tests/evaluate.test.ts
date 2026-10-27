import { describe, expect, it } from "vitest";
import { monsterBaseDamage } from "../src/data/balance";
import { monsterStats, resolveHit, rollAttack } from "../src/game/combat";
import { advance, dispatch } from "../src/game/engine";
import { compareEquip, evaluateBuild, evaluateState } from "../src/game/evaluate";
import type { ItemInstance } from "../src/game/equipment";
import { createStreamState } from "../src/game/random";
import { collectBuild } from "../src/game/stats";
import { createInitialState, type GameState } from "../src/game/state";

const REFERENCE = { armor: 0, resistances: {}, lifePct: 100 };

function addItem(state: GameState, item: Omit<ItemInstance, "id">): string {
  const id = `i${state.nextItemId++}`;
  state.inventory.items[id] = { ...item, id };
  state.inventory.order.push(id);
  return id;
}

/** Equips a crit-heavy weapon with local and global elemental damage plus a ring. */
function gearedState(seed: number): GameState {
  const state = createInitialState(seed);
  state.character.level = 30;
  state.character.supportIds = ["brute_force", "keen_edge"];
  const weapon = addItem(state, {
    baseId: "duelist_rapier",
    itemLevel: 40,
    rarity: "rare",
    affixes: [
      { affixId: "local_phys_inc_t2", values: [50] },
      { affixId: "added_fire_weapon_t2", values: [12] },
      { affixId: "crit_chance_weapon_t1", values: [45] },
      { affixId: "crit_multi_t2", values: [25] },
    ],
  });
  const ring = addItem(state, {
    baseId: "silver_signet",
    itemLevel: 40,
    rarity: "magic",
    affixes: [{ affixId: "added_lightning_t2", values: [10] }],
  });
  dispatch(state, { type: "equip_item", itemId: weapon });
  dispatch(state, { type: "equip_item", itemId: ring });
  return state;
}

function meanSimulatedHit(state: GameState, chained = false): number {
  const build = collectBuild(state);
  const rng = createStreamState(12345, "combat");
  const n = 10_000;
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += resolveHit(build, rollAttack(build, {}, rng), {}, REFERENCE, chained);
  }
  return total / n;
}

describe("evaluateBuild: expected hit matches the combat pipeline", () => {
  it("mean of 10,000 seeded attacks is within 2% (starting character)", () => {
    const state = createInitialState(1);
    expect(Math.abs(meanSimulatedHit(state) / evaluateState(state).expectedHit - 1)).toBeLessThan(0.02);
  });

  it("mean of 10,000 seeded attacks is within 2% (crit and elemental gear)", () => {
    const state = gearedState(2);
    const evaluation = evaluateState(state);
    expect(evaluation.critChance).toBeGreaterThan(10);
    expect(Math.abs(meanSimulatedHit(state) / evaluation.expectedHit - 1)).toBeLessThan(0.02);
  });

  it("mean of 10,000 seeded attacks is within 2% (Arc Pulse)", () => {
    const state = gearedState(3);
    state.character.activeSkillId = "arc_pulse";
    expect(Math.abs(meanSimulatedHit(state) / evaluateState(state).expectedHit - 1)).toBeLessThan(0.02);
  });
});

describe("evaluateBuild: DPS and EHP", () => {
  it("pack DPS adds chained hits for chain skills and equals single-target DPS otherwise", () => {
    const state = gearedState(4);
    const heavy = evaluateState(state);
    expect(heavy.packDps).toBeCloseTo(heavy.singleTargetDps);

    state.character.activeSkillId = "arc_pulse";
    const build = collectBuild(state);
    const arc = evaluateBuild(build, 30);
    // Chained hits deal 50% less, up to the per-hit floor.
    expect(arc.packDps / arc.singleTargetDps).toBeCloseTo(2, 1);
  });

  it("EHP divides max life by the weighted fraction of damage taken", () => {
    const state = createInitialState(1);
    const ring = addItem(state, {
      baseId: "iron_band",
      itemLevel: 10,
      rarity: "magic",
      affixes: [{ affixId: "res_fire_t4", values: [10] }],
    });
    dispatch(state, { type: "equip_item", itemId: ring });
    const e = evaluateBuild(collectBuild(state), 1);
    // No armor: physical is taken in full. Fire 10%: 0.15 × 0.9.
    expect(e.ehp).toBeCloseTo(100 / (0.4 + 0.15 * 0.9 + 0.15 * 3));
    expect(monsterBaseDamage(1)).toBe(4);
  });

  it("compareEquip does not modify the state", () => {
    const state = createInitialState(1);
    const maul = addItem(state, { baseId: "iron_maul", itemLevel: 1, rarity: "normal", affixes: [] });
    const before = structuredClone(state);
    const { current, candidate } = compareEquip(state, maul, "weapon");
    expect(state).toEqual(before);
    expect(candidate.singleTargetDps).not.toBeCloseTo(current.singleTargetDps);
  });
});

/**
 * Damage per second the engine deals to a dummy that never attacks and never dies. Ember Wisp
 * has 0 armor and only fire resistance, so a physical-only build meets the reference monster.
 */
function engineDps(state: GameState, ms: number): number {
  const wisp = monsterStats("ember_wisp", 1);
  const life = 1_000_000_000;
  state.encounter = {
    index: 0,
    isBoss: false,
    phase: "fighting",
    phaseEndsAt: 0,
    monsters: [{ defId: "ember_wisp", level: 1, life, maxLife: life, nextAttackAt: ms + wisp.attackIntervalMs, alive: true }],
    player: { nextAttackAt: 0 },
    stacks: {},
    levelGap: 0,
  };
  advance(state, ms - 1);
  return ((life - state.encounter.monsters[0]!.life) / ms) * 1000;
}

describe("equipping changes combat outcomes as predicted by evaluate.ts", () => {
  it("engine DPS before and after equipping matches the standardized estimate within 3%", () => {
    const state = createInitialState(9);
    state.character.level = 12;
    state.character.supportIds = ["brute_force"];
    const weapon = addItem(state, {
      baseId: "war_hammer",
      itemLevel: 20,
      rarity: "rare",
      affixes: [
        { affixId: "local_phys_flat_t3", values: [7] },
        { affixId: "local_phys_inc_t3", values: [35] },
        { affixId: "local_attack_speed_t3", values: [10] },
        { affixId: "crit_chance_weapon_t3", values: [25] },
      ],
    });

    const before = structuredClone(state);
    const predictedBefore = evaluateState(before).singleTargetDps;
    const measuredBefore = engineDps(before, 600_000);

    dispatch(state, { type: "equip_item", itemId: weapon });
    const predictedAfter = evaluateState(state).singleTargetDps;
    const measuredAfter = engineDps(state, 600_000);

    expect(predictedAfter).toBeGreaterThan(predictedBefore * 1.5);
    expect(Math.abs(measuredBefore / predictedBefore - 1)).toBeLessThan(0.03);
    expect(Math.abs(measuredAfter / predictedAfter - 1)).toBeLessThan(0.03);
  });
});
