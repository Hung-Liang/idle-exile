import { describe, expect, it } from "vitest";
import { AFFIXES, TIER_ITEM_LEVELS } from "../src/data/affixes";
import { AILMENTS, DAMAGING_AILMENT_IDS } from "../src/data/ailments";
import { CURRENCIES } from "../src/data/currencies";
import { AFFIX_CATEGORY_LIMITS, AFFIX_COUNT_WEIGHTS, DROP_TABLES, SALVAGE_YIELDS } from "../src/data/drop-tables";
import { ITEM_BASES, STARTING_WEAPON_BASE } from "../src/data/item-bases";
import { MAP_MODIFIERS } from "../src/data/map-modifiers";
import { BOSSES, MONSTERS, type MonsterDefinition } from "../src/data/monsters";
import { PASSIVE_EDGES, PASSIVE_NODES, PASSIVE_ROOT } from "../src/data/passive-tree";
import { SKILLS, type SpellValues } from "../src/data/skills";
import { STACKS } from "../src/data/stacks";
import { SUPPORTS } from "../src/data/supports";
import { ZONE_ORDER, ZONES } from "../src/data/zones";
import { SUPPORT_SLOT_LEVELS, MAX_LEVEL } from "../src/data/balance";
import { affixModifierSpecs } from "../src/game/affixes";
import { ITEM_CLASSES, RARITIES } from "../src/game/equipment";
import { DAMAGE_TYPES } from "../src/game/modifiers";
import {
  checkGlobalUniqueness,
  checkGraph,
  checkModifierSpecs,
  checkRecordIds,
  checkReference,
  checkTags,
} from "./helpers/data-checks";

const TABLES = {
  AFFIXES,
  AILMENTS,
  CURRENCIES,
  ITEM_BASES,
  MAP_MODIFIERS,
  MONSTERS,
  BOSSES,
  PASSIVE_NODES,
  SKILLS,
  STACKS,
  SUPPORTS,
  ZONES,
};

function checkSpell(id: string, spell: SpellValues): string[] {
  const split = Object.entries(spell.damageSplit);
  const total = split.reduce((sum, [, f]) => sum + f, 0);
  return [
    ...(Number.isInteger(spell.castTimeMs) && spell.castTimeMs >= 100 ? [] : [`skill ${id}: bad castTimeMs`]),
    ...(spell.critChance > 0 && spell.critChance <= 100 ? [] : [`skill ${id}: bad critChance`]),
    ...(Math.abs(total - 1) < 1e-9 && split.every(([, f]) => f > 0) ? [] : [`skill ${id}: damage split must be positive and sum to 1`]),
  ];
}

function expectNoErrors(errors: string[]): void {
  expect(errors).toEqual([]);
}

describe("data: ids", () => {
  it.each(Object.entries(TABLES))("%s keys match ids", (name, table) => {
    expectNoErrors(checkRecordIds(name, table));
  });

  it("ids are unique across tables", () => {
    expectNoErrors(checkGlobalUniqueness(TABLES));
  });
});

describe("data: skills and supports", () => {
  it("skills have valid tags, modifiers and unlock levels", () => {
    const errors = Object.values(SKILLS).flatMap((s) => [
      ...checkTags(`skill ${s.id}`, s.tags),
      ...checkModifierSpecs(`skill ${s.id}`, s.modifiers),
      ...(s.unlockLevel >= 1 && s.unlockLevel <= MAX_LEVEL ? [] : [`skill ${s.id}: bad unlockLevel`]),
      ...(s.effectiveness > 0 ? [] : [`skill ${s.id}: effectiveness must be positive`]),
      ...(s.chain === undefined || s.tags.includes("chain") ? [] : [`skill ${s.id}: chain mechanic without chain tag`]),
      ...(s.tags.includes("attack") !== s.tags.includes("spell") ? [] : [`skill ${s.id}: needs exactly one of attack, spell`]),
      ...((s.spell !== undefined) === s.tags.includes("spell") ? [] : [`skill ${s.id}: spell values without spell tag or vice versa`]),
      ...(s.tags.includes("area") && s.tags.includes("chain") ? [`skill ${s.id}: area and chain are exclusive`] : []),
      ...(s.spell === undefined ? [] : checkSpell(s.id, s.spell)),
    ]);
    expectNoErrors(errors);
  });

  it("at least one skill is available at level 1", () => {
    expect(Object.values(SKILLS).some((s) => s.unlockLevel === 1)).toBe(true);
  });

  it("supports have valid tags and modifiers, and requires/excludes do not overlap", () => {
    const errors = Object.values(SUPPORTS).flatMap((s) => [
      ...checkTags(`support ${s.id} requires`, s.requiresTags),
      ...checkTags(`support ${s.id} excludes`, s.excludesTags),
      ...checkModifierSpecs(`support ${s.id}`, s.modifiers),
      ...(s.requiresTags.some((t) => s.excludesTags.includes(t)) ? [`support ${s.id}: tag both required and excluded`] : []),
      ...(s.unlockLevel >= 1 && s.unlockLevel <= MAX_LEVEL ? [] : [`support ${s.id}: bad unlockLevel`]),
    ]);
    expectNoErrors(errors);
  });

  it("support slot levels are ascending and within the level cap", () => {
    const levels = [...SUPPORT_SLOT_LEVELS];
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(levels.every((l) => l >= 1 && l <= MAX_LEVEL)).toBe(true);
  });
});

