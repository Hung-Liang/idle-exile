import { describe, expect, it } from "vitest";
import { getAffixDefinition } from "../src/data/affixes";
import { CURRENCIES, type CurrencyId } from "../src/data/currencies";
import { AFFIX_CATEGORY_LIMITS } from "../src/data/drop-tables";
import { canApplyCurrency } from "../src/game/crafting";
import { dispatch } from "../src/game/engine";
import type { ItemInstance, Rarity } from "../src/game/equipment";
import { generateItem } from "../src/game/loot";
import { createStreamState } from "../src/game/random";
import { collectBuild, computeDefenses } from "../src/game/stats";
import { createInitialState, type GameState } from "../src/game/state";
import { validateState } from "../src/game/validate";

const CURRENCY_IDS = Object.keys(CURRENCIES) as CurrencyId[];

function setup(rarity: Rarity, seed = 1, itemLevel = 40): { state: GameState; item: ItemInstance } {
  const state = createInitialState(seed);
  for (const id of CURRENCY_IDS) state.inventory.currency[id] = 1;
  const item = generateItem(state, itemLevel, rarity, createStreamState(seed, "loot"));
  state.inventory.items[item.id] = item;
  state.inventory.order.push(item.id);
  return { state, item };
}

function expectValid(state: GameState): void {
  const result = validateState(state);
  expect(result.ok ? [] : result.errors).toEqual([]);
}

function categoryCounts(item: ItemInstance): { prefix: number; suffix: number } {
  const counts = { prefix: 0, suffix: 0 };
  for (const a of item.affixes) counts[getAffixDefinition(a.affixId).category] += 1;
  return counts;
}

describe("canApplyCurrency", () => {
  it("matches the valid targets of plan §9.3", () => {
    const item = (rarity: Rarity, affixCount = 1): ItemInstance => ({
      id: "i9",
      baseId: "iron_band",
      itemLevel: 1,
      rarity,
      affixes: Array.from({ length: affixCount }, () => ({ affixId: "life_t4", values: [10] })),
    });
    const table = (target: ItemInstance) => CURRENCY_IDS.filter((id) => canApplyCurrency(target, id));
    expect(table(item("normal", 0))).toEqual(["kindle_shard"]);
    expect(table(item("magic"))).toEqual(["flux_shard", "ascend_shard", "temper_shard", "sever_shard", "cleanse_shard"]);
    expect(table(item("rare"))).toEqual(["temper_shard", "graft_shard", "tumult_shard", "sever_shard", "cleanse_shard"]);
    expect(table(item("magic", 0))).toEqual(["flux_shard", "ascend_shard", "cleanse_shard"]);
  });
});

