import {
  CHARACTER_BASE,
  CRIT_CHANCE_CAP,
  MAX_ATTACKS_PER_SECOND,
  RESISTANCE_DEFAULT_MAX,
  RESISTANCE_MIN,
} from "../data/balance";
import { PASSIVE_NODES } from "../data/passive-tree";
import { SKILLS, type SkillDefinition } from "../data/skills";
import type { StackId } from "../data/stacks";
import { SUPPORTS } from "../data/supports";
import { EQUIP_SLOTS, resolveItem, type WeaponStats } from "./equipment";
import {
  aggregate,
  applyScalar,
  DAMAGE_TYPES,
  type AggregateContext,
  type DamageType,
  type Modifier,
  type ModifierSpec,
  type SourceRef,
  type Tag,
} from "./modifiers";
import { baseLife, type GameState } from "./state";

export type Stacks = Readonly<Partial<Record<StackId, number>>>;

export type { WeaponStats };

/** Everything derived from equipment, skill, supports and passives; independent of combat state. */
export interface PlayerBuild {
  level: number;
  skill: SkillDefinition;
  /** Global (non-local) modifiers from every source. */
  mods: Modifier[];
  weapon: WeaponStats;
  /** Sum of equipped items' local-adjusted base armor. */
  baseArmor: number;
}

export interface DefensiveStats {
  maxLife: number;
  armor: number;
  /** Effective resistance per type, already clamped to [min, max]. */
  resistances: Record<DamageType, number>;
  resistanceMax: Record<DamageType, number>;
  lifeOnHit: number;
  /** Percent of max life. */
  lifeRecoveryOnClearPct: number;
}

function withSource(specs: readonly ModifierSpec[], source: SourceRef): Modifier[] {
  return specs.map((spec) => ({ ...spec, source }));
}

export function collectBuild(state: GameState): PlayerBuild {
  const { character, inventory } = state;
  const skill = SKILLS[character.activeSkillId];
  const mods: Modifier[] = [...withSource(skill.modifiers, { kind: "skill", id: skill.id })];

  for (const supportId of character.supportIds) {
    if (supportId !== null) {
      mods.push(...withSource(SUPPORTS[supportId].modifiers, { kind: "support", id: supportId }));
    }
  }
  for (const nodeId of character.allocatedPassives) {
    mods.push(...withSource(PASSIVE_NODES[nodeId].modifiers, { kind: "passive", id: nodeId }));
  }

  let weapon: WeaponStats = {
    physical: [...CHARACTER_BASE.unarmedPhysical],
    attacksPerSecond: CHARACTER_BASE.unarmedAttacksPerSecond,
    critChance: CHARACTER_BASE.critChance,
  };
  let baseArmor = 0;

  for (const slot of EQUIP_SLOTS) {
    const itemId = character.equipment[slot];
    if (itemId === null) {
      continue;
    }
    const item = inventory.items[itemId];
    if (item === undefined) {
      throw new Error(`collectBuild: equipped item "${itemId}" is missing from inventory`);
    }
    const resolved = resolveItem(item);
    if (resolved.weapon !== undefined) {
      weapon = resolved.weapon;
    }
    baseArmor += resolved.armor;
    mods.push(...withSource(resolved.globalMods, { kind: "item", id: itemId }));
  }

  return { level: character.level, skill, mods, weapon, baseArmor };
}

function uniqueTags(tags: readonly Tag[]): Tag[] {
  return [...new Set(tags)];
}

/** Tags for per-type damage scaling: `{type, elemental?, attack, skill tags}` (plan §6.2 step 6). */
export function damageTags(skill: SkillDefinition, type: DamageType): Tag[] {
  const tags: Tag[] = [type, ...skill.tags];
  if (type === "fire" || type === "cold" || type === "lightning") {
    tags.push("elemental");
  }
  return uniqueTags(tags);
}

function skillContext(build: PlayerBuild, stacks: Stacks): AggregateContext {
  return { tags: build.skill.tags, stacks };
}

export function attackIntervalMs(build: PlayerBuild, stacks: Stacks): number {
  const result = aggregate(build.mods, "attack_speed", skillContext(build, stacks));
  const aps = Math.min(MAX_ATTACKS_PER_SECOND, applyScalar(build.weapon.attacksPerSecond, result));
  return Math.round(1000 / aps);
}

/** Percent. */
export function critChance(build: PlayerBuild, stacks: Stacks): number {
  const result = aggregate(build.mods, "crit_chance", skillContext(build, stacks));
  return Math.min(CRIT_CHANCE_CAP, applyScalar(build.weapon.critChance, result));
}

/** Percent. */
export function critMultiplier(build: PlayerBuild, stacks: Stacks): number {
  return CHARACTER_BASE.critMultiplier + aggregate(build.mods, "crit_multiplier", skillContext(build, stacks)).flat;
}

export function computeDefenses(build: PlayerBuild): DefensiveStats {
  const ctx: AggregateContext = { tags: [], stacks: {} };
  const resistances = {} as Record<DamageType, number>;
  const resistanceMax = {} as Record<DamageType, number>;
  for (const type of DAMAGE_TYPES) {
    const typed: AggregateContext = { ...ctx, damageType: type };
    const max = RESISTANCE_DEFAULT_MAX + aggregate(build.mods, "resistance_max", typed).flat;
    const raw = applyScalar(0, aggregate(build.mods, "resistance", typed));
    resistanceMax[type] = max;
    resistances[type] = Math.min(max, Math.max(RESISTANCE_MIN, raw));
  }
  return {
    maxLife: Math.max(1, Math.floor(applyScalar(baseLife(build.level), aggregate(build.mods, "life_max", ctx)))),
    armor: Math.max(0, applyScalar(build.baseArmor, aggregate(build.mods, "armor", ctx))),
    resistances,
    resistanceMax,
    lifeOnHit: aggregate(build.mods, "life_on_hit", ctx).flat,
    lifeRecoveryOnClearPct: aggregate(build.mods, "life_recovery_on_clear", ctx).flat,
  };
}

export function computeMaxLife(state: GameState): number {
  return computeDefenses(collectBuild(state)).maxLife;
}
