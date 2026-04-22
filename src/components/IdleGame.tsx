
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
import { generateZoneModifiers, calculateMapMultipliers, corruptModifiers } from '../utils/atlas';
import type { ZoneModifier, MapInstance } from '../utils/atlas';

const TICK_RATE = 0.1; // 100ms

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
        transition: 'width 0.1s linear'
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
  const [allocatedPassiveNodes, setAllocatedPassiveNodes] = useState<string[]>([]);
  const [unlockedSkills, setUnlockedSkills] = useState<PlayerSkill[]>(SKILL_DATABASE.map(s => ({ ...s, level: 1, currentExp: 0 })));
  const [equippedSkillIds, setEquippedSkillIds] = useState<string[]>([]);
  const [skillCooldowns, setSkillCooldowns] = useState<Record<string, number>>({});
  const [currentPlayerHP, setCurrentPlayerHP] = useState(100);
  const [currentEnemyHP, setCurrentEnemyHP] = useState(50);
  const [currentEnemyMaxHP, setCurrentEnemyMaxHP] = useState(50);
  const [isRespawning, setIsRespawning] = useState(false);
  
  // Combat & Progression State
  const [isCombatPaused, setIsCombatPaused] = useState(false);
  const [highestUnlockedZone, setHighestUnlockedZone] = useState(1);
  const [targetFarmingZone, setTargetFarmingZone] = useState(1);
  const [autoProgressZone, setAutoProgressZone] = useState(true);
  const [killsInCurrentZone, setKillsInCurrentZone] = useState(0);
  const [playerAttackTimer, setPlayerAttackTimer] = useState(0);
  const [enemyAttackTimer, setEnemyAttackTimer] = useState(0);

  // Mapping System State
  const [activeMap, setActiveMap] = useState<MapInstance | null>(null);
  const [stagedMap, setStagedMap] = useState<MapInstance | null>(null);
  const [corruptionCatalysts, setCorruptionCatalysts] = useState(0);

  const [inventory, setInventory] = useState<Item[]>([]);
  const [equipment, setEquipment] = useState<Record<ItemSlot, Item | null>>({ WEAPON: null, ARMOR: null, ACCESSORY: null });
  const [combatLogs, setCombatLogs] = useState<string[]>(["Game Started"]);
  const [currentTab, setCurrentTab] = useState<'INVENTORY' | 'PASSIVES' | 'SKILLS' | 'FILTER' | 'ATLAS'>('INVENTORY');
  const [damageFlash, setDamageFlash] = useState(false);
  const [offlineRewards, setOfflineRewards] = useState<{ timeAway: number; exp: number; gold: number; scrap: number; kills: number; } | null>(null);
  
  // Loot Filter State (Start Empty)
  const [filterRules, setFilterRules] = useState<{id: number, rarity: string, action: string}[]>([]);

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
    damageReduction: Math.min(0.9, baseStats.damageReduction + gearStats.dr + passiveStats.dr),
    attackSpeed: baseStats.attackSpeed, // Simple for now
    hpRegen: baseStats.hpRegeneration
  }), [baseStats, gearStats, passiveStats]);

  const unspentPassivePoints = (playerLevel - 1) - allocatedPassiveNodes.length;
  const expToNextLevel = calculateExpToNextLevel(playerLevel);
  const baseMonsterConfig = useMemo(() => ({ baseEhp: 50, baseDps: 10, baseExp: 10, baseGold: 5 }), []);

  const stateRef = useRef({ 
    playerLevel, currentExp, gold, craftingScrap, targetFarmingZone, highestUnlockedZone, autoProgressZone, allocatedPassiveNodes,
    unlockedSkills, equippedSkillIds, inventory, equipment, finalStats, currentPlayerHP, currentEnemyHP, isRespawning, skillCooldowns, offlineRewards,
    corruptionCatalysts, activeMap, stagedMap, isCombatPaused, filterRules, killsInCurrentZone, playerAttackTimer, enemyAttackTimer
  });

  useEffect(() => {
    stateRef.current = { 
      playerLevel, currentExp, gold, craftingScrap, targetFarmingZone, highestUnlockedZone, autoProgressZone, allocatedPassiveNodes,
      unlockedSkills, equippedSkillIds, inventory, equipment, finalStats, currentPlayerHP, currentEnemyHP, isRespawning, skillCooldowns, offlineRewards,
      corruptionCatalysts, activeMap, stagedMap, isCombatPaused, filterRules, killsInCurrentZone, playerAttackTimer, enemyAttackTimer
    };
  }, [playerLevel, currentExp, gold, craftingScrap, targetFarmingZone, highestUnlockedZone, autoProgressZone, allocatedPassiveNodes, unlockedSkills, equippedSkillIds, inventory, equipment, finalStats, currentPlayerHP, currentEnemyHP, isRespawning, skillCooldowns, offlineRewards, corruptionCatalysts, activeMap, stagedMap, isCombatPaused, filterRules, killsInCurrentZone, playerAttackTimer, enemyAttackTimer]);

  // --- HELPERS ---
  const addLog = (msg: string) => setCombatLogs(prev => [msg, ...prev].slice(0, 10));

  const saveGame = () => {
    const data = {
      playerLevel: stateRef.current.playerLevel, currentExp: stateRef.current.currentExp, gold: stateRef.current.gold,
      craftingScrap: stateRef.current.craftingScrap, targetFarmingZone: stateRef.current.targetFarmingZone,
      highestUnlockedZone: stateRef.current.highestUnlockedZone, allocatedPassiveNodes: stateRef.current.allocatedPassiveNodes,
      unlockedSkills: stateRef.current.unlockedSkills, equippedSkillIds: stateRef.current.equippedSkillIds,
      inventory: stateRef.current.inventory, equipment: stateRef.current.equipment, filterRules: stateRef.current.filterRules,
      corruptionCatalysts: stateRef.current.corruptionCatalysts, killsInCurrentZone: stateRef.current.killsInCurrentZone, lastSaved: Date.now()
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  };

  useEffect(() => {
    const timer = setInterval(saveGame, 5000);
    return () => clearInterval(timer);
  }, []);

  const spawnMonster = (level: number) => {
    setIsRespawning(false);
    const s = stateRef.current;
    const monster = getMonsterStats(baseMonsterConfig, level);
    
    let hp = monster.baseEhp;
    if (s.activeMap) {
      const z = calculateMapMultipliers(s.activeMap.modifiers);
      const instMult = s.activeMap.isCorrupted ? (1 + s.activeMap.instability * 0.05) : 1;
      hp *= (z.enemyHP * instMult);
    }

    setCurrentEnemyHP(hp);
    setCurrentEnemyMaxHP(hp);
    setEnemyAttackTimer(1 / monster.attackSpeed);
    addLog(`Fighting Lv ${level} ${s.activeMap ? 'MAP ' : ''}Monster`);
  };

  useEffect(() => {
    const saved = localStorage.getItem(SAVE_KEY);
    if (saved) {
      const data = JSON.parse(saved);
      setPlayerLevel(data.playerLevel); setCurrentExp(data.currentExp); setGold(data.gold);
      setCraftingScrap(data.craftingScrap || 0); setTargetFarmingZone(data.targetFarmingZone || 1);
      setHighestUnlockedZone(data.highestUnlockedZone || 1);
      setAllocatedPassiveNodes(data.allocatedPassiveNodes || []); setUnlockedSkills(data.unlockedSkills || []);
      setEquippedSkillIds(data.equippedSkillIds || []); setInventory(data.inventory || []); setEquipment(data.equipment || {});
      setFilterRules(data.filterRules || [{ id: 1, rarity: "MAGIC", action: "SALVAGE" }, { id: 2, rarity: "RARE", action: "KEEP" }]);
      setCorruptionCatalysts(data.corruptionCatalysts || 0);
      setKillsInCurrentZone(data.killsInCurrentZone || 0);

      const secondsAway = Math.floor((Date.now() - data.lastSaved) / 1000);
      if (secondsAway > 60) {
        const monster = getMonsterStats(baseMonsterConfig, data.targetFarmingZone || 1);
        const ttk = Math.max(1, Math.ceil(monster.baseEhp / calculatePlayerStats(data.playerLevel).dps));
        const totalKills = Math.floor(secondsAway / (ttk + 1));
        if (totalKills > 0) {
          const mult = Math.pow(1.1, (data.targetFarmingZone || 1) - 1);
          setOfflineRewards({
            timeAway: secondsAway, exp: totalKills * monster.baseExp * mult,
            gold: totalKills * monster.baseGold * mult,
            scrap: Math.floor(totalKills * 0.3 * 0.7 * ((data.targetFarmingZone || 1) * 2)),
            kills: totalKills
          });
        }
      }
    }
    spawnMonster(targetFarmingZone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const processLootDrop = (rarity: string, itemLevel: number, multiplier: number = 1) => {
    const chance = 0.3 * multiplier;
    if (Math.random() > chance) return;
    const item = generateItem(rarity as any, itemLevel);
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

  const handleMonsterDeath = (s: any, earnedExp: number, earnedGold: number) => {
    let expMult = 1; let goldMult = 1; let lootMult = 1;
    
    if (Math.random() < 0.02) {
      setCorruptionCatalysts(prev => prev + 1);
      addLog(">>> Monster dropped a Corruption Catalyst! <<<");
    }

    if (s.activeMap) {
      const z = calculateMapMultipliers(s.activeMap.modifiers);
      const instMult = s.activeMap.isCorrupted ? (1 + s.activeMap.instability * 0.05) : 1;
      expMult = z.expMult * instMult; goldMult = z.goldMult * instMult; lootMult = z.lootQty * instMult;
      
      setActiveMap(prev => prev ? { 
        ...prev, 
        remainingKills: prev.remainingKills - 1,
        instability: prev.isCorrupted ? prev.instability + 1 : prev.instability
      } : null);

      if (s.activeMap.remainingKills <= 1) {
        setActiveMap(null);
        addLog("MAP COMPLETE! Reverting to normal farming.");
      }
    } else {
      // Normal progression 10-kill rule
      if (s.targetFarmingZone === s.highestUnlockedZone) {
        const nextKills = s.killsInCurrentZone + 1;
        if (nextKills >= 10) {
          setHighestUnlockedZone(prev => prev + 1);
          setTargetFarmingZone(prev => prev + 1);
          setKillsInCurrentZone(0);
        } else {
          setKillsInCurrentZone(nextKills);
        }
      }
    }

    const finalExp = earnedExp * expMult;
    const finalGold = earnedGold * goldMult;

    setUnlockedSkills(prev => prev.map(sk => {
      if (!s.equippedSkillIds.includes(sk.id)) return sk;
      let newSkExp = sk.currentExp + finalExp * 0.5;
      let newSkLevel = sk.level;
      let req = calculateSkillExpToNextLevel(sk.baseExpRequired, newSkLevel);
      while (newSkExp >= req) { newSkExp -= req; newSkLevel++; req = calculateSkillExpToNextLevel(sk.baseExpRequired, newSkLevel); }
      return { ...sk, level: newSkLevel, currentExp: newSkExp };
    }));

    let newExp = s.currentExp + finalExp;
    let newLevel = s.playerLevel;
    let req = calculateExpToNextLevel(newLevel);
    while (newExp >= req) { newExp -= req; newLevel++; req = calculateExpToNextLevel(newLevel); }
    if (newLevel !== s.playerLevel) {
      const pStats = calculatePlayerStats(newLevel); const gStats = calculateItemStats(Object.values(equipment));
      const psStats = calculatePassiveStats(allocatedPassiveNodes);
      setCurrentPlayerHP(pStats.hp + gStats.hp + psStats.hp); setPlayerLevel(newLevel);
    }
    setCurrentExp(newExp); setGold(s.gold + finalGold);
    processLootDrop(Math.random() < 0.7 ? 'MAGIC' : 'RARE', s.targetFarmingZone, lootMult);
    setIsRespawning(true); setCurrentEnemyHP(0);
    setTimeout(() => spawnMonster(stateRef.current.targetFarmingZone), 1000);
  };

  useEffect(() => {
    const tickInterval = setInterval(() => {
      const s = stateRef.current;
      if (s.offlineRewards || s.isCombatPaused) return;

      // 1. HP Regeneration (Always happens)
      setCurrentPlayerHP(prev => Math.min(s.finalStats.hp, prev + (s.finalStats.hp * s.finalStats.hpRegen * TICK_RATE)));

      // 2. Cooldowns (Always progress)
      const nextCDs = { ...s.skillCooldowns };
      s.equippedSkillIds.forEach(id => { if (nextCDs[id] > 0) nextCDs[id] = Math.max(0, nextCDs[id] - TICK_RATE); });
      setSkillCooldowns(nextCDs);

      if (s.isRespawning || s.currentEnemyHP <= 0) return;

      const monster = getMonsterStats(baseMonsterConfig, s.targetFarmingZone);
      let mHP = s.currentEnemyHP;
      let pTimer = s.playerAttackTimer - TICK_RATE;
      let eTimer = s.enemyAttackTimer - TICK_RATE;

      // 3. Player Attacks
      if (pTimer <= 0) {
        let died = false;
        let totalHitDmg = 0;

        // Try skills first
        s.equippedSkillIds.forEach(id => {
          if (died) return;
          const sk = s.unlockedSkills.find(x => x.id === id);
          if (sk && (nextCDs[id] || 0) === 0) {
            const d = calculateSkillDamage(s.finalStats.dps, sk);
            totalHitDmg += d;
            nextCDs[id] = sk.cooldownTicks;
            addLog(`>>> CAST [${sk.name}]: ${formatLargeNumber(d)} <<<`);
            setDamageFlash(true); setTimeout(() => setDamageFlash(false), 150);
          }
        });

        // Add base hit damage: DPS / AttackSpeed
        const hitDmg = s.finalStats.dps / s.finalStats.attackSpeed;
        totalHitDmg += hitDmg;
        mHP -= totalHitDmg;
        pTimer = 1 / s.finalStats.attackSpeed;

        if (mHP <= 0) {
          const mult = Math.pow(1.1, s.targetFarmingZone - 1);
          handleMonsterDeath(s, monster.baseExp * mult, monster.baseGold * mult);
          setPlayerAttackTimer(pTimer);
          return;
        }
      }

      // 4. Enemy Attacks
      if (eTimer <= 0) {
        let mDps = monster.baseDps;
        if (s.activeMap) {
          const z = calculateMapMultipliers(s.activeMap.modifiers);
          const instMult = s.activeMap.isCorrupted ? (1 + s.activeMap.instability * 0.05) : 1;
          mDps *= (z.enemyDPS * instMult);
        }
        
        const hitDmg = (mDps / monster.attackSpeed) * (1 - s.finalStats.damageReduction);
        const nextPHP = Math.max(0, s.currentPlayerHP - hitDmg);
        eTimer = 1 / monster.attackSpeed;

        if (nextPHP <= 0) {
          if (s.activeMap) { setActiveMap(null); addLog("MAP FAILED!"); }
          const prev = Math.max(1, s.targetFarmingZone - 1);
          setTargetFarmingZone(prev); setCurrentPlayerHP(s.finalStats.hp);
          setKillsInCurrentZone(0);
          spawnMonster(prev); addLog(`Died! Retreating.`);
          setPlayerAttackTimer(1); // Reset timers on death
          setEnemyAttackTimer(1);
          return;
        }
        setCurrentPlayerHP(nextPHP);
      }

      setCurrentEnemyHP(mHP);
      setPlayerAttackTimer(pTimer);
      setEnemyAttackTimer(eTimer);
      setSkillCooldowns(nextCDs);

    }, 1000 * TICK_RATE);
    return () => clearInterval(tickInterval);
  }, [offlineRewards, isCombatPaused]);

  // --- HANDLERS ---
  const handleRollZone = () => {
    if (craftingScrap >= 100) {
      setCraftingScrap(prev => prev - 100);
      setStagedMap({ modifiers: generateZoneModifiers(), remainingKills: 100, isCorrupted: false, instability: 0 });
      addLog("Rolled a new Map!");
    }
  };
  const handleCorruptMap = () => {
    if (stagedMap && !stagedMap.isCorrupted && corruptionCatalysts > 0) {
      setCorruptionCatalysts(prev => prev - 1);
      setStagedMap({ ...stagedMap, isCorrupted: true, modifiers: corruptModifiers(stagedMap.modifiers) });
      addLog(">>> MAP CORRUPTED <<<");
    }
  };
  const handleOpenMap = () => {
    if (stagedMap && !activeMap) {
      setActiveMap({ ...stagedMap }); setStagedMap(null);
      addLog(`Map Opened!`);
    }
  };
  const handleRollItem = () => { if (gold >= 100) { setGold(prev => prev - 100); processLootDrop('RARE', targetFarmingZone); } };
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
      att++; curG -= 500; const ni = generateItem('RARE', targetFarmingZone);
      if ([...ni.prefixes, ...ni.suffixes].some(a => a.group === targetAffixGroup && a.tier <= minTier)) { ok = true; res = ni; break; }
    }
    setGold(curG); if (ok && res) { setInventory(p => [res!, ...p]); addLog(`Auto-Craft SUCCESS!`); } else addLog(`Auto-Craft FAILED.`);
  };
  const handleEquipSkill = (id: string) => { if (equippedSkillIds.length < 3 && !equippedSkillIds.includes(id)) { setEquippedSkillIds(p => [...p, id]); setSkillCooldowns(p => ({ ...p, [id]: 0 })); } };
  const handleUnequipSkill = (id: string) => setEquippedSkillIds(p => p.filter(sid => sid !== id));
  const handleAllocatePassive = (id: string) => { if (isNodeAllocatable(id, allocatedPassiveNodes, unspentPassivePoints)) setAllocatedPassiveNodes(p => [...p, id]); };
  const handleAddFilterRule = (r: string, a: string) => { setFilterRules(prev => { const f = prev.filter(x => x.rarity !== r); return [...f, { id: Date.now(), rarity: r, action: a }]; }); };
  const handleRemoveFilterRule = (id: number) => { setFilterRules(prev => prev.filter(r => r.id !== id)); };

  const renderAffixes = (item: Item) => {
    const totals = calculateItemStats([item]);
    return (
      <div style={{ marginTop: '8px', borderTop: '1px solid #334155', paddingTop: '8px' }}>
        <div style={{ marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px dashed #334155' }}>
          <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase' }}>Total Stats</div>
          {totals.dps > 0 && <div style={{ fontSize: '0.8rem', color: '#f8fafc', fontWeight: 'bold' }}>+{formatLargeNumber(totals.dps)} DPS</div>}
          {totals.hp > 0 && <div style={{ fontSize: '0.8rem', color: '#f8fafc', fontWeight: 'bold' }}>+{formatLargeNumber(totals.hp)} HP</div>}
          {totals.dr > 0 && <div style={{ fontSize: '0.8rem', color: '#f8fafc', fontWeight: 'bold' }}>+{(totals.dr * 100).toFixed(1)}% DR</div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {[...item.prefixes, ...item.suffixes].map(a => (
            <div key={a.id} style={{ fontSize: '0.75rem', color: '#e2e8f0', display: 'flex', justifyContent: 'space-between' }}>
              <span>+{a.statKey === 'dr' ? (a.value * 100).toFixed(1) + '%' : a.value} {a.statKey.toUpperCase()}</span>
              <span style={{ fontSize: '0.6rem', color: '#64748b' }}>{a.name} (T{a.tier})</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '20px', color: '#e2e8f0' }}>
      <style>{`
        @keyframes hitFlash { 0% { filter: brightness(1); } 50% { filter: brightness(2); transform: scale(1.02); } 100% { filter: brightness(1); transform: scale(1); } }
        .hit-flash { animation: hitFlash 0.15s ease-out; }
        .log-entry { margin-bottom: 4px; padding: 2px 8px; border-radius: 4px; border-left: 3px solid transparent; }
        .log-skill { background-color: rgba(124, 58, 237, 0.1); border-left-color: #7c3aed; color: #a78bfa; font-weight: bold; }
        .log-normal { border-left-color: #334155; }
      `}</style>

      <section style={{ backgroundColor: '#1e293b', padding: '15px', borderRadius: '12px', border: '1px solid #334155', marginBottom: '10px', display: 'flex', gap: '20px', alignItems: 'center', justifyContent: 'center' }}>
        <button onClick={() => setIsCombatPaused(!isCombatPaused)} style={{ padding: '8px 20px', backgroundColor: isCombatPaused ? '#059669' : '#7f1d1d', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
          {isCombatPaused ? 'RESUME' : 'PAUSE'}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>Zone:</span>
          <select value={targetFarmingZone} onChange={(e) => { const z = Number(e.target.value); setTargetFarmingZone(z); spawnMonster(z); }} style={{ padding: '5px', backgroundColor: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: '4px' }}>
            {Array.from({ length: highestUnlockedZone }, (_, i) => i + 1).map(z => <option key={z} value={z}>Zone {z}</option>)}
          </select>
          {!activeMap && <span style={{ fontSize: '0.8rem', color: '#fbbf24' }}>Progress: {killsInCurrentZone}/10 Kills</span>}
        </div>
      </section>

      <section style={{ backgroundColor: '#1e293b', padding: '20px', borderRadius: '12px', border: '1px solid #334155', marginBottom: '20px' }}>
        <div style={{ height: '120px', overflowY: 'auto', marginBottom: '20px', padding: '10px', backgroundColor: '#0f172a', borderRadius: '8px', fontSize: '0.85rem', display: 'flex', flexDirection: 'column-reverse' }}>
          {combatLogs.map((log, i) => <div key={i} className={log.includes('>>>') ? 'log-entry log-skill' : 'log-entry log-normal'}>{log}</div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
          <ProgressBar value={currentPlayerHP} max={finalStats.hp} color="#10b981" label="Player HP" />
          <div className={damageFlash ? 'hit-flash' : ''}>
            <ProgressBar value={currentEnemyHP} max={currentEnemyMaxHP} color="#ef4444" label={isRespawning ? "Respawning..." : (activeMap ? `Map Monster (${activeMap.remainingKills} left)` : "Monster")} />
          </div>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr 240px', gap: '20px' }}>
        <aside style={{ backgroundColor: '#1e293b', padding: '15px', borderRadius: '8px' }}>
          <h3>Stats</h3>
          <p>Lv: {playerLevel} | Gold: {formatLargeNumber(gold)}</p>
          <p>Scrap: {formatLargeNumber(craftingScrap)} | Cats: {corruptionCatalysts}</p>
          <div style={{ fontSize: '0.8rem', lineHeight: '1.6' }}>
            <div>DPS: {formatLargeNumber(finalStats.dps)} | HP: {formatLargeNumber(finalStats.hp)}</div>
            <div>AS: {finalStats.attackSpeed.toFixed(1)} | Regen: 5%/s</div>
          </div>
          <ProgressBar value={currentExp} max={expToNextLevel} color="#3b82f6" label="EXP" />
        </aside>

        <main style={{ backgroundColor: '#1e293b', padding: '15px', borderRadius: '8px' }}>
          <div style={{ display: 'flex', gap: '5px', marginBottom: '15px' }}>
            {['INVENTORY', 'PASSIVES', 'SKILLS', 'FILTER', 'ATLAS'].map(t => (
              <button key={t} onClick={() => setCurrentTab(t as any)} style={{ padding: '6px 12px', borderRadius: '4px', border: 'none', cursor: 'pointer', backgroundColor: currentTab === t ? '#3b82f6' : '#334155', color: 'white', fontSize: '0.8rem' }}>{t}</button>
            ))}
          </div>

          {currentTab === 'INVENTORY' ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '15px' }}>{(['WEAPON', 'ARMOR', 'ACCESSORY'] as ItemSlot[]).map(s => {
                const itm = equipment[s];
                return (
                  <div key={s} style={{ border: '1px solid #334155', padding: '8px', backgroundColor: '#0f172a', fontSize: '0.7rem' }}>
                    <div style={{ color: '#64748b' }}>{s}</div>
                    {itm ? <div onClick={() => handleUnequip(s)} style={{ color: '#fbbf24', cursor: 'pointer' }} title={itm.prefixes.concat(itm.suffixes).map(a => `${a.name}: +${a.value}`).join('\n')}>{itm.name}</div> : 'Empty'}
                  </div>
                );
              })}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', height: '300px', overflowY: 'auto' }}>{inventory.map(item => (
                <div key={item.id} style={{ border: '1px solid #334155', padding: '10px', backgroundColor: '#0f172a' }}>
                  <div style={{ color: '#fbbf24', fontSize: '0.75rem', fontWeight: 'bold' }}>{item.name} (iLv {item.itemLevel})</div>
                  {renderAffixes(item)}
                  <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                    <button onClick={() => handleEquip(item)} style={{ flex: 1, backgroundColor: '#059669', border: 'none', color: 'white', fontSize: '0.6rem', padding: '2px', cursor: 'pointer' }}>Equip</button>
                    <button onClick={() => handleSalvage(item)} style={{ flex: 1, backgroundColor: '#4b5563', border: 'none', color: 'white', fontSize: '0.6rem', padding: '2px', cursor: 'pointer' }}>Salvage</button>
                  </div>
                </div>
              ))}</div>
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
              <h3 style={{ fontSize: '1rem', marginBottom: '10px' }}>Loot Filter</h3>
              <div style={{ backgroundColor: '#0f172a', padding: '15px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #334155' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '10px', alignItems: 'end' }}>
                  <div><label style={{ fontSize: '0.65rem', color: '#94a3b8', display: 'block', marginBottom: '5px' }}>RARITY</label><select id="rarity-select" style={{ width: '100%', padding: '5px', backgroundColor: '#1e293b', color: 'white', border: '1px solid #334155', borderRadius: '4px' }}><option value="NORMAL">NORMAL</option><option value="MAGIC">MAGIC</option><option value="RARE">RARE</option></select></div>
                  <div><label style={{ fontSize: '0.65rem', color: '#94a3b8', display: 'block', marginBottom: '5px' }}>ACTION</label><select id="action-select" style={{ width: '100%', padding: '5px', backgroundColor: '#1e293b', color: 'white', border: '1px solid #334155', borderRadius: '4px' }}><option value="KEEP">KEEP</option><option value="SALVAGE">SALVAGE</option><option value="SELL_FOR_GOLD">SELL</option></select></div>
                  <button onClick={() => { const r = (document.getElementById('rarity-select') as HTMLSelectElement).value; const a = (document.getElementById('action-select') as HTMLSelectElement).value; handleAddFilterRule(r, a); }} style={{ padding: '6px 15px', backgroundColor: '#3b82f6', border: 'none', borderRadius: '4px', color: 'white', cursor: 'pointer', fontWeight: 'bold' }}>Add</button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>{filterRules.map(rule => (<div key={rule.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 15px', backgroundColor: '#0f172a', borderRadius: '6px', borderLeft: '4px solid #3b82f6' }}><span style={{ fontSize: '0.85rem' }}>IF <strong style={{ color: '#fbbf24' }}>{rule.rarity}</strong> THEN <strong style={{ color: '#10b981' }}>{rule.action.replace(/_/g, ' ')}</strong></span><button onClick={() => handleRemoveFilterRule(rule.id)} style={{ backgroundColor: '#7f1d1d', border: 'none', color: 'white', padding: '3px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem' }}>Delete</button></div>))}</div>
            </div>
          ) : currentTab === 'ATLAS' ? (
            <div style={{ height: '400px', overflowY: 'auto' }}>
              <h3 style={{ marginBottom: '20px' }}>Atlas Map Device</h3>
              <div style={{ backgroundColor: '#0f172a', padding: '15px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #334155' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}><span>Scrap: {formatLargeNumber(craftingScrap)}</span></div>
                <button onClick={handleRollZone} disabled={craftingScrap < 100} style={{ width: '100%', padding: '10px', backgroundColor: craftingScrap >= 100 ? '#4f46e5' : '#334155', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Craft Map (100 Scrap)</button>
              </div>
              {stagedMap && (
                <div style={{ backgroundColor: stagedMap.isCorrupted ? 'rgba(127, 29, 29, 0.2)' : 'rgba(124, 58, 237, 0.1)', padding: '15px', borderRadius: '8px', border: `1px solid ${stagedMap.isCorrupted ? '#ef4444' : '#7c3aed'}`, marginBottom: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h4 style={{ margin: 0, color: stagedMap.isCorrupted ? '#ef4444' : '#a78bfa' }}>{stagedMap.isCorrupted ? 'CORRUPTED MAP' : 'Staged Map'}</h4>
                    {!stagedMap.isCorrupted && <button onClick={handleCorruptMap} disabled={corruptionCatalysts <= 0} style={{ padding: '4px 10px', backgroundColor: corruptionCatalysts > 0 ? '#ef4444' : '#334155', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 'bold' }}>Corrupt (1 Cat)</button>}
                  </div>
                  {stagedMap.modifiers.map((m, i) => <div key={i} style={{ fontSize: '0.85rem', marginBottom: '4px' }}>• {m.text}</div>)}
                  <button onClick={handleOpenMap} disabled={!!activeMap} style={{ marginTop: '15px', width: '100%', padding: '10px', backgroundColor: activeMap ? '#334155' : (stagedMap.isCorrupted ? '#b91c1c' : '#7c3aed'), color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>{activeMap ? 'Map Active' : 'Open Map'}</button>
                </div>
              )}
              {activeMap && (
                <div style={{ backgroundColor: activeMap.isCorrupted ? 'rgba(127, 29, 29, 0.2)' : 'rgba(5, 150, 105, 0.1)', padding: '15px', borderRadius: '8px', border: `1px solid ${activeMap.isCorrupted ? '#ef4444' : '#059669'}` }}>
                  <h4 style={{ margin: '0 0 10px 0', color: activeMap.isCorrupted ? '#ef4444' : '#34d399' }}>{activeMap.isCorrupted ? `CORRUPTED (Instability: ${activeMap.instability})` : 'Active Map'}</h4>
                  <div style={{ fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '10px' }}>{activeMap.remainingKills} Kills Left</div>
                  {activeMap.modifiers.map((m, i) => <div key={i} style={{ fontSize: '0.85rem', marginBottom: '4px' }}>• {m.text}</div>)}
                </div>
              )}
            </div>
          ) : (
            <div style={{ height: '400px', overflowY: 'auto' }}>{unlockedSkills.map(sk => { const isEq = equippedSkillIds.includes(sk.id); const cd = skillCooldowns[sk.id] || 0; return <div key={sk.id} style={{ backgroundColor: '#0f172a', padding: '10px', borderRadius: '6px', marginBottom: '8px', border: isEq ? '1px solid #3b82f6' : '1px solid #334155' }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}><span style={{ fontWeight: 'bold' }}>{sk.name} (Lv {sk.level})</span><button onClick={() => isEq ? handleUnequipSkill(sk.id) : handleEquipSkill(sk.id)} style={{ padding: '2px 8px', backgroundColor: isEq ? '#7f1d1d' : '#059669', border: 'none', color: 'white' }}>{isEq ? 'Unequip' : 'Equip'}</button></div><div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>CD: {sk.cooldownTicks}s | Cur: {cd.toFixed(1)}s</div><ProgressBar value={sk.currentExp} max={calculateSkillExpToNextLevel(sk.baseExpRequired, sk.level)} color="#8b5cf6" label="Skill EXP" /></div>; })}</div>
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
