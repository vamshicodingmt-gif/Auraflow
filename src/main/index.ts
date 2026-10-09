/**
 * AuraFlow (Goth Edition) — Electron main process.
 * Owns the tray, global hotkey, recording pill, dictation pipeline, settings and history.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { app, clipboard, ClipboardItem, dialog, globalShortcut, Menu, nativeImage, net, safeStorage, session, shell, type Rectangle } from 'electron';
import { fallbackClean } from '../shared/fallback-clean';
import { IPC } from '../shared/ipc';
import { buildRefineSystemInstruction, buildRefineUserInput } from '../shared/prompts';
import { refineText, transcribeAudio, TRANSCRIBE_MODEL } from '../shared/gemini';
import { DEFAULT_HOTKEY, formatAcceleratorLabel } from '../shared/hotkey';
import type { DictationSnapshot, TrayAction, UpdateInfo } from '../shared/types';
import { DictationController } from './dictation';
import { registerIpc } from './ipc';
import { HotkeyController } from './hotkeys';
import { installRendererProtocol, registerRendererScheme, RENDERER_ORIGIN } from './protocol';
import { checkForUpdates, RELEASES_PAGE } from './updates';
import { openPermissionSettings, readPermissions, requestMicrophoneAccess } from './permissions';
import { createKeystrokeSender, PasteService, type ClipboardEntry, type ClipboardPort, type CommandRunner } from './paste';
import { HistoryStore, SecretStore, SettingsStore } from './store';
import { TrayController } from './tray';
import { WindowManager } from './windows';

const APP_NAME = 'AuraFlow';
const APP_USER_MODEL_ID = 'com.auraflow.goth';
const REPOSITORY_URL = 'https://github.com/vamshicodingmt-gif/Auraflow';

app.setName(APP_NAME);
// Recording and cue sounds start from the global hotkey, so they must not wait for a click.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
registerRendererScheme();

const isPackaged = app.isPackaged;
const devServerUrl = process.env.ELECTRON_RENDERER_URL ?? null;

function resolveAsset(relativePath: string): string {
  return isPackaged ? path.join(process.resourcesPath, relativePath) : path.join(app.getAppPath(), relativePath);
}

/** Electron's own fetch: honours system proxies and certificate stores. */
const chromiumFetch = ((input: string | URL, init?: RequestInit) =>
  net.fetch(input.toString(), init as Parameters<typeof net.fetch>[1])) as unknown as typeof fetch;

const runCommand: CommandRunner = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      let code = 0;
      if (error) {
        const raw = (error as NodeJS.ErrnoException).code;
        code = typeof raw === 'number' ? raw : 127;
      }
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

const clipboardPort: ClipboardPort = {
  async snapshot() {
    const items = await clipboard.read();
    const entries: ClipboardEntry[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      for (const type of item.types) {
        if (seen.has(type)) continue;
        seen.add(type);
        entries.push({ type, value: await item.getType(type as never) });
      }
    }
    const textEntry = entries.find((entry) => entry.type === 'text/plain');
    const text = textEntry && textEntry.value instanceof Blob ? await textEntry.value.text() : null;
    return { text, entries };
  },
  async writeText(text) {
    await clipboard.writeText(text);
  },
  async restore(snapshot) {
    if (snapshot.entries.length === 0) {
      clipboard.clear();
      return;
    }
    const data: Record<string, unknown> = {};
    for (const entry of snapshot.entries) data[entry.type] = entry.value;
    try {
      await clipboard.write([new ClipboardItem(data as never)]);
    } catch {
      // Some exotic formats cannot be re-written; fall back to the plain text.
      if (snapshot.text !== null) await clipboard.writeText(snapshot.text);
    }
  },
};

