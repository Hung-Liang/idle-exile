import { describe, expect, it } from "vitest";
import { autoAdvanceLevel, MAX_LEVEL, MAX_MAP_TIER, monsterBaseLife, PACK_SIZE_WEIGHTS, TRANSITION_MS } from "../src/data/balance";
import type { MapModifierId } from "../src/data/map-modifiers";
import { MAP_BOSS_POOL, MAP_MODIFIER_COUNT_WEIGHTS, MAP_REQUIRED_ENCOUNTERS, MAP_TIERS } from "../src/data/maps";
import { MONSTERS, type MonsterId } from "../src/data/monsters";
import { ZONE_ORDER } from "../src/data/zones";
import { monsterStats } from "../src/game/combat";
import { createEncounter } from "../src/game/encounters";
import { advance, dispatch } from "../src/game/engine";
import type { GameEvent } from "../src/game/events";
import { blockedAutoAdvance, recordBossDefeated, recordEncounterCleared, retreat, rollMapModifiers } from "../src/game/progression";
import { createStreamState } from "../src/game/random";
import { parseSave, serializeSave } from "../src/game/save";
import { collectBuild, computeDefenses } from "../src/game/stats";
import { createInitialState, type GameState } from "../src/game/state";
import { validateState } from "../src/game/validate";
import { resolveActivity } from "../src/game/zones";

function inMap(tier: number, modifiers: MapModifierId[], unlocked = tier, seed = 1): GameState {
  const state = createInitialState(seed);
  state.progression.unlockedMapTier = unlocked;
  state.progression.activity = { kind: "map", tier, modifiers, encountersCleared: 0 };
  return state;
}

describe("map data", () => {
  it("defines one entry per tier up to the cap", () => {
    expect(MAP_TIERS.map((t) => t.tier)).toEqual(Array.from({ length: MAX_MAP_TIER }, (_, i) => i + 1));
  });
});

describe("resolveActivity: maps", () => {
  it("resolves a plain run from the tier", () => {
    const resolved = resolveActivity(inMap(3, []));
    expect(resolved.name).toBe("Map Tier 3");
    expect(resolved.monsterLevel).toBe(44);
    expect(resolved.requiredEncounters).toBe(MAP_REQUIRED_ENCOUNTERS);
    expect(resolved.monsterPool.map((e) => e.id)).toEqual(Object.keys(MONSTERS));
    expect(resolved.bossPool.map((e) => e.id)).toEqual(MAP_BOSS_POOL);
    expect(resolved.packSizeWeights).toEqual(PACK_SIZE_WEIGHTS);
    expect(resolved.itemQuantityPct).toBe(20);
    expect(resolved.itemRarityPct).toBe(20);
    expect(resolved.monsterMods).toEqual([]);
    expect(resolved.playerMods).toEqual([]);
  });

  it("adds modifier bonuses, monster mods, player mods and pack sizes", () => {
    const resolved = resolveActivity(inMap(2, ["swarming", "draining"]));
    expect(resolved.itemQuantityPct).toBe(10 + 12 + 10);
    expect(resolved.itemRarityPct).toBe(10 + 0 + 10);
    expect(resolved.packSizeWeights).toEqual([20, 40, 40]);
    expect(resolved.playerMods).toEqual([{ stat: "resistance", kind: "flat", value: -15, source: { kind: "map", id: "draining" } }]);
    expect(resolved.encountersCleared).toBe(0);
  });
});

describe("map modifier effects", () => {
  it("Fortified, Savage and Scorching change monster stats", () => {
    const plain = monsterStats("brute", 40);
    const bruteLife = monsterBaseLife(40) * MONSTERS.brute.lifeMult;
    const mods = (id: MapModifierId) => resolveActivity(inMap(1, [id])).monsterMods;
    expect(monsterStats("brute", 40, mods("fortified")).maxLife).toBe(Math.round(bruteLife * 1.4));
    expect(monsterStats("brute", 40, mods("savage")).damagePerHit).toBeCloseTo(plain.damagePerHit * 1.25);
    expect(monsterStats("brute", 40, mods("scorching")).damageSplit).toEqual({ physical: 1, fire: 0.3 });
    expect(monsterStats("ember_wisp", 40, mods("scorching")).damageSplit.fire).toBeCloseTo(1.3);
  });

  it("monsters spawned in a map carry the modified life", () => {
    const state = inMap(1, ["fortified"]);
    const encounter = createEncounter(resolveActivity(state), MAX_LEVEL, createStreamState(5, "encounter"), 0);
    for (const m of encounter.monsters) {
      expect(m.maxLife).toBe(Math.round(monsterBaseLife(m.level) * MONSTERS[m.defId as MonsterId].lifeMult * 1.4));
    }
  });

  it("Draining lowers every player resistance by 15", () => {
    const zone = computeDefenses(collectBuild(createInitialState(1)));
    const drained = computeDefenses(collectBuild(inMap(1, ["draining"])));
    for (const type of ["fire", "cold", "lightning", "chaos"] as const) {
      expect(drained.resistances[type]).toBe(zone.resistances[type] - 15);
    }
  });
});

