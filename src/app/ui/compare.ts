import type { BuildEvaluation } from "../../game/evaluate";
import { DAMAGE_TYPES } from "../../game/modifiers";
import { el } from "./dom";

const ESTIMATE_TOOLTIP = (level: number) =>
  `Standardized estimate, not a combat guarantee. Reference: monster level ${level}, 0 armor, 0 resistance, ` +
  `3-target pack, damage mix 40% physical / 15% each fire, cold, lightning, chaos.`;

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

export function comparisonTable(current: BuildEvaluation, candidate: BuildEvaluation, monsterLevel: number, candidateLabel: string): HTMLElement {
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
  const head = el("tr", undefined, el("th", undefined, ""), el("th", undefined, "Now"), el("th", undefined, candidateLabel), el("th", undefined, "Δ"));
  const table = el("table", "compare", el("thead", undefined, head), el("tbody", undefined, ...rows));
  const note = el("div", "muted", "* standardized estimate (hover for assumptions)");
  note.title = ESTIMATE_TOOLTIP(monsterLevel);
  return el("div", undefined, table, note);
}
