import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  BACKUP_KEY,
  CORRUPT_KEY,
  SAVE_KEY,
  loadSave,
  parseSave,
  serializeSave,
  writeSave,
  type KeyValueStorage,
} from "../src/game/save";
import { createInitialState, type GameState } from "../src/game/state";
import { CURRENT_SCHEMA_VERSION } from "../src/game/migrations";

class MemoryStorage implements KeyValueStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

const times = { savedAt: 1_700_000_000_000, lastActiveAt: 1_700_000_000_000 };
const newGame = { seed: 77, now: 1_800_000_000_000 };

function withEncounter(state: GameState): GameState {
  state.encounter = {
    index: 3,
    isBoss: false,
    phase: "fighting",
    phaseEndsAt: 0,
    monsters: [{ defId: "brute", level: 1, life: 12, maxLife: 39, nextAttackAt: 5000, alive: true }],
    player: { nextAttackAt: 4200 },
    stacks: { momentum: 2 },
  };
  return state;
}

describe("serializeSave / parseSave", () => {
  it("round-trips a fresh state", () => {
    const state = createInitialState(1);
    const parsed = parseSave(serializeSave(state, times));
    expect(parsed).toEqual({ ok: true, state, lastActiveAt: times.lastActiveAt, savedAt: times.savedAt });
  });

  it("round-trips any seed", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
        const state = createInitialState(seed);
        const parsed = parseSave(serializeSave(state, times));
        expect(parsed.ok && parsed.state).toEqual(state);
      }),
    );
  });

  it("omits the encounter from the save and restores it as null", () => {
    const state = withEncounter(createInitialState(1));
    state.progression.zoneProgress.ashen_outskirts!.encountersCleared = 3;
    const text = serializeSave(state, times);
    expect(JSON.parse(text).state).not.toHaveProperty("encounter");

    const parsed = parseSave(text);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.state.encounter).toBeNull();
    expect(parsed.state.progression.zoneProgress.ashen_outskirts!.encountersCleared).toBe(3);
    expect({ ...parsed.state, encounter: state.encounter }).toEqual(state);
  });

  it("does not mutate the state being saved", () => {
    const state = withEncounter(createInitialState(1));
    const before = structuredClone(state);
    serializeSave(state, times);
    expect(state).toEqual(before);
  });

  it("writes the schema version and timestamps", () => {
    const file = JSON.parse(serializeSave(createInitialState(1), { savedAt: 10, lastActiveAt: 5 }));
    expect(file).toMatchObject({ schemaVersion: CURRENT_SCHEMA_VERSION, savedAt: 10, lastActiveAt: 5 });
  });

  it("returns lastActiveAt = null when missing or not finite", () => {
    const file = JSON.parse(serializeSave(createInitialState(1), times));
    delete file.lastActiveAt;
    const missing = parseSave(JSON.stringify(file));
    expect(missing.ok && missing.lastActiveAt).toBeNull();

    file.lastActiveAt = "soon";
    const bogus = parseSave(JSON.stringify(file));
    expect(bogus.ok && bogus.lastActiveAt).toBeNull();
  });

  it("rejects invalid JSON, invalid states, persisted encounters, and future versions", () => {
    expect(parseSave("{not json").ok).toBe(false);

    const file = JSON.parse(serializeSave(createInitialState(1), times));
    expect(parseSave(JSON.stringify({ ...file, state: { ...file.state, nextItemId: -1 } })).ok).toBe(false);
    expect(parseSave(JSON.stringify({ ...file, state: { ...file.state, encounter: null } })).ok).toBe(false);
    expect(parseSave(JSON.stringify({ ...file, schemaVersion: CURRENT_SCHEMA_VERSION + 1 })).ok).toBe(false);
  });
});

describe("writeSave", () => {
  it("writes the primary and moves the previous primary to the backup", () => {
    const storage = new MemoryStorage();
    const state = createInitialState(1);

    expect(writeSave(storage, state, { savedAt: 1, lastActiveAt: 1 })).toEqual({ ok: true });
    const first = storage.getItem(SAVE_KEY);
    expect(storage.getItem(BACKUP_KEY)).toBeNull();

    state.progression.totalKills = 5;
    expect(writeSave(storage, state, { savedAt: 2, lastActiveAt: 2 })).toEqual({ ok: true });
    expect(storage.getItem(BACKUP_KEY)).toBe(first);
    expect(JSON.parse(storage.getItem(SAVE_KEY)!).state.progression.totalKills).toBe(5);
  });

  it("never writes an invalid state and leaves storage untouched", () => {
    const storage = new MemoryStorage();
    writeSave(storage, createInitialState(1), times);
    const snapshot = new Map(storage.data);

    const bad = createInitialState(1);
    bad.inventory.currency.kindle_shard = -3;
    const result = writeSave(storage, bad, times);
    expect(result.ok).toBe(false);
    expect(storage.data).toEqual(snapshot);
  });
});

describe("loadSave", () => {
  it("starts a new game when nothing is stored", () => {
    const storage = new MemoryStorage();
    const result = loadSave(storage, newGame);
    expect(result).toEqual({ state: createInitialState(newGame.seed), lastActiveAt: newGame.now, source: "new", errors: [] });
    expect(storage.getItem(CORRUPT_KEY)).toBeNull();
  });

  it("loads the primary save", () => {
    const storage = new MemoryStorage();
    const state = withEncounter(createInitialState(3));
    state.progression.totalKills = 42;
    writeSave(storage, state, { savedAt: 9, lastActiveAt: 8 });

    const result = loadSave(storage, newGame);
    expect(result.source).toBe("primary");
    expect(result.lastActiveAt).toBe(8);
    expect(result.state.encounter).toBeNull();
    expect(result.state.progression.totalKills).toBe(42);
    expect(result.errors).toEqual([]);
  });

  it("falls back to the backup when the primary is corrupt", () => {
    const storage = new MemoryStorage();
    const state = createInitialState(3);
    writeSave(storage, state, { savedAt: 1, lastActiveAt: 1 });
    writeSave(storage, state, { savedAt: 2, lastActiveAt: 2 });
    storage.setItem(SAVE_KEY, "garbage");

    const result = loadSave(storage, newGame);
    expect(result.source).toBe("backup");
    expect(result.lastActiveAt).toBe(1);
    expect(result.state).toEqual(state);
    expect(result.errors).toHaveLength(1);
  });

  it("starts a new game and keeps the corrupt primary when both saves fail", () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, "broken-primary");
    storage.setItem(BACKUP_KEY, "broken-backup");

    const result = loadSave(storage, newGame);
    expect(result.source).toBe("new");
    expect(result.state).toEqual(createInitialState(newGame.seed));
    expect(result.errors).toHaveLength(2);
    expect(storage.getItem(CORRUPT_KEY)).toBe("broken-primary");
  });

  it("keeps the corrupt backup when it is the only save present", () => {
    const storage = new MemoryStorage();
    storage.setItem(BACKUP_KEY, "broken-backup");
    expect(loadSave(storage, newGame).source).toBe("new");
    expect(storage.getItem(CORRUPT_KEY)).toBe("broken-backup");
  });

  it("supports save → load → save → load without drift", () => {
    const storage = new MemoryStorage();
    const state = createInitialState(11);
    writeSave(storage, state, times);
    const once = loadSave(storage, newGame).state;
    writeSave(storage, once, times);
    const twice = loadSave(storage, newGame).state;
    expect(twice).toEqual(state);
  });
});
