/** Small DOM helpers. User-provided text is always inserted as text nodes, never as HTML. */

export function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

export function $$<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') {
        element.className = String(value);
      } else if (key === 'dataset' && typeof value === 'object') {
        for (const [dataKey, dataValue] of Object.entries(value as Record<string, string>)) {
          element.dataset[dataKey] = dataValue;
        }
      } else if (key.startsWith('on') && typeof value === 'function') {
        element.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (value === true) {
        element.setAttribute(key, '');
      } else {
        element.setAttribute(key, String(value));
      }
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

/** Parses trusted, constant SVG markup from this codebase (never user input). */
export function svgFrom(markup: string): SVGElement {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  const node = template.content.firstElementChild;
  if (!(node instanceof SVGElement)) throw new Error('Expected an SVG element');
  return node;
}

export function setDetail(element: HTMLElement, text: string): void {
  element.textContent = text;
  element.hidden = text.length === 0;
}

let toastTimer: number | undefined;

export function toast(message: string, tone: 'ok' | 'warn' = 'ok'): void {
  const element = document.getElementById('toast');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('is-warn', tone === 'warn');
  element.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => element.classList.remove('is-visible'), 2800);
}

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function formatWhen(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today · ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday · ${time}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
