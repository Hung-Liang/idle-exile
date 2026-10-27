import { PACK_SIZE_WEIGHTS, ZONE_REQUIRED_ENCOUNTERS } from "../data/balance";
import { MAP_MODIFIERS } from "../data/map-modifiers";
import { MAP_BOSS_POOL, MAP_REQUIRED_ENCOUNTERS, mapTier } from "../data/maps";
import { MONSTERS, type BossId, type MonsterId } from "../data/monsters";
import { ZONES } from "../data/zones";
import type { Modifier } from "./modifiers";
import type { WeightedList } from "./random";
import type { GameState } from "./state";

/**
 * Everything the combat engine and progression need to know about the current activity.
 * Consumers use only this view and never branch on `activity.kind` (plan §10.5).
 */
export interface ResolvedActivity {
  name: string;
  monsterLevel: number;
  monsterPool: WeightedList<MonsterId>;
  packSizeWeights: [number, number, number];
  requiredEncounters: number;
  encountersCleared: number;
  bossPool: WeightedList<BossId>;
  /** Applied to every monster (map modifiers); empty in campaign zones. */
  monsterMods: Modifier[];
  /** Added to the player's build (e.g. Draining); empty in campaign zones. */
  playerMods: Modifier[];
  /** Map drop bonuses in percent (plan §9.1); 0 in campaign zones. */
  itemQuantityPct: number;
  itemRarityPct: number;
}

const MAP_MONSTER_POOL: WeightedList<MonsterId> = (Object.keys(MONSTERS) as MonsterId[]).map((id) => ({ id, weight: 1 }));
const MAP_BOSSES: WeightedList<BossId> = MAP_BOSS_POOL.map((id) => ({ id, weight: 1 }));

export function resolveActivity(state: GameState): ResolvedActivity {
  const { activity, zoneProgress } = state.progression;
  switch (activity.kind) {
    case "zone": {
      const zone = ZONES[activity.zoneId];
      return {
        name: zone.name,
        monsterLevel: zone.monsterLevel,
        monsterPool: zone.monsterPool.map((id) => ({ id, weight: 1 })),
        packSizeWeights: PACK_SIZE_WEIGHTS,
        requiredEncounters: ZONE_REQUIRED_ENCOUNTERS,
        encountersCleared: zoneProgress[activity.zoneId]?.encountersCleared ?? 0,
        bossPool: [{ id: zone.bossId, weight: 1 }],
        monsterMods: [],
        playerMods: [],
        itemQuantityPct: 0,
        itemRarityPct: 0,
      };
    }
    case "map": {
      const tier = mapTier(activity.tier);
      const resolved: ResolvedActivity = {
        name: `Map Tier ${activity.tier}`,
        monsterLevel: tier.monsterLevel,
        monsterPool: MAP_MONSTER_POOL,
        packSizeWeights: PACK_SIZE_WEIGHTS,
        requiredEncounters: MAP_REQUIRED_ENCOUNTERS,
        encountersCleared: activity.encountersCleared,
        bossPool: MAP_BOSSES,
        monsterMods: [],
        playerMods: [],
        itemQuantityPct: tier.quantityPct,
        itemRarityPct: tier.rarityPct,
      };
      for (const id of activity.modifiers) {
        const mod = MAP_MODIFIERS[id];
        const source = { kind: "map", id } as const;
        resolved.monsterMods.push(...mod.monsterMods.map((spec) => ({ ...spec, source })));
        resolved.playerMods.push(...mod.playerMods.map((spec) => ({ ...spec, source })));
        resolved.packSizeWeights = mod.packSizeWeights ?? resolved.packSizeWeights;
        resolved.itemQuantityPct += mod.quantityPct;
        resolved.itemRarityPct += mod.rarityPct;
      }
      return resolved;
    }
  }
}
