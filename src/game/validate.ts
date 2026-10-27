import { INVENTORY_CAPACITY, LEVEL_GAP_MAX_LEVELS, LOG_CAPACITY, MAX_LEVEL, MAX_MAP_TIER } from "../data/balance";
import { AFFIXES, getAffixDefinition } from "../data/affixes";
import { AILMENTS, type AilmentId } from "../data/ailments";
import { CURRENCIES } from "../data/currencies";
import { AFFIX_CATEGORY_LIMITS } from "../data/drop-tables";
import { ITEM_BASES } from "../data/item-bases";
import { MAP_MODIFIERS } from "../data/map-modifiers";
import { MAP_MODIFIER_COUNT_WEIGHTS, MAP_REQUIRED_ENCOUNTERS } from "../data/maps";
import { PASSIVE_NODES, PASSIVE_ROOT } from "../data/passive-tree";
import { SKILLS } from "../data/skills";
import { STACKS } from "../data/stacks";
import { SUPPORTS } from "../data/supports";
import { uniqueAffixId, UNIQUES, type UniqueId } from "../data/uniques";
import { ZONES } from "../data/zones";
import { EQUIP_SLOTS, RARITIES, SLOT_ITEM_CLASS } from "./equipment";
import { CURRENT_SCHEMA_VERSION } from "./migrations";
import { STAT_IDS } from "./modifiers";
import { PASSIVE_ADJACENCY, passivePoints } from "./passive-tree";
import { RNG_STREAMS } from "./random";
import { supportIncompatibility } from "./skills";
import { LOG_KINDS, supportSlotCount, type GameState } from "./state";

export type ValidationResult = { ok: true; state: GameState } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;

const ITEM_ID_PATTERN = /^i([1-9]\d*)$/;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isUint32(v: unknown): boolean {
  return isNonNegInt(v) && v <= 0xffffffff;
}

function has(table: object, key: unknown): boolean {
  return typeof key === "string" && Object.hasOwn(table, key);
}

class Checker {
  readonly errors: string[] = [];

  fail(path: string, message: string): void {
    this.errors.push(`${path}: ${message}`);
  }

  obj(path: string, v: unknown): v is Obj {
    if (!isObj(v)) {
      this.fail(path, "expected object");
      return false;
    }
    return true;
  }

  arr(path: string, v: unknown): v is unknown[] {
    if (!Array.isArray(v)) {
      this.fail(path, "expected array");
      return false;
    }
    return true;
  }

  bool(path: string, v: unknown): void {
    if (typeof v !== "boolean") this.fail(path, "expected boolean");
  }

  str(path: string, v: unknown): void {
    if (typeof v !== "string") this.fail(path, "expected string");
  }

  nonNegInt(path: string, v: unknown): void {
    if (!isNonNegInt(v)) this.fail(path, "expected non-negative integer");
  }

  intInRange(path: string, v: unknown, min: number, max: number): void {
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
      this.fail(path, `expected integer in [${min}, ${max}]`);
    }
  }

  ref(path: string, v: unknown, table: object): void {
    if (!has(table, v)) this.fail(path, `unknown id ${JSON.stringify(v)}`);
  }

  unique(path: string, values: unknown[]): void {
    if (new Set(values).size !== values.length) this.fail(path, "contains duplicates");
  }
}

