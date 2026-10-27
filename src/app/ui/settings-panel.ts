import type { Panel } from "./character-panel";
import { button, el } from "./dom";

export const RESET_CONFIRMATION = "RESET";

export interface SaveControls {
  exportSave(): string;
  /** Checks an export string; returns a one-line description of the save, or an error. */
  previewImport(text: string): { ok: true; description: string } | { ok: false; error: string };
  /** Replaces the current save. Returns an error message, or null on success (the page then reloads). */
  applyImport(text: string): string | null;
  reset(): void;
}

/** Plan §13.5 save management: export, import, and reset. */
export function createSettingsPanel(controls: SaveControls): Panel {
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
    if (!window.confirm(`Replace the current save with ${preview.description}?\nThe current save is kept as the backup.`)) return;
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
    el("p", "muted", "Starts a new game. The current save is kept as the backup."),
    el("div", "controls", resetInput, resetButton),
  );

  return { root, render() {} };
}
