import { spellBaseDamage, SPELL_DAMAGE_SPREAD, SUPPORT_SLOT_LEVELS } from "../../data/balance";
import { PASSIVE_NODES, PASSIVE_ROOT, type PassiveNodeId } from "../../data/passive-tree";
import { SKILLS, type SkillDefinition, type SkillId } from "../../data/skills";
import { SUPPORTS, type SupportId } from "../../data/supports";
import type { ActionResult, PlayerAction } from "../../game/engine";
import { evaluateState, withBuild } from "../../game/evaluate";
import {
  PASSIVE_ADJACENCY,
  passiveAllocationError,
  passivePoints,
  unspentPassivePoints,
  type PassiveError,
} from "../../game/passive-tree";
import { supportIncompatibility, supportsAfterSkillSwitch } from "../../game/skills";
import type { GameState } from "../../game/state";
import { resolveActivity } from "../../game/zones";
import type { Panel } from "./character-panel";
import { comparisonTable } from "./compare";
import { button, el } from "./dom";
import { describeModifier } from "./format";

type Dispatch = (action: PlayerAction) => ActionResult;

const BRANCHES: readonly [string, string][] = [
  ["m", "Might"],
  ["c", "Celerity"],
  ["b", "Bastion"],
  ["a", "Arcana"],
];

const PASSIVE_ERROR_TEXT: Record<PassiveError, string> = {
  unknown_passive: "Unknown node",
  passive_already_allocated: "Allocated",
  passive_not_adjacent: "Not adjacent to an allocated node",
  no_passive_points: "No unspent points",
};

function describeSkill(skill: SkillDefinition, level: number): string {
  const parts = [`${Math.round(skill.effectiveness * 100)}% effectiveness`, ...skill.modifiers.map(describeModifier)];
  if (skill.spell !== undefined) {
    const average = spellBaseDamage(level);
    const types = Object.keys(skill.spell.damageSplit).join(" / ");
    parts.unshift(
      `base ${Math.round(average * (1 - SPELL_DAMAGE_SPREAD))}–${Math.round(average * (1 + SPELL_DAMAGE_SPREAD))} ${types} damage at level ${level}`,
      `${(skill.spell.castTimeMs / 1000).toFixed(2)} s cast time`,
      `${skill.spell.critChance}% base crit chance`,
    );
  }
  if (skill.tags.includes("area")) parts.push("hits every monster in the pack");
  if (skill.chain !== undefined) {
    const less = -skill.chain.chainedHitMore;
    parts.push(`chains to ${skill.chain.additionalTargets} additional targets; chained hits deal ${less}% less damage`);
  }
  return parts.join(" · ");
}

function describeMods(mods: readonly Parameters<typeof describeModifier>[0][]): string {
  return mods.length === 0 ? "—" : mods.map(describeModifier).join(" · ");
}

