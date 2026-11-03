import { autoAdvanceLevel, MAX_LEVEL, MAX_MAP_TIER, TRANSITION_MS, XP_MIN_MULTIPLIER, XP_PENALTY_PER_EXCESS_LEVEL, xpSafeRange, xpToNextLevel } from "../data/balance";
import { MAP_MODIFIERS, type MapModifierId } from "../data/map-modifiers";
import { MAP_MODIFIER_COUNT_WEIGHTS, mapTier } from "../data/maps";
import { ZONE_ORDER, ZONES, type ZoneId } from "../data/zones";
import type { GameEvent } from "./events";
import { nextInt, weightedIndex, type RngState } from "./random";
import { clampLifeToMax, computeMaxLife } from "./stats";
import { appendLog, supportSlotCount, type GameState } from "./state";

export function xpMultiplier(characterLevel: number, monsterLevel: number): number {
  const excess = Math.max(0, Math.abs(characterLevel - monsterLevel) - xpSafeRange(characterLevel));
  return Math.max(XP_MIN_MULTIPLIER, 1 - XP_PENALTY_PER_EXCESS_LEVEL * excess);
}

/** Adds XP and applies level-ups. Current life grows by the max-life gain. XP stops at the level cap. */
export function grantXp(state: GameState, amount: number, events: GameEvent[]): void {
  const character = state.character;
  if (character.level >= MAX_LEVEL) {
    return;
  }
  character.xp += amount;
  while (character.level < MAX_LEVEL && character.xp >= xpToNextLevel(character.level)) {
    const oldMaxLife = computeMaxLife(state);
    character.xp -= xpToNextLevel(character.level);
    character.level += 1;
    while (character.supportIds.length < supportSlotCount(character.level)) {
      character.supportIds.push(null);
    }
    const newMaxLife = computeMaxLife(state);
    character.life = Math.min(newMaxLife, character.life + Math.max(0, newMaxLife - oldMaxLife));
    appendLog(state, "level_up", `Reached level ${character.level}.`);
    events.push({ type: "level_up", timeMs: state.simTimeMs, level: character.level });
  }
  if (character.level >= MAX_LEVEL) {
    character.xp = 0;
  }
}

function setZoneActivity(state: GameState, zoneId: ZoneId, events: GameEvent[]): void {
  state.progression.activity = { kind: "zone", zoneId };
  events.push({ type: "activity_changed", timeMs: state.simTimeMs, activity: { kind: "zone", zoneId } });
}

/** Progress write-back for a cleared normal encounter. */
export function recordEncounterCleared(state: GameState): void {
  const { activity, zoneProgress } = state.progression;
  switch (activity.kind) {
    case "zone": {
      const progress = (zoneProgress[activity.zoneId] ??= { encountersCleared: 0, bossDefeated: false });
      progress.encountersCleared += 1;
      return;
    }
    case "map":
      activity.encountersCleared += 1;
      return;
  }
}

const MAP_MODIFIER_IDS = Object.keys(MAP_MODIFIERS) as MapModifierId[];

/** 0–2 distinct modifiers, drawn uniformly (plan §10.5). Consumes only the given (`map`) stream. */
export function rollMapModifiers(rng: RngState): MapModifierId[] {
  const count = weightedIndex(rng, MAP_MODIFIER_COUNT_WEIGHTS);
  const remaining = [...MAP_MODIFIER_IDS];
  const rolled: MapModifierId[] = [];
  for (let i = 0; i < count && remaining.length > 0; i++) {
    rolled.push(remaining.splice(nextInt(rng, 0, remaining.length - 1), 1)[0]!);
  }
  return rolled;
}

/** Starts a fresh run with newly rolled modifiers. The caller decides what happens to the encounter. */
function startMapRun(state: GameState, tier: number, events: GameEvent[]): void {
  const modifiers = rollMapModifiers(state.rng.map);
  state.progression.activity = { kind: "map", tier, modifiers, encountersCleared: 0 };
  const names = modifiers.map((id) => MAP_MODIFIERS[id].name);
  appendLog(state, "info", `Entering Map Tier ${tier}${names.length > 0 ? ` (${names.join(", ")})` : ""}.`);
  events.push({ type: "activity_changed", timeMs: state.simTimeMs, activity: structuredClone(state.progression.activity) });
}

