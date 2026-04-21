
/**
 * Core Combat Logic and Scaling Curves for Idle Exile.
 * Adheres to the rules defined in Chapter 3.2 and 3.3 of plan.md.
 */

export interface PlayerStats {
  dps: number;
  hp: number;
  damageReduction: number; // 0 to 1
}

export interface MonsterStats {
  level: number;
  baseEhp: number;
  baseDps: number;
  baseExp: number;
  baseGold: number;
}

export interface CombatResult {
  isVictory: boolean;
  ttk: number; // Time To Kill (seconds)
  tts: number; // Time To Survive (seconds)
  earnedExp: number;
  earnedGold: number;
}

/**
 * Tiered Scaling Multiplier based on Level.
 * Tier 1 (1-100): 1.15
 * Tier 2 (101-500): 1.08
 * Tier 3 (501+): 1.02
 */
export const getScalingMultiplier = (level: number): number => {
  if (level <= 100) return 1.15;
  if (level <= 500) return 1.08;
  return 1.02;
};

/**
 * Calculates Monster EHP using tiered scaling curves.
 */
export const calculateMonsterEHP = (baseEhp: number, level: number): number => {
  let currentEhp = baseEhp;
  for (let i = 2; i <= level; i++) {
    currentEhp *= getScalingMultiplier(i);
  }
  return currentEhp;
};

/**
 * Calculates Monster DPS using tiered scaling curves.
 */
export const calculateMonsterDPS = (baseDps: number, level: number): number => {
  let currentDps = baseDps;
  for (let i = 2; i <= level; i++) {
    currentDps *= getScalingMultiplier(i);
  }
  return currentDps;
};

/**
 * Gets full monster stats for a specific level.
 */
export const getMonsterStats = (baseMonster: Omit<MonsterStats, 'level'>, level: number): MonsterStats => {
  return {
    ...baseMonster,
    level,
    baseEhp: calculateMonsterEHP(baseMonster.baseEhp, level),
    baseDps: calculateMonsterDPS(baseMonster.baseDps, level),
  };
};

/**
 * Evaluates combat outcome and rewards.
 */
export const evaluateCombat = (player: PlayerStats, monster: MonsterStats): CombatResult => {
  const playerEhp = player.hp / (1 - player.damageReduction);
  const monsterEhp = calculateMonsterEHP(monster.baseEhp, monster.level);
  const monsterDps = calculateMonsterDPS(monster.baseDps, monster.level);

  const ttk = monsterEhp / player.dps;
  const tts = playerEhp / monsterDps;

  const isVictory = tts > ttk;

  // Simple reward scaling: base * (scaling^level)
  const rewardMultiplier = Math.pow(1.1, monster.level - 1);
  const earnedExp = isVictory ? monster.baseExp * rewardMultiplier : 0;
  const earnedGold = isVictory ? monster.baseGold * rewardMultiplier : 0;

  return {
    isVictory,
    ttk,
    tts,
    earnedExp,
    earnedGold,
  };
};

/**
 * Calculates EXP required for the next level.
 * Formula: 100 * (1.2 ^ (level - 1))
 */
export const calculateExpToNextLevel = (level: number): number => {
  return Math.floor(100 * Math.pow(1.2, level - 1));
};

/**
 * Calculates player stats based on level.
 */
export const calculatePlayerStats = (level: number): PlayerStats => {
  return {
    dps: 100 + (level - 1) * 15,
    hp: 500 + (level - 1) * 50,
    damageReduction: Math.min(0.8, 0.1 + (level - 1) * 0.01), // Max 80% DR
  };
};

/**
 * Formats large numbers into human-readable strings (e.g., 1.5K, 2.3M).
 */
export const formatLargeNumber = (value: number): string => {
  const NUMBER_SUFFIXES = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];
  if (value < 1000) return Math.floor(value).toString();

  const exponent = Math.floor(Math.log10(value));
  const suffixIndex = Math.floor(exponent / 3);

  if (suffixIndex >= NUMBER_SUFFIXES.length) {
    return value.toExponential(2);
  }

  const shortValue = (value / Math.pow(10, suffixIndex * 3)).toFixed(2);
  return `${shortValue}${NUMBER_SUFFIXES[suffixIndex]}`;
};
