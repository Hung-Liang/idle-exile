# Idle Exile - Detailed Project Overview

An advanced Idle ARPG built with React, TypeScript, and Vite. This project simulates the core progression loops of modern ARPGs (like Path of Exile) in a streamlined, automated environment.

## 🕹️ Core Gameplay Systems

### 1. Combat & Scaling
- **Idle Combat Loop**: Fully automated real-time combat with monster respawn delays (1s) and zone-based scaling.
- **Dynamic Stats**: Player power is derived from Base Stats (level), Equipment Affixes (T1-T3), and Passive Skill Tree nodes.
- **Leveling System**: Exp-based progression for both the Player and equipped Active Skills.

### 2. Loot & Affix Engine (`src/utils/loot.ts`)
- **Procedural Generation**: Items drop with varying rarities (Normal, Magic, Rare).
- **Affix Database**: A weighted system for rolling Prefixes and Suffixes.
- **Dynamic Scaling**: Affix values and Item Levels (iLv) scale with the Zone Level they dropped from.

### 3. Visual Passive Skill Tree (`src/utils/passiveTree.ts`)
- **Graph-Based Progression**: A connected adjacency-list structure with over 15+ nodes.
- **Multiple Archetypes**: Dedicated start nodes for Warrior, Mage, and Ranger paths.
- **Interactive Map**: A custom-built SVG and coordinate-based 2D map with panning/dragging functionality.

### 4. Active Skills System (`src/utils/skills.ts`)
- **Burst Damage**: Powerful skills (Heavy Strike, Fireball, Whirlwind) that fire automatically based on cooldowns.
- **Skill Leveling**: Equipped skills gain a portion of monster EXP, increasing their damage multipliers over time.
- **Visual Feedback**: Screen-shake/Hit-flash effects and a dedicated purple-themed scrolling combat log.

### 5. Advanced Crafting System
- **Manual Rolling**: Spend gold to roll random high-tier rare items.
- **Auto-Crafting Loop**: A high-efficiency "resource sink" where the system rolls items repeatedly (up to 1000x) until a specific target affix and tier (T1-T3) are hit.

### 6. Automated Economy & Filter
- **Customizable Loot Filter**: Define rules (KEEP, SALVAGE, SELL) for specific rarities via the FILTER tab.
- **Resource Recovery**: Salvaging items provides `Crafting Scrap`, used for ATLAS system.

### 7. Atlas & Zone Empowerment (`src/utils/atlas.ts`)
- **Zone Modifiers**: Roll random buffs/debuffs (e.g., Enemy HP +100%, Loot Drops +200%) using Scrap.
- **Resonance Tokens**: Consumable tokens (10% drop rate) used to activate Empowered states on monsters for massive rewards.

### 8. Persistence & Offline Gains
- **Auto-Save**: Serializes state to LocalStorage every 5 seconds.
- **Offline Calculation**: Uses a "Time To Kill" (TTK) mathematical model to simulate kills, EXP, and loot accumulated while the browser is closed.

## 🛠️ Technical Stack
- **Framework**: React 18+
- **Language**: TypeScript (Strict Typing)
- **Bundler**: Vite
- **Styling**: Vanilla CSS + Dynamic SVG + Inline Transforms.