describe("data: passive tree", () => {
  it("topology is valid and fully reachable from the root", () => {
    expectNoErrors(checkGraph("PASSIVE_EDGES", Object.keys(PASSIVE_NODES), PASSIVE_EDGES, PASSIVE_ROOT));
  });

  it("has 30 allocatable nodes plus the root", () => {
    const nodes = Object.values(PASSIVE_NODES);
    expect(nodes.filter((n) => n.kind === "root").map((n) => n.id)).toEqual([PASSIVE_ROOT]);
    expect(nodes.filter((n) => n.kind !== "root")).toHaveLength(30);
  });

  it("node modifiers are valid", () => {
    expectNoErrors(Object.values(PASSIVE_NODES).flatMap((n) => checkModifierSpecs(`passive ${n.id}`, n.modifiers)));
  });

  it("graph check catches broken topologies", () => {
    expect(checkGraph("t", ["a", "b"], [["a", "a"]], "a")).toContain('t: self edge on "a"');
    expect(checkGraph("t", ["a", "b"], [["a", "b"], ["b", "a"]], "a")).toContain("t: duplicate edge [b, a]");
    expect(checkGraph("t", ["a", "b"], [["a", "x"]], "a")).toContain("t: edge [a, x] references an unknown node");
    expect(checkGraph("t", ["a", "b", "c", "d"], [["a", "b"], ["c", "d"]], "a")).toEqual([
      't: node "c" is unreachable from "a"',
      't: node "d" is unreachable from "a"',
    ]);
  });
});

describe("data: items", () => {
  it("item bases have valid classes, levels and values", () => {
    const errors = Object.values(ITEM_BASES).flatMap((b) => {
      const where = `item base ${b.id}`;
      const e: string[] = [];
      if (!ITEM_CLASSES.includes(b.itemClass)) e.push(`${where}: unknown itemClass`);
      if (!(b.requiredLevel >= 1 && b.requiredLevel <= MAX_LEVEL)) e.push(`${where}: bad requiredLevel`);
      if (!(b.weight > 0)) e.push(`${where}: weight must be positive`);
      if ((b.itemClass === "weapon") !== (b.weapon !== undefined)) e.push(`${where}: weapon values iff weapon class`);
      if (b.weapon) {
        const [min, max] = b.weapon.physical;
        if (!(min >= 0 && min <= max)) e.push(`${where}: invalid physical range`);
        if (!(b.weapon.attacksPerSecond > 0)) e.push(`${where}: attacksPerSecond must be positive`);
        if (!(b.weapon.critChance >= 0)) e.push(`${where}: negative critChance`);
      }
      if (b.armor !== undefined && !(b.armor >= 0)) e.push(`${where}: negative armor`);
      return e;
    });
    expectNoErrors(errors);
  });

  it("starting weapon is a level-1 weapon", () => {
    expectNoErrors(checkReference("STARTING_WEAPON_BASE", STARTING_WEAPON_BASE, ITEM_BASES));
    expect(ITEM_BASES[STARTING_WEAPON_BASE].itemClass).toBe("weapon");
    expect(ITEM_BASES[STARTING_WEAPON_BASE].requiredLevel).toBe(1);
  });

  it("every class has one base per tier (two for weapons) at levels 1 / 12 / 25 / 38", () => {
    for (const itemClass of ITEM_CLASSES) {
      const levels = Object.values(ITEM_BASES)
        .filter((b) => b.itemClass === itemClass)
        .map((b) => b.requiredLevel)
        .sort((a, b) => a - b);
      const perTier = itemClass === "weapon" ? 2 : 1;
      expect(levels, itemClass).toEqual([1, 12, 25, 38].flatMap((l) => Array(perTier).fill(l)));
    }
  });

  it("currencies have positive drop weights", () => {
    expect(Object.values(CURRENCIES).every((c) => c.dropWeight > 0)).toBe(true);
  });
});

