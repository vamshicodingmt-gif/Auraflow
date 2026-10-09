import type {
  ActionResult,
  AppInfo,
  DictationSnapshot,
  HistoryEntry,
  PermissionStatus,
  PillCommand,
  RecordingPayload,
  Settings,
  SettingsView,
  TrayAction,
  TrayData,
  Unsubscribe,
  UpdateInfo,
  WindowView,
} from './types';

/**
 * The surface exposed to renderer windows as `window.auraflow` by the preload script.
 * Every method maps 1:1 to an IPC channel in ./ipc.ts.
 */
export interface AuraFlowApi {
  getAppInfo(): Promise<AppInfo>;
  quitApp(): Promise<void>;

  getSettings(): Promise<SettingsView>;
  updateSettings(patch: Partial<Settings>): Promise<SettingsView>;

  saveApiKey(key: string): Promise<ActionResult>;
  clearApiKey(): Promise<ActionResult>;
  testApiKey(): Promise<ActionResult>;

  listHistory(): Promise<HistoryEntry[]>;
  deleteHistoryEntry(id: string): Promise<void>;
  clearHistory(): Promise<void>;
  copyText(text: string): Promise<void>;

  getDictation(): Promise<DictationSnapshot>;
  toggleDictation(): Promise<void>;
  cancelDictation(): Promise<void>;

  openWindow(view: WindowView): Promise<void>;
  checkForUpdates(): Promise<UpdateInfo>;

  getPermissions(): Promise<PermissionStatus>;
  openPermissionSettings(which: 'microphone' | 'accessibility'): Promise<void>;
  requestMicrophone(): Promise<boolean>;

  /** Tray popup actions. */
  trayAction(action: TrayAction): Promise<void>;
  hideTrayMenu(): Promise<void>;

  /** Recording pill: report lifecycle back to the main process. */
  notifyRecordingStarted(): Promise<void>;
  notifyRecordingFailed(message: string): Promise<void>;
  submitRecording(payload: RecordingPayload): Promise<void>;

  onDictationState(callback: (snapshot: DictationSnapshot) => void): Unsubscribe;
  onPillCommand(callback: (command: PillCommand) => void): Unsubscribe;
  onPillStream(callback: (text: string) => void): Unsubscribe;
  onSettingsChanged(callback: (settings: SettingsView) => void): Unsubscribe;
  onHistoryChanged(callback: () => void): Unsubscribe;
  onTrayData(callback: (data: TrayData) => void): Unsubscribe;
}
