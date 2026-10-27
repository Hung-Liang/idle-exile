import { MAP_MODIFIERS } from "../../data/map-modifiers";
import { ZONES, type ZoneId } from "../../data/zones";
import { LEVEL_GAP_PCT_PER_LEVEL } from "../../data/balance";
import { monsterStats } from "../../game/combat";
import type { ActionResult, PlayerAction } from "../../game/engine";
import { blockedAutoAdvance } from "../../game/progression";
import { CURRENCIES, type CurrencyId } from "../../data/currencies";
import type { GameState, LogKind } from "../../game/state";
import type { SessionStats } from "../session-stats";
import { resolveActivity } from "../../game/zones";
import type { Panel } from "./character-panel";
import { bar, button, el, type Bar } from "./dom";
import { formatDuration } from "./overlay";

const VISIBLE_LOG_ENTRIES = 50;

/** Rates are shown once this much online time has been recorded, so they are not wildly noisy. */
const MIN_RATE_SAMPLE_MS = 60_000;

const LOG_FILTERS: readonly (readonly [string, string, readonly LogKind[] | null])[] = [
  ["all", "All", null],
  ["combat", "Combat", ["combat"]],
  ["drop", "Loot", ["drop"]],
  ["milestones", "Deaths & level-ups", ["death", "level_up"]],
  ["info", "Progress & errors", ["info", "error"]],
];

function perHour(count: number, ms: number): string {
  const rate = (count * 3_600_000) / ms;
  return rate >= 10_000 ? `${(rate / 1000).toFixed(0)}k` : rate >= 100 ? rate.toFixed(0) : rate.toFixed(1);
}

function sessionText(stats: SessionStats): string {
  const ms = stats.elapsedMs;
  if (ms < MIN_RATE_SAMPLE_MS) return `Session ${formatDuration(ms)}: rates appear after ${formatDuration(MIN_RATE_SAMPLE_MS)} online.`;
  const t = stats.tally;
  const kept = t.itemsKept.normal + t.itemsKept.magic + t.itemsKept.rare;
  const currency = (Object.keys(CURRENCIES) as CurrencyId[])
    .filter((id) => t.currencyGained[id] > 0)
    .map((id) => `${CURRENCIES[id].name} ${perHour(t.currencyGained[id], ms)}`);
  return [
    `Session ${formatDuration(ms)} — per hour: XP ${perHour(t.xpGained, ms)}`,
    `kills ${perHour(t.kills, ms)}`,
    `deaths ${perHour(t.deaths, ms)}`,
    `items kept ${perHour(kept, ms)}`,
    `salvaged ${perHour(t.salvagedByFilter + t.salvagedByOverflow, ms)}`,
    ...(currency.length > 0 ? currency : ["no currency yet"]),
  ].join(" · ");
}

function formatSimTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function checkbox(label: string, onChange: (checked: boolean) => void): { root: HTMLElement; input: HTMLInputElement } {
  const input = el("input");
  input.type = "checkbox";
  input.addEventListener("change", () => onChange(input.checked));
  return { root: el("label", "toggle", input, ` ${label}`), input };
}