describe("data: affixes", () => {
  it("affixes have valid classes, categories, weights, ranges and modifiers", () => {
    const errors = Object.values(AFFIXES).flatMap((a) => {
      const where = `affix ${a.id}`;
      const e: string[] = [];
      if (a.itemClasses.length === 0 || a.itemClasses.some((c) => !ITEM_CLASSES.includes(c))) e.push(`${where}: bad itemClasses`);
      if (a.category !== "prefix" && a.category !== "suffix") e.push(`${where}: bad category`);
      if (!(a.weight > 0)) e.push(`${where}: weight must be positive`);
      if (a.modifiers.length === 0) e.push(`${where}: no modifiers`);
      for (const mod of a.modifiers) {
        const [min, max] = mod.range;
        if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) e.push(`${where}: invalid range [${min}, ${max}]`);
      }
      e.push(...checkModifierSpecs(where, affixModifierSpecs({ affixId: a.id, values: a.modifiers.map((m) => m.range[0]) })));
      return e;
    });
    expectNoErrors(errors);
  });

  it("within a group, better tiers need a higher item level and roll higher values", () => {
    const errors: string[] = [];
    const byGroupAndClass = new Map<string, (typeof AFFIXES)[string][]>();
    for (const a of Object.values(AFFIXES)) {
      const key = `${a.group}|${a.itemClasses.join(",")}`;
      byGroupAndClass.set(key, [...(byGroupAndClass.get(key) ?? []), a]);
    }
    for (const [key, tiers] of byGroupAndClass) {
      const sorted = [...tiers].sort((x, y) => y.tier - x.tier); // worst (highest number) first
      sorted.forEach((a, i) => {
        if (i === 0) return;
        const prev = sorted[i - 1]!;
        if (a.tier !== prev.tier - 1) errors.push(`${key}: tiers are not consecutive`);
        if (!(a.requiredItemLevel > prev.requiredItemLevel)) errors.push(`${key}: T${a.tier} item level not above T${prev.tier}`);
        if (!(a.modifiers[0]!.range[1] > prev.modifiers[0]!.range[1])) errors.push(`${key}: T${a.tier} does not roll higher`);
      });
      if (sorted.at(-1)!.tier !== 1) errors.push(`${key}: best tier is not T1`);
      if (sorted.at(-1)!.requiredItemLevel !== TIER_ITEM_LEVELS[1]) errors.push(`${key}: T1 item level`);
    }
    expectNoErrors(errors);
  });

  it("groups split by item class do not overlap classes and share a category", () => {
    const errors: string[] = [];
    const groups = new Map<string, (typeof AFFIXES)[string][]>();
    for (const a of Object.values(AFFIXES)) groups.set(a.group, [...(groups.get(a.group) ?? []), a]);
    for (const [group, affixes] of groups) {
      if (new Set(affixes.map((a) => a.category)).size !== 1) errors.push(`${group}: mixed categories`);
      const byTier = new Map<number, string[]>();
      for (const a of affixes) byTier.set(a.tier, [...(byTier.get(a.tier) ?? []), ...a.itemClasses]);
      for (const [tier, classes] of byTier) {
        if (new Set(classes).size !== classes.length) errors.push(`${group} T${tier}: overlapping classes`);
      }
    }
    expectNoErrors(errors);
  });

  it("every item class can roll at least one prefix and one suffix at item level 1", () => {
    for (const itemClass of ITEM_CLASSES) {
      const pool = Object.values(AFFIXES).filter((a) => a.itemClasses.includes(itemClass) && a.requiredItemLevel <= 1);
      expect(pool.some((a) => a.category === "prefix"), itemClass).toBe(true);
      expect(pool.some((a) => a.category === "suffix"), itemClass).toBe(true);
    }
  });
});

describe("data: drop tables", () => {
  it("drop tables have valid chances, counts and rarity weights", () => {
    for (const table of Object.values(DROP_TABLES)) {
      expect(table.itemChance).toBeGreaterThan(0);
      expect(table.itemChance).toBeLessThanOrEqual(1);
      expect(table.currencyChance).toBeGreaterThan(0);
      expect(table.currencyChance).toBeLessThanOrEqual(1);
      expect(Number.isInteger(table.itemCount) && table.itemCount >= 1).toBe(true);
      expect(Number.isInteger(table.currencyCount) && table.currencyCount >= 1).toBe(true);
      expect(RARITIES.every((r) => table.rarityWeights[r] >= 0)).toBe(true);
    }
  });

  it("affix count weights respect the category limits", () => {
    for (const rarity of RARITIES) {
      const weights = AFFIX_COUNT_WEIGHTS[rarity];
      const limit = AFFIX_CATEGORY_LIMITS[rarity];
      expect(weights.length - 1).toBeLessThanOrEqual(limit.prefix + limit.suffix);
      expect(weights.some((w) => w > 0)).toBe(true);
    }
  });

  it("salvage yields reference currencies with valid chances", () => {
    const errors = RARITIES.flatMap((r) =>
      SALVAGE_YIELDS[r].flatMap((y) => [
        ...checkReference(`salvage ${r}`, y.currencyId, CURRENCIES),
        ...(y.chance > 0 && y.chance <= 1 ? [] : [`salvage ${r}: bad chance`]),
      ]),
    );
    expectNoErrors(errors);
  });
});