/**
 * Progress write-back for a boss kill (plan §10.4, §10.5). Zone: the cycle restarts, the next
 * zone unlocks, and with auto-advance the character moves on once their level allows it; the
 * last zone's boss unlocks maps. Map: the next tier unlocks and a new run starts (one tier up
 * with auto-advance, level permitting).
 */
export function recordBossDefeated(state: GameState, events: GameEvent[]): void {
  const progression = state.progression;
  const activity = progression.activity;
  if (activity.kind === "map") {
    appendLog(state, "info", `Completed Map Tier ${activity.tier}.`);
    const unlocked = Math.min(MAX_MAP_TIER, activity.tier + 1);
    if (unlocked > progression.unlockedMapTier) {
      progression.unlockedMapTier = unlocked;
      appendLog(state, "info", `Unlocked Map Tier ${unlocked}.`);
      events.push({ type: "map_tier_unlocked", timeMs: state.simTimeMs, tier: unlocked });
    }
    let nextTier = activity.tier;
    if (state.settings.autoAdvance && progression.unlockedMapTier > activity.tier) {
      const next = activity.tier + 1;
      if (meetsAutoAdvanceLevel(state, mapTier(next).monsterLevel, `Map Tier ${next}`)) nextTier = next;
    }
    startMapRun(state, nextTier, events);
    return;
  }

  const progress = (progression.zoneProgress[activity.zoneId] ??= { encountersCleared: 0, bossDefeated: false });
  progress.bossDefeated = true;
  progress.encountersCleared = 0;
  appendLog(state, "info", `Defeated the boss of ${ZONES[activity.zoneId].name}.`);

  const next = ZONE_ORDER[ZONE_ORDER.indexOf(activity.zoneId) + 1];
  if (next === undefined) {
    if (progression.unlockedMapTier === 0) {
      progression.unlockedMapTier = 1;
      appendLog(state, "info", "Unlocked Map Tier 1.");
      events.push({ type: "map_tier_unlocked", timeMs: state.simTimeMs, tier: 1 });
    }
    // Auto-advance continues from the campaign into the first map tier.
    if (state.settings.autoAdvance && meetsAutoAdvanceLevel(state, mapTier(1).monsterLevel, "Map Tier 1")) {
      startMapRun(state, 1, events);
    }
    return;
  }
  if (!progression.unlockedZones.includes(next)) {
    progression.unlockedZones.push(next);
    progression.zoneProgress[next] ??= { encountersCleared: 0, bossDefeated: false };
    appendLog(state, "info", `Unlocked ${ZONES[next].name}.`);
    events.push({ type: "zone_unlocked", timeMs: state.simTimeMs, zoneId: next });
  }
  if (state.settings.autoAdvance && meetsAutoAdvanceLevel(state, ZONES[next].monsterLevel, ZONES[next].name)) {
    setZoneActivity(state, next, events);
    appendLog(state, "info", `Advancing to ${ZONES[next].name}.`);
  }
}

/**
 * Auto-advance waits until the character is close enough to the next area's level. A cleared
 * zone's boss returns every cycle (and a map restarts at the same tier), so the check repeats
 * at each boss kill. Manual travel is not gated.
 */
function meetsAutoAdvanceLevel(state: GameState, monsterLevel: number, areaName: string): boolean {
  const required = autoAdvanceLevel(monsterLevel);
  if (state.character.level >= required) return true;
  appendLog(state, "info", `Need level ${required} to advance to ${areaName}.`);
  return false;
}

