# Idle Exile - Project Overview

An advanced Idle ARPG built with React, TypeScript, and Vite. This project simulates the core progression loops of modern ARPGs (like Path of Exile) in a streamlined, automated environment.

## 🕹️ Core Gameplay Systems

### 1. Combat & Scaling
- **Idle Combat Loop**: Fully automated real-time combat with monster respawn delays and zone-based scaling.
- **Dynamic Stats**: Player power is derived from Base Stats (level), Equipment Affixes, and Passive Skill Tree nodes.
- **Leveling System**: Exp-based progression for both the Player and equipped Active Skills.

### 2. Loot & Affix Engine (`src/utils/loot.ts`)
- **Procedural Generation**: Items drop with varying rarities (Normal, Magic, Rare).
- **Affix Database**: A weighted system for rolling Prefixes and Suffixes.
- **Dynamic Scaling**: Affix values and Item Levels scale with the Zone Level they dropped from.

### 3. Visual Passive Skill Tree (`src/utils/passiveTree.ts`)
- **Graph-Based Progression**: A connected adjacency-list structure with over 15+ nodes.
- **Multiple Archetypes**: Dedicated start nodes for Warrior, Mage, and Ranger paths.
- **Interactive Map**: A custom-built SVG and coordinate-based 2D map with panning/dragging functionality.

### 4. Active Skills System (`src/utils/skills.ts`)
- **Burst Damage**: Powerful skills (e.g., Heavy Strike, Fireball) that fire automatically based on cooldowns.
- **Skill Leveling**: Equipped skills gain a portion of monster EXP, increasing their damage multipliers over time.
- **Visual Feedback**: Screen-shake/Hit-flash effects and a dedicated purple-themed combat log for skill casts.

### 5. Advanced Crafting System
- **Manual Rolling**: Spend gold to roll random high-tier rare items.
- **Auto-Crafting Loop**: A high-efficiency "resource sink" where the system rolls items repeatedly (up to 1000x) until a specific target affix and tier (T1-T3) are hit.

### 6. Automated Economy & Filter
- **Customizable Loot Filter**: Define rules for specific rarities.
- **Actions**: Automatically `KEEP` (inventory), `SALVAGE` (scrap), or `SELL` (gold) loot based on player-defined priority.
- **Resource Recovery**: Salvaging items provides `Crafting Scrap`, used for late-game systems like Atlas modifications.

### 7. Atlas & Zone Empowerment (`src/utils/atlas.ts`)
- **Risk vs. Reward**: Roll "Zone Modifiers" using Scrap to increase monster HP/DPS in exchange for massive multipliers to EXP, Gold, and Loot Quantity.
- **Resonance Tokens**: A kill-based currency consumed to activate Empowered states on new monster spawns.

### 8. Persistence & Offline Gains
- **Auto-Save**: Serializes state to LocalStorage every 5 seconds.
- **Offline Calculation**: Uses a "Time To Kill" (TTK) mathematical model to simulate kills, EXP, and loot accumulated while the browser is closed.

## 🛠️ Technical Stack
- **Framework**: React 18+
- **Language**: TypeScript (Strict Typing)
- **Bundler**: Vite
- **Styling**: Vanilla CSS with dynamic inline styles for performance-heavy components (like the Passive Tree).

## 🚀 Development
```bash
npm install   # Install dependencies
npm run dev    # Start development server
npm run build  # Build for production
```

## 🏗️ Project Structure
- `src/components/`: Core UI logic (IdleGame.tsx handles the main loop).
- `src/utils/`: Specialized logic engines (Combat, Loot, Skills, PassiveTree, Atlas).
- `src/assets/`: Static game assets.
