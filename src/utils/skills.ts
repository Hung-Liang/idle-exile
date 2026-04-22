
/**
 * Active Skills System for Idle Exile.
 * Adheres to the rules defined in Chapter 4.
 */

export interface Skill {
  id: string;
  name: string;
  baseMultiplier: number;
  cooldownTicks: number;
  baseExpRequired: number;
}

export interface PlayerSkill extends Skill {
  level: number;
  currentExp: number;
}

export const SKILL_DATABASE: Skill[] = [
  {
    id: 'heavy_strike',
    name: 'Heavy Strike',
    baseMultiplier: 2.5,
    cooldownTicks: 4,
    baseExpRequired: 100
  },
  {
    id: 'fireball',
    name: 'Fireball',
    baseMultiplier: 1.8,
    cooldownTicks: 2,
    baseExpRequired: 150
  },
  {
    id: 'whirlwind',
    name: 'Whirlwind',
    baseMultiplier: 3.5,
    cooldownTicks: 8,
    baseExpRequired: 300
  }
];

export const calculateSkillExpToNextLevel = (baseExp: number, level: number) => {
  return Math.floor(baseExp * Math.pow(1.5, level - 1));
};

export const calculateSkillDamage = (playerDps: number, skill: PlayerSkill) => {
  const levelMult = 1 + (skill.level - 1) * 0.1;
  return playerDps * skill.baseMultiplier * levelMult;
};
