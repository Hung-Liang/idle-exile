import { PASSIVE_POINT_EVERY_LEVELS } from "../data/balance";
import { PASSIVE_EDGES, PASSIVE_NODES, PASSIVE_ROOT, type PassiveNodeId } from "../data/passive-tree";
import type { GameEvent } from "./events";
import { clampLifeToMax } from "./stats";
import { appendLog, type GameState } from "./state";

export type PassiveError = "unknown_passive" | "passive_already_allocated" | "passive_not_adjacent" | "no_passive_points";

/** Undirected adjacency built once from the authoritative edge list (plan §7.3). */
export const PASSIVE_ADJACENCY: ReadonlyMap<PassiveNodeId, readonly PassiveNodeId[]> = (() => {
  const adjacency = new Map<PassiveNodeId, PassiveNodeId[]>();
  for (const [a, b] of PASSIVE_EDGES) {
    adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
    adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
  }
  return adjacency;
})();

export function passivePoints(level: number): number {
  return Math.floor(level / PASSIVE_POINT_EVERY_LEVELS);
}

export function unspentPassivePoints(state: GameState): number {
  return passivePoints(state.character.level) - state.character.allocatedPassives.length;
}

/** Why `nodeId` cannot be allocated right now, or null when it can. */
export function passiveAllocationError(state: GameState, nodeId: PassiveNodeId): PassiveError | null {
  if (!Object.hasOwn(PASSIVE_NODES, nodeId) || nodeId === PASSIVE_ROOT) return "unknown_passive";
  const allocated = state.character.allocatedPassives;
  if (allocated.includes(nodeId)) return "passive_already_allocated";
  const neighbours = PASSIVE_ADJACENCY.get(nodeId) ?? [];
  if (!neighbours.some((n) => n === PASSIVE_ROOT || allocated.includes(n))) return "passive_not_adjacent";
  if (unspentPassivePoints(state) <= 0) return "no_passive_points";
  return null;
}

export function allocatePassive(state: GameState, nodeId: PassiveNodeId, events: GameEvent[]): PassiveError | null {
  const error = passiveAllocationError(state, nodeId);
  if (error !== null) return error;
  state.character.allocatedPassives.push(nodeId);
  clampLifeToMax(state);
  appendLog(state, "info", `Allocated passive ${PASSIVE_NODES[nodeId].name}.`);
  events.push({ type: "passive_allocated", timeMs: state.simTimeMs, nodeId });
  return null;
}

/** Full, free refund (plan §7.3). Partial refunds are out of MVP scope. */
export function resetPassives(state: GameState, events: GameEvent[]): void {
  if (state.character.allocatedPassives.length === 0) return;
  state.character.allocatedPassives = [];
  clampLifeToMax(state);
  appendLog(state, "info", "Reset all passives.");
  events.push({ type: "passives_reset", timeMs: state.simTimeMs });
}
