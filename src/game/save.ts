import { crc32 } from "./crc32";
import { migrateSave } from "./migrations";
import { createInitialState, type GameState } from "./state";
import { validateState } from "./validate";

export const SAVE_KEY = "exile-idle:save";
export const BACKUP_KEY = "exile-idle:save.bak";
export const CORRUPT_KEY = "exile-idle:save.corrupt";
/** The save that the last import or reset replaced; no later save rotates it, unlike BACKUP_KEY. */
export const REPLACED_KEY = "exile-idle:save.replaced";

/** The subset of the Web Storage API the save system needs; `localStorage` satisfies it. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** `encounter` is runtime-only and never persisted. */
export type PersistedState = Omit<GameState, "encounter">;

export interface SaveFile {
  schemaVersion: number;
  /** Epoch ms, wall clock. */
  savedAt: number;
  /** Epoch ms, wall clock: the instant up to which sim time has been fully accounted for. */
  lastActiveAt: number;
  state: PersistedState;
}

export interface SaveTimes {
  savedAt: number;
  lastActiveAt: number;
}

export type ParseResult =
  | {
      ok: true;
      state: GameState;
      /** null when missing or not finite; settlement then grants no offline time. */
      lastActiveAt: number | null;
      savedAt: number | null;
    }
  | { ok: false; error: string };

export type WriteResult = { ok: true } | { ok: false; errors: string[] };

export interface LoadResult {
  state: GameState;
  lastActiveAt: number | null;
  /** Which save the state came from; "new" means a fresh game was started. */
  source: "primary" | "backup" | "new";
  /** Failures encountered along the way (e.g. a corrupt primary when the backup was used). */
  errors: string[];
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function serializeSave(state: GameState, times: SaveTimes): string {
  const { encounter: _runtimeOnly, ...persisted } = state;
  const file: SaveFile = {
    schemaVersion: state.schemaVersion,
    savedAt: times.savedAt,
    lastActiveAt: times.lastActiveAt,
    state: persisted,
  };
  return JSON.stringify(file);
}

/** Parses, migrates, and validates a serialized save. The returned state has `encounter = null`. */
export function parseSave(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${(e as Error).message}` };
  }

  const migrated = migrateSave(raw);
  if (!migrated.ok) {
    return { ok: false, error: migrated.error };
  }
  const file = migrated.raw;

  const state = file.state;
  if (typeof state === "object" && state !== null && "encounter" in state) {
    return { ok: false, error: "persisted state must not contain encounter" };
  }
  const validation = validateState(state);
  if (!validation.ok) {
    return { ok: false, error: `invalid state: ${validation.errors.join("; ")}` };
  }
  return {
    ok: true,
    state: { ...validation.state, encounter: null },
    lastActiveAt: finiteOrNull(file.lastActiveAt),
    savedAt: finiteOrNull(file.savedAt),
  };
}

/**
 * Serializes, re-parses and validates before touching storage, so invalid data is never
 * written. The previous primary is moved to the backup key before the new primary is written.
 */
export function writeSave(storage: KeyValueStorage, state: GameState, times: SaveTimes): WriteResult {
  const text = serializeSave(state, times);
  const check = parseSave(text);
  if (!check.ok) {
    return { ok: false, errors: [check.error] };
  }
  // Storage can throw (quota exceeded, storage disabled); report it instead of crashing the caller.
  // The backup is written first, so a failed primary write leaves the previous save intact.
  try {
    const previous = storage.getItem(SAVE_KEY);
    if (previous !== null) {
      storage.setItem(BACKUP_KEY, previous);
    }
    storage.setItem(SAVE_KEY, text);
  } catch (e) {
    return { ok: false, errors: [`storage write failed: ${(e as Error).message}`] };
  }
  return { ok: true };
}

/**
 * For import and reset. Like `writeSave`, but also keeps the replaced primary under
 * REPLACED_KEY: the backup alone would be rotated away by the very next save.
 */
export function replaceSave(storage: KeyValueStorage, state: GameState, times: SaveTimes): WriteResult {
  let previous: string | null;
  try {
    previous = storage.getItem(SAVE_KEY);
  } catch (e) {
    return { ok: false, errors: [`storage read failed: ${(e as Error).message}`] };
  }
  const result = writeSave(storage, state, times);
  if (result.ok && previous !== null) {
    try {
      storage.setItem(REPLACED_KEY, previous);
    } catch (e) {
      return { ok: false, errors: [`the new save was written, but keeping the replaced one failed: ${(e as Error).message}`] };
    }
  }
  return result;
}

/**
 * Loads the primary save, falling back to the backup. If both fail, starts a new game and
 * keeps the unreadable raw string under CORRUPT_KEY for manual recovery.
 */
export function loadSave(storage: KeyValueStorage, newGame: { seed: number; now: number }): LoadResult {
  const errors: string[] = [];
  const primary = storage.getItem(SAVE_KEY);
  const backup = storage.getItem(BACKUP_KEY);

  if (primary !== null) {
    const parsed = parseSave(primary);
    if (parsed.ok) {
      return { state: parsed.state, lastActiveAt: parsed.lastActiveAt, source: "primary", errors };
    }
    errors.push(`primary: ${parsed.error}`);
  }

  if (backup !== null) {
    const parsed = parseSave(backup);
    if (parsed.ok) {
      return { state: parsed.state, lastActiveAt: parsed.lastActiveAt, source: "backup", errors };
    }
    errors.push(`backup: ${parsed.error}`);
  }

  const corrupt = primary ?? backup;
  if (corrupt !== null) {
    storage.setItem(CORRUPT_KEY, corrupt);
  }
  return { state: createInitialState(newGame.seed), lastActiveAt: newGame.now, source: "new", errors };
}

// --- Export / import (plan §12.6) ---

const EXPORT_SEPARATOR = ".";
const CRC_HEX_LENGTH = 8;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

function crcHex(bytes: Uint8Array): string {
  return crc32(bytes).toString(16).padStart(CRC_HEX_LENGTH, "0");
}

/** `base64(JSON(SaveFile))` + "." + CRC-32 (hex) of the JSON's UTF-8 bytes. */
export function encodeExport(state: GameState, times: SaveTimes): string {
  const json = new TextEncoder().encode(serializeSave(state, times));
  return `${bytesToBase64(json)}${EXPORT_SEPARATOR}${crcHex(json)}`;
}

/** Verifies the checksum, then migrates and validates like a stored save. Never touches storage. */
export function decodeExport(text: string): ParseResult {
  const trimmed = text.replace(/\s+/g, "");
  const at = trimmed.lastIndexOf(EXPORT_SEPARATOR);
  if (at < 0 || trimmed.length - at - 1 !== CRC_HEX_LENGTH) {
    return { ok: false, error: "missing checksum" };
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(trimmed.slice(0, at));
  } catch {
    return { ok: false, error: "invalid base64" };
  }
  if (crcHex(bytes) !== trimmed.slice(at + 1).toLowerCase()) {
    return { ok: false, error: "checksum mismatch" };
  }
  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, error: "invalid UTF-8" };
  }
  return parseSave(json);
}
