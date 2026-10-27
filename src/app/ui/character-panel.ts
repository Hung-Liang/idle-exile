import { xpToNextLevel, MAX_LEVEL } from "../../data/balance";
import { SKILLS } from "../../data/skills";
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

export function createCharacterPanel(): Panel {
  const title = el("h2");
  const skill = el("div", "muted");
  const xp = bar("xp");
  const life = bar("life");
  const offense = el("div", "stats");
  offense.title = "Standardized estimate against the current zone's monster level (0 armor, 0 resistance, 3-target pack).";
  const defenses = el("div", "stats");
  const loot = el("ol", "items");
  const root = el("section", "panel", title, skill, xp.root, life.root, offense, defenses, el("h3", undefined, "Recent loot"), loot);
  let lastLootKey = "";

  return {
    root,
    render(state) {
      const { character } = state;
      const evaluation = evaluateState(state);
      const stats = evaluation.defenses;
      title.textContent = `Exile — Level ${character.level}`;
      skill.textContent = `Skill: ${SKILLS[character.activeSkillId].name}`;
      if (character.level >= MAX_LEVEL) {
        xp.set(1, 1, "Max level");
      } else {
        const need = xpToNextLevel(character.level);
        xp.set(character.xp, need, `XP ${Math.floor(character.xp)} / ${need}`);
      }
      life.set(character.life, stats.maxLife, `Life ${character.life} / ${stats.maxLife}`);
      const res = DAMAGE_TYPES.filter((t) => t !== "physical")
        .map((t) => `${t} ${Math.round(stats.resistances[t])}%`)
        .join(" · ");
      offense.textContent = `DPS ${evaluation.singleTargetDps.toFixed(1)} single · ${evaluation.packDps.toFixed(1)} pack · EHP ${Math.round(evaluation.ehp)}`;
      defenses.textContent = `Armor ${Math.round(stats.armor)} · Resist: ${res}`;

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
