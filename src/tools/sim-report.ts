// Headless balance simulation (plan §14.4), v1: one fixed build preset.
//
//   npm run sim -- [--zone=<id>] [--level=<n>] [--hours=<n>] [--seed=<n>]
//
// Without --zone it runs the campaign from the start with auto-advance on and reports when
// each zone was unlocked. With --zone it farms that zone (auto-advance and auto-retreat off).

import { MAX_LEVEL, PASSIVE_POINT_EVERY_LEVELS, xpToNextLevel } from "../data/balance";
import { SKILLS } from "../data/skills";
import { SUPPORTS } from "../data/supports";
import { ZONE_ORDER, ZONES, type ZoneId } from "../data/zones";
import { advance } from "../game/engine";
import { computeMaxLife } from "../game/stats";
import { createInitialState, supportSlotCount, type GameState } from "../game/state";
import { validateState } from "../game/validate";
import { HEAVY_STRIKE_BRUTE_FORCE, type BuildPreset } from "./presets/heavy-strike-brute-force";

// Minimal Node globals, to avoid a dependency on @types/node for one script.
declare const process: { argv: string[]; exitCode: number | undefined };

interface Options {
  zone: ZoneId | null;
  level: number;
  hours: number;
  seed: number;
}

/** Presets are re-applied between chunks, so a level-up takes effect at most this late. */
const CHUNK_MS = 10_000;

const PRESET = HEAVY_STRIKE_BRUTE_FORCE;

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { zone: null, level: 1, hours: 8, seed: 1 };
  for (const arg of argv) {
    const match = /^--([a-z]+)=(.*)$/.exec(arg);
    if (match === null) {
      throw new Error(`unrecognized argument "${arg}"`);
    }
    const [, key, value] = match as unknown as [string, string, string];
    switch (key) {
      case "zone":
        if (!(ZONE_ORDER as readonly string[]).includes(value)) {
          throw new Error(`unknown zone "${value}"; expected one of ${ZONE_ORDER.join(", ")}`);
        }
        options.zone = value as ZoneId;
        break;
      case "level":
        options.level = parseIntArg(key, value, 1, MAX_LEVEL);
        break;
      case "hours":
        options.hours = Number(value);
        if (!(options.hours > 0)) throw new Error("--hours must be positive");
        break;
      case "seed":
        options.seed = parseIntArg(key, value, 0, 0xffffffff);
        break;
      default:
        throw new Error(`unknown option --${key}`);
    }
  }
  return options;
}

function parseIntArg(key: string, value: string, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`--${key} must be an integer in [${min}, ${max}]`);
  }
  return n;
}

function assertValid(state: GameState, what: string): void {
  const validation = validateState(state);
  if (!validation.ok) {
    throw new Error(`invalid ${what}: ${validation.errors.join("; ")}`);
  }
}

/**
 * Sets the preset's skill, fills support slots and allocates passives up to the points the
 * current level grants. Tool-only: it writes the build directly instead of going through
 * player actions, then validates the result.
 */
function applyPreset(state: GameState, preset: BuildPreset): void {
  const { character } = state;
  const skill = SKILLS[preset.skill];
  if (character.level < skill.unlockLevel) {
    throw new Error(`preset skill ${skill.name} requires level ${skill.unlockLevel}`);
  }
  character.activeSkillId = preset.skill;

  const supports = preset.supportPriority.filter((id) => {
    const support = SUPPORTS[id];
    return (
      support.unlockLevel <= character.level &&
      support.requiresTags.every((tag) => skill.tags.includes(tag)) &&
      !support.excludesTags.some((tag) => skill.tags.includes(tag))
    );
  });
  character.supportIds = Array.from({ length: supportSlotCount(character.level) }, (_, i) => supports[i] ?? null);

  const points = Math.floor(character.level / PASSIVE_POINT_EVERY_LEVELS);
  character.allocatedPassives = preset.passiveOrder.slice(0, points);
  assertValid(state, `state after applying preset "${preset.name}"`);
}

