import { describe, expect, it, vi } from 'vitest';
import { createKeystrokeSender, MAC_PASTE_SCRIPT, PasteService, WINDOWS_PASTE_COMMAND, type ClipboardPort, type ClipboardSnapshot, type KeystrokePort } from '../src/main/paste';

function memoryClipboard(initial: string) {
  let text = initial;
  const snapshotState: ClipboardSnapshot = { text: initial, entries: [{ type: 'text/plain', value: initial }] };
  const port: ClipboardPort = {
    snapshot: vi.fn(async () => ({ ...snapshotState, text })),
    writeText: vi.fn(async (value: string) => {
      text = value;
    }),
    restore: vi.fn(async (state: ClipboardSnapshot) => {
      text = state.text ?? '';
    }),
  };
  return { port, current: () => text };
}

const noSleep = async () => undefined;

describe('PasteService', () => {
  it('writes the text, pastes it and restores the previous clipboard', async () => {
    const clip = memoryClipboard('my old clipboard');
    const keystroke: KeystrokePort = { sendPaste: vi.fn(async () => ({ ok: true as const })) };
    const service = new PasteService(clip.port, keystroke, noSleep);

    const outcome = await service.paste('Dictated text', { autoPaste: true, restoreClipboard: true });
    expect(outcome).toEqual({ status: 'pasted', message: 'Pasted' });
    expect(clip.port.writeText).toHaveBeenCalledWith('Dictated text');
    expect(keystroke.sendPaste).toHaveBeenCalledTimes(1);
    expect(clip.port.restore).toHaveBeenCalledTimes(1);
    expect(clip.current()).toBe('my old clipboard');
  });

  it('leaves the dictated text on the clipboard when restoring is disabled', async () => {
    const clip = memoryClipboard('old');
    const service = new PasteService(clip.port, { sendPaste: async () => ({ ok: true }) }, noSleep);
    await service.paste('new', { autoPaste: true, restoreClipboard: false });
    expect(clip.port.snapshot).not.toHaveBeenCalled();
    expect(clip.current()).toBe('new');
  });

  it('only copies when auto-paste is off', async () => {
    const clip = memoryClipboard('old');
    const keystroke = { sendPaste: vi.fn(async () => ({ ok: true as const })) };
    const outcome = await new PasteService(clip.port, keystroke, noSleep).paste('new', { autoPaste: false, restoreClipboard: true });
    expect(outcome.status).toBe('copied');
    expect(keystroke.sendPaste).not.toHaveBeenCalled();
    expect(clip.current()).toBe('new');
  });

  it('keeps the text available and explains a missing Accessibility permission', async () => {
    const clip = memoryClipboard('old');
    const keystroke = { sendPaste: async () => ({ ok: false as const, reason: 'permission' as const, message: 'x' }) };
    const outcome = await new PasteService(clip.port, keystroke, noSleep).paste('new', { autoPaste: true, restoreClipboard: true });
    expect(outcome).toEqual({ status: 'copied', message: 'Copied. Allow AuraFlow in Accessibility settings to auto-paste.' });
    expect(clip.port.restore).not.toHaveBeenCalled();
    expect(clip.current()).toBe('new');
  });
});

describe('createKeystrokeSender', () => {
  it('uses osascript on macOS and reports Accessibility denials', async () => {
    const run = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'osascript: execution error: System Events got an error: not allowed assistive access. (1002)' }));
    const result = await createKeystrokeSender('darwin', run).sendPaste();
    expect(run).toHaveBeenCalledWith('osascript', ['-e', MAC_PASTE_SCRIPT], expect.any(Number));
    expect(result).toMatchObject({ ok: false, reason: 'permission' });
  });

  it('succeeds on macOS when osascript exits cleanly', async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));
    expect(await createKeystrokeSender('darwin', run).sendPaste()).toEqual({ ok: true });
  });

  it('sends Ctrl+V through PowerShell on Windows', async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));
    await createKeystrokeSender('win32', run).sendPaste();
    expect(run).toHaveBeenCalledWith('powershell.exe', expect.arrayContaining(['-Command', WINDOWS_PASTE_COMMAND]), expect.any(Number));
  });

  it('uses xdotool on Linux only when it is installed', async () => {
    const missing = vi.fn(async () => ({ code: 1, stdout: '', stderr: '' }));
    expect(await createKeystrokeSender('linux', missing).sendPaste()).toMatchObject({ ok: false, reason: 'unsupported' });

    const present = vi.fn(async (file: string) => ({ code: 0, stdout: file === 'sh' ? '/usr/bin/xdotool' : '', stderr: '' }));
    expect(await createKeystrokeSender('linux', present).sendPaste()).toEqual({ ok: true });
    expect(present).toHaveBeenLastCalledWith('xdotool', ['key', '--clearmodifiers', 'ctrl+v'], expect.any(Number));
  });
});
