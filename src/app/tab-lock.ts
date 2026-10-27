import type { KeyValueStorage } from "../game/save";

export const LOCK_NAME = "exile-idle-sim";
export const CHANNEL_NAME = "exile-idle";
export const OWNER_KEY = "exile-idle:owner";
export const HEARTBEAT_MS = 2_000;
export const OWNER_STALE_MS = 6_000;
/** After stealing, the new owner waits this long before loading, so the old owner can stop. */
export const TAKEOVER_SETTLE_MS = 500;

export interface OwnershipHandlers {
  /** This tab now owns the save: load it and run settlement. */
  onAcquired(): void;
  /** Another tab owns the save at startup. */
  onBlocked(): void;
  /** Another tab took over: stop simulating immediately and do not save. */
  onLost(): void;
}

export interface Ownership {
  takeOver(): void;
}

// --- Heartbeat fallback (best-effort, plan §4.5) ---

export interface OwnerRecord {
  tabId: string;
  at: number;
}

export function readOwner(storage: KeyValueStorage): OwnerRecord | null {
  const raw = storage.getItem(OWNER_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      const { tabId, at } = parsed as Record<string, unknown>;
      if (typeof tabId === "string" && typeof at === "number" && Number.isFinite(at)) return { tabId, at };
    }
  } catch {
    // A malformed record is treated like no record: nobody can prove ownership with it.
  }
  return null;
}

/** Whether `tabId` may start: no other tab has written a fresh heartbeat. */
export function canClaim(storage: KeyValueStorage, tabId: string, now: number): boolean {
  const owner = readOwner(storage);
  return owner === null || owner.tabId === tabId || now - owner.at > OWNER_STALE_MS;
}

export function writeHeartbeat(storage: KeyValueStorage, tabId: string, now: number): void {
  storage.setItem(OWNER_KEY, JSON.stringify({ tabId, at: now } satisfies OwnerRecord));
}

/** Whether another tab has overwritten our record (i.e. took over). */
export function lostToAnotherTab(storage: KeyValueStorage, tabId: string): boolean {
  const owner = readOwner(storage);
  return owner !== null && owner.tabId !== tabId;
}

export function releaseHeartbeat(storage: KeyValueStorage, tabId: string): void {
  if (readOwner(storage)?.tabId === tabId) storage.removeItem(OWNER_KEY);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Requests single-tab ownership of the save (plan §4.5). Exactly one handler fires per outcome. */
export function claimOwnership(handlers: OwnershipHandlers): Ownership {
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL_NAME) : null;
  let owned = false;

  function acquired(): void {
    owned = true;
    handlers.onAcquired();
  }
  function lost(): void {
    if (!owned) return;
    owned = false;
    handlers.onLost();
  }
  channel?.addEventListener("message", (event: MessageEvent) => {
    if ((event.data as { type?: unknown } | null)?.type === "takeover") lost();
  });

  if (typeof navigator !== "undefined" && navigator.locks !== undefined) {
    return claimWithWebLocks(navigator.locks, channel, acquired, lost, handlers.onBlocked);
  }
  return claimWithHeartbeat(localStorage, channel, acquired, lost, handlers.onBlocked);
}

function claimWithWebLocks(
  locks: LockManager,
  channel: BroadcastChannel | null,
  acquired: () => void,
  lost: () => void,
  blocked: () => void,
): Ownership {
  // The lock is held for the page's lifetime; it is released by the browser when the page goes away.
  const holdForever = new Promise<void>(() => {});
  const onRejected = (error: unknown): void => {
    // A steal rejects the holder's request promise; the holder must stop itself.
    if (isAbortError(error)) {
      lost();
    } else {
      console.error("tab lock request failed", error);
    }
  };

  locks
    .request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (lock === null) {
        blocked();
        return;
      }
      acquired();
      await holdForever;
    })
    .catch(onRejected);

  return {
    takeOver() {
      channel?.postMessage({ type: "takeover" });
      locks
        .request(LOCK_NAME, { steal: true }, async () => {
          await sleep(TAKEOVER_SETTLE_MS);
          acquired();
          await holdForever;
        })
        .catch(onRejected);
    },
  };
}

function claimWithHeartbeat(
  storage: KeyValueStorage,
  channel: BroadcastChannel | null,
  acquired: () => void,
  lost: () => void,
  blocked: () => void,
): Ownership {
  const tabId = crypto.randomUUID();
  let timer: ReturnType<typeof setInterval> | null = null;

  function own(): void {
    writeHeartbeat(storage, tabId, Date.now());
    timer ??= setInterval(() => {
      if (lostToAnotherTab(storage, tabId)) {
        if (timer !== null) clearInterval(timer);
        timer = null;
        lost();
        return;
      }
      writeHeartbeat(storage, tabId, Date.now());
    }, HEARTBEAT_MS);
    acquired();
  }

  window.addEventListener("pagehide", () => releaseHeartbeat(storage, tabId));
  if (canClaim(storage, tabId, Date.now())) {
    own();
  } else {
    blocked();
  }

  return {
    takeOver() {
      channel?.postMessage({ type: "takeover" });
      writeHeartbeat(storage, tabId, Date.now());
      setTimeout(own, TAKEOVER_SETTLE_MS);
    },
  };
}