/** The area auto-advance would move to next while the character is below its level requirement, else null. */
export function blockedAutoAdvance(state: GameState): { name: string; requiredLevel: number } | null {
  const { activity, zoneProgress, unlockedZones, unlockedMapTier } = state.progression;
  if (!state.settings.autoAdvance) return null;
  let next: { name: string; monsterLevel: number } | null = null;
  if (activity.kind === "map") {
    if (unlockedMapTier > activity.tier) next = { name: `Map Tier ${activity.tier + 1}`, monsterLevel: mapTier(activity.tier + 1).monsterLevel };
  } else if (zoneProgress[activity.zoneId]?.bossDefeated === true) {
    const zoneId = ZONE_ORDER[ZONE_ORDER.indexOf(activity.zoneId) + 1];
    if (zoneId === undefined) {
      if (unlockedMapTier >= 1) next = { name: "Map Tier 1", monsterLevel: mapTier(1).monsterLevel };
    } else if (unlockedZones.includes(zoneId)) {
      next = ZONES[zoneId];
    }
  }
  if (next === null) return null;
  const requiredLevel = autoAdvanceLevel(next.monsterLevel);
  return state.character.level < requiredLevel ? { name: next.name, requiredLevel } : null;
}

/**
 * Moves one step down and pauses auto-advance (plan §6.6, §10.5): in a zone, to the highest
 * cleared zone below it; in a map, to a new run one tier lower, or to the last zone from tier 1.
 * Returns false (and changes nothing) when there is nowhere to go.
 */
export function retreat(state: GameState, events: GameEvent[]): boolean {
  // Deaths in the area left behind do not count toward retreating again from the new one.
  const moved = retreatTarget(state, events);
  if (moved) state.progression.consecutiveDeaths = 0;
  return moved;
}

function retreatTarget(state: GameState, events: GameEvent[]): boolean {
  const activity = state.progression.activity;
  if (activity.kind === "map") {
    if (activity.tier > 1) {
      startMapRun(state, activity.tier - 1, events);
    } else {
      // The last zone in normal play; the highest unlocked one keeps imported saves valid.
      const unlocked = state.progression.unlockedZones;
      setZoneActivity(state, ZONE_ORDER.filter((id) => unlocked.includes(id)).at(-1)!, events);
    }
    state.settings.autoAdvance = false;
    appendLog(state, "info", "Retreating. Auto-advance paused.");
    return true;
  }
  const { unlockedZones, zoneProgress } = state.progression;
  for (let i = ZONE_ORDER.indexOf(activity.zoneId) - 1; i >= 0; i--) {
    const zoneId = ZONE_ORDER[i]!;
    if (unlockedZones.includes(zoneId) && zoneProgress[zoneId]?.bossDefeated === true) {
      setZoneActivity(state, zoneId, events);
      state.settings.autoAdvance = false;
      appendLog(state, "info", `Retreating to ${ZONES[zoneId].name}. Auto-advance paused.`);
      return true;
    }
  }
  return false;
}

/**
 * Leaves the current encounter after a manual activity change. The pack is discarded and the
 * next encounter of the new activity starts after the usual transition. Life is kept, and a
 * pending respawn still runs to its end, so switching areas never heals for free. Without an
 * encounter (fresh load), the next `advance()` builds one as usual.
 */
function leaveEncounter(state: GameState): void {
  const encounter = state.encounter;
  if (encounter === null) return;
  encounter.monsters = [];
  delete encounter.player.ailments;
  if (encounter.phase === "fighting") {
    encounter.phase = "transition";
    encounter.phaseEndsAt = state.simTimeMs + TRANSITION_MS;
  }
}

/** Switches to an unlocked zone. The encounter is left (see `leaveEncounter`). */
export function travelToZone(state: GameState, zoneId: ZoneId, events: GameEvent[]): boolean {
  if (!state.progression.unlockedZones.includes(zoneId)) {
    return false;
  }
  setZoneActivity(state, zoneId, events);
  leaveEncounter(state);
  // Activity player mods (e.g. Enfeebling) change max life.
  clampLifeToMax(state);
  appendLog(state, "info", `Travelled to ${ZONES[zoneId].name}.`);
  return true;
}

/** Starts a new run of an unlocked map tier. The encounter is left (see `leaveEncounter`). */
export function startMap(state: GameState, tier: number, events: GameEvent[]): boolean {
  if (!Number.isInteger(tier) || tier < 1 || tier > state.progression.unlockedMapTier) {
    return false;
  }
  startMapRun(state, tier, events);
  leaveEncounter(state);
  clampLifeToMax(state);
  return true;
}
