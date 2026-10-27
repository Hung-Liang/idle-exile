import { describe, expect, it } from "vitest";
import { CURRENCIES } from "../src/data/currencies";
import { ITEM_BASES, STARTING_WEAPON_BASE } from "../src/data/item-bases";
import { MAP_MODIFIERS } from "../src/data/map-modifiers";
import { PASSIVE_EDGES, PASSIVE_NODES, PASSIVE_ROOT } from "../src/data/passive-tree";
import { SKILLS } from "../src/data/skills";
import { STACKS } from "../src/data/stacks";
import { SUPPORTS } from "../src/data/supports";
import { ZONE_ORDER, ZONES } from "../src/data/zones";
import { SUPPORT_SLOT_LEVELS, MAX_LEVEL } from "../src/data/balance";
import { ITEM_CLASSES } from "../src/game/equipment";
import {
  checkGlobalUniqueness,
  checkGraph,
  checkModifierSpecs,
  checkRecordIds,
  checkReference,
  checkTags,
} from "./helpers/data-checks";

const TABLES = {
  CURRENCIES,
  ITEM_BASES,
  MAP_MODIFIERS,
  PASSIVE_NODES,
  SKILLS,
  STACKS,
  SUPPORTS,
  ZONES,
};

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

  it("has 24 allocatable nodes plus the root", () => {
    const nodes = Object.values(PASSIVE_NODES);
    expect(nodes.filter((n) => n.kind === "root").map((n) => n.id)).toEqual([PASSIVE_ROOT]);
    expect(nodes.filter((n) => n.kind !== "root")).toHaveLength(24);
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

  it("currencies have positive drop weights", () => {
    expect(Object.values(CURRENCIES).every((c) => c.dropWeight > 0)).toBe(true);
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
