import '../styles/fonts.css';
import '../styles/base.css';
import '../styles/settings.css';
import { formatAcceleratorLabel, keyboardEventToAccelerator, DEFAULT_HOTKEY } from '../../shared/hotkey';
import { looksLikeApiKey } from '../../shared/gemini';
import { MAX_VOCABULARY_TERMS, normalizeVocabulary } from '../../shared/settings';
import type { AppInfo, MicrophoneStatus, OutputStyle, PermissionStatus, Settings, SettingsView } from '../../shared/types';
import { bridge } from './bridge';
import { $, $$, h, svgFrom, toast } from './dom';
import { icons } from './icons';
import { daggerMarkup } from './logo';
import { listMicrophones, describeMicError } from './recorder';
import { WaveformRenderer } from './waveform';

const STYLE_DESCRIPTIONS: Record<OutputStyle, string> = {
  clean: 'Fillers gone, grammar fixed, spoken commands applied. Sounds like you, polished.',
  formal: 'Professional register with complete sentences. Meaning and facts stay the same.',
  casual: 'Relaxed and conversational, with light punctuation.',
  email: 'Shaped as the body of an email, with paragraphs. Never invents greetings or names.',
  bullets: 'Lists you dictate become a clean bulleted list.',
  verbatim: 'Exactly what you said, filler words included. No AI rewrite.',
};

const MIC_LABELS: Record<MicrophoneStatus, string> = {
  granted: 'Granted',
  denied: 'Blocked',
  restricted: 'Restricted by policy',
  'not-determined': 'Not asked yet',
  unknown: 'Managed by the system',
};

let settings: SettingsView | null = null;
let appInfo: AppInfo | null = null;
let capturingHotkey = false;
let meterStream: MediaStream | null = null;
let meterContext: AudioContext | null = null;
let meterFrame = 0;
let meterWave: WaveformRenderer | null = null;
let vocabTimer: number | undefined;

$('.brand-mark').append(svgFrom(daggerMarkup()));
$('#toggleKey').append(svgFrom(icons.eye));
$('#hotkeyReset').setAttribute('title', `Reset to ${DEFAULT_HOTKEY}`);

function setSwitch(id: string, value: boolean): void {
  $(`#${id}`).setAttribute('aria-checked', String(value));
}

function applySettings(view: SettingsView): void {
  settings = view;
  $<HTMLSelectElement>('#refineModel').value = view.refineModel;
  $<HTMLSelectElement>('#outputStyle').value = view.outputStyle;
  $('#styleDesc').textContent = STYLE_DESCRIPTIONS[view.outputStyle];
  $<HTMLSelectElement>('#languageCode').value = view.languageCode;
  $<HTMLSelectElement>('#pillPlacement').value = view.pillPlacement;
  $<HTMLSelectElement>('#maxRecordingSeconds').value = String(view.maxRecordingSeconds);
  const vocab = $<HTMLTextAreaElement>('#vocabulary');
  if (document.activeElement !== vocab) vocab.value = view.customVocabulary.join('\n');
  updateVocabCount(view.customVocabulary.length);
  setSwitch('autoPaste', view.autoPaste);
  setSwitch('restoreClipboard', view.restoreClipboard);
  setSwitch('soundCues', view.soundCues);
  setSwitch('saveHistory', view.saveHistory);
  setSwitch('launchAtLogin', view.launchAtLogin);
  renderHotkey(view);
  renderKeyStatus(view);
  $('#welcome').hidden = view.onboardingDone && view.hasApiKey;
  for (const option of $$<HTMLOptionElement>('#microphone option')) {
    option.selected = option.value === view.microphoneId;
  }
}

