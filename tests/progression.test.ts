import { describe, expect, it } from "vitest";
import {
  autoAdvanceLevel,
  BASE_LIFE,
  interpolateCurve,
  MAX_LEVEL,
  MONSTER_LIFE_CURVE,
  monsterBaseDamage,
  monsterBaseLife,
  monsterBaseXp,
  XP_MIN_MULTIPLIER,
  XP_PENALTY_PER_EXCESS_LEVEL,
  xpToNextLevel,
} from "../src/data/balance";
import { MAP_TIERS } from "../src/data/maps";
import { ZONE_ORDER, ZONES } from "../src/data/zones";
import type { GameEvent } from "../src/game/events";
import {
  blockedAutoAdvance,
  grantXp,
  recordBossDefeated,
  recordEncounterCleared,
  retreat,
  travelToZone,
  xpMultiplier,
} from "../src/game/progression";
import { createInitialState } from "../src/game/state";
import { resolveActivity } from "../src/game/zones";

describe("experience curves", () => {
  it("matches the documented formulas", () => {
    expect(xpToNextLevel(1)).toBe(100);
    expect(xpToNextLevel(10)).toBe(Math.round(60 * 10 ** 2.25 + 40));
    expect(monsterBaseXp(1)).toBe(8);
    expect(monsterBaseLife(1)).toBe(30);
  });

  it("interpolates monster curves geometrically between anchors and extrapolates past the last", () => {
    const anchors = [
      [1, 10],
      [11, 1000],
      [21, 2000],
    ] as const;
    expect(interpolateCurve(anchors, 1)).toBeCloseTo(10);
    expect(interpolateCurve(anchors, 6)).toBeCloseTo(100);
    expect(interpolateCurve(anchors, 11)).toBeCloseTo(1000);
    expect(interpolateCurve(anchors, 31)).toBeCloseTo(4000);
    for (const [level, value] of MONSTER_LIFE_CURVE) expect(monsterBaseLife(level)).toBe(value);
    for (let level = 2; level <= 55; level++) {
      expect(monsterBaseLife(level)).toBeGreaterThanOrEqual(monsterBaseLife(level - 1));
      expect(monsterBaseDamage(level)).toBeGreaterThan(monsterBaseDamage(level - 1));
    }
  });

  it("penalizes level differences beyond the safe range, down to the minimum", () => {
    expect(xpMultiplier(1, 4)).toBe(1);
    expect(xpMultiplier(1, 5)).toBeCloseTo(1 - XP_PENALTY_PER_EXCESS_LEVEL);
    expect(xpMultiplier(10, 1)).toBeCloseTo(1 - XP_PENALTY_PER_EXCESS_LEVEL * 5);
    expect(xpMultiplier(1, 40)).toBe(XP_MIN_MULTIPLIER);
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
    expect(state.character.life).toBe(50 + 2 * BASE_LIFE.perLevel);
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
    state.character.level = autoAdvanceLevel(ZONES.drowned_fields.monsterLevel);
    state.progression.zoneProgress.ashen_outskirts!.encountersCleared = 10;
    const events: GameEvent[] = [];
    recordBossDefeated(state, events);
    expect(state.progression.zoneProgress.ashen_outskirts).toEqual({ encountersCleared: 0, bossDefeated: true });
    expect(state.progression.unlockedZones).toEqual(["ashen_outskirts", "drowned_fields"]);
    expect(state.progression.activity).toEqual({ kind: "zone", zoneId: "drowned_fields" });
    expect(events.map((e) => e.type)).toEqual(["zone_unlocked", "activity_changed"]);
  });

  it("auto-advance waits in a cleared zone until the character reaches the next zone's level", () => {
    const state = createInitialState(1);
    const required = autoAdvanceLevel(ZONES.drowned_fields.monsterLevel);
    state.character.level = required - 1;
    const events: GameEvent[] = [];
    recordBossDefeated(state, events);
    expect(state.progression.unlockedZones).toEqual(["ashen_outskirts", "drowned_fields"]);
    expect(state.progression.activity).toEqual({ kind: "zone", zoneId: "ashen_outskirts" });
    expect(events.map((e) => e.type)).toEqual(["zone_unlocked"]);
    expect(state.log.at(-1)!.text).toBe(`Need level ${required} to advance to Drowned Fields.`);
    expect(blockedAutoAdvance(state)).toEqual({ name: "Drowned Fields", requiredLevel: required });

    state.character.level = required;
    expect(blockedAutoAdvance(state)).toBeNull();
    recordBossDefeated(state, []);
    expect(state.progression.activity).toEqual({ kind: "zone", zoneId: "drowned_fields" });
  });

  it("the auto-advance level requirement does not apply without auto-advance, before a clear, or to manual travel", () => {
    const state = createInitialState(1);
    expect(blockedAutoAdvance(state)).toBeNull();
    state.progression.zoneProgress.ashen_outskirts!.bossDefeated = true;
    state.progression.unlockedZones = [...ZONE_ORDER];
    expect(blockedAutoAdvance(state)).not.toBeNull();
    state.settings.autoAdvance = false;
    expect(blockedAutoAdvance(state)).toBeNull();
    expect(travelToZone(state, "spire_of_ruin", [])).toBe(true);
    expect(state.progression.activity).toEqual({ kind: "zone", zoneId: "spire_of_ruin" });
  });

  it("without auto-advance the boss cycle repeats in the same zone", () => {
    const state = createInitialState(1);
    state.settings.autoAdvance = false;
    recordBossDefeated(state, []);
    recordBossDefeated(state, []);
    expect(state.progression.activity).toEqual({ kind: "zone", zoneId: "ashen_outskirts" });
    expect(state.progression.unlockedZones).toEqual(["ashen_outskirts", "drowned_fields"]);
  });

  it("the last zone's boss unlocks map tier 1 and auto-advances into it", () => {
    const state = createInitialState(1);
    state.character.level = autoAdvanceLevel(MAP_TIERS[0]!.monsterLevel);
    const last = ZONE_ORDER[ZONE_ORDER.length - 1]!;
    state.progression.unlockedZones = [...ZONE_ORDER];
    state.progression.activity = { kind: "zone", zoneId: last };
    const events: GameEvent[] = [];
    recordBossDefeated(state, events);
    expect(state.progression.unlockedMapTier).toBe(1);
    expect(state.progression.activity).toMatchObject({ kind: "map", tier: 1, encountersCleared: 0 });
    expect(events.map((e) => e.type)).toEqual(["map_tier_unlocked", "activity_changed"]);
  });

  it("without auto-advance the last zone's boss only unlocks maps", () => {
    const state = createInitialState(1);
    const last = ZONE_ORDER[ZONE_ORDER.length - 1]!;
    state.progression.unlockedZones = [...ZONE_ORDER];
    state.progression.activity = { kind: "zone", zoneId: last };
    state.settings.autoAdvance = false;
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
