import { OFFLINE_SUMMARY_MIN_MS } from "../data/balance";
import { ZONES } from "../data/zones";
import { dispatch, type ActionResult, type PlayerAction } from "../game/engine";
import type { GameEvent } from "../game/events";
import { offlineWindow, runOffline, type OfflineSummary } from "../game/offline";
import { decodeExport, encodeExport, loadSave, replaceSave, writeSave, type LoadResult } from "../game/save";
import { appendLog, createInitialState, type GameState } from "../game/state";
import { createOnlineLoop, type OnlineLoop } from "./loop";
import { runOfflineInWorker, type OfflineRun } from "./offline-runner";
import { flushAndSave, needsImmediateSave } from "./persistence";
import { claimOwnership } from "./tab-lock";
import { createCharacterPanel } from "./ui/character-panel";
import { createCombatPanel } from "./ui/combat-panel";
import { button, el } from "./ui/dom";
import { createInventoryPanel } from "./ui/inventory-panel";
import { createMapPanel } from "./ui/map-panel";
import { createOverlay } from "./ui/overlay";
import { createSettingsPanel, type SaveControls } from "./ui/settings-panel";
import { createSkillPanel } from "./ui/skill-panel";
import "./style.css";

const AUTOSAVE_INTERVAL_MS = 30_000;

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

const root = document.getElementById("app");
if (root === null) {
  throw new Error("missing #app element");
}

/**
 * - starting: waiting for the tab lock
 * - blocked:  another tab owns the save; nothing is loaded, simulated or saved
 * - settling: offline settlement in progress; the loop is stopped and nothing else saves
 * - running:  the online loop owns time accounting
 * - paused:   page hidden; the hide-time save is authoritative until settlement on return
 * - stopped:  the save was replaced (import/reset) and the page is reloading
 */
type Phase = "starting" | "blocked" | "settling" | "running" | "paused" | "stopped";
let phase: Phase = "starting";

// Assigned by boot() before anything renders or simulates.
let state!: GameState;
/** Wall-clock instant up to which `state` has been accounted for (plan §11.1). */
let lastActiveAt: number | null = null;
let loop: OnlineLoop | null = null;
let autosaveTimer: ReturnType<typeof setInterval> | null = null;
let offlineRun: OfflineRun | null = null;
/** Bumped whenever the session is (re)booted or lost, so stale async settlements are ignored. */
let generation = 0;

// --- Persistence ---

/** Saves the running game up to now. Only the running loop may write, so stale state never overwrites a save. */
function persist(): void {
  if (phase !== "running" || loop === null) return;
  const now = Date.now();
  const result = flushAndSave(loop, localStorage, state, now);
  if (result.ok) {
    lastActiveAt = now;
  } else {
    console.error(`save failed: ${result.errors.join("; ")}`);
    appendLog(state, "error", "Saving failed; see the browser console for details.");
  }
}

function writeSettled(t0: number): void {
  const result = writeSave(localStorage, state, { savedAt: t0, lastActiveAt: t0 });
  if (!result.ok) {
    console.error(`save after settlement failed: ${result.errors.join("; ")}`);
    appendLog(state, "error", "Saving after offline progress failed; see the browser console for details.");
  }
}

// --- UI ---

function onAction(action: PlayerAction): ActionResult {
  const result = dispatch(state, action);
  if (result.ok) {
    persist();
  } else {
    console.warn(`action ${action.type} rejected: ${result.reason}`);
  }
  render();
  return result;
}

function describeSave(s: GameState, savedAt: number | null): string {
  const activity = s.progression.activity;
  const where = activity.kind === "zone" ? ZONES[activity.zoneId].name : `map tier ${activity.tier}`;
  const when = savedAt === null ? "unknown time" : new Date(savedAt).toLocaleString();
  return `a level ${s.character.level} character in ${where}, saved ${when}`;
}

const saveControls: SaveControls = {
  exportSave() {
    persist();
    const now = Date.now();
    return encodeExport(state, { savedAt: now, lastActiveAt: lastActiveAt ?? now });
  },
  previewImport(text) {
    const decoded = decodeExport(text);
    return decoded.ok ? { ok: true, description: describeSave(decoded.state, decoded.savedAt) } : decoded;
  },
  applyImport(text) {
    const decoded = decodeExport(text);
    if (!decoded.ok) return decoded.error;
    // Flush first so the replaced save holds the current game up to this instant.
    persist();
    const now = Date.now();
    // The imported save is treated as accounted up to now: the gap since it was exported is
    // never granted as offline time, so re-importing an old export cannot farm progress.
    const result = replaceSave(localStorage, decoded.state, { savedAt: now, lastActiveAt: now });
    if (!result.ok) return result.errors.join("; ");
    replaceSaveAndReload();
    return null;
  },
  reset() {
    persist();
    const now = Date.now();
    const result = replaceSave(localStorage, createInitialState(randomSeed()), { savedAt: now, lastActiveAt: now });
    if (!result.ok) {
      console.error(`reset failed: ${result.errors.join("; ")}`);
      return;
    }
    replaceSaveAndReload();
  },
};

function replaceSaveAndReload(): void {
  stopLoop();
  phase = "stopped";
  location.reload();
}

