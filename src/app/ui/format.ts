import { getAffixDefinition } from "../../data/affixes";
import { affixModifierSpecs } from "../../game/affixes";
import { itemBase, resolveItem, type ItemInstance, type RolledAffix } from "../../game/equipment";
import type { ModifierSpec } from "../../game/modifiers";

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function describeModifier(mod: ModifierSpec): string {
  const type = mod.damageType === undefined ? "" : `${mod.damageType} `;
  const v = mod.value;
  if (Array.isArray(v)) {
    return mod.stat === "added_damage" ? `Adds ${v[0]}–${v[1]} ${type}damage` : `${mod.stat} ${v[0]}–${v[1]}`;
  }
  const signed = `${v >= 0 ? "+" : ""}${fmt(v)}`;
  const scaled = mod.kind === "increased" ? `${fmt(v)}% increased` : mod.kind === "more" ? `${fmt(v)}% more` : signed;
  switch (mod.stat) {
    case "damage":
      return `${scaled} ${type}damage`;
    case "attack_speed":
      return `${scaled} attack speed`;
    case "crit_chance":
      return mod.kind === "flat" ? `${signed}% critical strike chance` : `${scaled} critical strike chance`;
    case "crit_multiplier":
      return `${signed}% critical strike multiplier`;
    case "life_max":
      return mod.kind === "flat" ? `${signed} maximum life` : `${scaled} maximum life`;
    case "armor":
      return mod.kind === "flat" ? `${signed} armor` : `${scaled} armor`;
    case "resistance":
      return `${signed}% ${type}resistance`;
    case "life_on_hit":
      return `${signed} life on hit`;
    default:
      return `${scaled} ${type}${mod.stat.replaceAll("_", " ")}`;
  }
}

/** E.g. "[P T2] +40 maximum life". */
export function describeAffix(affix: RolledAffix): string {
  const def = getAffixDefinition(affix.affixId);
  const text = affixModifierSpecs(affix).map(describeModifier).join(", ");
  return `[${def.category === "prefix" ? "P" : "S"} T${def.tier}] ${text}`;
}

/** Base values after local modifiers. */
export function describeBase(item: ItemInstance): string {
  const base = itemBase(item);
  const resolved = resolveItem(item);
  const parts = [`Requires level ${base.requiredLevel}`];
  if (resolved.weapon !== undefined) {
    const w = resolved.weapon;
    parts.push(`${fmt(w.physical[0])}–${fmt(w.physical[1])} physical`);
    for (const [type, range] of Object.entries(w.added ?? {})) {
      parts.push(`${range[0]}–${range[1]} ${type}`);
    }
    parts.push(`${w.attacksPerSecond.toFixed(2)} attacks/s`, `${w.critChance.toFixed(1)}% crit`);
  }
  if (base.armor !== undefined) {
    parts.push(`${Math.round(resolved.armor)} armor`);
  }
  return parts.join(" · ");
}

export function itemTitle(item: ItemInstance): string {
  return `${itemBase(item).name} (ilvl ${item.itemLevel})`;
}
