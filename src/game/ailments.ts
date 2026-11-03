import { AILMENT_IDS, AILMENTS, type AilmentId, type DamagingAilmentId } from "../data/ailments";
import { DOT_TICK_MS } from "../data/balance";
import type { DamagePortions, MonsterStats } from "./combat";
import { aggregate, applyScalar, type AggregateContext } from "./modifiers";
import { damageTags, type PlayerBuild, type Stacks } from "./stats";
import type { AilmentRuntimes, DamagingAilmentRuntime } from "./state";

/** A monster, or the player's side of the encounter (v0.7.0). */
export interface Afflictable {
  ailments?: AilmentRuntimes;
}

export interface AilmentStats {
  /** Percent per hit, in [0, 100]. */
  chance: number;
  /** Percent, after `ailment_effect` and the cap. */
  magnitude: number;
  durationMs: number;
}

export type AilmentStatTable = Record<AilmentId, AilmentStats>;

/** `ailment_*` modifiers match on the ailment's damage type and the skill's tags for that type. */
function ailmentContext(build: PlayerBuild, stacks: Stacks, id: AilmentId): AggregateContext {
  const type = AILMENTS[id].damageType;
  return { tags: damageTags(build.skill, type), damageType: type, stacks };
}

export function ailmentStats(build: PlayerBuild, stacks: Stacks): AilmentStatTable {
  const table = {} as AilmentStatTable;
  for (const id of AILMENT_IDS) {
    const def = AILMENTS[id];
    const ctx = ailmentContext(build, stacks, id);
    const magnitude = Math.max(0, applyScalar(def.magnitude, aggregate(build.mods, "ailment_effect", ctx)));
    table[id] = {
      chance: Math.min(100, Math.max(0, aggregate(build.mods, "ailment_chance", ctx).flat)),
      magnitude: def.maxMagnitude === undefined ? magnitude : Math.min(def.maxMagnitude, magnitude),
      durationMs: Math.max(DOT_TICK_MS, Math.round(applyScalar(def.durationMs, aggregate(build.mods, "ailment_duration", ctx)))),
    };
  }
  return table;
}

/**
 * What a monster's hits inflict on the player (v0.7.0): the monster's chance, reduced by the
 * player's avoidance, with the base magnitude and duration.
 */
export function monsterAilmentStats(stats: MonsterStats, avoidance: Readonly<Record<AilmentId, number>>): AilmentStatTable {
  const table = {} as AilmentStatTable;
  for (const id of AILMENT_IDS) {
    const def = AILMENTS[id];
    table[id] = {
      chance: stats.ailmentChance[id] * (1 - avoidance[id] / 100),
      magnitude: def.magnitude,
      durationMs: def.durationMs,
    };
  }
  return table;
}

/** Whether the attack needs an ailment draw at all; builds without any chance consume none. */
export function hasAilmentChance(table: AilmentStatTable): boolean {
  return AILMENT_IDS.some((id) => table[id].chance > 0);
}

/** Damage ticks of a bleed or ignite lasting `durationMs`. */
export function dotTicks(durationMs: number): number {
  return Math.max(1, Math.round(durationMs / DOT_TICK_MS));
}

function activeMagnitude(target: Afflictable, id: "chill" | "shock", now: number): number {
  const ailment = target.ailments?.[id];
  return ailment !== undefined && ailment.endsAt > now ? ailment.magnitude : 0;
}

/** Percent more damage the target takes from an active shock. */
export function shockPct(target: Afflictable, now: number): number {
  return activeMagnitude(target, "shock", now);
}

/** An attack scheduled while chilled waits longer; an attack already scheduled is not moved. */
export function chilledIntervalMs(intervalMs: number, target: Afflictable, now: number): number {
  const chill = activeMagnitude(target, "chill", now);
  return chill > 0 ? Math.round(intervalMs / (1 - chill / 100)) : intervalMs;
}

/** Shock applies to each tick; the ailment itself stores the pre-shock value. */
export function dotTickDamage(ailment: DamagingAilmentRuntime, target: Afflictable, now: number): number {
  return Math.max(1, Math.floor(ailment.damagePerTick * (1 + shockPct(target, now) / 100)));
}

/**
 * Applies what one hit inflicts (plan §6.8), by the player or by a monster. `roll ∈ [0, 1)` is the attack's single ailment draw,
 * shared by every target and ailment; `portions` are the hit's mitigated damage per type before
 * shock. A new bleed or ignite replaces the current one unless the current one deals more per tick;
 * a chill or shock replaces an active one unless that one is stronger. Returns what was applied.
 */
export function applyAilments(
  target: Afflictable,
  table: AilmentStatTable,
  portions: DamagePortions,
  roll: number,
  now: number,
): AilmentId[] {
  const applied: AilmentId[] = [];
  for (const id of AILMENT_IDS) {
    const def = AILMENTS[id];
    const stats = table[id];
    if (stats.chance <= 0 || roll * 100 >= stats.chance || portions[def.damageType] <= 0) continue;
    const ailments = (target.ailments ??= {});
    if (def.kind === "damaging") {
      const ticks = dotTicks(stats.durationMs);
      const damagePerTick = (portions[def.damageType] * stats.magnitude) / 100 / ticks;
      const current = ailments[id as DamagingAilmentId];
      if (current !== undefined && current.damagePerTick > damagePerTick) continue;
      ailments[id as DamagingAilmentId] = { damagePerTick, nextTickAt: now + DOT_TICK_MS, ticksLeft: ticks };
    } else {
      const key = id as "chill" | "shock";
      if (activeMagnitude(target, key, now) > stats.magnitude) continue;
      ailments[key] = { magnitude: stats.magnitude, endsAt: now + stats.durationMs };
    }
    applied.push(id);
  }
  return applied;
}

/** Ailments currently on the target, in definition order. */
export function activeAilments(target: Afflictable, now: number): AilmentId[] {
  return AILMENT_IDS.filter((id) => {
    if (AILMENTS[id].kind === "damaging") return target.ailments?.[id as DamagingAilmentId] !== undefined;
    return activeMagnitude(target, id as "chill" | "shock", now) > 0;
  });
}