describe("rollMapModifiers", () => {
  it("rolls 0–2 distinct modifiers with weights 30 / 50 / 20", () => {
    const rng = createStreamState(42, "map");
    const counts = [0, 0, 0];
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const rolled = rollMapModifiers(rng);
      expect(new Set(rolled).size).toBe(rolled.length);
      counts[rolled.length]! += 1;
    }
    const total = MAP_MODIFIER_COUNT_WEIGHTS.reduce((a, b) => a + b, 0);
    counts.forEach((c, i) => expect(c / n).toBeCloseTo(MAP_MODIFIER_COUNT_WEIGHTS[i]! / total, 1));
  });
});

describe("start_map", () => {
  it("rejects locked tiers", () => {
    const state = createInitialState(1);
    expect(dispatch(state, { type: "start_map", tier: 1 })).toEqual({ ok: false, reason: "map_locked" });
    state.progression.unlockedMapTier = 2;
    expect(dispatch(state, { type: "start_map", tier: 3 })).toEqual({ ok: false, reason: "map_locked" });
    expect(dispatch(state, { type: "start_map", tier: 0 })).toEqual({ ok: false, reason: "map_locked" });
    expect(state.progression.activity).toEqual({ kind: "zone", zoneId: "ashen_outskirts" });
  });

  it("starts a fresh run, leaves the encounter and consumes only the map stream", () => {
    const state = createInitialState(3);
    state.progression.unlockedMapTier = 2;
    advance(state, 5_000);
    const rngBefore = structuredClone(state.rng);
    const result = dispatch(state, { type: "start_map", tier: 2 });
    expect(result.ok).toBe(true);
    expect(state.progression.activity).toMatchObject({ kind: "map", tier: 2, encountersCleared: 0 });
    expect(state.encounter!.monsters).toEqual([]);
    expect(state.encounter!.phase).not.toBe("fighting");
    expect({ ...state.rng, map: null }).toEqual({ ...rngBefore, map: null });
    const validation = validateState(state);
    expect(validation.ok ? [] : validation.errors).toEqual([]);
  });
});

