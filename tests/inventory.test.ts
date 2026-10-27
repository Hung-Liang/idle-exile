import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { INVENTORY_CAPACITY } from "../src/data/balance";
import { CURRENCIES, type CurrencyId } from "../src/data/currencies";
import { EQUIP_SLOTS, type ItemInstance } from "../src/game/equipment";
import { advance, dispatch, type PlayerAction } from "../src/game/engine";
import { generateItem } from "../src/game/loot";
import { computeMaxLife } from "../src/game/stats";
import { createInitialState, type GameState } from "../src/game/state";
import { validateState } from "../src/game/validate";

function expectValid(state: GameState): void {
  const result = validateState(state);
  expect(result.ok ? [] : result.errors).toEqual([]);
}

function addItem(state: GameState, item: Omit<ItemInstance, "id">): string {
  const id = `i${state.nextItemId++}`;
  state.inventory.items[id] = { ...item, id };
  state.inventory.order.push(id);
  return id;
}

describe("equip_item", () => {
  it("swaps with the equipped item, which takes the new item's place in the order", () => {
    const state = createInitialState(1);
    const first = addItem(state, { baseId: "iron_band", itemLevel: 1, rarity: "normal", affixes: [] });
    const maul = addItem(state, { baseId: "iron_maul", itemLevel: 1, rarity: "normal", affixes: [] });
    const oldWeapon = state.character.equipment.weapon;
    expect(dispatch(state, { type: "equip_item", itemId: maul })).toMatchObject({ ok: true });
    expect(state.character.equipment.weapon).toBe(maul);
    expect(state.inventory.order).toEqual([first, oldWeapon]);
    expectValid(state);
  });

  it("fills an empty ring slot first, and honours an explicit slot", () => {
    const state = createInitialState(1);
    const a = addItem(state, { baseId: "iron_band", itemLevel: 1, rarity: "normal", affixes: [] });
    const b = addItem(state, { baseId: "iron_band", itemLevel: 1, rarity: "normal", affixes: [] });
    const c = addItem(state, { baseId: "iron_band", itemLevel: 1, rarity: "normal", affixes: [] });
    dispatch(state, { type: "equip_item", itemId: a });
    dispatch(state, { type: "equip_item", itemId: b });
    expect([state.character.equipment.ring1, state.character.equipment.ring2]).toEqual([a, b]);
    dispatch(state, { type: "equip_item", itemId: c, slot: "ring2" });
    expect(state.character.equipment.ring2).toBe(c);
    expect(state.inventory.order).toEqual([b]);
    expectValid(state);
  });

  it("rejects wrong slots, level requirements and unknown or equipped items", () => {
    const state = createInitialState(1);
    const sabre = addItem(state, { baseId: "tempered_sabre", itemLevel: 12, rarity: "normal", affixes: [] });
    const band = addItem(state, { baseId: "iron_band", itemLevel: 1, rarity: "normal", affixes: [] });
    expect(dispatch(state, { type: "equip_item", itemId: sabre })).toEqual({ ok: false, reason: "level_too_low" });
    expect(dispatch(state, { type: "equip_item", itemId: band, slot: "weapon" })).toEqual({ ok: false, reason: "invalid_slot" });
    expect(dispatch(state, { type: "equip_item", itemId: "i999" })).toEqual({ ok: false, reason: "item_not_found" });
    expect(dispatch(state, { type: "equip_item", itemId: state.character.equipment.weapon! })).toEqual({
      ok: false,
      reason: "item_not_found",
    });
    state.character.level = 12;
    expect(dispatch(state, { type: "equip_item", itemId: sabre })).toMatchObject({ ok: true });
  });

  it("clamps life when max life drops, and does not heal when it rises", () => {
    const state = createInitialState(1);
    const ring = addItem(state, { baseId: "iron_band", itemLevel: 1, rarity: "magic", affixes: [{ affixId: "life_t4", values: [19] }] });
    state.character.life = 50;
    dispatch(state, { type: "equip_item", itemId: ring });
    expect(computeMaxLife(state)).toBe(119);
    expect(state.character.life).toBe(50);
    state.character.life = 119;
    dispatch(state, { type: "unequip_slot", slot: "ring1" });
    expect(state.character.life).toBe(100);
  });
});

