import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { LEVEL_GAP_PCT_PER_LEVEL, RESPAWN_MS, TRANSITION_MS, xpToNextLevel, ZONE_REQUIRED_ENCOUNTERS } from "../src/data/balance";
import { monsterStats } from "../src/game/combat";
import { advance, dispatch } from "../src/game/engine";
import { nextFloat, type RngState } from "../src/game/random";
import { parseSave, serializeSave } from "../src/game/save";
import { computeMaxLife } from "../src/game/stats";
import { createInitialState, type GameState, type MonsterRuntime } from "../src/game/state";
import { validateState } from "../src/game/validate";

function monster(defId: string, overrides: Partial<MonsterRuntime> = {}): MonsterRuntime {
  const stats = monsterStats(defId, 1);
  return { defId, level: 1, life: stats.maxLife, maxLife: stats.maxLife, nextAttackAt: 0, alive: true, ...overrides };
}

/** A state with a hand-built fighting encounter at sim time 0. */
function fightingState(monsters: MonsterRuntime[], playerNextAttackAt: number): GameState {
  const state = createInitialState(1);
  state.encounter = {
    index: 0,
    isBoss: false,
    phase: "fighting",
    phaseEndsAt: 0,
    monsters,
    player: { nextAttackAt: playerNextAttackAt },
    stacks: {},
    levelGap: 0,
  };
  return state;
}

function expectValid(state: GameState): void {
  const result = validateState(state);
  expect(result.ok ? [] : result.errors).toEqual([]);
}

/** Varied builds so the property tests cover chains, stacks and supports. */
function variedState(seed: number, variant: number): GameState {
  const state = createInitialState(seed);
  const c = state.character;
  switch (variant % 5) {
    case 0:
      break;
    case 1:
      c.level = 12;
      c.activeSkillId = "arc_pulse";
      c.supportIds = ["keen_edge", "quickened"];
      c.allocatedPassives = ["c1", "c3", "CN1", "c5", "CN2"];
      break;
    case 2:
      c.level = 6;
      c.activeSkillId = "rapid_assault";
      c.supportIds = ["brute_force"];
      c.allocatedPassives = ["m1", "m2"];
      break;
    case 3:
      // Overleveled map run: exercises map modifiers, map boss write-back and map retreat.
      c.level = 40;
      c.supportIds = [null, null];
      state.progression.unlockedMapTier = 2;
      state.progression.activity = { kind: "map", tier: 2, modifiers: ["savage", "swarming"], encountersCleared: 9 };
      break;
    case 4:
      // Underleveled and one kill from a level-up: the level gap shrinks between encounters.
      c.level = 3;
      c.xp = xpToNextLevel(3) - 1;
      state.progression.unlockedZones = ["ashen_outskirts", "drowned_fields", "hollow_pines"];
      state.progression.activity = { kind: "zone", zoneId: "hollow_pines" };
      break;
  }
  return state;
}

describe("advance: basics", () => {
  it("rejects negative or non-integer durations", () => {
    const state = createInitialState(1);
    expect(() => advance(state, -1)).toThrow(RangeError);
    expect(() => advance(state, 1.5)).toThrow(RangeError);
  });

  it("rebuilds a missing encounter at the persisted index with full life", () => {
    const state = createInitialState(1);
    state.character.life = 3;
    state.progression.zoneProgress.ashen_outskirts!.encountersCleared = 4;
    const { events } = advance(state, 0);
    expect(state.encounter?.index).toBe(4);
    expect(state.encounter?.isBoss).toBe(false);
    expect(events[0]).toMatchObject({ type: "encounter_started", index: 4 });
    // The player attacked at +0 ms, monsters have not attacked yet.
    expect(state.character.life).toBe(100);
    expect(state.encounter!.player.nextAttackAt).toBeGreaterThan(0);
  });

  it("starts the boss once progress is complete", () => {
    const state = createInitialState(1);
    state.progression.zoneProgress.ashen_outskirts!.encountersCleared = ZONE_REQUIRED_ENCOUNTERS;
    advance(state, 0);
    expect(state.encounter).toMatchObject({ isBoss: true, index: ZONE_REQUIRED_ENCOUNTERS });
    expect(state.encounter!.monsters.map((m) => m.defId)).toEqual(["gatewarden"]);
  });

  it("sets simTimeMs to the target and keeps the state valid", () => {
    const state = createInitialState(7);
    advance(state, 123_457);
    expect(state.simTimeMs).toBe(123_457);
    expectValid(state);
  });
});

