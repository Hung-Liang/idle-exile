import { DEATHS_BEFORE_RETREAT, RESPAWN_MS, TRANSITION_LIFE_RECOVERY_PCT, TRANSITION_MS } from "../data/balance";
import { STACKS, type StackId } from "../data/stacks";
import type { ZoneId } from "../data/zones";
import { mitigateHit, monsterStats, resolveHit, rollAttack, rollMonsterHit } from "./combat";
import { createEncounter } from "./encounters";
import { nextScheduledEvent, type GameEvent } from "./events";
import {
  grantXp,
  recordBossDefeated,
  recordEncounterCleared,
  retreat,
  travelToZone,
  xpMultiplier,
} from "./progression";
import { attackIntervalMs, collectBuild, computeDefenses, type DefensiveStats, type PlayerBuild } from "./stats";
import { appendLog, type EncounterRuntime, type GameState } from "./state";
import { resolveActivity } from "./zones";

export interface AdvanceResult {
  events: GameEvent[];
}

export type PlayerAction =
  | { type: "set_auto_advance"; value: boolean }
  | { type: "set_auto_retreat"; value: boolean }
  | { type: "travel_to_zone"; zoneId: ZoneId };

export type ActionError = "zone_locked";

export type ActionResult = { ok: true; events: GameEvent[] } | { ok: false; reason: ActionError };

/** Per-call working data. Derived values are recomputed from state whenever the build may change. */
interface Sim {
  state: GameState;
  events: GameEvent[];
  build: PlayerBuild;
  defenses: DefensiveStats;
}

function refreshBuild(sim: Sim): void {
  sim.build = collectBuild(sim.state);
  sim.defenses = computeDefenses(sim.build);
}

function startEncounter(sim: Sim): EncounterRuntime {
  const { state } = sim;
  const encounter = createEncounter(resolveActivity(state), state.rng.encounter, state.simTimeMs);
  state.encounter = encounter;
  if (encounter.isBoss) {
    appendLog(state, "info", `${monsterStats(encounter.monsters[0]!.defId, encounter.monsters[0]!.level).name} appears!`);
  }
  sim.events.push({ type: "encounter_started", timeMs: state.simTimeMs, index: encounter.index, isBoss: encounter.isBoss });
  return encounter;
}

function stackIsReferenced(build: PlayerBuild, id: StackId): boolean {
  return build.mods.some((mod) => mod.perStack === id);
}

function onMonsterKilled(sim: Sim, encounter: EncounterRuntime, monsterIndex: number): void {
  const { state } = sim;
  const monster = encounter.monsters[monsterIndex]!;
  const stats = monsterStats(monster.defId, monster.level);
  monster.alive = false;
  state.progression.totalKills += 1;

  for (const id of Object.keys(STACKS) as StackId[]) {
    if (STACKS[id].gainOn === "kill" && stackIsReferenced(sim.build, id)) {
      encounter.stacks[id] = Math.min(STACKS[id].max, (encounter.stacks[id] ?? 0) + 1);
    }
  }

  const xp = Math.round(stats.xp * xpMultiplier(state.character.level, monster.level));
  const levelBefore = state.character.level;
  grantXp(state, xp, sim.events);
  if (state.character.level !== levelBefore) {
    refreshBuild(sim);
  }
  appendLog(state, "combat", `Slew ${stats.name} (+${xp} XP).`);
  sim.events.push({ type: "monster_killed", timeMs: state.simTimeMs, defId: monster.defId, isBoss: encounter.isBoss, xp });
}

function clearEncounter(sim: Sim, encounter: EncounterRuntime): void {
  const { state } = sim;
  encounter.phase = "transition";
  encounter.phaseEndsAt = state.simTimeMs + TRANSITION_MS;
  state.progression.consecutiveDeaths = 0;

  const maxLife = sim.defenses.maxLife;
  const recoveryPct = TRANSITION_LIFE_RECOVERY_PCT + sim.defenses.lifeRecoveryOnClearPct;
  state.character.life = Math.min(maxLife, state.character.life + Math.floor((maxLife * recoveryPct) / 100));

  sim.events.push({ type: "encounter_cleared", timeMs: state.simTimeMs, index: encounter.index, isBoss: encounter.isBoss });
  if (encounter.isBoss) {
    recordBossDefeated(state, sim.events);
  } else {
    recordEncounterCleared(state);
  }
}

