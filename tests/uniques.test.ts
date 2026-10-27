import { describe, expect, it } from "vitest";
import { getAffixDefinition, isUniqueAffix } from "../src/data/affixes";
import { DROP_TABLES } from "../src/data/drop-tables";
import { ITEM_BASES } from "../src/data/item-bases";
import { uniqueDropLevel, UNIQUES, type UniqueId } from "../src/data/uniques";
import { generateAffixes } from "../src/game/affixes";
import { itemModifierSpecs, resolveItem, type ItemInstance } from "../src/game/equipment";
import type { GameEvent } from "../src/game/events";
import { createUniqueItem, describeItem, eligibleUniques, generateItem, rollMonsterDrops } from "../src/game/loot";
import { createStreamState } from "../src/game/random";
import { parseSave, serializeSave } from "../src/game/save";
import { createInitialState, type GameState } from "../src/game/state";
import { validateState } from "../src/game/validate";

const UNIQUE_IDS = Object.keys(UNIQUES) as UniqueId[];

function withItem(item: ItemInstance, state = createInitialState(1)): GameState {
  state.inventory.items[item.id] = item;
  state.inventory.order.push(item.id);
  return state;
}

function errors(state: GameState): string[] {
  const result = validateState(state);
  return result.ok ? [] : result.errors;
}

describe("unique data", () => {
  it("every unique has lines with ordered ranges on an existing base", () => {
    for (const def of Object.values(UNIQUES)) {
      expect(ITEM_BASES[def.baseId]).toBeDefined();
      expect(def.lines.length).toBeGreaterThan(0);
      expect(def.weight).toBeGreaterThan(0);
      for (const line of def.lines) {
        expect(Number.isInteger(line.range[0]) && Number.isInteger(line.range[1])).toBe(true);
        expect(line.range[0]).toBeLessThanOrEqual(line.range[1]);
      }
    }
  });

  it("unique lines are never drawn as random affixes", () => {
    const rng = createStreamState(7, "loot");
    for (let i = 0; i < 500; i++) {
      for (const affix of generateAffixes("weapon", 60, "rare", rng)) {
        expect(isUniqueAffix(affix.affixId)).toBe(false);
      }
    }
  });
});

describe("unique items", () => {
  it("every unique rolls into a valid item that survives a save round trip", () => {
    const state = createInitialState(2);
    const rng = createStreamState(2, "loot");
    for (const id of UNIQUE_IDS) withItem(createUniqueItem(state, id, 60, rng), state);
    expect(errors(state)).toEqual([]);
    const parsed = parseSave(serializeSave(state, { savedAt: 1, lastActiveAt: 1 }));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.state.inventory.items).toEqual(state.inventory.items);
  });

  it("carries its lines' modifiers, including conditions, tags and local stats", () => {
    const state = createInitialState(1);
    const rng = createStreamState(1, "loot");
    const blade = createUniqueItem(state, "patient_blade", 30, rng);
    expect(itemModifierSpecs(blade).some((s) => s.condition?.kind === "enemy_life_below_pct")).toBe(true);
    const crown = createUniqueItem(state, "sundered_crown", 40, rng);
    expect(itemModifierSpecs(crown).find((s) => s.stat === "penetration")?.tags).toEqual(["elemental"]);
    // The local physical line scales the base's own damage, not the global pool.
    const resolved = resolveItem(blade);
    expect(resolved.weapon!.physical[0]).toBeGreaterThan(ITEM_BASES.duelist_rapier.weapon!.physical[0]);
    expect(resolved.globalMods.some((s) => s.local === true)).toBe(false);
  });

  it("describes a unique by name", () => {
    const item = createUniqueItem(createInitialState(1), "emberbrand", 20, createStreamState(1, "loot"));
    expect(describeItem(item)).toBe("Emberbrand, Tempered Sabre (ilvl 20)");
  });

  it("only drops at or above its drop level", () => {
    expect(eligibleUniques(1).map((e) => e.id)).toEqual(UNIQUE_IDS.filter((id) => uniqueDropLevel(UNIQUES[id]) <= 1));
    expect(eligibleUniques(60).map((e) => e.id)).toEqual(UNIQUE_IDS);
    const state = createInitialState(1);
    const rng = createStreamState(4, "loot");
    for (let i = 0; i < 200; i++) {
      const item = generateItem(state, 12, "unique", rng);
      expect(item.rarity).toBe("unique");
      expect(uniqueDropLevel(UNIQUES[item.uniqueId!])).toBeLessThanOrEqual(12);
    }
  });

  it("drop tables give bosses a higher unique weight than normal monsters", () => {
    expect(DROP_TABLES.boss.rarityWeights.unique).toBeGreaterThan(DROP_TABLES.normal.rarityWeights.unique);
    const state = createInitialState(9);
    state.settings.lootFilter = [{ action: "keep" }];
    const events: GameEvent[] = [];
    for (let i = 0; i < 400; i++) rollMonsterDrops(state, 40, true, { quantityPct: 0, rarityPct: 0 }, events);
    const uniques = events.filter((e) => e.type === "item_dropped" && e.rarity === "unique");
    expect(uniques.length).toBeGreaterThan(0);
    expect(errors(state)).toEqual([]);
  });
});

describe("unique validation", () => {
  const make = () => createUniqueItem(createInitialState(1), "leechgrip", 20, createStreamState(1, "loot"));

  it("rejects a unique without a known uniqueId", () => {
    const item = make();
    delete item.uniqueId;
    expect(errors(withItem(item)).join()).toContain("uniqueId");
  });

  it("rejects a uniqueId on a non-unique item", () => {
    const item = make();
    item.rarity = "rare";
    expect(errors(withItem(item)).length).toBeGreaterThan(0);
  });

  it("rejects the wrong base, missing lines, reordered lines and out-of-range values", () => {
    const wrongBase = { ...make(), baseId: "wool_gloves" as const };
    expect(errors(withItem(wrongBase)).join()).toContain("baseId");

    const missing = make();
    missing.affixes.pop();
    expect(errors(withItem(missing)).join()).toContain("unique lines");

    const reordered = make();
    reordered.affixes.reverse();
    expect(errors(withItem(reordered)).length).toBeGreaterThan(0);

    const outOfRange = make();
    const range = getAffixDefinition(outOfRange.affixes[0]!.affixId).modifiers[0]!.range;
    outOfRange.affixes[0]!.values = [range[1] + 1];
    expect(errors(withItem(outOfRange)).length).toBeGreaterThan(0);
  });

  it("rejects unique lines on a Rare", () => {
    const item: ItemInstance = { id: "i50", baseId: "riveted_gloves", itemLevel: 20, rarity: "rare", affixes: [{ affixId: "leechgrip_0", values: [8] }] };
    expect(errors(withItem(item)).join()).toContain("unknown affix");
  });
});
