import type { BuildPreset } from "./index";

/** Fire spell build with ignite (v0.6.0). Heavy Strike until Fireball unlocks at level 2. */
export const FIREBALL_IGNITE: BuildPreset = {
  id: "fireball",
  name: "Fireball + Searing Touch",
  skillPriority: ["fireball", "heavy_strike"],
  supportPriority: ["concentrated_power", "searing_touch", "swift_casting"],
  passiveOrder: ["a1", "b1", "a2", "a4", "b3", "a3", "AN1", "BN1", "b4", "b5", "BN2", "b2", "b6", "b7", "m1", "m2"],
};
