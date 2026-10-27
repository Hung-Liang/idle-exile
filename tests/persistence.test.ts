import { afterEach, describe, expect, it } from "vitest";
import { createOnlineLoop, type OnlineLoop } from "../src/app/loop";
import { flushAndSave, needsImmediateSave } from "../src/app/persistence";
import { advance } from "../src/game/engine";
import { SAVE_KEY, parseSave } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import { MemoryStorage } from "./helpers/memory-storage";

const EPOCH = 1_800_000_000_000;

describe("flushAndSave", () => {
  let loop: OnlineLoop | null = null;
  afterEach(() => loop?.stop());

  it("advances up to the save instant before writing lastActiveAt", () => {
    let perf = 1_000;
    const state = createInitialState(1);
    loop = createOnlineLoop(state, () => {}, () => perf);
    loop.start();

    perf += 640.5;
    const storage = new MemoryStorage();
    expect(flushAndSave(loop, storage, state, EPOCH)).toEqual({ ok: true });
    expect(state.simTimeMs).toBe(640);

    const saved = parseSave(storage.getItem(SAVE_KEY)!);
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.lastActiveAt).toBe(EPOCH);
    expect(saved.savedAt).toBe(EPOCH);
    expect(saved.state.simTimeMs).toBe(640);

    // The carried half millisecond is not lost on the next flush.
    perf += 359.5;
    loop.flush();
    expect(state.simTimeMs).toBe(1_000);
  });

  it("feeds exactly the same time as an uninterrupted run", () => {
    let perf = 0;
    const flushed = createInitialState(2);
    const reference = structuredClone(flushed);
    loop = createOnlineLoop(flushed, () => {}, () => perf);
    loop.start();
    const storage = new MemoryStorage();
    for (const step of [250, 250, 113, 250, 87]) {
      perf += step;
      flushAndSave(loop, storage, flushed, EPOCH + perf);
    }
    advance(reference, 250);
    advance(reference, 250);
    advance(reference, 113);
    advance(reference, 250);
    advance(reference, 87);
    expect(flushed).toEqual(reference);
  });

  it("does not advance while the loop is stopped, and restarts from the new baseline", () => {
    let perf = 0;
    const state = createInitialState(3);
    loop = createOnlineLoop(state, () => {}, () => perf);
    loop.start();
    perf = 500;
    loop.stop();
    perf = 60_000;
    flushAndSave(loop, new MemoryStorage(), state, EPOCH);
    expect(state.simTimeMs).toBe(0);

    loop.start();
    perf = 60_300;
    loop.flush();
    expect(state.simTimeMs).toBe(300);
  });

  it("caps a single online delta at 1 s", () => {
    let perf = 0;
    const state = createInitialState(4);
    loop = createOnlineLoop(state, () => {}, () => perf);
    loop.start();
    perf = 5_000;
    loop.flush();
    expect(state.simTimeMs).toBe(1_000);
  });
});

describe("needsImmediateSave", () => {
  it("triggers on level-ups, build changes and boss kills only", () => {
    expect(needsImmediateSave([{ type: "level_up", timeMs: 0, level: 2 }])).toBe(true);
    expect(needsImmediateSave([{ type: "passives_reset", timeMs: 0 }])).toBe(true);
    expect(needsImmediateSave([{ type: "encounter_cleared", timeMs: 0, index: 10, isBoss: true }])).toBe(true);
    expect(needsImmediateSave([{ type: "encounter_cleared", timeMs: 0, index: 3, isBoss: false }])).toBe(false);
    expect(needsImmediateSave([{ type: "player_died", timeMs: 0 }])).toBe(false);
    expect(needsImmediateSave([])).toBe(false);
  });
});
