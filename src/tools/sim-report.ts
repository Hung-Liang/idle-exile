// Headless balance simulation (plan §14.4) with fixed build presets.
//
//   npm run sim -- [--preset=<id>|all] [--zone=<id>] [--level=<n>] [--hours=<n>] [--seed=<n>|--seeds=<a>-<b>]
//                  [--gear=auto|none] [--resume=<minutes>] [--progression]
//
// --preset=all runs every preset with the same options and prints a side-by-side summary.
// Without --zone it runs the campaign from the start with auto-advance on (the --progression
// mode of plan §14.4; the flag only makes the intent explicit) and reports, per zone and map
// tier, when it was reached and cleared, the clear time while it was the frontier, and every
// retreat that paused auto-advance. With --zone it farms that zone (auto-advance and
// auto-retreat off).
// --seeds=<a>-<b> runs every seed in the range and prints one summary row per seed.
// With --gear=auto (default) dropped items are equipped by a tool-only heuristic: equip when
// DPS or EHP improves without lowering the other by more than 5%. Unequipped items are then
// salvaged so the inventory never overflows.
// With --resume=<minutes> (campaign only), a returning player checks every N minutes of sim
// time and switches auto-advance back on after a retreat paused it, once the character level
// is within RESUME_LEVEL_MARGIN of the area it retreated from.

import {
  EVALUATE_PACK_SIZE,
  INVENTORY_CAPACITY,
  MAX_LEVEL,
  monsterBaseDamage,
  monsterBaseLife,
  PACK_SIZE_WEIGHTS,
  xpToNextLevel,
} from "../data/balance";
import { DROP_TABLES } from "../data/drop-tables";
import { BOSSES, MONSTERS } from "../data/monsters";
import { CURRENCIES, type CurrencyId } from "../data/currencies";
import { SKILLS } from "../data/skills";
import { mapTier } from "../data/maps";
import { ZONE_ORDER, ZONES, type ZoneId } from "../data/zones";
import { advance, dispatch } from "../game/engine";
import { itemBase, RARITIES, slotsForClass, type EquipSlot, type Rarity } from "../game/equipment";
import { evaluateBuild, evaluateState, isUpgrade, withEquipment, type BuildEvaluation } from "../game/evaluate";
import { describeItem, generateItem } from "../game/loot";
import { createStreamState, weightedIndex } from "../game/random";
import { collectBuild, computeMaxLife } from "../game/stats";
import { createInitialState, supportSlotCount, type Activity, type GameState } from "../game/state";
import { validateState } from "../game/validate";
import { applyPreset, PRESETS, type BuildPreset } from "./presets";

// Minimal Node globals, to avoid a dependency on @types/node for one script.
declare const process: { argv: string[]; exitCode: number | undefined };

interface Options {
  presets: readonly BuildPreset[];
  zone: ZoneId | null;
  level: number;
  hours: number;
  seeds: readonly number[];
  /** --seeds: print one summary row per (preset, seed) instead of a full report. */
  sweep: boolean;
  autoGear: boolean;
  /** Sim ms between re-enabling auto-advance; null = never. */
  resumeMs: number | null;
  /** --curve: print standardized on-level power versus the monster curves instead of simulating. */
  curve: boolean;
}

/**
 * --resume models a returning player who switches auto-advance back on only once the character
 * is within this many levels of the area it retreated from.
 */
const RESUME_LEVEL_MARGIN = 5;

