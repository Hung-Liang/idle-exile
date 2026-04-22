
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  formatLargeNumber, 
  calculateExpToNextLevel,
  calculatePlayerStats,
  getMonsterStats
} from '../utils/combat';
import { generateItem, calculateItemStats } from '../utils/loot';
import type { Item, ItemSlot } from '../utils/loot';
import { 
  PASSIVE_TREE, 
  calculatePassiveStats, 
  isNodeAllocatable 
} from '../utils/passiveTree';

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

interface PassiveTreeNodeProps {
  node: any;
  isAllocated: boolean;
  isAvailable: boolean;
  onAllocate: (id: string) => void;
}

const PassiveTreeNode: React.FC<PassiveTreeNodeProps> = ({ node, isAllocated, isAvailable, onAllocate }) => {
  const [isHovered, setIsHovered] = useState(false);

  if (!node) return null;

  const nodeSize = node.type === 'NOTABLE' ? 40 : 24;
  const color = isAllocated ? '#fbbf24' : isAvailable ? '#3b82f6' : '#334155';

  return (
    <div 
      style={{
        position: 'absolute',
        left: node.x,
        top: node.y,
        transform: 'translate(-50%, -50%)',
        zIndex: 10
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onAllocate(node.id);
        }}
        disabled={!isAvailable || isAllocated}
        style={{
          width: nodeSize,
          height: nodeSize,
          borderRadius: '50%',
          border: `2px solid ${color}`,
          backgroundColor: isAllocated ? color : '#0f172a',
          cursor: isAvailable && !isAllocated ? 'pointer' : 'default',
          boxShadow: isAvailable && !isAllocated ? `0 0 15px ${color}` : 'none',
          transition: 'all 0.2s',
          padding: 0
        }}
      />
      
      {isHovered && (
        <div style={{
          position: 'absolute',
          bottom: '120%',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: '#1e293b',
          border: '2px solid #334155',
          borderRadius: '6px',
          padding: '12px',
          width: '180px',
          pointerEvents: 'none',
          zIndex: 100,
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
        }}>
          <div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#f8fafc', marginBottom: '6px' }}>{node.name}</div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
            {node.stats?.map((s: any, idx: number) => (
              <div key={idx} style={{ marginBottom: '2px' }}>
                +{s.value}{s.key === 'dr' ? '%' : ''} {s.key.toUpperCase()}
              </div>
            ))}
          </div>
          <div style={{ 
            fontSize: '0.65rem', 
            marginTop: '8px', 
            fontWeight: 'bold',
            color: isAllocated ? '#fbbf24' : isAvailable ? '#3b82f6' : '#64748b' 
          }}>
            {isAllocated ? 'ALLOCATED' : isAvailable ? 'AVAILABLE (Click)' : 'LOCKED'}
          </div>
        </div>
      )}
    </div>
  );
};

