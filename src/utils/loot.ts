
/**
 * Loot and Affix System for Idle Exile.
 * Adheres to the rules defined in Chapter 7 and Chapter 6.
 */

export type AffixType = 'PREFIX' | 'SUFFIX';
export type ItemSlot = 'WEAPON' | 'ARMOR' | 'ACCESSORY';
export type ItemRarity = 'NORMAL' | 'MAGIC' | 'RARE' | 'UNIQUE';

export interface Affix {
  id: string;
  name: string;
  type: AffixType;
  group: string;
  statKey: string;
  value: number;
  weight: number;
  tier: number;
}

export interface Item {
  id: string;
  name: string;
  rarity: ItemRarity;
  slot: ItemSlot;
  prefixes: Affix[];
  suffixes: Affix[];
  itemLevel: number;
}

export const AFFIX_DATABASE: Affix[] = [
  // Prefixes
  { id: 'p_life_t2', name: 'Sturdy', type: 'PREFIX', group: 'life', statKey: 'hp', value: 50, weight: 100, tier: 2 },
  { id: 'p_life_t1', name: 'Eternal', type: 'PREFIX', group: 'life', statKey: 'hp', value: 120, weight: 30, tier: 1 },
  { id: 'p_phys_t2', name: 'Heavy', type: 'PREFIX', group: 'phys', statKey: 'dps', value: 20, weight: 100, tier: 2 },
  { id: 'p_phys_t1', name: 'Godly', type: 'PREFIX', group: 'phys', statKey: 'dps', value: 50, weight: 20, tier: 1 },
  { id: 'p_fire_dmg_t1', name: 'Molten', type: 'PREFIX', group: 'fire_dmg', statKey: 'dps', value: 40, weight: 50, tier: 1 },
  
  // Suffixes
  { id: 's_fire_res_t2', name: 'of Heat', type: 'SUFFIX', group: 'fire_res', statKey: 'dr', value: 0.05, weight: 100, tier: 2 },
  { id: 's_fire_res_t1', name: 'of the Sun', type: 'SUFFIX', group: 'fire_res', statKey: 'dr', value: 0.12, weight: 30, tier: 1 },
  { id: 's_atk_spd_t2', name: 'of Haste', type: 'SUFFIX', group: 'atk_spd', statKey: 'dps', value: 15, weight: 100, tier: 2 },
  { id: 's_atk_spd_t1', name: 'of Celerity', type: 'SUFFIX', group: 'atk_spd', statKey: 'dps', value: 35, weight: 20, tier: 1 },
  { id: 's_all_res_t1', name: 'of Protection', type: 'SUFFIX', group: 'all_res', statKey: 'dr', value: 0.08, weight: 15, tier: 1 },
];

export const UNIQUE_AFFIX_GROUPS = Array.from(new Set(AFFIX_DATABASE.map(a => a.group)));

const getRandomByWeight = (affixes: Affix[]): Affix => {
  const totalWeight = affixes.reduce((sum, a) => sum + a.weight, 0);
  let random = Math.random() * totalWeight;
  for (const affix of affixes) {
    if (random < affix.weight) return affix;
    random -= affix.weight;
  }
  return affixes[0];
};

/**
 * Generates an item based on rarity and level.
 * MAGIC: 1-2 affixes.
 * RARE: 4-6 affixes.
 */
export const generateItem = (rarity: ItemRarity, itemLevel: number): Item => {
  const slots: ItemSlot[] = ['WEAPON', 'ARMOR', 'ACCESSORY'];
  const slot = slots[Math.floor(Math.random() * slots.length)];
  
  let numAffixes = 0;
  if (rarity === 'MAGIC') numAffixes = Math.floor(Math.random() * 2) + 1; // 1 to 2
  if (rarity === 'RARE') numAffixes = Math.floor(Math.random() * 3) + 4; // 4 to 6

  let numPrefixes = 0;
  let numSuffixes = 0;

  const prefixes: Affix[] = [];
  const suffixes: Affix[] = [];
  const usedGroups = new Set<string>();

  for (let i = 0; i < numAffixes; i++) {
    const canTakePrefix = numPrefixes < 3;
    const canTakeSuffix = numSuffixes < 3;
    if (!canTakePrefix && !canTakeSuffix) break;

    const pool = AFFIX_DATABASE.filter(a => 
      !usedGroups.has(a.group) && 
      ((a.type === 'PREFIX' && canTakePrefix) || (a.type === 'SUFFIX' && canTakeSuffix))
    );

    if (pool.length === 0) break;

    const rolled = getRandomByWeight(pool);
    usedGroups.add(rolled.group);

    if (rolled.type === 'PREFIX') {
      // Scale value by item level (simple linear scaling for now)
      const scaledValue = rolled.value * (1 + (itemLevel - 1) * 0.1);
      prefixes.push({ ...rolled, value: Number(scaledValue.toFixed(2)) });
      numPrefixes++;
    } else {
      const scaledValue = rolled.value * (1 + (itemLevel - 1) * 0.1);
      suffixes.push({ ...rolled, value: Number(scaledValue.toFixed(2)) });
      numSuffixes++;
    }
  }

  const topAffix = [...prefixes, ...suffixes].sort((a, b) => a.tier - b.tier)[0];
  const itemName = `${topAffix?.name || 'Simple'} ${slot}`;

  return {
    id: Math.random().toString(36).substr(2, 9),
    name: itemName,
    rarity,
    slot,
    prefixes,
    suffixes,
    itemLevel,
  };
};

// Keep for backward compatibility or refactor calls
export const generateRareItem = (): Item => generateItem('RARE', 1);

export const calculateItemStats = (items: (Item | null)[]) => {
  const totals = { dps: 0, hp: 0, dr: 0 };
  items.forEach(item => {
    if (!item) return;
    [...item.prefixes, ...item.suffixes].forEach(affix => {
      if (affix.statKey === 'dps') totals.dps += affix.value;
      if (affix.statKey === 'hp') totals.hp += affix.value;
      if (affix.statKey === 'dr') totals.dr += affix.value;
    });
  });
  return totals;
};