describe("advance: event boundaries", () => {
  it("resolves an event exactly at the target time", () => {
    const state = fightingState([monster("brute", { nextAttackAt: 500 })], 10_000);
    advance(state, 499);
    expect(state.character.life).toBe(100);
    advance(state, 1);
    expect(state.character.life).toBeLessThan(100);
  });

  it("advance(0) resolves only events due now", () => {
    const state = fightingState([monster("brute", { nextAttackAt: 1 })], 0);
    const lifeBefore = state.encounter!.monsters[0]!.life;
    advance(state, 0);
    expect(state.simTimeMs).toBe(0);
    expect(state.encounter!.monsters[0]!.life).toBeLessThan(lifeBefore);
    expect(state.character.life).toBe(100);
  });

  it("a same-millisecond last kill cancels monster attacks", () => {
    const state = fightingState([monster("brute", { life: 1, nextAttackAt: 1000 })], 1000);
    const { events } = advance(state, 1000);
    expect(state.character.life).toBe(100);
    expect(state.encounter).toMatchObject({ phase: "transition", phaseEndsAt: 1000 + TRANSITION_MS });
    expect(events.map((e) => e.type)).toContain("encounter_cleared");
  });

  it("a same-millisecond player death cancels the remaining monster attacks", () => {
    const state = fightingState(
      [monster("brute", { nextAttackAt: 1000 }), monster("brute", { nextAttackAt: 1000 })],
      5000,
    );
    state.character.life = 1;
    const expectedRng: RngState = [...state.rng.combat];
    nextFloat(expectedRng);
    advance(state, 1000);
    expect(state.character.life).toBe(0);
    expect(state.encounter).toMatchObject({ phase: "respawning", phaseEndsAt: 1000 + RESPAWN_MS, monsters: [] });
    // Only the first monster's hit was rolled.
    expect(state.rng.combat).toEqual(expectedRng);
    expect(state.progression.consecutiveDeaths).toBe(1);
  });

  it("the player attack wins a tie with monster attacks", () => {
    const state = fightingState([monster("skirmisher", { nextAttackAt: 1000 }), monster("brute", { nextAttackAt: 1000 })], 1000);
    state.encounter!.monsters[0]!.life = 1;
    advance(state, 1000);
    // The skirmisher died before acting; only the brute hit.
    expect(state.encounter!.monsters[0]!.alive).toBe(false);
    expect(state.encounter!.monsters[1]!.nextAttackAt).toBe(1000 + monsterStats("brute", 1).attackIntervalMs);
    expect(state.encounter!.monsters[0]!.nextAttackAt).toBe(1000);
  });
});

describe("advance: death and respawn", () => {
  it("respawns after the delay at the same index with a new pack and full life", () => {
    const state = createInitialState(3);
    state.progression.zoneProgress.ashen_outskirts!.encountersCleared = 6;
    state.encounter = {
      index: 6,
      isBoss: false,
      phase: "respawning",
      phaseEndsAt: RESPAWN_MS,
      monsters: [],
      player: { nextAttackAt: 0 },
      stacks: {},
      levelGap: 0,
    };
    state.character.life = 0;
    advance(state, RESPAWN_MS - 1);
    expect(state.encounter.phase).toBe("respawning");
    advance(state, 1);
    expect(state.encounter!.phase).toBe("fighting");
    expect(state.encounter!.index).toBe(6);
    expect(state.character.life).toBe(100);
    expect(state.progression.zoneProgress.ashen_outskirts!.encountersCleared).toBe(6);
  });

  it("auto-retreats after three consecutive deaths and pauses auto-advance", () => {
    const state = createInitialState(1);
    state.progression.unlockedZones.push("drowned_fields");
    state.progression.zoneProgress.ashen_outskirts!.bossDefeated = true;
    state.progression.zoneProgress.drowned_fields = { encountersCleared: 3, bossDefeated: false };
    state.progression.activity = { kind: "zone", zoneId: "drowned_fields" };
    state.progression.consecutiveDeaths = 2;
    state.encounter = {
      index: 3,
      isBoss: false,
      phase: "fighting",
      phaseEndsAt: 0,
      monsters: [monster("brute", { level: 4, nextAttackAt: 10 })],
      player: { nextAttackAt: 10_000 },
      stacks: {},
      levelGap: 0,
    };
    state.character.life = 1;
    advance(state, 10);
    expect(state.progression.activity).toEqual({ kind: "zone", zoneId: "ashen_outskirts" });
    expect(state.settings.autoAdvance).toBe(false);
    expect(state.progression.zoneProgress.drowned_fields!.encountersCleared).toBe(3);
  });
});

describe("advance: stacks", () => {
  it("Momentum gains on kill, clamps at max, resets at encounter start, and affects the next scheduling", () => {
    const state = createInitialState(1);
    state.character.level = 9;
    state.character.supportIds = [null];
    state.character.allocatedPassives = ["c1", "c3", "CN1"];
    const weak = (i: number) => monster("skirmisher", { life: 1, nextAttackAt: 50_000 + i });
    state.encounter = {
      index: 0,
      isBoss: false,
      phase: "fighting",
      phaseEndsAt: 0,
      monsters: Array.from({ length: 7 }, (_, i) => weak(i)),
      player: { nextAttackAt: 0 },
      stacks: {},
      levelGap: 0,
    };
    // Rusted Blade 1.3 × 20% less × (1 + 12% + 2% per stack).
    const interval = (stacks: number) => Math.round(1000 / (1.3 * 0.8 * (1 + (12 + 2 * stacks) / 100)));

    advance(state, 0);
    expect(state.encounter!.stacks.momentum).toBe(1);
    expect(state.encounter!.player.nextAttackAt).toBe(interval(1));

    for (let i = 0; i < 5; i++) {
      advance(state, state.encounter!.player.nextAttackAt - state.simTimeMs);
    }
    expect(state.encounter!.stacks.momentum).toBe(5);
    advance(state, state.encounter!.player.nextAttackAt - state.simTimeMs);
    expect(state.encounter!.phase).toBe("transition");
    expect(state.encounter!.stacks.momentum).toBe(5);

    advance(state, TRANSITION_MS);
    expect(state.encounter!.phase).toBe("fighting");
    // New encounter: stacks reset, the first attack happened at +0 with no stacks applied yet.
    const stacksAfterFirst = state.encounter!.stacks.momentum ?? 0;
    expect(stacksAfterFirst).toBeLessThanOrEqual(1);
  });

  it("does not track stacks that no modifier references", () => {
    const state = fightingState([monster("skirmisher", { life: 1 }), monster("brute", { nextAttackAt: 50_000 })], 0);
    advance(state, 0);
    expect(state.encounter!.stacks).toEqual({});
  });
});

