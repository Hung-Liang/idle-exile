import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { INVENTORY_CAPACITY } from "../src/data/balance";
import { ITEM_BASES } from "../src/data/item-bases";
import { formatItemId, type ItemInstance } from "../src/game/equipment";
import type { GameEvent } from "../src/game/events";
import { filterAction, ruleMatches } from "../src/game/loot-filter";
import { generateItem, receiveItem, rollItemBase, rollMonsterDrops, salvageYield } from "../src/game/loot";
import { createStreamState } from "../src/game/random";
import { createInitialState, type GameState, type LootFilterRule } from "../src/game/state";
import { validateState } from "../src/game/validate";

const NO_BONUS = { quantityPct: 0, rarityPct: 0 };
const noUpgrade = () => false;

function expectValid(state: GameState): void {
  const result = validateState(state);
  expect(result.ok ? [] : result.errors).toEqual([]);
}

function ring(rarity: ItemInstance["rarity"], affixes: ItemInstance["affixes"] = [], itemLevel = 10): ItemInstance {
  return { id: "i99", baseId: "iron_band", itemLevel, rarity, affixes };
}

describe("rollItemBase", () => {
  it("only picks bases whose required level fits the item level", () => {
    const rng = createStreamState(1, "loot");
    for (let i = 0; i < 500; i++) {
      expect(ITEM_BASES[rollItemBase(11, rng)].requiredLevel).toBe(1);
    }
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(ITEM_BASES[rollItemBase(40, rng)].requiredLevel);
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 12, 25, 38]);
  });
});

