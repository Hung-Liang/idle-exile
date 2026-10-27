import { xpToNextLevel, MAX_LEVEL } from "../../data/balance";
import { SKILLS } from "../../data/skills";
import { DAMAGE_TYPES } from "../../game/modifiers";
import { collectBuild, computeDefenses } from "../../game/stats";
import type { GameState } from "../../game/state";
import { bar, el } from "./dom";

export interface Panel {
  root: HTMLElement;
  render(state: GameState): void;
}

export function createCharacterPanel(): Panel {
  const title = el("h2");
  const skill = el("div", "muted");
  const xp = bar("xp");
  const life = bar("life");
  const defenses = el("div", "stats");
  const root = el("section", "panel", title, skill, xp.root, life.root, defenses);

  return {
    root,
    render(state) {
      const { character } = state;
      const stats = computeDefenses(collectBuild(state));
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
      defenses.textContent = `Armor ${Math.round(stats.armor)} · Resist: ${res}`;
    },
  };
}
