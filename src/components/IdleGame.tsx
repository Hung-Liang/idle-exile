
import React, { useState, useEffect, useRef } from 'react';
import { 
  formatLargeNumber, 
  calculateExpToNextLevel,
  calculatePlayerStats,
  getMonsterStats
} from '../utils/combat';
import { generateRareItem, calculateItemStats } from '../utils/loot';
import type { Item, ItemSlot } from '../utils/loot';

const IdleGame: React.FC = () => {
  // Player Base State
  const [playerLevel, setPlayerLevel] = useState(1);
  const [currentExp, setCurrentExp] = useState(0);
  const [gold, setGold] = useState(0);
  const [currentZoneLevel, setCurrentZoneLevel] = useState(1);
  
  // Real-time Combat State
  const [currentPlayerHP, setCurrentPlayerHP] = useState(500);
  const [currentEnemyHP, setCurrentEnemyHP] = useState(50);
  const [currentEnemyMaxHP, setCurrentEnemyMaxHP] = useState(50);
  
  // Inventory & Equipment State
  const [inventory, setInventory] = useState<Item[]>([]);
  const [equipment, setEquipment] = useState<Record<ItemSlot, Item | null>>({
    WEAPON: null,
    ARMOR: null,
    ACCESSORY: null
  });

  // Display State
  const [lastLog, setLastLog] = useState<string>("Game Started");

  // Derived Stats
  const baseStats = calculatePlayerStats(playerLevel);
  const gearStats = calculateItemStats(Object.values(equipment));
  
  const finalStats = {
    dps: baseStats.dps + gearStats.dps,
    hp: baseStats.hp + gearStats.hp,
    damageReduction: Math.min(0.9, baseStats.damageReduction + gearStats.dr)
  };

  const expToNextLevel = calculateExpToNextLevel(playerLevel);

  const baseMonsterConfig = {
    baseEhp: 50,
    baseDps: 10,
    baseExp: 10,
    baseGold: 5,
  };

  const stateRef = useRef({ 
    playerLevel, currentExp, gold, currentZoneLevel, 
    finalStats, currentPlayerHP, currentEnemyHP, currentEnemyMaxHP 
  });
  stateRef.current = { 
    playerLevel, currentExp, gold, currentZoneLevel, 
    finalStats, currentPlayerHP, currentEnemyHP, currentEnemyMaxHP 
  };

  const spawnMonster = (level: number) => {
    const stats = getMonsterStats(baseMonsterConfig, level);
    setCurrentEnemyHP(stats.baseEhp);
    setCurrentEnemyMaxHP(stats.baseEhp);
    setLastLog(`Fighting Lv ${level} Monster`);
  };

  useEffect(() => {
    spawnMonster(currentZoneLevel);
    const tickInterval = setInterval(() => {
      const s = stateRef.current;
      const monster = getMonsterStats(baseMonsterConfig, s.currentZoneLevel);
      
      const playerDmg = s.finalStats.dps;
      const monsterDmg = monster.baseDps * (1 - s.finalStats.damageReduction);

      const nextEnemyHP = Math.max(0, s.currentEnemyHP - playerDmg);
      const nextPlayerHP = Math.max(0, s.currentPlayerHP - monsterDmg);

      if (nextEnemyHP <= 0) {
        const rewardMultiplier = Math.pow(1.1, s.currentZoneLevel - 1);
        const earnedExp = monster.baseExp * rewardMultiplier;
        const earnedGold = monster.baseGold * rewardMultiplier;

        let newExp = s.currentExp + earnedExp;
        let newLevel = s.playerLevel;
        let nextExpReq = calculateExpToNextLevel(newLevel);

        while (newExp >= nextExpReq) {
          newExp -= nextExpReq;
          newLevel++;
          nextExpReq = calculateExpToNextLevel(newLevel);
        }

        setPlayerLevel(newLevel);
        setCurrentExp(newExp);
        setGold(s.gold + earnedGold);
        const nextZone = s.currentZoneLevel + 1;
        setCurrentZoneLevel(nextZone);
        
        const updatedStats = calculatePlayerStats(newLevel);
        const updatedGear = calculateItemStats(Object.values(equipment));
        setCurrentPlayerHP(updatedStats.hp + updatedGear.hp);
        spawnMonster(nextZone);

      } else if (nextPlayerHP <= 0) {
        const prevZone = Math.max(1, s.currentZoneLevel - 1);
        setCurrentZoneLevel(prevZone);
        setCurrentPlayerHP(s.finalStats.hp);
        spawnMonster(prevZone);
        setLastLog(`Died! Retreating to Lv ${prevZone}`);
      } else {
        setCurrentEnemyHP(nextEnemyHP);
        setCurrentPlayerHP(nextPlayerHP);
      }
    }, 1000);

    return () => clearInterval(tickInterval);
  }, [equipment, playerLevel]);

  const handleRollItem = () => {
    if (gold >= 100) {
      setGold(prev => prev - 100);
      const newItem = generateRareItem();
      setInventory(prev => [newItem, ...prev]);
    }
  };

  const handleEquip = (item: Item) => {
    const currentEquipped = equipment[item.slot];
    setEquipment(prev => ({ ...prev, [item.slot]: item }));
    setInventory(prev => {
      const filtered = prev.filter(i => i.id !== item.id);
      return currentEquipped ? [currentEquipped, ...filtered] : filtered;
    });
    // Adjust HP
    const newBase = calculatePlayerStats(playerLevel);
    const newGearStats = calculateItemStats(Object.values({ ...equipment, [item.slot]: item }));
    setCurrentPlayerHP(prev => Math.min(prev, newBase.hp + newGearStats.hp));
  };

  const handleUnequip = (slot: ItemSlot) => {
    const item = equipment[slot];
    if (!item) return;
    setEquipment(prev => ({ ...prev, [slot]: null }));
    setInventory(prev => [item, ...prev]);
    // Adjust HP
    const newBase = calculatePlayerStats(playerLevel);
    const newGearStats = calculateItemStats(Object.values({ ...equipment, [slot]: null }));
    setCurrentPlayerHP(prev => Math.min(prev, newBase.hp + newGearStats.hp));
  };

  const handleSell = (itemId: string) => {
    setInventory(prev => prev.filter(i => i.id !== itemId));
    setGold(prev => prev + 50);
  };

  const renderAffixes = (item: Item) => (
    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
      {[...item.prefixes, ...item.suffixes].map(a => (
        <div key={a.id}>• {a.name}: +{a.value}{a.statKey === 'dr' ? '%' : ''} {a.statKey.toUpperCase()} (T{a.tier})</div>
      ))}
    </div>
  );

  const ProgressBar = ({ value, max, color, label }: { value: number, max: number, color: string, label: string }) => (
    <div style={{ width: '100%', marginBottom: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '2px' }}>
        <span>{label}</span>
        <span>{formatLargeNumber(value)} / {formatLargeNumber(max)}</span>
      </div>
      <div style={{ width: '100%', height: '12px', backgroundColor: '#0f172a', borderRadius: '6px', border: '1px solid #334155' }}>
        <div style={{ 
          width: `${Math.min(100, (value / max) * 100)}%`, 
          height: '100%', 
          backgroundColor: color, 
          borderRadius: '6px',
          transition: 'width 0.3s'
        }} />
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '20px', color: '#e2e8f0' }}>
      {/* Combat View */}
      <section style={{ backgroundColor: '#1e293b', padding: '20px', borderRadius: '12px', border: '1px solid #334155', marginBottom: '20px' }}>
        <div style={{ textAlign: 'center', marginBottom: '15px', fontWeight: 'bold' }}>{lastLog}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
          <ProgressBar value={currentPlayerHP} max={finalStats.hp} color="#10b981" label="Player HP" />
          <ProgressBar value={currentEnemyHP} max={currentEnemyMaxHP} color="#ef4444" label="Monster HP" />
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 280px', gap: '20px' }}>
        {/* Character Panel */}
        <aside style={{ backgroundColor: '#1e293b', padding: '15px', borderRadius: '8px' }}>
          <h3 style={{ borderBottom: '1px solid #334155' }}>Character Stats</h3>
          <p>Level: <span style={{ color: '#fbbf24' }}>{playerLevel}</span></p>
          <p>Gold: <span style={{ color: '#fcd34d' }}>{formatLargeNumber(gold)}</span></p>
          <div style={{ lineHeight: '1.8' }}>
            <div>DPS: {formatLargeNumber(finalStats.dps)}</div>
            <div>Max HP: {formatLargeNumber(finalStats.hp)}</div>
            <div>Damage Reduction: {(finalStats.damageReduction * 100).toFixed(0)}%</div>
          </div>
          <div style={{ marginTop: '20px' }}>
            <ProgressBar value={currentExp} max={expToNextLevel} color="#3b82f6" label="EXP" />
          </div>
        </aside>

        {/* Inventory & Equipment */}
        <main style={{ backgroundColor: '#1e293b', padding: '15px', borderRadius: '8px' }}>
          <h3>Equipment Slots</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px', marginBottom: '30px' }}>
            {(['WEAPON', 'ARMOR', 'ACCESSORY'] as ItemSlot[]).map(slot => {
              const item = equipment[slot];
              return (
                <div key={slot} style={{ border: '1px solid #334155', borderRadius: '6px', padding: '10px', minHeight: '100px', backgroundColor: '#0f172a', position: 'relative' }}>
                  <div style={{ color: '#64748b', fontSize: '0.7rem', textTransform: 'uppercase' }}>{slot}</div>
                  {item ? (
                    <div title="Click to Unequip" onClick={() => handleUnequip(slot)} style={{ cursor: 'pointer' }}>
                      <div style={{ color: '#fbbf24', fontSize: '0.85rem', fontWeight: 'bold' }}>{item.name}</div>
                      <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                        {calculateItemStats([item]).dps > 0 && <div>+{calculateItemStats([item]).dps} DPS</div>}
                        {calculateItemStats([item]).hp > 0 && <div>+{calculateItemStats([item]).hp} HP</div>}
                        {calculateItemStats([item]).dr > 0 && <div>+{(calculateItemStats([item]).dr * 100).toFixed(0)}% DR</div>}
                      </div>
                      <button style={{ marginTop: '10px', width: '100%', fontSize: '0.65rem', backgroundColor: '#334155', border: 'none', color: '#cbd5e1', borderRadius: '3px', padding: '2px' }}>Unequip</button>
                    </div>
                  ) : <div style={{ color: '#334155', marginTop: '10px' }}>Empty</div>}
                </div>
              );
            })}
          </div>

          <h3>Inventory ({inventory.length})</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', height: '350px', overflowY: 'auto', paddingRight: '5px' }}>
            {inventory.map(item => (
              <div key={item.id} className="item-card" style={{ border: '1px solid #334155', borderRadius: '6px', padding: '10px', backgroundColor: '#0f172a', transition: 'all 0.2s' }}>
                <div style={{ color: '#fbbf24', fontWeight: 'bold', fontSize: '0.8rem' }}>{item.name}</div>
                <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: '5px' }}>{item.slot}</div>
                {renderAffixes(item)}
                <div style={{ display: 'flex', gap: '5px', marginTop: '8px' }}>
                  <button onClick={() => handleEquip(item)} style={{ flex: 1, backgroundColor: '#059669', border: 'none', borderRadius: '4px', color: 'white', fontSize: '0.7rem', padding: '3px', cursor: 'pointer' }}>Equip</button>
                  <button onClick={() => handleSell(item.id)} style={{ flex: 1, backgroundColor: '#7f1d1d', border: 'none', borderRadius: '4px', color: 'white', fontSize: '0.7rem', padding: '3px', cursor: 'pointer' }}>Sell</button>
                </div>
              </div>
            ))}
          </div>
        </main>

        {/* Actions */}
        <aside style={{ backgroundColor: '#1e293b', padding: '15px', borderRadius: '8px' }}>
          <h3>Crafting</h3>
          <button onClick={handleRollItem} disabled={gold < 100} style={{ 
            width: '100%', padding: '15px', backgroundColor: gold >= 100 ? '#4f46e5' : '#334155', 
            color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '1rem'
          }}>
            Roll Rare (100g)
          </button>
          <div style={{ marginTop: '20px', fontSize: '0.8rem', color: '#94a3b8', borderTop: '1px solid #334155', paddingTop: '10px' }}>
            <strong>Game Info:</strong><br/>
            - Every kill grants EXP & Gold<br/>
            - Dying reduces Zone Level<br/>
            - Items give massive boosts!
          </div>
        </aside>
      </div>
    </div>
  );
};

export default IdleGame;
