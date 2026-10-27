import { describe, expect, it } from "vitest";
import { AILMENTS } from "../src/data/ailments";
import { DOT_TICK_MS } from "../src/data/balance";
import { SKILLS, type SkillId } from "../src/data/skills";
import {
  activeAilments,
  ailmentStats,
  applyAilments,
  chilledIntervalMs,
  dotTickDamage,
  hasAilmentChance,
  shockPct,
} from "../src/game/ailments";
import { finalDamage, hitPortions, monsterStats, rollAttack, sumHit, type DamagePortions } from "../src/game/combat";
import { advance } from "../src/game/engine";
import { evaluateBuild } from "../src/game/evaluate";
import type { Modifier, ModifierSpec } from "../src/game/modifiers";
import { nextFloat, type RngState } from "../src/game/random";
import { collectBuild, type PlayerBuild } from "../src/game/stats";
import { createInitialState, type GameState, type MonsterRuntime } from "../src/game/state";
import { validateState } from "../src/game/validate";

function build(skillId: SkillId, specs: ModifierSpec[] = [], level = 1): PlayerBuild {
  const skill = SKILLS[skillId];
  const mods: Modifier[] = [...skill.modifiers, ...specs].map((s) => ({ ...s, source: { kind: "base", id: "test" } }));
  return { level, skill, mods, weapon: { physical: [10, 20], attacksPerSecond: 1, critChance: 0 }, baseArmor: 0 };
}

function monster(overrides: Partial<MonsterRuntime> = {}): MonsterRuntime {
  const stats = monsterStats("brute", 10);
  return { defId: "brute", level: 10, life: stats.maxLife, maxLife: stats.maxLife, nextAttackAt: 0, alive: true, ...overrides };
}

function portions(values: Partial<DamagePortions>): DamagePortions {
  return { physical: 0, fire: 0, cold: 0, lightning: 0, chaos: 0, ...values };
}

const chance = (id: string, value: number): ModifierSpec => ({
  stat: "ailment_chance",
  kind: "flat",
  damageType: AILMENTS[id as keyof typeof AILMENTS].damageType,
  value,
});

describe("ailmentStats", () => {
  it("selects the ailment by damage type and applies effect, duration and caps", () => {
    const table = ailmentStats(
      build("fireball", [
        chance("ignite", 30),
        { stat: "ailment_effect", kind: "increased", damageType: "fire", value: 20 },
        { stat: "ailment_effect", kind: "increased", damageType: "cold", value: 200 },
        { stat: "ailment_duration", kind: "increased", value: 50 },
        chance("shock", 150),
      ]),
      {},
    );
    expect(table.ignite.chance).toBe(55); // 25 from Fireball + 30
    expect(table.ignite.magnitude).toBeCloseTo(AILMENTS.ignite.magnitude * 1.2);
    expect(table.ignite.durationMs).toBe(AILMENTS.ignite.durationMs * 1.5);
    expect(table.chill.magnitude).toBe(AILMENTS.chill.maxMagnitude);
    expect(table.shock.chance).toBe(100);
    expect(table.bleed.chance).toBe(0);
  });

  it("a build without any chance needs no ailment draw", () => {
    expect(hasAilmentChance(ailmentStats(build("heavy_strike"), {}))).toBe(false);
    expect(hasAilmentChance(ailmentStats(build("fireball"), {}))).toBe(true);
  });
});