function installApplicationMenu(): void {
  const editMenu: Electron.MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  };
  const template: Electron.MenuItemConstructorOptions[] = [];
  if (process.platform === 'darwin') {
    template.push({
      label: APP_NAME,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit AuraFlow' },
      ],
    });
  }
  template.push(editMenu, { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function isTrustedOrigin(url: string | undefined | null, origins: string[]): boolean {
  if (!url) return false;
  return origins.some((origin) => url === origin || url.startsWith(`${origin}/`));
}

function startApp(): void {
  if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);
  installApplicationMenu();

  const windowIcon = process.platform === 'win32' ? resolveAsset('build/icon.ico') : resolveAsset('build/icon.png');
  if (process.platform === 'darwin' && app.dock) {
    const dockIcon = nativeImage.createFromPath(resolveAsset('build/icon.png'));
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }

  installRendererProtocol(path.join(app.getAppPath(), 'dist-renderer'));

  const trustedOrigins = [RENDERER_ORIGIN, ...(devServerUrl ? [new URL(devServerUrl).origin] : [])];
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
    const allowed = permission === 'media'
      && isTrustedOrigin(webContents?.getURL(), trustedOrigins)
      && !mediaTypes.includes('video');
    callback(allowed);
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    permission === 'media' && isTrustedOrigin(requestingOrigin, trustedOrigins),
  );

  const userData = app.getPath('userData');
  const settings = new SettingsStore(path.join(userData, 'settings.json'));
  const secrets = new SecretStore(path.join(userData, 'secrets.json'), {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plain) => safeStorage.encryptString(plain),
    decryptString: (cipher) => safeStorage.decryptString(cipher),
  }, () => process.env.GEMINI_API_KEY);
  const history = new HistoryStore(path.join(userData, 'history.json'));

  const windows = new WindowManager({
    devServerUrl,
    rendererOrigin: RENDERER_ORIGIN,
    preloadPath: path.join(__dirname, '../preload/index.js'),
    iconPath: windowIcon,
  });

  let tray: TrayController | undefined;
  let hotkeyError: string | null = null;

  const emitSnapshot = (snapshot: DictationSnapshot) => {
    windows.broadcast(IPC.evtDictation, snapshot);
    tray?.setStatus(snapshot);
  };

  const pasteService = new PasteService(clipboardPort, createKeystrokeSender(process.platform, runCommand));

  const controller: DictationController = new DictationController({
    getSettings: () => settings.get(),
    getApiKey: () => secrets.getApiKey(),
    transcribe: (request) =>
      transcribeAudio({
        apiKey: request.apiKey,
        fetchImpl: chromiumFetch,
        wav: request.wav,
        mode: request.mode,
        vocabulary: request.vocabulary,
        languageCode: request.languageCode || undefined,
      }),
    refine: (request) =>
      refineText({
        apiKey: request.apiKey,
        fetchImpl: chromiumFetch,
        model: request.model,
        systemInstruction: buildRefineSystemInstruction(request.style, request.vocabulary),
        userText: buildRefineUserInput(request.text),
        onDelta: (_delta, full) => request.onDelta(full),
      }),
    fallbackClean,
    paste: (text, options) => pasteService.paste(text, options),
    saveHistory: (entry) => {
      history.add(entry);
      windows.broadcast(IPC.evtHistory);
    },
    pill: {
      show: () => windows.showPill(settings.get().pillPlacement),
      hide: () => {
        windows.hidePill();
        hotkeys.setCancelListening(false);
      },
      send: (command) => {
        if (command.type === 'start') hotkeys.setCancelListening(true);
        if (command.type === 'stop') hotkeys.setCancelListening(false);
        windows.sendToPill(IPC.evtPillCommand, command);
      },
      stream: (text) => windows.sendToPill(IPC.evtPillStream, text),
    },
    emit: emitSnapshot,
    openSettings: () => windows.showView('settings'),
    log: (message, error) => console.warn(`[dictation] ${message}`, error ?? ''),
    now: () => Date.now(),
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
    transcriptionModel: TRANSCRIBE_MODEL,
  });

  const hotkeys = new HotkeyController(
    () => controller.toggle(),
    () => controller.cancel(),
    process.platform,
  );
  const initialHotkey = hotkeys.register(settings.get().hotkey);
  if (!initialHotkey.ok) {
    hotkeyError = initialHotkey.message;
    if (settings.get().hotkey !== DEFAULT_HOTKEY) console.warn('Saved hotkey unavailable:', initialHotkey.message);
  }

  const applyLoginItem = (enabled: boolean) => {
    if (!isPackaged) return;
    app.setLoginItemSettings({ openAtLogin: enabled });
  };
  applyLoginItem(settings.get().launchAtLogin);

  const trayData = () => ({
    status: tray?.currentStatus() ?? 'Status: Ready',
    phase: controller.snapshot().phase,
    hotkeyLabel: formatAcceleratorLabel(settings.get().hotkey, process.platform),
  });

  const showUpdateDialog = async (): Promise<void> => {
    const info: UpdateInfo = await checkForUpdates(app.getVersion(), chromiumFetch);
    if (info.error) {
      await dialog.showMessageBox({ type: 'warning', title: APP_NAME, message: 'Could not check for updates.', detail: info.error });
      return;
    }
    if (!info.latestVersion) {
      await dialog.showMessageBox({
        type: 'info',
        title: APP_NAME,
        message: 'No published release yet.',
        detail: `You are running AuraFlow ${info.currentVersion}. Releases appear at ${RELEASES_PAGE}.`,
      });
      return;
    }
    if (info.updateAvailable) {
      const choice = await dialog.showMessageBox({
        type: 'info',
        title: APP_NAME,
        message: `AuraFlow ${info.latestVersion} is available.`,
        detail: `You are on ${info.currentVersion}. Open the release page to download the latest build.`,
        buttons: ['Open Release Page', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (choice.response === 0) await shell.openExternal(info.releaseUrl);
      return;
    }
    await dialog.showMessageBox({
      type: 'info',
      title: APP_NAME,
      message: "You're up to date.",
      detail: `AuraFlow ${info.currentVersion} is the latest published release.`,
    });
  };

  const runTrayAction = async (action: TrayAction): Promise<void> => {
    windows.hideTrayMenu();
    switch (action) {
      case 'open-dashboard':
        windows.showView('dashboard');
        break;
      case 'open-settings':
        windows.showView('settings');
        break;
      case 'check-updates':
        await showUpdateDialog();
        break;
      case 'quit':
        app.quit();
        break;
    }
  };

  tray = new TrayController({
    assetPath: (fileName) => resolveAsset(path.join('assets', 'tray', fileName)),
    onLeftClick: () => windows.showView('dashboard'),
    onRightClick: (anchor: Rectangle) => windows.showTrayMenu(anchor, trayData()),
    onNativeAction: (action) => void runTrayAction(action),
  });

  registerIpc({
    trustedOrigins,
    settings,
    secrets,
    history,
    controller,
    windows,
    hotkeys,
    platform: process.platform,
    repository: REPOSITORY_URL,
    packaged: isPackaged,
    fetchImpl: chromiumFetch,
    applyLoginItem,
    readPermissions,
    openPermission: openPermissionSettings,
    requestMicrophone: requestMicrophoneAccess,
    checkUpdates: () => checkForUpdates(app.getVersion(), chromiumFetch),
    runTrayAction,
    quit: () => app.quit(),
    getHotkeyError: () => hotkeyError,
    setHotkeyError: (message) => {
      hotkeyError = message;
    },
    broadcastSettings: () => {
      const view = {
        ...settings.get(),
        hasApiKey: secrets.storageKind() !== 'none',
        apiKeyStorage: secrets.storageKind(),
        hotkeyError,
      };
      windows.broadcast(IPC.evtSettings, view);
    },
    broadcastHistory: () => windows.broadcast(IPC.evtHistory),
    trayData,
  });

  windows.preload();

  const needsSetup = !settings.get().onboardingDone || !secrets.getApiKey();
  if (needsSetup) windows.showView('settings');

  app.on('activate', () => windows.showView('dashboard'));
  app.on('second-instance', () => windows.showView('dashboard'));
  app.on('before-quit', () => {
    windows.markQuitting();
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    tray?.destroy();
  });
}

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in AuraFlow main process', error);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(startApp).catch((error: unknown) => {
    console.error('AuraFlow failed to start', error);
    app.quit();
  });
  // macOS keeps the app alive with no windows; every other platform keeps running in the tray.
  app.on('window-all-closed', () => undefined);
}