describe("data: zones and maps", () => {
  it("zone order lists every zone exactly once with ascending monster levels", () => {
    expect([...ZONE_ORDER].sort()).toEqual(Object.keys(ZONES).sort());
    const levels = ZONE_ORDER.map((id) => ZONES[id].monsterLevel);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });

  it("map modifiers have non-negative quantity and rarity", () => {
    expect(Object.values(MAP_MODIFIERS).every((m) => m.quantityPct >= 0 && m.rarityPct >= 0)).toBe(true);
  });

  it("stacks have a positive max", () => {
    expect(Object.values(STACKS).every((s) => s.max > 0)).toBe(true);
  });
});

describe("data: ailments", () => {
  it("each ailment has its own damage type, a positive duration and magnitude", () => {
    const ailments = Object.values(AILMENTS);
    expectNoErrors(checkRecordIds("AILMENTS", AILMENTS));
    expect(new Set(ailments.map((a) => a.damageType)).size).toBe(ailments.length);
    expect(ailments.every((a) => Number.isInteger(a.durationMs) && a.durationMs > 0 && a.magnitude > 0)).toBe(true);
    expect(ailments.every((a) => a.maxMagnitude === undefined || (a.maxMagnitude >= a.magnitude && a.maxMagnitude < 100))).toBe(true);
  });

  it("lists exactly the damaging ailments, in definition order", () => {
    expect(DAMAGING_AILMENT_IDS).toEqual(Object.values(AILMENTS).filter((a) => a.kind === "damaging").map((a) => a.id));
    expect(Object.values(AILMENTS).every((a) => (a.kind === "damaging") === (a.maxMagnitude === undefined))).toBe(true);
  });
});

function checkMonster(where: string, m: MonsterDefinition): string[] {
  const e: string[] = [];
  for (const key of ["lifeMult", "damageMult", "attacksPerSecond", "xpMult"] as const) {
    if (!(m[key] > 0)) e.push(`${where}: ${key} must be positive`);
  }
  if (!(m.armorMult >= 0)) e.push(`${where}: negative armorMult`);
  const split = Object.entries(m.damageSplit);
  if (split.some(([type, f]) => !DAMAGE_TYPES.includes(type as never) || !(f > 0))) e.push(`${where}: invalid damageSplit`);
  if (Math.abs(split.reduce((sum, [, f]) => sum + f, 0) - 1) > 1e-9) e.push(`${where}: damageSplit must sum to 1`);
  for (const [type, res] of Object.entries(m.resistances)) {
    if (!DAMAGE_TYPES.includes(type as never) || !(res >= -100 && res <= 100)) e.push(`${where}: invalid resistance ${type}`);
  }
  return e;
}

describe("data: monsters and zones", () => {
  it("monster and boss definitions are valid", () => {
    expectNoErrors([
      ...Object.values(MONSTERS).flatMap((m) => checkMonster(`monster ${m.id}`, m)),
      ...Object.values(BOSSES).flatMap((m) => checkMonster(`boss ${m.id}`, m)),
    ]);
  });

  it("zone pools and bosses resolve, and archetypes respect their minimum zone level", () => {
    const errors = Object.values(ZONES).flatMap((z) => [
      ...(z.monsterPool.length > 0 ? [] : [`zone ${z.id}: empty monster pool`]),
      ...z.monsterPool.flatMap((id) => checkReference(`zone ${z.id} pool`, id, MONSTERS)),
      ...z.monsterPool.flatMap((id) =>
        Object.hasOwn(MONSTERS, id) && MONSTERS[id].minZoneLevel > z.monsterLevel ? [`zone ${z.id}: ${id} is below its min zone level`] : [],
      ),
      ...checkReference(`zone ${z.id} boss`, z.bossId, BOSSES),
    ]);
    expectNoErrors(errors);
  });

  it("every boss belongs to exactly one zone", () => {
    expect(Object.values(ZONES).map((z) => z.bossId).sort()).toEqual(Object.keys(BOSSES).sort());
  });
});
