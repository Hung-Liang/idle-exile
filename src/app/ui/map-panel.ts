import { MAX_MAP_TIER } from "../../data/balance";
import { MAP_TIERS } from "../../data/maps";
import { ZONE_ORDER, ZONES } from "../../data/zones";
import type { ActionResult, PlayerAction } from "../../game/engine";
import type { GameState } from "../../game/state";
import type { Panel } from "./character-panel";
import { button, el } from "./dom";

/** Plan §13.4: campaign zones and map tiers, each with an action to go there. */
export function createMapPanel(dispatch: (action: PlayerAction) => ActionResult): Panel {
  const root = el("section", "panel");
  let message = "";
  let lastKey = "";
  let lastState: GameState | null = null;

  function act(action: PlayerAction): void {
    const result = dispatch(action);
    message = result.ok ? "" : `Rejected: ${result.reason.replaceAll("_", " ")}`;
    lastKey = "";
    if (lastState !== null) panel.render(lastState);
  }

  function zoneTable(state: GameState): HTMLElement {
    const { activity, unlockedZones, zoneProgress } = state.progression;
    const rows = ZONE_ORDER.map((id) => {
      const zone = ZONES[id];
      const unlocked = unlockedZones.includes(id);
      const current = activity.kind === "zone" && activity.zoneId === id;
      const progress = zoneProgress[id];
      const action = current
        ? el("span", "muted", "here")
        : button("Farm here", () => act({ type: "travel_to_zone", zoneId: id }), unlocked ? undefined : "Defeat the previous zone's boss first");
      return el(
        "tr",
        current ? "active-row" : undefined,
        el("td", unlocked ? undefined : "muted", zone.name),
        el("td", "num", String(zone.monsterLevel)),
        el("td", undefined, unlocked ? `${progress?.encountersCleared ?? 0} / 10` : "locked"),
        el("td", undefined, progress?.bossDefeated === true ? "defeated" : "—"),
        el("td", undefined, action),
      );
    });
    return el(
      "table",
      "grid-table",
      el("tr", undefined, ...["Zone", "Level", "Progress", "Boss", ""].map((h) => el("th", h === "Level" ? "num" : undefined, h))),
      ...rows,
    );
  }

  function mapTable(state: GameState): HTMLElement {
    const { activity, unlockedMapTier } = state.progression;
    const rows = MAP_TIERS.map((tier) => {
      const unlocked = tier.tier <= unlockedMapTier;
      const current = activity.kind === "map" && activity.tier === tier.tier;
      const lockedReason = unlockedMapTier === 0 ? "Defeat The Hollow Regent to unlock maps" : `Complete Map Tier ${tier.tier - 1} first`;
      return el(
        "tr",
        current ? "active-row" : undefined,
        el("td", unlocked ? undefined : "muted", `Tier ${tier.tier}`),
        el("td", "num", String(tier.monsterLevel)),
        el("td", "num", `+${tier.quantityPct}%`),
        el("td", "num", `+${tier.rarityPct}%`),
        el(
          "td",
          undefined,
          button(current ? "Restart run" : "Start run", () => act({ type: "start_map", tier: tier.tier }), unlocked ? undefined : lockedReason),
        ),
      );
    });
    return el(
      "table",
      "grid-table",
      el("tr", undefined, ...["Map", "Level", "Quantity", "Rarity", ""].map((h) => el("th", h === "Map" || h === "" ? undefined : "num", h))),
      ...rows,
    );
  }

  const panel: Panel = {
    root,
    render(state) {
      lastState = state;
      const { activity, unlockedZones, zoneProgress, unlockedMapTier } = state.progression;
      const key = JSON.stringify([activity, unlockedZones, zoneProgress, unlockedMapTier, message]);
      if (key === lastKey) return;
      lastKey = key;
      root.replaceChildren(
        el("div", "error", message),
        el("h2", undefined, "Campaign"),
        zoneTable(state),
        el("h2", undefined, `Map tiers (${unlockedMapTier} / ${MAX_MAP_TIER} unlocked)`),
        el("p", "muted", "Each run: 12 encounters + boss, with 0–2 random modifiers. Starting a run rolls new modifiers."),
        mapTable(state),
      );
    },
  };
  return panel;
}