/** Presets are re-applied between chunks, so a level-up takes effect at most this late. */
const CHUNK_MS = 10_000;

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { presets: [PRESETS[0]!], zone: null, level: 1, hours: 8, seeds: [1], sweep: false, autoGear: true, resumeMs: null, curve: false };
  let progression = false;
  for (const arg of argv) {
    if (arg === "--progression") {
      progression = true;
      continue;
    }
    if (arg === "--curve") {
      options.curve = true;
      continue;
    }
    const match = /^--([a-z]+)=(.*)$/.exec(arg);
    if (match === null) {
      throw new Error(`unrecognized argument "${arg}"`);
    }
    const [, key, value] = match as unknown as [string, string, string];
    switch (key) {
      case "preset": {
        if (value === "all") {
          options.presets = PRESETS;
          break;
        }
        const preset = PRESETS.find((p) => p.id === value);
        if (preset === undefined) {
          throw new Error(`unknown preset "${value}"; expected all or one of ${PRESETS.map((p) => p.id).join(", ")}`);
        }
        options.presets = [preset];
        break;
      }
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
        options.seeds = [parseIntArg(key, value, 0, 0xffffffff)];
        options.sweep = false;
        break;
      case "seeds": {
        const range = /^(\d+)-(\d+)$/.exec(value);
        const [first, last] = range === null ? [NaN, NaN] : [Number(range[1]), Number(range[2])];
        if (!(first <= last)) throw new Error("--seeds must be a range <a>-<b> with a ≤ b");
        options.seeds = Array.from({ length: last - first + 1 }, (_, i) => first + i);
        options.sweep = true;
        break;
      }
      case "gear":
        if (value !== "auto" && value !== "none") throw new Error("--gear must be auto or none");
        options.autoGear = value === "auto";
        break;
      case "resume":
        options.resumeMs = parseIntArg(key, value, 1, 24 * 60) * 60_000;
        break;
      default:
        throw new Error(`unknown option --${key}`);
    }
  }
  if (progression && (options.zone !== null || options.level !== 1)) {
    throw new Error("--progression starts the campaign at level 1; it cannot be combined with --zone or --level");
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
 * Tool-only gear heuristic: repeatedly equips the unequipped item with the best DPS × EHP gain
 * that passes `isUpgrade`, then salvages everything left. All changes go through
 * `dispatch`, like player actions.
 */
function autoGear(state: GameState): string[] {
  const equipped: string[] = [];
  for (;;) {
    const current = evaluateState(state);
    let best: { itemId: string; slot: EquipSlot; score: number } | null = null;
    for (const itemId of state.inventory.order) {
      const item = state.inventory.items[itemId]!;
      const base = itemBase(item);
      if (base.requiredLevel > state.character.level) continue;
      for (const slot of slotsForClass(base.itemClass)) {
        const candidate = evaluateState(withEquipment(state, slot, itemId));
        if (!isUpgrade(current, candidate)) continue;
        const score = (candidate.singleTargetDps / current.singleTargetDps) * (candidate.ehp / current.ehp);
        if (best === null || score > best.score) best = { itemId, slot, score };
      }
    }
    if (best === null) break;
    equipped.push(describeItem(state.inventory.items[best.itemId]!));
    const result = dispatch(state, { type: "equip_item", itemId: best.itemId, slot: best.slot });
    if (!result.ok) throw new Error(`autoGear: equip rejected (${result.reason})`);
  }
  for (const itemId of [...state.inventory.order]) {
    const result = dispatch(state, { type: "salvage_item", itemId });
    if (!result.ok) throw new Error(`autoGear: salvage rejected (${result.reason})`);
  }
  return equipped;
}

function setupState(options: Options, preset: BuildPreset, seed: number): GameState {
  const state = createInitialState(seed);
  state.character.level = options.level;
  state.character.supportIds = Array.from({ length: supportSlotCount(options.level) }, () => null);
  applyPreset(state, preset);
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

/** Progress through one zone or map tier while it was the frontier (not yet cleared). */
interface AreaStats {
  name: string;
  monsterLevel: number;
  reachedAt: number;
  levelReached: number;
  /** Standardized single-target DPS, EHP and max life when first reached. */
  reachedEvaluation: BuildEvaluation;
  clearedAt: number | null;
  levelCleared: number | null;
  frontierClearTimes: number[];
  frontierDeaths: number;
}

interface Retreat {
  timeMs: number;
  from: string;
  fromMonsterLevel: number;
  to: string;
  level: number;
}

function activityName(activity: Activity): string {
  return activity.kind === "zone" ? ZONES[activity.zoneId].name : `Map Tier ${activity.tier}`;
}

interface Summary {
  preset: BuildPreset;
  seed: number;
  clearMs: number | null;
  /** Mean normal clear time while each area was the frontier. */
  frontierClearMs: number | null;
  campaignMs: number | null;
  level30Ms: number | null;
  retreats: Retreat[];
  deathsPerHour: number;
  /** Deaths per hour while farming areas already cleared once; null when never farming. */
  farmDeathsPerHour: number | null;
  xpPerHour: number;
  finalLevel: number;
  finalActivity: string;
  evaluation: BuildEvaluation;
}

function simulate(options: Options, preset: BuildPreset, seed: number): { lines: string[]; summary: Summary } {
  const state = setupState(options, preset, seed);
  const totalMs = Math.round(options.hours * 3_600_000);

  const clearTimes: number[] = [];
  const bossClearTimes: number[] = [];
  const mapTierUnlockedAt: [number, number][] = [];
  let encounterStartedAt: number | null = null;
  let deaths = 0;
  let xpGained = 0;
  let kills = 0;
  let levelledUp = false;
  let lootArrived = false;
  const itemsByRarity: Record<Rarity, number> = { normal: 0, magic: 0, rare: 0, unique: 0 };
  const currencyGained = Object.fromEntries(Object.keys(CURRENCIES).map((id) => [id, 0])) as Record<CurrencyId, number>;
  let overflow = 0;
  let upgrades = 0;
  let lastResumeAt = 0;
  let resumes = 0;
  let level30Ms: number | null = state.character.level >= 30 ? 0 : null;
  const areas = new Map<string, AreaStats>();
  const retreats: Retreat[] = [];
  // Takes the activity from the event: several changes can happen within one chunk.
  const enterArea = (activity: Activity, timeMs: number): AreaStats => {
    const name = activityName(activity);
    if (!areas.has(name)) {
      areas.set(name, {
        name,
        monsterLevel: activity.kind === "zone" ? ZONES[activity.zoneId].monsterLevel : mapTier(activity.tier).monsterLevel,
        reachedAt: timeMs,
        levelReached: state.character.level,
        reachedEvaluation: evaluateState(state),
        clearedAt: null,
        levelCleared: null,
        frontierClearTimes: [],
        frontierDeaths: 0,
      });
    }
    return areas.get(name)!;
  };
  let area = enterArea(state.progression.activity, 0);
  let lastDeathAt: number | null = null;
  // Farming = in an area whose boss has been killed before (sampled per chunk).
  let farmDeaths = 0;
  let farmMs = 0;

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
            if (!event.isBoss && area.clearedAt === null) area.frontierClearTimes.push(event.timeMs - encounterStartedAt);
          }
          if (event.isBoss && area.clearedAt === null) {
            area.clearedAt = event.timeMs;
            area.levelCleared = state.character.level;
          }
          encounterStartedAt = null;
          break;
        case "player_died":
          deaths += 1;
          lastDeathAt = event.timeMs;
          if (area.clearedAt === null) area.frontierDeaths += 1;
          else farmDeaths += 1;
          encounterStartedAt = null;
          break;
        case "activity_changed": {
          const from = area;
          area = enterArea(event.activity, event.timeMs);
          // Only a retreat changes the activity at the instant of a death.
          if (event.timeMs === lastDeathAt) {
            retreats.push({ timeMs: event.timeMs, from: from.name, fromMonsterLevel: from.monsterLevel, to: area.name, level: state.character.level });
          }
          break;
        }
        case "monster_killed":
          kills += 1;
          xpGained += event.xp;
          break;
        case "map_tier_unlocked":
          mapTierUnlockedAt.push([event.tier, event.timeMs]);
          break;
        case "level_up":
          levelledUp = true;
          if (event.level >= 30) level30Ms ??= event.timeMs;
          break;
        case "item_dropped":
          itemsByRarity[event.rarity] += 1;
          if (event.outcome === "overflow") overflow += 1;
          if (event.outcome === "kept") lootArrived = true;
          break;
        case "currency_gained":
          if (event.source === "drop") currencyGained[event.currencyId] += event.amount;
          break;
        default:
          break;
      }
    }
    if (area.clearedAt !== null) farmMs += Math.min(CHUNK_MS, totalMs - elapsed);
    if (levelledUp) {
      applyPreset(state, preset);
    }
    const resumeMs = options.zone === null ? options.resumeMs : null;
    const lastRetreat = retreats.at(-1);
    if (
      resumeMs !== null &&
      !state.settings.autoAdvance &&
      state.simTimeMs - lastResumeAt >= resumeMs &&
      (lastRetreat === undefined || state.character.level + RESUME_LEVEL_MARGIN >= lastRetreat.fromMonsterLevel)
    ) {
      dispatch(state, { type: "set_auto_advance", value: true });
      lastResumeAt = state.simTimeMs;
      resumes += 1;
    }
    if (options.autoGear && (lootArrived || levelledUp)) {
      upgrades += autoGear(state).length;
    }
    levelledUp = false;
    lootArrived = false;
  }
  assertValid(state, "final state");

  const hours = totalMs / 3_600_000;
  const xpPerHour = xpGained / hours;
  const { character, progression } = state;
  const activity = progression.activity;
  const evaluation = evaluateState(state);
  const perHour = (n: number) => (n / hours).toFixed(1);
  const finalActivity = activity.kind === "zone" ? ZONES[activity.zoneId].name : `map tier ${activity.tier}`;
  const supports = character.supportIds.filter((id) => id !== null).join(", ") || "none";
  const lines = [
    `sim-report — build: ${preset.name} (gear: ${options.autoGear ? "auto-equip drops" : "starting weapon only"})`,
    `seed ${seed}, ${options.hours} h, ${options.zone === null ? "campaign from start" : `farming ${ZONES[options.zone].name}`}`,
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
    `final activity:         ${finalActivity}`,
    `final skill:            ${SKILLS[character.activeSkillId].name} (supports: ${supports}; ${character.allocatedPassives.length} passives)`,
    `items / hour:           ${RARITIES.map((r) => `${r} ${perHour(itemsByRarity[r])}`).join(", ")} (overflow ${overflow})`,
    `currency / hour:        ${Object.entries(currencyGained)
      .map(([id, n]) => `${CURRENCIES[id as CurrencyId].name} ${perHour(n)}`)
      .join(", ")}`,
    `gear upgrades equipped: ${upgrades}`,
    ...(options.resumeMs === null ? [] : [`auto-advance resumed:  ${resumes} times`]),
    `final DPS (single/pack): ${evaluation.singleTargetDps.toFixed(1)} / ${evaluation.packDps.toFixed(1)} (standardized estimate)`,
    `final EHP:              ${evaluation.ehp.toFixed(0)} (max life ${evaluation.defenses.maxLife}, armor ${Math.round(evaluation.defenses.armor)})`,
  ];
  lines.push(``, `final gear:`);
  for (const [slot, itemId] of Object.entries(character.equipment)) {
    lines.push(`  ${slot.padEnd(7)} ${itemId === null ? "—" : describeItem(state.inventory.items[itemId]!)}`);
  }
  if (options.zone === null) {
    lines.push(``, `progression (frontier = before the area's first boss kill):`, ...progressionLines([...areas.values()]));
    lines.push(``, `retreats (auto-advance paused):`);
    if (retreats.length === 0) lines.push(`  none`);
    for (const r of retreats) {
      lines.push(`  ${formatDuration(r.timeMs).padStart(8)}  Lv${String(r.level).padEnd(3)} ${r.from} → ${r.to}`);
    }
  }
  const campaignMs = mapTierUnlockedAt.find(([tier]) => tier === 1)?.[1] ?? null;
  const frontierTimes = [...areas.values()].flatMap((a) => a.frontierClearTimes);
  if (options.zone === null) {
    lines.push(
      ``,
      `balance targets (plan §14.5):`,
      `  campaign completion:   ${campaignMs === null ? "not reached" : formatDuration(campaignMs)}  (target 15–25 h)`,
      `  level 30:              ${level30Ms === null ? "not reached" : formatDuration(level30Ms)}  (target ~12 h)`,
      `  frontier normal clear: ${seconds(mean(frontierTimes))}  (target 3–8 s)`,
      `  deaths / hour:         ${(deaths / hours).toFixed(2)} overall, ${
        farmMs === 0 ? "n/a" : (farmDeaths / (farmMs / 3_600_000)).toFixed(2)
      } while farming cleared areas  (target < 2 at an appropriate zone)`,
    );
  }
  const summary: Summary = {
    preset,
    seed,
    clearMs: mean(clearTimes),
    frontierClearMs: mean(frontierTimes),
    campaignMs,
    level30Ms,
    retreats,
    deathsPerHour: deaths / hours,
    farmDeathsPerHour: farmMs === 0 ? null : farmDeaths / (farmMs / 3_600_000),
    xpPerHour,
    finalLevel: character.level,
    finalActivity,
    evaluation,
  };
  return { lines, summary };
}

