import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  MOD_KINDS,
  STAT_IDS,
  aggregate,
  applyScalar,
  type AggregateContext,
  type Modifier,
  type Tag,
} from "../src/game/modifiers";

const src = { kind: "passive", id: "test" } as const;

function mod(partial: Omit<Modifier, "source">): Modifier {
  return { ...partial, source: src };
}

const ctx = (overrides: Partial<AggregateContext> = {}): AggregateContext => ({
  tags: [],
  stacks: {},
  ...overrides,
});

describe("aggregate: kinds", () => {
  it("returns identity values with no modifiers", () => {
    expect(aggregate([], "damage", ctx())).toEqual({ flat: 0, flatRange: [0, 0], increased: 0, more: 1 });
  });

  it("sums flat values", () => {
    const mods = [mod({ stat: "life_max", kind: "flat", value: 20 }), mod({ stat: "life_max", kind: "flat", value: 15 })];
    const r = aggregate(mods, "life_max", ctx());
    expect(r.flat).toBe(35);
    expect(r.flatRange).toEqual([35, 35]);
  });

  it("sums ranged flat values into flatRange only", () => {
    const mods = [
      mod({ stat: "added_damage", kind: "flat", damageType: "fire", value: [2, 4] }),
      mod({ stat: "added_damage", kind: "flat", damageType: "fire", value: [5, 9] }),
    ];
    const r = aggregate(mods, "added_damage", ctx({ damageType: "fire" }));
    expect(r.flat).toBe(0);
    expect(r.flatRange).toEqual([7, 13]);
  });

  it("sums increased values additively", () => {
    const mods = [mod({ stat: "damage", kind: "increased", value: 10 }), mod({ stat: "damage", kind: "increased", value: 12 })];
    expect(aggregate(mods, "damage", ctx()).increased).toBe(22);
  });

  it("multiplies more values, with negative values as less", () => {
    const mods = [
      mod({ stat: "damage", kind: "more", value: 25 }),
      mod({ stat: "damage", kind: "more", value: 30 }),
      mod({ stat: "damage", kind: "more", value: -10 }),
    ];
    expect(aggregate(mods, "damage", ctx()).more).toBeCloseTo(1.25 * 1.3 * 0.9, 12);
  });

  it("rejects range values on non-flat modifiers", () => {
    const mods = [mod({ stat: "damage", kind: "increased", value: [1, 2] })];
    expect(() => aggregate(mods, "damage", ctx())).toThrow(TypeError);
  });

  it("applyScalar computes (base + flat) * (1 + inc) * more", () => {
    const mods = [
      mod({ stat: "life_max", kind: "flat", value: 20 }),
      mod({ stat: "life_max", kind: "increased", value: 8 }),
      mod({ stat: "life_max", kind: "more", value: -30 }),
    ];
    expect(applyScalar(100, aggregate(mods, "life_max", ctx()))).toBeCloseTo(120 * 1.08 * 0.7, 10);
  });
});

describe("aggregate: matching", () => {
  it("ignores modifiers for other stats", () => {
    const mods = [mod({ stat: "armor", kind: "increased", value: 20 })];
    expect(aggregate(mods, "damage", ctx()).increased).toBe(0);
  });

  it("requires a matching damageType when the modifier has one", () => {
    const mods = [mod({ stat: "damage", kind: "increased", damageType: "lightning", value: 15 })];
    expect(aggregate(mods, "damage", ctx({ damageType: "lightning" })).increased).toBe(15);
    expect(aggregate(mods, "damage", ctx({ damageType: "fire" })).increased).toBe(0);
    expect(aggregate(mods, "damage", ctx()).increased).toBe(0);
  });

  it("untyped modifiers apply to any damageType", () => {
    const mods = [mod({ stat: "damage", kind: "increased", value: 10 })];
    expect(aggregate(mods, "damage", ctx({ damageType: "cold" })).increased).toBe(10);
  });

  it("requires all modifier tags to be present in the context", () => {
    const mods = [mod({ stat: "damage", kind: "more", value: 35, tags: ["attack", "single_target"] })];
    expect(aggregate(mods, "damage", ctx({ tags: ["attack", "single_target", "physical"] })).more).toBeCloseTo(1.35);
    expect(aggregate(mods, "damage", ctx({ tags: ["attack", "chain"] })).more).toBe(1);
  });

  it("applies enemy_life_below_pct only when the condition holds", () => {
    const mods = [mod({ stat: "damage", kind: "more", value: 40, condition: { kind: "enemy_life_below_pct", value: 30 } })];
    expect(aggregate(mods, "damage", ctx({ enemyLifePct: 29.9 })).more).toBeCloseTo(1.4);
    expect(aggregate(mods, "damage", ctx({ enemyLifePct: 30 })).more).toBe(1);
    expect(aggregate(mods, "damage", ctx({ enemyLifePct: 80 })).more).toBe(1);
    expect(aggregate(mods, "damage", ctx()).more).toBe(1);
  });
});

