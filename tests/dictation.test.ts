import { describe, expect, it, vi } from 'vitest';
import { DictationController, type DictationDeps, MIN_RECORDING_MS } from '../src/main/dictation';
import { GeminiError } from '../src/shared/gemini';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import type { DictationSnapshot, PillCommand, Settings } from '../src/shared/types';

interface Timer {
  id: number;
  ms: number;
  callback: () => void;
}

function harness(settingsOverrides: Partial<Settings> = {}, depOverrides: Partial<DictationDeps> = {}) {
  let settings: Settings = { ...DEFAULT_SETTINGS, onboardingDone: true, ...settingsOverrides };
  let nextId = 1;
  const timers: Timer[] = [];
  const emitted: DictationSnapshot[] = [];
  const commands: PillCommand[] = [];
  const streamed: string[] = [];
  const pill = {
    show: vi.fn(),
    hide: vi.fn(),
    send: (command: PillCommand) => commands.push(command),
    stream: (text: string) => streamed.push(text),
  };
  const deps: DictationDeps = {
    getSettings: () => settings,
    getApiKey: () => 'AIzaSyTESTKEY1234567890abcdef',
    transcribe: vi.fn(async () => 'um hello world'),
    refine: vi.fn(async () => 'Hello world.'),
    paste: vi.fn(async () => ({ status: 'pasted' as const, message: 'Pasted' })),
    saveHistory: vi.fn(),
    pill,
    emit: (snapshot) => emitted.push(snapshot),
    openSettings: vi.fn(),
    log: vi.fn(),
    now: () => 1_000,
    setTimer: (callback, ms) => {
      const id = nextId++;
      timers.push({ id, ms, callback });
      return id;
    },
    clearTimer: (handle) => {
      const index = timers.findIndex((t) => t.id === handle);
      if (index >= 0) timers.splice(index, 1);
    },
    transcriptionModel: 'gemini-3.5-transcribe',
    ...depOverrides,
  };
  const controller = new DictationController(deps);
  const fireTimer = (ms: number) => {
    const timer = timers.find((t) => t.ms === ms);
    if (!timer) throw new Error(`no timer with ${ms}ms; have ${timers.map((t) => t.ms).join(',')}`);
    timers.splice(timers.indexOf(timer), 1);
    timer.callback();
  };
  const setSettings = (next: Partial<Settings>) => {
    settings = { ...settings, ...next };
  };
  return { controller, deps, pill, emitted, commands, streamed, timers, fireTimer, setSettings };
}

const audio = (overrides: Partial<{ durationMs: number; peak: number }> = {}) => ({
  wav: new Uint8Array([1, 2, 3, 4]),
  durationMs: 2_000,
  peak: 0.4,
  ...overrides,
});

