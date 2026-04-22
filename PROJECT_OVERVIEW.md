# Idle Exile - Detailed Project Overview

An advanced Idle ARPG built with React, TypeScript, and Vite. This project simulates the core progression loops of modern ARPGs (like Path of Exile) in a streamlined, automated environment.

## 🕹️ Core Gameplay Systems

### 1. Combat & Progression
- **Idle Combat Loop**: Fully automated real-time combat with monster respawn delays (1s) and zone-based scaling.
- **Auto-Advance Zone**: A toggleable feature that automatically progresses the player to the next zone upon reaching the 10-kill threshold.
- **Dynamic Stats**: Player power is derived from Base Stats (level), Equipment Affixes (T1-T3), and Passive Skill Tree nodes.
- **Leveling System**: Exp-based progression for both the Player and equipped Active Skills.

### 2. Loot & Affix Engine (`src/utils/loot.ts`)
- **Procedural Generation**: Items drop with varying rarities: **Normal, Magic, Rare, and Unique**.
- **Affix Database**: A weighted system for rolling Prefixes and Suffixes.
- **Dynamic Scaling**: Affix values and Item Levels (iLv) scale with the Zone Level they dropped from.
- **Total Stat Evaluation**: Advanced tooltips that show the sum of all affixes on an item.

### 3. Visual Passive Skill Tree (`src/utils/passiveTree.ts`)
- **Graph-Based Progression**: A connected adjacency-list structure with over 15+ nodes.
- **Multiple Archetypes**: Dedicated start nodes for Warrior, Mage, and Ranger paths.
- **Interactive Map**: A custom-built SVG and coordinate-based 2D map with panning/dragging functionality.

### 4. Active Skills System (`src/utils/skills.ts`)
- **Burst Damage**: Powerful skills (Heavy Strike, Fireball, Whirlwind) that fire automatically based on cooldowns.
- **Skill Leveling**: Equipped skills gain a portion of monster EXP, increasing their damage multipliers and efficiency over time.
- **Visual Feedback**: Screen-shake/Hit-flash effects and a dedicated purple-themed scrolling combat log.

### 5. Advanced Crafting & Economy
- **Manual & Auto-Crafting**: Spend gold to roll random high-tier rare items. The "Auto-Craft" feature can loop up to 1000 times to hunt for specific Tier 1 affixes.
- **Batch Inventory Actions**: One-click "Salvage All" and "Sell All" functionality to manage large volumes of loot efficiently.
- **Loot Filter**: A customizable rule-based engine to automatically KEEP, SALVAGE, or SELL items based on rarity.

### 6. Atlas & Endgame Mapping (`src/utils/atlas.ts`)
- **Map Device**: Craft custom "Maps" using Crafting Scrap for high-density farming.
- **Map Modifiers**: Randomly rolled buffs/debuffs (e.g., Enemy HP +100%, Loot Drops +200%).
- **Map Corruption**: Use **Corruption Catalysts** to empower maps, increasing both difficulty and rewards.
- **Instability System**: Corrupted maps feature "Instability," which increases difficulty and reward multipliers (+5% per level) as monsters are slain.
- **Dynamic UI**: Modifier text updates in real-time to reflect the current Instability multiplier.
- **Escape Functionality**: Players can manually escape an active map at any time to return to safe farming.

### 7. User Interface & Experience
- **Refined Sidebars**: A professionally structured Stats sidebar with logical groupings (Basic, Resources, Combat) and clear labeling.
- **Responsive Navigation**: Tab-based main interface (Inventory, Passives, Skills, Filter, Atlas) for clear progression management.
- **Real-time Feedback**: Dynamic progress bars for HP, EXP, and Skill Cooldowns.

### 8. Persistence & Offline Gains
- **State Persistence**: Serializes all player data, including equipment, passives, maps, and filters, to LocalStorage every 5 seconds.
- **Offline Calculation**: Uses a mathematical "Time To Kill" (TTK) model to simulate combat, EXP, gold, and scrap accumulation while the player is away.

## 🛠️ Technical Stack
- **Framework**: React 18+ (Hooks-heavy architecture: `useState`, `useEffect`, `useMemo`, `useRef`)
- **Language**: TypeScript (Strict Typing for items, skills, and map instances)
- **Bundler**: Vite
- **Styling**: Vanilla CSS + Dynamic SVG + Inline Transforms + CSS Animations.
