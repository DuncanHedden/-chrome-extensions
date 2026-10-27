import { h } from '@ext/shared/dom';
import { clampDuration, MIN_IDLE_SEC } from '../engine/defaults.ts';
import { formatDuration } from '../engine/reconcile.ts';
import { logStore, settingsStore, stateStore } from '../engine/stores.ts';
import type { DisplaySettings, LogEntry, RotationState, Settings } from '../engine/types.ts';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const field = (name: keyof Settings) => document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`);

let settings: Settings;
let state: RotationState;

let savedTimer: ReturnType<typeof setTimeout> | undefined;
async function save(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  await settingsStore.set(patch);
  const el = $('#saved');
  el.textContent = 'Saved';
  el.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => el.classList.remove('show'), 1200);
}

const send = (type: 'start' | 'stop') => chrome.runtime.sendMessage({ target: 'background', type });

// --- Status ---

function renderStatus() {
  const panel = $('.status');
  const label = !state.running ? 'Stopped' : state.paused ? 'Paused' : 'Rotating';
  panel.dataset.state = !state.running ? 'stopped' : state.paused ? 'paused' : 'running';
  $('#status-text').textContent = label;
  $('#toggle').textContent = state.running ? 'Stop' : 'Start';
  let detail = '';
  if (state.running && state.paused) detail = 'Someone is using this computer. Resumes after the idle time below.';
  else if (state.running && state.nextSwitchAt) detail = `Next switch in ${formatDuration(Math.max(0, state.nextSwitchAt - Date.now()))}`;
  $('#status-detail').textContent = detail;
}

// --- Simple settings ---

const BOOLEANS = ['autoStart', 'pauseOnActivity', 'skipLoading', 'selfHeal'] as const;
const NUMBERS = { defaultDurationSec: clampDuration, resumeAfterIdleSec: (n: number) => Math.max(MIN_IDLE_SEC, Math.round(n) || MIN_IDLE_SEC), loadTimeoutSec: (n: number) => Math.min(600, Math.max(10, Math.round(n) || 60)) } as const;

function renderSettings() {
  for (const radio of field('source')) radio.checked = radio.value === settings.source;
  for (const name of BOOLEANS) field(name)[0]!.checked = settings[name];
  for (const name of Object.keys(NUMBERS) as (keyof typeof NUMBERS)[]) field(name)[0]!.value = String(settings[name]);
  $('#playlist-section').hidden = settings.source !== 'playlist';
  $('#rules-section').hidden = settings.source !== 'window';
  renderList('playlist');
  renderList('tabRules');
}

// --- Playlist and per-tab rules share one editable table ---

type ListName = 'playlist' | 'tabRules';
type Row = DisplaySettings & { id: string; url?: string; urlPrefix?: string };
const urlKey = (list: ListName) => (list === 'playlist' ? 'url' : 'urlPrefix');

function renderList(list: ListName) {
  const rows = settings[list] as Row[];
  const tbody = $(list === 'playlist' ? '#playlist' : '#rules');
  const update = (i: number, patch: Partial<Row>) => {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
    void save({ [list]: next });
  };
  const move = (i: number, by: number) => {
    const next = [...rows];
    const [row] = next.splice(i, 1);
    next.splice(i + by, 0, row!);
    void save({ [list]: next }).then(() => renderList(list));
  };
  tbody.replaceChildren(
    ...rows.map((row, i) =>
      h(
        'tr',
        {},
        h('td', {}, h('input', {
          type: list === 'playlist' ? 'url' : 'text',
          value: row[urlKey(list)] ?? '',
          placeholder: list === 'playlist' ? 'https://grafana.example.com/d/abc' : 'https://app.datadoghq.com/',
          'aria-label': 'URL',
          onchange: (e: Event) => update(i, { [urlKey(list)]: (e.target as HTMLInputElement).value.trim() }),
        })),
        h('td', {}, h('input', {
          type: 'number', min: '2', step: '1', value: row.durationSec === null ? '' : String(row.durationSec), placeholder: String(settings.defaultDurationSec), 'aria-label': 'Seconds',
          onchange: (e: Event) => {
            const raw = (e.target as HTMLInputElement).value;
            update(i, { durationSec: raw === '' ? null : clampDuration(Number(raw)) });
          },
        })),
        h('td', {}, h('input', {
          type: 'checkbox', checked: row.reloadBeforeShow, 'aria-label': 'Reload before showing',
          onchange: (e: Event) => update(i, { reloadBeforeShow: (e.target as HTMLInputElement).checked }),
        })),
        h('td', {},
          h('button', { class: 'icon', title: 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
          h('button', { class: 'icon', title: 'Move down', disabled: i === rows.length - 1, onclick: () => move(i, 1) }, '↓'),
          h('button', { class: 'icon', title: 'Remove', onclick: () => void save({ [list]: rows.filter((_, j) => j !== i) }).then(() => renderList(list)) }, '✕'),
        ),
      ),
    ),
  );
}

function addRow(list: ListName) {
  const row = { id: crypto.randomUUID(), [urlKey(list)]: '', durationSec: null, reloadBeforeShow: false };
  void save({ [list]: [...(settings[list] as Row[]), row] }).then(() => {
    renderList(list);
    $<HTMLInputElement>(`${list === 'playlist' ? '#playlist' : '#rules'} tr:last-child input`).focus();
  });
}

// --- Recent events ---

function renderLog(entries: LogEntry[]) {
  const recent = entries.slice(-50).reverse();
  $('#log').replaceChildren(
    ...recent.map((e) =>
      h('li', { class: e.level }, h('time', { datetime: new Date(e.at).toISOString() }, new Date(e.at).toLocaleString()), e.message, e.url ? ` — ${e.url}` : ''),
    ),
  );
  $('#log-empty').hidden = recent.length > 0;
}

async function renderShortcut() {
  const commands = await chrome.commands.getAll();
  $('#shortcut').textContent = commands.find((c) => c.name === 'toggle-rotation')?.shortcut || 'not set';
}

async function main() {
  [settings, state] = await Promise.all([settingsStore.get(), stateStore.get()]);
  renderSettings();
  renderStatus();
  renderLog((await logStore.get()).entries);
  await renderShortcut();

  $('#toggle').addEventListener('click', () => void send(state.running ? 'stop' : 'start'));
  for (const radio of field('source')) {
    radio.addEventListener('change', () => void save({ source: radio.value as Settings['source'] }).then(renderSettings));
  }
  for (const name of BOOLEANS) {
    field(name)[0]!.addEventListener('change', (e) => void save({ [name]: (e.target as HTMLInputElement).checked }));
  }
  for (const [name, clamp] of Object.entries(NUMBERS) as [keyof typeof NUMBERS, (n: number) => number][]) {
    field(name)[0]!.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      const value = clamp(Number(input.value));
      input.value = String(value);
      void save({ [name]: value });
    });
  }
  $('#add-entry').addEventListener('click', () => addRow('playlist'));
  $('#add-rule').addEventListener('click', () => addRow('tabRules'));
  $('#change-shortcut').addEventListener('click', () => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
  window.addEventListener('focus', () => void renderShortcut());

  stateStore.watch((s) => {
    state = s;
    renderStatus();
  });
  logStore.watch(({ entries }) => renderLog(entries));
  setInterval(renderStatus, 1000);
  $('#version').textContent = `Version ${chrome.runtime.getManifest().version}`;
}

void main();