function setupState(options: Options): GameState {
  const state = createInitialState(options.seed);
  state.character.level = options.level;
  applyPreset(state, PRESET);
  state.character.life = computeMaxLife(state);

  if (options.zone !== null) {
    // Unlock every zone up to the requested one, as if the campaign had been played.
    const target = ZONE_ORDER.indexOf(options.zone);
    for (const [i, zoneId] of ZONE_ORDER.entries()) {
      if (i > target) break;
      if (!state.progression.unlockedZones.includes(zoneId)) state.progression.unlockedZones.push(zoneId);
      state.progression.zoneProgress[zoneId] = { encountersCleared: 0, bossDefeated: i < target };
    }
    state.progression.activity = { kind: "zone", zoneId: options.zone };
    state.settings.autoAdvance = false;
    // Keep farming the requested zone so the numbers describe it alone.
    state.settings.autoRetreat = false;
  }

  assertValid(state, "setup state");
  return state;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, "0")}m`;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function seconds(ms: number | null): string {
  return ms === null ? "n/a" : `${(ms / 1000).toFixed(2)} s`;
}

function run(options: Options): void {
  const state = setupState(options);
  const totalMs = Math.round(options.hours * 3_600_000);

  const clearTimes: number[] = [];
  const bossClearTimes: number[] = [];
  const zoneUnlockedAt: [ZoneId, number][] = [];
  let encounterStartedAt: number | null = null;
  let deaths = 0;
  let xpGained = 0;
  let kills = 0;
  let levelledUp = false;

  for (let elapsed = 0; elapsed < totalMs; elapsed += CHUNK_MS) {
    const { events } = advance(state, Math.min(CHUNK_MS, totalMs - elapsed));
    for (const event of events) {
      switch (event.type) {
        case "encounter_started":
          encounterStartedAt = event.timeMs;
          break;
        case "encounter_cleared":
          if (encounterStartedAt !== null) {
            (event.isBoss ? bossClearTimes : clearTimes).push(event.timeMs - encounterStartedAt);
          }
          encounterStartedAt = null;
          break;
        case "player_died":
          deaths += 1;
          encounterStartedAt = null;
          break;
        case "monster_killed":
          kills += 1;
          xpGained += event.xp;
          break;
        case "zone_unlocked":
          zoneUnlockedAt.push([event.zoneId, event.timeMs]);
          break;
        case "level_up":
          levelledUp = true;
          break;
        case "activity_changed":
          break;
      }
    }
    if (levelledUp) {
      applyPreset(state, PRESET);
      levelledUp = false;
    }
  }

  const hours = totalMs / 3_600_000;
  const xpPerHour = xpGained / hours;
  const { character, progression } = state;
  const activity = progression.activity;
  const lines = [
    `sim-report v1 — build: ${PRESET.name} (Rusted Blade, no other gear)`,
    `seed ${options.seed}, ${options.hours} h, ${options.zone === null ? "campaign from start" : `farming ${ZONES[options.zone].name}`}`,
    ``,
    `avg normal clear time:  ${seconds(mean(clearTimes))} (${clearTimes.length} encounters)`,
    `avg boss clear time:    ${seconds(mean(bossClearTimes))} (${bossClearTimes.length} kills)`,
    `deaths / hour:          ${(deaths / hours).toFixed(2)}`,
    `kills / hour:           ${(kills / hours).toFixed(0)}`,
    `XP / hour:              ${xpPerHour.toFixed(0)}`,
    `final level:            ${character.level} (${Math.floor(character.xp)} XP)`,
    `time to next level:     ${
      character.level >= MAX_LEVEL || xpPerHour <= 0
        ? "n/a"
        : formatDuration(((xpToNextLevel(character.level) - character.xp) / xpPerHour) * 3_600_000)
    }`,
    `final activity:         ${activity.kind === "zone" ? ZONES[activity.zoneId].name : `map tier ${activity.tier}`}`,
  ];
  if (zoneUnlockedAt.length > 0) {
    lines.push(``, `zones unlocked:`);
    for (const [zoneId, timeMs] of zoneUnlockedAt) {
      lines.push(`  ${formatDuration(timeMs).padStart(8)}  ${ZONES[zoneId].name}`);
    }
  }
  console.log(lines.join("\n"));
}

try {
  run(parseArgs(process.argv.slice(2)));
} catch (e) {
  console.error(`sim-report: ${(e as Error).message}`);
  process.exitCode = 1;
}
