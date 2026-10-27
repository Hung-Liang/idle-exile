import { CURRENCIES, type CurrencyId } from "../../data/currencies";
import { ZONES } from "../../data/zones";
import { RARITIES } from "../../game/equipment";
import type { OfflineProgress, OfflineSummary } from "../../game/offline";
import { bar, button, el } from "./dom";

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

function summaryLines(summary: OfflineSummary): HTMLElement[] {
  const rows: [string, string][] = [
    ["Time away", formatDuration(summary.elapsedMs)],
    ["Time simulated", `${formatDuration(summary.coveredMs)}${summary.capped ? " (capped at 8h)" : ""}`],
    ["XP gained", `${summary.xpGained}${summary.levelsGained > 0 ? ` (+${summary.levelsGained} levels)` : ""}`],
    ["Kills / deaths", `${summary.kills} / ${summary.deaths}`],
    ["Encounters cleared", String(summary.encountersCleared)],
  ];
  if (summary.zonesUnlocked.length > 0) rows.push(["Zones unlocked", summary.zonesUnlocked.map((id) => ZONES[id].name).join(", ")]);
  if (summary.mapTiersUnlocked > 0) rows.push(["Map tiers unlocked", String(summary.mapTiersUnlocked)]);
  rows.push(
    ["Items kept", RARITIES.map((r) => `${summary.itemsKept[r]} ${r}`).join(", ")],
    ["Salvaged by filter / overflow", `${summary.salvagedByFilter} / ${summary.salvagedByOverflow}`],
  );
  const currency = (Object.keys(CURRENCIES) as CurrencyId[])
    .filter((id) => summary.currencyGained[id] > 0)
    .map((id) => `${summary.currencyGained[id]} ${CURRENCIES[id].name}`);
  rows.push(["Currency gained", currency.length > 0 ? currency.join(", ") : "none"]);

  const lines = rows.map(([label, value]) => el("tr", undefined, el("th", undefined, label), el("td", undefined, value)));
  const table = el("table", "summary", el("tbody", undefined, ...lines));
  const notes: HTMLElement[] = [];
  if (summary.budgetExhausted) {
    notes.push(el("p", "error", "The simulation hit its safety cap; the rest of the time away was discarded."));
  }
  return [table, ...notes];
}

/** Full-screen modal used for loading, tab ownership, settlement progress and the offline summary. */
export interface Overlay {
  root: HTMLElement;
  message(title: string, text: string, ...actions: HTMLButtonElement[]): void;
  progress(p: OfflineProgress): void;
  summary(summary: OfflineSummary, onClose: () => void): void;
  hide(): void;
}

export function createOverlay(): Overlay {
  const box = el("div", "overlay-box panel");
  const root = el("div", "overlay", box);
  root.hidden = true;
  const progressBar = bar("progress");

  function show(...children: (Node | string)[]): void {
    box.replaceChildren(...children);
    root.hidden = false;
  }

  return {
    root,
    message(title, text, ...actions) {
      show(el("h2", undefined, title), el("p", undefined, text), ...(actions.length > 0 ? [el("div", "controls", ...actions)] : []));
    },
    progress(p) {
      progressBar.set(p.simulatedSoFar, p.totalMs, `${formatDuration(p.simulatedSoFar)} / ${formatDuration(p.totalMs)}`);
      if (!box.contains(progressBar.root)) show(el("h2", undefined, "Simulating time away…"), progressBar.root);
    },
    summary(summary, onClose) {
      show(el("h2", undefined, "While you were away"), ...summaryLines(summary), el("div", "controls", button("Continue", onClose)));
    },
    hide() {
      root.hidden = true;
      box.replaceChildren();
    },
  };
}