function progressionLines(areas: readonly AreaStats[]): string[] {
  const header = ["area", "reached", "lv", "DPS", "EHP", "life", "cleared", "lv", "frontier clear", "deaths"];
  const rows = areas.map((a) => [
    a.name,
    formatDuration(a.reachedAt),
    String(a.levelReached),
    a.reachedEvaluation.singleTargetDps.toFixed(0),
    a.reachedEvaluation.ehp.toFixed(0),
    String(a.reachedEvaluation.defenses.maxLife),
    a.clearedAt === null ? "—" : formatDuration(a.clearedAt),
    a.levelCleared === null ? "—" : String(a.levelCleared),
    `${seconds(mean(a.frontierClearTimes))} (${a.frontierClearTimes.length})`,
    String(a.frontierDeaths),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const format = (cells: string[]) => `  ${cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("  ")}`;
  return [format(header), ...rows.map(format)];
}

function comparisonLines(summaries: readonly Summary[]): string[] {
  const columns: [string, (s: Summary) => string][] = [
    ["single DPS", (s) => s.evaluation.singleTargetDps.toFixed(1)],
    ["pack DPS", (s) => s.evaluation.packDps.toFixed(1)],
    ["EHP", (s) => s.evaluation.ehp.toFixed(0)],
    ["max life", (s) => String(s.evaluation.defenses.maxLife)],
    ["clear", (s) => seconds(s.clearMs)],
    ["deaths/h", (s) => s.deathsPerHour.toFixed(2)],
    ["XP/h", (s) => s.xpPerHour.toFixed(0)],
    ["level", (s) => String(s.finalLevel)],
    ["activity", (s) => s.finalActivity],
  ];
  const nameWidth = Math.max(...summaries.map((s) => s.preset.id.length));
  const widths = columns.map(([h, get]) => Math.max(h.length, ...summaries.map((s) => get(s).length)));
  const row = (cells: string[]) => cells.map((c, i) => c.padStart(widths[i]!)).join("  ");
  return [
    `${"preset".padEnd(nameWidth)}  ${row(columns.map(([h]) => h))}`,
    ...summaries.map((s) => `${s.preset.id.padEnd(nameWidth)}  ${row(columns.map(([, get]) => get(s)))}`),
  ];
}

/** Items rolled per level for the --curve kit; roughly the drops of a few hours of farming. */
const CURVE_KIT_ITEMS = 800;
const CURVE_LEVELS = [1, 4, 8, 12, 17, 23, 30, 37, 40, 43, 46, 49, 50];
/** Monster levels relative to the character level shown by --curve. */
const CURVE_OFFSETS = [0, 5];

/**
 * A character at `level` with the preset applied and the best of CURVE_KIT_ITEMS normal-drop
 * items of item level `level` equipped by the auto-gear heuristic.
 */
function onLevelKit(preset: BuildPreset, seed: number, level: number): GameState {
  const state = createInitialState(seed);
  state.character.level = level;
  state.character.supportIds = Array.from({ length: supportSlotCount(level) }, () => null);
  applyPreset(state, preset);
  const rng = createStreamState(seed + level, "loot");
  const weights = RARITIES.map((r) => DROP_TABLES.normal.rarityWeights[r]);
  for (let i = 0; i < CURVE_KIT_ITEMS; i++) {
    const item = generateItem(state, level, RARITIES[weightedIndex(rng, weights)]!, rng);
    state.inventory.items[item.id] = item;
    state.inventory.order.push(item.id);
    if (state.inventory.order.length >= INVENTORY_CAPACITY - 1 || i === CURVE_KIT_ITEMS - 1) autoGear(state);
  }
  state.character.life = computeMaxLife(state);
  return state;
}

/** Average over the archetypes a zone of this monster level can spawn. */
function archetypeAverages(monsterLevel: number): { life: number; dps: number } {
  const pool = Object.values(MONSTERS).filter((m) => m.minZoneLevel <= monsterLevel);
  return {
    life: mean(pool.map((m) => m.lifeMult))!,
    dps: mean(pool.map((m) => m.damageMult * m.attacksPerSecond))!,
  };
}

function curveLines(preset: BuildPreset, seed: number): string[] {
  const packSize = PACK_SIZE_WEIGHTS.reduce((sum, w, i) => sum + w * (i + 1), 0) / PACK_SIZE_WEIGHTS.reduce((a, b) => a + b, 0);
  const header = ["lv", "M", "DPS", "pack DPS", "life", "EHP", "pack clear", "pack TTD", "boss clear", "boss TTD"];
  const rows: string[][] = [];
  for (const level of CURVE_LEVELS) {
    const state = onLevelKit(preset, seed, level);
    const build = collectBuild(state);
    for (const offset of CURVE_OFFSETS) {
      const m = level + offset;
      const evaluation = evaluateBuild(build, m);
      const avg = archetypeAverages(m);
      const dps = Math.max(evaluation.singleTargetDps, evaluation.packDps / Math.min(packSize, EVALUATE_PACK_SIZE));
      const packClear = (monsterBaseLife(m) * avg.life * packSize) / Math.min(evaluation.packDps, dps * packSize);
      // Incoming damage averages a full pack and a nearly cleared one.
      const packTtd = evaluation.ehp / (monsterBaseDamage(m) * avg.dps * (packSize + 1) / 2);
      const boss = BOSSES.gatewarden;
      const bossClear = (monsterBaseLife(m) * boss.lifeMult) / evaluation.singleTargetDps;
      const bossTtd = evaluation.ehp / (monsterBaseDamage(m) * boss.damageMult * boss.attacksPerSecond);
      rows.push([
        offset === 0 ? String(level) : "",
        String(m),
        evaluation.singleTargetDps.toFixed(0),
        evaluation.packDps.toFixed(0),
        String(evaluation.defenses.maxLife),
        evaluation.ehp.toFixed(0),
        `${packClear.toFixed(1)} s`,
        `${packTtd.toFixed(1)} s`,
        `${bossClear.toFixed(1)} s`,
        `${bossTtd.toFixed(1)} s`,
      ]);
    }
  }
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const format = (cells: string[]) => cells.map((c, i) => c.padStart(widths[i]!)).join("  ");
  return [
    `curve — ${preset.name}, on-level kit: best of ${CURVE_KIT_ITEMS} normal drops at item level = character level`,
    `(standardized estimates vs a 0-armor, 0-resistance target; TTD = time to die without recovery)`,
    ``,
    format(header),
    ...rows.map(format),
  ];
}

function optionalDuration(ms: number | null): string {
  return ms === null ? "—" : formatDuration(ms);
}

/** One row per (preset, seed); used for seed sweeps. */
function seedSweepLines(summaries: readonly Summary[]): string[] {
  const header = ["preset", "seed", "campaign", "lv30", "level", "frontier clear", "deaths/h", "farm deaths/h", "retreats", "first retreat", "final activity"];
  const rows = summaries.map((s) => {
    const first = s.retreats[0];
    return [
      s.preset.id,
      String(s.seed),
      optionalDuration(s.campaignMs),
      optionalDuration(s.level30Ms),
      String(s.finalLevel),
      seconds(s.frontierClearMs),
      s.deathsPerHour.toFixed(2),
      s.farmDeathsPerHour === null ? "—" : s.farmDeathsPerHour.toFixed(2),
      String(s.retreats.length),
      first === undefined ? "—" : `${formatDuration(first.timeMs)} ${first.from} (Lv${first.level})`,
      s.finalActivity,
    ];
  });
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const format = (cells: string[]) => cells.map((c, i) => (i === 0 || i >= 9 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("  ");
  return [format(header), ...rows.map(format)];
}

function run(options: Options): void {
  if (options.curve) {
    for (const preset of options.presets) console.log([...curveLines(preset, options.seeds[0]!), ""].join("\n"));
    return;
  }
  const scope = options.zone === null ? "campaign from start" : `farming ${ZONES[options.zone].name}`;
  const resume = options.resumeMs === null ? "" : `, resume every ${options.resumeMs / 60_000} min`;
  if (options.sweep) {
    const summaries = options.presets.flatMap((preset) => options.seeds.map((seed) => simulate(options, preset, seed).summary));
    console.log(
      [
        `sim-report — seeds ${options.seeds[0]}–${options.seeds.at(-1)}, ${options.hours} h, ${scope}, level ${options.level}${resume}`,
        ``,
        ...seedSweepLines(summaries),
      ].join("\n"),
    );
    return;
  }
  const seed = options.seeds[0]!;
  if (options.presets.length === 1) {
    console.log(simulate(options, options.presets[0]!, seed).lines.join("\n"));
    return;
  }
  const summaries = options.presets.map((preset) => simulate(options, preset, seed).summary);
  console.log(
    [
      `sim-report — all presets, seed ${seed}, ${options.hours} h, ${scope}, level ${options.level}, gear ${options.autoGear ? "auto" : "none"}${resume}`,
      `(DPS / EHP are standardized estimates of the final build)`,
      ``,
      ...comparisonLines(summaries),
    ].join("\n"),
  );
}

try {
  run(parseArgs(process.argv.slice(2)));
} catch (e) {
  console.error(`sim-report: ${(e as Error).message}`);
  process.exitCode = 1;
}