const IdleGame: React.FC = () => {
  // Player Base State
  const [playerLevel, setPlayerLevel] = useState(1);
  const [currentExp, setCurrentExp] = useState(0);
  const [gold, setGold] = useState(0);
  const [craftingScrap, setCraftingScrap] = useState(0);
  const [currentZoneLevel, setCurrentZoneLevel] = useState(1);
  
  // Progression State
  const [allocatedPassiveNodes, setAllocatedPassiveNodes] = useState<string[]>([]);

  // Real-time Combat State
  const [currentPlayerHP, setCurrentPlayerHP] = useState(500);
  const [currentEnemyHP, setCurrentEnemyHP] = useState(50);
  const [currentEnemyMaxHP, setCurrentEnemyMaxHP] = useState(50);
  const [isRespawning, setIsRespawning] = useState(false);
  
  // Inventory & Equipment State
  const [inventory, setInventory] = useState<Item[]>([]);
  const [equipment, setEquipment] = useState<Record<ItemSlot, Item | null>>({
    WEAPON: null,
    ARMOR: null,
    ACCESSORY: null
  });

  // Display State
  const [lastLog, setLastLog] = useState<string>("Game Started");
  const [currentTab, setCurrentTab] = useState<'INVENTORY' | 'PASSIVES'>('INVENTORY');

  // Panning State for Passive Tree (Initial offset to center view)
  const [panOffset, setPanOffset] = useState({ x: 50, y: 50 });
  const [isDragging, setIsDragging] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });

  // Derived Stats
  const baseStats = useMemo(() => calculatePlayerStats(playerLevel), [playerLevel]);
  const gearStats = useMemo(() => calculateItemStats(Object.values(equipment)), [equipment]);
  const passiveStats = useMemo(() => calculatePassiveStats(allocatedPassiveNodes), [allocatedPassiveNodes]);
  
  const finalStats = useMemo(() => ({
    dps: baseStats.dps + gearStats.dps + passiveStats.dps,
    hp: baseStats.hp + gearStats.hp + passiveStats.hp,
    damageReduction: Math.min(0.9, baseStats.damageReduction + gearStats.dr + passiveStats.dr)
  }), [baseStats, gearStats, passiveStats]);

  const unspentPassivePoints = (playerLevel - 1) - allocatedPassiveNodes.length;

  const expToNextLevel = calculateExpToNextLevel(playerLevel);

  const baseMonsterConfig = useMemo(() => ({
    baseEhp: 50,
    baseDps: 10,
    baseExp: 10,
    baseGold: 5,
  }), []);

  const stateRef = useRef({ 
    playerLevel, currentExp, gold, currentZoneLevel, 
    finalStats, currentPlayerHP, currentEnemyHP, currentEnemyMaxHP,
    isRespawning, craftingScrap
  });

  // Sync ref with current state in effect instead of render
  useEffect(() => {
    stateRef.current = { 
      playerLevel, currentExp, gold, currentZoneLevel, 
      finalStats, currentPlayerHP, currentEnemyHP, currentEnemyMaxHP,
      isRespawning, craftingScrap
    };
  }, [playerLevel, currentExp, gold, currentZoneLevel, finalStats, currentPlayerHP, currentEnemyHP, currentEnemyMaxHP, isRespawning, craftingScrap]);

  const processLootDrop = (rarity: 'MAGIC' | 'RARE', itemLevel: number) => {
    const item = generateItem(rarity, itemLevel);
    if (item.rarity === 'MAGIC') {
      const scrapGained = item.itemLevel * 2;
      setCraftingScrap(prev => prev + scrapGained);
      setLastLog(`Auto-salvaged Magic ${item.slot} for ${scrapGained} Scrap.`);
    } else {
      setInventory(prev => [item, ...prev]);
      setLastLog(`Dropped a Rare ${item.slot}!`);
    }
  };

  const spawnMonster = (level: number) => {
    setIsRespawning(false);
    const stats = getMonsterStats(baseMonsterConfig, level);
    setCurrentEnemyHP(stats.baseEhp);
    setCurrentEnemyMaxHP(stats.baseEhp);
    setLastLog(`Fighting Lv ${level} Monster`);
  };

  useEffect(() => {
    spawnMonster(currentZoneLevel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const tickInterval = setInterval(() => {
      const s = stateRef.current;
      if (s.isRespawning) return;

      const monster = getMonsterStats(baseMonsterConfig, s.currentZoneLevel);
      
      const playerDmg = s.finalStats.dps;
      const monsterDmg = monster.baseDps * (1 - s.finalStats.damageReduction);

      const nextEnemyHP = Math.max(0, s.currentEnemyHP - playerDmg);
      const nextPlayerHP = Math.max(0, s.currentPlayerHP - monsterDmg);

      if (nextEnemyHP <= 0) {
        // Monster Victory Logic
        const rewardMultiplier = Math.pow(1.1, s.currentZoneLevel - 1);
        const earnedExp = monster.baseExp * rewardMultiplier;
        const earnedGold = monster.baseGold * rewardMultiplier;

        // Level up handling
        let newExp = s.currentExp + earnedExp;
        let newLevel = s.playerLevel;
        let nextExpReq = calculateExpToNextLevel(newLevel);

        while (newExp >= nextExpReq) {
          newExp -= nextExpReq;
          newLevel++;
          nextExpReq = calculateExpToNextLevel(newLevel);
        }

        if (newLevel !== s.playerLevel) {
          const updatedStats = calculatePlayerStats(newLevel);
          const updatedGear = calculateItemStats(Object.values(equipment));
          const updatedPassives = calculatePassiveStats(allocatedPassiveNodes);
          setCurrentPlayerHP(updatedStats.hp + updatedGear.hp + updatedPassives.hp);
          setPlayerLevel(newLevel);
        }
        
        setCurrentExp(newExp);
        setGold(s.gold + earnedGold);

        // Loot Logic
        if (Math.random() < 0.3) {
          const rarity = Math.random() < 0.7 ? 'MAGIC' : 'RARE';
          processLootDrop(rarity, s.currentZoneLevel);
        }

        // Pacing & Respawn
        setIsRespawning(true);
        setCurrentEnemyHP(0);
        setTimeout(() => {
          const nextZone = stateRef.current.currentZoneLevel + 1;
          setCurrentZoneLevel(nextZone);
          spawnMonster(nextZone);
        }, 1000);

      } else if (nextPlayerHP <= 0) {
        // Player Death Logic
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipment, playerLevel, allocatedPassiveNodes]);

  const handleRollItem = () => {
    if (gold >= 100) {
      setGold(prev => prev - 100);
      processLootDrop('RARE', playerLevel);
    }
  };

  const handleEquip = (item: Item) => {
    const currentEquipped = equipment[item.slot];
    setEquipment(prev => ({ ...prev, [item.slot]: item }));
    setInventory(prev => {
      const filtered = prev.filter(i => i.id !== item.id);
      return currentEquipped ? [currentEquipped, ...filtered] : filtered;
    });
    const newBase = calculatePlayerStats(playerLevel);
    const newGearStats = calculateItemStats(Object.values({ ...equipment, [item.slot]: item }));
    setCurrentPlayerHP(prev => Math.min(prev, newBase.hp + newGearStats.hp));
  };

  const handleUnequip = (slot: ItemSlot) => {
    const item = equipment[slot];
    if (!item) return;
    setEquipment(prev => ({ ...prev, [slot]: null }));
    setInventory(prev => [item, ...prev]);
    const newBase = calculatePlayerStats(playerLevel);
    const newGearStats = calculateItemStats(Object.values({ ...equipment, [slot]: null }));
    setCurrentPlayerHP(prev => Math.min(prev, newBase.hp + newGearStats.hp));
  };

  const handleSell = (itemId: string) => {
    setInventory(prev => prev.filter(i => i.id !== itemId));
    setGold(prev => prev + 50);
  };

  const handleSalvage = (item: Item) => {
    setInventory(prev => prev.filter(i => i.id !== item.id));
    const scrapGained = item.itemLevel * (item.rarity === 'RARE' ? 5 : 2);
    setCraftingScrap(prev => prev + scrapGained);
  };

  const handleAllocatePassive = (nodeId: string) => {
    if (isNodeAllocatable(nodeId, allocatedPassiveNodes, unspentPassivePoints)) {
      setAllocatedPassiveNodes(prev => [...prev, nodeId]);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setLastMousePos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - lastMousePos.x;
    const dy = e.clientY - lastMousePos.y;
    setPanOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    setLastMousePos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => setIsDragging(false);

  const renderAffixes = (item: Item) => (
    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
      {[...item.prefixes, ...item.suffixes].map(a => (
        <div key={a.id}>• {a.name}: +{a.value}{a.statKey === 'dr' ? '%' : ''} {a.statKey.toUpperCase()} (T{a.tier})</div>
      ))}
    </div>
  );

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '20px', color: '#e2e8f0' }}>
      {/* Combat View */}
      <section style={{ backgroundColor: '#1e293b', padding: '20px', borderRadius: '12px', border: '1px solid #334155', marginBottom: '20px' }}>
        <div style={{ textAlign: 'center', marginBottom: '15px', fontWeight: 'bold' }}>{isRespawning ? "Respawning..." : lastLog}</div>
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
          <p>Scrap: <span style={{ color: '#60a5fa' }}>{formatLargeNumber(craftingScrap)}</span></p>
          <div style={{ lineHeight: '1.8' }}>
            <div>DPS: {formatLargeNumber(finalStats.dps)}</div>
            <div>Max HP: {formatLargeNumber(finalStats.hp)}</div>
            <div>Damage Reduction: {(finalStats.damageReduction * 100).toFixed(0)}%</div>
          </div>
          <div style={{ marginTop: '20px' }}>
            <ProgressBar value={currentExp} max={expToNextLevel} color="#3b82f6" label="EXP" />
          </div>
        </aside>

        {/* Main Content Area with Tabs */}
        <main style={{ backgroundColor: '#1e293b', padding: '15px', borderRadius: '8px' }}>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '1px solid #334155', paddingBottom: '10px' }}>
            <button 
              onClick={() => setCurrentTab('INVENTORY')}
              style={{ 
                padding: '8px 16px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                backgroundColor: currentTab === 'INVENTORY' ? '#3b82f6' : '#334155', color: 'white'
              }}
            >
              Inventory
            </button>
            <button 
              onClick={() => setCurrentTab('PASSIVES')}
              style={{ 
                padding: '8px 16px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                backgroundColor: currentTab === 'PASSIVES' ? '#3b82f6' : '#334155', color: 'white'
              }}
            >
              Passive Tree ({unspentPassivePoints})
            </button>
          </div>

          {currentTab === 'INVENTORY' ? (
            <>
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
                    <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: '5px' }}>{item.slot} (iLv {item.itemLevel})</div>
                    {renderAffixes(item)}
                    <div style={{ display: 'flex', gap: '5px', marginTop: '8px' }}>
                      <button onClick={() => handleEquip(item)} style={{ flex: 1, backgroundColor: '#059669', border: 'none', borderRadius: '4px', color: 'white', fontSize: '0.7rem', padding: '3px', cursor: 'pointer' }}>Equip</button>
                      <button onClick={() => handleSalvage(item)} style={{ flex: 1, backgroundColor: '#4b5563', border: 'none', borderRadius: '4px', color: 'white', fontSize: '0.7rem', padding: '3px', cursor: 'pointer' }}>Salvage</button>
                      <button onClick={() => handleSell(item.id)} style={{ flex: 1, backgroundColor: '#7f1d1d', border: 'none', borderRadius: '4px', color: 'white', fontSize: '0.7rem', padding: '3px', cursor: 'pointer' }}>Sell</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h3>Passive Skill Tree</h3>
                <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>{unspentPassivePoints} Points Available</span>
              </div>
              
              {/* Draggable Viewport */}
              <div 
                style={{ 
                  position: 'relative', 
                  width: '100%', 
                  height: '550px', 
                  backgroundColor: '#020617', 
                  borderRadius: '8px', 
                  overflow: 'hidden',
                  border: '1px solid #334155',
                  cursor: isDragging ? 'grabbing' : 'grab'
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                {/* Transform Wrapper */}
                <div style={{ 
                  position: 'absolute',
                  width: '2000px',
                  height: '2000px',
                  transform: `translate(${panOffset.x}px, ${panOffset.y}px)`,
                  transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                  pointerEvents: 'auto'
                }}>
                  {/* SVG Connections */}
                  <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                    {Object.values(PASSIVE_TREE).map(node => (
                      node.connections?.map(targetId => {
                        const target = PASSIVE_TREE[targetId];
                        if (!target || node.id > targetId) return null;
                        const isLineAllocated = allocatedPassiveNodes.includes(node.id) && allocatedPassiveNodes.includes(targetId);
                        return (
                          <line 
                            key={`${node.id}-${targetId}`}
                            x1={node.x} y1={node.y}
                            x2={target.x} y2={target.y}
                            stroke={isLineAllocated ? '#fbbf24' : '#1e293b'}
                            strokeWidth={isLineAllocated ? 3 : 1}
                            style={{ transition: 'stroke 0.3s' }}
                          />
                        );
                      })
                    ))}
                  </svg>

                  {/* Nodes */}
                  {Object.values(PASSIVE_TREE).map(node => (
                    <PassiveTreeNode 
                      key={node.id}
                      node={node}
                      isAllocated={allocatedPassiveNodes.includes(node.id)}
                      isAvailable={isNodeAllocatable(node.id, allocatedPassiveNodes, unspentPassivePoints)}
                      onAllocate={handleAllocatePassive}
                    />
                  ))}
                </div>
              </div>

              <div style={{ marginTop: '15px', fontSize: '0.75rem', color: '#94a3b8' }}>
                * Drag to pan. Hover for stats. Click available nodes to allocate points.
              </div>
            </div>
          )}
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
