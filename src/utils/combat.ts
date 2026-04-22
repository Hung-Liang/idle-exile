
/**
 * Core Combat Logic and Scaling Curves for Idle Exile.
 */

export interface PlayerStats {
  dps: number;
  hp: number;
  damageReduction: number;
  attackSpeed: number;
  hpRegeneration: number; // % of Max HP per second
}

export interface MonsterStats {
  baseEhp: number;
  baseDps: number;
  baseExp: number;
  baseGold: number;
  attackSpeed: number;
}

export const calculateExpToNextLevel = (level: number): number => {
  return Math.floor(100 * Math.pow(1.2, level - 1));
};

export const calculatePlayerStats = (level: number): PlayerStats => {
  return {
    dps: 10 + (level - 1) * 2,
    hp: 100 + (level - 1) * 20,
    damageReduction: 0,
    attackSpeed: 1.5,
    hpRegeneration: 0.05 // 5% per second
  };
};

export const getMonsterStats = (config: any, level: number): MonsterStats => {
  const scale = Math.pow(1.15, level - 1);
  return {
    baseEhp: Math.floor(config.baseEhp * scale),
    baseDps: Math.floor(config.baseDps * scale),
    baseExp: Math.floor(config.baseExp * scale),
    baseGold: Math.floor(config.baseGold * scale),
    attackSpeed: 1.2
  };
};

export interface CombatResult {
  isVictory: boolean;
  ttk: number;
  tts: number;
  earnedExp: number;
  earnedGold: number;
}

export function evaluateCombat(player: PlayerStats, monster: MonsterStats): CombatResult {
  const ttk = monster.baseEhp / player.dps;
  
  // Account for regeneration: net DPS taken
  const monsterDps = monster.baseDps * (1 - player.damageReduction);
  const playerRegen = player.hp * player.hpRegeneration;
  const netMonsterDps = Math.max(0, monsterDps - playerRegen);
  
  const tts = netMonsterDps <= 0 ? Infinity : player.hp / netMonsterDps;
  const isVictory = ttk <= tts;

  return {
    isVictory,
    ttk,
    tts,
    earnedExp: isVictory ? monster.baseExp : 0,
    earnedGold: isVictory ? monster.baseGold : 0
  };
}

export const formatLargeNumber = (value: number): string => {
  if (value < 1000) return value.toFixed(1);
  const suffixes = ['', 'K', 'M', 'B', 'T'];
  const suffixIndex = Math.floor(Math.log10(value) / 3);
  const shortValue = (value / Math.pow(10, suffixIndex * 3)).toFixed(2);
  return `${shortValue}${suffixes[suffixIndex]}`;
};

