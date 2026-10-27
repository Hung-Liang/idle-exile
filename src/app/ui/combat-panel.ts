import { MAP_MODIFIERS } from "../../data/map-modifiers";
import { ZONES, type ZoneId } from "../../data/zones";
import { monsterStats } from "../../game/combat";
import type { ActionResult, PlayerAction } from "../../game/engine";
import type { GameState } from "../../game/state";
import { resolveActivity } from "../../game/zones";
import type { Panel } from "./character-panel";
import { bar, el, type Bar } from "./dom";

const VISIBLE_LOG_ENTRIES = 50;

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

export function createCombatPanel(dispatch: (action: PlayerAction) => ActionResult): Panel {
  const zoneTitle = el("h2");
  const progress = bar("progress");
  const status = el("div", "muted");
  const mapInfo = el("div", "stats");
  const monstersList = el("div", "monsters");
  const monsterBars: Bar[] = [];

  const zoneSelect = el("select");
  zoneSelect.addEventListener("change", () => dispatch({ type: "travel_to_zone", zoneId: zoneSelect.value as ZoneId }));
  const autoAdvance = checkbox("Auto-advance", (value) => dispatch({ type: "set_auto_advance", value }));
  const autoRetreat = checkbox("Auto-retreat", (value) => dispatch({ type: "set_auto_retreat", value }));
  const controls = el("div", "controls", el("label", undefined, "Zone ", zoneSelect), autoAdvance.root, autoRetreat.root);

  const logList = el("ol", "log");
  const root = el("section", "panel", zoneTitle, progress.root, status, mapInfo, monstersList, controls, el("h3", undefined, "Combat log"), logList);

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
      autoRetreat.input.checked = state.settings.autoRetreat;

      const visible = state.log.slice(-VISIBLE_LOG_ENTRIES).reverse();
      const logKey = `${state.log.length}:${visible[0]?.timeMs ?? -1}:${visible[0]?.text ?? ""}`;
      if (logKey !== lastLogKey) {
        lastLogKey = logKey;
        logList.replaceChildren(
          ...visible.map((entry) => el("li", `log-${entry.kind}`, `[${formatSimTime(entry.timeMs)}] ${entry.text}`)),
        );
      }
    },
  };
}
