/**
 * Boots the real main-process entry point against a fake `electron` module, then drives the
 * IPC handlers it registers. This catches wiring mistakes that type checks cannot see.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const registry = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  userData: '',
  sentToWindows: [] as { channel: string; payload: unknown }[],
  shortcuts: new Set<string>(),
  windowUrls: [] as string[],
}));

vi.mock('electron', () => {
  class FakeWebContents {
    send(channel: string, payload?: unknown) {
      registry.sentToWindows.push({ channel, payload });
    }
    on() {
      return this;
    }
    setWindowOpenHandler() {
      return this;
    }
  }
  class FakeBrowserWindow {
    static getAllWindows() {
      return [];
    }
    webContents = new FakeWebContents();
    loadURL = vi.fn(async (url: string) => {
      registry.windowUrls.push(url);
    });
    show = vi.fn();
    showInactive = vi.fn();
    hide = vi.fn();
    focus = vi.fn();
    close = vi.fn();
    setBounds = vi.fn();
    setAlwaysOnTop = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
    setMenuBarVisibility = vi.fn();
    isDestroyed = () => false;
    isVisible = () => false;
    isMinimized = () => false;
    restore = vi.fn();
    on() {
      return this;
    }
  }
  class FakeTray {
    setToolTip = vi.fn();
    setImage = vi.fn();
    setContextMenu = vi.fn();
    destroy = vi.fn();
    on() {
      return this;
    }
  }
  class FakeClipboardItem {
    constructor(public data: unknown) {}
  }
  const image = () => ({
    isEmpty: () => false,
    setTemplateImage: vi.fn(),
  });
  const app = {
    isPackaged: false,
    setName: vi.fn(),
    getName: () => 'AuraFlow',
    getVersion: () => '1.0.0',
    getAppPath: () => process.cwd(),
    getPath: () => registry.userData,
    setAppUserModelId: vi.fn(),
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    on: vi.fn(),
    quit: vi.fn(),
    setLoginItemSettings: vi.fn(),
    commandLine: { appendSwitch: vi.fn() },
    dock: undefined,
  };
  return {
    app,
    BrowserWindow: FakeBrowserWindow,
    Tray: FakeTray,
    ClipboardItem: FakeClipboardItem,
    Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn(() => ({})) },
    nativeImage: { createFromPath: vi.fn(image) },
    protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
    net: { fetch: vi.fn() },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
    session: {
      defaultSession: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() },
    },
    globalShortcut: {
      register: vi.fn((accelerator: string) => {
        if (registry.shortcuts.has(accelerator)) return false;
        registry.shortcuts.add(accelerator);
        return true;
      }),
      unregister: vi.fn((accelerator: string) => registry.shortcuts.delete(accelerator)),
      unregisterAll: vi.fn(() => registry.shortcuts.clear()),
    },
    clipboard: {
      readText: vi.fn(),
      writeText: vi.fn(async () => undefined),
      read: vi.fn(async () => []),
      write: vi.fn(async () => undefined),
      clear: vi.fn(),
    },
    dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) },
    shell: { openExternal: vi.fn(async () => undefined) },
    screen: {
      getCursorScreenPoint: () => ({ x: 500, y: 400 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 860 } }),
    },
    systemPreferences: {
      getMediaAccessStatus: () => 'granted',
      isTrustedAccessibilityClient: () => true,
      askForMediaAccess: async () => true,
    },
    ipcMain: {
      handle: (channel: string, handler: Handler) => {
        registry.handlers.set(channel, handler);
      },
      removeHandler: vi.fn(),
    },
  };
});

const TRUSTED = { senderFrame: { url: 'app://renderer/index.html' } };
const UNTRUSTED = { senderFrame: { url: 'https://evil.example/' } };

async function invoke<T = unknown>(channel: string, event: unknown = TRUSTED, ...args: unknown[]): Promise<T> {
  const handler = registry.handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return (await handler(event, ...args)) as T;
}

beforeAll(async () => {
  registry.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'auraflow-main-'));
  await import('../src/main/index');
  // Startup runs inside whenReady().then(...); let the microtasks settle.
  await new Promise((resolve) => setTimeout(resolve, 20));
});

afterAll(() => {
  fs.rmSync(registry.userData, { recursive: true, force: true });
});

describe('main process wiring', () => {
  it('registers every IPC channel the renderer relies on', () => {
    const expected = [
      'app:info', 'settings:get', 'settings:update', 'apikey:save', 'apikey:clear', 'apikey:test',
      'history:list', 'history:delete', 'history:clear', 'clipboard:copy', 'dictation:get',
      'dictation:toggle', 'dictation:cancel', 'window:open', 'updates:check', 'permissions:get',
      'permissions:open', 'microphone:request', 'tray:action', 'tray:hide', 'recording:started',
      'recording:failed', 'recording:submit',
    ];
    for (const channel of expected) {
      expect(registry.handlers.has(channel), channel).toBe(true);
    }
  });

  it('registers the default hotkey on startup', () => {
    expect(registry.shortcuts.has('Alt+Space')).toBe(true);
  });

  it('returns app info and settings to trusted renderers', async () => {
    const info = await invoke<{ name: string; hotkeyLabel: string }>('app:info');
    expect(info.name).toBe('AuraFlow');
    expect(info.hotkeyLabel).toBe('Alt + Space');
    const settings = await invoke<{ hotkey: string; hasApiKey: boolean }>('settings:get');
    expect(settings.hotkey).toBe('Alt+Space');
    expect(settings.hasApiKey).toBe(false);
  });

  it('refuses IPC calls from untrusted origins', async () => {
    await expect(invoke('settings:get', UNTRUSTED)).rejects.toThrow(/untrusted origin/);
  });

  it('validates API keys before storing them', async () => {
    const rejected = await invoke<{ ok: boolean; message: string }>('apikey:save', TRUSTED, 'short');
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toMatch(/doesn't look like a Gemini API key/);

    const saved = await invoke<{ ok: boolean }>('apikey:save', TRUSTED, 'AIzaSyEXAMPLEKEY1234567890abcd');
    expect(saved.ok).toBe(true);
    const settings = await invoke<{ hasApiKey: boolean; apiKeyStorage: string }>('settings:get');
    expect(settings.hasApiKey).toBe(true);
    expect(settings.apiKeyStorage).toBe('plain');
    await invoke('apikey:clear');
  });

  it('applies settings patches and keeps the saved hotkey when the new one is taken', async () => {
    registry.shortcuts.add('Control+Shift+Q');
    const result = await invoke<{ hotkey: string; hotkeyError: string | null; outputStyle: string }>(
      'settings:update',
      TRUSTED,
      { hotkey: 'Control+Shift+Q', outputStyle: 'formal', unknownField: 1 },
    );
    expect(result.hotkey).toBe('Alt+Space');
    expect(result.hotkeyError).toMatch(/unavailable/);
    expect(result.outputStyle).toBe('formal');
    registry.shortcuts.delete('Control+Shift+Q');

    const moved = await invoke<{ hotkey: string; hotkeyError: string | null }>('settings:update', TRUSTED, { hotkey: 'Control+Shift+D' });
    expect(moved.hotkey).toBe('Control+Shift+D');
    expect(moved.hotkeyError).toBeNull();
    expect(registry.shortcuts.has('Control+Shift+D')).toBe(true);
    await invoke('settings:update', TRUSTED, { hotkey: 'Alt+Space', outputStyle: 'clean' });
  });

  it('rejects malformed recording payloads', async () => {
    await expect(invoke('recording:submit', TRUSTED, { wav: 'nope', durationMs: 10, peak: 0.5 })).rejects.toThrow(/Recording audio is missing/);
    await expect(invoke('recording:submit', TRUSTED, { wav: new Uint8Array(0), durationMs: 10, peak: 0.5 })).rejects.toThrow(/out of range/);
  });

  it('reports the dictation state and history as empty on a fresh profile', async () => {
    const snapshot = await invoke<{ phase: string }>('dictation:get');
    expect(snapshot.phase).toBe('idle');
    expect(await invoke('history:list')).toEqual([]);
  });

  it('opens the settings window on first launch without a key', () => {
    expect(registry.windowUrls).toContain('app://renderer/settings.html');
    expect(registry.windowUrls).toContain('app://renderer/pill.html');
  });
});