describe("use_currency", () => {
  it("Kindle turns a Normal item Magic with 1–2 affixes", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { state, item } = setup("normal", seed);
      expect(dispatch(state, { type: "use_currency", currencyId: "kindle_shard", itemId: item.id }).ok).toBe(true);
      expect(item.rarity).toBe("magic");
      expect(item.affixes.length).toBeGreaterThanOrEqual(1);
      expect(item.affixes.length).toBeLessThanOrEqual(2);
      expect(state.inventory.currency.kindle_shard).toBe(0);
      expectValid(state);
    }
  });

  it("Flux rerolls a Magic item's affixes and keeps it Magic", () => {
    const { state, item } = setup("magic", 3);
    const before = structuredClone(item.affixes);
    let changed = false;
    for (let i = 0; i < 10; i++) {
      state.inventory.currency.flux_shard = 1;
      expect(dispatch(state, { type: "use_currency", currencyId: "flux_shard", itemId: item.id }).ok).toBe(true);
      expect(item.rarity).toBe("magic");
      const counts = categoryCounts(item);
      expect(counts.prefix).toBeLessThanOrEqual(AFFIX_CATEGORY_LIMITS.magic.prefix);
      expect(counts.suffix).toBeLessThanOrEqual(AFFIX_CATEGORY_LIMITS.magic.suffix);
      changed ||= JSON.stringify(item.affixes) !== JSON.stringify(before);
      expectValid(state);
    }
    expect(changed).toBe(true);
  });

  it("Ascend turns Magic into Rare, keeping the affixes and adding one", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { state, item } = setup("magic", seed);
      const before = structuredClone(item.affixes);
      expect(dispatch(state, { type: "use_currency", currencyId: "ascend_shard", itemId: item.id }).ok).toBe(true);
      expect(item.rarity).toBe("rare");
      expect(item.affixes.slice(0, before.length)).toEqual(before);
      expect(item.affixes).toHaveLength(before.length + 1);
      expectValid(state);
    }
  });

  it("Temper rerolls values within range and keeps every affix", () => {
    const { state, item } = setup("rare", 5);
    const ids = item.affixes.map((a) => a.affixId);
    expect(dispatch(state, { type: "use_currency", currencyId: "temper_shard", itemId: item.id }).ok).toBe(true);
    expect(item.affixes.map((a) => a.affixId)).toEqual(ids);
    expect(item.rarity).toBe("rare");
    expectValid(state);
  });

  it("Graft adds one affix to a Rare, keeping the others, until no slot is left", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { state, item } = setup("rare", seed);
      state.inventory.currency.graft_shard = 10;
      while (canApplyCurrency(item, "graft_shard")) {
        const before = structuredClone(item.affixes);
        expect(dispatch(state, { type: "use_currency", currencyId: "graft_shard", itemId: item.id }).ok).toBe(true);
        expect(item.affixes.slice(0, before.length)).toEqual(before);
        expect(item.affixes).toHaveLength(before.length + 1);
        expectValid(state);
      }
      // Full, or no eligible affix left for the open category.
      const limits = AFFIX_CATEGORY_LIMITS.rare;
      expect(item.affixes.length).toBeLessThanOrEqual(limits.prefix + limits.suffix);
      expect(dispatch(state, { type: "use_currency", currencyId: "graft_shard", itemId: item.id })).toEqual({ ok: false, reason: "invalid_target" });
    }
  });

  it("rejects invalid targets without consuming currency or changing anything", () => {
    const cases: [Rarity, CurrencyId][] = [
      ["normal", "flux_shard"],
      ["normal", "ascend_shard"],
      ["normal", "temper_shard"],
      ["magic", "kindle_shard"],
      ["rare", "kindle_shard"],
      ["rare", "flux_shard"],
      ["rare", "ascend_shard"],
      ["normal", "graft_shard"],
      ["magic", "graft_shard"],
    ];
    for (const [rarity, currencyId] of cases) {
      const { state, item } = setup(rarity);
      const before = structuredClone(state);
      expect(dispatch(state, { type: "use_currency", currencyId, itemId: item.id })).toEqual({ ok: false, reason: "invalid_target" });
      expect(state).toEqual(before);
    }
  });

  it("rejects missing currency and unknown items", () => {
    const { state, item } = setup("normal");
    state.inventory.currency.kindle_shard = 0;
    expect(dispatch(state, { type: "use_currency", currencyId: "kindle_shard", itemId: item.id })).toEqual({ ok: false, reason: "no_currency" });
    expect(dispatch(state, { type: "use_currency", currencyId: "kindle_shard", itemId: "i999" })).toEqual({ ok: false, reason: "item_not_found" });
  });

  it("works on equipped items and changes the build", () => {
    const state = createInitialState(2);
    state.inventory.currency.kindle_shard = 1;
    const weaponId = state.character.equipment.weapon!;
    const before = collectBuild(state);
    expect(dispatch(state, { type: "use_currency", currencyId: "kindle_shard", itemId: weaponId }).ok).toBe(true);
    expect(state.inventory.items[weaponId]!.rarity).toBe("magic");
    expect(collectBuild(state)).not.toEqual(before);
    expect(state.character.life).toBeLessThanOrEqual(computeDefenses(collectBuild(state)).maxLife);
    expectValid(state);
  });

  it("consumes only the craft stream", () => {
    const { state, item } = setup("magic", 4);
    const before = structuredClone(state.rng);
    dispatch(state, { type: "use_currency", currencyId: "ascend_shard", itemId: item.id });
    expect({ ...state.rng, craft: null }).toEqual({ ...before, craft: null });
    expect(state.rng.craft).not.toEqual(before.craft);
  });
});

describe("v0.5.0 currencies", () => {
  it("Tumult rerolls a Rare into a new Rare with 4–6 affixes", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { state, item } = setup("rare", seed);
      const before = structuredClone(item.affixes);
      expect(dispatch(state, { type: "use_currency", currencyId: "tumult_shard", itemId: item.id }).ok).toBe(true);
      expect(item.rarity).toBe("rare");
      expect(item.affixes.length).toBeGreaterThanOrEqual(4);
      expect(item.affixes.length).toBeLessThanOrEqual(6);
      expect(item.affixes).not.toEqual(before);
      expect(state.inventory.currency.tumult_shard).toBe(0);
      expectValid(state);
    }
  });

  it("Sever removes exactly one existing affix and keeps the rest", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { state, item } = setup(seed % 2 === 0 ? "rare" : "magic", seed);
      const before = item.affixes.map((a) => a.affixId);
      const rarity = item.rarity;
      expect(dispatch(state, { type: "use_currency", currencyId: "sever_shard", itemId: item.id }).ok).toBe(true);
      const after = item.affixes.map((a) => a.affixId);
      expect(after.length).toBe(before.length - 1);
      expect(after.every((id) => before.includes(id))).toBe(true);
      expect(item.rarity).toBe(rarity);
      expectValid(state);
    }
  });

  it("Cleanse turns a Magic or Rare item Normal", () => {
    for (const rarity of ["magic", "rare"] as const) {
      const { state, item } = setup(rarity);
      expect(dispatch(state, { type: "use_currency", currencyId: "cleanse_shard", itemId: item.id }).ok).toBe(true);
      expect(item.rarity).toBe("normal");
      expect(item.affixes).toEqual([]);
      expectValid(state);
    }
  });

  it("only Temper is valid on a unique, and it keeps the unique's lines", () => {
    const { state, item } = setup("unique", 3);
    expect(item.rarity).toBe("unique");
    expect(CURRENCY_IDS.filter((id) => canApplyCurrency(item, id))).toEqual(["temper_shard"]);
    const ids = item.affixes.map((a) => a.affixId);
    state.inventory.currency.temper_shard = 50;
    for (let i = 0; i < 50; i++) {
      expect(dispatch(state, { type: "use_currency", currencyId: "temper_shard", itemId: item.id }).ok).toBe(true);
    }
    expect(item.affixes.map((a) => a.affixId)).toEqual(ids);
    expectValid(state);
  });
});
