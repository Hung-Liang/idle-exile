import { DAMAGE_TYPES, MOD_KINDS, STAT_IDS, type ModifierSpec, type Tag } from "../../src/game/modifiers";
import { STACKS } from "../../src/data/stacks";

const VALID_TAGS: readonly Tag[] = [...DAMAGE_TYPES, "elemental", "attack", "spell", "single_target", "chain", "area"];

/** Stats whose modifiers are meaningless without a damage type. */
const STATS_REQUIRING_DAMAGE_TYPE = new Set<string>([
  "added_damage",
  "penetration",
  "gain_as_extra",
  "conversion",
  "resistance",
  "resistance_max",
]);

/** Every record key equals its definition's `id`, and every id is unique. */
export function checkRecordIds(tableName: string, table: Record<string, { id: string }>): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const [key, def] of Object.entries(table)) {
    if (def.id !== key) {
      errors.push(`${tableName}: key "${key}" has id "${def.id}"`);
    }
    if (seen.has(def.id)) {
      errors.push(`${tableName}: duplicate id "${def.id}"`);
    }
    seen.add(def.id);
  }
  return errors;
}

/** IDs must be unique across all given tables (no id reused between content types). */
export function checkGlobalUniqueness(tables: Record<string, Record<string, unknown>>): string[] {
  const owner = new Map<string, string>();
  const errors: string[] = [];
  for (const [tableName, table] of Object.entries(tables)) {
    for (const id of Object.keys(table)) {
      const previous = owner.get(id);
      if (previous !== undefined) {
        errors.push(`id "${id}" is defined in both ${previous} and ${tableName}`);
      }
      owner.set(id, tableName);
    }
  }
  return errors;
}

export function checkReference(where: string, id: string, table: Record<string, unknown>): string[] {
  return Object.hasOwn(table, id) ? [] : [`${where}: unknown reference "${id}"`];
}

export function checkTags(where: string, tags: readonly string[]): string[] {
  const errors: string[] = [];
  for (const tag of tags) {
    if (!VALID_TAGS.includes(tag as Tag)) {
      errors.push(`${where}: unknown tag "${tag}"`);
    }
  }
  if (new Set(tags).size !== tags.length) {
    errors.push(`${where}: duplicate tags`);
  }
  return errors;
}

export function checkModifierSpec(where: string, mod: ModifierSpec): string[] {
  const errors: string[] = [];
  if (!STAT_IDS.includes(mod.stat)) {
    errors.push(`${where}: unknown stat "${mod.stat}"`);
  }
  if (!MOD_KINDS.includes(mod.kind)) {
    errors.push(`${where}: unknown kind "${mod.kind}"`);
  }
  if (mod.damageType !== undefined && !DAMAGE_TYPES.includes(mod.damageType)) {
    errors.push(`${where}: unknown damageType "${mod.damageType}"`);
  }
  if (STATS_REQUIRING_DAMAGE_TYPE.has(mod.stat) && mod.damageType === undefined) {
    errors.push(`${where}: stat "${mod.stat}" requires a damageType`);
  }
  if (Array.isArray(mod.value)) {
    const [min, max] = mod.value;
    if (mod.kind !== "flat") {
      errors.push(`${where}: range value on a non-flat modifier`);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      errors.push(`${where}: invalid range [${min}, ${max}]`);
    }
  } else if (!Number.isFinite(mod.value)) {
    errors.push(`${where}: non-finite value`);
  }
  if (mod.tags !== undefined) {
    errors.push(...checkTags(where, mod.tags));
  }
  if (mod.perStack !== undefined && !Object.hasOwn(STACKS, mod.perStack)) {
    errors.push(`${where}: unknown stack "${mod.perStack}"`);
  }
  return errors;
}

export function checkModifierSpecs(where: string, mods: readonly ModifierSpec[]): string[] {
  return mods.flatMap((mod, i) => checkModifierSpec(`${where}.modifiers[${i}]`, mod));
}

/**
 * Undirected graph checks: no self or duplicate edges (including reversed), every
 * endpoint exists, every node has an edge, and every node is reachable from `root`.
 */
export function checkGraph(
  name: string,
  nodeIds: readonly string[],
  edges: readonly (readonly [string, string])[],
  root: string,
): string[] {
  const errors: string[] = [];
  const nodes = new Set(nodeIds);
  const adjacency = new Map<string, Set<string>>(nodeIds.map((id) => [id, new Set()]));
  const seenEdges = new Set<string>();

  for (const [a, b] of edges) {
    if (a === b) {
      errors.push(`${name}: self edge on "${a}"`);
      continue;
    }
    if (!nodes.has(a) || !nodes.has(b)) {
      errors.push(`${name}: edge [${a}, ${b}] references an unknown node`);
      continue;
    }
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seenEdges.has(key)) {
      errors.push(`${name}: duplicate edge [${a}, ${b}]`);
    }
    seenEdges.add(key);
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  }

  for (const id of nodeIds) {
    if (adjacency.get(id)!.size === 0) {
      errors.push(`${name}: node "${id}" has no edges`);
    }
  }

  if (!nodes.has(root)) {
    errors.push(`${name}: root "${root}" is not a node`);
    return errors;
  }
  const visited = new Set<string>([root]);
  const queue = [root];
  while (queue.length > 0) {
    for (const next of adjacency.get(queue.shift()!)!) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  for (const id of nodeIds) {
    if (!visited.has(id)) {
      errors.push(`${name}: node "${id}" is unreachable from "${root}"`);
    }
  }
  return errors;
}