describe('DictationController', () => {
  it('asks for an API key before recording and opens settings', () => {
    const h = harness({}, { getApiKey: () => undefined });
    h.controller.toggle();
    expect(h.controller.snapshot().phase).toBe('error');
    expect(h.deps.openSettings).toHaveBeenCalled();
    expect(h.commands).toHaveLength(0);
  });

  it('starts and stops recording with the pill and reports transitions', () => {
    const h = harness({ maxRecordingSeconds: 60, soundCues: false, microphoneId: 'mic-1' });
    h.controller.toggle();
    expect(h.controller.snapshot().phase).toBe('recording');
    expect(h.commands[0]).toEqual({ type: 'start', microphoneId: 'mic-1', maxSeconds: 60, soundCues: false });
    expect(h.pill.show).toHaveBeenCalled();

    h.controller.toggle();
    expect(h.commands.at(-1)).toEqual({ type: 'stop' });
    expect(h.controller.snapshot().phase).toBe('transcribing');
  });

  it('runs transcription, refinement, paste and history for a normal dictation', async () => {
    const h = harness();
    h.controller.toggle();
    h.controller.toggle();
    await h.controller.onRecordingSubmitted(audio());

    expect(h.deps.transcribe).toHaveBeenCalledWith(expect.objectContaining({ mode: 'smart', apiKey: expect.any(String) }));
    expect(h.deps.refine).toHaveBeenCalledWith(expect.objectContaining({ text: 'um hello world', style: 'clean', model: DEFAULT_SETTINGS.refineModel }));
    expect(h.deps.paste).toHaveBeenCalledWith('Hello world.', { autoPaste: true, restoreClipboard: true });
    expect(h.deps.saveHistory).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hello world.', raw: 'um hello world', words: 2 }));
    expect(h.controller.snapshot().phase).toBe('done');

    h.fireTimer(1000);
    expect(h.controller.snapshot().phase).toBe('idle');
    expect(h.pill.hide).toHaveBeenCalled();
  });

  it('skips refinement for verbatim output and records the transcription model', async () => {
    const h = harness({ outputStyle: 'verbatim' });
    h.controller.toggle();
    h.controller.toggle();
    await h.controller.onRecordingSubmitted(audio());
    expect(h.deps.transcribe).toHaveBeenCalledWith(expect.objectContaining({ mode: 'verbatim' }));
    expect(h.deps.refine).not.toHaveBeenCalled();
    expect(h.deps.saveHistory).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-3.5-transcribe', text: 'um hello world' }));
  });

  it('falls back to offline cleanup when refinement fails and says so', async () => {
    const h = harness({}, {
      refine: vi.fn(async () => {
        throw new GeminiError('Could not reach Gemini.', { retryable: true });
      }),
    });
    h.controller.toggle();
    h.controller.toggle();
    await h.controller.onRecordingSubmitted(audio());
    expect(h.deps.paste).toHaveBeenCalledWith('Hello world', expect.anything());
    expect(h.controller.snapshot().detail).toContain('Offline cleanup used.');
    h.fireTimer(2600);
    expect(h.controller.snapshot().phase).toBe('idle');
  });

  it('rejects silent or too-short recordings without calling the API', async () => {
    const h = harness();
    h.controller.toggle();
    h.controller.toggle();
    await h.controller.onRecordingSubmitted(audio({ peak: 0.001 }));
    expect(h.deps.transcribe).not.toHaveBeenCalled();
    expect(h.controller.snapshot().detail).toMatch(/No speech detected/);

    h.fireTimer(4200);
    h.controller.toggle();
    h.controller.toggle();
    await h.controller.onRecordingSubmitted(audio({ durationMs: MIN_RECORDING_MS - 1 }));
    expect(h.deps.transcribe).not.toHaveBeenCalled();
    expect(h.controller.snapshot().detail).toMatch(/Too short/);
  });

  it('shows the API error message and opens settings for a rejected key', async () => {
    const h = harness({}, {
      transcribe: vi.fn(async () => {
        throw new GeminiError('Gemini rejected your API key. Check it in Settings.', { status: 403 });
      }),
    });
    h.controller.toggle();
    h.controller.toggle();
    await h.controller.onRecordingSubmitted(audio());
    expect(h.controller.snapshot()).toMatchObject({ phase: 'error', detail: 'Gemini rejected your API key. Check it in Settings.' });
    expect(h.deps.openSettings).toHaveBeenCalled();
    expect(h.deps.saveHistory).not.toHaveBeenCalled();
  });

  it('keeps the transcript on the clipboard and uses a longer notice when auto-paste fails', async () => {
    const h = harness({}, {
      paste: vi.fn(async () => ({ status: 'copied' as const, message: 'Copied. Press paste to insert it.' })),
    });
    h.controller.toggle();
    h.controller.toggle();
    await h.controller.onRecordingSubmitted(audio());
    expect(h.controller.snapshot()).toMatchObject({ phase: 'done', detail: 'Copied. Press paste to insert it.' });
    h.fireTimer(4200);
    expect(h.controller.snapshot().phase).toBe('idle');
  });

  it('does not save history when the user turned it off', async () => {
    const h = harness({ saveHistory: false });
    h.controller.toggle();
    h.controller.toggle();
    await h.controller.onRecordingSubmitted(audio());
    expect(h.deps.saveHistory).not.toHaveBeenCalled();
  });

  it('streams refinement partials to the pill', async () => {
    const h = harness({}, {
      refine: vi.fn(async (request) => {
        request.onDelta('Hel');
        request.onDelta('Hello');
        return 'Hello';
      }),
    });
    h.controller.toggle();
    h.controller.toggle();
    await h.controller.onRecordingSubmitted(audio());
    expect(h.streamed).toEqual(['Hel', 'Hello']);
  });

  it('cancels a live recording and returns to idle', () => {
    const h = harness();
    h.controller.toggle();
    h.controller.cancel();
    expect(h.commands.at(-1)).toEqual({ type: 'cancel' });
    expect(h.controller.snapshot().phase).toBe('idle');
  });

  it('reports a stuck recording via the watchdog', () => {
    const h = harness();
    h.controller.toggle();
    h.controller.toggle();
    h.fireTimer(6000);
    expect(h.controller.snapshot()).toMatchObject({ phase: 'error', detail: 'Recording did not finish. Please try again.' });
  });

  it('ignores hotkey presses while the previous dictation is still processing', async () => {
    let release: (value: string) => void = () => undefined;
    const h = harness({}, {
      transcribe: vi.fn(() => new Promise<string>((resolve) => { release = resolve; })),
    });
    h.controller.toggle();
    h.controller.toggle();
    const pipeline = h.controller.onRecordingSubmitted(audio());
    h.controller.toggle();
    expect(h.commands.filter((c) => c.type === 'start')).toHaveLength(1);
    expect(h.controller.snapshot().detail).toMatch(/Still finishing/);
    release('done');
    await pipeline;
  });

  it('handles a recording failure reported by the pill', () => {
    const h = harness();
    h.controller.toggle();
    h.controller.onRecordingFailed('Microphone access is blocked.');
    expect(h.controller.snapshot()).toMatchObject({ phase: 'error', detail: 'Microphone access is blocked.' });
  });
});
