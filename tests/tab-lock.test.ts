import { describe, expect, it } from "vitest";
import {
  OWNER_KEY,
  OWNER_STALE_MS,
  canClaim,
  lostToAnotherTab,
  readOwner,
  releaseHeartbeat,
  writeHeartbeat,
} from "../src/app/tab-lock";
import { MemoryStorage } from "./helpers/memory-storage";

const NOW = 1_800_000_000_000;

describe("heartbeat ownership fallback", () => {
  it("lets the first tab claim an empty slot", () => {
    expect(canClaim(new MemoryStorage(), "a", NOW)).toBe(true);
  });

  it("blocks a second tab while the owner's heartbeat is fresh", () => {
    const storage = new MemoryStorage();
    writeHeartbeat(storage, "a", NOW);
    expect(canClaim(storage, "b", NOW + OWNER_STALE_MS)).toBe(false);
    expect(canClaim(storage, "a", NOW + 1)).toBe(true);
  });

  it("treats an owner as stale after 6 s without a heartbeat", () => {
    const storage = new MemoryStorage();
    writeHeartbeat(storage, "a", NOW);
    expect(canClaim(storage, "b", NOW + OWNER_STALE_MS + 1)).toBe(true);
  });

  it("detects a takeover by another tab", () => {
    const storage = new MemoryStorage();
    writeHeartbeat(storage, "a", NOW);
    expect(lostToAnotherTab(storage, "a")).toBe(false);
    writeHeartbeat(storage, "b", NOW + 100);
    expect(lostToAnotherTab(storage, "a")).toBe(true);
    expect(lostToAnotherTab(storage, "b")).toBe(false);
  });

  it("ignores malformed records", () => {
    const storage = new MemoryStorage();
    storage.setItem(OWNER_KEY, "{oops");
    expect(readOwner(storage)).toBeNull();
    expect(canClaim(storage, "b", NOW)).toBe(true);
    storage.setItem(OWNER_KEY, JSON.stringify({ tabId: 3, at: NOW }));
    expect(readOwner(storage)).toBeNull();
  });

  it("releases only its own record", () => {
    const storage = new MemoryStorage();
    writeHeartbeat(storage, "a", NOW);
    releaseHeartbeat(storage, "b");
    expect(readOwner(storage)).toEqual({ tabId: "a", at: NOW });
    releaseHeartbeat(storage, "a");
    expect(readOwner(storage)).toBeNull();
  });
});
