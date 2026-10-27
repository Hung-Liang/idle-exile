import { xpToNextLevel, MAX_LEVEL } from "../../data/balance";
import { SKILLS } from "../../data/skills";
import { SUPPORTS } from "../../data/supports";
import { DAMAGE_TYPES } from "../../game/modifiers";
import { evaluateState } from "../../game/evaluate";
import type { GameState } from "../../game/state";
import { bar, el } from "./dom";
import { itemTitle } from "./format";

const RECENT_LOOT_COUNT = 10;

export interface Panel {
  root: HTMLElement;
  render(state: GameState): void;
}

/** A label/figure row list; `set` updates the figures in place. */
function statList(labels: readonly string[], hint?: string): { root: HTMLElement; set(values: readonly string[]): void } {
  const figures = labels.map(() => el("dd", "num"));
  const root = el("dl", "kv", ...labels.flatMap((label, i) => [el("dt", undefined, label), figures[i]!]));
  if (hint !== undefined) root.title = hint;
  return {
    root,
    set(values) {
      values.forEach((v, i) => (figures[i]!.textContent = v));
    },
  };
}

export function createCharacterPanel(): Panel {
  const title = el("h2");
  const level = el("span", "muted");
  const skill = el("div", "muted");
  const xp = bar("xp");
  const life = bar("life");
  const offense = statList(
    ["DPS, single target", "DPS, pack", "Effective HP"],
    "Standardized estimate against the current zone's monster level (0 armor, 0 resistance, 3-target pack).",
  );
  const resTypes = DAMAGE_TYPES.filter((t) => t !== "physical");
  const defenses = statList(["Armor", ...resTypes.map((t) => `${t[0]!.toUpperCase()}${t.slice(1)} resistance`)]);
  const loot = el("ol", "items");
  const root = el(
    "section",
    "panel character",
    el("header", "panel-head", title, level),
    skill,
    xp.root,
    life.root,
    offense.root,
    defenses.root,
    el("h3", undefined, "Recent loot"),
    loot,
  );
  let lastLootKey: string | null = null;

  return {
    root,
    render(state) {
      const { character } = state;
      const evaluation = evaluateState(state);
      const stats = evaluation.defenses;
      title.textContent = "Exile";
      level.textContent = `Level ${character.level}`;
      const supports = character.supportIds.flatMap((id) => (id === null ? [] : [SUPPORTS[id].name]));
      skill.textContent = [SKILLS[character.activeSkillId].name, ...supports].join(" + ");
      if (character.level >= MAX_LEVEL) {
        xp.set(1, 1, "Experience", "Max level");
      } else {
        const need = xpToNextLevel(character.level);
        xp.set(character.xp, need, "Experience", `${Math.floor(character.xp).toLocaleString("en-US")} / ${need.toLocaleString("en-US")}`);
      }
      life.set(character.life, stats.maxLife, "Life", `${character.life} / ${stats.maxLife}`);
      offense.set([evaluation.singleTargetDps.toFixed(1), evaluation.packDps.toFixed(1), String(Math.round(evaluation.ehp))]);
      defenses.set([String(Math.round(stats.armor)), ...resTypes.map((t) => `${Math.round(stats.resistances[t])}%`)]);

      // Newest kept items still in the inventory; ids grow monotonically.
      const recent = [...state.inventory.order]
        .sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))
        .slice(0, RECENT_LOOT_COUNT);
      const lootKey = recent.join(",");
      if (lootKey !== lastLootKey) {
        lastLootKey = lootKey;
        loot.replaceChildren(
          ...(recent.length === 0
            ? [el("li", "muted", "Nothing yet")]
            : recent.map((id) => {
                const item = state.inventory.items[id]!;
                return el("li", `rarity-${item.rarity}`, itemTitle(item));
              })),
        );
      }
    },
  };
}