describe("unequip_slot and salvage_item", () => {
  it("unequips into the inventory unless it is full or the slot is empty", () => {
    const state = createInitialState(1);
    expect(dispatch(state, { type: "unequip_slot", slot: "helmet" })).toEqual({ ok: false, reason: "slot_empty" });
    for (let i = 0; i < INVENTORY_CAPACITY; i++) addItem(state, { baseId: "iron_band", itemLevel: 1, rarity: "normal", affixes: [] });
    expect(dispatch(state, { type: "unequip_slot", slot: "weapon" })).toEqual({ ok: false, reason: "inventory_full" });
    dispatch(state, { type: "salvage_item", itemId: state.inventory.order[0]! });
    expect(dispatch(state, { type: "unequip_slot", slot: "weapon" })).toMatchObject({ ok: true });
    expect(state.character.equipment.weapon).toBeNull();
    expectValid(state);
  });

  it("salvages only unequipped items and credits the yield", () => {
    const state = createInitialState(1);
    const id = addItem(state, { baseId: "iron_band", itemLevel: 1, rarity: "magic", affixes: [{ affixId: "life_t4", values: [10] }] });
    expect(dispatch(state, { type: "salvage_item", itemId: state.character.equipment.weapon! })).toEqual({
      ok: false,
      reason: "item_not_found",
    });
    const result = dispatch(state, { type: "salvage_item", itemId: id });
    expect(result.ok).toBe(true);
    expect(state.inventory.items[id]).toBeUndefined();
    expect(state.inventory.currency.kindle_shard).toBe(1);
    expectValid(state);
  });
});

describe("set_loot_filter", () => {
  it("accepts valid rules and rejects invalid ones without changing the filter", () => {
    const state = createInitialState(1);
    const rules = [{ minRarity: "rare" as const, action: "keep" as const }, { action: "salvage" as const }];
    expect(dispatch(state, { type: "set_loot_filter", rules })).toMatchObject({ ok: true });
    expect(state.settings.lootFilter).toEqual(rules);
    const bad = [{ action: "destroy" }] as unknown as typeof rules;
    expect(dispatch(state, { type: "set_loot_filter", rules: bad })).toEqual({ ok: false, reason: "invalid_filter" });
    expect(state.settings.lootFilter).toEqual(rules);
  });
});

describe("property: any sequence of actions keeps the state consistent", () => {
  it("life ≤ max life, every item exactly once, currency ≥ 0", () => {
    const action = fc.oneof(
      fc.record({ kind: fc.constant("advance" as const), ms: fc.integer({ min: 0, max: 120_000 }) }),
      fc.record({ kind: fc.constant("equip" as const), pick: fc.nat(), slot: fc.option(fc.constantFrom(...EQUIP_SLOTS), { nil: undefined }) }),
      fc.record({ kind: fc.constant("unequip" as const), slot: fc.constantFrom(...EQUIP_SLOTS) }),
      fc.record({ kind: fc.constant("salvage" as const), pick: fc.nat() }),
      fc.record({ kind: fc.constant("loot" as const), ilvl: fc.integer({ min: 1, max: 45 }), rarity: fc.constantFrom("normal", "magic", "rare" as const) }),
      fc.record({ kind: fc.constant("craft" as const), pick: fc.nat(), currencyId: fc.constantFrom(...(Object.keys(CURRENCIES) as CurrencyId[])) }),
      fc.record({ kind: fc.constant("map" as const), tier: fc.integer({ min: 0, max: 3 }) }),
    );
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), fc.array(action, { maxLength: 30 }), (seed, actions) => {
        const state = createInitialState(seed);
        state.character.level = 20;
        state.character.supportIds = [null, null];
        state.progression.unlockedMapTier = 2;
        for (const id of Object.keys(CURRENCIES) as CurrencyId[]) state.inventory.currency[id] = 3;
        for (const a of actions) {
          const order = state.inventory.order;
          let playerAction: PlayerAction | null = null;
          switch (a.kind) {
            case "advance":
              advance(state, a.ms);
              break;
            case "equip":
              if (order.length > 0) playerAction = { type: "equip_item", itemId: order[a.pick % order.length]!, ...(a.slot ? { slot: a.slot } : {}) };
              break;
            case "unequip":
              playerAction = { type: "unequip_slot", slot: a.slot };
              break;
            case "salvage":
              if (order.length > 0) playerAction = { type: "salvage_item", itemId: order[a.pick % order.length]! };
              break;
            case "craft": {
              const ids = Object.keys(state.inventory.items);
              playerAction = { type: "use_currency", currencyId: a.currencyId, itemId: ids[a.pick % ids.length]! };
              break;
            }
            case "map":
              playerAction = { type: "start_map", tier: a.tier };
              break;
            case "loot": {
              const item = generateItem(state, a.ilvl, a.rarity, state.rng.loot);
              if (order.length < INVENTORY_CAPACITY) {
                state.inventory.items[item.id] = item;
                order.push(item.id);
              }
              break;
            }
          }
          if (playerAction !== null) dispatch(state, playerAction);
          expect(state.character.life).toBeLessThanOrEqual(computeMaxLife(state));
          expectValid(state);
        }
      }),
      { numRuns: 100 },
    );
  });
});
