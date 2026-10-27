import type { DamageType } from "../game/modifiers";

export type AilmentId = "bleed" | "ignite" | "chill" | "shock";
export type DamagingAilmentId = "bleed" | "ignite";

export interface AilmentDefinition {
  id: AilmentId;
  name: string;
  /** A hit can inflict the ailment only if it deals damage of this type; `ailment_*` modifiers select it by this type. */
  damageType: DamageType;
  /**
   * damaging: deals `magnitude`% of the inflicting hit's damage of `damageType` over the duration;
   * chill: the monster's next attacks are scheduled with `magnitude`% less attack speed;
   * shock: the monster takes `magnitude`% more damage from hits and damaging ailments.
   */
  kind: "damaging" | "chill" | "shock";
  durationMs: number;
  /** Percent, before `ailment_effect`. */
  magnitude: number;
  /** Cap on the magnitude after `ailment_effect`; none for damaging ailments. */
  maxMagnitude?: number;
}

// Plan §6.8. Iteration order is the order ailments are applied by one hit and ticked at one millisecond.
export const AILMENTS: Record<AilmentId, AilmentDefinition> = {
  bleed: { id: "bleed", name: "Bleeding", damageType: "physical", kind: "damaging", durationMs: 5_000, magnitude: 70 },
  ignite: { id: "ignite", name: "Ignited", damageType: "fire", kind: "damaging", durationMs: 4_000, magnitude: 90 },
  chill: { id: "chill", name: "Chilled", damageType: "cold", kind: "chill", durationMs: 2_000, magnitude: 30, maxMagnitude: 50 },
  shock: { id: "shock", name: "Shocked", damageType: "lightning", kind: "shock", durationMs: 4_000, magnitude: 20, maxMagnitude: 50 },
};

export const AILMENT_IDS = Object.keys(AILMENTS) as AilmentId[];
export const DAMAGING_AILMENT_IDS: readonly DamagingAilmentId[] = ["bleed", "ignite"];
