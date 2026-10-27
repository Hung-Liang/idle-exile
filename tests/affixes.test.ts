import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { AFFIXES, getAffixDefinition } from "../src/data/affixes";
import { AFFIX_CATEGORY_LIMITS } from "../src/data/drop-tables";
import { addRandomAffix, affixModifierSpecs, eligibleAffixes, generateAffixes } from "../src/game/affixes";
import { ITEM_CLASSES, RARITIES, type ItemClass, type Rarity, type RolledAffix } from "../src/game/equipment";
import { createStreamState } from "../src/game/random";

function checkAffixes(affixes: RolledAffix[], itemClass: ItemClass, itemLevel: number, rarity: Rarity): string[] {
  const errors: string[] = [];
  const limits = AFFIX_CATEGORY_LIMITS[rarity];
  const defs = affixes.map((a) => getAffixDefinition(a.affixId));
  const prefixes = defs.filter((d) => d.category === "prefix").length;
  const suffixes = defs.length - prefixes;
  if (prefixes > limits.prefix || suffixes > limits.suffix) errors.push("category limit exceeded");
  if (new Set(defs.map((d) => d.group)).size !== defs.length) errors.push("duplicate group");
  affixes.forEach((affix, i) => {
    const def = defs[i]!;
    if (!def.itemClasses.includes(itemClass)) errors.push(`${def.id} not allowed on ${itemClass}`);
    if (def.requiredItemLevel > itemLevel) errors.push(`${def.id} requires ilvl ${def.requiredItemLevel}`);
    def.modifiers.forEach((mod, j) => {
      const v = affix.values[j]!;
      if (!Number.isInteger(v) || v < mod.range[0] || v > mod.range[1]) errors.push(`${def.id} value ${v} out of range`);
    });
  });
  return errors;
}

describe("eligibleAffixes", () => {
  it("filters by class, item level, category and present groups", () => {
    const pool = eligibleAffixes("weapon", 12, ["suffix"], new Set(["crit_chance"]));
    expect(pool.length).toBeGreaterThan(0);
    for (const def of pool) {
      expect(def.itemClasses).toContain("weapon");
      expect(def.requiredItemLevel).toBeLessThanOrEqual(12);
      expect(def.category).toBe("suffix");
      expect(def.group).not.toBe("crit_chance");
    }
    expect(pool.map((d) => d.id)).toContain("local_attack_speed_t3");
    expect(pool.map((d) => d.id)).not.toContain("local_attack_speed_t2");
  });

  it("uses the class-specific variant of split groups", () => {
    const weapon = eligibleAffixes("weapon", 1, ["prefix"], new Set()).map((d) => d.id);
    const ring = eligibleAffixes("ring", 1, ["prefix"], new Set()).map((d) => d.id);
    expect(weapon).toContain("added_fire_weapon_t4");
    expect(weapon).not.toContain("added_fire_t4");
    expect(ring).toContain("added_fire_t4");
    expect(ring).not.toContain("added_fire_weapon_t4");
  });

  it("respects the 3-tier chaos resistance item levels", () => {
    expect(eligibleAffixes("ring", 14, ["suffix"], new Set()).some((d) => d.group === "res_chaos")).toBe(false);
    expect(eligibleAffixes("ring", 15, ["suffix"], new Set()).map((d) => d.id)).toContain("res_chaos_t3");
  });
});

describe("generateAffixes", () => {
  it("normal items have no affixes and consume no draws", () => {
    const rng = createStreamState(1, "loot");
    const before = [...rng];
    expect(generateAffixes("ring", 40, "normal", rng)).toEqual([]);
    expect(rng).toEqual(before);
  });

  it("stops early when nothing eligible remains", () => {
    // An amulet has only two prefix groups (life, damage_inc), so a rare runs out of prefixes
    // before reaching its prefix limit of 3.
    const affixes: RolledAffix[] = [];
    let added = 0;
    const rng = createStreamState(2, "loot");
    while (addRandomAffix(affixes, "amulet", 1, "rare", rng)) added++;
    const prefixes = affixes.filter((a) => getAffixDefinition(a.affixId).category === "prefix").length;
    expect(prefixes).toBe(2);
    expect(added).toBe(affixes.length);
    expect(checkAffixes(affixes, "amulet", 1, "rare")).toEqual([]);
  });

  it("property: affixes are always valid for the rarity, class and item level", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.constantFrom(...ITEM_CLASSES),
        fc.integer({ min: 1, max: 60 }),
        // Uniques never draw random affixes (plan §8.9).
        fc.constantFrom(...RARITIES.filter((r) => r !== "unique")),
        (seed, itemClass, itemLevel, rarity) => {
          const affixes = generateAffixes(itemClass, itemLevel, rarity, createStreamState(seed, "loot"));
          expect(checkAffixes(affixes, itemClass, itemLevel, rarity)).toEqual([]);
          const max = rarity === "normal" ? 0 : rarity === "magic" ? 2 : 6;
          const min = rarity === "normal" ? 0 : 1;
          expect(affixes.length).toBeGreaterThanOrEqual(min);
          expect(affixes.length).toBeLessThanOrEqual(max);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("magic items roll 1 or 2 affixes about evenly", () => {
    const rng = createStreamState(3, "loot");
    const counts = [0, 0, 0];
    for (let i = 0; i < 4000; i++) counts[generateAffixes("ring", 40, "magic", rng).length]!++;
    expect(counts[0]).toBe(0);
    expect(counts[1]! / 4000).toBeCloseTo(0.5, 1);
  });

  it("draws affixes by weight (chi-square over equal weights, fixed seed)", () => {
    // Amulet ilvl 1 prefixes: life_t4 and damage_inc_t4, both weight 100.
    const rng = createStreamState(4, "loot");
    const ids = eligibleAffixes("amulet", 1, ["prefix"], new Set()).map((d) => d.id);
    expect(ids).toHaveLength(2);
    const counts = new Map(ids.map((id) => [id, 0]));
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const affixes: RolledAffix[] = [];
      addRandomAffix(affixes, "amulet", 1, "magic", rng);
      const id = affixes[0]!.affixId;
      if (counts.has(id)) counts.set(id, counts.get(id)! + 1);
    }
    // Magic allows a prefix or a suffix; only prefixes were counted, so compare them to each other.
    const [a, b] = [...counts.values()] as [number, number];
    const expected = (a + b) / 2;
    const chi2 = ((a - expected) ** 2 + (b - expected) ** 2) / expected;
    expect(chi2).toBeLessThan(6.63); // p = 0.01, 1 dof
  });
});

describe("affixModifierSpecs", () => {
  it("turns flat added damage into [v, round(v × 1.75)]", () => {
    expect(affixModifierSpecs({ affixId: "added_fire_t1", values: [20] })).toEqual([
      { stat: "added_damage", kind: "flat", damageType: "fire", value: [20, 35] },
    ]);
  });

  it("keeps the local flag and scalar values", () => {
    expect(affixModifierSpecs({ affixId: "local_phys_inc_t2", values: [50] })).toEqual([
      { stat: "damage", kind: "increased", damageType: "physical", local: true, value: 50 },
    ]);
    expect(affixModifierSpecs({ affixId: "life_t4", values: [12] })).toEqual([{ stat: "life_max", kind: "flat", value: 12 }]);
  });

  it("every affix produces modifiers", () => {
    for (const def of Object.values(AFFIXES)) {
      const specs = affixModifierSpecs({ affixId: def.id, values: def.modifiers.map((m) => m.range[0]) });
      expect(specs).toHaveLength(def.modifiers.length);
    }
  });
});
