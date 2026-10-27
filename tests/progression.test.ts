import { describe, expect, it } from "vitest";
import { MAX_LEVEL, monsterBaseLife, monsterBaseXp, xpToNextLevel } from "../src/data/balance";
import { ZONE_ORDER } from "../src/data/zones";
import type { GameEvent } from "../src/game/events";
import { grantXp, recordBossDefeated, recordEncounterCleared, retreat, xpMultiplier } from "../src/game/progression";
import { createInitialState } from "../src/game/state";
import { resolveActivity } from "../src/game/zones";

describe("experience curves", () => {
  it("matches the documented formulas", () => {
    expect(xpToNextLevel(1)).toBe(100);
    expect(xpToNextLevel(10)).toBe(Math.round(60 * 10 ** 1.85 + 40));
    expect(monsterBaseXp(1)).toBe(8);
    expect(monsterBaseLife(1)).toBe(30);
  });

  it("penalizes level differences beyond the safe range, down to 5%", () => {
    expect(xpMultiplier(1, 4)).toBe(1);
    expect(xpMultiplier(1, 5)).toBeCloseTo(0.85);
    expect(xpMultiplier(10, 1)).toBeCloseTo(1 - 0.15 * 5);
    expect(xpMultiplier(1, 40)).toBe(0.05);
    // Safe range grows with level: 3 + floor(20 / 10) = 5.
    expect(xpMultiplier(20, 25)).toBe(1);
  });
});

describe("grantXp", () => {
  it("levels up, carries over excess XP, grows life and unlocks support slots", () => {
    const state = createInitialState(1);
    state.character.life = 50;
    const events: GameEvent[] = [];
    grantXp(state, xpToNextLevel(1) + xpToNextLevel(2) + 5, events);
    expect(state.character.level).toBe(3);
    expect(state.character.xp).toBe(5);
    expect(state.character.life).toBe(50 + 24);
    expect(state.character.supportIds).toEqual([null]);
    expect(events.map((e) => e.type)).toEqual(["level_up", "level_up"]);
  });

  it("stops accumulating at the level cap", () => {
    const state = createInitialState(1);
    state.character.level = MAX_LEVEL - 1;
    state.character.supportIds = [null, null];
    grantXp(state, 10 ** 9, []);
    expect(state.character.level).toBe(MAX_LEVEL);
    expect(state.character.xp).toBe(0);
    grantXp(state, 100, []);
    expect(state.character.xp).toBe(0);
  });
});

describe("zone progress", () => {
  it("counts cleared encounters", () => {
    const state = createInitialState(1);
    recordEncounterCleared(state);
    recordEncounterCleared(state);
    expect(resolveActivity(state).encountersCleared).toBe(2);
  });

  it("a boss kill unlocks the next zone and auto-advances", () => {
    const state = createInitialState(1);
    state.progression.zoneProgress.ashen_outskirts!.encountersCleared = 10;
    const events: GameEvent[] = [];
    recordBossDefeated(state, events);
    expect(state.progression.zoneProgress.ashen_outskirts).toEqual({ encountersCleared: 0, bossDefeated: true });
    expect(state.progression.unlockedZones).toEqual(["ashen_outskirts", "drowned_fields"]);
    expect(state.progression.activity).toEqual({ kind: "zone", zoneId: "drowned_fields" });
    expect(events.map((e) => e.type)).toEqual(["zone_unlocked", "activity_changed"]);
  });

  it("without auto-advance the boss cycle repeats in the same zone", () => {
    const state = createInitialState(1);
    state.settings.autoAdvance = false;
    recordBossDefeated(state, []);
    recordBossDefeated(state, []);
    expect(state.progression.activity).toEqual({ kind: "zone", zoneId: "ashen_outskirts" });
    expect(state.progression.unlockedZones).toEqual(["ashen_outskirts", "drowned_fields"]);
  });

  it("the last zone's boss unlocks map tier 1", () => {
    const state = createInitialState(1);
    const last = ZONE_ORDER[ZONE_ORDER.length - 1]!;
    state.progression.unlockedZones = [...ZONE_ORDER];
    state.progression.activity = { kind: "zone", zoneId: last };
    recordBossDefeated(state, []);
    expect(state.progression.unlockedMapTier).toBe(1);
    expect(state.progression.activity).toEqual({ kind: "zone", zoneId: last });
  });

  it("retreat moves to the highest cleared zone below, or does nothing", () => {
    const state = createInitialState(1);
    expect(retreat(state, [])).toBe(false);
    expect(state.settings.autoAdvance).toBe(true);

    state.progression.unlockedZones = ["ashen_outskirts", "drowned_fields", "hollow_pines"];
    state.progression.zoneProgress = {
      ashen_outskirts: { encountersCleared: 0, bossDefeated: true },
      drowned_fields: { encountersCleared: 0, bossDefeated: true },
      hollow_pines: { encountersCleared: 4, bossDefeated: false },
    };
    state.progression.activity = { kind: "zone", zoneId: "hollow_pines" };
    expect(retreat(state, [])).toBe(true);
    expect(state.progression.activity).toEqual({ kind: "zone", zoneId: "drowned_fields" });
    expect(state.settings.autoAdvance).toBe(false);
  });
});

describe("resolveActivity", () => {
  it("resolves each zone from its definition", () => {
    const state = createInitialState(1);
    state.progression.activity = { kind: "zone", zoneId: "hollow_pines" };
    const resolved = resolveActivity(state);
    expect(resolved.monsterLevel).toBe(8);
    expect(resolved.monsterPool.map((e) => e.id)).toEqual(["brute", "skirmisher", "ember_wisp", "frost_husk"]);
    expect(resolved.bossPool).toEqual([{ id: "rimebound", weight: 1 }]);
    expect(resolved.requiredEncounters).toBe(10);
    expect(resolved.encountersCleared).toBe(0);
  });
});
