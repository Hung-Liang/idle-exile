import { describe, expect, it } from "vitest";
import { createSessionStats } from "../src/app/session-stats";
import { advance } from "../src/game/engine";
import { createInitialState } from "../src/game/state";

describe("session stats", () => {
  it("counts sim time and events between ticks on the same state only", () => {
    const stats = createSessionStats();
    const state = createInitialState(1);
    stats.record(state, advance(state, 0).events);
    stats.record(state, advance(state, 60_000).events);
    expect(stats.elapsedMs).toBe(60_000);
    expect(stats.tally.kills).toBe(state.progression.totalKills);

    // A replaced state (offline settlement) only sets a new baseline.
    const settled = structuredClone(state);
    advance(settled, 3_600_000);
    stats.record(settled, []);
    expect(stats.elapsedMs).toBe(60_000);
    stats.record(settled, advance(settled, 1_000).events);
    expect(stats.elapsedMs).toBe(61_000);

    stats.reset();
    expect(stats.elapsedMs).toBe(0);
    expect(stats.tally.kills).toBe(0);
  });
});
