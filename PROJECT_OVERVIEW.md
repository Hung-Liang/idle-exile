# Project Idle Exile - Technical Overview

A web-based Idle ARPG inspired by Path of Exile, built with React and TypeScript.

## 🛠 Core Architecture

### 1. Combat Engine (`src/utils/combat.ts`)
- **Tiered Scaling Curves**: Implements segmented exponential growth for monster EHP and DPS to balance progression.
  - Level 1-100: 1.15x per level
  - Level 101-500: 1.08x per level
  - Level 501+: 1.02x per level
- **Real-time Simulation**: Handles damage over time (ticks) considering Player DPS and Monster DPS vs. Damage Reduction.

### 2. Loot & Affix System (`src/utils/loot.ts`)
- **Affix Database**: A collection of Prefixes and Suffixes with weighted tiers (T1, T2).
- **Weighted Generation**: Rare items roll 4-6 affixes (max 3 prefixes/suffixes) based on weighted probabilities.
- **Dynamic Stat Calculation**: Aggregates all equipped item affixes to compute final player stats (DPS, HP, Damage Reduction).

### 3. Game Loop (`src/components/IdleGame.tsx`)
- **Tick-based System**: Uses `setInterval` (1 tick = 1 second) to process real-time combat and HP updates.
- **Progression/Retreat Logic**: 
  - **Win**: Grants EXP/Gold, restores HP, and advances to the next level.
  - **Loss**: On player death, restores HP and retreats to the previous zone.

## ✨ Implemented Features

- **Real-time Combat UI**: Visual HP bars for both player and monsters with smooth transitions.
- **Character Progression**: Automatic leveling system with exponential EXP requirements and base stat growth.
- **Equipment Management**: 3 slots (Weapon, Armor, Accessory) with full Equip, Unequip, and Sell functionality.
- **Crafting System**: A "Roll Rare" mechanism that consumes Gold to generate randomized equipment with visible affix tiers.
- **Dark Mode UI**: High-contrast theme using dark slate backgrounds and vibrant stat colors for better readability.
- **CI/CD Integration**: Automated GitHub Pages deployment via GitHub Actions.

## 📁 File Structure
- `src/utils/combat.ts`: Math, scaling, and combat evaluation logic.
- `src/utils/loot.ts`: Affix data and item generation algorithms.
- `src/components/IdleGame.tsx`: The main game container, state manager, and UI renderer.
- `src/index.css`: Global dark theme and utility styles.
