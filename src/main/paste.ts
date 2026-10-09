/**
 * Puts dictated text where the cursor is: write the clipboard, send the platform paste
 * shortcut to the frontmost app, then restore the user's previous clipboard.
 *
 * Clipboard and keystroke access are injected so the sequence is unit-testable.
 */

/** One clipboard format (e.g. text/plain, text/html, image/png) with its opaque payload. */
export interface ClipboardEntry {
  type: string;
  value: unknown;
}

export interface ClipboardSnapshot {
  /** Plain-text value when present, for diagnostics and text-only fallbacks. */
  text: string | null;
  entries: ClipboardEntry[];
}

/** Async clipboard access (Electron 44's clipboard API is promise-based). */
export interface ClipboardPort {
  snapshot(): Promise<ClipboardSnapshot>;
  writeText(text: string): Promise<void>;
  restore(snapshot: ClipboardSnapshot): Promise<void>;
}

export type KeystrokeResult =
  | { ok: true }
  | { ok: false; reason: 'permission' | 'unsupported' | 'failed'; message: string };

export interface KeystrokePort {
  sendPaste(): Promise<KeystrokeResult>;
}

export interface PasteOutcome {
  status: 'pasted' | 'copied';
  message: string;
}

export interface PasteOptions {
  autoPaste: boolean;
  restoreClipboard: boolean;
}

export class PasteService {
  constructor(
    private readonly clipboard: ClipboardPort,
    private readonly keystroke: KeystrokePort,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly restoreDelayMs = 450,
  ) {}

  async paste(text: string, options: PasteOptions): Promise<PasteOutcome> {
    const previous = options.restoreClipboard
      ? await this.clipboard.snapshot().catch(() => null)
      : null;
    await this.clipboard.writeText(text);

    if (!options.autoPaste) {
      return { status: 'copied', message: 'Copied to clipboard' };
    }

    // Give the clipboard a beat to settle before the keystroke is delivered.
    await this.sleep(60);
    const result = await this.keystroke.sendPaste();
    if (!result.ok) {
      // Leave the text on the clipboard so the user can paste it manually.
      const message = result.reason === 'permission'
        ? 'Copied. Allow AuraFlow in Accessibility settings to auto-paste.'
        : 'Copied. Press your paste shortcut to insert it.';
      return { status: 'copied', message };
    }

    if (previous) {
      // Let the target app read the pasted text before the clipboard is restored.
      await this.sleep(this.restoreDelayMs);
      await this.clipboard.restore(previous).catch(() => undefined);
    }
    return { status: 'pasted', message: 'Pasted' };
  }
}

export type CommandRunner = (
  file: string,
  args: string[],
  timeoutMs: number,
) => Promise<{ code: number; stdout: string; stderr: string }>;

export const MAC_PASTE_SCRIPT = 'tell application "System Events" to keystroke "v" using command down';
export const WINDOWS_PASTE_COMMAND = "(New-Object -ComObject WScript.Shell).SendKeys('^v')";

/** Builds the platform-specific paste sender. */
export function createKeystrokeSender(platform: string, run: CommandRunner): KeystrokePort {
  if (platform === 'darwin') {
    return {
      async sendPaste() {
        const result = await run('osascript', ['-e', MAC_PASTE_SCRIPT], 4000);
        if (result.code === 0) return { ok: true };
        const detail = `${result.stderr} ${result.stdout}`.toLowerCase();
        if (detail.includes('assistive') || detail.includes('not allowed') || detail.includes('1002') || detail.includes('1719')) {
          return { ok: false, reason: 'permission', message: 'Accessibility permission is required to paste.' };
        }
        return { ok: false, reason: 'failed', message: result.stderr.trim() || 'Paste keystroke failed.' };
      },
    };
  }

  if (platform === 'win32') {
    return {
      async sendPaste() {
        const result = await run(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_PASTE_COMMAND],
          6000,
        );
        return result.code === 0
          ? { ok: true }
          : { ok: false, reason: 'failed', message: result.stderr.trim() || 'Paste keystroke failed.' };
      },
    };
  }

  // Linux: X11 via xdotool when available. Wayland users fall back to copy-only.
  return {
    async sendPaste() {
      const probe = await run('sh', ['-c', 'command -v xdotool'], 2000);
      if (probe.code !== 0) {
        return { ok: false, reason: 'unsupported', message: 'Install xdotool to enable auto-paste on Linux.' };
      }
      const result = await run('xdotool', ['key', '--clearmodifiers', 'ctrl+v'], 4000);
      return result.code === 0
        ? { ok: true }
        : { ok: false, reason: 'failed', message: result.stderr.trim() || 'xdotool could not paste.' };
    },
  };
}