describe("applyAilments", () => {
  const table = ailmentStats(build("heavy_strike", [chance("bleed", 50), chance("ignite", 50), chance("chill", 50), chance("shock", 50)]), {});

  it("inflicts an ailment when the shared roll is below its chance and the hit dealt its type", () => {
    const m = monster();
    expect(applyAilments(m, table, portions({ physical: 100, cold: 10 }), 0.49, 1_000)).toEqual(["bleed", "chill"]);
    const ticks = AILMENTS.bleed.durationMs / DOT_TICK_MS;
    expect(m.ailments!.bleed).toEqual({ damagePerTick: (100 * AILMENTS.bleed.magnitude) / 100 / ticks, nextTickAt: 1_000 + DOT_TICK_MS, ticksLeft: ticks });
    expect(m.ailments!.chill).toEqual({ magnitude: AILMENTS.chill.magnitude, endsAt: 1_000 + AILMENTS.chill.durationMs });
    expect(applyAilments(monster(), table, portions({ physical: 100 }), 0.5, 1_000)).toEqual([]);
  });

  it("keeps a stronger bleed or ignite and replaces a weaker one", () => {
    const m = monster();
    applyAilments(m, table, portions({ fire: 100 }), 0, 0);
    const strong = { ...m.ailments!.ignite! };
    expect(applyAilments(m, table, portions({ fire: 50 }), 0, 300)).toEqual([]);
    expect(m.ailments!.ignite).toEqual(strong);
    expect(applyAilments(m, table, portions({ fire: 200 }), 0, 300)).toEqual(["ignite"]);
    expect(m.ailments!.ignite!.damagePerTick).toBeCloseTo(strong.damagePerTick * 2);
    expect(m.ailments!.ignite!.nextTickAt).toBe(300 + DOT_TICK_MS);
  });

  it("shock raises hit and tick damage only while active; chill slows newly scheduled attacks", () => {
    const m = monster();
    applyAilments(m, table, portions({ lightning: 10, cold: 10 }), 0, 0);
    const shock = AILMENTS.shock;
    expect(shockPct(m, shock.durationMs - 1)).toBe(shock.magnitude);
    expect(shockPct(m, shock.durationMs)).toBe(0);
    expect(sumHit(portions({ fire: 100 }), { armor: 0, resistances: {}, lifePct: 100, damageTakenMorePct: shockPct(m, 0) })).toBeCloseTo(
      100 * (1 + shock.magnitude / 100),
    );
    expect(dotTickDamage({ damagePerTick: 10, nextTickAt: 0, ticksLeft: 1 }, m, 0)).toBe(Math.floor(10 * (1 + shock.magnitude / 100)));
    expect(chilledIntervalMs(1_000, m, 0)).toBe(Math.round(1_000 / (1 - AILMENTS.chill.magnitude / 100)));
    expect(chilledIntervalMs(1_000, m, AILMENTS.chill.durationMs)).toBe(1_000);
    expect(activeAilments(m, AILMENTS.chill.durationMs)).toEqual(["shock"]);
  });
});

