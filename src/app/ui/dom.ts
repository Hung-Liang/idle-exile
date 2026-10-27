export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  node.append(...children);
  return node;
}

export interface Bar {
  root: HTMLElement;
  /** `figure` is the numeric readout, set right-aligned in tabular figures beside the label. */
  set(value: number, max: number, label: string, figure?: string): void;
}

export function bar(kind: string): Bar {
  const fill = el("div", "bar-fill");
  const text = el("span", "bar-label");
  const value = el("span", "bar-value num");
  const root = el("div", `bar bar-${kind}`, el("div", "bar-head", text, value), el("div", "bar-track", fill));
  return {
    root,
    set(current, max, label, figure) {
      fill.style.width = `${max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0}%`;
      text.textContent = label;
      value.textContent = figure ?? "";
    },
  };
}

export function button(label: string, onClick: () => void, disabledReason?: string): HTMLButtonElement {
  const b = el("button", undefined, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  if (disabledReason !== undefined) {
    b.disabled = true;
    b.title = disabledReason;
  }
  return b;
}
