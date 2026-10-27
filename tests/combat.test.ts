import { describe, expect, it } from "vitest";
import { SKILLS, type SkillId } from "../src/data/skills";
import { LEVEL_GAP_MAX_LEVELS, LEVEL_GAP_PCT_PER_LEVEL } from "../src/data/balance";
import {
  effectiveResistance,
  finalDamage,
  levelGap,
  levelGapMods,
  mitigateHit,
  mitigatePortion,
  monsterStats,
  resolveHit,
  rollAttack,
  rollMonsterHit,
} from "../src/game/combat";
import type { Modifier, ModifierSpec } from "../src/game/modifiers";
import { createStreamState, nextFloat, type RngState } from "../src/game/random";
import { attackIntervalMs, collectBuild, computeDefenses, critChance, type PlayerBuild } from "../src/game/stats";
import { createInitialState } from "../src/game/state";

function build(skillId: SkillId, specs: ModifierSpec[] = [], weapon: Partial<PlayerBuild["weapon"]> = {}): PlayerBuild {
  const skill = SKILLS[skillId];
  const mods: Modifier[] = [...skill.modifiers, ...specs].map((s) => ({ ...s, source: { kind: "base", id: "test" } }));
  return {
    level: 1,
    skill,
    mods,
    weapon: { physical: [10, 20], attacksPerSecond: 1, critChance: 0, ...weapon },
    baseArmor: 0,
  };
}

/** The two draws `rollAttack` will consume from a copy of `rng`. */
function peekDraws(rng: RngState): [number, number] {
  const copy: RngState = [...rng];
  return [nextFloat(copy), nextFloat(copy)];
}

const noDefense = { armor: 0, resistances: {}, lifePct: 100 };

describe("rollAttack", () => {
  it("rolls each type with one shared draw and applies skill effectiveness", () => {
    const rng = createStreamState(1, "combat");
    const [t] = peekDraws(rng);
    const b = build("heavy_strike", [{ stat: "added_damage", kind: "flat", damageType: "fire", value: [2, 4] }]);
    const roll = rollAttack(b, {}, rng);
    expect(roll.portions.physical).toBeCloseTo((10 + t * 10) * 1.6);
    expect(roll.portions.fire).toBeCloseTo((2 + t * 2) * 1.6);
    expect(roll.crit).toBe(false);
  });

  it("consumes exactly two combat draws", () => {
    const rng = createStreamState(2, "combat");
    const expected: RngState = [...rng];
    nextFloat(expected);
    nextFloat(expected);
    rollAttack(build("arc_pulse"), {}, rng);
    expect(rng).toEqual(expected);
  });

  it("converts all physical damage to lightning for Arc Pulse", () => {
    const roll = rollAttack(build("arc_pulse"), {}, createStreamState(3, "combat"));
    expect(roll.portions.physical).toBe(0);
    expect(roll.portions.lightning).toBeGreaterThan(0);
  });

  it("caps total conversion at 100% by scaling proportionally", () => {
    const rng = createStreamState(4, "combat");
    const [t] = peekDraws(rng);
    const b = build("heavy_strike", [
      { stat: "conversion", kind: "flat", damageType: "fire", value: 100 },
      { stat: "conversion", kind: "flat", damageType: "cold", value: 50 },
    ]);
    const roll = rollAttack(b, {}, rng);
    const total = (10 + t * 10) * 1.6;
    expect(roll.portions.physical).toBeCloseTo(0);
    expect(roll.portions.fire).toBeCloseTo((total * 2) / 3);
    expect(roll.portions.cold).toBeCloseTo(total / 3);
  });

  it("adds gain-as-extra from post-conversion physical (Ember Infusion adds nothing to Arc Pulse)", () => {
    const ember: ModifierSpec = { stat: "gain_as_extra", kind: "flat", damageType: "fire", value: 20 };
    const rng = createStreamState(5, "combat");
    const heavy = rollAttack(build("heavy_strike", [ember]), {}, [...rng]);
    expect(heavy.portions.fire).toBeCloseTo(heavy.portions.physical * 0.2);
    expect(rollAttack(build("arc_pulse", [ember]), {}, [...rng]).portions.fire).toBe(0);
  });

  it("crits according to the second draw", () => {
    const rng = createStreamState(6, "combat");
    const [, critDraw] = peekDraws(rng);
    const b = build("heavy_strike", [], { critChance: 50 });
    expect(rollAttack(b, {}, [...rng]).crit).toBe(critDraw < 0.5);
  });
});

