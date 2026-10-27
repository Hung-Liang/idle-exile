export const CURRENT_SCHEMA_VERSION = 1;

/** Raw, unvalidated save JSON. Migrations must not assume anything beyond `schemaVersion`. */
export type RawSave = Record<string, unknown>;

export interface Migration {
  /** Upgrades a save at schema version `from` to `from + 1`. */
  from: number;
  migrate: (raw: RawSave) => RawSave;
}

/**
 * Ordered list of migrations. Every schema change appends one entry (v_N → v_N+1),
 * bumps CURRENT_SCHEMA_VERSION, and adds a round-trip test with a fixture save of v_N.
 */
export const MIGRATIONS: readonly Migration[] = [];

export type MigrateResult = { ok: true; raw: RawSave } | { ok: false; error: string };

export function migrateSave(
  input: unknown,
  migrations: readonly Migration[] = MIGRATIONS,
  targetVersion: number = CURRENT_SCHEMA_VERSION,
): MigrateResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "save is not an object" };
  }
  let raw = input as RawSave;
  let version = raw.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: `invalid schemaVersion: ${String(version)}` };
  }
  if (version > targetVersion) {
    return { ok: false, error: `save schemaVersion ${version} is newer than supported ${targetVersion}` };
  }

  while (version < targetVersion) {
    const step = migrations.find((m) => m.from === version);
    if (step === undefined) {
      return { ok: false, error: `no migration from schemaVersion ${version}` };
    }
    raw = step.migrate(raw);
    version += 1;
    raw = { ...raw, schemaVersion: version };
    const state = raw.state;
    if (typeof state === "object" && state !== null && !Array.isArray(state)) {
      raw.state = { ...state, schemaVersion: version };
    }
  }
  return { ok: true, raw };
}