describe("map progress", () => {
  it("counts cleared encounters on the activity and fights the boss after the required count", () => {
    const state = inMap(1, []);
    for (let i = 0; i < MAP_REQUIRED_ENCOUNTERS; i++) recordEncounterCleared(state);
    expect(state.progression.activity).toMatchObject({ encountersCleared: MAP_REQUIRED_ENCOUNTERS });
    const encounter = createEncounter(resolveActivity(state), MAX_LEVEL, createStreamState(1, "encounter"), 0);
    expect(encounter.isBoss).toBe(true);
    expect(MAP_BOSS_POOL).toContain(encounter.monsters[0]!.defId);
  });

  it("a boss kill unlocks the next tier and auto-advances into a new run", () => {
    const state = inMap(2, ["fortified"]);
    state.character.level = autoAdvanceLevel(MAP_TIERS[2]!.monsterLevel);
    const events: GameEvent[] = [];
    recordBossDefeated(state, events);
    expect(state.progression.unlockedMapTier).toBe(3);
    expect(state.progression.activity).toMatchObject({ kind: "map", tier: 3, encountersCleared: 0 });
    expect(events.map((e) => e.type)).toEqual(["map_tier_unlocked", "activity_changed"]);
  });

  it("auto-advance waits at the same tier until the character reaches the next tier's level", () => {
    const state = inMap(2, []);
    state.character.level = autoAdvanceLevel(MAP_TIERS[2]!.monsterLevel) - 1;
    recordBossDefeated(state, []);
    expect(state.progression.unlockedMapTier).toBe(3);
    expect(state.progression.activity).toMatchObject({ kind: "map", tier: 2, encountersCleared: 0 });
    expect(state.log.some((e) => e.text === `Need level ${autoAdvanceLevel(MAP_TIERS[2]!.monsterLevel)} to advance to Map Tier 3.`)).toBe(true);
    expect(blockedAutoAdvance(state)).toEqual({ name: "Map Tier 3", requiredLevel: autoAdvanceLevel(MAP_TIERS[2]!.monsterLevel) });

    state.character.level += 1;
    expect(blockedAutoAdvance(state)).toBeNull();
    recordBossDefeated(state, []);
    expect(state.progression.activity).toMatchObject({ kind: "map", tier: 3 });
  });

  it("manual start_map ignores the auto-advance level requirement", () => {
    const state = inMap(1, [], 5);
    expect(dispatch(state, { type: "start_map", tier: 5 }).ok).toBe(true);
    expect(state.progression.activity).toMatchObject({ kind: "map", tier: 5 });
  });

  it("without auto-advance a boss kill restarts the same tier", () => {
    const state = inMap(2, [], 4);
    state.settings.autoAdvance = false;
    recordBossDefeated(state, []);
    expect(state.progression.unlockedMapTier).toBe(4);
    expect(state.progression.activity).toMatchObject({ kind: "map", tier: 2, encountersCleared: 0 });
  });

  it("caps unlocks at the highest tier", () => {
    const state = inMap(MAX_MAP_TIER, []);
    recordBossDefeated(state, []);
    expect(state.progression.unlockedMapTier).toBe(MAX_MAP_TIER);
    expect(state.progression.activity).toMatchObject({ kind: "map", tier: MAX_MAP_TIER });
  });

  it("retreat moves down one tier, or to the last zone from tier 1, and pauses auto-advance", () => {
    const state = inMap(3, ["savage"]);
    state.progression.unlockedZones = [...ZONE_ORDER];
    expect(retreat(state, [])).toBe(true);
    expect(state.progression.activity).toMatchObject({ kind: "map", tier: 2, encountersCleared: 0 });
    expect(state.settings.autoAdvance).toBe(false);

    state.progression.activity = { kind: "map", tier: 1, modifiers: [], encountersCleared: 4 };
    expect(retreat(state, [])).toBe(true);
    expect(state.progression.activity).toEqual({ kind: "zone", zoneId: ZONE_ORDER[ZONE_ORDER.length - 1] });
  });

  it("persists modifiers and progress across save/load", () => {
    const state = inMap(2, ["scorching", "draining"]);
    state.progression.activity = { kind: "map", tier: 2, modifiers: ["scorching", "draining"], encountersCleared: 7 };
    const parsed = parseSave(serializeSave(state, { savedAt: 1, lastActiveAt: 1 }));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.state.progression.activity).toEqual(state.progression.activity);
  });
});

describe("advance in maps", () => {
  /** A map boss left with 1 life after the player's opening hit, so the next hit kills it. */
  function bossReady(seed: number): GameState {
    const state = inMap(1, ["swarming"], 1, seed);
    state.character.level = 50;
    state.character.supportIds = [null, null];
    state.progression.activity = { kind: "map", tier: 1, modifiers: ["swarming"], encountersCleared: MAP_REQUIRED_ENCOUNTERS };
    advance(state, 0);
    state.encounter!.monsters[0]!.life = 1;
    return state;
  }

  it("a map boss kill through advance() unlocks tier 2 and starts a new run there", () => {
    const state = bossReady(1);
    advance(state, state.encounter!.player.nextAttackAt - state.simTimeMs);
    expect(state.progression.unlockedMapTier).toBe(2);
    expect(state.progression.activity).toMatchObject({ kind: "map", tier: 2, encountersCleared: 0 });
    advance(state, TRANSITION_MS);
    expect(state.encounter!.monsters[0]!.level).toBe(MAP_TIERS[1]!.monsterLevel);
  });

  it("split invariance holds across a map boss kill and run change", () => {
    for (let seed = 1; seed <= 3; seed++) {
      const whole = bossReady(seed);
      const split = structuredClone(whole);
      advance(whole, 120_000);
      for (const step of [1, 999, 1, 30_000, 88_999]) advance(split, step);
      expect(split).toEqual(whole);
    }
  });
});
