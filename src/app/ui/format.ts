import { getAffixDefinition, isUniqueAffix } from "../../data/affixes";
import { AILMENTS } from "../../data/ailments";
import { UNIQUES } from "../../data/uniques";
import { affixModifierSpecs } from "../../game/affixes";
import { itemBase, resolveItem, type ItemInstance, type RolledAffix } from "../../game/equipment";
import type { ModifierSpec } from "../../game/modifiers";

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function describeModifier(mod: ModifierSpec): string {
  let text = describeModifierValue(mod);
  if (mod.perStack !== undefined) text += ` per ${mod.perStack} stack`;
  if (mod.condition?.kind === "enemy_life_below_pct") text += ` against enemies below ${mod.condition.value}% life`;
  return text;
}

/** E.g. "ignite" for a fire `ailment_*` modifier; "ailments" without a damage type. */
function ailmentName(mod: ModifierSpec): string {
  const ailment = Object.values(AILMENTS).find((a) => a.damageType === mod.damageType);
  return ailment === undefined ? "ailments" : ailment.id;
}

function describeModifierValue(mod: ModifierSpec): string {
  // Damage types and tags narrow what the modifier applies to, e.g. "spell damage", "elemental damage".
  const qualifiers = [...(mod.damageType === undefined ? [] : [mod.damageType]), ...(mod.tags ?? [])];
  const type = qualifiers.map((q) => `${q.replaceAll("_", " ")} `).join("");
  const v = mod.value;
  if (Array.isArray(v)) {
    return mod.stat === "added_damage" ? `Adds ${v[0]}–${v[1]} ${type}damage` : `${mod.stat} ${v[0]}–${v[1]}`;
  }
  const signed = `${v >= 0 ? "+" : ""}${fmt(v)}`;
  const scaled =
    mod.kind === "increased" ? `${fmt(v)}% increased` : mod.kind === "more" ? (v >= 0 ? `${fmt(v)}% more` : `${fmt(-v)}% less`) : signed;
  switch (mod.stat) {
    case "damage":
      return `${scaled} ${type}damage`;
    case "attack_speed":
      return `${scaled} attack speed`;
    case "cast_speed":
      return `${scaled} cast speed`;
    case "ailment_chance":
      return mod.damageType === "physical"
        ? `${signed}% chance to cause bleeding`
        : `${signed}% chance to ${mod.damageType === undefined ? "inflict ailments" : ailmentName(mod)}`;
    case "ailment_effect":
      return `${scaled} effect of ${ailmentName(mod)}`;
    case "ailment_duration":
      return `${scaled} duration of ${ailmentName(mod)}`;
    case "ailment_avoidance":
      return `${fmt(v)}% chance to avoid ${mod.damageType === "physical" ? "bleeding" : ailmentName(mod)}`;
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
    case "resistance_max":
      return `${signed}% maximum ${type}resistance`;
    case "conversion":
      return `${fmt(v)}% of physical damage converted to ${mod.damageType}`;
    case "gain_as_extra":
      return `Gain ${fmt(v)}% of physical damage as extra ${mod.damageType}`;
    case "penetration":
      return `${type}damage penetrates ${fmt(v)}% resistance`;
    case "life_recovery_on_clear":
      return `Recover ${fmt(v)}% of maximum life when an encounter is cleared`;
    default:
      return `${scaled} ${type}${mod.stat.replaceAll("_", " ")}`;
  }
}

/** E.g. "[P T2] +40 maximum life"; unique lines have no prefix/suffix tag. */
export function describeAffix(affix: RolledAffix): string {
  const def = getAffixDefinition(affix.affixId);
  const text = affixModifierSpecs(affix).map(describeModifier).join(", ");
  if (isUniqueAffix(affix.affixId)) return text;
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
  if (item.uniqueId !== undefined) return `${UNIQUES[item.uniqueId].name}, ${itemBase(item).name} (ilvl ${item.itemLevel})`;
  return `${itemBase(item).name} (ilvl ${item.itemLevel})`;
}