describe("generateItem", () => {
  it("property: generated items are always valid in a state", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 1, max: 60 }),
        fc.constantFrom("normal", "magic", "rare" as const),
        (seed, itemLevel, rarity) => {
          const state = createInitialState(seed);
          const item = generateItem(state, itemLevel, rarity, state.rng.loot);
          expect(item.id).toBe(formatItemId(2));
          expect(state.nextItemId).toBe(3);
          state.inventory.items[item.id] = item;
          state.inventory.order.push(item.id);
          expectValid(state);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("loot filter", () => {
  it("default filter keeps magic and rare, salvages normal", () => {
    const rules = createInitialState(1).settings.lootFilter;
    expect(filterAction(rules, ring("normal"), noUpgrade)).toBe("salvage");
    expect(filterAction(rules, ring("magic"), noUpgrade)).toBe("keep");
    expect(filterAction(rules, ring("rare"), noUpgrade)).toBe("keep");
  });

  it("first matching rule wins; no match keeps", () => {
    const item = ring("rare", [{ affixId: "life_t4", values: [12] }]);
    expect(filterAction([{ slots: ["ring2"], action: "salvage" }, { action: "keep" }], item, noUpgrade)).toBe("salvage");
    expect(filterAction([{ slots: ["weapon"], action: "salvage" }], item, noUpgrade)).toBe("keep");
    expect(filterAction([], item, noUpgrade)).toBe("keep");
  });

  it("matches item level and stats", () => {
    const item = ring("magic", [{ affixId: "res_cold_t4", values: [8] }], 10);
    expect(ruleMatches({ minItemLevel: 10, action: "keep" }, item, noUpgrade)).toBe(true);
    expect(ruleMatches({ minItemLevel: 11, action: "keep" }, item, noUpgrade)).toBe(false);
    expect(ruleMatches({ hasStat: ["life_max", "resistance"], action: "keep" }, item, noUpgrade)).toBe(true);
    expect(ruleMatches({ hasStat: ["life_max"], action: "keep" }, item, noUpgrade)).toBe(false);
    expect(ruleMatches({ minRarity: "rare", action: "keep" }, item, noUpgrade)).toBe(false);
  });

  it("evaluates the upgrade condition last and at most once per item", () => {
    const item = ring("magic");
    let calls = 0;
    const upgrade = () => {
      calls += 1;
      return true;
    };
    const rules: LootFilterRule[] = [
      { minRarity: "rare", upgrade: true, action: "keep" },
      { upgrade: true, slots: ["ring1"], action: "salvage" },
      { upgrade: true, action: "keep" },
    ];
    expect(filterAction(rules, item, upgrade)).toBe("salvage");
    expect(calls).toBe(1);
    expect(filterAction([{ upgrade: true, action: "salvage" }], item, noUpgrade)).toBe("keep");
  });
});

describe("receiveItem: upgrade rule", () => {
  it("keeps only items that would improve the current build", () => {
    const state = createInitialState(1);
    state.settings.lootFilter = [{ upgrade: true, action: "keep" }, { action: "salvage" }];
    const events: GameEvent[] = [];
    const lifeRing: ItemInstance = { ...ring("magic", [{ affixId: "life_t4", values: [15] }]), id: formatItemId(state.nextItemId++) };
    receiveItem(state, lifeRing, events);
    expect(state.inventory.order).toEqual([lifeRing.id]);

    // Both ring slots now hold a better ring.
    state.inventory.order = [];
    const other = formatItemId(state.nextItemId++);
    state.inventory.items[other] = { ...lifeRing, id: other };
    state.character.equipment.ring1 = lifeRing.id;
    state.character.equipment.ring2 = other;
    const worse: ItemInstance = { ...ring("magic", [{ affixId: "life_t4", values: [10] }]), id: formatItemId(state.nextItemId++) };
    receiveItem(state, worse, events);
    expect(state.inventory.order).toEqual([]);
  });
});

describe("receiveItem", () => {
  it("keeps, salvages, or overflows according to the filter and capacity", () => {
    const state = createInitialState(1);
    const events: GameEvent[] = [];

    const kept = generateItem(state, 5, "magic", state.rng.loot);
    receiveItem(state, kept, events);
    expect(state.inventory.order).toEqual([kept.id]);

    const salvaged = generateItem(state, 5, "normal", state.rng.loot);
    receiveItem(state, salvaged, events);
    expect(state.inventory.items[salvaged.id]).toBeUndefined();

    for (let i = state.inventory.order.length; i < INVENTORY_CAPACITY; i++) {
      receiveItem(state, generateItem(state, 5, "rare", state.rng.loot), events);
    }
    expect(state.inventory.order).toHaveLength(INVENTORY_CAPACITY);
    const overflow = generateItem(state, 5, "rare", state.rng.loot);
    receiveItem(state, overflow, events);
    expect(state.inventory.items[overflow.id]).toBeUndefined();
    expect(state.inventory.currency.flux_shard).toBeGreaterThanOrEqual(1);

    const outcomes = events.filter((e) => e.type === "item_dropped").map((e) => e.outcome);
    expect(outcomes[0]).toBe("kept");
    expect(outcomes[1]).toBe("salvaged");
    expect(outcomes.at(-1)).toBe("overflow");
    expect(state.log.at(-1)!.text).toContain("Inventory full");
    expectValid(state);
  });
});

describe("salvageYield", () => {
  it("rare items always yield a Flux Shard and roll the rest from the craft stream", () => {
    const state = createInitialState(1);
    const lootBefore = [...state.rng.loot];
    const craftBefore = [...state.rng.craft];
    const gained = salvageYield(state, ring("rare"), []);
    expect(gained.flux_shard).toBe(1);
    expect(state.rng.loot).toEqual(lootBefore);
    expect(state.rng.craft).not.toEqual(craftBefore);
  });

  it("matches the documented rates over many salvages", () => {
    const state = createInitialState(2);
    const n = 20_000;
    for (let i = 0; i < n; i++) salvageYield(state, ring("normal"), []);
    expect(state.inventory.currency.kindle_shard / n).toBeCloseTo(0.2, 1);
  });
});

describe("rollMonsterDrops", () => {
  it("bosses drop three items and two currencies at monster level + 2", () => {
    const state = createInitialState(3);
    state.settings.lootFilter = [{ action: "keep" }];
    const events: GameEvent[] = [];
    rollMonsterDrops(state, 8, true, NO_BONUS, events);
    const items = state.inventory.order.map((id) => state.inventory.items[id]!);
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.itemLevel === 10)).toBe(true);
    const currency = events.filter((e) => e.type === "currency_gained");
    expect(currency).toHaveLength(2);
    expectValid(state);
  });

  it("normal monsters drop an item about 10% and currency about 6% of the time", () => {
    const state = createInitialState(4);
    state.settings.lootFilter = [{ action: "keep" }];
    const n = 20_000;
    let items = 0;
    let currency = 0;
    for (let i = 0; i < n; i++) {
      const events: GameEvent[] = [];
      rollMonsterDrops(state, 1, false, NO_BONUS, events);
      items += events.filter((e) => e.type === "item_dropped").length;
      currency += events.filter((e) => e.type === "currency_gained").length;
      // Keep the inventory from overflowing.
      for (const id of state.inventory.order.splice(0)) delete state.inventory.items[id];
    }
    expect(items / n).toBeCloseTo(0.1, 1);
    expect(currency / n).toBeCloseTo(0.06, 1);
  });

  it("item quantity adds extra boss items", () => {
    const state = createInitialState(5);
    state.settings.lootFilter = [{ action: "keep" }];
    rollMonsterDrops(state, 40, true, { quantityPct: 40, rarityPct: 0 }, []);
    expect(state.inventory.order).toHaveLength(4);
  });

  it("uses only the loot stream when nothing is salvaged", () => {
    const state = createInitialState(6);
    state.settings.lootFilter = [{ action: "keep" }];
    const before = structuredClone(state.rng);
    rollMonsterDrops(state, 5, true, NO_BONUS, []);
    expect(state.rng.loot).not.toEqual(before.loot);
    expect({ ...state.rng, loot: before.loot }).toEqual(before);
  });
});
