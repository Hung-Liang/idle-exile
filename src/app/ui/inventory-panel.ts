import { INVENTORY_CAPACITY } from "../../data/balance";
import { CURRENCIES, type CurrencyId } from "../../data/currencies";
import type { ActionResult, PlayerAction } from "../../game/engine";
import { EQUIP_SLOTS, itemBase, RARITIES, slotsForClass, type EquipSlot, type ItemId, type Rarity } from "../../game/equipment";
import { compareEquip, evaluateState, withEquipment, type BuildEvaluation } from "../../game/evaluate";
import { DAMAGE_TYPES, STAT_IDS, type StatId } from "../../game/modifiers";
import { defaultLootFilter, type GameState, type LootFilterRule } from "../../game/state";
import { resolveActivity } from "../../game/zones";
import type { Panel } from "./character-panel";
import { el } from "./dom";
import { describeAffix, describeBase, itemTitle } from "./format";

type Dispatch = (action: PlayerAction) => ActionResult;

const ESTIMATE_TOOLTIP = (level: number) =>
  `Standardized estimate, not a combat guarantee. Reference: monster level ${level}, 0 armor, 0 resistance, ` +
  `3-target pack, damage mix 40% physical / 15% each fire, cold, lightning, chaos.`;

function button(label: string, onClick: () => void, disabledReason?: string): HTMLButtonElement {
  const b = el("button", undefined, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  if (disabledReason !== undefined) {
    b.disabled = true;
    b.title = disabledReason;
  }
  return b;
}

function select<T extends string>(options: readonly (readonly [T, string])[], value: T): HTMLSelectElement {
  const s = el("select");
  for (const [v, label] of options) {
    const o = el("option", undefined, label);
    o.value = v;
    o.selected = v === value;
    s.append(o);
  }
  return s;
}

interface StatRow {
  label: string;
  get: (e: BuildEvaluation) => number;
  digits: number;
  estimate?: boolean;
  suffix?: string;
}

const STAT_ROWS: StatRow[] = [
  { label: "Single-target DPS", get: (e) => e.singleTargetDps, digits: 1, estimate: true },
  { label: "Pack DPS", get: (e) => e.packDps, digits: 1, estimate: true },
  { label: "EHP", get: (e) => e.ehp, digits: 0, estimate: true },
  { label: "Max life", get: (e) => e.defenses.maxLife, digits: 0 },
  { label: "Armor", get: (e) => e.defenses.armor, digits: 0 },
  ...DAMAGE_TYPES.filter((t) => t !== "physical").map(
    (t): StatRow => ({ label: `${t[0]!.toUpperCase()}${t.slice(1)} res`, get: (e) => e.defenses.resistances[t], digits: 0, suffix: "%" }),
  ),
  { label: "Attacks / s", get: (e) => e.attacksPerSecond, digits: 2 },
  { label: "Crit chance", get: (e) => e.critChance, digits: 1, suffix: "%" },
  { label: "Crit multiplier", get: (e) => e.critMultiplier, digits: 0, suffix: "%" },
];

function comparisonTable(current: BuildEvaluation, candidate: BuildEvaluation, monsterLevel: number): HTMLElement {
  const rows = STAT_ROWS.map((row) => {
    const a = row.get(current);
    const b = row.get(candidate);
    const delta = b - a;
    const threshold = 0.5 * 10 ** -row.digits;
    const cls = delta > threshold ? "delta-up" : delta < -threshold ? "delta-down" : "muted";
    const label = el("td", undefined, row.estimate ? `${row.label}*` : row.label);
    if (row.estimate) label.title = ESTIMATE_TOOLTIP(monsterLevel);
    const s = row.suffix ?? "";
    return el(
      "tr",
      undefined,
      label,
      el("td", undefined, `${a.toFixed(row.digits)}${s}`),
      el("td", undefined, `${b.toFixed(row.digits)}${s}`),
      el("td", cls, `${delta >= 0 ? "+" : ""}${delta.toFixed(row.digits)}${s}`),
    );
  });
  const head = el("tr", undefined, el("th", undefined, ""), el("th", undefined, "Now"), el("th", undefined, "With item"), el("th", undefined, "Δ"));
  const table = el("table", "compare", el("thead", undefined, head), el("tbody", undefined, ...rows));
  const note = el("div", "muted", "* standardized estimate (hover for assumptions)");
  note.title = ESTIMATE_TOOLTIP(monsterLevel);
  return el("div", undefined, table, note);
}

function describeRule(rule: LootFilterRule): string {
  const conditions: string[] = [];
  if (rule.minRarity !== undefined) conditions.push(`rarity ≥ ${rule.minRarity}`);
  if (rule.slots !== undefined) conditions.push(`slot ${rule.slots.join("/")}`);
  if (rule.minItemLevel !== undefined) conditions.push(`ilvl ≥ ${rule.minItemLevel}`);
  if (rule.hasStat !== undefined) conditions.push(`has ${rule.hasStat.join("/")}`);
  return `${conditions.length === 0 ? "any item" : conditions.join(", ")} → ${rule.action}`;
}

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
          comparisonTable(current, candidate, monsterLevel),
        );
      }
    } else {
      const without = evaluateState(withEquipment(state, equippedIn, null));
      box.append(el("h3", undefined, "Contribution (now vs. slot empty)"), comparisonTable(without, evaluateState(state), monsterLevel));
    }
    return box;
  }

  function filterEditor(state: GameState): HTMLElement {
    const rules = state.settings.lootFilter;
    const set = (next: LootFilterRule[]) => act({ type: "set_loot_filter", rules: next });
    const list = el(
      "ol",
      "filter",
      ...rules.map((rule, i) =>
        el(
          "li",
          undefined,
          `${describeRule(rule)} `,
          button("↑", () => set(rules.map((r, j) => (j === i - 1 ? rules[i]! : j === i ? rules[i - 1]! : r))), i === 0 ? "Already first" : undefined),
          button("↓", () => set(rules.map((r, j) => (j === i + 1 ? rules[i]! : j === i ? rules[i + 1]! : r))), i === rules.length - 1 ? "Already last" : undefined),
          button("✕", () => set(rules.filter((_, j) => j !== i))),
        ),
      ),
    );

    const action = select([["keep", "keep"], ["salvage", "salvage"]] as const, "salvage");
    const rarity = select([["", "any rarity"], ...RARITIES.map((r) => [r, `≥ ${r}`] as const)], "");
    const slot = select([["", "any slot"], ...EQUIP_SLOTS.map((s) => [s, s] as const)], "");
    const stat = select([["", "any stat"], ...STAT_IDS.map((s) => [s, s] as const)], "");
    const ilvl = el("input");
    ilvl.type = "number";
    ilvl.min = "0";
    ilvl.placeholder = "min ilvl";
    ilvl.className = "ilvl";
    const add = button("Add as first rule", () => {
      const rule: LootFilterRule = { action: action.value as LootFilterRule["action"] };
      if (rarity.value !== "") rule.minRarity = rarity.value as Rarity;
      if (slot.value !== "") rule.slots = [slot.value as EquipSlot];
      if (stat.value !== "") rule.hasStat = [stat.value as StatId];
      if (ilvl.value !== "") rule.minItemLevel = Number(ilvl.value);
      set([rule, ...rules]);
    });
    const reset = button("Reset to default", () => set(defaultLootFilter()));
    return el(
      "div",
      undefined,
      el("div", "muted", "First matching rule decides; unmatched items are kept."),
      list,
      el("div", "controls", rarity, slot, stat, ilvl, action, add, reset),
    );
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
        state.settings.lootFilter,
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
        el("h3", undefined, "Loot filter"),
        filterEditor(state),
      );
    },
  };
  return panel;
}
