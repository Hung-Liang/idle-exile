import { INVENTORY_CAPACITY } from "../data/balance";
import { itemBase, SLOT_ITEM_CLASS, slotsForClass, type EquipSlot, type ItemId } from "./equipment";
import type { GameEvent } from "./events";
import { describeItem, salvageYield } from "./loot";
import { clampLifeToMax } from "./stats";
import { appendLog, type GameState } from "./state";

export type InventoryError = "item_not_found" | "invalid_slot" | "level_too_low" | "slot_empty" | "inventory_full" | "item_locked";

/** The default slot for an item class: the first empty matching slot, otherwise the first one. */
export function defaultSlot(state: GameState, itemId: ItemId): EquipSlot | null {
  const item = state.inventory.items[itemId];
  if (item === undefined) return null;
  const slots = slotsForClass(itemBase(item).itemClass);
  return slots.find((slot) => state.character.equipment[slot] === null) ?? slots[0] ?? null;
}

/**
 * Equips an unequipped item. The previously equipped item, if any, takes the new item's place
 * in the inventory order, so the inventory never grows.
 */
export function equipItem(state: GameState, itemId: ItemId, slot: EquipSlot | undefined, events: GameEvent[]): InventoryError | null {
  const index = state.inventory.order.indexOf(itemId);
  const item = state.inventory.items[itemId];
  if (index < 0 || item === undefined) return "item_not_found";
  const base = itemBase(item);
  const target = slot ?? defaultSlot(state, itemId);
  if (target === null || SLOT_ITEM_CLASS[target] !== base.itemClass) return "invalid_slot";
  if (state.character.level < base.requiredLevel) return "level_too_low";

  const replaced = state.character.equipment[target];
  state.character.equipment[target] = itemId;
  if (replaced === null) {
    state.inventory.order.splice(index, 1);
  } else {
    state.inventory.order[index] = replaced;
  }
  clampLifeToMax(state);
  appendLog(state, "info", `Equipped ${describeItem(item)}.`);
  events.push({ type: "item_equipped", timeMs: state.simTimeMs, itemId, slot: target, replaced });
  return null;
}

export function unequipSlot(state: GameState, slot: EquipSlot, events: GameEvent[]): InventoryError | null {
  const itemId = state.character.equipment[slot];
  if (itemId === null) return "slot_empty";
  if (state.inventory.order.length >= INVENTORY_CAPACITY) return "inventory_full";
  state.character.equipment[slot] = null;
  state.inventory.order.push(itemId);
  clampLifeToMax(state);
  appendLog(state, "info", `Unequipped ${describeItem(state.inventory.items[itemId]!)}.`);
  events.push({ type: "item_unequipped", timeMs: state.simTimeMs, itemId, slot });
  return null;
}

/** Salvages an unequipped item for currency (plan §9.4). Equipped items must be unequipped first. */
export function salvageItem(state: GameState, itemId: ItemId, events: GameEvent[]): InventoryError | null {
  const index = state.inventory.order.indexOf(itemId);
  const item = state.inventory.items[itemId];
  if (index < 0 || item === undefined) return "item_not_found";
  if (item.locked === true) return "item_locked";
  state.inventory.order.splice(index, 1);
  delete state.inventory.items[itemId];
  salvageYield(state, item, events);
  events.push({ type: "item_salvaged", timeMs: state.simTimeMs, itemId });
  return null;
}

/** Locks or unlocks an equipped or unequipped item. */
export function setItemLocked(state: GameState, itemId: ItemId, locked: boolean): InventoryError | null {
  const item = state.inventory.items[itemId];
  if (item === undefined) return "item_not_found";
  if (locked) item.locked = true;
  else delete item.locked;
  return null;
}

/** Salvages every unequipped, unlocked item, in inventory order. */
export function salvageUnlocked(state: GameState, events: GameEvent[]): void {
  const targets = state.inventory.order.filter((id) => state.inventory.items[id]!.locked !== true);
  for (const itemId of targets) salvageItem(state, itemId, events);
  if (targets.length > 0) appendLog(state, "info", `Salvaged ${targets.length} unlocked item${targets.length === 1 ? "" : "s"}.`);
}
