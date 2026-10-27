import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createInitialState, supportSlotCount } from "../src/game/state";
import { validateState } from "../src/game/validate";
import { CURRENT_SCHEMA_VERSION } from "../src/game/migrations";
import { EQUIP_SLOTS } from "../src/game/equipment";

/** True if the value contains only JSON-native data (no classes, Map/Set, functions, undefined, NaN). */
function isPlainJson(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isPlainJson);
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    return (proto === Object.prototype || proto === null) && Object.values(value).every(isPlainJson);
  }
  return false;
}

describe("createInitialState", () => {
  it("produces a valid state", () => {
    const result = validateState(createInitialState(1));
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it("is plain JSON data and survives a JSON round-trip unchanged", () => {
    const state = createInitialState(1);
    expect(isPlainJson(state)).toBe(true);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it("is deterministic per seed and differs between seeds", () => {
    expect(createInitialState(5)).toEqual(createInitialState(5));
    expect(createInitialState(5).rng).not.toEqual(createInitialState(6).rng);
  });

  it("is valid for any seed", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => validateState(createInitialState(seed)).ok));
  });

  it("starts a level-1 character with a Normal Rusted Blade equipped", () => {
    const state = createInitialState(1);
    expect(state.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(state.character.level).toBe(1);
    expect(state.character.life).toBe(100);
    const weaponId = state.character.equipment.weapon!;
    expect(state.inventory.items[weaponId]).toMatchObject({ baseId: "rusted_blade", rarity: "normal", affixes: [] });
    expect(state.inventory.order).toEqual([]);
    expect(state.nextItemId).toBe(2);
    expect(EQUIP_SLOTS.filter((s) => s !== "weapon").every((s) => state.character.equipment[s] === null)).toBe(true);
  });

  it("starts in the first zone with no encounter", () => {
    const state = createInitialState(1);
    expect(state.progression.activity).toEqual({ kind: "zone", zoneId: "ashen_outskirts" });
    expect(state.progression.unlockedMapTier).toBe(0);
    expect(state.encounter).toBeNull();
  });
});

describe("supportSlotCount", () => {
  it("unlocks slot 1 at level 3 and slot 2 at level 10", () => {
    expect([1, 2, 3, 9, 10, 50].map(supportSlotCount)).toEqual([0, 0, 1, 1, 2, 2]);
  });
});
