/**
 * Shared data contracts used by the Electron main process, the preload bridge
 * and every renderer window. Keep this file free of Node or DOM specifics.
 */

export const OUTPUT_STYLES = ['clean', 'formal', 'casual', 'email', 'bullets', 'verbatim'] as const;
export type OutputStyle = (typeof OUTPUT_STYLES)[number];

export const REFINE_MODEL_IDS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash'] as const;
export type RefineModelId = (typeof REFINE_MODEL_IDS)[number];

export const PILL_PLACEMENTS = ['bottom', 'cursor'] as const;
export type PillPlacement = (typeof PILL_PLACEMENTS)[number];

export const MAX_RECORDING_OPTIONS = [60, 120, 300] as const;

export interface Settings {
  /** Electron accelerator, e.g. "Alt+Space" (Option+Space on macOS). */
  hotkey: string;
  outputStyle: OutputStyle;
  /** Names, jargon and acronyms the transcriber should prefer. */
  customVocabulary: string[];
  refineModel: RefineModelId;
  /** BCP-47 language hint, or "" for automatic detection. */
  languageCode: string;
  /** MediaDevices deviceId, or "" for the system default microphone. */
  microphoneId: string;
  autoPaste: boolean;
  restoreClipboard: boolean;
  soundCues: boolean;
  saveHistory: boolean;
  launchAtLogin: boolean;
  pillPlacement: PillPlacement;
  maxRecordingSeconds: number;
  onboardingDone: boolean;
}

export type ApiKeyStorage = 'encrypted' | 'plain' | 'environment' | 'none';

export interface SettingsView extends Settings {
  hasApiKey: boolean;
  apiKeyStorage: ApiKeyStorage;
  /** Error from the last hotkey registration attempt, or null when the hotkey is active. */
  hotkeyError: string | null;
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  /** Final text that was pasted (or copied). */
  text: string;
  /** Raw transcript before style refinement. */
  raw: string;
  style: OutputStyle;
  words: number;
  durationMs: number;
  model: string;
}

export type DictationPhase =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'refining'
  | 'pasting'
  | 'done'
  | 'error';

export interface DictationSnapshot {
  phase: DictationPhase;
  /** Human-readable detail: streaming text, error message, or outcome. */
  detail: string;
  startedAt: number | null;
}

export type PillCommand =
  | { type: 'start'; microphoneId: string; maxSeconds: number; soundCues: boolean }
  | { type: 'stop' }
  | { type: 'cancel' };

export interface RecordingPayload {
  /** 16 kHz mono 16-bit PCM WAV bytes. */
  wav: Uint8Array;
  durationMs: number;
  /** Peak absolute sample value in [0, 1]; used to detect silence. */
  peak: number;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  packaged: boolean;
  repository: string;
  hotkeyLabel: string;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string;
  error: string | null;
}

export type MicrophoneStatus = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';

export interface PermissionStatus {
  platform: string;
  microphone: MicrophoneStatus;
  /** macOS only: whether AuraFlow may send keystrokes (needed for auto-paste). */
  accessibility: 'granted' | 'missing' | 'not-applicable';
}

export type TrayAction = 'open-dashboard' | 'open-settings' | 'check-updates' | 'quit';

export type WindowView = 'dashboard' | 'settings';

export interface TrayData {
  /** Status line such as "Status: Ready" or "Status: Listening...". */
  status: string;
  phase: DictationPhase;
  hotkeyLabel: string;
}

export type Unsubscribe = () => void;
