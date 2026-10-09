import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOTKEY,
  formatAcceleratorLabel,
  isValidAccelerator,
  keyboardEventToAccelerator,
  parseAccelerator,
} from '../src/shared/hotkey';

describe('parseAccelerator', () => {
  it('parses the default Option/Alt + Space hotkey', () => {
    expect(parseAccelerator(DEFAULT_HOTKEY)).toEqual({ modifiers: ['Alt'], key: 'Space' });
  });

  it('accepts aliases and canonicalises key case', () => {
    expect(parseAccelerator('ctrl+shift+d')).toEqual({ modifiers: ['Control', 'Shift'], key: 'D' });
    expect(parseAccelerator('CmdOrCtrl+Option+f9')).toEqual({ modifiers: ['CommandOrControl', 'Alt'], key: 'F9' });
  });

  it('rejects malformed or modifier-less combinations', () => {
    expect(parseAccelerator('')).toBeNull();
    expect(parseAccelerator('Space')).toBeNull();
    expect(parseAccelerator('Alt+')).toBeNull();
    expect(parseAccelerator('Hyper+Space')).toBeNull();
    expect(parseAccelerator('Alt+Banana')).toBeNull();
  });

  it('allows bare function keys', () => {
    expect(isValidAccelerator('F8')).toBe(true);
    expect(isValidAccelerator('F25')).toBe(false);
  });
});

describe('formatAcceleratorLabel', () => {
  it('uses Mac symbols on darwin', () => {
    expect(formatAcceleratorLabel('Alt+Space', 'darwin')).toBe('⌥ Space');
    expect(formatAcceleratorLabel('Command+Shift+Enter', 'darwin')).toBe('⌘ ⇧ Return');
  });

  it('uses words elsewhere', () => {
    expect(formatAcceleratorLabel('Alt+Space', 'win32')).toBe('Alt + Space');
    expect(formatAcceleratorLabel('Control+Shift+Up', 'linux')).toBe('Ctrl + Shift + Up');
  });
});

describe('keyboardEventToAccelerator', () => {
  const base = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };

  it('captures Option/Alt + Space', () => {
    expect(keyboardEventToAccelerator({ ...base, code: 'Space', altKey: true }, 'win32')).toBe('Alt+Space');
  });

  it('maps letters, digits, arrows and punctuation', () => {
    expect(keyboardEventToAccelerator({ ...base, code: 'KeyK', ctrlKey: true, shiftKey: true }, 'linux')).toBe('Control+Shift+K');
    expect(keyboardEventToAccelerator({ ...base, code: 'Digit7', altKey: true }, 'linux')).toBe('Alt+7');
    expect(keyboardEventToAccelerator({ ...base, code: 'ArrowUp', metaKey: true }, 'darwin')).toBe('Command+Up');
    expect(keyboardEventToAccelerator({ ...base, code: 'Slash', metaKey: true, altKey: true }, 'win32')).toBe('Super+Alt+/');
  });

  it('returns null while only modifiers are held or for unsupported keys', () => {
    expect(keyboardEventToAccelerator({ ...base, code: 'AltLeft', altKey: true }, 'win32')).toBeNull();
    expect(keyboardEventToAccelerator({ ...base, code: 'KeyA' }, 'win32')).toBeNull();
    expect(keyboardEventToAccelerator({ ...base, code: 'F5' }, 'win32')).toBe('F5');
  });
});
