
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

const SAVE_KEY = 'idle_exile_save_v1';

const IdleGame: React.FC = () => {
  // --- STATE ---
  const [playerLevel, setPlayerLevel] = useState(1);
  const [currentExp, setCurrentExp] = useState(0);
  const [gold, setGold] = useState(0);
  const [craftingScrap, setCraftingScrap] = useState(0);
  const [currentZoneLevel, setCurrentZoneLevel] = useState(1);
  const [allocatedPassiveNodes, setAllocatedPassiveNodes] = useState<string[]>([]);
  const [unlockedSkills, setUnlockedSkills] = useState<PlayerSkill[]>(SKILL_DATABASE.map(s => ({ ...s, level: 1, currentExp: 0 })));
  const [equippedSkillIds, setEquippedSkillIds] = useState<string[]>([]);
  const [skillCooldowns, setSkillCooldowns] = useState<Record<string, number>>({});
  const [currentPlayerHP, setCurrentPlayerHP] = useState(500);
  const [currentEnemyHP, setCurrentEnemyHP] = useState(50);
  const [currentEnemyMaxHP, setCurrentEnemyMaxHP] = useState(50);
  const [isRespawning, setIsRespawning] = useState(false);
  const [inventory, setInventory] = useState<Item[]>([]);
  const [equipment, setEquipment] = useState<Record<ItemSlot, Item | null>>({ WEAPON: null, ARMOR: null, ACCESSORY: null });
  const [combatLogs, setCombatLogs] = useState<string[]>(["Game Started"]);
  const [currentTab, setCurrentTab] = useState<'INVENTORY' | 'PASSIVES' | 'SKILLS' | 'FILTER'>('INVENTORY');
  const [damageFlash, setDamageFlash] = useState(false);
  const [offlineRewards, setOfflineRewards] = useState<{ timeAway: number; exp: number; gold: number; scrap: number; kills: number; } | null>(null);
  
  // Loot Filter State
  const [filterRules, setFilterRules] = useState<{id: number, rarity: string, action: string}[]>([
    { id: 1, rarity: "MAGIC", action: "SALVAGE" },
    { id: 2, rarity: "RARE", action: "KEEP" }
  ]);

  const [targetAffixGroup, setTargetAffixGroup] = useState<string>(UNIQUE_AFFIX_GROUPS[0]);
  const [minTier, setMinTier] = useState<number>(1);
  const [panOffset, setPanOffset] = useState({ x: 50, y: 50 });
  const [isDragging, setIsDragging] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });

  // --- DERIVED ---
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
    playerLevel, currentExp, gold, craftingScrap, currentZoneLevel, allocatedPassiveNodes,
    unlockedSkills, equippedSkillIds, inventory, equipment, finalStats, currentPlayerHP, currentEnemyHP, isRespawning, skillCooldowns, offlineRewards
  });

  useEffect(() => {
    stateRef.current = { 
      playerLevel, currentExp, gold, craftingScrap, currentZoneLevel, allocatedPassiveNodes,
      unlockedSkills, equippedSkillIds, inventory, equipment, finalStats, currentPlayerHP, currentEnemyHP, isRespawning, skillCooldowns, offlineRewards
    };
  }, [playerLevel, currentExp, gold, craftingScrap, currentZoneLevel, allocatedPassiveNodes, unlockedSkills, equippedSkillIds, inventory, equipment, finalStats, currentPlayerHP, currentEnemyHP, isRespawning, skillCooldowns, offlineRewards]);

  // --- HELPERS ---
  const addLog = (msg: string) => setCombatLogs(prev => [msg, ...prev].slice(0, 10));

  const saveGame = () => {
    const data = {
      playerLevel: stateRef.current.playerLevel, currentExp: stateRef.current.currentExp, gold: stateRef.current.gold,
      craftingScrap: stateRef.current.craftingScrap, currentZoneLevel: stateRef.current.currentZoneLevel,
      allocatedPassiveNodes: stateRef.current.allocatedPassiveNodes, unlockedSkills: stateRef.current.unlockedSkills,
      equippedSkillIds: stateRef.current.equippedSkillIds, inventory: stateRef.current.inventory,
      equipment: stateRef.current.equipment, lastSaved: Date.now()
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  };

  const spawnMonster = (level: number) => {
    setIsRespawning(false);
    const stats = getMonsterStats(baseMonsterConfig, level);
    setCurrentEnemyHP(stats.baseEhp);
    setCurrentEnemyMaxHP(stats.baseEhp);
    addLog(`Fighting Lv ${level} Monster`);
  };

  const claimOfflineRewards = () => {
    if (!offlineRewards) return;
    setGold(prev => prev + offlineRewards.gold);
    setCraftingScrap(prev => prev + offlineRewards.scrap);
    let newExp = currentExp + offlineRewards.exp;
    let newLevel = playerLevel;
    let req = calculateExpToNextLevel(newLevel);
    while (newExp >= req) { newExp -= req; newLevel++; req = calculateExpToNextLevel(newLevel); }
    setPlayerLevel(newLevel); setCurrentExp(newExp); setOfflineRewards(null);
    addLog(`Claimed offline rewards!`);
  };

  const processLootDrop = (rarity: string, itemLevel: number) => {
    const item = generateItem(rarity as any, itemLevel);
    
    // Find matching rule
    const rule = filterRules.find(r => r.rarity === item.rarity) || { action: 'KEEP' };

    if (rule.action === 'SALVAGE') {
      const scrap = item.itemLevel * (item.rarity === 'RARE' ? 5 : 2);
      setCraftingScrap(prev => prev + scrap);
      addLog(`Auto-salvaged ${item.rarity} item for ${scrap} Scrap.`);
    } else if (rule.action === 'SELL_FOR_GOLD') {
      const goldGained = item.itemLevel * (item.rarity === 'RARE' ? 25 : 10);
      setGold(prev => prev + goldGained);
      addLog(`Auto-sold ${item.rarity} item for ${goldGained} Gold.`);
    } else {
      setInventory(prev => [item, ...prev]);
      addLog(`Dropped a ${item.rarity} ${item.slot}!`);
    }
  };

  const handleAddFilterRule = (rarity: string, action: string) => {
    setFilterRules(prev => {
      const filtered = prev.filter(r => r.rarity !== rarity);
      return [...filtered, { id: Date.now(), rarity, action }];
    });
  };

  const handleRemoveFilterRule = (id: number) => {
    setFilterRules(prev => prev.filter(r => r.id !== id));
  };

  const handleMonsterDeath = (s: any, earnedExp: number, earnedGold: number) => {
    setUnlockedSkills(prev => prev.map(sk => {
      if (!s.equippedSkillIds.includes(sk.id)) return sk;
      let newSkExp = sk.currentExp + earnedExp * 0.5;
      let newSkLevel = sk.level;
      let req = calculateSkillExpToNextLevel(sk.baseExpRequired, newSkLevel);
      while (newSkExp >= req) { newSkExp -= req; newSkLevel++; req = calculateSkillExpToNextLevel(sk.baseExpRequired, newSkLevel); }
      return { ...sk, level: newSkLevel, currentExp: newSkExp };
    }));
    let newExp = s.currentExp + earnedExp;
    let newLevel = s.playerLevel;
    let req = calculateExpToNextLevel(newLevel);
    while (newExp >= req) { newExp -= req; newLevel++; req = calculateExpToNextLevel(newLevel); }
    if (newLevel !== s.playerLevel) {
      const pStats = calculatePlayerStats(newLevel); const gStats = calculateItemStats(Object.values(equipment));
      const psStats = calculatePassiveStats(allocatedPassiveNodes);
      setCurrentPlayerHP(pStats.hp + gStats.hp + psStats.hp); setPlayerLevel(newLevel);
    }
    setCurrentExp(newExp); setGold(s.gold + earnedGold);
    if (Math.random() < 0.3) processLootDrop(Math.random() < 0.7 ? 'MAGIC' : 'RARE', s.currentZoneLevel);
    setIsRespawning(true); setCurrentEnemyHP(0);
    setTimeout(() => { spawnMonster(stateRef.current.currentZoneLevel + 1); setCurrentZoneLevel(prev => prev + 1); }, 1000);
  };

  // --- EFFECTS ---
  useEffect(() => {
    const timer = setInterval(saveGame, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(SAVE_KEY);
    if (saved) {
      const data = JSON.parse(saved);
      setPlayerLevel(data.playerLevel); setCurrentExp(data.currentExp); setGold(data.gold);
      setCraftingScrap(data.craftingScrap); setCurrentZoneLevel(data.currentZoneLevel);
      setAllocatedPassiveNodes(data.allocatedPassiveNodes); setUnlockedSkills(data.unlockedSkills);
      setEquippedSkillIds(data.equippedSkillIds); setInventory(data.inventory); setEquipment(data.equipment);
      const secondsAway = Math.floor((Date.now() - data.lastSaved) / 1000);
      if (secondsAway > 60) {
        const monster = getMonsterStats(baseMonsterConfig, data.currentZoneLevel);
        const pStats = calculatePlayerStats(data.playerLevel);
        const gearS = calculateItemStats(Object.values(data.equipment as Record<ItemSlot, Item | null>));
        const passS = calculatePassiveStats(data.allocatedPassiveNodes);
        const ttk = Math.max(1, Math.ceil(monster.baseEhp / (pStats.dps + gearS.dps + passS.dps)));
        const totalKills = Math.floor(secondsAway / (ttk + 1));
        if (totalKills > 0) {
          const mult = Math.pow(1.1, data.currentZoneLevel - 1);
          setOfflineRewards({
            timeAway: secondsAway, exp: totalKills * monster.baseExp * mult,
            gold: totalKills * monster.baseGold * mult,
            scrap: Math.floor(totalKills * 0.3 * 0.7 * (data.currentZoneLevel * 2)),
            kills: totalKills
          });
        }
      }
    }
    spawnMonster(currentZoneLevel);
  }, []);

  useEffect(() => {
    const tickInterval = setInterval(() => {
      const s = stateRef.current;
      if (s.offlineRewards) return;
      const nextCDs = { ...s.skillCooldowns };
      s.equippedSkillIds.forEach(id => { if (nextCDs[id] > 0) nextCDs[id]--; });
      setSkillCooldowns(nextCDs);
      if (s.isRespawning || s.currentEnemyHP <= 0) return;
      const monster = getMonsterStats(baseMonsterConfig, s.currentZoneLevel);
      let tempEHP = s.currentEnemyHP; let died = false;
      s.equippedSkillIds.forEach(id => {
        if (died) return;
        const sk = s.unlockedSkills.find(x => x.id === id);
        if (sk && (nextCDs[id] || 0) === 0) {
          const d = calculateSkillDamage(s.finalStats.dps, sk); tempEHP -= d; nextCDs[id] = sk.cooldownTicks;
          addLog(`>>> CAST [${sk.name}]: ${formatLargeNumber(d)} <<<`);
          setDamageFlash(true); setTimeout(() => setDamageFlash(false), 150);
          if (tempEHP <= 0) died = true;
        }
      });
      if (!died) { tempEHP -= s.finalStats.dps; if (tempEHP <= 0) died = true; }
      if (died) {
        const mult = Math.pow(1.1, s.currentZoneLevel - 1);
        handleMonsterDeath(s, monster.baseExp * mult, monster.baseGold * mult);
      } else {
        const mDmg = monster.baseDps * (1 - s.finalStats.damageReduction);
        const nextPHP = Math.max(0, s.currentPlayerHP - mDmg);
        if (nextPHP <= 0) {
          const prev = Math.max(1, s.currentZoneLevel - 1); setCurrentZoneLevel(prev);
          setCurrentPlayerHP(s.finalStats.hp); spawnMonster(prev); addLog(`Died! Retreating.`);
        } else { setCurrentEnemyHP(tempEHP); setCurrentPlayerHP(nextPHP); }
      }
    }, 1000);
    return () => clearInterval(tickInterval);
  }, [offlineRewards]);

  // --- HANDLERS ---
  const handleRollItem = () => { if (gold >= 100) { setGold(prev => prev - 100); processLootDrop('RARE', playerLevel); } };
  const handleEquip = (itm: Item) => {
    const cur = equipment[itm.slot]; setEquipment(prev => ({ ...prev, [itm.slot]: itm }));
    setInventory(prev => { const f = prev.filter(x => x.id !== itm.id); return cur ? [cur, ...f] : f; });
    setCurrentPlayerHP(p => Math.min(p, calculatePlayerStats(playerLevel).hp + calculateItemStats(Object.values({ ...equipment, [itm.slot]: itm })).hp));
  };
  const handleUnequip = (s: ItemSlot) => {
    const itm = equipment[s]; if (!itm) return; setEquipment(prev => ({ ...prev, [s]: null }));
    setInventory(prev => [itm, ...prev]);
    setCurrentPlayerHP(p => Math.min(p, calculatePlayerStats(playerLevel).hp + calculateItemStats(Object.values({ ...equipment, [s]: null })).hp));
  };
  const handleSalvage = (itm: Item) => { setInventory(prev => prev.filter(x => x.id !== itm.id)); setCraftingScrap(p => p + itm.itemLevel * (itm.rarity === 'RARE' ? 5 : 2)); };
  const handleAutoCraft = () => {
    let att = 0; let curG = gold; let ok = false; let res: Item | null = null;
    while (att < 1000 && curG >= 500) {
      att++; curG -= 500; const ni = generateItem('RARE', currentZoneLevel);
      if ([...ni.prefixes, ...ni.suffixes].some(a => a.group === targetAffixGroup && a.tier <= minTier)) { ok = true; res = ni; break; }
    }
    setGold(curG); if (ok && res) { setInventory(p => [res!, ...p]); addLog(`Auto-Craft SUCCESS!`); } else addLog(`Auto-Craft FAILED.`);
  };
  const handleEquipSkill = (id: string) => { if (equippedSkillIds.length < 3 && !equippedSkillIds.includes(id)) { setEquippedSkillIds(p => [...p, id]); setSkillCooldowns(p => ({ ...p, [id]: 0 })); } };
  const handleUnequipSkill = (id: string) => setEquippedSkillIds(p => p.filter(sid => sid !== id));
  const handleAllocatePassive = (id: string) => { if (isNodeAllocatable(id, allocatedPassiveNodes, unspentPassivePoints)) setAllocatedPassiveNodes(p => [...p, id]); };

  // --- RENDER ---
  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '20px', color: '#e2e8f0' }}>
      <style>{`
        @keyframes hitFlash { 0% { filter: brightness(1); } 50% { filter: brightness(2); transform: scale(1.02); } 100% { filter: brightness(1); transform: scale(1); } }
        .hit-flash { animation: hitFlash 0.15s ease-out; }
        .log-entry { margin-bottom: 4px; padding: 2px 8px; border-radius: 4px; border-left: 3px solid transparent; }
        .log-skill { background-color: rgba(124, 58, 237, 0.1); border-left-color: #7c3aed; color: #a78bfa; font-weight: bold; }
        .log-normal { border-left-color: #334155; }
      `}</style>

      <section style={{ backgroundColor: '#1e293b', padding: '20px', borderRadius: '12px', border: '1px solid #334155', marginBottom: '20px' }}>
        <div style={{ height: '120px', overflowY: 'auto', marginBottom: '20px', padding: '10px', backgroundColor: '#0f172a', borderRadius: '8px', fontSize: '0.85rem', display: 'flex', flexDirection: 'column-reverse' }}>
          {combatLogs.map((log, i) => <div key={i} className={log.includes('>>>') ? 'log-entry log-skill' : 'log-entry log-normal'}>{log}</div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
          <ProgressBar value={currentPlayerHP} max={finalStats.hp} color="#10b981" label="Player" />
          <div className={damageFlash ? 'hit-flash' : ''}><ProgressBar value={currentEnemyHP} max={currentEnemyMaxHP} color="#ef4444" label={isRespawning ? "Respawning..." : "Monster"} /></div>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr 240px', gap: '20px' }}>
        <aside style={{ backgroundColor: '#1e293b', padding: '15px', borderRadius: '8px' }}>
          <h3>Stats</h3>
          <p>Lv: {playerLevel} | Gold: {formatLargeNumber(gold)}</p>
          <p>Scrap: {formatLargeNumber(craftingScrap)}</p>
          <div style={{ fontSize: '0.8rem', lineHeight: '1.6' }}><div>DPS: {formatLargeNumber(finalStats.dps)} | HP: {formatLargeNumber(finalStats.hp)}</div><div>DR: {(finalStats.damageReduction * 100).toFixed(0)}%</div></div>
          <ProgressBar value={currentExp} max={expToNextLevel} color="#3b82f6" label="EXP" />
        </aside>

        <main style={{ backgroundColor: '#1e293b', padding: '15px', borderRadius: '8px' }}>
          <div style={{ display: 'flex', gap: '5px', marginBottom: '15px' }}>
            {['INVENTORY', 'PASSIVES', 'SKILLS', 'FILTER'].map(t => (
              <button 
                key={t} 
                onClick={() => setCurrentTab(t as any)} 
                style={{ 
                  padding: '6px 12px', borderRadius: '4px', border: 'none', cursor: 'pointer', 
                  backgroundColor: currentTab === t ? '#3b82f6' : '#334155', color: 'white', fontSize: '0.8rem' 
                }}
              >
                {t}
              </button>
            ))}
          </div>
          {currentTab === 'INVENTORY' ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '15px' }}>{(['WEAPON', 'ARMOR', 'ACCESSORY'] as ItemSlot[]).map(s => <div key={s} style={{ border: '1px solid #334155', padding: '8px', backgroundColor: '#0f172a', fontSize: '0.7rem' }}><div style={{ color: '#64748b' }}>{s}</div>{equipment[s] ? <div onClick={() => handleUnequip(s)} style={{ color: '#fbbf24', cursor: 'pointer' }}>{equipment[s]?.name}</div> : 'Empty'}</div>)}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', height: '300px', overflowY: 'auto' }}>{inventory.map(item => <div key={item.id} style={{ border: '1px solid #334155', padding: '8px', backgroundColor: '#0f172a' }}><div style={{ color: '#fbbf24', fontSize: '0.75rem' }}>{item.name} (iLv {item.itemLevel})</div><div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}><button onClick={() => handleEquip(item)} style={{ flex: 1, backgroundColor: '#059669', border: 'none', color: 'white', fontSize: '0.6rem', padding: '2px' }}>Equip</button><button onClick={() => handleSalvage(item)} style={{ flex: 1, backgroundColor: '#4b5563', border: 'none', color: 'white', fontSize: '0.6rem', padding: '2px' }}>Salvage</button></div></div>)}</div>
            </>
          ) : currentTab === 'PASSIVES' ? (
            <div style={{ position: 'relative', width: '100%', height: '400px', backgroundColor: '#020617', overflow: 'hidden', border: '1px solid #334155', cursor: isDragging ? 'grabbing' : 'grab' }} onMouseDown={(e) => { setIsDragging(true); setLastMousePos({ x: e.clientX, y: e.clientY }); }} onMouseMove={(e) => { if (!isDragging) return; setPanOffset(p => ({ x: p.x + (e.clientX - lastMousePos.x), y: p.y + (e.clientY - lastMousePos.y) })); setLastMousePos({ x: e.clientX, y: e.clientY }); }} onMouseUp={() => setIsDragging(false)} onMouseLeave={() => setIsDragging(false)}>
              <div style={{ position: 'absolute', width: '2000px', height: '2000px', transform: `translate(${panOffset.x}px, ${panOffset.y}px)`, transition: isDragging ? 'none' : 'transform 0.1s ease-out' }}>
                <svg style={{ position: 'absolute', width: '100%', height: '100%', pointerEvents: 'none' }}>{Object.values(PASSIVE_TREE).map(node => node.connections?.map(tid => { const t = PASSIVE_TREE[tid]; if (!t || node.id > tid) return null; return <line key={`${node.id}-${tid}`} x1={node.x} y1={node.y} x2={t.x} y2={t.y} stroke={allocatedPassiveNodes.includes(node.id) && allocatedPassiveNodes.includes(tid) ? '#fbbf24' : '#1e293b'} strokeWidth={2} />; }))}</svg>
                {Object.values(PASSIVE_TREE).map(node => <PassiveTreeNode key={node.id} node={node} isAllocated={allocatedPassiveNodes.includes(node.id)} isAvailable={isNodeAllocatable(node.id, allocatedPassiveNodes, unspentPassivePoints)} onAllocate={handleAllocatePassive} />)}
              </div>
            </div>
          ) : currentTab === 'FILTER' ? (
            <div style={{ height: '400px', overflowY: 'auto' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '10px' }}>Custom Loot Filter</h3>

              <div style={{ 
                backgroundColor: '#0f172a', padding: '15px', borderRadius: '8px', 
                marginBottom: '20px', border: '1px solid #334155' 
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '10px', alignItems: 'end' }}>
                  <div>
                    <label style={{ fontSize: '0.65rem', color: '#94a3b8', display: 'block', marginBottom: '5px' }}>IF RARITY IS:</label>
                    <select id="rarity-select" style={{ width: '100%', padding: '5px', backgroundColor: '#1e293b', color: 'white', border: '1px solid #334155', borderRadius: '4px' }}>
                      <option value="NORMAL">NORMAL</option>
                      <option value="MAGIC">MAGIC</option>
                      <option value="RARE">RARE</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.65rem', color: '#94a3b8', display: 'block', marginBottom: '5px' }}>THEN DO:</label>
                    <select id="action-select" style={{ width: '100%', padding: '5px', backgroundColor: '#1e293b', color: 'white', border: '1px solid #334155', borderRadius: '4px' }}>
                      <option value="KEEP">KEEP</option>
                      <option value="SALVAGE">SALVAGE</option>
                      <option value="SELL_FOR_GOLD">SELL FOR GOLD</option>
                    </select>
                  </div>
                  <button 
                    onClick={() => {
                      const r = (document.getElementById('rarity-select') as HTMLSelectElement).value;
                      const a = (document.getElementById('action-select') as HTMLSelectElement).value;
                      handleAddFilterRule(r, a);
                    }}
                    style={{ padding: '6px 15px', backgroundColor: '#3b82f6', border: 'none', borderRadius: '4px', color: 'white', cursor: 'pointer', fontWeight: 'bold' }}
                  >
                    Add Rule
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {filterRules.map(rule => (
                  <div key={rule.id} style={{ 
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 15px', backgroundColor: '#0f172a', borderRadius: '6px', borderLeft: '4px solid #3b82f6'
                  }}>
                    <span style={{ fontSize: '0.85rem' }}>
                      IF <strong style={{ color: '#fbbf24' }}>{rule.rarity}</strong> THEN <strong style={{ color: '#10b981' }}>{rule.action.replace(/_/g, ' ')}</strong>
                    </span>
                    <button 
                      onClick={() => handleRemoveFilterRule(rule.id)}
                      style={{ backgroundColor: '#7f1d1d', border: 'none', color: 'white', padding: '3px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem' }}
                    >
                      Delete
                    </button>
                  </div>
                ))}
                {filterRules.length === 0 && <div style={{ textAlign: 'center', color: '#64748b', marginTop: '20px' }}>No rules set. Default action: KEEP</div>}
              </div>
            </div>
          ) : (
            <div style={{ height: '400px', overflowY: 'auto' }}>
{unlockedSkills.map(sk => { const isEq = equippedSkillIds.includes(sk.id); const cd = skillCooldowns[sk.id] || 0; return <div key={sk.id} style={{ backgroundColor: '#0f172a', padding: '10px', borderRadius: '6px', marginBottom: '8px', border: isEq ? '1px solid #3b82f6' : '1px solid #334155' }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}><span style={{ fontWeight: 'bold' }}>{sk.name} (Lv {sk.level})</span><button onClick={() => isEq ? handleUnequipSkill(sk.id) : handleEquipSkill(sk.id)} style={{ padding: '2px 8px', backgroundColor: isEq ? '#7f1d1d' : '#059669', border: 'none', color: 'white' }}>{isEq ? 'Unequip' : 'Equip'}</button></div><div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>CD: {sk.cooldownTicks}s | Cur: {cd}s</div><ProgressBar value={sk.currentExp} max={calculateSkillExpToNextLevel(sk.baseExpRequired, sk.level)} color="#8b5cf6" label="Skill EXP" /></div>; })}</div>
          )}
        </main>
        <aside style={{ backgroundColor: '#1e293b', padding: '15px', borderRadius: '8px' }}>
          <h3>Crafting</h3>
          <div style={{ marginBottom: '10px' }}><label style={{ fontSize: '0.6rem', color: '#94a3b8' }}>TARGET</label><select value={targetAffixGroup} onChange={(e) => setTargetAffixGroup(e.target.value)} style={{ width: '100%', padding: '4px', backgroundColor: '#0f172a', color: 'white', border: '1px solid #334155', fontSize: '0.75rem' }}>{UNIQUE_AFFIX_GROUPS.map(g => <option key={g} value={g}>{g.toUpperCase()}</option>)}</select></div>
          <div style={{ marginBottom: '10px' }}><label style={{ fontSize: '0.6rem', color: '#94a3b8' }}>TIER</label><select value={minTier} onChange={(e) => setMinTier(Number(e.target.value))} style={{ width: '100%', padding: '4px', backgroundColor: '#0f172a', color: 'white', border: '1px solid #334155', fontSize: '0.75rem' }}><option value={3}>T3</option><option value={2}>T2</option><option value={1}>T1</option></select></div>
          <button onClick={handleAutoCraft} disabled={gold < 500} style={{ width: '100%', padding: '8px', backgroundColor: gold >= 500 ? '#7c3aed' : '#334155', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}>Auto-Craft (500g)</button>
        </aside>
      </div>
      {offlineRewards && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0, 0, 0, 0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#1e293b', padding: '30px', borderRadius: '16px', border: '2px solid #3b82f6', maxWidth: '400px', width: '90%', textAlign: 'center' }}>
            <h2 style={{ color: '#3b82f6' }}>Welcome Back!</h2>
            <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Away: {Math.floor(offlineRewards.timeAway / 60)}m {offlineRewards.timeAway % 60}s</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', margin: '20px 0', padding: '15px', backgroundColor: '#0f172a', borderRadius: '12px', fontSize: '0.85rem' }}>
              <div><div style={{ color: '#64748b' }}>EXP</div><div>+{formatLargeNumber(offlineRewards.exp)}</div></div>
              <div><div style={{ color: '#64748b' }}>Gold</div><div style={{ color: '#fbbf24' }}>+{formatLargeNumber(offlineRewards.gold)}</div></div>
              <div><div style={{ color: '#64748b' }}>Kills</div><div>{offlineRewards.kills}</div></div>
              <div><div style={{ color: '#64748b' }}>Scrap</div><div style={{ color: '#60a5fa' }}>+{offlineRewards.scrap}</div></div>
            </div>
            <button onClick={claimOfflineRewards} style={{ width: '100%', padding: '12px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>Claim</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default IdleGame;