describe("resolveHit", () => {
  const fixedRoll = { portions: { physical: 100, fire: 0, cold: 0, lightning: 0, chaos: 0 }, crit: false, critMultiplier: 150 };

  it("applies increased and more per type, then floors", () => {
    const b = build("heavy_strike", [
      { stat: "damage", kind: "increased", damageType: "physical", value: 50 },
      { stat: "damage", kind: "more", value: 25 },
      { stat: "damage", kind: "increased", damageType: "fire", value: 1000 },
    ]);
    expect(resolveHit(b, fixedRoll, {}, noDefense, false)).toBe(Math.floor(100 * 1.5 * 1.25));
  });

  it("applies the crit multiplier", () => {
    expect(resolveHit(build("heavy_strike"), { ...fixedRoll, crit: true }, {}, noDefense, false)).toBe(150);
  });

  it("evaluates conditions against the target's life before the hit", () => {
    const b = build("heavy_strike", [
      { stat: "damage", kind: "more", value: 40, condition: { kind: "enemy_life_below_pct", value: 30 } },
    ]);
    expect(resolveHit(b, fixedRoll, {}, { ...noDefense, lifePct: 29 }, false)).toBe(140);
    expect(resolveHit(b, fixedRoll, {}, { ...noDefense, lifePct: 30 }, false)).toBe(100);
  });

  it("halves chained hits for Arc Pulse", () => {
    const roll = { ...fixedRoll, portions: { ...fixedRoll.portions, physical: 0, lightning: 100 } };
    const b = build("arc_pulse");
    expect(resolveHit(b, roll, {}, noDefense, false)).toBe(100);
    expect(resolveHit(b, roll, {}, noDefense, true)).toBe(50);
  });

  it("deals at least 1 damage", () => {
    const roll = { ...fixedRoll, portions: { ...fixedRoll.portions, physical: 0.2 } };
    expect(resolveHit(build("heavy_strike"), roll, {}, noDefense, false)).toBe(1);
  });

  it("applies elemental tags to elemental portions only", () => {
    const b = build("heavy_strike", [{ stat: "damage", kind: "increased", tags: ["elemental"], value: 100 }]);
    const roll = { ...fixedRoll, portions: { ...fixedRoll.portions, fire: 10 } };
    expect(resolveHit(b, roll, {}, noDefense, false)).toBe(100 + 20);
  });
});

describe("mitigation", () => {
  it("caps resistance at the maximum and floors it at −100", () => {
    expect(mitigatePortion("fire", 100, { armor: 0, resistances: { fire: 90 } }, 0)).toBeCloseTo(25);
    expect(mitigatePortion("fire", 100, { armor: 0, resistances: { fire: 90 }, resistanceMax: { fire: 80 } }, 0)).toBeCloseTo(20);
    expect(mitigatePortion("cold", 100, { armor: 0, resistances: { cold: -150 } }, 0)).toBeCloseTo(200);
  });

  it("applies penetration, which can only lower resistance", () => {
    expect(mitigatePortion("lightning", 100, { armor: 0, resistances: { lightning: 40 } }, 10)).toBeCloseTo(70);
    expect(effectiveResistance(40, -20, 75)).toBe(40);
    expect(effectiveResistance(-95, 10, 75)).toBe(-100);
  });

  it("reduces physical damage by armor, capped at 90%", () => {
    expect(mitigatePortion("physical", 100, { armor: 500, resistances: {} }, 0)).toBeCloseTo(50);
    expect(mitigatePortion("physical", 10, { armor: 1e9, resistances: {} }, 0)).toBeCloseTo(1);
  });

  it("finalDamage floors and has a minimum of 1", () => {
    expect([0, 0.9, 1.99, 7.5].map(finalDamage)).toEqual([1, 1, 1, 7]);
  });

  it("monster hits roll within ±20% and split by damage type", () => {
    const stats = monsterStats("blighted", 20);
    const rng = createStreamState(9, "combat");
    for (let i = 0; i < 200; i++) {
      const hit = rollMonsterHit(stats, rng);
      const total = hit.physical + hit.chaos;
      expect(total).toBeGreaterThanOrEqual(stats.damagePerHit * 0.8);
      expect(total).toBeLessThan(stats.damagePerHit * 1.2);
      expect(hit.physical).toBeCloseTo(hit.chaos);
      expect(mitigateHit(hit, { armor: 0, resistances: {} })).toBe(Math.floor(total));
    }
  });
});

describe("derived stats", () => {
  it("computes the starting character's attack interval and life", () => {
    const b = collectBuild(createInitialState(1));
    // Rusted Blade 1.3 APS × Heavy Strike 20% less = 1.04 APS.
    expect(attackIntervalMs(b, {})).toBe(Math.round(1000 / 1.04));
    expect(computeDefenses(b).maxLife).toBe(100);
    expect(critChance(b, {})).toBe(5);
  });

  it("caps attack speed at 10 per second", () => {
    expect(attackIntervalMs(build("rapid_assault", [], { attacksPerSecond: 50 }), {})).toBe(100);
  });

  it("scales attack speed by perStack modifiers", () => {
    const b = build("heavy_strike", [{ stat: "attack_speed", kind: "increased", value: 25, perStack: "momentum" }]);
    expect(attackIntervalMs(b, { momentum: 0 })).toBe(1250);
    expect(attackIntervalMs(b, { momentum: 2 })).toBe(Math.round(1000 / (0.8 * 1.5)));
  });

  it("includes passive and support modifiers", () => {
    const state = createInitialState(1);
    state.character.allocatedPassives = ["b1", "b3"];
    // (100 + 20) × 1.08
    expect(computeDefenses(collectBuild(state)).maxLife).toBe(129);
  });
});

describe("level gap", () => {
  it("counts only levels the monsters are above the character, up to the cap", () => {
    expect(levelGap(10, 12)).toBe(0);
    expect(levelGap(10, 10)).toBe(0);
    expect(levelGap(13, 10)).toBe(3);
    expect(levelGap(50, 1)).toBe(LEVEL_GAP_MAX_LEVELS);
  });

  it("gives monsters more life and damage per level of gap", () => {
    expect(levelGapMods(0)).toEqual([]);
    const pct = 3 * LEVEL_GAP_PCT_PER_LEVEL;
    const plain = monsterStats("brute", 20);
    const gapped = monsterStats("brute", 20, levelGapMods(3));
    expect(gapped.maxLife).toBe(Math.round(monsterStats("brute", 20).maxLife * (1 + pct / 100)));
    expect(gapped.damagePerHit).toBeCloseTo(plain.damagePerHit * (1 + pct / 100));
    expect(gapped.armor).toBe(plain.armor);
  });
});
