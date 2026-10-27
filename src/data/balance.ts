// Global tuning constants. All values are provisional (plan §0).

export const MAX_LEVEL = 50;

/** Base life = base + perLevel × (level − 1). */
export const BASE_LIFE = { base: 100, perLevel: 12 } as const;

/** Character level at which each support slot unlocks, in slot order. */
export const SUPPORT_SLOT_LEVELS = [3, 10] as const;

export const INVENTORY_CAPACITY = 60;
export const LOG_CAPACITY = 200;

export const ZONE_REQUIRED_ENCOUNTERS = 10;
export const MAX_MAP_TIER = 5;