describe("aggregate: perStack", () => {
  const momentum = mod({ stat: "attack_speed", kind: "increased", value: 2, perStack: "momentum" });

  it("scales by the stack counter in the context", () => {
    expect(aggregate([momentum], "attack_speed", ctx({ stacks: { momentum: 3 } })).increased).toBe(6);
  });

  it("treats a missing counter as 0", () => {
    expect(aggregate([momentum], "attack_speed", ctx()).increased).toBe(0);
  });

  it("does not clamp counters (clamping is the engine's job)", () => {
    expect(aggregate([momentum], "attack_speed", ctx({ stacks: { momentum: 9 } })).increased).toBe(18);
  });

  it("scales more and ranged values", () => {
    const mods = [
      mod({ stat: "damage", kind: "more", value: 10, perStack: "momentum" }),
      mod({ stat: "added_damage", kind: "flat", damageType: "fire", value: [1, 3], perStack: "momentum" }),
    ];
    const stacks = { momentum: 2 };
    expect(aggregate(mods, "damage", ctx({ stacks })).more).toBeCloseTo(1.2);
    expect(aggregate(mods, "added_damage", ctx({ damageType: "fire", stacks })).flatRange).toEqual([2, 6]);
  });
});

describe("aggregate: purity", () => {
  const tagArb = fc.constantFrom<Tag>("physical", "fire", "cold", "lightning", "chaos", "elemental", "attack", "single_target", "chain");
  const modArb: fc.Arbitrary<Modifier> = fc.record(
    {
      stat: fc.constantFrom(...STAT_IDS),
      kind: fc.constantFrom(...MOD_KINDS),
      value: fc.integer({ min: -50, max: 100 }),
      tags: fc.array(tagArb, { maxLength: 3 }),
      perStack: fc.constant("momentum" as const),
      condition: fc.record({ kind: fc.constant("enemy_life_below_pct" as const), value: fc.integer({ min: 0, max: 100 }) }),
      source: fc.constant(src),
    },
    { requiredKeys: ["stat", "kind", "value", "source"] },
  );
  const ctxArb: fc.Arbitrary<AggregateContext> = fc.record(
    {
      tags: fc.array(tagArb, { maxLength: 5 }),
      enemyLifePct: fc.integer({ min: 0, max: 100 }),
      stacks: fc.record({ momentum: fc.integer({ min: 0, max: 5 }) }, { requiredKeys: [] }),
    },
    { requiredKeys: ["tags", "stacks"] },
  );

  it("is deterministic and does not mutate its inputs", () => {
    fc.assert(
      fc.property(fc.array(modArb, { maxLength: 12 }), fc.constantFrom(...STAT_IDS), ctxArb, (mods, stat, context) => {
        const modsBefore = structuredClone(mods);
        const ctxBefore = structuredClone(context);
        const a = aggregate(mods, stat, context);
        const b = aggregate(mods, stat, context);
        expect(a).toEqual(b);
        expect(mods).toEqual(modsBefore);
        expect(context).toEqual(ctxBefore);
      }),
    );
  });

  it("is order-independent", () => {
    fc.assert(
      fc.property(fc.array(modArb, { maxLength: 12 }), fc.constantFrom(...STAT_IDS), ctxArb, (mods, stat, context) => {
        const a = aggregate(mods, stat, context);
        const b = aggregate([...mods].reverse(), stat, context);
        expect(b.flat).toBeCloseTo(a.flat, 9);
        expect(b.increased).toBeCloseTo(a.increased, 9);
        expect(b.more).toBeCloseTo(a.more, 9);
      }),
    );
  });
});
