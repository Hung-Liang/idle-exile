import { monsterStats } from "./combat";
import type { Modifier } from "./modifiers";
import { pickWeighted, weightedIndex, type RngState } from "./random";
import type { EncounterRuntime, MonsterRuntime } from "./state";
import type { ResolvedActivity } from "./zones";

function spawnMonster(defId: string, level: number, mods: readonly Modifier[], now: number): MonsterRuntime {
  const stats = monsterStats(defId, level, mods);
  return {
    defId,
    level,
    life: stats.maxLife,
    maxLife: stats.maxLife,
    nextAttackAt: now + stats.attackIntervalMs,
    alive: true,
  };
}

/**
 * Rolls a new pack for the activity's current encounter index (a boss once progress is
 * complete). Consumes only the `encounter` stream. The player attacks at +0 ms, each monster
 * after its own interval (plan §4.1).
 */
export function createEncounter(resolved: ResolvedActivity, rng: RngState, now: number): EncounterRuntime {
  const isBoss = resolved.encountersCleared >= resolved.requiredEncounters;
  const monsters: MonsterRuntime[] = [];
  if (isBoss) {
    monsters.push(spawnMonster(pickWeighted(rng, resolved.bossPool), resolved.monsterLevel, resolved.monsterMods, now));
  } else {
    const packSize = weightedIndex(rng, resolved.packSizeWeights) + 1;
    for (let i = 0; i < packSize; i++) {
      monsters.push(spawnMonster(pickWeighted(rng, resolved.monsterPool), resolved.monsterLevel, resolved.monsterMods, now));
    }
  }
  return {
    index: isBoss ? resolved.requiredEncounters : resolved.encountersCleared,
    isBoss,
    phase: "fighting",
    phaseEndsAt: now,
    monsters,
    player: { nextAttackAt: now },
    stacks: {},
  };
}