function renderKeyStatus(view: SettingsView): void {
  const status = $('#keyStatus');
  if (!view.hasApiKey) {
    status.textContent = 'No key yet. Get a free one from Google AI Studio, then paste it above.';
    status.className = 'hint';
    return;
  }
  const storage = view.apiKeyStorage === 'encrypted'
    ? 'Encrypted with your OS keychain.'
    : view.apiKeyStorage === 'environment'
      ? 'Provided by the GEMINI_API_KEY environment variable.'
      : 'Stored with file permissions only (OS keychain unavailable).';
  status.textContent = `Key saved. ${storage}`;
  status.className = 'hint is-ok';
}

function renderHotkey(view: SettingsView): void {
  const platform = appInfo?.platform ?? 'win32';
  const label = formatAcceleratorLabel(view.hotkey, platform);
  const button = $('#hotkeyBtn');
  button.classList.toggle('is-capturing', capturingHotkey);
  button.replaceChildren(
    ...(capturingHotkey
      ? [h('span', {}, 'Press keys…')]
      : label.split(/\s*\+\s*|\s+/).filter(Boolean).map((part) => h('span', { class: 'keycap' }, part))),
  );
  const error = $('#hotkeyError');
  error.hidden = !view.hotkeyError;
  error.textContent = view.hotkeyError ?? '';
}

function updateVocabCount(count: number): void {
  const counter = $('#vocabCount');
  counter.textContent = `${count} / ${MAX_VOCABULARY_TERMS}`;
  counter.style.color = count > MAX_VOCABULARY_TERMS ? 'var(--danger-text)' : '';
}

async function patch(update: Partial<Settings>): Promise<SettingsView> {
  const next = await bridge.updateSettings(update);
  applySettings(next);
  return next;
}

// ---------------------------------------------------------------- API key

async function saveKey(): Promise<void> {
  const input = $<HTMLInputElement>('#apiKey');
  const value = input.value.trim();
  if (!looksLikeApiKey(value)) {
    toast("That doesn't look like a Gemini key. Copy the whole key from AI Studio.", 'warn');
    return;
  }
  const result = await bridge.saveApiKey(value);
  if (!result.ok) {
    toast(result.message, 'warn');
    return;
  }
  input.value = '';
  input.placeholder = 'Key saved · paste a new one to replace';
  toast(result.message);
  await testKey();
}

async function testKey(): Promise<void> {
  const status = $('#keyStatus');
  status.textContent = 'Testing connection…';
  status.className = 'hint';
  const result = await bridge.testApiKey();
  status.textContent = result.message;
  status.className = result.ok ? 'hint is-ok' : 'hint hint-error';
  if (result.ok) {
    toast('Gemini is connected.');
    applySettings(await bridge.getSettings());
  }
}

// ---------------------------------------------------------------- hotkey capture

function startCapture(): void {
  capturingHotkey = true;
  if (settings) renderHotkey(settings);
  $('#hotkeyHint').textContent = 'Press the new shortcut. Escape cancels.';
}

async function finishCapture(accelerator: string | null): Promise<void> {
  capturingHotkey = false;
  $('#hotkeyHint').textContent = 'Click the shortcut, then press the keys you want to use.';
  if (accelerator && settings && accelerator !== settings.hotkey) {
    const next = await bridge.updateSettings({ hotkey: accelerator });
    applySettings(next);
    if (!next.hotkeyError) toast(`Hotkey set to ${formatAcceleratorLabel(next.hotkey, appInfo?.platform ?? '')}.`);
  } else if (settings) {
    renderHotkey(settings);
  }
}

function onHotkeyKeydown(event: KeyboardEvent): void {
  if (!capturingHotkey) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.code === 'Escape') {
    void finishCapture(null);
    return;
  }
  const accelerator = keyboardEventToAccelerator(event, appInfo?.platform ?? 'win32');
  if (accelerator) void finishCapture(accelerator);
}

// ---------------------------------------------------------------- microphone

