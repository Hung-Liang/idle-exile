import { EVALUATE_DAMAGE_MIX, EVALUATE_PACK_SIZE, monsterBaseDamage } from "../data/balance";
import { attackPortions, mitigatePortion, resolveHit, type HitTarget } from "./combat";
import type { EquipSlot, ItemId } from "./equipment";
import { DAMAGE_TYPES } from "./modifiers";
import {
  attackIntervalMs,
  collectBuild,
  computeDefenses,
  critChance,
  critMultiplier,
  type DefensiveStats,
  type PlayerBuild,
} from "./stats";
import type { GameState } from "./state";
import { resolveActivity } from "./zones";

/** Plan §8.8 reference monster: 0 armor, 0 resistance. Conditions on enemy life do not hold. */
const REFERENCE_TARGET: HitTarget = { armor: 0, resistances: {}, lifePct: 100 };

/**
 * Midpoint samples of the damage roll. The final per-hit floor makes the expected hit
 * non-linear in the roll, which matters at low damage (a 4–9 weapon loses ~5% to flooring).
 */
const ROLL_SAMPLES = 64;

/** Standardized estimates for comparison; not combat guarantees. */
export interface BuildEvaluation {
  /** Expected damage of one hit on the reference monster, crits included. */
  expectedHit: number;
  attacksPerSecond: number;
  /** Percent. */
  critChance: number;
  /** Percent. */
  critMultiplier: number;
  singleTargetDps: number;
  packDps: number;
  ehp: number;
  defenses: DefensiveStats;
}

/**
 * Reuses the combat pipeline (plan §6.2) with expected values in place of RNG draws: the damage
 * roll is integrated over midpoint samples and crits are weighted by their chance, so the
 * result equals `expected hit × (1 + chance × (multiplier − 1))` up to the final floor.
 */
export function evaluateBuild(build: PlayerBuild, monsterLevel: number): BuildEvaluation {
  const stacks = {};
  const chance = critChance(build, stacks);
  const multiplier = critMultiplier(build, stacks);
  const attacksPerSecond = 1000 / attackIntervalMs(build, stacks);
  const targets = Math.min(EVALUATE_PACK_SIZE, 1 + (build.skill.chain?.additionalTargets ?? 0));

  const hits = new Array<number>(targets).fill(0);
  for (let i = 0; i < ROLL_SAMPLES; i++) {
    const portions = attackPortions(build, stacks, (i + 0.5) / ROLL_SAMPLES);
    const normal = { portions, crit: false, critMultiplier: multiplier };
    const crit = { portions, crit: true, critMultiplier: multiplier };
    for (let t = 0; t < targets; t++) {
      const expected =
        (1 - chance / 100) * resolveHit(build, normal, stacks, REFERENCE_TARGET, t > 0) +
        (chance / 100) * resolveHit(build, crit, stacks, REFERENCE_TARGET, t > 0);
      hits[t]! += expected / ROLL_SAMPLES;
    }
  }
  const expectedHit = hits[0]!;

  const defenses = computeDefenses(build);
  const defender = { armor: defenses.armor, resistances: defenses.resistances, resistanceMax: defenses.resistanceMax };
  const referenceHit = monsterBaseDamage(monsterLevel);
  let takenFraction = 0;
  for (const type of DAMAGE_TYPES) {
    takenFraction += (EVALUATE_DAMAGE_MIX[type] * mitigatePortion(type, referenceHit, defender, 0)) / referenceHit;
  }

  return {
    expectedHit,
    attacksPerSecond,
    critChance: chance,
    critMultiplier: multiplier,
    singleTargetDps: expectedHit * attacksPerSecond,
    packDps: hits.reduce((a, b) => a + b, 0) * attacksPerSecond,
    ehp: defenses.maxLife / takenFraction,
    defenses,
  };
}

/** Evaluates the current build against the current activity's monster level. */
export function evaluateState(state: GameState): BuildEvaluation {
  return evaluateBuild(collectBuild(state), resolveActivity(state).monsterLevel);
}

/**
 * A read-only view of `state` with `itemId` in `slot` (or the slot emptied when null). Only the
 * fields `collectBuild` reads are copied; the original state is not modified.
 */
export function withEquipment(state: GameState, slot: EquipSlot, itemId: ItemId | null): GameState {
  const equipment = { ...state.character.equipment };
  for (const s of Object.keys(equipment) as EquipSlot[]) {
    if (itemId !== null && equipment[s] === itemId) equipment[s] = null;
  }
  equipment[slot] = itemId;
  return { ...state, character: { ...state.character, equipment } };
}

type BuildChoice = Pick<GameState["character"], "activeSkillId" | "supportIds" | "allocatedPassives">;

/** A read-only view of `state` with the given skill, supports or passives; the original is not modified. */
export function withBuild(state: GameState, patch: Partial<BuildChoice>): GameState {
  return { ...state, character: { ...state.character, ...patch } };
}

export interface EquipComparison {
  current: BuildEvaluation;
  candidate: BuildEvaluation;
}

export function compareEquip(state: GameState, itemId: ItemId, slot: EquipSlot): EquipComparison {
  return { current: evaluateState(state), candidate: evaluateState(withEquipment(state, slot, itemId)) };
}