describe("engine: ailments", () => {
  function igniteState(): GameState {
    const state = createInitialState(5);
    state.character.level = 20;
    state.character.activeSkillId = "fireball";
    state.character.supportIds = [null, null];
    state.encounter = {
      index: 0,
      isBoss: false,
      phase: "fighting",
      phaseEndsAt: 0,
      // Lots of life and a slow first attack, so only the ignite matters after the first hit.
      monsters: [monster({ life: 1_000_000, maxLife: 1_000_000, nextAttackAt: 1_000_000 })],
      player: { nextAttackAt: 1_000_000 },
      stacks: {},
      levelGap: 0,
    };
    return state;
  }

  it("ignite ticks every DOT_TICK_MS for its duration and is removed after the last tick", () => {
    const state = igniteState();
    const m = state.encounter!.monsters[0]!;
    m.ailments = { ignite: { damagePerTick: 7.9, nextTickAt: DOT_TICK_MS, ticksLeft: 3 } };
    advance(state, DOT_TICK_MS * 3);
    expect(m.life).toBe(1_000_000 - 3 * 7);
    expect(m.ailments.ignite).toBeUndefined();
  });

  it("a tick that kills the last monster clears the encounter", () => {
    const state = igniteState();
    const m = state.encounter!.monsters[0]!;
    m.life = 5;
    m.ailments = { bleed: { damagePerTick: 10, nextTickAt: 200, ticksLeft: 5 } };
    const { events } = advance(state, 200);
    expect(m.alive).toBe(false);
    expect(state.encounter!.phase).toBe("transition");
    expect(events.map((e) => e.type)).toContain("encounter_cleared");
  });

  it("a hit draws a third combat value only for builds with an ailment chance", () => {
    for (const [skillId, draws] of [["heavy_strike", 2], ["fireball", 3]] as const) {
      const state = igniteState();
      state.character.activeSkillId = skillId;
      state.encounter!.player.nextAttackAt = 0;
      const expected: RngState = [...state.rng.combat];
      for (let i = 0; i < draws; i++) nextFloat(expected);
      advance(state, 0);
      expect(state.rng.combat).toEqual(expected);
    }
  });

  it("the same hit applies an ignite scaled from its own fire damage when the roll succeeds", () => {
    const state = igniteState();
    state.encounter!.player.nextAttackAt = 0;
    const b = collectBuild(state);
    const rng: RngState = [...state.rng.combat];
    const roll = rollAttack(b, {}, rng);
    const ailmentRoll = nextFloat(rng);
    const m = state.encounter!.monsters[0]!;
    const target = { armor: 0, resistances: monsterStats("brute", 10).resistances, lifePct: 100 };
    const hit = hitPortions(b, roll, {}, target, false);
    advance(state, 0);
    expect(m.life).toBe(1_000_000 - finalDamage(sumHit(hit, target)));
    const table = ailmentStats(b, {});
    if (ailmentRoll * 100 < table.ignite.chance) {
      expect(m.ailments!.ignite!.damagePerTick).toBeCloseTo((hit.fire * table.ignite.magnitude) / 100 / (table.ignite.durationMs / DOT_TICK_MS));
    } else {
      expect(m.ailments?.ignite).toBeUndefined();
    }
  });

  it("long runs with ailments keep the state valid", () => {
    const state = createInitialState(9);
    state.character.level = 18;
    state.character.activeSkillId = "ice_nova";
    state.character.supportIds = ["frostbite", "overcharge"];
    state.progression.unlockedZones = ["ashen_outskirts", "drowned_fields", "hollow_pines", "saltworks", "cinder_quarry"];
    state.progression.activity = { kind: "zone", zoneId: "cinder_quarry" };
    let sawAilment = false;
    for (let i = 0; i < 300; i++) {
      advance(state, 1_000);
      sawAilment ||= state.encounter!.monsters.some((m) => m.ailments !== undefined);
      const result = validateState(state);
      expect(result.ok ? [] : result.errors).toEqual([]);
    }
    expect(sawAilment).toBe(true);
  });
});

describe("evaluate: ailments", () => {
  it("adds bleed/ignite DPS and the shock uplift by uptime; nothing without a chance", () => {
    const plain = evaluateBuild(build("heavy_strike", [], 20), 20);
    expect(plain.ailmentDps).toBe(0);
    expect(plain.singleTargetDps).toBeCloseTo(plain.expectedHit * plain.attacksPerSecond);

    const ignite = evaluateBuild(build("fireball", [], 20), 20);
    const { chance: c, magnitude, durationMs } = ignite.ailments.ignite;
    const uptime = 1 - Math.exp(-(c / 100) * ignite.attacksPerSecond * (durationMs / 1000));
    expect(ignite.ailmentDps).toBeGreaterThan(0);
    // The expected hit is all fire on the reference target, so the ignite base is about the hit itself.
    expect(ignite.ailmentDps).toBeCloseTo(((ignite.expectedHit * magnitude) / 100 / (durationMs / 1000)) * uptime, 0);
    expect(ignite.singleTargetDps).toBeCloseTo(ignite.expectedHit * ignite.attacksPerSecond + ignite.ailmentDps);

    const shock = evaluateBuild(build("storm_lance", [], 20), 20);
    const s = shock.ailments.shock;
    const shockUptime = 1 - Math.exp(-(s.chance / 100) * shock.attacksPerSecond * (s.durationMs / 1000));
    expect(shock.singleTargetDps).toBeCloseTo(shock.expectedHit * shock.attacksPerSecond * (1 + (s.magnitude / 100) * shockUptime));
  });

  it("gives an area skill the same per-target uplift in pack DPS", () => {
    const e = evaluateBuild(build("ice_nova", [], 20), 20);
    expect(e.packDps).toBeCloseTo(3 * e.singleTargetDps);
  });
});
