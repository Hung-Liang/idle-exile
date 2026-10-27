import { describe, expect, it } from "vitest";
import { ITEM_BASES } from "../src/data/item-bases";
import { resolveItem, type ItemInstance } from "../src/game/equipment";
import { collectBuild, computeDefenses } from "../src/game/stats";
import { createInitialState } from "../src/game/state";

function item(baseId: ItemInstance["baseId"], affixes: ItemInstance["affixes"], id = "i50"): ItemInstance {
  return { id, baseId, itemLevel: 40, rarity: "rare", affixes };
}

describe("resolveItem: local modifiers", () => {
  it("applies local flat and increased physical damage to the weapon base", () => {
    const resolved = resolveItem(
      item("iron_maul", [
        { affixId: "local_phys_flat_t3", values: [6] }, // [6, 11]
        { affixId: "local_phys_inc_t3", values: [30] },
      ]),
    );
    expect(resolved.weapon!.physical[0]).toBeCloseTo((8 + 6) * 1.3);
    expect(resolved.weapon!.physical[1]).toBeCloseTo((15 + 11) * 1.3);
    expect(resolved.globalMods).toEqual([]);
  });

  it("applies local attack speed and crit chance; local added elemental goes to the weapon", () => {
    const resolved = resolveItem(
      item("rusted_blade", [
        { affixId: "local_attack_speed_t2", values: [12] },
        { affixId: "crit_chance_weapon_t1", values: [40] },
        { affixId: "added_cold_weapon_t3", values: [6] },
      ]),
    );
    expect(resolved.weapon!.attacksPerSecond).toBeCloseTo(1.3 * 1.12);
    expect(resolved.weapon!.critChance).toBeCloseTo(5 * 1.4);
    expect(resolved.weapon!.added).toEqual({ cold: [6, 11] });
    expect(resolved.weapon!.physical).toEqual([4, 9]);
  });

  it("applies local armor to the item base and passes global modifiers through", () => {
    const resolved = resolveItem(
      item("quilted_vest", [
        { affixId: "armor_flat_t4", values: [10] },
        { affixId: "armor_inc_t4", values: [29] },
        { affixId: "life_t4", values: [15] },
      ]),
    );
    expect(resolved.armor).toBeCloseTo((20 + 10) * 1.29);
    expect(resolved.weapon).toBeUndefined();
    expect(resolved.globalMods).toEqual([{ stat: "life_max", kind: "flat", value: 15 }]);
  });

  it("does not let a ring's crit chance act locally", () => {
    const resolved = resolveItem(item("iron_band", [{ affixId: "crit_chance_t4", values: [15] }]));
    expect(resolved.globalMods).toEqual([{ stat: "crit_chance", kind: "increased", value: 15 }]);
  });
});

describe("collectBuild with items", () => {
  it("adds global item modifiers and armor from every equipped slot", () => {
    const state = createInitialState(1);
    const ring = item("iron_band", [{ affixId: "life_t4", values: [18] }], "i2");
    const vest = item("quilted_vest", [{ affixId: "res_fire_t4", values: [10] }], "i3");
    state.inventory.items[ring.id] = ring;
    state.inventory.items[vest.id] = vest;
    state.character.equipment.ring2 = ring.id;
    state.character.equipment.body = vest.id;
    state.nextItemId = 4;

    const defenses = computeDefenses(collectBuild(state));
    expect(defenses.maxLife).toBe(100 + 18);
    expect(defenses.armor).toBe(ITEM_BASES.quilted_vest.armor);
    expect(defenses.resistances.fire).toBe(10);
  });

  it("falls back to unarmed values without a weapon", () => {
    const state = createInitialState(1);
    state.inventory.order.push(state.character.equipment.weapon!);
    state.character.equipment.weapon = null;
    expect(collectBuild(state).weapon).toEqual({ physical: [5, 8], attacksPerSecond: 1, critChance: 5 });
  });
});
