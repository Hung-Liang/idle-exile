import { dispatch, type PlayerAction } from "../game/engine";
import { loadSave, writeSave } from "../game/save";
import { startLoop, type LoopHandle } from "./loop";
import { createCharacterPanel } from "./ui/character-panel";
import { createCombatPanel } from "./ui/combat-panel";
import "./style.css";

const AUTOSAVE_INTERVAL_MS = 30_000;

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

const root = document.getElementById("app");
if (root === null) {
  throw new Error("missing #app element");
}

const loaded = loadSave(localStorage, { seed: randomSeed(), now: Date.now() });
for (const error of loaded.errors) {
  console.error(`save load: ${error}`);
}
const state = loaded.state;

function save(): void {
  const now = Date.now();
  // Offline settlement from lastActiveAt arrives with milestone M4; until then time away is not simulated.
  const result = writeSave(localStorage, state, { savedAt: now, lastActiveAt: now });
  if (!result.ok) {
    console.error(`save failed: ${result.errors.join("; ")}`);
  }
}

function onAction(action: PlayerAction): void {
  const result = dispatch(state, action);
  if (!result.ok) {
    console.warn(`action ${action.type} rejected: ${result.reason}`);
  }
  render();
}

const characterPanel = createCharacterPanel();
const combatPanel = createCombatPanel(onAction);
root.replaceChildren(characterPanel.root, combatPanel.root);

function render(): void {
  characterPanel.render(state);
  combatPanel.render(state);
}

let loop: LoopHandle | null = null;
let autosave: ReturnType<typeof setInterval> | null = null;

function start(): void {
  loop ??= startLoop(state, render);
  autosave ??= setInterval(save, AUTOSAVE_INTERVAL_MS);
}

function stop(): void {
  loop?.stop();
  loop = null;
  if (autosave !== null) clearInterval(autosave);
  autosave = null;
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    save();
    stop();
  } else {
    start();
  }
});
window.addEventListener("pagehide", save);

render();
start();
