import { INVENTORY_CAPACITY } from "../../data/balance";
import { CURRENCIES, type CurrencyId } from "../../data/currencies";
import { canApplyCurrency } from "../../game/crafting";
import type { ActionResult, PlayerAction } from "../../game/engine";
import { EQUIP_SLOTS, itemBase, slotsForClass, type EquipSlot, type ItemId } from "../../game/equipment";
import { compareEquip, evaluateState, withEquipment } from "../../game/evaluate";
import type { GameState } from "../../game/state";
import { resolveActivity } from "../../game/zones";
import type { Panel } from "./character-panel";
import { comparisonTable } from "./compare";
import { button, el } from "./dom";
import { describeAffix, describeBase, itemTitle } from "./format";

type Dispatch = (action: PlayerAction) => ActionResult;

export function createInventoryPanel(dispatch: Dispatch): Panel {
  const root = el("section", "panel");
  let selected: ItemId | null = null;
  let message = "";
  let lastKey = "";
  let lastState: GameState | null = null;

  function rerender(): void {
    lastKey = "";
    if (lastState !== null) panel.render(lastState);
  }

  function act(action: PlayerAction): void {
    const result = dispatch(action);
    message = result.ok ? "" : `Rejected: ${result.reason.replaceAll("_", " ")}`;
    rerender();
  }

  function itemRow(state: GameState, itemId: ItemId, prefix: string): HTMLElement {
    const item = state.inventory.items[itemId]!;
    const row = el("li", `item rarity-${item.rarity}${itemId === selected ? " selected" : ""}`, `${prefix}${itemTitle(item)}`);
    row.addEventListener("click", () => {
      selected = itemId;
      rerender();
    });
    return row;
  }

  function detail(state: GameState): HTMLElement {
    const item = selected === null ? undefined : state.inventory.items[selected];
    if (item === undefined || selected === null) {
      selected = null;
      return el("div", "muted", "Select an item to see details and comparisons.");
    }
    const itemId = selected;
    const base = itemBase(item);
    const equippedIn = EQUIP_SLOTS.find((slot) => state.character.equipment[slot] === itemId);
    const box = el(
      "div",
      "detail",
      el("div", `rarity-${item.rarity}`, `${item.rarity.toUpperCase()} ${itemTitle(item)}`),
      el("div", "muted", describeBase(item)),
      el("ul", "affixes", ...(item.affixes.length === 0 ? [el("li", "muted", "No affixes")] : item.affixes.map((a) => el("li", undefined, describeAffix(a))))),
    );

    const actions = el("div", "controls");
    if (equippedIn !== undefined) {
      actions.append(button(`Unequip (${equippedIn})`, () => act({ type: "unequip_slot", slot: equippedIn })));
    } else {
      const tooLow = state.character.level < base.requiredLevel ? `Requires level ${base.requiredLevel}` : undefined;
      for (const slot of slotsForClass(base.itemClass)) {
        actions.append(button(`Equip → ${slot}`, () => act({ type: "equip_item", itemId, slot }), tooLow));
      }
      actions.append(button("Salvage", () => act({ type: "salvage_item", itemId })));
    }
    box.append(actions);

    const crafting = el("div", "controls");
    for (const id of Object.keys(CURRENCIES) as CurrencyId[]) {
      const def = CURRENCIES[id];
      const count = state.inventory.currency[id];
      const reason = count < 1 ? `No ${def.name} left` : canApplyCurrency(item, id) ? undefined : `Not a valid target: ${def.description}`;
      const b = button(`${def.name} (${count})`, () => act({ type: "use_currency", currencyId: id, itemId }), reason);
      if (reason === undefined) b.title = def.description;
      crafting.append(b);
    }
    box.append(el("h3", undefined, "Craft"), crafting);

    const monsterLevel = resolveActivity(state).monsterLevel;
    if (equippedIn === undefined) {
      for (const slot of slotsForClass(base.itemClass)) {
        const { current, candidate } = compareEquip(state, itemId, slot);
        const currentId = state.character.equipment[slot];
        const currentItem = currentId === null ? undefined : state.inventory.items[currentId];
        const oldLines = currentItem?.affixes.map(describeAffix) ?? [];
        const newLines = item.affixes.map(describeAffix);
        const strip = (line: string) => line.replace(/^\[[^\]]*\] /, "");
        const oldTexts = new Set(oldLines.map(strip));
        const newTexts = new Set(newLines.map(strip));
        box.append(
          el("h3", undefined, `Compare with ${slot}: ${currentItem === undefined ? "empty" : itemTitle(currentItem)}`),
          el(
            "div",
            "mod-diff",
            el("ul", undefined, el("li", "muted", "Equipped"), ...oldLines.map((l) => el("li", newTexts.has(strip(l)) ? undefined : "delta-down", `− ${l}`))),
            el("ul", undefined, el("li", "muted", "Candidate"), ...newLines.map((l) => el("li", oldTexts.has(strip(l)) ? undefined : "delta-up", `+ ${l}`))),
          ),
          comparisonTable(current, candidate, monsterLevel, "With item"),
        );
      }
    } else {
      const without = evaluateState(withEquipment(state, equippedIn, null));
      box.append(el("h3", undefined, "Contribution (now vs. slot empty)"), comparisonTable(without, evaluateState(state), monsterLevel, "With item"));
    }
    return box;
  }

  const panel: Panel = {
    root,
    render(state) {
      lastState = state;
      const { inventory, character } = state;
      const key = JSON.stringify([
        inventory.order,
        character.equipment,
        inventory.currency,
        character.level,
        selected,
        state.settings.lootFilter.length,
        resolveActivity(state).monsterLevel,
        message,
      ]);
      if (key === lastKey) return;
      lastKey = key;

      const currency = (Object.keys(CURRENCIES) as CurrencyId[]).map((id) => `${CURRENCIES[id].name} ${inventory.currency[id]}`).join(" · ");
      const equipment = el(
        "ul",
        "items",
        ...EQUIP_SLOTS.map((slot) => {
          const id = character.equipment[slot];
          return id === null ? el("li", "muted", `${slot}: —`) : itemRow(state, id, `${slot}: `);
        }),
      );
      const items = el("ul", "items scroll", ...inventory.order.map((id) => itemRow(state, id, "")));

      root.replaceChildren(
        el("h2", undefined, `Inventory (${inventory.order.length} / ${INVENTORY_CAPACITY})`),
        el("div", "stats", currency),
        el("div", "error", message),
        el(
          "div",
          "inventory-grid",
          el("div", undefined, el("h3", undefined, "Equipment"), equipment, el("h3", undefined, "Items"), items),
          el("div", undefined, detail(state)),
        ),
        el(
          "div",
          "muted",
          `Loot filter: ${state.settings.lootFilter.length} rule${state.settings.lootFilter.length === 1 ? "" : "s"} — edit it under Settings.`,
        ),
      );
    },
  };
  return panel;
}
