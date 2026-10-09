import { globalShortcut } from 'electron';
import { formatAcceleratorLabel, isValidAccelerator } from '../shared/hotkey';

export interface HotkeyResult {
  ok: boolean;
  message: string | null;
}

/**
 * Owns the global dictation hotkey. Escape is only registered while a recording is live,
 * so it does not steal Escape from other apps the rest of the time.
 */
export class HotkeyController {
  private active: string | null = null;
  private escapeRegistered = false;

  constructor(
    private readonly onTrigger: () => void,
    private readonly onCancel: () => void,
    private readonly platform: string,
  ) {}

  current(): string | null {
    return this.active;
  }

  register(accelerator: string): HotkeyResult {
    if (!isValidAccelerator(accelerator)) {
      return { ok: false, message: 'That shortcut is not valid. Include a modifier such as Alt, Control or Shift.' };
    }
    if (this.active === accelerator) return { ok: true, message: null };

    const previous = this.active;
    if (previous) globalShortcut.unregister(previous);

    let registered = false;
    try {
      registered = globalShortcut.register(accelerator, () => this.onTrigger());
    } catch {
      registered = false;
    }

    if (!registered) {
      // Put the previous shortcut back so dictation keeps working.
      if (previous) {
        try {
          globalShortcut.register(previous, () => this.onTrigger());
        } catch {
          this.active = null;
        }
      }
      const label = formatAcceleratorLabel(accelerator, this.platform);
      return { ok: false, message: `${label} is unavailable. Another app or the system may already use it.` };
    }

    this.active = accelerator;
    return { ok: true, message: null };
  }

  setCancelListening(listening: boolean): void {
    if (listening && !this.escapeRegistered) {
      try {
        this.escapeRegistered = globalShortcut.register('Escape', () => this.onCancel());
      } catch {
        this.escapeRegistered = false;
      }
    } else if (!listening && this.escapeRegistered) {
      globalShortcut.unregister('Escape');
      this.escapeRegistered = false;
    }
  }

  unregisterAll(): void {
    globalShortcut.unregisterAll();
    this.active = null;
    this.escapeRegistered = false;
  }
}
