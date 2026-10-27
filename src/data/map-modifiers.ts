export type MapModifierId = "fortified" | "savage" | "scorching" | "draining" | "swarming";

export interface MapModifierDefinition {
  id: MapModifierId;
  name: string;
  description: string;
  quantityPct: number;
  rarityPct: number;
}

export const MAP_MODIFIERS: Record<MapModifierId, MapModifierDefinition> = {
  fortified: { id: "fortified", name: "Fortified", description: "Monsters have 40% more life.", quantityPct: 8, rarityPct: 5 },
  savage: { id: "savage", name: "Savage", description: "Monsters deal 25% more damage.", quantityPct: 10, rarityPct: 5 },
  scorching: {
    id: "scorching",
    name: "Scorching",
    description: "Monsters gain 30% of damage as extra fire.",
    quantityPct: 8,
    rarityPct: 8,
  },
  draining: { id: "draining", name: "Draining", description: "Player has −15% to all resistances.", quantityPct: 10, rarityPct: 10 },
  swarming: { id: "swarming", name: "Swarming", description: "Larger packs.", quantityPct: 12, rarityPct: 0 },
};
