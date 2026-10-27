import { EQUIP_SLOTS, RARITIES, type EquipSlot, type Rarity } from "../../game/equipment";
import { STAT_IDS, type StatId } from "../../game/modifiers";
import { defaultLootFilter, type LootFilterRule } from "../../game/state";
import { button, el } from "./dom";

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

function describeRule(rule: LootFilterRule): string {
  const conditions: string[] = [];
  if (rule.minRarity !== undefined) conditions.push(`rarity ≥ ${rule.minRarity}`);
  if (rule.slots !== undefined) conditions.push(`slot ${rule.slots.join("/")}`);
  if (rule.minItemLevel !== undefined) conditions.push(`ilvl ≥ ${rule.minItemLevel}`);
  if (rule.hasStat !== undefined) conditions.push(`has ${rule.hasStat.join("/")}`);
  if (rule.upgrade === true) conditions.push("upgrade");
  return `${conditions.length === 0 ? "any item" : conditions.join(", ")} → ${rule.action}`;
}

/** Plan §9.2 loot filter editor; `set` replaces the whole rule list. */
export function lootFilterEditor(rules: readonly LootFilterRule[], set: (next: LootFilterRule[]) => void): HTMLElement {
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
  const upgrade = el("input");
  upgrade.type = "checkbox";
  const upgradeLabel = el("label", "toggle", upgrade, " upgrade only");
  upgradeLabel.title = "Matches items that would improve DPS or EHP over the equipped item (standardized estimate)";
  const add = button("Add as first rule", () => {
    const rule: LootFilterRule = { action: action.value as LootFilterRule["action"] };
    if (rarity.value !== "") rule.minRarity = rarity.value as Rarity;
    if (slot.value !== "") rule.slots = [slot.value as EquipSlot];
    if (stat.value !== "") rule.hasStat = [stat.value as StatId];
    if (ilvl.value !== "") rule.minItemLevel = Number(ilvl.value);
    if (upgrade.checked) rule.upgrade = true;
    set([rule, ...rules]);
  });
  const reset = button("Reset to default", () => set(defaultLootFilter()));
  return el(
    "div",
    undefined,
    el("div", "muted", "First matching rule decides; unmatched items are kept."),
    list,
    el("div", "controls", rarity, slot, stat, ilvl, upgradeLabel, action, add, reset),
  );
}