const characterPanel = createCharacterPanel();
const views = {
  combat: createCombatPanel(onAction),
  inventory: createInventoryPanel(onAction),
  skills: createSkillPanel(onAction),
  maps: createMapPanel(onAction),
  settings: createSettingsPanel(saveControls),
};
type View = keyof typeof views;
const VIEW_LABELS: Record<View, string> = {
  combat: "Combat",
  inventory: "Inventory",
  skills: "Skills",
  maps: "Maps",
  settings: "Settings",
};
let view: View = "combat";

const navButtons = (Object.keys(views) as View[]).map((name) => {
  const b = el("button", undefined, VIEW_LABELS[name]);
  b.type = "button";
  b.addEventListener("click", () => {
    view = name;
    render();
  });
  return [name, b] as const;
});
const nav = el("nav", "nav", ...navButtons.map(([, b]) => b));
const viewRoot = el("div", "view");
const notice = el("div", "notice panel error");
notice.hidden = true;
const overlay = createOverlay();
const shell = [notice, nav, characterPanel.root, viewRoot];
for (const node of shell) node.hidden = true;
root.replaceChildren(...shell, overlay.root);

function render(): void {
  if (phase === "starting" || phase === "blocked") return;
  characterPanel.render(state);
  for (const [name, b] of navButtons) b.classList.toggle("active", name === view);
  const panel = views[view];
  if (viewRoot.firstChild !== panel.root) viewRoot.replaceChildren(panel.root);
  panel.render(state);
}

function showLoadNotice(loaded: LoadResult): void {
  for (const error of loaded.errors) console.error(`save load: ${error}`);
  let text: string | null = null;
  if (loaded.source === "backup") {
    text = "The save could not be read, so the backup was loaded. Details are in the browser console.";
  } else if (loaded.source === "new" && loaded.errors.length > 0) {
    text = "No readable save was found, so a new game was started. The unreadable save was kept under exile-idle:save.corrupt.";
  }
  notice.textContent = text;
  notice.hidden = text === null;
}

// --- Session lifecycle (plan §4.4, §4.5, §11.2) ---

function onTick(events: GameEvent[]): void {
  render();
  if (needsImmediateSave(events)) persist();
}

function startLoop(): void {
  if (document.visibilityState === "hidden") {
    phase = "paused";
    return;
  }
  phase = "running";
  loop = createOnlineLoop(state, onTick);
  loop.start();
  autosaveTimer = setInterval(persist, AUTOSAVE_INTERVAL_MS);
}

function stopLoop(): void {
  loop?.stop();
  loop = null;
  if (autosaveTimer !== null) clearInterval(autosaveTimer);
  autosaveTimer = null;
}

/** Settles `[lastActiveAt, T0]` exactly once, saves with `lastActiveAt = T0`, then starts the loop. */
async function settle(): Promise<void> {
  const gen = generation;
  phase = "settling";
  stopLoop();
  const t0 = Date.now();
  const window = offlineWindow(lastActiveAt, t0);
  let summary: OfflineSummary | null = null;
  let failure: string | null = null;

  if (window.simulatedMs === 0) {
    summary = runOffline(state, window);
  } else {
    overlay.progress({ simulatedSoFar: 0, totalMs: window.simulatedMs });
    offlineRun = runOfflineInWorker(state, window, (p) => {
      if (gen === generation) overlay.progress(p);
    });
    try {
      const result = await offlineRun.result;
      if (gen !== generation) return;
      state = result.state;
      summary = result.summary;
    } catch (error) {
      if (gen !== generation) return;
      failure = error instanceof Error ? error.message : String(error);
      console.error(error);
      appendLog(state, "error", "Offline progress failed; the time away was not simulated.");
    } finally {
      offlineRun = null;
    }
  }

  lastActiveAt = t0;
  writeSettled(t0);
  overlay.hide();
  if (failure !== null) {
    overlay.message("Offline progress failed", failure, button("Continue", () => overlay.hide()));
  } else if (summary !== null && window.elapsedMs > OFFLINE_SUMMARY_MIN_MS) {
    overlay.summary(summary, () => overlay.hide());
  }
  startLoop();
  render();
}

function boot(): void {
  generation += 1;
  stopLoop();
  const loaded = loadSave(localStorage, { seed: randomSeed(), now: Date.now() });
  state = loaded.state;
  lastActiveAt = loaded.lastActiveAt;
  showLoadNotice(loaded);
  for (const node of [nav, characterPanel.root, viewRoot]) node.hidden = false;
  phase = "settling";
  render();
  void settle();
}

function lose(): void {
  generation += 1;
  stopLoop();
  offlineRun?.cancel();
  offlineRun = null;
  phase = "blocked";
  for (const node of shell) node.hidden = true;
  overlay.message(
    "Game is running in another tab",
    "Only one tab can run the game at a time.",
    button("Take over", () => {
      overlay.message("Taking over…", "Waiting for the other tab to stop.");
      ownership.takeOver();
    }),
  );
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    if (phase !== "running") return;
    persist();
    stopLoop();
    phase = "paused";
  } else if (phase === "paused") {
    // The in-memory state equals the save written at hide time (plan §11.2 step 2).
    void settle();
  }
});
// While paused or settling, the hide-time save is already authoritative; saving again would
// advance lastActiveAt without simulating the hidden time.
window.addEventListener("pagehide", persist);

overlay.message("Exile Idle", "Loading…");
const ownership = claimOwnership({ onAcquired: boot, onBlocked: lose, onLost: lose });
