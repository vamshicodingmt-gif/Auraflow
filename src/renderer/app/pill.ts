import '../styles/fonts.css';
import '../styles/base.css';
import '../styles/pill.css';
import { captureToWav } from '../../shared/wav';
import type { DictationSnapshot, PillCommand } from '../../shared/types';
import { bridge } from './bridge';
import { $, formatClock, setDetail, svgFrom } from './dom';
import { icons } from './icons';
import { daggerMarkup } from './logo';
import { describeMicError, Recorder } from './recorder';
import { playCue } from './sound';
import { WaveformRenderer, type WaveMode } from './waveform';

type PillState = 'arming' | 'recording' | 'busy' | 'refining' | 'done' | 'error';

const pill = $<HTMLElement>('.pill');
const markEl = $<HTMLElement>('.pill-mark');
const labelEl = $<HTMLElement>('.pill-label');
const timeEl = $<HTMLElement>('.pill-time');
const detailEl = $<HTMLElement>('.pill-detail');
const centerEl = $<HTMLElement>('.pill-center');
const canvas = $<HTMLCanvasElement>('.pill-wave');
const cancelBtn = $<HTMLButtonElement>('.pill-cancel');

markEl.append(svgFrom(daggerMarkup()));
cancelBtn.append(svgFrom(icons.x));

const wave = new WaveformRenderer(canvas);
const levels = new Float32Array(wave.bars);

let recorder: Recorder | null = null;
let state: PillState = 'arming';
let startedAt = 0;
let maxSeconds = 120;
let cuesEnabled = true;
let armed = false;
let pendingStop = false;

function setState(next: PillState, label: string, detail = ''): void {
  state = next;
  pill.dataset.state = next;
  labelEl.textContent = label;
  detailEl.classList.toggle('is-stream', next === 'refining');
  setDetail(detailEl, detail);
  cancelBtn.hidden = !(next === 'arming' || next === 'recording');
}

async function startRecording(command: Extract<PillCommand, { type: 'start' }>): Promise<void> {
  recorder?.cancel();
  recorder = null;
  armed = true;
  pendingStop = false;
  maxSeconds = command.maxSeconds;
  cuesEnabled = command.soundCues;
  timeEl.textContent = '00:00';
  setState('arming', 'Preparing');

  try {
    if (cuesEnabled) await playCue('start');
    if (!armed) return;
    const next = new Recorder();
    next.onTrackEnded = () => void stopAndSubmit();
    await next.start(command.microphoneId);
    if (!armed) {
      next.cancel();
      return;
    }
    recorder = next;
    armed = false;
    startedAt = performance.now();
    setState('recording', 'Listening');
    if (pendingStop) {
      pendingStop = false;
      void stopAndSubmit();
      return;
    }
    await bridge.notifyRecordingStarted();
  } catch (error) {
    armed = false;
    recorder?.cancel();
    recorder = null;
    await bridge.notifyRecordingFailed(describeMicError(error));
  }
}

async function stopAndSubmit(): Promise<void> {
  if (!recorder) {
    if (armed) pendingStop = true;
    return;
  }
  const active = recorder;
  recorder = null;
  const capture = active.stop();
  if (cuesEnabled) void playCue('stop');
  setState('busy', 'Transcribing');
  const { wav, durationMs, peak } = captureToWav(capture.samples, capture.sampleRate);
  await bridge.submitRecording({ wav, durationMs, peak });
}

function cancelRecording(): void {
  armed = false;
  pendingStop = false;
  recorder?.cancel();
  recorder = null;
  setState('arming', 'Preparing');
}

function onDictationState(snapshot: DictationSnapshot): void {
  switch (snapshot.phase) {
    case 'transcribing':
      if (!recorder) setState('busy', 'Transcribing');
      break;
    case 'refining':
      setState('refining', 'Polishing');
      break;
    case 'pasting':
      setState('busy', 'Pasting');
      break;
    case 'done': {
      // The label already says "Pasted" or "Copied"; the detail carries only the extra context.
      const pasted = /^Pasted\b/.test(snapshot.detail);
      const extra = snapshot.detail.replace(/^(Pasted|Copied to clipboard|Copied\.?)\s*/, '').trim();
      setState('done', pasted ? 'Pasted' : 'Copied', extra);
      break;
    }
    case 'error':
      setState('error', 'Heads up', snapshot.detail);
      break;
    default:
      break;
  }
}

/** Shows the newest words that fit on one line; the caret always sits on the latest text. */
function onStream(text: string): void {
  if (state !== 'refining') return;
  const single = text.replace(/\s+/g, ' ').trim();
  const width = centerEl.clientWidth || 300;
  const charWidth = 7.4; // JetBrains Mono at 12.5px
  const capacity = Math.max(12, Math.floor(width / charWidth) - 1);
  const tail = single.length > capacity ? `…${single.slice(-(capacity - 1))}` : single;
  setDetail(detailEl, tail);
}

function frame(now: number): void {
  let mode: WaveMode = 'idle';
  if (recorder?.isActive) {
    recorder.readLevels(levels);
    mode = 'live';
    const elapsed = (now - startedAt) / 1000;
    timeEl.textContent = formatClock(elapsed);
    if (elapsed >= maxSeconds) void stopAndSubmit();
  } else if (state === 'busy') {
    mode = 'busy';
  }
  if (state !== 'refining' && state !== 'done' && state !== 'error') {
    wave.draw(levels, mode, now);
  }
  window.requestAnimationFrame(frame);
}

bridge.onPillCommand((command) => {
  switch (command.type) {
    case 'start':
      void startRecording(command);
      break;
    case 'stop':
      void stopAndSubmit();
      break;
    case 'cancel':
      cancelRecording();
      break;
  }
});
bridge.onDictationState(onDictationState);
bridge.onPillStream(onStream);
cancelBtn.addEventListener('click', () => {
  void bridge.cancelDictation();
});
window.addEventListener('resize', () => wave.resize());

setState('arming', 'Preparing');
window.requestAnimationFrame(frame);
