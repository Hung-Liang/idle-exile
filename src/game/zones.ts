import { PACK_SIZE_WEIGHTS, ZONE_REQUIRED_ENCOUNTERS } from "../data/balance";
import type { BossId, MonsterId } from "../data/monsters";
import { ZONES } from "../data/zones";
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
  /** Map-modifier drop bonuses in percent (plan §9.1); 0 in campaign zones. */
  itemQuantityPct: number;
  itemRarityPct: number;
}

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
        itemQuantityPct: 0,
        itemRarityPct: 0,
      };
    }
    case "map":
      // Map runs (tiers, map bosses, map modifiers) arrive with milestone M5.
      throw new Error("resolveActivity: map activities are not implemented yet");
  }
}
