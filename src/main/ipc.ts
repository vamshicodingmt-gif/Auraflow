import { app, clipboard, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../shared/ipc';
import { applySettingsPatch } from '../shared/settings';
import { GeminiError, looksLikeApiKey, testConnection } from '../shared/gemini';
import { formatAcceleratorLabel } from '../shared/hotkey';
import type {
  ActionResult,
  AppInfo,
  PermissionStatus,
  RecordingPayload,
  SettingsView,
  TrayAction,
  TrayData,
  UpdateInfo,
  WindowView,
} from '../shared/types';
import type { DictationController } from './dictation';
import type { HistoryStore, SecretStore, SettingsStore } from './store';
import type { HotkeyController } from './hotkeys';
import type { WindowManager } from './windows';

export const MAX_RECORDING_BYTES = 25 * 1024 * 1024;

export interface IpcServices {
  trustedOrigins: string[];
  settings: SettingsStore;
  secrets: SecretStore;
  history: HistoryStore;
  controller: DictationController;
  windows: WindowManager;
  hotkeys: HotkeyController;
  platform: string;
  repository: string;
  packaged: boolean;
  fetchImpl: typeof fetch;
  applyLoginItem(enabled: boolean): void;
  readPermissions(): PermissionStatus;
  openPermission(which: 'microphone' | 'accessibility'): Promise<void>;
  requestMicrophone(): Promise<boolean>;
  checkUpdates(): Promise<UpdateInfo>;
  runTrayAction(action: TrayAction): Promise<void>;
  quit(): void;
  getHotkeyError(): string | null;
  setHotkeyError(message: string | null): void;
  broadcastSettings(): void;
  broadcastHistory(): void;
  trayData(): TrayData;
}

function isTrusted(event: IpcMainInvokeEvent, origins: string[]): boolean {
  const url = event.senderFrame?.url ?? '';
  return origins.some((origin) => url === origin || url.startsWith(`${origin}/`));
}

function errorMessage(error: unknown): string {
  if (error instanceof GeminiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

function normalizeRecording(payload: unknown): RecordingPayload {
  if (typeof payload !== 'object' || payload === null) throw new Error('Invalid recording payload.');
  const record = payload as Record<string, unknown>;
  let wav: Uint8Array;
  if (record.wav instanceof Uint8Array) wav = record.wav;
  else if (record.wav instanceof ArrayBuffer) wav = new Uint8Array(record.wav);
  else throw new Error('Recording audio is missing.');
  if (wav.byteLength === 0 || wav.byteLength > MAX_RECORDING_BYTES) throw new Error('Recording size is out of range.');
  const durationMs = typeof record.durationMs === 'number' && Number.isFinite(record.durationMs) ? record.durationMs : 0;
  const peak = typeof record.peak === 'number' && Number.isFinite(record.peak) ? Math.min(1, Math.max(0, record.peak)) : 0;
  return { wav, durationMs, peak };
}

export function registerIpc(services: IpcServices): void {
  const { settings, secrets, history, controller, windows, hotkeys } = services;

  const guard = (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrusted(event, services.trustedOrigins)) {
        throw new Error(`Blocked IPC call from an untrusted origin (${channel}).`);
      }
      return handler(event, ...args);
    });
  };

  const settingsView = (): SettingsView => ({
    ...settings.get(),
    hasApiKey: secrets.storageKind() !== 'none',
    apiKeyStorage: secrets.storageKind(),
    hotkeyError: services.getHotkeyError(),
  });

  guard(IPC.appInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: services.platform,
    packaged: services.packaged,
    repository: services.repository,
    hotkeyLabel: formatAcceleratorLabel(settings.get().hotkey, services.platform),
  }));

  guard(IPC.appQuit, () => {
    services.quit();
  });

  guard(IPC.settingsGet, () => settingsView());

  guard(IPC.settingsUpdate, (_event, patch) => {
    const before = settings.get();
    const candidate = applySettingsPatch(before, patch);
    let hotkey = candidate.hotkey;
    let hotkeyError: string | null = services.getHotkeyError();

    if (hotkey !== before.hotkey) {
      const result = hotkeys.register(hotkey);
      if (result.ok) {
        hotkeyError = null;
      } else {
        // HotkeyController restores the previous shortcut; keep the saved value unchanged.
        hotkey = before.hotkey;
        hotkeyError = result.message;
      }
    }

    settings.update({ ...candidate, hotkey });
    services.setHotkeyError(hotkeyError);
    if (candidate.launchAtLogin !== before.launchAtLogin) services.applyLoginItem(candidate.launchAtLogin);
    services.broadcastSettings();
    return settingsView();
  });

  guard(IPC.apiKeySave, (_event, key): ActionResult => {
    const value = typeof key === 'string' ? key.trim() : '';
    if (!looksLikeApiKey(value)) {
      return { ok: false, message: "That doesn't look like a Gemini API key. Copy the whole key from Google AI Studio." };
    }
    const storage = secrets.setApiKey(value);
    services.broadcastSettings();
    return {
      ok: true,
      message: storage === 'encrypted'
        ? 'Key saved and encrypted with your OS keychain.'
        : 'Key saved. The OS keychain is unavailable, so the key is stored with file permissions only.',
    };
  });

  guard(IPC.apiKeyClear, (): ActionResult => {
    secrets.clear();
    services.broadcastSettings();
    return { ok: true, message: 'Key removed.' };
  });

  guard(IPC.apiKeyTest, async (): Promise<ActionResult> => {
    const key = secrets.getApiKey();
    if (!key) return { ok: false, message: 'Add your Gemini API key first.' };
    try {
      const result = await testConnection({ apiKey: key, model: settings.get().refineModel, fetchImpl: services.fetchImpl });
      if (!settings.get().onboardingDone) {
        settings.update({ onboardingDone: true });
        services.broadcastSettings();
      }
      return { ok: true, message: `Connected. ${result.model} replied in ${result.latencyMs} ms.` };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  });

  guard(IPC.historyList, () => history.list());
  guard(IPC.historyDelete, (_event, id) => {
    if (typeof id === 'string') history.remove(id);
    services.broadcastHistory();
  });
  guard(IPC.historyClear, () => {
    history.clear();
    services.broadcastHistory();
  });

  guard(IPC.clipboardCopy, async (_event, text) => {
    if (typeof text === 'string' && text.length <= 200_000) await clipboard.writeText(text);
  });

  guard(IPC.dictationGet, () => controller.snapshot());
  guard(IPC.dictationToggle, () => {
    controller.toggle();
  });
  guard(IPC.dictationCancel, () => {
    controller.cancel();
  });

  guard(IPC.windowOpen, (_event, view) => {
    const target: WindowView = view === 'settings' ? 'settings' : 'dashboard';
    windows.showView(target);
  });

  guard(IPC.updatesCheck, () => services.checkUpdates());

  guard(IPC.permissionsGet, () => services.readPermissions());
  guard(IPC.permissionsOpen, (_event, which) => services.openPermission(which === 'accessibility' ? 'accessibility' : 'microphone'));
  guard(IPC.microphoneRequest, () => services.requestMicrophone());

  guard(IPC.trayAction, (_event, action) => services.runTrayAction(action as TrayAction));
  guard(IPC.trayHide, () => {
    windows.hideTrayMenu();
  });

  guard(IPC.recordingStarted, () => {
    controller.onRecordingStarted();
  });
  guard(IPC.recordingFailed, (_event, message) => {
    controller.onRecordingFailed(typeof message === 'string' ? message.slice(0, 300) : 'The microphone could not start.');
  });
  guard(IPC.recordingSubmit, (_event, payload) => {
    const recording = normalizeRecording(payload);
    void controller.onRecordingSubmitted(recording);
  });
}
