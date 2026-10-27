import { OFFLINE_CAP_MS, OFFLINE_CHUNK_MS, OFFLINE_EVENT_BUDGET } from "../data/balance";
import { CURRENCIES, type CurrencyId } from "../data/currencies";
import type { ZoneId } from "../data/zones";
import { advance } from "./engine";
import { RARITIES, type Rarity } from "./equipment";
import type { GameEvent } from "./events";
import { appendLog, type GameState } from "./state";

/** How much wall-clock time away is settled (plan §11.2 steps 3–5). */
export interface OfflineWindow {
  /** Wall-clock time away; 0 when the timestamp was missing or in the future. */
  elapsedMs: number;
  /** `min(elapsedMs, OFFLINE_CAP_MS)`. */
  simulatedMs: number;
  capped: boolean;
  anomaly: "missing_timestamp" | "negative_elapsed" | null;
}

export function offlineWindow(lastActiveAt: number | null, now: number): OfflineWindow {
  let elapsedMs = 0;
  let anomaly: OfflineWindow["anomaly"] = null;
  if (lastActiveAt === null || !Number.isFinite(lastActiveAt)) {
    anomaly = "missing_timestamp";
  } else if (now < lastActiveAt) {
    anomaly = "negative_elapsed";
  } else {
    // Integer sim ms: sub-millisecond wall-clock remainders are dropped.
    elapsedMs = Math.floor(now - lastActiveAt);
  }
  const simulatedMs = Math.min(elapsedMs, OFFLINE_CAP_MS);
  return { elapsedMs, simulatedMs, capped: elapsedMs > OFFLINE_CAP_MS, anomaly };
}

/** Totals counted from `GameEvent`s; shared by the offline summary and the online session stats. */
export interface EventTally {
  xpGained: number;
  kills: number;
  deaths: number;
  encountersCleared: number;
  zonesUnlocked: ZoneId[];
  itemsKept: Record<Rarity, number>;
  salvagedByFilter: number;
  salvagedByOverflow: number;
  currencyGained: Record<CurrencyId, number>;
}

export interface OfflineSummary extends EventTally {
  elapsedMs: number;
  simulatedMs: number;
  capped: boolean;
  /** Sim time actually covered; less than `simulatedMs` only when the event budget ran out. */
  coveredMs: number;
  budgetExhausted: boolean;
  levelsGained: number;
  mapTiersUnlocked: number;
}

export interface OfflineProgress {
  simulatedSoFar: number;
  totalMs: number;
}

export function emptyTally(): EventTally {
  return {
    xpGained: 0,
    kills: 0,
    deaths: 0,
    encountersCleared: 0,
    zonesUnlocked: [],
    itemsKept: Object.fromEntries(RARITIES.map((r) => [r, 0])) as Record<Rarity, number>,
    salvagedByFilter: 0,
    salvagedByOverflow: 0,
    currencyGained: Object.fromEntries(Object.keys(CURRENCIES).map((id) => [id, 0])) as Record<CurrencyId, number>,
  };
}

function emptySummary(window: OfflineWindow): OfflineSummary {
  return {
    ...emptyTally(),
    elapsedMs: window.elapsedMs,
    simulatedMs: window.simulatedMs,
    capped: window.capped,
    coveredMs: 0,
    budgetExhausted: false,
    levelsGained: 0,
    mapTiersUnlocked: 0,
  };
}

export function tallyEvents(summary: EventTally, events: readonly GameEvent[]): void {
  for (const event of events) {
    switch (event.type) {
      case "monster_killed":
        summary.kills += 1;
        summary.xpGained += event.xp;
        break;
      case "player_died":
        summary.deaths += 1;
        break;
      case "encounter_cleared":
        summary.encountersCleared += 1;
        break;
      case "zone_unlocked":
        summary.zonesUnlocked.push(event.zoneId);
        break;
      case "item_dropped":
        if (event.outcome === "kept") summary.itemsKept[event.rarity] += 1;
        else if (event.outcome === "salvaged") summary.salvagedByFilter += 1;
        else summary.salvagedByOverflow += 1;
        break;
      case "currency_gained":
        summary.currencyGained[event.currencyId] += event.amount;
        break;
      default:
        break;
    }
  }
}

/**
 * Simulates `window.simulatedMs` of offline time on `state` in place, in chunks of
 * OFFLINE_CHUNK_MS (plan §11.3), yielding progress after each chunk. Chunking is only repeated
 * `advance()` calls, so by split invariance the result equals one `advance(state, simulatedMs)`.
 * The whole run shares one event budget (plan §11.4).
 */
export function* simulateOffline(
  state: GameState,
  window: OfflineWindow,
  eventBudget: number = OFFLINE_EVENT_BUDGET,
): Generator<OfflineProgress, OfflineSummary> {
  const summary = emptySummary(window);
  if (window.anomaly === "missing_timestamp") {
    appendLog(state, "error", "Offline progress skipped: the save has no valid last-active time.");
  } else if (window.anomaly === "negative_elapsed") {
    appendLog(state, "error", "Offline progress skipped: the last-active time is in the future.");
  }

  const levelBefore = state.character.level;
  const mapTierBefore = state.progression.unlockedMapTier;
  let budget = eventBudget;
  while (summary.coveredMs < window.simulatedMs) {
    const chunk = Math.min(OFFLINE_CHUNK_MS, window.simulatedMs - summary.coveredMs);
    const startedAt = state.simTimeMs;
    const result = advance(state, chunk, { eventBudget: budget });
    tallyEvents(summary, result.events);
    budget -= result.eventsResolved;
    summary.coveredMs += state.simTimeMs - startedAt;
    if (result.budgetExhausted) {
      summary.budgetExhausted = true;
      appendLog(state, "error", `Offline simulation hit the ${eventBudget}-event safety cap; the remaining time was discarded.`);
      break;
    }
    yield { simulatedSoFar: summary.coveredMs, totalMs: window.simulatedMs };
  }

  summary.levelsGained = state.character.level - levelBefore;
  summary.mapTiersUnlocked = state.progression.unlockedMapTier - mapTierBefore;
  return summary;
}

/** Runs `simulateOffline` to completion synchronously (tests, tools, and zero-length settlements). */
export function runOffline(state: GameState, window: OfflineWindow, eventBudget: number = OFFLINE_EVENT_BUDGET): OfflineSummary {
  const run = simulateOffline(state, window, eventBudget);
  for (;;) {
    const step = run.next();
    if (step.done === true) return step.value;
  }
}