export function createCombatPanel(dispatch: (action: PlayerAction) => ActionResult, stats: SessionStats): Panel {
  const zoneTitle = el("h2");
  const progress = bar("progress");
  const status = el("div", "muted");
  const mapInfo = el("div", "stats");
  const gapInfo = el("div", "stats");
  const nextInfo = el("div", "muted");
  const monstersList = el("div", "monsters");
  const monsterBars: Bar[] = [];

  const zoneSelect = el("select");
  zoneSelect.addEventListener("change", () => dispatch({ type: "travel_to_zone", zoneId: zoneSelect.value as ZoneId }));
  const autoAdvance = checkbox("Auto-advance", (value) => dispatch({ type: "set_auto_advance", value }));
  const autoRetreat = checkbox("Auto-retreat", (value) => dispatch({ type: "set_auto_retreat", value }));
  const controls = el("div", "controls", el("label", undefined, "Zone ", zoneSelect), autoAdvance.root, autoRetreat.root);

  // Auto-advance stays off after a retreat until the player turns it back on (plan §6.6).
  const paused = el(
    "div",
    "notice-inline",
    "Auto-advance is off: the character keeps farming here. Once resumed, it moves on after the next boss kill.",
    " ",
    button("Resume auto-advance", () => dispatch({ type: "set_auto_advance", value: true })),
  );

  const sessionInfo = el("span");
  const session = el("div", "stats", sessionInfo, " ", button("Reset", () => stats.reset()));

  const logList = el("ol", "log");
  let logFilter: readonly LogKind[] | null = null;
  const logSelect = el("select");
  for (const [value, label] of LOG_FILTERS) {
    const option = el("option", undefined, label);
    option.value = value;
    logSelect.append(option);
  }
  logSelect.addEventListener("change", () => {
    logFilter = LOG_FILTERS.find(([value]) => value === logSelect.value)?.[2] ?? null;
    lastLogKey = "";
  });
  const root = el(
    "section",
    "panel",
    zoneTitle,
    progress.root,
    status,
    paused,
    nextInfo,
    mapInfo,
    gapInfo,
    monstersList,
    controls,
    session,
    el("div", "controls", el("h3", undefined, "Combat log"), logSelect),
    logList,
  );

  let lastLogKey = "";
  let lastZonesKey = "";

  return {
    root,
    render(state) {
      const resolved = resolveActivity(state);
      const activity = state.progression.activity;
      const zoneId = activity.kind === "zone" ? activity.zoneId : null;
      zoneTitle.textContent = `${resolved.name} (monster level ${resolved.monsterLevel})`;

      const cleared = Math.min(resolved.encountersCleared, resolved.requiredEncounters);
      progress.set(cleared, resolved.requiredEncounters, `Progress ${cleared} / ${resolved.requiredEncounters}`);

      const encounter = state.encounter;
      const bossStatus =
        zoneId === null ? "" : ` · Boss ${state.progression.zoneProgress[zoneId]?.bossDefeated === true ? "defeated" : "not defeated"}`;
      const phase =
        encounter === null
          ? "Preparing…"
          : encounter.phase === "respawning"
            ? `Dead — respawning in ${Math.ceil((encounter.phaseEndsAt - state.simTimeMs) / 1000)} s`
            : encounter.phase === "transition"
              ? "Moving on…"
              : encounter.isBoss
                ? "Boss fight!"
                : `Encounter ${encounter.index + 1}`;
      status.textContent = `${phase}${bossStatus} · Deaths in a row: ${state.progression.consecutiveDeaths} · Sim ${formatSimTime(state.simTimeMs)}`;

      mapInfo.hidden = activity.kind !== "map";
      if (activity.kind === "map") {
        const mods = activity.modifiers.map((id) => `${MAP_MODIFIERS[id].name} (${MAP_MODIFIERS[id].description})`);
        mapInfo.textContent = `Modifiers: ${mods.length === 0 ? "none" : mods.join(" · ")} — Item quantity +${resolved.itemQuantityPct}%, rarity +${resolved.itemRarityPct}%`;
      }

      const gap = encounter?.levelGap ?? 0;
      gapInfo.hidden = gap === 0;
      gapInfo.textContent = `Level gap ${gap}: monsters have ${gap * LEVEL_GAP_PCT_PER_LEVEL}% more life and damage`;

      const blocked = blockedAutoAdvance(state);
      nextInfo.hidden = blocked === null;
      if (blocked !== null) nextInfo.textContent = `Next: ${blocked.name} at level ${blocked.requiredLevel}`;

      const monsters = encounter?.phase === "fighting" ? encounter.monsters : [];
      while (monsterBars.length < monsters.length) {
        const b = bar("monster");
        monsterBars.push(b);
        monstersList.append(b.root);
      }
      monsterBars.forEach((b, i) => {
        const m = monsters[i];
        b.root.hidden = m === undefined;
        if (m !== undefined) {
          const name = monsterStats(m.defId, m.level).name;
          b.set(m.life, m.maxLife, m.alive ? `${name} ${m.life} / ${m.maxLife}` : `${name} — slain`);
        }
      });

      const zonesKey = state.progression.unlockedZones.join(",") + "|" + (zoneId ?? "");
      if (zonesKey !== lastZonesKey) {
        lastZonesKey = zonesKey;
        // In a map, a placeholder keeps every zone selectable through the change event.
        const placeholder = el("option", undefined, "— in a map —");
        placeholder.disabled = true;
        placeholder.selected = zoneId === null;
        zoneSelect.replaceChildren(
          ...(zoneId === null ? [placeholder] : []),
          ...state.progression.unlockedZones.map((id) => {
            const option = el("option", undefined, ZONES[id].name);
            option.value = id;
            option.selected = id === zoneId;
            return option;
          }),
        );
      }
      autoAdvance.input.checked = state.settings.autoAdvance;
      paused.hidden = state.settings.autoAdvance;

      autoRetreat.input.checked = state.settings.autoRetreat;

      sessionInfo.textContent = sessionText(stats);

      const entries = logFilter === null ? state.log : state.log.filter((entry) => logFilter!.includes(entry.kind));
      const visible = entries.slice(-VISIBLE_LOG_ENTRIES).reverse();
      const logKey = `${entries.length}:${visible[0]?.timeMs ?? -1}:${visible[0]?.text ?? ""}`;
      if (logKey !== lastLogKey) {
        lastLogKey = logKey;
        logList.replaceChildren(
          ...visible.map((entry) => el("li", `log-${entry.kind}`, `[${formatSimTime(entry.timeMs)}] ${entry.text}`)),
        );
      }
    },
  };
}
