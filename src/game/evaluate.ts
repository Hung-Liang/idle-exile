import { EVALUATE_DAMAGE_MIX, EVALUATE_PACK_SIZE, monsterBaseDamage } from "../data/balance";
import { AILMENT_IDS, AILMENTS } from "../data/ailments";
import { ailmentStats, type AilmentStatTable } from "./ailments";
import {
  attackPortions,
  finalDamage,
  hitPortions,
  mitigatePortion,
  skillTargetCount,
  sumHit,
  type DamagePortions,
  type HitTarget,
} from "./combat";
import { itemBase, slotsForClass, type EquipSlot, type ItemId, type ItemInstance } from "./equipment";
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
  /** Hits plus bleed and ignite, with the expected shock uplift. */
  singleTargetDps: number;
  packDps: number;
  /** The bleed and ignite part of `singleTargetDps`. */
  ailmentDps: number;
  ailments: AilmentStatTable;
  ehp: number;
  defenses: DefensiveStats;
}

/** Chance that an ailment applied at `perSecond` and lasting `durationMs` is active at a random time. */
function uptime(perSecond: number, durationMs: number): number {
  return 1 - Math.exp(-perSecond * (durationMs / 1000));
}

/**
 * Reuses the combat pipeline (plan §6.2) with expected values in place of RNG draws: the damage
 * roll is integrated over midpoint samples and crits are weighted by their chance, so the
 * result equals `expected hit × (1 + chance × (multiplier − 1))` up to the final floor.
 *
 * Ailments (plan §6.8) are estimated from the expected hit: a bleed or ignite deals its damage
 * per second while active, and a shock multiplies all damage, each weighted by its uptime when
 * applied at `chance × uses per second`. Pack DPS gets the same relative uplift. Chill is not
 * part of either estimate.
 */
export function evaluateBuild(build: PlayerBuild, monsterLevel: number): BuildEvaluation {
  const stacks = {};
  const chance = critChance(build, stacks);
  const multiplier = critMultiplier(build, stacks);
  const attacksPerSecond = 1000 / attackIntervalMs(build, stacks);
  const targets = Math.min(EVALUATE_PACK_SIZE, skillTargetCount(build.skill));

  const hits = new Array<number>(targets).fill(0);
  const firstTarget: DamagePortions = { physical: 0, fire: 0, cold: 0, lightning: 0, chaos: 0 };
  for (let i = 0; i < ROLL_SAMPLES; i++) {
    const portions = attackPortions(build, stacks, (i + 0.5) / ROLL_SAMPLES);
    const normal = { portions, crit: false, critMultiplier: multiplier };
    const crit = { portions, crit: true, critMultiplier: multiplier };
    for (let t = 0; t < targets; t++) {
      const normalHit = hitPortions(build, normal, stacks, REFERENCE_TARGET, t > 0);
      const critHit = hitPortions(build, crit, stacks, REFERENCE_TARGET, t > 0);
      const expected =
        (1 - chance / 100) * finalDamage(sumHit(normalHit, REFERENCE_TARGET)) +
        (chance / 100) * finalDamage(sumHit(critHit, REFERENCE_TARGET));
      hits[t]! += expected / ROLL_SAMPLES;
      if (t === 0) {
        for (const type of DAMAGE_TYPES) {
          firstTarget[type] += ((1 - chance / 100) * normalHit[type] + (chance / 100) * critHit[type]) / ROLL_SAMPLES;
        }
      }
    }
  }
  const expectedHit = hits[0]!;

  const ailments = ailmentStats(build, stacks);
  let dotDps = 0;
  let shockMore = 1;
  for (const id of AILMENT_IDS) {
    const def = AILMENTS[id];
    const { chance: ailmentChance, magnitude, durationMs } = ailments[id];
    const active = uptime((ailmentChance / 100) * attacksPerSecond, durationMs);
    if (def.kind === "damaging") {
      dotDps += ((firstTarget[def.damageType] * magnitude) / 100 / (durationMs / 1000)) * active;
    } else if (def.kind === "shock") {
      shockMore = 1 + (magnitude / 100) * active;
    }
  }
  const hitDps = expectedHit * attacksPerSecond;
  const singleTargetDps = (hitDps + dotDps) * shockMore;

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
    singleTargetDps,
    packDps: hits.reduce((a, b) => a + b, 0) * attacksPerSecond * (singleTargetDps / hitDps),
    ailmentDps: dotDps * shockMore,
    ailments,
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

/** Allowed relative loss on the other metric when one improves (plan §8.8, §14.4). */
export const UPGRADE_TOLERANCE = 0.05;

/**
 * Single-target DPS or EHP improves while the other loses at most UPGRADE_TOLERANCE, and the
 * product grows: otherwise swapping a DPS item and an EHP item back and forth would satisfy the
 * rule in both directions forever.
 */
export function isUpgrade(current: BuildEvaluation, candidate: BuildEvaluation): boolean {
  const dps = candidate.singleTargetDps / current.singleTargetDps;
  const ehp = candidate.ehp / current.ehp;
  return ((dps > 1 && ehp >= 1 - UPGRADE_TOLERANCE) || (ehp > 1 && dps >= 1 - UPGRADE_TOLERANCE)) && dps * ehp > 1 + 1e-9;
}

/**
 * Whether equipping `item` in any of its slots would pass `isUpgrade` against the current build.
 * The item does not need to be in the inventory yet (the loot filter checks fresh drops), and
 * its level requirement is ignored so items for the next few levels can be kept.
 */
export function improvesBuild(state: GameState, item: ItemInstance, current: BuildEvaluation = evaluateState(state)): boolean {
  const view: GameState = { ...state, inventory: { ...state.inventory, items: { ...state.inventory.items, [item.id]: item } } };
  return slotsForClass(itemBase(item).itemClass).some((slot) => isUpgrade(current, evaluateState(withEquipment(view, slot, item.id))));
}
