import '../styles/fonts.css';
import '../styles/base.css';
import '../styles/dashboard.css';
import { formatAcceleratorLabel } from '../../shared/hotkey';
import { computeStats } from '../../shared/stats';
import type { AppInfo, DictationSnapshot, HistoryEntry, OutputStyle, SettingsView } from '../../shared/types';
import { bridge } from './bridge';
import { clampText, pluralize } from './format';
import { $, $$, formatNumber, formatWhen, h, svgFrom, toast } from './dom';
import { icons } from './icons';
import { daggerMarkup } from './logo';

const STYLE_LABELS: Record<OutputStyle, string> = {
  clean: 'Clean',
  formal: 'Formal',
  casual: 'Casual',
  email: 'Email',
  bullets: 'Bullets',
  verbatim: 'Verbatim',
};

const MODEL_LABELS: Record<string, string> = {
  'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite',
  'gemini-3.5-flash': 'Gemini 3.5 Flash',
  'gemini-3.8-flash': 'Gemini 3.8 Flash',
};

let settings: SettingsView | null = null;
let appInfo: AppInfo | null = null;
let history: HistoryEntry[] = [];
let dictation: DictationSnapshot = { phase: 'idle', detail: '', startedAt: null };
let view: 'overview' | 'history' = 'overview';

$('.brand-mark').append(svgFrom(daggerMarkup()));
$('[data-view="overview"] .nav-icon').append(svgFrom(icons.dashboard));
$('[data-view="history"] .nav-icon').append(svgFrom(icons.history));
$('#openSettings .nav-icon').append(svgFrom(icons.settings));
$('.search-icon').append(svgFrom(icons.search));

function renderSidebar(): void {
  if (!settings) return;
  const keyDot = $('#keyDot');
  const keyText = $('#keyText');
  if (settings.hasApiKey) {
    keyDot.className = 'status-dot is-ok';
    keyText.textContent = settings.apiKeyStorage === 'encrypted' ? 'Key stored encrypted' : 'Key connected';
  } else {
    keyDot.className = 'status-dot is-warn';
    keyText.textContent = 'No key yet. Open Settings.';
  }
  $('#engineModel').textContent = `Refine · ${MODEL_LABELS[settings.refineModel] ?? settings.refineModel}`;
}

function renderHotkey(): void {
  if (!settings || !appInfo) return;
  const label = formatAcceleratorLabel(settings.hotkey, appInfo.platform);
  const keys = $('#hotkeyKeys');
  keys.replaceChildren(
    ...label
      .split(/\s*\+\s*|\s+/)
      .filter(Boolean)
      .map((part) => h('span', { class: 'keycap' }, part)),
  );
}

function renderStart(): void {
  const button = $<HTMLButtonElement>('#startBtn');
  const recording = dictation.phase === 'recording';
  button.classList.toggle('is-recording', recording);
  $('#startLabel').textContent = recording ? 'Stop dictation' : 'Start dictation';
  button.disabled = ['transcribing', 'refining', 'pasting'].includes(dictation.phase);
}

function renderStats(): void {
  const stats = computeStats(history);
  const cards: { label: string; value: string; note: string }[] = [
    { label: 'Dictations', value: formatNumber(stats.totalDictations), note: stats.totalDictations ? 'Saved to your archive' : 'Waiting for your first word' },
    { label: 'Words', value: formatNumber(stats.totalWords), note: `${formatNumber(stats.totalMinutes)} min of speech` },
    { label: 'Words / min', value: formatNumber(stats.averageWordsPerMinute), note: 'Average speaking pace' },
    { label: 'Today', value: formatNumber(stats.todayDictations), note: 'Dictations since midnight' },
  ];
  $('#stats').replaceChildren(
    ...cards.map((card) =>
      h('div', { class: 'stat' },
        h('p', { class: 'label' }, card.label),
        h('p', { class: 'stat-value' }, card.value),
        h('p', { class: 'stat-note' }, card.note),
      ),
    ),
  );
}

