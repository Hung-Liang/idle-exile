
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  formatLargeNumber, 
  calculateExpToNextLevel,
  calculatePlayerStats,
  getMonsterStats
} from '../utils/combat';
import { generateItem, calculateItemStats, UNIQUE_AFFIX_GROUPS } from '../utils/loot';
import type { Item, ItemSlot } from '../utils/loot';
import { 
  PASSIVE_TREE, 
  calculatePassiveStats, 
  isNodeAllocatable 
} from '../utils/passiveTree';
import { 
  SKILL_DATABASE, 
  calculateSkillExpToNextLevel, 
  calculateSkillDamage 
} from '../utils/skills';
import type { PlayerSkill } from '../utils/skills';

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
      style={{ position: 'absolute', left: node.x, top: node.y, transform: 'translate(-50%, -50%)', zIndex: 10 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onAllocate(node.id); }}
        disabled={!isAvailable || isAllocated}
        style={{
          width: nodeSize, height: nodeSize, borderRadius: '50%', border: `2px solid ${color}`,
          backgroundColor: isAllocated ? color : '#0f172a',
          cursor: isAvailable && !isAllocated ? 'pointer' : 'default',
          boxShadow: isAvailable && !isAllocated ? `0 0 15px ${color}` : 'none',
          transition: 'all 0.2s', padding: 0
        }}
      />
      {isHovered && (
        <div style={{
          position: 'absolute', bottom: '120%', left: '50%', transform: 'translateX(-50%)',
          backgroundColor: '#1e293b', border: '2px solid #334155', borderRadius: '6px',
          padding: '12px', width: '180px', pointerEvents: 'none', zIndex: 100,
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
        }}>
          <div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#f8fafc', marginBottom: '6px' }}>{node.name}</div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
            {node.stats?.map((s: any, idx: number) => (
              <div key={idx} style={{ marginBottom: '2px' }}>+{s.value}{s.key === 'dr' ? '%' : ''} {s.key.toUpperCase()}</div>
            ))}
          </div>
          <div style={{ fontSize: '0.65rem', marginTop: '8px', fontWeight: 'bold', color: isAllocated ? '#fbbf24' : isAvailable ? '#3b82f6' : '#64748b' }}>
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
  const [allocatedPassiveNodes, setAllocatedPassiveNodes] = useState<string[]>([]);

  // Active Skills State
  const [unlockedSkills, setUnlockedSkills] = useState<PlayerSkill[]>(
    SKILL_DATABASE.map(s => ({ ...s, level: 1, currentExp: 0 }))
  );
  const [equippedSkillIds, setEquippedSkillIds] = useState<string[]>([]);
  const [skillCooldowns, setSkillCooldowns] = useState<Record<string, number>>({});

  // Combat State
  const [currentPlayerHP, setCurrentPlayerHP] = useState(500);
  const [currentEnemyHP, setCurrentEnemyHP] = useState(50);
  const [currentEnemyMaxHP, setCurrentEnemyMaxHP] = useState(50);
  const [isRespawning, setIsRespawning] = useState(false);
  
  // Equipment & UI State
  const [inventory, setInventory] = useState<Item[]>([]);
  const [equipment, setEquipment] = useState<Record<ItemSlot, Item | null>>({ WEAPON: null, ARMOR: null, ACCESSORY: null });
  const [combatLogs, setCombatLogs] = useState<string[]>(["Game Started"]);
  const [currentTab, setCurrentTab] = useState<'INVENTORY' | 'PASSIVES' | 'SKILLS'>('INVENTORY');
  const [damageFlash, setDamageFlash] = useState(false);

  const addLog = (msg: string) => {
    setCombatLogs(prev => [msg, ...prev].slice(0, 10));
  };

  // Auto-Crafting State
  const [targetAffixGroup, setTargetAffixGroup] = useState<string>(UNIQUE_AFFIX_GROUPS[0]);
  const [minTier, setMinTier] = useState<number>(1);

  // Panning State
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
  const baseMonsterConfig = useMemo(() => ({ baseEhp: 50, baseDps: 10, baseExp: 10, baseGold: 5 }), []);

  const stateRef = useRef({ 
    playerLevel, currentExp, gold, currentZoneLevel, finalStats, currentPlayerHP, 
    currentEnemyHP, currentEnemyMaxHP, isRespawning, craftingScrap, 
    equippedSkillIds, unlockedSkills, skillCooldowns
  });

  useEffect(() => {
    stateRef.current = { 
      playerLevel, currentExp, gold, currentZoneLevel, finalStats, currentPlayerHP, 
      currentEnemyHP, currentEnemyMaxHP, isRespawning, craftingScrap, 
      equippedSkillIds, unlockedSkills, skillCooldowns
    };
  }, [playerLevel, currentExp, gold, currentZoneLevel, finalStats, currentPlayerHP, currentEnemyHP, currentEnemyMaxHP, isRespawning, craftingScrap, equippedSkillIds, unlockedSkills, skillCooldowns]);

  const processLootDrop = (rarity: 'MAGIC' | 'RARE', itemLevel: number) => {
    const item = generateItem(rarity, itemLevel);
    if (item.rarity === 'MAGIC') {
      const scrap = item.itemLevel * 2;
      setCraftingScrap(prev => prev + scrap);
      addLog(`Auto-salvaged Magic item for ${scrap} Scrap.`);
    } else {
      setInventory(prev => [item, ...prev]);
      addLog(`Dropped a Rare ${item.slot}!`);
    }
  };

  const spawnMonster = (level: number) => {
    setIsRespawning(false);
    const stats = getMonsterStats(baseMonsterConfig, level);
    setCurrentEnemyHP(stats.baseEhp);
    setCurrentEnemyMaxHP(stats.baseEhp);
    addLog(`Fighting Lv ${level} Monster`);
  };

  // Helper to trigger monster death exactly once
  const handleMonsterDeath = (s: any, earnedExp: number, earnedGold: number) => {
    // 1. Skill EXP Gain
    setUnlockedSkills(prev => prev.map(sk => {
      if (!s.equippedSkillIds.includes(sk.id)) return sk;
      let newSkExp = sk.currentExp + earnedExp * 0.5;
      let newSkLevel = sk.level;
      let req = calculateSkillExpToNextLevel(sk.baseExpRequired, newSkLevel);
      while (newSkExp >= req) {
        newSkExp -= req;
        newSkLevel++;
        req = calculateSkillExpToNextLevel(sk.baseExpRequired, newSkLevel);
      }
      return { ...sk, level: newSkLevel, currentExp: newSkExp };
    }));

    // 2. Player Level/Exp Gain
    let newExp = s.currentExp + earnedExp;
    let newLevel = s.playerLevel;
    let req = calculateExpToNextLevel(newLevel);
    while (newExp >= req) {
      newExp -= req;
      newLevel++;
      req = calculateExpToNextLevel(newLevel);
    }

    if (newLevel !== s.playerLevel) {
      const pStats = calculatePlayerStats(newLevel);
      const gStats = calculateItemStats(Object.values(equipment));
      const psStats = calculatePassiveStats(allocatedPassiveNodes);
      setCurrentPlayerHP(pStats.hp + gStats.hp + psStats.hp);
      setPlayerLevel(newLevel);
    }
    
    setCurrentExp(newExp);
    setGold(s.gold + earnedGold);
    
    // 3. Loot
    if (Math.random() < 0.3) {
      processLootDrop(Math.random() < 0.7 ? 'MAGIC' : 'RARE', s.currentZoneLevel);
    }

    // 4. State Change
    setIsRespawning(true);
    setCurrentEnemyHP(0);
    
    setTimeout(() => {
      const cur = stateRef.current;
      const nextZone = cur.currentZoneLevel + 1;
      setCurrentZoneLevel(nextZone);
      spawnMonster(nextZone);
    }, 1000);
  };

  useEffect(() => {
    spawnMonster(currentZoneLevel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const tickInterval = setInterval(() => {
      const s = stateRef.current;
      
      // Always progress cooldowns
      const nextCooldowns = { ...s.skillCooldowns };
      s.equippedSkillIds.forEach(skillId => {
        let cd = nextCooldowns[skillId] || 0;
        if (cd > 0) nextCooldowns[skillId] = cd - 1;
      });
      setSkillCooldowns(nextCooldowns);

      // EXIT if already respawning or monster is already dead
      if (s.isRespawning || s.currentEnemyHP <= 0) return;

      const monster = getMonsterStats(baseMonsterConfig, s.currentZoneLevel);
      let tempEnemyHP = s.currentEnemyHP;
      let monsterDiedInThisTick = false;

      // 1. APPLY SKILL DAMAGE FIRST
      s.equippedSkillIds.forEach(skillId => {
        if (monsterDiedInThisTick) return;
        
        const skill = s.unlockedSkills.find(sk => sk.id === skillId);
        if (skill && nextCooldowns[skillId] === 0) {
          const dmg = calculateSkillDamage(s.finalStats.dps, skill);
          tempEnemyHP -= dmg;
          nextCooldowns[skillId] = skill.cooldownTicks;
          addLog(`>>> CAST [${skill.name}]: ${formatLargeNumber(dmg)} Burst Damage! <<<`);
          
          setDamageFlash(true);
          setTimeout(() => setDamageFlash(false), 150);

          if (tempEnemyHP <= 0) {
            monsterDiedInThisTick = true;
          }
        }
      });
      setSkillCooldowns(nextCooldowns);

      // 2. IF SURVIVED SKILLS, APPLY BASE DPS
      if (!monsterDiedInThisTick) {
        tempEnemyHP -= s.finalStats.dps;
        if (tempEnemyHP <= 0) {
          monsterDiedInThisTick = true;
        }
      }

      // 3. EXECUTE DEATH LOGIC IF DIED
      if (monsterDiedInThisTick) {
        const mult = Math.pow(1.1, s.currentZoneLevel - 1);
        handleMonsterDeath(s, monster.baseExp * mult, monster.baseGold * mult);
        return; // Important: Exit combat logic for this tick
      }

      // 4. IF STILL ALIVE, MONSTER ATTACKS PLAYER
      const monsterDmg = monster.baseDps * (1 - s.finalStats.damageReduction);
      const nextPlayerHP = Math.max(0, s.currentPlayerHP - monsterDmg);

      if (nextPlayerHP <= 0) {
        const prevZone = Math.max(1, s.currentZoneLevel - 1);
        setCurrentZoneLevel(prevZone);
        setCurrentPlayerHP(s.finalStats.hp);
        spawnMonster(prevZone);
        addLog(`Died! Retreating to Lv ${prevZone}`);
      } else {
        setCurrentEnemyHP(tempEnemyHP);
        setCurrentPlayerHP(nextPlayerHP);
      }
    }, 1000);

    return () => clearInterval(tickInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipment, playerLevel, allocatedPassiveNodes]);

  const handleRollItem = () => { if (gold >= 100) { setGold(prev => prev - 100); processLootDrop('RARE', playerLevel); } };

  const handleEquip = (item: Item) => {
    const current = equipment[item.slot];
    setEquipment(prev => ({ ...prev, [item.slot]: item }));
    setInventory(prev => {
      const filtered = prev.filter(i => i.id !== item.id);
      return current ? [current, ...filtered] : filtered;
    });
    setCurrentPlayerHP(prev => Math.min(prev, calculatePlayerStats(playerLevel).hp + calculateItemStats(Object.values({ ...equipment, [item.slot]: item })).hp));
  };

  const handleUnequip = (slot: ItemSlot) => {
    const item = equipment[slot];
    if (!item) return;
    setEquipment(prev => ({ ...prev, [slot]: null }));
    setInventory(prev => [item, ...prev]);
    setCurrentPlayerHP(prev => Math.min(prev, calculatePlayerStats(playerLevel).hp + calculateItemStats(Object.values({ ...equipment, [slot]: null })).hp));
  };

  const handleSalvage = (item: Item) => {
    setInventory(prev => prev.filter(i => i.id !== item.id));
    setCraftingScrap(prev => prev + item.itemLevel * (item.rarity === 'RARE' ? 5 : 2));
  };

  const handleAutoCraft = () => {
    let attempts = 0; let currentGold = gold; let success = false; let foundItem: Item | null = null;
    while (attempts < 1000 && currentGold >= 500) {
      attempts++; currentGold -= 500;
      const newItem = generateItem('RARE', currentZoneLevel);
      if ([...newItem.prefixes, ...newItem.suffixes].some(a => a.group === targetAffixGroup && a.tier <= minTier)) {
        success = true; foundItem = newItem; break;
      }
    }
    setGold(currentGold);
    if (success && foundItem) { setInventory(prev => [foundItem!, ...prev]); setLastLog(`Auto-Craft SUCCESS! Took ${attempts} rolls.`); }
    else setLastLog(`Auto-Craft FAILED after ${attempts} rolls.`);
  };

  const handleEquipSkill = (id: string) => { 
    if (equippedSkillIds.length < 3 && !equippedSkillIds.includes(id)) {
      setEquippedSkillIds(prev => [...prev, id]); 
      setSkillCooldowns(prev => ({ ...prev, [id]: 0 }));
    }
  };
  const handleUnequipSkill = (id: string) => { setEquippedSkillIds(prev => prev.filter(sid => sid !== id)); };
  const handleAllocatePassive = (id: string) => { if (isNodeAllocatable(id, allocatedPassiveNodes, unspentPassivePoints)) setAllocatedPassiveNodes(prev => [...prev, id]); };

  const renderAffixes = (item: Item) => (
    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
      {[...item.prefixes, ...item.suffixes].map(a => (
        <div key={a.id}>• {a.name}: +{a.value}{a.statKey === 'dr' ? '%' : ''} {a.statKey.toUpperCase()} (T{a.tier})</div>
      ))}
    </div>
  );

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '20px', color: '#e2e8f0' }}>
      <style>{`
        @keyframes hitFlash {
          0% { filter: brightness(1); }
          50% { filter: brightness(2) saturate(2); transform: scale(1.02); }
          100% { filter: brightness(1); transform: scale(1); }
        }
        .hit-flash { animation: hitFlash 0.15s ease-out; }
        .log-entry { margin-bottom: 4px; padding: 2px 8px; border-radius: 4px; border-left: 3px solid transparent; }
        .log-skill { background-color: rgba(124, 58, 237, 0.1); border-left-color: #7c3aed; color: #a78bfa; font-weight: bold; }
        .log-normal { border-left-color: #334155; }
      `}</style>

      {/* Combat View */}
      <section style={{ backgroundColor: '#1e293b', padding: '20px', borderRadius: '12px', border: '1px solid #334155', marginBottom: '20px' }}>
        <div style={{ 
          height: '120px', overflowY: 'auto', marginBottom: '20px', padding: '10px', 
          backgroundColor: '#0f172a', borderRadius: '8px', border: '1px solid #334155',
          fontSize: '0.85rem', display: 'flex', flexDirection: 'column-reverse'
        }}>
          {combatLogs.map((log, i) => (
            <div key={i} className={log.includes('>>>') ? 'log-entry log-skill' : 'log-entry log-normal'}>
              {log}
            </div>
          ))}
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
          <div>
            <ProgressBar value={currentPlayerHP} max={finalStats.hp} color="#10b981" label="Player HP" />
          </div>
          <div className={damageFlash ? 'hit-flash' : ''}>
            <ProgressBar value={currentEnemyHP} max={currentEnemyMaxHP} color="#ef4444" label={isRespawning ? "Respawning..." : "Monster HP"} />
          </div>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 280px', gap: '20px' }}>
        <aside style={{ backgroundColor: '#1e293b', padding: '15px', borderRadius: '8px' }}>
          <h3 style={{ borderBottom: '1px solid #334155' }}>Stats</h3>
          <p>Level: <span style={{ color: '#fbbf24' }}>{playerLevel}</span></p>
          <p>Gold: <span style={{ color: '#fcd34d' }}>{formatLargeNumber(gold)}</span></p>
          <p>Scrap: <span style={{ color: '#60a5fa' }}>{formatLargeNumber(craftingScrap)}</span></p>
          <div style={{ lineHeight: '1.8' }}>
            <div>DPS: {formatLargeNumber(finalStats.dps)}</div>
            <div>Max HP: {formatLargeNumber(finalStats.hp)}</div>
            <div>DR: {(finalStats.damageReduction * 100).toFixed(0)}%</div>
          </div>
          <ProgressBar value={currentExp} max={expToNextLevel} color="#3b82f6" label="EXP" />
        </aside>

        <main style={{ backgroundColor: '#1e293b', padding: '15px', borderRadius: '8px' }}>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '1px solid #334155', paddingBottom: '10px' }}>
            <button onClick={() => setCurrentTab('INVENTORY')} style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', cursor: 'pointer', backgroundColor: currentTab === 'INVENTORY' ? '#3b82f6' : '#334155', color: 'white' }}>Inventory</button>
            <button onClick={() => setCurrentTab('PASSIVES')} style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', cursor: 'pointer', backgroundColor: currentTab === 'PASSIVES' ? '#3b82f6' : '#334155', color: 'white' }}>Passives ({unspentPassivePoints})</button>
            <button onClick={() => setCurrentTab('SKILLS')} style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', cursor: 'pointer', backgroundColor: currentTab === 'SKILLS' ? '#3b82f6' : '#334155', color: 'white' }}>Skills</button>
          </div>

          {currentTab === 'INVENTORY' ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '20px' }}>
                {(['WEAPON', 'ARMOR', 'ACCESSORY'] as ItemSlot[]).map(slot => (
                  <div key={slot} style={{ border: '1px solid #334155', padding: '10px', backgroundColor: '#0f172a' }}>
                    <div style={{ fontSize: '0.6rem', color: '#64748b' }}>{slot}</div>
                    {equipment[slot] ? <div onClick={() => handleUnequip(slot)} style={{ cursor: 'pointer', color: '#fbbf24', fontSize: '0.8rem' }}>{equipment[slot]?.name}</div> : <div style={{ color: '#334155' }}>Empty</div>}
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', height: '350px', overflowY: 'auto' }}>
                {inventory.map(item => (
                  <div key={item.id} style={{ border: '1px solid #334155', padding: '10px', backgroundColor: '#0f172a' }}>
                    <div style={{ color: '#fbbf24', fontSize: '0.8rem' }}>{item.name} (iLv {item.itemLevel})</div>
                    {renderAffixes(item)}
                    <div style={{ display: 'flex', gap: '5px', marginTop: '5px' }}>
                      <button onClick={() => handleEquip(item)} style={{ flex: 1, backgroundColor: '#059669', border: 'none', color: 'white', fontSize: '0.6rem', padding: '3px' }}>Equip</button>
                      <button onClick={() => handleSalvage(item)} style={{ flex: 1, backgroundColor: '#4b5563', border: 'none', color: 'white', fontSize: '0.6rem', padding: '3px' }}>Salvage</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : currentTab === 'PASSIVES' ? (
            <div style={{ position: 'relative', width: '100%', height: '500px', backgroundColor: '#020617', overflow: 'hidden', border: '1px solid #334155', cursor: isDragging ? 'grabbing' : 'grab' }} onMouseDown={(e) => { setIsDragging(true); setLastMousePos({ x: e.clientX, y: e.clientY }); }} onMouseMove={(e) => { if (!isDragging) return; const dx = e.clientX - lastMousePos.x; const dy = e.clientY - lastMousePos.y; setPanOffset(prev => ({ x: prev.x + dx, y: prev.y + dy })); setLastMousePos({ x: e.clientX, y: e.clientY }); }} onMouseUp={() => setIsDragging(false)} onMouseLeave={() => setIsDragging(false)}>
              <div style={{ position: 'absolute', width: '2000px', height: '2000px', transform: `translate(${panOffset.x}px, ${panOffset.y}px)`, transition: isDragging ? 'none' : 'transform 0.1s ease-out' }}>
                <svg style={{ position: 'absolute', width: '100%', height: '100%', pointerEvents: 'none' }}>
                  {Object.values(PASSIVE_TREE).map(node => node.connections?.map(tid => { const t = PASSIVE_TREE[tid]; if (!t || node.id > tid) return null; return <line key={`${node.id}-${tid}`} x1={node.x} y1={node.y} x2={t.x} y2={t.y} stroke={allocatedPassiveNodes.includes(node.id) && allocatedPassiveNodes.includes(tid) ? '#fbbf24' : '#1e293b'} strokeWidth={2} />; }))}
                </svg>
                {Object.values(PASSIVE_TREE).map(node => <PassiveTreeNode key={node.id} node={node} isAllocated={allocatedPassiveNodes.includes(node.id)} isAvailable={isNodeAllocatable(node.id, allocatedPassiveNodes, unspentPassivePoints)} onAllocate={handleAllocatePassive} />)}
              </div>
            </div>
          ) : (
            <div style={{ height: '500px', overflowY: 'auto' }}>
              {unlockedSkills.map(skill => {
                const isEquipped = equippedSkillIds.includes(skill.id);
                const nextExp = calculateSkillExpToNextLevel(skill.baseExpRequired, skill.level);
                const cd = skillCooldowns[skill.id] || 0;
                return (
                  <div key={skill.id} style={{ backgroundColor: '#0f172a', padding: '15px', borderRadius: '8px', marginBottom: '10px', border: isEquipped ? '1px solid #3b82f6' : '1px solid #334155' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <span style={{ fontWeight: 'bold' }}>{skill.name} (Lv {skill.level})</span>
                      <button onClick={() => isEquipped ? handleUnequipSkill(skill.id) : handleEquipSkill(skill.id)} style={{ padding: '5px 15px', backgroundColor: isEquipped ? '#7f1d1d' : '#059669', border: 'none', borderRadius: '4px', color: 'white', cursor: 'pointer' }}>{isEquipped ? 'Unequip' : 'Equip'}</button>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '10px' }}>Cooldown: {skill.cooldownTicks}s | Current CD: <span style={{ color: cd === 0 ? '#10b981' : '#f87171' }}>{cd}s</span></div>
                    <ProgressBar value={skill.currentExp} max={nextExp} color="#8b5cf6" label="Skill EXP" />
                  </div>
                );
              })}
            </div>
          )}
        </main>

        <aside style={{ backgroundColor: '#1e293b', padding: '15px', borderRadius: '8px' }}>
          <h3 style={{ borderBottom: '1px solid #334155', paddingBottom: '5px' }}>Crafting</h3>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '0.6rem', color: '#94a3b8' }}>TARGET GROUP</label>
            <select value={targetAffixGroup} onChange={(e) => setTargetAffixGroup(e.target.value)} style={{ width: '100%', padding: '5px', backgroundColor: '#0f172a', color: 'white', border: '1px solid #334155' }}>{UNIQUE_AFFIX_GROUPS.map(g => <option key={g} value={g}>{g.toUpperCase()}</option>)}</select>
          </div>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '0.6rem', color: '#94a3b8' }}>MIN TIER</label>
            <select value={minTier} onChange={(e) => setMinTier(Number(e.target.value))} style={{ width: '100%', padding: '5px', backgroundColor: '#0f172a', color: 'white', border: '1px solid #334155' }}><option value={3}>T3</option><option value={2}>T2</option><option value={1}>T1</option></select>
          </div>
          <button onClick={handleAutoCraft} disabled={gold < 500} style={{ width: '100%', padding: '10px', backgroundColor: gold >= 500 ? '#7c3aed' : '#334155', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Auto-Craft (500g)</button>
        </aside>
      </div>
    </div>
  );
};

export default IdleGame;