describe("advance: level gap", () => {
  it("is fixed when the encounter starts, scales monster life, and is re-evaluated by the next encounter", () => {
    const state = createInitialState(1);
    state.character.level = 3;
    state.character.xp = xpToNextLevel(3) - 1;
    state.progression.unlockedZones = ["ashen_outskirts", "drowned_fields", "hollow_pines"];
    state.progression.activity = { kind: "zone", zoneId: "hollow_pines" };
    advance(state, 0);
    const first = state.encounter!;
    expect(first.levelGap).toBe(5);
    for (const m of first.monsters) {
      expect(m.maxLife).toBe(Math.round(monsterStats(m.defId, m.level).maxLife * (1 + (5 * LEVEL_GAP_PCT_PER_LEVEL) / 100)));
    }

    let guard = 0;
    while (state.character.level === 3 && guard++ < 10_000) advance(state, 100);
    expect(state.character.level).toBe(4);
    if (state.encounter === first) expect(state.encounter.levelGap).toBe(5);
    while (state.encounter === first && guard++ < 20_000) advance(state, 100);
    expect(state.encounter!.levelGap).toBe(4);
  });
});

describe("advance: split invariance", () => {
  it("advance(a + b) equals advance(a); advance(b), including encounter and rng", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 600_000 }),
        fc.array(fc.integer({ min: 0, max: 600_000 }), { maxLength: 6 }),
        (seed, variant, total, cuts) => {
          const whole = variedState(seed, variant);
          const split = variedState(seed, variant);
          advance(whole, total);
          const points = [...new Set(cuts.map((c) => c % (total + 1)))].sort((a, b) => a - b);
          let at = 0;
          for (const p of [...points, total]) {
            advance(split, p - at);
            at = p;
          }
          expect(split).toEqual(whole);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("holds for splits that land exactly on event times", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const reference = variedState(seed, seed);
      const stepped = variedState(seed, seed);
      advance(stepped, 0);
      for (let i = 0; i < 300; i++) {
        const enc = stepped.encounter!;
        const times = [enc.phaseEndsAt, enc.player.nextAttackAt, ...enc.monsters.filter((m) => m.alive).map((m) => m.nextAttackAt)];
        const nextTime = Math.min(...times.filter((t) => t > stepped.simTimeMs));
        advance(stepped, nextTime - stepped.simTimeMs);
      }
      advance(reference, stepped.simTimeMs);
      expect(stepped).toEqual(reference);
    }
  });
});

describe("save/load interaction", () => {
  it("a loaded state has no encounter; the next advance rebuilds it at the persisted index", () => {
    const state = createInitialState(11);
    advance(state, 60_000);
    const index = state.progression.zoneProgress.ashen_outskirts!.encountersCleared;
    const parsed = parseSave(serializeSave(state, { savedAt: 0, lastActiveAt: 0 }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.state.encounter).toBeNull();
    parsed.state.character.life = 1;
    advance(parsed.state, 0);
    expect(parsed.state.encounter!.index).toBe(index);
    expect(parsed.state.encounter!.stacks).toEqual({});
    expect(parsed.state.character.life).toBe(computeMaxLife(parsed.state));
  });
});

describe("dispatch", () => {
  it("travels only to unlocked zones and discards the encounter", () => {
    const state = createInitialState(1);
    advance(state, 1000);
    expect(dispatch(state, { type: "travel_to_zone", zoneId: "hollow_pines" })).toEqual({ ok: false, reason: "zone_locked" });
    state.progression.unlockedZones.push("drowned_fields");
    const result = dispatch(state, { type: "travel_to_zone", zoneId: "drowned_fields" });
    expect(result.ok).toBe(true);
    expect(state.progression.activity).toEqual({ kind: "zone", zoneId: "drowned_fields" });
    expect(state.encounter).toBeNull();
  });

  it("toggles auto-advance and auto-retreat", () => {
    const state = createInitialState(1);
    dispatch(state, { type: "set_auto_advance", value: false });
    dispatch(state, { type: "set_auto_retreat", value: false });
    expect(state.settings).toMatchObject({ autoAdvance: false, autoRetreat: false });
  });
});
