import { describe, expect, it } from "vitest";
import { passivePoints } from "../src/game/passive-tree";
import { createInitialState } from "../src/game/state";
import { grantXp } from "../src/game/progression";
import { xpToNextLevel } from "../src/data/balance";
import { validateState } from "../src/game/validate";
import { applyPreset, PRESETS } from "../src/tools/presets";

describe("sim-report presets", () => {
  it("have unique ids and 16 distinct passives", () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    for (const preset of PRESETS) {
      expect(new Set(preset.passiveOrder).size, preset.id).toBe(passivePoints(48));
    }
  });

  it.each(PRESETS.map((p) => [p.id, p] as const))("%s applies through dispatch at every level from 1 to 50", (_, preset) => {
    const state = createInitialState(1);
    for (let level = 1; level <= 50; level++) {
      if (level > 1) grantXp(state, xpToNextLevel(level - 1) - state.character.xp, []);
      expect(state.character.level).toBe(level);
      applyPreset(state, preset);
      expect(state.character.allocatedPassives).toEqual(preset.passiveOrder.slice(0, passivePoints(level)));
      const validation = validateState(state);
      expect(validation.ok ? [] : validation.errors).toEqual([]);
    }
    expect(state.character.activeSkillId).toBe(preset.skillPriority[0]);
    expect(state.character.supportIds.every((id) => id !== null)).toBe(true);
  });
});
