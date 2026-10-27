import { describe, expect, it } from "vitest";
import { createInitialState, type GameState } from "../src/game/state";
import { validateState } from "../src/game/validate";

function errorsAfter(mutate: (s: GameState) => void): string[] {
  const state = createInitialState(1);
  mutate(state);
  const result = validateState(state);
  return result.ok ? [] : result.errors;
}

function expectRejected(mutate: (s: GameState) => void, fragment: string): void {
  const errors = errorsAfter(mutate);
  expect(errors.some((e) => e.includes(fragment)), `expected an error containing "${fragment}", got ${JSON.stringify(errors)}`).toBe(true);
}

function addItem(s: GameState, n: number, baseId: GameState["inventory"]["items"][string]["baseId"] = "iron_band"): string {
  const id = `i${n}`;
  s.inventory.items[id] = { id, baseId, itemLevel: 1, rarity: "normal", affixes: [] };
  s.nextItemId = Math.max(s.nextItemId, n + 1);
  return id;
}

describe("validateState", () => {
  it("rejects non-objects", () => {
    expect(validateState(null).ok).toBe(false);
    expect(validateState([]).ok).toBe(false);
    expect(validateState("x").ok).toBe(false);
  });

  it("accepts a state whose encounter key is absent (persisted form)", () => {
    const { encounter: _omit, ...persisted } = createInitialState(1);
    expect(validateState(persisted).ok).toBe(true);
  });

  it("accepts a valid runtime encounter", () => {
    const errors = errorsAfter((s) => {
      s.encounter = {
        index: 0,
        isBoss: false,
        phase: "fighting",
        phaseEndsAt: 0,
        monsters: [{ defId: "brute", level: 1, life: 30, maxLife: 30, nextAttackAt: 1250, alive: true }],
        player: { nextAttackAt: 0 },
        stacks: { momentum: 0 },
      };
    });
    expect(errors).toEqual([]);
  });

  it("accepts unequipped items listed in order", () => {
    expect(errorsAfter((s) => s.inventory.order.push(addItem(s, 2)))).toEqual([]);
  });

  describe("item invariants", () => {
    it("rejects an item that is neither equipped nor listed", () => {
      expectRejected((s) => addItem(s, 2), "neither equipped nor in order");
    });

    it("rejects an equipped item that is also listed in order", () => {
      expectRejected((s) => s.inventory.order.push(s.character.equipment.weapon!), "equipped items must not be listed");
    });

    it("rejects duplicate ids in order", () => {
      expectRejected((s) => {
        const id = addItem(s, 2);
        s.inventory.order.push(id, id);
      }, "inventory.order: contains duplicates");
    });

    it("rejects an item equipped in two slots", () => {
      expectRejected((s) => {
        const id = addItem(s, 2);
        s.character.equipment.ring1 = id;
        s.character.equipment.ring2 = id;
      }, "character.equipment: contains duplicates");
    });

    it("rejects equipment references to missing items", () => {
      expectRejected((s) => (s.character.equipment.helmet = "i99"), "references missing item");
    });

    it("rejects an item in the wrong slot", () => {
      expectRejected((s) => {
        const id = addItem(s, 2, "iron_band");
        s.character.equipment.helmet = id;
      }, "cannot be equipped in helmet");
    });

    it("rejects a key / id mismatch", () => {
      expectRejected((s) => {
        addItem(s, 2);
        s.inventory.order.push("i2");
        s.inventory.items.i2!.id = "i3";
      }, "must equal its key");
    });

    it("rejects nextItemId that would reuse an existing id", () => {
      expectRejected((s) => (s.nextItemId = 1), "nextItemId");
    });

    it("rejects more than 60 unequipped items", () => {
      expectRejected((s) => {
        for (let n = 2; n <= 62; n++) s.inventory.order.push(addItem(s, n));
      }, "exceeds capacity 60");
    });
  });

  describe("field checks", () => {
    it("rejects negative or fractional currency", () => {
      expectRejected((s) => (s.inventory.currency.kindle_shard = -1), "inventory.currency.kindle_shard");
      expectRejected((s) => (s.inventory.currency.flux_shard = 0.5), "inventory.currency.flux_shard");
    });

    it("rejects missing currency keys", () => {
      expectRejected((s) => delete (s.inventory.currency as Partial<typeof s.inventory.currency>).temper_shard, "temper_shard");
    });

    it("rejects an unknown active skill", () => {
      expectRejected((s) => ((s.character as { activeSkillId: string }).activeSkillId = "nope"), "character.activeSkillId");
    });

    it("rejects a support slot count that does not match the level", () => {
      expectRejected((s) => s.character.supportIds.push(null), "unlocked slot count");
    });

    it("rejects duplicate supports", () => {
      expectRejected((s) => {
        s.character.level = 10;
        s.character.supportIds = ["brute_force", "brute_force"];
      }, "character.supportIds: contains duplicates");
    });

    it("rejects disconnected or root passives", () => {
      expectRejected((s) => (s.character.allocatedPassives = ["m2"]), "not connected to the root");
      expectRejected((s) => (s.character.allocatedPassives = ["origin"]), "root is implicit");
      expect(errorsAfter((s) => (s.character.allocatedPassives = ["m1", "m2", "b7"]))).toEqual([]);
    });

    it("rejects a malformed rng state", () => {
      expectRejected((s) => (s.rng.combat = [1, 2, 3] as never), "rng.combat");
      expectRejected((s) => (s.rng.loot = [1, 2, 3, -1]), "rng.loot");
    });

    it("rejects a locked zone activity", () => {
      expectRejected((s) => (s.progression.activity = { kind: "zone", zoneId: "glass_ridge" }), "zone is not unlocked");
    });

    it("rejects a map activity while maps are locked or above the unlocked tier", () => {
      expectRejected((s) => (s.progression.activity = { kind: "map", tier: 1, modifiers: [], encountersCleared: 0 }), "maps are locked");
      expectRejected((s) => {
        s.progression.unlockedMapTier = 2;
        s.progression.activity = { kind: "map", tier: 3, modifiers: [], encountersCleared: 0 };
      }, "progression.activity.tier");
    });

    it("rejects unknown map modifiers", () => {
      expectRejected((s) => {
        s.progression.unlockedMapTier = 1;
        s.progression.activity = { kind: "map", tier: 1, modifiers: ["bogus" as never], encountersCleared: 0 };
      }, "progression.activity.modifiers[0]");
    });

    it("rejects a wrong schemaVersion", () => {
      expectRejected((s) => (s.schemaVersion = 999), "schemaVersion");
    });

    it("rejects an oversized log", () => {
      expectRejected((s) => {
        for (let i = 0; i < 201; i++) s.log.push({ timeMs: i, kind: "info", text: "x" });
      }, "log: exceeds capacity 200");
    });

    it("rejects invalid loot filter rules", () => {
      expectRejected((s) => s.settings.lootFilter.push({ action: "destroy" } as never), "settings.lootFilter[2].action");
    });
  });
});
