/**
 * Browser-preview stand-in for the Electron bridge (development only).
 * Keeps state in memory and simulates the dictation lifecycle so every screen can be
 * exercised with `npm run dev:web`. Nothing here ships in production builds.
 */
import type { AuraFlowApi } from '../../shared/api';
import { DEFAULT_SETTINGS, applySettingsPatch, sanitizeSettings } from '../../shared/settings';
import type {
  DictationPhase,
  DictationSnapshot,
  HistoryEntry,
  PillCommand,
  SettingsView,
  TrayData,
  Unsubscribe,
} from '../../shared/types';

type Listener<T> = (payload: T) => void;

function emitter<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    on(listener: Listener<T>): Unsubscribe {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(payload: T) {
      listeners.forEach((listener) => listener(payload));
    },
  };
}

const SAMPLE_TEXT = [
  'Draft the release notes for the gothic edition, mention the new tray menu and the offline cleanup fallback.',
  'Remind me to rotate the Gemini key before Friday. Also ask design about the pill glow on Windows.',
  'Hi team, the build is green on macOS and Windows. Shipping the installer tomorrow morning.',
  'Action items: update the README, tag the release, and post the changelog before Monday.',
];

export function createMockBridge(): AuraFlowApi {
  const params = new URLSearchParams(window.location.search);
  let settings = sanitizeSettings({
    ...DEFAULT_SETTINGS,
    onboardingDone: !params.has('onboarding'),
    customVocabulary: ['AuraFlow', 'Gemini', 'Kubernetes'],
  });
  let hotkeyError: string | null = null;
  let apiKey = !params.has('nokey');
  let history: HistoryEntry[] = SAMPLE_TEXT.map((text, index) => ({
    id: `sample-${index}`,
    createdAt: new Date(Date.now() - index * 47 * 60_000).toISOString(),
    text,
    raw: text,
    style: index === 2 ? 'formal' : 'clean',
    words: text.split(/\s+/).length,
    durationMs: 21_000 + index * 9_000,
    model: 'gemini-3.5-transcribe',
  }));
  let phase: DictationPhase = 'idle';
  let detail = '';
  let startedAt: number | null = null;
  let timers: number[] = [];

  const settingsEvents = emitter<SettingsView>();
  const dictationEvents = emitter<DictationSnapshot>();
  const pillEvents = emitter<PillCommand>();
  const streamEvents = emitter<string>();
  const historyEvents = emitter<void>();
  const trayEvents = emitter<TrayData>();

  const view = (): SettingsView => ({
    ...settings,
    hasApiKey: apiKey,
    apiKeyStorage: apiKey ? 'encrypted' : 'none',
    hotkeyError,
  });

  const snapshot = (): DictationSnapshot => ({ phase, detail, startedAt });
  const setPhase = (next: DictationPhase, nextDetail: string) => {
    phase = next;
    detail = nextDetail;
    dictationEvents.emit(snapshot());
    trayEvents.emit({ status: next === 'recording' ? 'Status: Listening...' : 'Status: Ready', phase: next, hotkeyLabel: 'Alt + Space' });
  };
  const later = (ms: number, fn: () => void) => {
    timers.push(window.setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timers.forEach((t) => window.clearTimeout(t));
    timers = [];
  };

  const simulateDictation = () => {
    clearTimers();
    startedAt = Date.now();
    setPhase('recording', 'Listening');
    pillEvents.emit({ type: 'start', microphoneId: settings.microphoneId, maxSeconds: settings.maxRecordingSeconds, soundCues: false });
  };

  const finishSimulation = () => {
    pillEvents.emit({ type: 'stop' });
    setPhase('transcribing', 'Transcribing');
    const text = SAMPLE_TEXT[history.length % SAMPLE_TEXT.length];
    later(700, () => {
      setPhase('refining', 'Polishing');
      let partial = '';
      const words = text.split(' ');
      words.forEach((word, index) => {
        later(60 * index, () => {
          partial = `${partial}${index ? ' ' : ''}${word}`;
          streamEvents.emit(partial);
        });
      });
      later(60 * words.length + 150, () => {
        setPhase('pasting', 'Pasting');
        later(300, () => {
          history = [
            { id: `h-${Date.now()}`, createdAt: new Date().toISOString(), text, raw: text, style: settings.outputStyle, words: words.length, durationMs: 8000, model: settings.refineModel },
            ...history,
          ];
          historyEvents.emit();
          setPhase('done', 'Pasted');
          later(1000, () => {
            setPhase('idle', '');
            pillEvents.emit({ type: 'cancel' });
          });
        });
      });
    });
  };

  const api: AuraFlowApi = {
    async getAppInfo() {
      return { name: 'AuraFlow', version: '1.0.0', platform: navigator.platform.includes('Mac') ? 'darwin' : 'win32', packaged: false, repository: 'https://github.com/vamshicodingmt-gif/Auraflow', hotkeyLabel: 'Alt + Space' };
    },
    async quitApp() {
      window.alert('Quit is available from the tray menu in the desktop app.');
    },
    async getSettings() {
      return view();
    },
    async updateSettings(patch) {
      settings = applySettingsPatch(settings, patch);
      settingsEvents.emit(view());
      return view();
    },
    async saveApiKey(key) {
      if (key.trim().length < 20) return { ok: false, message: "That doesn't look like a Gemini API key." };
      apiKey = true;
      settingsEvents.emit(view());
      return { ok: true, message: 'Key saved (browser preview, not stored).' };
    },
    async clearApiKey() {
      apiKey = false;
      settingsEvents.emit(view());
      return { ok: true, message: 'Key removed.' };
    },
    async testApiKey() {
      return { ok: apiKey, message: apiKey ? `Connected. ${settings.refineModel} replied in 412 ms.` : 'Add your Gemini API key first.' };
    },
    async listHistory() {
      return [...history];
    },
    async deleteHistoryEntry(id) {
      history = history.filter((e) => e.id !== id);
      historyEvents.emit();
    },
    async clearHistory() {
      history = [];
      historyEvents.emit();
    },
    async copyText(text) {
      await navigator.clipboard?.writeText(text).catch(() => undefined);
    },
    async getDictation() {
      return snapshot();
    },
    async toggleDictation() {
      if (phase === 'recording') finishSimulation();
      else if (phase === 'idle' || phase === 'done' || phase === 'error') simulateDictation();
    },
    async cancelDictation() {
      clearTimers();
      pillEvents.emit({ type: 'cancel' });
      setPhase('idle', '');
    },
    async openWindow(target) {
      window.location.href = target === 'settings' ? '/settings.html' : '/';
    },
    async checkForUpdates() {
      return { currentVersion: '1.0.0', latestVersion: null, updateAvailable: false, releaseUrl: 'https://github.com/vamshicodingmt-gif/Auraflow/releases', error: null };
    },
    async getPermissions() {
      return { platform: 'darwin', microphone: 'granted', accessibility: 'granted' };
    },
    async openPermissionSettings() {
      /* Preview only. */
    },
    async requestMicrophone() {
      return true;
    },
    async trayAction(action) {
      if (action === 'open-settings') window.location.href = '/settings.html';
      if (action === 'open-dashboard') window.location.href = '/';
    },
    async hideTrayMenu() {
      /* Preview only. */
    },
    async notifyRecordingStarted() {
      /* Preview only. */
    },
    async notifyRecordingFailed() {
      setPhase('error', 'The microphone could not start.');
    },
    async submitRecording() {
      /* The preview simulates the pipeline instead of transcribing audio. */
    },
    onDictationState: (callback) => dictationEvents.on(callback),
    onPillCommand: (callback) => pillEvents.on(callback),
    onPillStream: (callback) => streamEvents.on(callback),
    onSettingsChanged: (callback) => settingsEvents.on(callback),
    onHistoryChanged: (callback) => historyEvents.on(() => callback()),
    onTrayData: (callback) => trayEvents.on(callback),
  };

  // Preview-only hooks: let the design preview drive pill and dashboard states directly.
  (window as unknown as { __auraflowPreview?: unknown }).__auraflowPreview = {
    emitPillCommand: (command: PillCommand) => pillEvents.emit(command),
    emitDictation: (next: DictationSnapshot) => {
      phase = next.phase;
      detail = next.detail;
      dictationEvents.emit(next);
    },
    emitStream: (text: string) => streamEvents.emit(text),
  };
  return api;
}

