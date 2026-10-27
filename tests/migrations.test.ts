import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, MIGRATIONS, migrateSave, type Migration } from "../src/game/migrations";
import { parseSave, serializeSave } from "../src/game/save";
import { createInitialState } from "../src/game/state";

describe("migrateSave", () => {
  it("is a no-op at the current version", () => {
    const raw = { schemaVersion: CURRENT_SCHEMA_VERSION, state: { schemaVersion: CURRENT_SCHEMA_VERSION } };
    expect(migrateSave(raw)).toEqual({ ok: true, raw });
  });

  it("has a contiguous migration chain up to the current version", () => {
    const froms = MIGRATIONS.map((m) => m.from);
    expect(froms).toEqual(Array.from({ length: CURRENT_SCHEMA_VERSION - 1 }, (_, i) => i + 1));
  });

  it("applies migrations in sequence and bumps both version fields", () => {
    const calls: number[] = [];
    const migrations: Migration[] = [
      { from: 2, migrate: (raw) => (calls.push(2), { ...raw, b: true }) },
      { from: 1, migrate: (raw) => (calls.push(1), { ...raw, a: true }) },
    ];
    const result = migrateSave({ schemaVersion: 1, state: { schemaVersion: 1 } }, migrations, 3);
    expect(calls).toEqual([1, 2]);
    expect(result).toEqual({ ok: true, raw: { schemaVersion: 3, a: true, b: true, state: { schemaVersion: 3 } } });
  });

  it("fails when a step is missing", () => {
    const result = migrateSave({ schemaVersion: 1 }, [{ from: 2, migrate: (r) => r }], 3);
    expect(result).toEqual({ ok: false, error: "no migration from schemaVersion 1" });
  });

  it("rejects saves from a newer version", () => {
    expect(migrateSave({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 }).ok).toBe(false);
  });

  it("rejects missing or malformed versions", () => {
    expect(migrateSave({}).ok).toBe(false);
    expect(migrateSave({ schemaVersion: "1" }).ok).toBe(false);
    expect(migrateSave({ schemaVersion: 0 }).ok).toBe(false);
    expect(migrateSave({ schemaVersion: 1.5 }).ok).toBe(false);
    expect(migrateSave(null).ok).toBe(false);
    expect(migrateSave([]).ok).toBe(false);
  });

  it("v1 → current adds the Graft Shard and the migrated save validates", () => {
    // A v1 save: no graft_shard key and schema version 1.
    const state = createInitialState(3);
    state.inventory.currency.kindle_shard = 4;
    const raw = JSON.parse(serializeSave(state, { savedAt: 1, lastActiveAt: 1 }));
    delete raw.state.inventory.currency.graft_shard;
    for (const id of ["tumult_shard", "sever_shard", "cleanse_shard"]) delete raw.state.inventory.currency[id];
    raw.schemaVersion = 1;
    raw.state.schemaVersion = 1;
    const parsed = parseSave(JSON.stringify(raw));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.state.schemaVersion).toBe(3);
    expect(parsed.state.inventory.currency).toMatchObject({ kindle_shard: 4, graft_shard: 0, tumult_shard: 0 });
  });

  it("v2 → v3 adds the Tumult, Sever and Cleanse Shards and the migrated save validates", () => {
    const state = createInitialState(3);
    state.inventory.currency.graft_shard = 2;
    const raw = JSON.parse(serializeSave(state, { savedAt: 1, lastActiveAt: 1 }));
    for (const id of ["tumult_shard", "sever_shard", "cleanse_shard"]) delete raw.state.inventory.currency[id];
    raw.schemaVersion = 2;
    raw.state.schemaVersion = 2;
    const parsed = parseSave(JSON.stringify(raw));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.state.schemaVersion).toBe(3);
    expect(parsed.state.inventory.currency).toMatchObject({ graft_shard: 2, tumult_shard: 0, sever_shard: 0, cleanse_shard: 0 });
  });

  it("leaves a malformed save to the validator", () => {
    const raw = { schemaVersion: 1, state: { schemaVersion: 1, inventory: null } };
    expect(migrateSave(raw)).toEqual({ ok: true, raw: { schemaVersion: 3, state: { schemaVersion: 3, inventory: null } } });
  });
});