async function refreshMicrophones(): Promise<void> {
  const select = $<HTMLSelectElement>('#microphone');
  const devices = await listMicrophones().catch(() => [] as MediaDeviceInfo[]);
  const labelled = devices.some((device) => device.label);
  select.replaceChildren(
    h('option', { value: '' }, 'System default'),
    ...devices
      .filter((device) => device.deviceId)
      .map((device, index) => h('option', { value: device.deviceId }, device.label || `Microphone ${index + 1}`)),
  );
  if (settings) select.value = settings.microphoneId;
  $('#micStatus').textContent = labelled
    ? `${devices.length} input${devices.length === 1 ? '' : 's'} found.`
    : 'Allow microphone access to see device names.';
  $('#micActions').hidden = labelled;
}

async function allowMicrophone(): Promise<void> {
  const granted = await bridge.requestMicrophone();
  if (!granted) {
    toast('Microphone access is blocked. Open system settings to allow it.', 'warn');
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    toast(describeMicError(error), 'warn');
  }
  await refreshMicrophones();
}

function stopMeter(): void {
  cancelAnimationFrame(meterFrame);
  meterStream?.getTracks().forEach((track) => track.stop());
  meterStream = null;
  void meterContext?.close();
  meterContext = null;
  $('#testMic').textContent = 'Test mic';
}

async function toggleMeter(): Promise<void> {
  if (meterStream) {
    stopMeter();
    return;
  }
  const deviceId = $<HTMLSelectElement>('#microphone').value;
  try {
    meterStream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    });
  } catch (error) {
    toast(describeMicError(error), 'warn');
    return;
  }
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.65;
  context.createMediaStreamSource(meterStream).connect(analyser);
  meterContext = context;
  $('#testMic').textContent = 'Stop';
  await refreshMicrophones();

  const data = new Uint8Array(analyser.frequencyBinCount);
  const levels = new Float32Array(meterWave?.bars ?? 26);
  const tick = (now: number) => {
    analyser.getByteFrequencyData(data);
    const band = Math.max(1, Math.floor(data.length * 0.6));
    for (let i = 0; i < levels.length; i++) {
      const bin = Math.min(band - 1, Math.floor((i / levels.length) * band));
      levels[i] = Math.min(1, (data[bin] / 255) * 1.5);
    }
    meterWave?.draw(levels, 'live', now);
    meterFrame = requestAnimationFrame(tick);
  };
  meterFrame = requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- permissions

function renderPermissions(status: PermissionStatus): void {
  $('#permMic').textContent = `${MIC_LABELS[status.microphone]}. Needed to hear you.`;
  const accessRow = $('#accessRow');
  accessRow.hidden = status.accessibility === 'not-applicable';
  if (status.accessibility === 'granted') {
    $('#permAccess').textContent = 'Granted. AuraFlow can paste into the active app.';
  } else if (status.accessibility === 'missing') {
    $('#permAccess').textContent = 'Missing. Enable AuraFlow under Privacy & Security → Accessibility so auto-paste works.';
  }
}

// ---------------------------------------------------------------- wiring