/** Every allocated node must be connected to the root through allocated nodes. */
function passivesConnected(allocated: readonly string[]): boolean {
  const adjacency = PASSIVE_ADJACENCY as ReadonlyMap<string, readonly string[]>;
  const allocatedSet = new Set(allocated);
  const visited = new Set<string>([PASSIVE_ROOT]);
  const queue: string[] = [PASSIVE_ROOT];
  while (queue.length > 0) {
    for (const next of adjacency.get(queue.shift()!) ?? []) {
      if (allocatedSet.has(next) && !visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return allocated.every((id) => visited.has(id));
}

function checkRng(c: Checker, v: unknown): void {
  if (!c.obj("rng", v)) return;
  for (const name of RNG_STREAMS) {
    const s = v[name];
    if (!Array.isArray(s) || s.length !== 4 || !s.every(isUint32)) {
      c.fail(`rng.${name}`, "expected 4 uint32 words");
    }
  }
}

function checkCharacter(c: Checker, v: unknown, items: Obj | null): void {
  if (!c.obj("character", v)) return;
  c.intInRange("character.level", v.level, 1, MAX_LEVEL);
  if (typeof v.xp !== "number" || !Number.isFinite(v.xp) || v.xp < 0) c.fail("character.xp", "expected non-negative number");
  c.nonNegInt("character.life", v.life);

  // Imported saves bypass `dispatch`, so the action rules (unlock levels, compatibility,
  // passive points) are re-checked here.
  const level = isNonNegInt(v.level) ? v.level : null;
  const skillId = has(SKILLS, v.activeSkillId) ? (v.activeSkillId as keyof typeof SKILLS) : null;
  c.ref("character.activeSkillId", v.activeSkillId, SKILLS);
  if (skillId !== null && level !== null && level < SKILLS[skillId].unlockLevel) {
    c.fail("character.activeSkillId", `requires level ${SKILLS[skillId].unlockLevel}`);
  }

  if (c.arr("character.supportIds", v.supportIds)) {
    if (level !== null && v.supportIds.length !== supportSlotCount(level)) {
      c.fail("character.supportIds", `length must equal unlocked slot count ${supportSlotCount(level)}`);
    }
    v.supportIds.forEach((id, i) => {
      if (id === null) return;
      const path = `character.supportIds[${i}]`;
      c.ref(path, id, SUPPORTS);
      if (!has(SUPPORTS, id)) return;
      const support = id as keyof typeof SUPPORTS;
      if (level !== null && level < SUPPORTS[support].unlockLevel) c.fail(path, `requires level ${SUPPORTS[support].unlockLevel}`);
      const reason = skillId === null ? null : supportIncompatibility(skillId, support);
      if (reason !== null) c.fail(path, `incompatible with the active skill: ${reason}`);
    });
    c.unique("character.supportIds", v.supportIds.filter((id) => id !== null));
  }

  if (c.arr("character.allocatedPassives", v.allocatedPassives)) {
    const passives = v.allocatedPassives;
    passives.forEach((id, i) => {
      c.ref(`character.allocatedPassives[${i}]`, id, PASSIVE_NODES);
      if (id === PASSIVE_ROOT) c.fail(`character.allocatedPassives[${i}]`, "root is implicit and must not be listed");
    });
    c.unique("character.allocatedPassives", passives);
    if (level !== null && passives.length > passivePoints(level)) {
      c.fail("character.allocatedPassives", `exceeds the ${passivePoints(level)} points available at level ${level}`);
    }
    if (passives.every((id) => typeof id === "string") && !passivesConnected(passives as string[])) {
      c.fail("character.allocatedPassives", "not connected to the root");
    }
  }

  if (!c.obj("character.equipment", v.equipment)) return;
  const equipment = v.equipment;
  const equipped: unknown[] = [];
  for (const slot of EQUIP_SLOTS) {
    const path = `character.equipment.${slot}`;
    if (!Object.hasOwn(equipment, slot)) {
      c.fail(path, "missing slot");
      continue;
    }
    const id = equipment[slot];
    if (id === null) continue;
    equipped.push(id);
    if (items === null) continue;
    const item = items[id as string];
    if (typeof id !== "string" || !isObj(item)) {
      c.fail(path, `references missing item ${JSON.stringify(id)}`);
      continue;
    }
    const base = has(ITEM_BASES, item.baseId) ? ITEM_BASES[item.baseId as keyof typeof ITEM_BASES] : null;
    if (base !== null && base.itemClass !== SLOT_ITEM_CLASS[slot]) {
      c.fail(path, `item class ${base.itemClass} cannot be equipped in ${slot}`);
    }
  }
  c.unique("character.equipment", equipped);
}

function checkAffixValues(c: Checker, path: string, values: unknown, modifiers: readonly { range: [number, number] }[]): void {
  if (!Array.isArray(values) || values.length !== modifiers.length) {
    c.fail(`${path}.values`, `expected ${modifiers.length} values`);
    return;
  }
  modifiers.forEach((mod, j) => c.intInRange(`${path}.values[${j}]`, values[j], mod.range[0], mod.range[1]));
}

/** Plan §8.9: a unique carries exactly its definition's lines, in order, on its own base. */
function checkUniqueLines(c: Checker, path: string, item: Obj): void {
  if (!has(UNIQUES, item.uniqueId)) {
    c.fail(`${path}.uniqueId`, `unknown unique ${JSON.stringify(item.uniqueId)}`);
    return;
  }
  const def = UNIQUES[item.uniqueId as UniqueId];
  if (item.baseId !== def.baseId) c.fail(`${path}.baseId`, `must be ${def.baseId} for ${def.id}`);
  if (!c.arr(`${path}.affixes`, item.affixes)) return;
  if (item.affixes.length !== def.lines.length) {
    c.fail(`${path}.affixes`, `expected ${def.lines.length} unique lines`);
    return;
  }
  item.affixes.forEach((affix, i) => {
    const ap = `${path}.affixes[${i}]`;
    if (!c.obj(ap, affix)) return;
    const expected = uniqueAffixId(def.id, i);
    if (affix.affixId !== expected) {
      c.fail(`${ap}.affixId`, `expected ${expected}`);
      return;
    }
    checkAffixValues(c, ap, affix.values, getAffixDefinition(expected).modifiers);
  });
}

function checkItem(c: Checker, path: string, key: string, item: unknown): number | null {
  if (!c.obj(path, item)) return null;
  const match = ITEM_ID_PATTERN.exec(key);
  if (match === null) c.fail(path, "malformed item id");
  if (item.id !== key) c.fail(`${path}.id`, "must equal its key");
  c.ref(`${path}.baseId`, item.baseId, ITEM_BASES);
  c.intInRange(`${path}.itemLevel`, item.itemLevel, 1, 1000);
  if (!RARITIES.includes(item.rarity as never)) c.fail(`${path}.rarity`, "unknown rarity");
  if (item.locked !== undefined && item.locked !== true) c.fail(`${path}.locked`, "expected true when present");
  if (item.rarity === "unique") {
    checkUniqueLines(c, path, item);
  } else if (item.uniqueId !== undefined) {
    c.fail(`${path}.uniqueId`, "only allowed on unique items");
  }
  if (item.rarity !== "unique" && c.arr(`${path}.affixes`, item.affixes)) {
    const base = has(ITEM_BASES, item.baseId) ? ITEM_BASES[item.baseId as keyof typeof ITEM_BASES] : null;
    const used = { prefix: 0, suffix: 0 };
    const groups: string[] = [];
    item.affixes.forEach((affix, i) => {
      const ap = `${path}.affixes[${i}]`;
      if (!c.obj(ap, affix)) return;
      if (!has(AFFIXES, affix.affixId)) {
        c.fail(`${ap}.affixId`, `unknown affix ${JSON.stringify(affix.affixId)}`);
        return;
      }
      const def = AFFIXES[affix.affixId as string]!;
      used[def.category] += 1;
      groups.push(def.group);
      if (base !== null && !def.itemClasses.includes(base.itemClass)) c.fail(ap, `not allowed on ${base.itemClass}`);
      if (isNonNegInt(item.itemLevel) && def.requiredItemLevel > item.itemLevel) c.fail(ap, "requires a higher item level");
      checkAffixValues(c, ap, affix.values, def.modifiers);
    });
    c.unique(`${path}.affixes`, groups);
    if (RARITIES.includes(item.rarity as never)) {
      const limits = AFFIX_CATEGORY_LIMITS[item.rarity as keyof typeof AFFIX_CATEGORY_LIMITS];
      if (used.prefix > limits.prefix || used.suffix > limits.suffix) c.fail(`${path}.affixes`, `too many affixes for ${item.rarity as string}`);
    }
  }
  return match === null ? null : Number(match[1]);
}

function checkInventory(c: Checker, v: unknown, equipment: unknown, nextItemId: unknown): Obj | null {
  if (!c.obj("inventory", v)) return null;
  let items: Obj | null = null;

  if (c.obj("inventory.items", v.items)) {
    items = v.items;
    let maxNumber = 0;
    for (const [key, item] of Object.entries(items)) {
      const n = checkItem(c, `inventory.items.${key}`, key, item);
      if (n !== null) maxNumber = Math.max(maxNumber, n);
    }
    if (isNonNegInt(nextItemId) && nextItemId <= maxNumber) {
      c.fail("nextItemId", `must be greater than every existing item number (${maxNumber})`);
    }
  }

  if (c.arr("inventory.order", v.order)) {
    const order = v.order;
    c.unique("inventory.order", order);
    if (order.length > INVENTORY_CAPACITY) c.fail("inventory.order", `exceeds capacity ${INVENTORY_CAPACITY}`);

    if (items !== null && isObj(equipment)) {
      const equippedIds = new Set<unknown>(Object.values(equipment).filter((id) => id !== null));
      const orderIds = new Set(order);
      order.forEach((id, i) => {
        if (!has(items!, id)) c.fail(`inventory.order[${i}]`, `references missing item ${JSON.stringify(id)}`);
        if (equippedIds.has(id)) c.fail(`inventory.order[${i}]`, "equipped items must not be listed");
      });
      for (const id of Object.keys(items)) {
        if (!equippedIds.has(id) && !orderIds.has(id)) c.fail(`inventory.items.${id}`, "neither equipped nor in order");
      }
    }
  }

  if (c.obj("inventory.currency", v.currency)) {
    for (const id of Object.keys(CURRENCIES)) {
      c.nonNegInt(`inventory.currency.${id}`, v.currency[id]);
    }
    for (const id of Object.keys(v.currency)) {
      c.ref("inventory.currency", id, CURRENCIES);
    }
  }
  return items;
}

function checkProgression(c: Checker, v: unknown): void {
  if (!c.obj("progression", v)) return;
  c.intInRange("progression.unlockedMapTier", v.unlockedMapTier, 0, MAX_MAP_TIER);
  c.nonNegInt("progression.consecutiveDeaths", v.consecutiveDeaths);
  c.nonNegInt("progression.totalKills", v.totalKills);

  const unlocked = Array.isArray(v.unlockedZones) ? v.unlockedZones : [];
  if (c.arr("progression.unlockedZones", v.unlockedZones)) {
    if (unlocked.length === 0) c.fail("progression.unlockedZones", "must not be empty");
    unlocked.forEach((id, i) => c.ref(`progression.unlockedZones[${i}]`, id, ZONES));
    c.unique("progression.unlockedZones", unlocked);
  }

  if (c.obj("progression.zoneProgress", v.zoneProgress)) {
    for (const [id, p] of Object.entries(v.zoneProgress)) {
      const path = `progression.zoneProgress.${id}`;
      c.ref(path, id, ZONES);
      if (!c.obj(path, p)) continue;
      c.nonNegInt(`${path}.encountersCleared`, p.encountersCleared);
      c.bool(`${path}.bossDefeated`, p.bossDefeated);
    }
  }

  const a = v.activity;
  if (!c.obj("progression.activity", a)) return;
  if (a.kind === "zone") {
    c.ref("progression.activity.zoneId", a.zoneId, ZONES);
    if (!unlocked.includes(a.zoneId)) c.fail("progression.activity.zoneId", "zone is not unlocked");
  } else if (a.kind === "map") {
    const maxTier = isNonNegInt(v.unlockedMapTier) ? v.unlockedMapTier : 0;
    c.intInRange("progression.activity.tier", a.tier, 1, Math.max(1, maxTier));
    if (maxTier === 0) c.fail("progression.activity", "maps are locked");
    c.intInRange("progression.activity.encountersCleared", a.encountersCleared, 0, MAP_REQUIRED_ENCOUNTERS);
    if (c.arr("progression.activity.modifiers", a.modifiers)) {
      a.modifiers.forEach((id, i) => c.ref(`progression.activity.modifiers[${i}]`, id, MAP_MODIFIERS));
      c.unique("progression.activity.modifiers", a.modifiers);
      if (a.modifiers.length > MAP_MODIFIER_COUNT_WEIGHTS.length - 1) c.fail("progression.activity.modifiers", "too many modifiers");
    }
  } else {
    c.fail("progression.activity.kind", "expected zone or map");
  }
}

function checkEncounter(c: Checker, v: unknown): void {
  if (v === undefined || v === null) return;
  if (!c.obj("encounter", v)) return;
  c.nonNegInt("encounter.index", v.index);
  c.bool("encounter.isBoss", v.isBoss);
  if (!["fighting", "transition", "respawning"].includes(v.phase as string)) c.fail("encounter.phase", "unknown phase");
  c.nonNegInt("encounter.phaseEndsAt", v.phaseEndsAt);
  if (c.obj("encounter.player", v.player)) c.nonNegInt("encounter.player.nextAttackAt", v.player.nextAttackAt);
  c.intInRange("encounter.levelGap", v.levelGap, 0, LEVEL_GAP_MAX_LEVELS);
  if (c.obj("encounter.stacks", v.stacks)) {
    for (const [id, n] of Object.entries(v.stacks)) {
      c.ref("encounter.stacks", id, STACKS);
      c.nonNegInt(`encounter.stacks.${id}`, n);
    }
  }
  if (c.arr("encounter.monsters", v.monsters)) {
    v.monsters.forEach((m, i) => {
      const path = `encounter.monsters[${i}]`;
      if (!c.obj(path, m)) return;
      c.str(`${path}.defId`, m.defId);
      c.intInRange(`${path}.level`, m.level, 1, 1000);
      c.nonNegInt(`${path}.life`, m.life);
      c.nonNegInt(`${path}.maxLife`, m.maxLife);
      c.nonNegInt(`${path}.nextAttackAt`, m.nextAttackAt);
      c.bool(`${path}.alive`, m.alive);
      if (m.ailments !== undefined) checkMonsterAilments(c, `${path}.ailments`, m.ailments);
    });
  }
}

function checkMonsterAilments(c: Checker, path: string, v: unknown): void {
  if (!c.obj(path, v)) return;
  for (const [id, a] of Object.entries(v)) {
    const ap = `${path}.${id}`;
    if (!has(AILMENTS, id)) {
      c.fail(ap, "unknown ailment");
      continue;
    }
    if (!c.obj(ap, a)) continue;
    if (AILMENTS[id as AilmentId].kind === "damaging") {
      if (typeof a.damagePerTick !== "number" || !(a.damagePerTick >= 0)) c.fail(`${ap}.damagePerTick`, "expected a non-negative number");
      c.nonNegInt(`${ap}.nextTickAt`, a.nextTickAt);
      c.intInRange(`${ap}.ticksLeft`, a.ticksLeft, 1, 1_000_000);
    } else {
      if (typeof a.magnitude !== "number" || !(a.magnitude >= 0 && a.magnitude < 100)) c.fail(`${ap}.magnitude`, "expected a percentage below 100");
      c.nonNegInt(`${ap}.endsAt`, a.endsAt);
    }
  }
}

function checkLootFilter(c: Checker, path: string, v: unknown): void {
  if (!c.arr(path, v)) return;
  v.forEach((rule, i) => {
    const rp = `${path}[${i}]`;
    if (!c.obj(rp, rule)) return;
    if (rule.action !== "keep" && rule.action !== "salvage") c.fail(`${rp}.action`, "expected keep or salvage");
    if (rule.minRarity !== undefined && !RARITIES.includes(rule.minRarity as never)) c.fail(`${rp}.minRarity`, "unknown rarity");
    if (rule.minItemLevel !== undefined) c.nonNegInt(`${rp}.minItemLevel`, rule.minItemLevel);
    if (rule.upgrade !== undefined && rule.upgrade !== true) c.fail(`${rp}.upgrade`, "expected true when present");
    if (rule.slots !== undefined && c.arr(`${rp}.slots`, rule.slots)) {
      rule.slots.forEach((s, j) => {
        if (!EQUIP_SLOTS.includes(s as never)) c.fail(`${rp}.slots[${j}]`, "unknown slot");
      });
    }
    if (rule.hasStat !== undefined && c.arr(`${rp}.hasStat`, rule.hasStat)) {
      rule.hasStat.forEach((s, j) => {
        if (!STAT_IDS.includes(s as never)) c.fail(`${rp}.hasStat[${j}]`, "unknown stat");
      });
    }
  });
}

function checkSettings(c: Checker, v: unknown): void {
  if (!c.obj("settings", v)) return;
  c.bool("settings.autoAdvance", v.autoAdvance);
  c.bool("settings.autoRetreat", v.autoRetreat);
  checkLootFilter(c, "settings.lootFilter", v.lootFilter);
}

/** Validates an untrusted loot filter rule list. Returns the errors (empty = valid). */
export function validateLootFilter(input: unknown): string[] {
  const c = new Checker();
  checkLootFilter(c, "lootFilter", input);
  return c.errors;
}

function checkLog(c: Checker, v: unknown): void {
  if (!c.arr("log", v)) return;
  if (v.length > LOG_CAPACITY) c.fail("log", `exceeds capacity ${LOG_CAPACITY}`);
  v.forEach((entry, i) => {
    const path = `log[${i}]`;
    if (!c.obj(path, entry)) return;
    c.nonNegInt(`${path}.timeMs`, entry.timeMs);
    if (!LOG_KINDS.includes(entry.kind as never)) c.fail(`${path}.kind`, "unknown kind");
    c.str(`${path}.text`, entry.text);
  });
}

/**
 * Validates an untrusted value as a GameState of the current schema version, including
 * cross-field invariants (each item equipped or listed exactly once, references resolve).
 * `encounter` may be absent (persisted form), null, or a runtime object.
 */
export function validateState(input: unknown): ValidationResult {
  const c = new Checker();
  if (!c.obj("state", input)) return { ok: false, errors: c.errors };
  const v = input;

  if (v.schemaVersion !== CURRENT_SCHEMA_VERSION) c.fail("schemaVersion", `expected ${CURRENT_SCHEMA_VERSION}`);
  c.nonNegInt("simTimeMs", v.simTimeMs);
  c.intInRange("nextItemId", v.nextItemId, 1, Number.MAX_SAFE_INTEGER);
  checkRng(c, v.rng);

  const equipment = isObj(v.character) ? v.character.equipment : undefined;
  const items = checkInventory(c, v.inventory, equipment, v.nextItemId);
  checkCharacter(c, v.character, items);
  checkProgression(c, v.progression);
  checkEncounter(c, v.encounter);
  checkSettings(c, v.settings);
  checkLog(c, v.log);

  return c.errors.length === 0 ? { ok: true, state: input as unknown as GameState } : { ok: false, errors: c.errors };
}
