
/**
 * Atlas and Mapping System for Idle Exile.
 * Adheres to the rules defined in Chapter 12 and Mechanic A.
 */

export interface ZoneModifier {
  stat: 'enemy_hp' | 'enemy_dps' | 'loot_quantity' | 'exp_multiplier' | 'gold_multiplier';
  value: number;
  text: string;
}

export interface MapInstance {
  modifiers: ZoneModifier[];
  remainingKills: number;
}

export const MODIFIER_POOL: ZoneModifier[] = [
  { stat: 'enemy_hp', value: 0.5, text: 'Enemy HP +50%' },
  { stat: 'enemy_hp', value: 1.0, text: 'Enemy HP +100%' },
  { stat: 'enemy_dps', value: 0.3, text: 'Enemy DPS +30%' },
  { stat: 'enemy_dps', value: 0.6, text: 'Enemy DPS +60%' },
  { stat: 'loot_quantity', value: 1.0, text: 'Loot Drops +100%' },
  { stat: 'loot_quantity', value: 2.0, text: 'Loot Drops +200%' },
  { stat: 'exp_multiplier', value: 0.5, text: 'EXP +50%' },
  { stat: 'exp_multiplier', value: 1.0, text: 'EXP +100%' },
  { stat: 'gold_multiplier', value: 0.5, text: 'Gold +50%' },
  { stat: 'gold_multiplier', value: 1.2, text: 'Gold +120%' },
];

export const generateZoneModifiers = (): ZoneModifier[] => {
  const count = Math.floor(Math.random() * 3) + 2; // 2 to 4
  const shuffled = [...MODIFIER_POOL].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
};

export const calculateMapMultipliers = (modifiers: ZoneModifier[]) => {
  const totals = {
    enemyHP: 1,
    enemyDPS: 1,
    lootQty: 1,
    expMult: 1,
    goldMult: 1
  };

  modifiers.forEach(mod => {
    if (mod.stat === 'enemy_hp') totals.enemyHP += mod.value;
    if (mod.stat === 'enemy_dps') totals.enemyDPS += mod.value;
    if (mod.stat === 'loot_quantity') totals.lootQty += mod.value;
    if (mod.stat === 'exp_multiplier') totals.expMult += mod.value;
    if (mod.stat === 'gold_multiplier') totals.goldMult += mod.value;
  });

  return totals;
};
