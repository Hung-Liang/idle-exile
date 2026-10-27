// Headless balance simulation (plan §14.4) with fixed build presets.
//
//   npm run sim -- [--preset=<id>|all] [--zone=<id>] [--level=<n>] [--hours=<n>] [--seed=<n>] [--gear=auto|none]
//                  [--resume=<minutes>]
//
// --preset=all runs every preset with the same options and prints a side-by-side summary.
// Without --zone it runs the campaign from the start with auto-advance on and reports when
// each zone was unlocked. With --zone it farms that zone (auto-advance and auto-retreat off).
// With --gear=auto (default) dropped items are equipped by a tool-only heuristic: equip when
// DPS or EHP improves without lowering the other by more than 5%. Unequipped items are then
// salvaged so the inventory never overflows.
// With --resume=<minutes> (campaign only), auto-advance is switched back on every N minutes
// of sim time after a retreat paused it, as a returning player would.

import { MAX_LEVEL, xpToNextLevel } from "../data/balance";
import { CURRENCIES, type CurrencyId } from "../data/currencies";
import { SKILLS } from "../data/skills";
import { ZONE_ORDER, ZONES, type ZoneId } from "../data/zones";
import { advance, dispatch } from "../game/engine";
import { itemBase, RARITIES, slotsForClass, type EquipSlot, type Rarity } from "../game/equipment";
import { evaluateState, withEquipment, type BuildEvaluation } from "../game/evaluate";
import { describeItem } from "../game/loot";
import { computeMaxLife } from "../game/stats";
import { createInitialState, supportSlotCount, type GameState } from "../game/state";
import { validateState } from "../game/validate";
import { applyPreset, PRESETS, type BuildPreset } from "./presets";

// Minimal Node globals, to avoid a dependency on @types/node for one script.
declare const process: { argv: string[]; exitCode: number | undefined };

interface Options {
  presets: readonly BuildPreset[];
  zone: ZoneId | null;
  level: number;
  hours: number;
  seed: number;
  autoGear: boolean;
  /** Sim ms between re-enabling auto-advance; null = never. */
  resumeMs: number | null;
}

/** Presets are re-applied between chunks, so a level-up takes effect at most this late. */
const CHUNK_MS = 10_000;

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { presets: [PRESETS[0]!], zone: null, level: 1, hours: 8, seed: 1, autoGear: true, resumeMs: null };
  for (const arg of argv) {
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
        options.seed = parseIntArg(key, value, 0, 0xffffffff);
        break;
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

/** Allowed relative loss on the other metric when one improves (plan §14.4). */
const GEAR_TOLERANCE = 0.05;

function isUpgrade(current: BuildEvaluation, candidate: BuildEvaluation): boolean {
  const dps = candidate.singleTargetDps / current.singleTargetDps;
  const ehp = candidate.ehp / current.ehp;
  // The product must also grow: otherwise swapping a DPS item and an EHP item back and forth
  // would satisfy the rule in both directions forever.
  return ((dps > 1 && ehp >= 1 - GEAR_TOLERANCE) || (ehp > 1 && dps >= 1 - GEAR_TOLERANCE)) && dps * ehp > 1 + 1e-9;
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

function setupState(options: Options, preset: BuildPreset): GameState {
  const state = createInitialState(options.seed);
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

interface Summary {
  preset: BuildPreset;
  clearMs: number | null;
  deathsPerHour: number;
  xpPerHour: number;
  finalLevel: number;
  finalActivity: string;
  evaluation: BuildEvaluation;
}

function simulate(options: Options, preset: BuildPreset): { lines: string[]; summary: Summary } {
  const state = setupState(options, preset);
  const totalMs = Math.round(options.hours * 3_600_000);

  const clearTimes: number[] = [];
  const bossClearTimes: number[] = [];
  const zoneUnlockedAt: [ZoneId, number][] = [];
  const mapTierUnlockedAt: [number, number][] = [];
  let encounterStartedAt: number | null = null;
  let deaths = 0;
  let xpGained = 0;
  let kills = 0;
  let levelledUp = false;
  let lootArrived = false;
  const itemsByRarity: Record<Rarity, number> = { normal: 0, magic: 0, rare: 0 };
  const currencyGained = Object.fromEntries(Object.keys(CURRENCIES).map((id) => [id, 0])) as Record<CurrencyId, number>;
  let overflow = 0;
  let upgrades = 0;
  let lastResumeAt = 0;
  let resumes = 0;

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
        case "map_tier_unlocked":
          mapTierUnlockedAt.push([event.tier, event.timeMs]);
          break;
        case "level_up":
          levelledUp = true;
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
    if (levelledUp) {
      applyPreset(state, preset);
    }
    const resumeMs = options.zone === null ? options.resumeMs : null;
    if (resumeMs !== null && !state.settings.autoAdvance && state.simTimeMs - lastResumeAt >= resumeMs) {
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
  if (zoneUnlockedAt.length > 0) {
    lines.push(``, `zones unlocked:`);
    for (const [zoneId, timeMs] of zoneUnlockedAt) {
      lines.push(`  ${formatDuration(timeMs).padStart(8)}  ${ZONES[zoneId].name}`);
    }
  }
  if (mapTierUnlockedAt.length > 0) {
    lines.push(``, `map tiers unlocked:`);
    for (const [tier, timeMs] of mapTierUnlockedAt) {
      lines.push(`  ${formatDuration(timeMs).padStart(8)}  Map Tier ${tier}`);
    }
  }
  const summary: Summary = {
    preset,
    clearMs: mean(clearTimes),
    deathsPerHour: deaths / hours,
    xpPerHour,
    finalLevel: character.level,
    finalActivity,
    evaluation,
  };
  return { lines, summary };
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

function run(options: Options): void {
  if (options.presets.length === 1) {
    console.log(simulate(options, options.presets[0]!).lines.join("\n"));
    return;
  }
  const summaries = options.presets.map((preset) => simulate(options, preset).summary);
  const scope = options.zone === null ? "campaign from start" : `farming ${ZONES[options.zone].name}`;
  console.log(
    [
      `sim-report — all presets, seed ${options.seed}, ${options.hours} h, ${scope}, level ${options.level}, gear ${options.autoGear ? "auto" : "none"}`,
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