function playerAttack(sim: Sim, encounter: EncounterRuntime): void {
  const { state, build } = sim;
  const alive = encounter.monsters.flatMap((m, i) => (m.alive ? [i] : []));
  const targetCount = 1 + (build.skill.chain?.additionalTargets ?? 0);
  const targets = alive.slice(0, targetCount);

  // Stacks gained by kills during this attack apply from the next attack on.
  const stacks = { ...encounter.stacks };
  const roll = rollAttack(build, stacks, state.rng.combat);
  const lifeOnHit = Math.floor(sim.defenses.lifeOnHit);

  targets.forEach((monsterIndex, hitIndex) => {
    const monster = encounter.monsters[monsterIndex]!;
    const stats = monsterStats(monster.defId, monster.level);
    const damage = resolveHit(
      build,
      roll,
      stacks,
      { armor: stats.armor, resistances: stats.resistances, lifePct: (monster.life / monster.maxLife) * 100 },
      hitIndex > 0,
    );
    monster.life = Math.max(0, monster.life - damage);
    if (lifeOnHit > 0) {
      state.character.life = Math.min(sim.defenses.maxLife, state.character.life + lifeOnHit);
    }
    if (monster.life === 0) {
      onMonsterKilled(sim, encounter, monsterIndex);
    }
  });

  if (encounter.monsters.every((m) => !m.alive)) {
    clearEncounter(sim, encounter);
  } else {
    encounter.player.nextAttackAt = state.simTimeMs + attackIntervalMs(sim.build, encounter.stacks);
  }
}

function monsterAttack(sim: Sim, encounter: EncounterRuntime, monsterIndex: number): void {
  const { state } = sim;
  const monster = encounter.monsters[monsterIndex]!;
  const stats = monsterStats(monster.defId, monster.level);
  const damage = mitigateHit(rollMonsterHit(stats, state.rng.combat), {
    armor: sim.defenses.armor,
    resistances: sim.defenses.resistances,
    resistanceMax: sim.defenses.resistanceMax,
  });
  state.character.life = Math.max(0, state.character.life - damage);
  monster.nextAttackAt = state.simTimeMs + stats.attackIntervalMs;

  if (state.character.life === 0) {
    playerDied(sim, encounter, stats.name);
  }
}

/** Plan §6.6: the pack is discarded, area progress is kept, and the same index restarts after the delay. */
function playerDied(sim: Sim, encounter: EncounterRuntime, killerName: string): void {
  const { state } = sim;
  encounter.phase = "respawning";
  encounter.phaseEndsAt = state.simTimeMs + RESPAWN_MS;
  encounter.monsters = [];
  state.progression.consecutiveDeaths += 1;
  appendLog(state, "death", `Slain by ${killerName}.`);
  sim.events.push({ type: "player_died", timeMs: state.simTimeMs });

  if (state.settings.autoRetreat && state.progression.consecutiveDeaths >= DEATHS_BEFORE_RETREAT) {
    retreat(state, sim.events);
  }
}

function phaseEnd(sim: Sim, encounter: EncounterRuntime): void {
  if (encounter.phase === "respawning") {
    sim.state.character.life = sim.defenses.maxLife;
  }
  startEncounter(sim);
}

/**
 * Advances the simulation by `ms` of game time, resolving every event with time ≤ the target
 * (inclusive). Mutates `state` in place. Splitting a call at any point yields the same state.
 */
export function advance(state: GameState, ms: number): AdvanceResult {
  if (!Number.isInteger(ms) || ms < 0) {
    throw new RangeError(`advance: ms must be a non-negative integer, got ${ms}`);
  }
  const targetTime = state.simTimeMs + ms;
  const build = collectBuild(state);
  const sim: Sim = { state, events: [], build, defenses: computeDefenses(build) };

  if (state.encounter === null) {
    state.character.life = sim.defenses.maxLife;
    startEncounter(sim);
  }

  for (;;) {
    const encounter = state.encounter!;
    const next = nextScheduledEvent(encounter);
    if (next === null || next.time > targetTime) {
      break;
    }
    state.simTimeMs = next.time;
    switch (next.kind) {
      case "phase_end":
        phaseEnd(sim, encounter);
        break;
      case "player_attack":
        playerAttack(sim, encounter);
        break;
      case "monster_attack":
        monsterAttack(sim, encounter, next.monsterIndex);
        break;
    }
  }

  state.simTimeMs = targetTime;
  return { events: sim.events };
}

/** Applies a validated player action. */
export function dispatch(state: GameState, action: PlayerAction): ActionResult {
  const events: GameEvent[] = [];
  switch (action.type) {
    case "set_auto_advance":
      state.settings.autoAdvance = action.value;
      return { ok: true, events };
    case "set_auto_retreat":
      state.settings.autoRetreat = action.value;
      return { ok: true, events };
    case "travel_to_zone":
      return travelToZone(state, action.zoneId, events) ? { ok: true, events } : { ok: false, reason: "zone_locked" };
  }
}
