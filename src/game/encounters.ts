import { ELITE_RANKS, MONSTER_AFFIXES, type EliteRank, type MonsterAffixId } from "../data/monster-affixes";
import { getMonsterDefinition } from "../data/monsters";
import { levelGap, levelGapMods, monsterStats } from "./combat";
import type { Modifier } from "./modifiers";
import { nextFloat, pickWeighted, weightedIndex, type RngState, type WeightedList } from "./random";
import type { EncounterRuntime, MonsterRuntime } from "./state";
import type { ResolvedActivity } from "./zones";

const AFFIX_WEIGHTS: WeightedList<MonsterAffixId> = Object.values(MONSTER_AFFIXES).map((a) => ({ id: a.id, weight: a.weight }));

/** The elite's own modifiers: its rank's, then its affixes'. Empty for a normal monster. */
export function eliteMods(monster: Pick<MonsterRuntime, "rank" | "affixes">): Modifier[] {
  if (monster.rank === undefined) return [];
  const mods: Modifier[] = ELITE_RANKS[monster.rank].mods.map((spec) => ({ ...spec, source: { kind: "elite", id: monster.rank! } }));
  for (const id of monster.affixes ?? []) {
    mods.push(...MONSTER_AFFIXES[id].mods.map((spec) => ({ ...spec, source: { kind: "elite", id } as const })));
  }
  return mods;
}

/** Everything that modifies one monster: activity, level gap, and its elite rank and affixes. */
export function monsterModifiers(activityMods: readonly Modifier[], gap: number, monster: Pick<MonsterRuntime, "rank" | "affixes">): readonly Modifier[] {
  const shared = encounterMonsterMods(activityMods, gap);
  return monster.rank === undefined ? shared : [...shared, ...eliteMods(monster)];
}

/** E.g. "Brute", "Hasted Brute" (magic), "Rare Brute (Hasted, Warded)". */
export function monsterDisplayName(monster: Pick<MonsterRuntime, "defId" | "rank" | "affixes">): string {
  const name = getMonsterDefinition(monster.defId).name;
  const affixNames = (monster.affixes ?? []).map((id) => MONSTER_AFFIXES[id].name);
  if (monster.rank === "magic") return `${affixNames.join(" ")} ${name}`;
  if (monster.rank === "rare") return `Rare ${name} (${affixNames.join(", ")})`;
  return name;
}

/** Always consumes one draw; an elite also draws its affix count and affixes (without repeats). */
function rollElite(level: number, eliteChancePct: number, rng: RngState): Pick<MonsterRuntime, "rank" | "affixes"> {
  const roll = nextFloat(rng);
  const mult = 1 + eliteChancePct / 100;
  let threshold = 0;
  let rank: EliteRank | undefined;
  for (const candidate of ["rare", "magic"] as const) {
    const def = ELITE_RANKS[candidate];
    if (level < def.minMonsterLevel) continue;
    threshold += def.chance * mult;
    if (roll < threshold) {
      rank = candidate;
      break;
    }
  }
  if (rank === undefined) return {};
  const count = weightedIndex(rng, ELITE_RANKS[rank].affixCountWeights);
  const affixes: MonsterAffixId[] = [];
  let pool = AFFIX_WEIGHTS;
  while (affixes.length < count && pool.length > 0) {
    const id = pickWeighted(rng, pool);
    affixes.push(id);
    pool = pool.filter((entry) => entry.id !== id);
  }
  return { rank, affixes };
}

function spawnMonster(
  defId: string,
  level: number,
  activityMods: readonly Modifier[],
  gap: number,
  elite: Pick<MonsterRuntime, "rank" | "affixes">,
  now: number,
): MonsterRuntime {
  const stats = monsterStats(defId, level, monsterModifiers(activityMods, gap, elite));
  return {
    defId,
    level,
    life: stats.maxLife,
    maxLife: stats.maxLife,
    nextAttackAt: now + stats.attackIntervalMs,
    alive: true,
    ...elite,
  };
}

/**
 * Rolls a new pack for the activity's current encounter index (a boss once progress is
 * complete). Consumes only the `encounter` stream. Non-boss monsters may roll an elite rank (plan §10.6). The player attacks at +0 ms, each monster
 * after its own interval (plan §4.1).
 */
export function createEncounter(resolved: ResolvedActivity, characterLevel: number, rng: RngState, now: number): EncounterRuntime {
  const isBoss = resolved.encountersCleared >= resolved.requiredEncounters;
  const gap = levelGap(resolved.monsterLevel, characterLevel);
  const level = resolved.monsterLevel;
  const monsters: MonsterRuntime[] = [];
  if (isBoss) {
    monsters.push(spawnMonster(pickWeighted(rng, resolved.bossPool), level, resolved.monsterMods, gap, {}, now));
  } else {
    const packSize = weightedIndex(rng, resolved.packSizeWeights) + 1;
    for (let i = 0; i < packSize; i++) {
      const defId = pickWeighted(rng, resolved.monsterPool);
      const elite = rollElite(level, resolved.eliteChancePct, rng);
      monsters.push(spawnMonster(defId, level, resolved.monsterMods, gap, elite, now));
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
    levelGap: gap,
  };
}

/** The activity's monster modifiers plus the encounter's level-gap modifiers. */
export function encounterMonsterMods(activityMods: readonly Modifier[], gap: number): readonly Modifier[] {
  return gap > 0 ? [...activityMods, ...levelGapMods(gap)] : activityMods;
}
