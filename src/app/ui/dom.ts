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
  set(value: number, max: number, label: string): void;
}

export function bar(kind: string): Bar {
  const fill = el("div", "bar-fill");
  const text = el("span", "bar-label");
  const root = el("div", `bar bar-${kind}`, fill, text);
  return {
    root,
    set(value, max, label) {
      fill.style.width = `${max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0}%`;
      text.textContent = label;
    },
  };
}
