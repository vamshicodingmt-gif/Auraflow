/**
 * Dictation state machine: idle -> recording -> transcribing -> refining -> pasting -> done.
 * Every side effect (Gemini, clipboard, windows, timers) is injected so the flow is unit-testable.
 */
import { GeminiError } from '../shared/gemini';
import { fallbackClean as defaultFallbackClean } from '../shared/fallback-clean';
import { sanitizeModelOutput } from '../shared/prompts';
import { countWords } from '../shared/stats';
import type { OutputStyle, DictationPhase, DictationSnapshot, PillCommand, RecordingPayload, Settings } from '../shared/types';
import type { PasteOptions, PasteOutcome } from './paste';

export const MIN_RECORDING_MS = 350;
export const MIN_PEAK_LEVEL = 0.012;
const SUBMIT_WATCHDOG_MS = 6000;
const IDLE_AFTER_ERROR_MS = 4200;
const IDLE_AFTER_DONE_MS = 1000;
const IDLE_AFTER_DEGRADED_MS = 2600;

export type TimerHandle = unknown;

export interface PillPort {
  show(): void;
  hide(): void;
  send(command: PillCommand): void;
  stream(text: string): void;
}

export interface TranscribeRequest {
  wav: Uint8Array;
  mode: 'smart' | 'verbatim';
  vocabulary: string[];
  languageCode: string;
  apiKey: string;
}

export interface RefineRequest {
  text: string;
  style: Exclude<OutputStyle, 'verbatim'>;
  vocabulary: string[];
  model: string;
  apiKey: string;
  onDelta: (fullText: string) => void;
}

export interface DictationDeps {
  getSettings(): Settings;
  getApiKey(): string | undefined;
  transcribe(request: TranscribeRequest): Promise<string>;
  refine(request: RefineRequest): Promise<string>;
  fallbackClean?(raw: string): string;
  paste(text: string, options: PasteOptions): Promise<PasteOutcome>;
  saveHistory(entry: { text: string; raw: string; style: OutputStyle; words: number; durationMs: number; model: string }): void;
  pill: PillPort;
  emit(snapshot: DictationSnapshot): void;
  openSettings(): void;
  log(message: string, error?: unknown): void;
  now(): number;
  setTimer(callback: () => void, ms: number): TimerHandle;
  clearTimer(handle: TimerHandle): void;
  transcriptionModel: string;
}

