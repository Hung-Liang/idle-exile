import { AILMENT_IDS, AILMENTS, type AilmentId, type DamagingAilmentId } from "../data/ailments";
import { DOT_TICK_MS } from "../data/balance";
import type { DamagePortions } from "./combat";
import { aggregate, applyScalar, type AggregateContext } from "./modifiers";
import { damageTags, type PlayerBuild, type Stacks } from "./stats";
import type { DamagingAilmentRuntime, MonsterRuntime } from "./state";

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

/** Whether the attack needs an ailment draw at all; builds without any chance consume none. */
export function hasAilmentChance(table: AilmentStatTable): boolean {
  return AILMENT_IDS.some((id) => table[id].chance > 0);
}

/** Damage ticks of a bleed or ignite lasting `durationMs`. */
export function dotTicks(durationMs: number): number {
  return Math.max(1, Math.round(durationMs / DOT_TICK_MS));
}

function activeMagnitude(monster: MonsterRuntime, id: "chill" | "shock", now: number): number {
  const ailment = monster.ailments?.[id];
  return ailment !== undefined && ailment.endsAt > now ? ailment.magnitude : 0;
}

/** Percent more damage the monster takes from an active shock. */
export function shockPct(monster: MonsterRuntime, now: number): number {
  return activeMagnitude(monster, "shock", now);
}

/** A monster attack scheduled while chilled waits longer; an attack already scheduled is not moved. */
export function chilledIntervalMs(intervalMs: number, monster: MonsterRuntime, now: number): number {
  const chill = activeMagnitude(monster, "chill", now);
  return chill > 0 ? Math.round(intervalMs / (1 - chill / 100)) : intervalMs;
}

/** Shock applies to each tick; the ailment itself stores the pre-shock value. */
export function dotTickDamage(ailment: DamagingAilmentRuntime, monster: MonsterRuntime, now: number): number {
  return Math.max(1, Math.floor(ailment.damagePerTick * (1 + shockPct(monster, now) / 100)));
}

/**
 * Applies what one hit inflicts (plan §6.8). `roll ∈ [0, 1)` is the attack's single ailment draw,
 * shared by every target and ailment; `portions` are the hit's mitigated damage per type before
 * shock. A new bleed or ignite replaces the current one unless the current one deals more per tick;
 * a chill or shock replaces an active one unless that one is stronger. Returns what was applied.
 */
export function applyAilments(
  monster: MonsterRuntime,
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
    const ailments = (monster.ailments ??= {});
    if (def.kind === "damaging") {
      const ticks = dotTicks(stats.durationMs);
      const damagePerTick = (portions[def.damageType] * stats.magnitude) / 100 / ticks;
      const current = ailments[id as DamagingAilmentId];
      if (current !== undefined && current.damagePerTick > damagePerTick) continue;
      ailments[id as DamagingAilmentId] = { damagePerTick, nextTickAt: now + DOT_TICK_MS, ticksLeft: ticks };
    } else {
      const key = id as "chill" | "shock";
      if (activeMagnitude(monster, key, now) > stats.magnitude) continue;
      ailments[key] = { magnitude: stats.magnitude, endsAt: now + stats.durationMs };
    }
    applied.push(id);
  }
  return applied;
}

/** Ailments currently on the monster, in definition order. */
export function activeAilments(monster: MonsterRuntime, now: number): AilmentId[] {
  return AILMENT_IDS.filter((id) => {
    if (AILMENTS[id].kind === "damaging") return monster.ailments?.[id as DamagingAilmentId] !== undefined;
    return activeMagnitude(monster, id as "chill" | "shock", now) > 0;
  });
}
