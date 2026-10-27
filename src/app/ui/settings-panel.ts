import type { ActionResult, PlayerAction } from "../../game/engine";
import { REPLACED_KEY } from "../../game/save";
import type { LootFilterRule } from "../../game/state";
import type { Panel } from "./character-panel";
import { button, el } from "./dom";
import { lootFilterEditor } from "./loot-filter-editor";

export const RESET_CONFIRMATION = "RESET";

export interface SaveControls {
  exportSave(): string;
  /** Checks an export string; returns a one-line description of the save, or an error. */
  previewImport(text: string): { ok: true; description: string } | { ok: false; error: string };
  /** Replaces the current save. Returns an error message, or null on success (the page then reloads). */
  applyImport(text: string): string | null;
  reset(): void;
}

function toggle(label: string, hint: string, onChange: (checked: boolean) => void): { root: HTMLElement; input: HTMLInputElement } {
  const input = el("input");
  input.type = "checkbox";
  input.addEventListener("change", () => onChange(input.checked));
  return { root: el("div", undefined, el("label", "toggle", input, ` ${label}`), el("div", "muted", hint)), input };
}

/** Plan §13.5: auto-advance, auto-retreat, loot filter editor, export/import, and reset. */
export function createSettingsPanel(controls: SaveControls, dispatch: (action: PlayerAction) => ActionResult): Panel {
  const autoAdvance = toggle(
    "Auto-advance",
    "Move on to the next zone or map tier after each boss kill. A retreat pauses it.",
    (value) => dispatch({ type: "set_auto_advance", value }),
  );
  const autoRetreat = toggle(
    "Auto-retreat",
    "After 3 deaths in a row, step back to the previous zone or map tier.",
    (value) => dispatch({ type: "set_auto_retreat", value }),
  );

  const filterRoot = el("div");
  const filterError = el("div", "error");
  let lastFilterKey = "";
  const setFilter = (rules: LootFilterRule[]) => {
    const result = dispatch({ type: "set_loot_filter", rules });
    filterError.textContent = result.ok ? "" : `Rejected: ${result.reason.replaceAll("_", " ")}.`;
  };

  const exportBox = el("textarea", "save-text");
  exportBox.readOnly = true;
  exportBox.rows = 4;
  const exportStatus = el("div", "muted");
  const exportButton = button("Export", () => {
    exportBox.value = controls.exportSave();
    exportBox.select();
    navigator.clipboard?.writeText(exportBox.value).then(
      () => (exportStatus.textContent = "Copied to the clipboard."),
      () => (exportStatus.textContent = "Select the text above and copy it manually."),
    );
  });

  const importBox = el("textarea", "save-text");
  importBox.rows = 4;
  importBox.placeholder = "Paste an exported save here";
  const importError = el("div", "error");
  const importButton = button("Import", () => {
    const preview = controls.previewImport(importBox.value);
    if (!preview.ok) {
      importError.textContent = `Cannot import: ${preview.error}.`;
      return;
    }
    importError.textContent = "";
    if (!window.confirm(`Replace the current save with ${preview.description}?\nThe current save is kept under ${REPLACED_KEY}.`)) return;
    const error = controls.applyImport(importBox.value);
    if (error !== null) importError.textContent = `Import failed: ${error}.`;
  });

  const resetInput = el("input");
  resetInput.placeholder = `Type ${RESET_CONFIRMATION}`;
  const resetButton = button("Reset save", () => {
    if (resetInput.value === RESET_CONFIRMATION) controls.reset();
  });
  resetButton.disabled = true;
  resetInput.addEventListener("input", () => (resetButton.disabled = resetInput.value !== RESET_CONFIRMATION));

  const root = el(
    "section",
    "panel",
    el("h2", undefined, "Settings"),
    el("h3", undefined, "Gameplay"),
    autoAdvance.root,
    autoRetreat.root,
    el("h3", undefined, "Loot filter"),
    filterRoot,
    filterError,
    el("h2", undefined, "Save"),
    el("h3", undefined, "Export"),
    exportBox,
    el("div", "controls", exportButton),
    exportStatus,
    el("h3", undefined, "Import"),
    importBox,
    el("div", "controls", importButton),
    importError,
    el("h3", undefined, "Reset"),
    el("p", "muted", `Starts a new game. The current save is kept under ${REPLACED_KEY}.`),
    el("div", "controls", resetInput, resetButton),
  );

  return {
    root,
    render(state) {
      autoAdvance.input.checked = state.settings.autoAdvance;
      autoRetreat.input.checked = state.settings.autoRetreat;
      const filterKey = JSON.stringify(state.settings.lootFilter);
      if (filterKey !== lastFilterKey) {
        lastFilterKey = filterKey;
        filterRoot.replaceChildren(lootFilterEditor(state.settings.lootFilter, setFilter));
      }
    },
  };
}
