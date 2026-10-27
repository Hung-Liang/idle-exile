import type { ModifierSpec, Tag } from "../game/modifiers";

export type SkillId = "heavy_strike" | "rapid_assault" | "arc_pulse";

export interface SkillDefinition {
  id: SkillId;
  name: string;
  unlockLevel: number;
  tags: Tag[];
  /** Damage effectiveness multiplier (1.6 = 160%). */
  effectiveness: number;
  modifiers: ModifierSpec[];
  chain?: {
    additionalTargets: number;
    /** "more" value applied to chained hits; negative = less. */
    chainedHitMore: number;
  };
}

export const SKILLS: Record<SkillId, SkillDefinition> = {
  heavy_strike: {
    id: "heavy_strike",
    name: "Heavy Strike",
    unlockLevel: 1,
    tags: ["attack", "single_target"],
    effectiveness: 1.6,
    modifiers: [{ stat: "attack_speed", kind: "more", value: -20 }],
  },
  rapid_assault: {
    id: "rapid_assault",
    name: "Rapid Assault",
    unlockLevel: 4,
    tags: ["attack", "single_target"],
    effectiveness: 0.6,
    modifiers: [{ stat: "attack_speed", kind: "more", value: 60 }],
  },
  arc_pulse: {
    id: "arc_pulse",
    name: "Arc Pulse",
    unlockLevel: 8,
    tags: ["attack", "chain", "lightning"],
    effectiveness: 0.9,
    modifiers: [{ stat: "conversion", kind: "flat", damageType: "lightning", value: 100 }],
    chain: { additionalTargets: 2, chainedHitMore: -50 },
  },
};