function bindControls(): void {
  $('#openKeyPage').addEventListener('click', () => window.open('https://aistudio.google.com/app/apikey', '_blank'));
  $('#saveKey').addEventListener('click', () => void saveKey());
  $('#testKey').addEventListener('click', () => void testKey());
  $('#clearKey').addEventListener('click', async () => {
    if (!window.confirm('Remove the stored Gemini key from this device?')) return;
    const result = await bridge.clearApiKey();
    toast(result.message);
    applySettings(await bridge.getSettings());
  });
  $('#apiKey').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void saveKey();
  });
  $('#toggleKey').addEventListener('click', () => {
    const input = $<HTMLInputElement>('#apiKey');
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    $('#toggleKey').replaceChildren(svgFrom(reveal ? icons.eyeOff : icons.eye));
    $('#toggleKey').setAttribute('aria-label', reveal ? 'Hide key' : 'Show key');
  });

  $<HTMLSelectElement>('#refineModel').addEventListener('change', (event) => void patch({ refineModel: (event.target as HTMLSelectElement).value as Settings['refineModel'] }));
  $<HTMLSelectElement>('#outputStyle').addEventListener('change', (event) => void patch({ outputStyle: (event.target as HTMLSelectElement).value as OutputStyle }));
  $<HTMLSelectElement>('#languageCode').addEventListener('change', (event) => void patch({ languageCode: (event.target as HTMLSelectElement).value }));
  $<HTMLSelectElement>('#pillPlacement').addEventListener('change', (event) => void patch({ pillPlacement: (event.target as HTMLSelectElement).value as Settings['pillPlacement'] }));
  $<HTMLSelectElement>('#maxRecordingSeconds').addEventListener('change', (event) => void patch({ maxRecordingSeconds: Number((event.target as HTMLSelectElement).value) }));
  $<HTMLSelectElement>('#microphone').addEventListener('change', (event) => void patch({ microphoneId: (event.target as HTMLSelectElement).value }));

  const vocab = $<HTMLTextAreaElement>('#vocabulary');
  const saveVocab = () => {
    const terms = normalizeVocabulary(vocab.value);
    updateVocabCount(terms.length);
    void patch({ customVocabulary: terms });
  };
  vocab.addEventListener('input', () => {
    updateVocabCount(normalizeVocabulary(vocab.value).length);
    window.clearTimeout(vocabTimer);
    vocabTimer = window.setTimeout(saveVocab, 700);
  });
  vocab.addEventListener('blur', () => {
    window.clearTimeout(vocabTimer);
    saveVocab();
  });

  for (const id of ['autoPaste', 'restoreClipboard', 'soundCues', 'saveHistory', 'launchAtLogin'] as const) {
    $(`#${id}`).addEventListener('click', () => {
      const current = settings?.[id] ?? false;
      void patch({ [id]: !current } as Partial<Settings>);
    });
  }

  $('#hotkeyBtn').addEventListener('click', startCapture);
  $('#hotkeyReset').addEventListener('click', () => void patch({ hotkey: DEFAULT_HOTKEY }));
  window.addEventListener('keydown', onHotkeyKeydown, true);

  $('#allowMic').addEventListener('click', () => void allowMicrophone());
  $('#testMic').addEventListener('click', () => void toggleMeter());
  $('#openMicSettings').addEventListener('click', () => void bridge.openPermissionSettings('microphone'));
  $('#openAccessSettings').addEventListener('click', () => void bridge.openPermissionSettings('accessibility'));

  $('#checkUpdates').addEventListener('click', async () => {
    $('#updateStatus').textContent = 'Checking GitHub…';
    const info = await bridge.checkForUpdates();
    if (info.error) $('#updateStatus').textContent = info.error;
    else if (!info.latestVersion) $('#updateStatus').textContent = 'No published release yet.';
    else if (info.updateAvailable) {
      $('#updateStatus').textContent = `Version ${info.latestVersion} is available.`;
      window.open(info.releaseUrl, '_blank');
    } else $('#updateStatus').textContent = 'You are on the latest release.';
  });
  $('#openRepo').addEventListener('click', () => {
    window.open(appInfo?.repository ?? 'https://github.com/vamshicodingmt-gif/Auraflow', '_blank');
  });
  $('#quitApp').addEventListener('click', () => void bridge.quitApp());
}

async function boot(): Promise<void> {
  meterWave = new WaveformRenderer($<HTMLCanvasElement>('#meter'), 34);
  window.addEventListener('resize', () => meterWave?.resize());
  bindControls();

  const [info, current, permissions] = await Promise.all([bridge.getAppInfo(), bridge.getSettings(), bridge.getPermissions()]);
  appInfo = info;
  $('#aboutVersion').textContent = `v${info.version}`;
  applySettings(current);
  renderPermissions(permissions);
  await refreshMicrophones();

  bridge.onSettingsChanged((next) => {
    if (!capturingHotkey) applySettings(next);
  });
  navigator.mediaDevices?.addEventListener?.('devicechange', () => void refreshMicrophones());
  window.addEventListener('beforeunload', stopMeter);
}

void boot();