export function createSkillPanel(dispatch: Dispatch): Panel {
  const root = el("section", "panel");
  let selected: PassiveNodeId | null = null;
  let message = "";
  let lastKey = "";
  let lastState: GameState | null = null;

  function rerender(): void {
    lastKey = "";
    if (lastState !== null) panel.render(lastState);
  }

  function act(action: PlayerAction): void {
    const result = dispatch(action);
    message = result.ok ? "" : `Rejected: ${result.reason.replaceAll("_", " ")}`;
    rerender();
  }

  function skillTable(state: GameState): HTMLElement {
    const { character } = state;
    const rows = (Object.keys(SKILLS) as SkillId[]).map((id) => {
      const skill = SKILLS[id];
      const active = character.activeSkillId === id;
      const locked = character.level < skill.unlockLevel;
      const preview = evaluateState(withBuild(state, { activeSkillId: id, supportIds: supportsAfterSkillSwitch(character.supportIds, id) }));
      const reason = active ? "Active" : locked ? `Requires level ${skill.unlockLevel}` : undefined;
      return el(
        "tr",
        active ? "active-row" : locked ? "muted" : undefined,
        el("td", undefined, skill.name),
        el("td", "muted", skill.tags.join(", ")),
        el("td", undefined, describeSkill(skill, character.level)),
        el("td", "num", locked ? "—" : `${preview.singleTargetDps.toFixed(1)} / ${preview.packDps.toFixed(1)}`),
        el("td", undefined, button(active ? "Active" : "Use", () => act({ type: "set_active_skill", skillId: id }), reason)),
      );
    });
    const head = el(
      "tr",
      undefined,
      ...["Skill", "Tags", "Effect", "DPS single / pack*", ""].map((h) => el("th", h.startsWith("DPS") ? "num" : undefined, h)),
    );
    return el("table", "grid-table", el("thead", undefined, head), el("tbody", undefined, ...rows));
  }

  function supportSection(state: GameState): HTMLElement {
    const { character } = state;
    const slots = el(
      "ul",
      "items",
      ...SUPPORT_SLOT_LEVELS.map((level, slot) => {
        if (slot >= character.supportIds.length) {
          return el("li", "muted", `Slot ${slot + 1}: locked (level ${level})`);
        }
        const id = character.supportIds[slot]!;
        return el(
          "li",
          undefined,
          `Slot ${slot + 1}: ${id === null ? "—" : SUPPORTS[id].name} `,
          button("Remove", () => act({ type: "set_support", slot, supportId: null }), id === null ? "Slot is empty" : undefined),
        );
      }),
    );

    const rows = (Object.keys(SUPPORTS) as SupportId[]).map((id) => {
      const support = SUPPORTS[id];
      const equippedSlot = character.supportIds.indexOf(id);
      const incompatible = supportIncompatibility(character.activeSkillId, id);
      const status =
        character.level < support.unlockLevel
          ? `Requires level ${support.unlockLevel}`
          : incompatible !== null
            ? `Incompatible: ${incompatible}`
            : equippedSlot >= 0
              ? `In slot ${equippedSlot + 1}`
              : "Available";
      const unusable = status !== "Available" && equippedSlot < 0 ? status : undefined;
      const buttons = character.supportIds.map((current, slot) =>
        button(
          `→ ${slot + 1}`,
          () => act({ type: "set_support", slot, supportId: id }),
          unusable ?? (current === id ? `Already in slot ${slot + 1}` : equippedSlot >= 0 ? `In slot ${equippedSlot + 1}` : undefined),
        ),
      );
      return el(
        "tr",
        unusable !== undefined ? "muted" : equippedSlot >= 0 ? "active-row" : undefined,
        el("td", undefined, support.name),
        el("td", undefined, describeMods(support.modifiers)),
        el("td", unusable !== undefined && incompatible !== null ? "delta-down" : "muted", status),
        el("td", undefined, ...buttons),
      );
    });
    const head = el("tr", undefined, ...["Support", "Effect", "Status", ""].map((h) => el("th", undefined, h)));
    return el(
      "div",
      undefined,
      slots,
      el("table", "grid-table", el("thead", undefined, head), el("tbody", undefined, ...rows)),
    );
  }

  function nodeRow(state: GameState, id: PassiveNodeId): HTMLElement {
    const node = PASSIVE_NODES[id];
    const allocated = state.character.allocatedPassives.includes(id);
    const error = passiveAllocationError(state, id);
    // "+" = can allocate now; "·" = reachable but no points; " " = not adjacent.
    const marker = allocated ? "■" : error === null ? "+" : error === "no_passive_points" ? "·" : " ";
    const status = allocated ? "allocated" : error === null || error === "no_passive_points" ? "reachable" : "locked";
    const kind = node.kind === "minor" ? "" : ` (${node.kind})`;
    const row = el("li", `item passive-${status}${id === selected ? " selected" : ""}`, `[${marker}] ${node.name}${kind}`);
    row.addEventListener("click", () => {
      selected = id;
      rerender();
    });
    return row;
  }

  function nodeDetail(state: GameState): HTMLElement {
    if (selected === null) return el("div", "muted", "Select a node to see its effect and a stat preview.");
    const id = selected;
    const node = PASSIVE_NODES[id];
    const allocated = state.character.allocatedPassives;
    const isAllocated = allocated.includes(id);
    const error = passiveAllocationError(state, id);
    const neighbours = (PASSIVE_ADJACENCY.get(id) ?? []).map((n) => (n === PASSIVE_ROOT ? "Origin" : PASSIVE_NODES[n].name));
    const box = el(
      "div",
      "detail",
      el("div", undefined, `${node.name} — ${node.kind}`),
      el("ul", "affixes", ...node.modifiers.map((m) => el("li", undefined, describeModifier(m)))),
      el("div", "muted", `Connects to: ${neighbours.join(", ")}`),
    );
    if (!isAllocated) {
      box.append(
        el(
          "div",
          "controls",
          button("Allocate", () => act({ type: "allocate_passive", nodeId: id }), error === null ? undefined : PASSIVE_ERROR_TEXT[error]),
        ),
      );
    }

    const monsterLevel = resolveActivity(state).monsterLevel;
    const now = evaluateState(state);
    if (isAllocated) {
      const without = evaluateState(withBuild(state, { allocatedPassives: allocated.filter((n) => n !== id) }));
      box.append(el("h3", undefined, "Contribution (without vs. now)"), comparisonTable(without, now, monsterLevel, "Now"));
    } else {
      const withNode = evaluateState(withBuild(state, { allocatedPassives: [...allocated, id] }));
      box.append(el("h3", undefined, "Preview"), comparisonTable(now, withNode, monsterLevel, "Allocated"));
    }
    return box;
  }

  function passiveSection(state: GameState): HTMLElement {
    const { character } = state;
    const ids = (Object.keys(PASSIVE_NODES) as PassiveNodeId[]).filter((id) => id !== PASSIVE_ROOT);
    const branches = BRANCHES.map(([prefix, name]) =>
      el(
        "div",
        undefined,
        el("div", "muted", name),
        el("ul", "items", ...ids.filter((id) => id.toLowerCase().startsWith(prefix)).map((id) => nodeRow(state, id))),
      ),
    );
    const points = passivePoints(character.level);
    return el(
      "div",
      undefined,
      el(
        "div",
        "controls",
        `Points: ${character.allocatedPassives.length} / ${points} spent · ${unspentPassivePoints(state)} unspent`,
        button(
          "Reset all (free)",
          () => act({ type: "reset_passives" }),
          character.allocatedPassives.length === 0 ? "Nothing allocated" : undefined,
        ),
      ),
      el("div", "muted", "■ allocated · + allocatable · · reachable, no points · blank: not adjacent"),
      el(
        "div",
        "inventory-grid",
        el("div", "passive-branches", ...branches),
        el("div", undefined, nodeDetail(state)),
      ),
    );
  }

  const panel: Panel = {
    root,
    render(state) {
      lastState = state;
      const { character } = state;
      const key = JSON.stringify([
        character.activeSkillId,
        character.supportIds,
        character.allocatedPassives,
        character.level,
        character.equipment,
        resolveActivity(state).monsterLevel,
        selected,
        message,
      ]);
      if (key === lastKey) return;
      lastKey = key;

      root.replaceChildren(
        el("div", "error", message),
        el("h2", undefined, "Active skill"),
        skillTable(state),
        el(
          "div",
          "muted",
          "* standardized estimate with the current supports, including bleed, ignite and shock; incompatible supports are dropped on switch. Spells ignore the weapon's damage, speed and crit chance.",
        ),
        el("h2", undefined, "Supports"),
        supportSection(state),
        el("h2", undefined, "Passive tree"),
        passiveSection(state),
      );
    },
  };
  return panel;
}