function friendlyError(error: unknown): string {
  if (error instanceof GeminiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Dictation failed. Please try again.';
}

export class DictationController {
  private phase: DictationPhase = 'idle';
  private detail = '';
  private startedAt: number | null = null;
  private processing = false;
  private idleTimer: TimerHandle | null = null;
  private watchdogTimer: TimerHandle | null = null;

  constructor(private readonly deps: DictationDeps) {}

  snapshot(): DictationSnapshot {
    return { phase: this.phase, detail: this.detail, startedAt: this.startedAt };
  }

  /** Hotkey, tray and dashboard entry point. */
  toggle(): void {
    if (this.phase === 'recording') {
      this.stopRecording();
      return;
    }
    if (this.processing || this.phase === 'transcribing' || this.phase === 'refining' || this.phase === 'pasting') {
      this.publish(this.phase, 'Still finishing the last dictation…');
      return;
    }
    this.startRecording();
  }

  cancel(): void {
    if (this.processing) {
      this.publish(this.phase, 'Too late to cancel. Finishing up…');
      return;
    }
    if (this.phase === 'recording' || this.phase === 'transcribing') {
      this.deps.pill.send({ type: 'cancel' });
      this.resetIdle();
    }
  }

  /** The recording pill confirmed that the microphone is live. */
  onRecordingStarted(): void {
    this.deps.log('Recording started');
  }

  /** The recording pill could not open the microphone (permission denied, device missing…). */
  onRecordingFailed(message: string): void {
    this.clearWatchdog();
    this.processing = false;
    this.fail(message || 'The microphone could not start.');
  }

  /** The recording pill finished capturing audio. Runs the full pipeline. */
  async onRecordingSubmitted(payload: RecordingPayload): Promise<void> {
    this.clearWatchdog();
    if (this.processing) return;
    if (this.phase !== 'recording' && this.phase !== 'transcribing') return;
    this.processing = true;
    try {
      await this.runPipeline(payload);
    } finally {
      this.processing = false;
    }
  }

  private startRecording(): void {
    this.clearIdleTimer();
    this.clearWatchdog();
    const apiKey = this.deps.getApiKey();
    if (!apiKey) {
      this.deps.pill.show();
      this.fail('Add your Gemini API key in Settings to start dictating.', true);
      return;
    }
    const settings = this.deps.getSettings();
    this.startedAt = this.deps.now();
    this.setPhase('recording', 'Listening');
    this.deps.pill.show();
    this.deps.pill.send({
      type: 'start',
      microphoneId: settings.microphoneId,
      maxSeconds: settings.maxRecordingSeconds,
      soundCues: settings.soundCues,
    });
  }

  private stopRecording(): void {
    this.setPhase('transcribing', 'Finishing');
    this.deps.pill.send({ type: 'stop' });
    this.clearWatchdog();
    this.watchdogTimer = this.deps.setTimer(() => {
      this.watchdogTimer = null;
      if (!this.processing && this.phase === 'transcribing') {
        this.deps.log('Recording did not submit audio in time');
        this.fail('Recording did not finish. Please try again.');
      }
    }, SUBMIT_WATCHDOG_MS);
  }

  private async runPipeline(payload: RecordingPayload): Promise<void> {
    const settings = this.deps.getSettings();
    const apiKey = this.deps.getApiKey();
    if (payload.durationMs < MIN_RECORDING_MS) {
      this.fail('Too short to transcribe. Hold on a moment longer.');
      return;
    }
    if (payload.peak < MIN_PEAK_LEVEL) {
      this.fail('No speech detected. Check that the right microphone is selected.');
      return;
    }
    if (!apiKey) {
      this.fail('Add your Gemini API key in Settings to start dictating.', true);
      return;
    }

    const style = settings.outputStyle;
    const vocabulary = settings.customVocabulary;
    try {
      this.setPhase('transcribing', 'Transcribing');
      const raw = (await this.deps.transcribe({
        wav: payload.wav,
        mode: style === 'verbatim' ? 'verbatim' : 'smart',
        vocabulary,
        languageCode: settings.languageCode,
        apiKey,
      })).trim();
      if (!raw) {
        this.fail('No speech detected. Try speaking a little louder.');
        return;
      }

      let text = raw;
      let degraded = false;
      let model = this.deps.transcriptionModel;
      if (style !== 'verbatim') {
        this.setPhase('refining', 'Polishing');
        const clean = this.deps.fallbackClean ?? defaultFallbackClean;
        try {
          const refined = sanitizeModelOutput(
            await this.deps.refine({
              text: raw,
              style,
              vocabulary,
              model: settings.refineModel,
              apiKey,
              onDelta: (full) => this.deps.pill.stream(full),
            }),
          );
          text = refined || clean(raw);
          model = settings.refineModel;
        } catch (error) {
          this.deps.log('Refinement failed; using offline cleanup', error);
          text = clean(raw);
          degraded = true;
        }
      }

      if (!text.trim()) {
        this.fail('Nothing to paste after cleanup.');
        return;
      }

      this.setPhase('pasting', 'Pasting');
      const outcome = await this.deps.paste(text, {
        autoPaste: settings.autoPaste,
        restoreClipboard: settings.restoreClipboard,
      });

      if (settings.saveHistory) {
        this.deps.saveHistory({
          text,
          raw,
          style,
          words: countWords(text),
          durationMs: payload.durationMs,
          model,
        });
      }

      const detail = degraded ? `${outcome.message} Offline cleanup used.` : outcome.message;
      this.setPhase('done', detail);
      this.scheduleIdle(degraded ? IDLE_AFTER_DEGRADED_MS : outcome.status === 'pasted' ? IDLE_AFTER_DONE_MS : IDLE_AFTER_ERROR_MS);
    } catch (error) {
      this.deps.log('Dictation failed', error);
      this.fail(friendlyError(error), error instanceof GeminiError && error.status === 403);
    }
  }

  private fail(message: string, openSettings = false): void {
    this.setPhase('error', message);
    this.deps.pill.show();
    if (openSettings) this.deps.openSettings();
    this.scheduleIdle(IDLE_AFTER_ERROR_MS);
  }

  private setPhase(phase: DictationPhase, detail: string): void {
    this.phase = phase;
    this.detail = detail;
    this.deps.emit(this.snapshot());
  }

  private publish(phase: DictationPhase, detail: string): void {
    this.detail = detail;
    this.deps.emit({ phase, detail, startedAt: this.startedAt });
  }

  private scheduleIdle(ms: number): void {
    this.clearIdleTimer();
    this.idleTimer = this.deps.setTimer(() => {
      this.idleTimer = null;
      if (this.phase !== 'recording' && !this.processing) this.resetIdle();
    }, ms);
  }

  private resetIdle(): void {
    this.clearIdleTimer();
    this.clearWatchdog();
    this.phase = 'idle';
    this.detail = '';
    this.startedAt = null;
    this.deps.emit(this.snapshot());
    this.deps.pill.hide();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      this.deps.clearTimer(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer !== null) {
      this.deps.clearTimer(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }
}