function entryRow(entry: HistoryEntry, clamped: boolean): HTMLLIElement {
  return h('li', { class: 'entry' },
    h('div', { class: 'entry-meta' },
      h('span', { class: 'mono entry-time' }, formatWhen(entry.createdAt)),
      h('span', { class: 'chip' }, STYLE_LABELS[entry.style] ?? entry.style),
      h('span', { class: 'mono dim' }, pluralize(entry.words, 'word')),
    ),
    h('p', { class: `entry-text selectable${clamped ? ' is-clamped' : ''}` }, entry.text),
    h('div', { class: 'entry-actions' },
      h('button', { class: 'icon-btn', type: 'button', title: 'Copy text', 'aria-label': 'Copy text', onclick: () => void copyEntry(entry) }, svgFrom(icons.copy)),
      h('button', { class: 'icon-btn is-danger', type: 'button', title: 'Delete', 'aria-label': 'Delete dictation', onclick: () => void deleteEntry(entry.id) }, svgFrom(icons.trash)),
    ),
  );
}

function renderRecent(): void {
  const recent = history.slice(0, 5);
  $('#recentList').replaceChildren(...recent.map((entry) => entryRow(entry, true)));
  $('#recentEmpty').hidden = recent.length > 0;
}

function renderHistory(): void {
  const query = ($<HTMLInputElement>('#searchInput').value ?? '').trim().toLowerCase();
  const filtered = query
    ? history.filter((entry) => entry.text.toLowerCase().includes(query) || entry.raw.toLowerCase().includes(query))
    : history;
  $('#historyList').replaceChildren(...filtered.map((entry) => entryRow(entry, false)));
  $('#historyCount').textContent = String(history.length);
  const empty = $('#historyEmpty');
  empty.hidden = filtered.length > 0;
  empty.textContent = query
    ? `No dictations match “${clampText(query, 40)}”.`
    : 'Your archive is empty. Dictations you make appear here.';
}

async function copyEntry(entry: HistoryEntry): Promise<void> {
  await bridge.copyText(entry.text);
  toast('Copied to clipboard');
}

async function deleteEntry(id: string): Promise<void> {
  await bridge.deleteHistoryEntry(id);
  await reloadHistory();
}

async function reloadHistory(): Promise<void> {
  history = await bridge.listHistory();
  renderStats();
  renderRecent();
  renderHistory();
}

function setView(next: 'overview' | 'history'): void {
  view = next;
  for (const section of $$<HTMLElement>('.view')) {
    section.hidden = section.dataset.view !== next;
  }
  for (const item of $$<HTMLButtonElement>('.nav-item[data-view]')) {
    const active = item.dataset.view === next;
    item.classList.toggle('is-active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
}

function bind(): void {
  for (const item of $$<HTMLButtonElement>('.nav-item[data-view]')) {
    item.addEventListener('click', () => setView(item.dataset.view === 'history' ? 'history' : 'overview'));
  }
  for (const link of $$<HTMLButtonElement>('[data-view-link]')) {
    link.addEventListener('click', () => setView('history'));
  }
  $('#openSettings').addEventListener('click', () => void bridge.openWindow('settings'));
  $('#startBtn').addEventListener('click', () => void bridge.toggleDictation());
  $('#searchInput').addEventListener('input', renderHistory);
  $('#clearHistory').addEventListener('click', async () => {
    if (history.length === 0) return;
    if (!window.confirm('Delete every saved dictation? This cannot be undone.')) return;
    await bridge.clearHistory();
    await reloadHistory();
    toast('History cleared');
  });
  $('#checkUpdates').addEventListener('click', async () => {
    const info = await bridge.checkForUpdates();
    if (info.error) toast(info.error, 'warn');
    else if (!info.latestVersion) toast('No published release yet. You are on the latest local build.');
    else if (info.updateAvailable) {
      toast(`AuraFlow ${info.latestVersion} is available.`);
      window.open(info.releaseUrl, '_blank');
    } else toast("You're up to date.");
  });
}

async function boot(): Promise<void> {
  bind();
  const [info, current, entries, state] = await Promise.all([
    bridge.getAppInfo(),
    bridge.getSettings(),
    bridge.listHistory(),
    bridge.getDictation(),
  ]);
  appInfo = info;
  settings = current;
  history = entries;
  dictation = state;
  $('#versionText').textContent = `v${info.version}`;
  renderSidebar();
  renderHotkey();
  renderStart();
  renderStats();
  renderRecent();
  renderHistory();
  setView(view);

  bridge.onSettingsChanged((next) => {
    settings = next;
    renderSidebar();
    renderHotkey();
  });
  bridge.onHistoryChanged(() => void reloadHistory());
  bridge.onDictationState((next) => {
    dictation = next;
    renderStart();
  });
}

void boot();
