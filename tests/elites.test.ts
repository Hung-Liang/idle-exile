import { describe, expect, it } from "vitest";
import { MAX_LEVEL, monsterBaseLife } from "../src/data/balance";
import type { MapModifierId } from "../src/data/map-modifiers";
import { ELITE_RANKS, MONSTER_AFFIXES } from "../src/data/monster-affixes";
import { MONSTERS, type MonsterId } from "../src/data/monsters";
import { monsterStats } from "../src/game/combat";
import { createEncounter, eliteMods, monsterDisplayName } from "../src/game/encounters";
import { advance } from "../src/game/engine";
import { createStreamState } from "../src/game/random";
import { createInitialState, type GameState, type MonsterRuntime } from "../src/game/state";
import { resolveActivity } from "../src/game/zones";

function inMap(modifiers: MapModifierId[]): GameState {
  const state = createInitialState(1);
  state.progression.unlockedMapTier = 1;
  state.progression.activity = { kind: "map", tier: 1, modifiers, encountersCleared: 0 };
  return state;
}

function spawnMany(state: GameState, encounters: number, seed = 1): MonsterRuntime[] {
  const resolved = resolveActivity(state);
  const rng = createStreamState(seed, "encounter");
  const monsters: MonsterRuntime[] = [];
  for (let i = 0; i < encounters; i++) monsters.push(...createEncounter(resolved, MAX_LEVEL, rng, 0).monsters);
  return monsters;
}

function rate(monsters: MonsterRuntime[], rank: MonsterRuntime["rank"]): number {
  return monsters.filter((m) => m.rank === rank).length / monsters.length;
}

describe("elite monsters", () => {
  it("roll magic and rare at about their base chances", () => {
    const monsters = spawnMany(inMap([]), 20_000);
    expect(rate(monsters, "magic")).toBeCloseTo(ELITE_RANKS.magic.chance, 2);
    expect(rate(monsters, "rare")).toBeCloseTo(ELITE_RANKS.rare.chance, 2);
  });

  it("Teeming doubles both chances", () => {
    const monsters = spawnMany(inMap(["teeming"]), 20_000);
    expect(rate(monsters, "magic")).toBeCloseTo(ELITE_RANKS.magic.chance * 2, 2);
    expect(rate(monsters, "rare")).toBeCloseTo(ELITE_RANKS.rare.chance * 2, 2);
  });

  it("no rares below their minimum monster level, and bosses are never elite", () => {
    const zone1 = createInitialState(1);
    expect(spawnMany(zone1, 5_000).some((m) => m.rank === "rare")).toBe(false);

    const boss = inMap([]);
    if (boss.progression.activity.kind === "map") boss.progression.activity.encountersCleared = 12;
    expect(spawnMany(boss, 2_000).every((m) => m.rank === undefined)).toBe(true);
  });

  it("carry distinct affixes within their rank's count range", () => {
    for (const m of spawnMany(inMap(["teeming"]), 5_000)) {
      if (m.rank === undefined) {
        expect(m.affixes).toBeUndefined();
        continue;
      }
      const counts = ELITE_RANKS[m.rank].affixCountWeights.flatMap((w, i) => (w > 0 ? [i] : []));
      expect(counts).toContain(m.affixes!.length);
      expect(new Set(m.affixes).size).toBe(m.affixes!.length);
    }
  });

  it("apply their rank and affix modifiers to the monster's stats", () => {
    const life = monsterBaseLife(40) * MONSTERS.brute.lifeMult;
    const magic: Pick<MonsterRuntime, "rank" | "affixes"> = { rank: "magic", affixes: ["hulking"] };
    expect(monsterStats("brute", 40, eliteMods(magic)).maxLife).toBe(Math.round(life * 1.6 * 1.5));
    const rare: Pick<MonsterRuntime, "rank" | "affixes"> = { rank: "rare", affixes: ["hasted", "warded"] };
    const stats = monsterStats("brute", 40, eliteMods(rare));
    expect(stats.maxLife).toBe(Math.round(life * 2));
    expect(stats.attackIntervalMs).toBe(Math.round(1000 / (MONSTERS.brute.attacksPerSecond * 1.2)));
    expect(stats.resistances).toEqual({ fire: 30, cold: 30, lightning: 30 });
  });

  it("spawn with life matching their modifiers", () => {
    for (const m of spawnMany(inMap(["teeming"]), 2_000).filter((x) => x.rank !== undefined)) {
      expect(m.maxLife).toBe(monsterStats(m.defId, m.level, eliteMods(m)).maxLife);
    }
  });

  it("are named after their affixes", () => {
    expect(monsterDisplayName({ defId: "brute" })).toBe("Brute");
    expect(monsterDisplayName({ defId: "brute", rank: "magic", affixes: ["hasted"] })).toBe("Hasted Brute");
    expect(monsterDisplayName({ defId: "skirmisher", rank: "rare", affixes: ["brutal", "warded"] })).toBe("Rare Skirmisher (Brutal, Warded)");
  });

  it("every affix only uses stats that monsterStats supports", () => {
    const supported = new Set(["life_max", "damage", "attack_speed", "armor", "resistance", "gain_as_extra", "ailment_chance"]);
    for (const def of Object.values(MONSTER_AFFIXES)) {
      for (const mod of def.mods) expect(supported.has(mod.stat)).toBe(true);
    }
  });

  it("killing elites grants their XP multiplier and the run stays split-invariant", () => {
    const run = (chunks: number[]) => {
      const state = inMap(["teeming"]);
      state.character.level = MAX_LEVEL;
      for (const ms of chunks) advance(state, ms);
      return state;
    };
    const whole = run([600_000]);
    const split = run([123_457, 76_543, 400_000]);
    expect(split.character).toEqual(whole.character);
    expect(split.inventory).toEqual(whole.inventory);
    expect(split.progression).toEqual(whole.progression);
  });

  it("elite kill XP is the base XP times the rank multiplier", () => {
    const state = createInitialState(3);
    state.character.level = 10;
    state.progression.unlockedZones = ["ashen_outskirts", "drowned_fields", "hollow_pines"];
    state.progression.activity = { kind: "zone", zoneId: "hollow_pines" };
    const kills: { defId: string; xp: number }[] = [];
    let elite: MonsterRuntime | undefined;
    for (let i = 0; i < 2_000 && elite === undefined; i++) {
      const before = state.encounter?.monsters.map((m) => ({ ...m })) ?? [];
      const { events } = advance(state, 500);
      for (const e of events) {
        if (e.type === "monster_killed" && !e.isBoss) {
          // Only a lone survivor identifies the killed monster unambiguously.
          const alive = before.filter((x) => x.alive);
          const m = alive.length === 1 && alive[0]!.rank !== undefined ? alive[0] : undefined;
          if (m !== undefined && m.defId === e.defId) {
            elite = m;
            kills.push({ defId: e.defId, xp: e.xp });
          }
        }
      }
    }
    expect(elite).toBeDefined();
    const base = monsterStats(elite!.defId as MonsterId, elite!.level).xp;
    // Same-level kills carry no level penalty within the safe range.
    expect(kills[0]!.xp).toBe(Math.round(base * ELITE_RANKS[elite!.rank!].xpMult));
  });
});
