import { describe, expect, it } from "vitest";
import { OFFLINE_CAP_MS, OFFLINE_CHUNK_MS, OFFLINE_EVENT_BUDGET } from "../src/data/balance";
import { advance } from "../src/game/engine";
import { offlineWindow, runOffline, simulateOffline, type OfflineWindow } from "../src/game/offline";
import { parseSave, serializeSave } from "../src/game/save";
import { createInitialState, type GameState } from "../src/game/state";

const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;

function windowOf(simulatedMs: number): OfflineWindow {
  return { elapsedMs: simulatedMs, simulatedMs, capped: false, anomaly: null };
}

/** Mid-game build with fast attacks and chains, so 8 h produces many events. */
function busyState(seed: number): GameState {
  const state = createInitialState(seed);
  state.character.level = 12;
  state.character.activeSkillId = "arc_pulse";
  state.character.supportIds = ["keen_edge", "quickened"];
  state.character.allocatedPassives = ["c1", "c3", "CN1", "c5"];
  return state;
}

function resources(state: GameState) {
  return {
    level: state.character.level,
    xp: state.character.xp,
    items: Object.keys(state.inventory.items).sort(),
    currency: { ...state.inventory.currency },
    kills: state.progression.totalKills,
  };
}

describe("offlineWindow", () => {
  it("settles the elapsed wall-clock time", () => {
    expect(offlineWindow(T0 - 90_000, T0)).toEqual({ elapsedMs: 90_000, simulatedMs: 90_000, capped: false, anomaly: null });
  });

  it("caps simulated time at 8 h", () => {
    const w = offlineWindow(T0 - 30 * HOUR, T0);
    expect(w).toEqual({ elapsedMs: 30 * HOUR, simulatedMs: OFFLINE_CAP_MS, capped: true, anomaly: null });
  });

  it("does not flag exactly 8 h as capped", () => {
    expect(offlineWindow(T0 - OFFLINE_CAP_MS, T0).capped).toBe(false);
  });

  it("grants nothing for a missing or non-finite timestamp", () => {
    for (const last of [null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(offlineWindow(last, T0)).toEqual({ elapsedMs: 0, simulatedMs: 0, capped: false, anomaly: "missing_timestamp" });
    }
  });

  it("grants nothing for negative elapsed time", () => {
    expect(offlineWindow(T0 + 5_000, T0)).toEqual({ elapsedMs: 0, simulatedMs: 0, capped: false, anomaly: "negative_elapsed" });
  });

  it("drops sub-millisecond remainders", () => {
    expect(offlineWindow(T0 - 1234.7, T0).simulatedMs).toBe(1234);
  });
});

describe("simulateOffline", () => {
  it("yields progress after every chunk and ends at the total", () => {
    const state = createInitialState(3);
    const total = 2 * OFFLINE_CHUNK_MS + 500;
    const run = simulateOffline(state, windowOf(total));
    const steps: number[] = [];
    let step = run.next();
    while (step.done !== true) {
      steps.push(step.value.simulatedSoFar);
      expect(step.value.totalMs).toBe(total);
      step = run.next();
    }
    expect(steps).toEqual([OFFLINE_CHUNK_MS, 2 * OFFLINE_CHUNK_MS, total]);
    expect(step.value.coveredMs).toBe(total);
    expect(state.simTimeMs).toBe(total);
  });

  it("grants nothing and logs an error for missing or negative time", () => {
    for (const anomaly of ["missing_timestamp", "negative_elapsed"] as const) {
      const state = createInitialState(4);
      const before = resources(state);
      const summary = runOffline(state, { elapsedMs: 0, simulatedMs: 0, capped: false, anomaly });
      expect(resources(state)).toEqual(before);
      expect(state.simTimeMs).toBe(0);
      expect(summary.kills).toBe(0);
      expect(state.log.at(-1)?.kind).toBe("error");
    }
  });

  it("summarizes what happened", () => {
    const state = createInitialState(5);
    const before = resources(state);
    const summary = runOffline(state, windowOf(HOUR));
    const after = resources(state);

    expect(summary.kills).toBe(after.kills - before.kills);
    expect(summary.levelsGained).toBe(after.level - before.level);
    expect(summary.levelsGained).toBeGreaterThan(0);
    for (const [id, n] of Object.entries(after.currency)) {
      expect(summary.currencyGained[id as keyof typeof after.currency]).toBe(n - before.currency[id as keyof typeof before.currency]);
    }
    const kept = summary.itemsKept.normal + summary.itemsKept.magic + summary.itemsKept.rare;
    expect(kept).toBe(after.items.length - before.items.length);
    expect(summary.encountersCleared).toBeGreaterThan(0);
    expect(summary.budgetExhausted).toBe(false);
  });

  it("stops at the event budget, discards the remaining time and logs an error", () => {
    const state = createInitialState(6);
    const summary = runOffline(state, windowOf(HOUR), 1_000);
    expect(summary.budgetExhausted).toBe(true);
    expect(summary.coveredMs).toBeLessThan(HOUR);
    expect(state.simTimeMs).toBe(summary.coveredMs);
    expect(state.log.at(-1)?.text).toContain("safety cap");
  });

  it.each([11, 22, 33])("8 h chunked equals one advance() call and stays within budget (seed %i)", (seed) => {
    const chunked = busyState(seed);
    const single = structuredClone(chunked);
    const summary = runOffline(chunked, windowOf(OFFLINE_CAP_MS));
    const result = advance(single, OFFLINE_CAP_MS);

    expect(chunked).toEqual(single);
    expect(summary.budgetExhausted).toBe(false);
    expect(result.eventsResolved).toBeLessThan(OFFLINE_EVENT_BUDGET);
  });
});

describe("settle-once", () => {
  /** One settlement as main.ts performs it: run, then account wall time up to `now`. */
  function settle(state: GameState, lastActiveAt: number | null, now: number): number {
    runOffline(state, offlineWindow(lastActiveAt, now));
    return now;
  }

  it("settling again with no new elapsed time grants nothing", () => {
    const state = createInitialState(7);
    const last = settle(state, T0 - HOUR, T0);
    const after = structuredClone(state);
    settle(state, last, T0);
    expect(resources(state)).toEqual(resources(after));
    expect(state.simTimeMs).toBe(after.simTimeMs);
  });

  it("an interrupted settlement followed by a retry equals one uninterrupted settlement", () => {
    const saved = createInitialState(8);
    const lastActiveAt = T0 - 2 * HOUR;

    const uninterrupted = structuredClone(saved);
    settle(uninterrupted, lastActiveAt, T0);

    // The worker ran on a copy and the page closed before the result was applied or saved.
    const lost = structuredClone(saved);
    const run = simulateOffline(lost, offlineWindow(lastActiveAt, T0 - 1_000));
    run.next();
    run.next();

    const retried = structuredClone(saved);
    settle(retried, lastActiveAt, T0);
    expect(retried).toEqual(uninterrupted);
  });

  it("save → load → settle cycles keep every item exactly once", () => {
    let state = createInitialState(9);
    let lastActiveAt = T0;
    let now = T0;
    let nextItemId = state.nextItemId;
    for (let cycle = 0; cycle < 6; cycle++) {
      advance(state, 10 * 60_000);
      now += 10 * 60_000;
      lastActiveAt = now;
      const parsed = parseSave(serializeSave(state, { savedAt: now, lastActiveAt }));
      if (!parsed.ok) throw new Error(parsed.error);
      state = parsed.state;
      now += 20 * 60_000;
      lastActiveAt = settle(state, parsed.lastActiveAt, now);

      const equipped = Object.values(state.character.equipment).filter((id) => id !== null);
      expect([...equipped, ...state.inventory.order].sort()).toEqual(Object.keys(state.inventory.items).sort());
      expect(state.nextItemId).toBeGreaterThanOrEqual(nextItemId);
      nextItemId = state.nextItemId;
      for (const n of Object.values(state.inventory.currency)) expect(n).toBeGreaterThanOrEqual(0);
    }
  });
});
