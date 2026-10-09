/**
 * Helpers for Electron accelerator strings ("Alt+Space", "CommandOrControl+Shift+D").
 * Pure functions only, so they can be shared by the main process and the settings UI.
 */

export const DEFAULT_HOTKEY = 'Alt+Space';

type CanonicalModifier = 'Command' | 'Control' | 'Alt' | 'Shift' | 'Super' | 'CommandOrControl' | 'AltGr';

const MODIFIER_ALIASES: Record<string, CanonicalModifier> = {
  command: 'Command',
  cmd: 'Command',
  control: 'Control',
  ctrl: 'Control',
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
};

const NAMED_KEYS: Record<string, string> = {
  space: 'Space',
  tab: 'Tab',
  enter: 'Enter',
  return: 'Enter',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
};

const PUNCTUATION_KEYS = new Set(['-', '=', '[', ']', '\\', ';', "'", ',', '.', '/', '`']);

export interface ParsedAccelerator {
  modifiers: CanonicalModifier[];
  key: string;
}

function canonicalKey(token: string): string | null {
  if (token.length === 1) {
    const upper = token.toUpperCase();
    if (/^[A-Z0-9]$/.test(upper)) return upper;
    if (PUNCTUATION_KEYS.has(token)) return token;
    return null;
  }
  const lower = token.toLowerCase();
  if (NAMED_KEYS[lower]) return NAMED_KEYS[lower];
  const fn = /^f([1-9]|1[0-9]|2[0-4])$/i.exec(token);
  if (fn) return `F${fn[1]}`;
  return null;
}

/** Parses an accelerator; returns null when it is malformed or has no usable modifier. */
export function parseAccelerator(accelerator: string): ParsedAccelerator | null {
  if (typeof accelerator !== 'string' || accelerator.trim() === '') return null;
  const tokens = accelerator.split('+').map((t) => t.trim());
  if (tokens.length === 0 || tokens.some((t) => t === '')) return null;

  const keyToken = tokens[tokens.length - 1];
  const key = canonicalKey(keyToken);
  if (!key) return null;

  const modifiers: CanonicalModifier[] = [];
  for (const token of tokens.slice(0, -1)) {
    const mod = MODIFIER_ALIASES[token.toLowerCase()];
    if (!mod) return null;
    if (!modifiers.includes(mod)) modifiers.push(mod);
  }

  const isFunctionKey = /^F\d+$/.test(key);
  if (modifiers.length === 0 && !isFunctionKey) return null;
  return { modifiers, key };
}

export function isValidAccelerator(accelerator: string): boolean {
  return parseAccelerator(accelerator) !== null;
}

/** Human-readable label, e.g. "⌥ Space" on macOS and "Alt + Space" elsewhere. */
export function formatAcceleratorLabel(accelerator: string, platform: string): string {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return accelerator;
  const mac = platform === 'darwin';
  const symbol: Record<CanonicalModifier, string> = mac
    ? { Command: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧', Super: '⌘', CommandOrControl: '⌘', AltGr: '⌥' }
    : { Command: 'Win', Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Super: 'Win', CommandOrControl: 'Ctrl', AltGr: 'AltGr' };
  const keyLabel: Record<string, string> = mac
    ? { Space: 'Space', Enter: 'Return', Backspace: '⌫', Delete: '⌦', Up: '↑', Down: '↓', Left: '←', Right: '→' }
    : { Space: 'Space', Enter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right' };
  const key = keyLabel[parsed.key] ?? parsed.key;
  if (mac) {
    return [...parsed.modifiers.map((m) => symbol[m]), key].join(' ');
  }
  return [...parsed.modifiers.map((m) => symbol[m]), key].join(' + ');
}

export interface KeyboardEventLike {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const CODE_TO_KEY: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
};

/**
 * Converts a DOM keyboard event into an accelerator while the user is recording a new hotkey.
 * Returns null while only modifiers are held or when the combination is not usable.
 */
export function keyboardEventToAccelerator(event: KeyboardEventLike, platform: string): string | null {
  const code = event.code;
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else if (CODE_TO_KEY[code]) key = CODE_TO_KEY[code];
  if (!key) return null;

  const modifiers: string[] = [];
  if (event.metaKey) modifiers.push(platform === 'darwin' ? 'Command' : 'Super');
  if (event.ctrlKey) modifiers.push('Control');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');

  const accelerator = [...modifiers, key].join('+');
  return parseAccelerator(accelerator) ? accelerator : null;
}
