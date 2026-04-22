
import React, { useState, useEffect } from 'react';
import { 
  evaluateCombat, 
  formatLargeNumber,
  getMonsterStats
} from '../utils/combat';
import type { 
  PlayerStats, 
  MonsterStats, 
  CombatResult 
} from '../utils/combat';

interface SimRow {
  level: number;
  result: CombatResult;
}

const CombatSim: React.FC = () => {
  const [rows, setRows] = useState<SimRow[]>([]);
  const [tick, setTick] = useState(0);

  const player: PlayerStats = {
    dps: 100,
    hp: 500,
    damageReduction: 0.1, // 10%
    attackSpeed: 1.5,
    hpRegeneration: 0.05
  };

  const baseMonster: Omit<MonsterStats, 'level'> = {
    baseEhp: 50,
    baseDps: 10,
    baseExp: 10,
    baseGold: 5,
    attackSpeed: 1.2
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const newRows: SimRow[] = [];
    for (let level = 1; level <= 50; level++) {
      const monster = getMonsterStats(baseMonster, level);
      const result = evaluateCombat(player, monster);
      newRows.push({ level, result });
    }
    setRows(newRows);
  }, [tick]);

  return (
    <div>
      <h1>Combat Simulation (Tick: {tick})</h1>
      <div style={{ marginBottom: '20px' }}>
        <strong>Player Stats:</strong> DPS: {player.dps} | HP: {player.hp} | DR: {player.damageReduction * 100}%
      </div>
      <table border={1} cellPadding={5} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th>Level</th>
            <th>Result</th>
            <th>TTK (s)</th>
            <th>TTS (s)</th>
            <th>EXP</th>
            <th>Gold</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.level} style={{ backgroundColor: row.result.isVictory ? 'transparent' : '#fee' }}>
              <td>{row.level}</td>
              <td>{row.result.isVictory ? 'WIN' : 'LOSS'}</td>
              <td>{row.result.ttk.toFixed(2)}</td>
              <td>{row.result.tts.toFixed(2)}</td>
              <td>{formatLargeNumber(row.result.earnedExp)}</td>
              <td>{formatLargeNumber(row.result.earnedGold)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default CombatSim;
