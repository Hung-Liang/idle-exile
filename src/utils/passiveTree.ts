
export type PassiveNodeType = 'MINOR' | 'NOTABLE';

export interface PassiveStat {
  key: 'dps' | 'hp' | 'dr';
  value: number;
}

export interface PassiveNode {
  id: string;
  name: string;
  type: PassiveNodeType;
  stats: PassiveStat[];
  connections: string[];
  x: number;
  y: number;
}

export const PASSIVE_TREE: Record<string, PassiveNode> = {
  // Warrior Start (Top Left)
  'start_warrior': {
    id: 'start_warrior',
    name: 'Path of the Warrior',
    type: 'NOTABLE',
    stats: [{ key: 'hp', value: 100 }, { key: 'dps', value: 20 }],
    connections: ['w_hp_1', 'w_dps_1'],
    x: 100, y: 100
  },
  'w_hp_1': {
    id: 'w_hp_1',
    name: 'Warrior Vitality',
    type: 'MINOR',
    stats: [{ key: 'hp', value: 50 }],
    connections: ['start_warrior', 'w_hp_2', 'bridge_w_m'],
    x: 250, y: 150
  },
  'w_hp_2': {
    id: 'w_hp_2',
    name: 'Unstoppable Bulk',
    type: 'NOTABLE',
    stats: [{ key: 'hp', value: 200 }],
    connections: ['w_hp_1'],
    x: 400, y: 100
  },
  'w_dps_1': {
    id: 'w_dps_1',
    name: 'Heavy Strikes',
    type: 'MINOR',
    stats: [{ key: 'dps', value: 30 }],
    connections: ['start_warrior', 'w_dps_2'],
    x: 150, y: 250
  },
  'w_dps_2': {
    id: 'w_dps_2',
    name: 'Berserker Rage',
    type: 'NOTABLE',
    stats: [{ key: 'dps', value: 80 }],
    connections: ['w_dps_1'],
    x: 100, y: 400
  },

  // Mage Start (Bottom Right)
  'start_mage': {
    id: 'start_mage',
    name: 'Path of the Mage',
    type: 'NOTABLE',
    stats: [{ key: 'dps', value: 50 }, { key: 'dr', value: 0.01 }],
    connections: ['m_dps_1', 'm_dr_1'],
    x: 800, y: 800
  },
  'm_dps_1': {
    id: 'm_dps_1',
    name: 'Arcane Power',
    type: 'MINOR',
    stats: [{ key: 'dps', value: 40 }],
    connections: ['start_mage', 'm_dps_2', 'bridge_w_m'],
    x: 650, y: 750
  },
  'm_dps_2': {
    id: 'm_dps_2',
    name: 'Glass Cannon',
    type: 'NOTABLE',
    stats: [{ key: 'dps', value: 120 }, { key: 'hp', value: -50 }],
    connections: ['m_dps_1'],
    x: 500, y: 800
  },
  'm_dr_1': {
    id: 'm_dr_1',
    name: 'Mana Shield',
    type: 'MINOR',
    stats: [{ key: 'dr', value: 0.02 }],
    connections: ['start_mage', 'm_dr_2'],
    x: 750, y: 650
  },
  'm_dr_2': {
    id: 'm_dr_2',
    name: 'Ethereal Veil',
    type: 'NOTABLE',
    stats: [{ key: 'dr', value: 0.05 }],
    connections: ['m_dr_1'],
    x: 850, y: 500
  },

  // Ranger Start (Top Right)
  'start_ranger': {
    id: 'start_ranger',
    name: 'Path of the Ranger',
    type: 'NOTABLE',
    stats: [{ key: 'dps', value: 30 }, { key: 'hp', value: 50 }],
    connections: ['r_spd_1', 'r_crit_1'],
    x: 800, y: 100
  },
  'r_spd_1': {
    id: 'r_spd_1',
    name: 'Quickfoot',
    type: 'MINOR',
    stats: [{ key: 'dps', value: 25 }],
    connections: ['start_ranger', 'r_spd_2'],
    x: 650, y: 150
  },
  'r_spd_2': {
    id: 'r_spd_2',
    name: 'Windrunner',
    type: 'NOTABLE',
    stats: [{ key: 'dps', value: 60 }],
    connections: ['r_spd_1', 'bridge_r_w'],
    x: 500, y: 100
  },
  'r_crit_1': {
    id: 'r_crit_1',
    name: 'Eagle Eye',
    type: 'MINOR',
    stats: [{ key: 'dps', value: 35 }],
    connections: ['start_ranger', 'r_crit_2'],
    x: 850, y: 250
  },
  'r_crit_2': {
    id: 'r_crit_2',
    name: 'Deadly Precision',
    type: 'NOTABLE',
    stats: [{ key: 'dps', value: 90 }],
    connections: ['r_crit_1'],
    x: 800, y: 400
  },

  // Bridges
  'bridge_w_m': {
    id: 'bridge_w_m',
    name: 'Spellblade Bridge',
    type: 'MINOR',
    stats: [{ key: 'dps', value: 20 }, { key: 'hp', value: 30 }],
    connections: ['w_hp_1', 'm_dps_1'],
    x: 450, y: 450
  },
  'bridge_r_w': {
    id: 'bridge_r_w',
    name: 'Skirmisher Bridge',
    type: 'MINOR',
    stats: [{ key: 'dps', value: 40 }],
    connections: ['r_spd_2', 'w_hp_2'],
    x: 450, y: 100
  }
};

export const START_NODES = ['start_warrior', 'start_mage', 'start_ranger'];

export const calculatePassiveStats = (allocatedNodes: string[]) => {
  const totals = { dps: 0, hp: 0, dr: 0 };
  allocatedNodes.forEach(nodeId => {
    const node = PASSIVE_TREE[nodeId];
    if (node) {
      node.stats.forEach(stat => {
        totals[stat.key] += stat.value;
      });
    }
  });
  return totals;
};

export const isNodeAllocatable = (nodeId: string, allocatedNodes: string[], unspentPoints: number) => {
  if (allocatedNodes.includes(nodeId)) return false;
  if (unspentPoints <= 0) return false;
  
  // If nothing is allocated, any start node is allocatable
  if (allocatedNodes.length === 0) {
    return START_NODES.includes(nodeId);
  }
  
  const node = PASSIVE_TREE[nodeId];
  return node.connections.some(connId => allocatedNodes.includes(connId));
};
