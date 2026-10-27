import { MAX_LEVEL, XP_MIN_MULTIPLIER, XP_PENALTY_PER_EXCESS_LEVEL, xpSafeRange, xpToNextLevel } from "../data/balance";
import { ZONE_ORDER, ZONES, type ZoneId } from "../data/zones";
import type { GameEvent } from "./events";
import { computeMaxLife } from "./stats";
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

/**
 * Progress write-back for a boss kill (plan §10.4): the zone's cycle restarts, the next zone
 * unlocks, and with auto-advance the character moves on. The last zone's boss unlocks maps.
 */
export function recordBossDefeated(state: GameState, events: GameEvent[]): void {
  const progression = state.progression;
  const activity = progression.activity;
  if (activity.kind === "map") {
    throw new Error("recordBossDefeated: map activities are not implemented yet");
  }

  const progress = (progression.zoneProgress[activity.zoneId] ??= { encountersCleared: 0, bossDefeated: false });
  progress.bossDefeated = true;
  progress.encountersCleared = 0;
  appendLog(state, "info", `Defeated the boss of ${ZONES[activity.zoneId].name}.`);

  const next = ZONE_ORDER[ZONE_ORDER.indexOf(activity.zoneId) + 1];
  if (next === undefined) {
    progression.unlockedMapTier = Math.max(progression.unlockedMapTier, 1);
    return;
  }
  if (!progression.unlockedZones.includes(next)) {
    progression.unlockedZones.push(next);
    progression.zoneProgress[next] ??= { encountersCleared: 0, bossDefeated: false };
    appendLog(state, "info", `Unlocked ${ZONES[next].name}.`);
    events.push({ type: "zone_unlocked", timeMs: state.simTimeMs, zoneId: next });
  }
  if (state.settings.autoAdvance) {
    setZoneActivity(state, next, events);
    appendLog(state, "info", `Advancing to ${ZONES[next].name}.`);
  }
}

/**
 * Moves to the highest cleared zone below the current one and pauses auto-advance (plan §6.6).
 * Returns false (and changes nothing) when there is no such zone.
 */
export function retreat(state: GameState, events: GameEvent[]): boolean {
  const activity = state.progression.activity;
  if (activity.kind === "map") {
    throw new Error("retreat: map activities are not implemented yet");
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

/** Switches to an unlocked zone. The encounter is discarded and rebuilt by the next `advance()`. */
export function travelToZone(state: GameState, zoneId: ZoneId, events: GameEvent[]): boolean {
  if (!state.progression.unlockedZones.includes(zoneId)) {
    return false;
  }
  setZoneActivity(state, zoneId, events);
  state.encounter = null;
  appendLog(state, "info", `Travelled to ${ZONES[zoneId].name}.`);
  return true;
}
