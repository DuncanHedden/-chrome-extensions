import { getLicense, isDevBuild, licenseStore, setDevPro } from '@ext/shared/license';
import { clampDuration, MIN_IDLE_SEC } from '../engine/defaults.ts';
import { formatDuration } from '../engine/reconcile.ts';
import { settingsStore, stateStore } from '../engine/stores.ts';
import type { Settings } from '../engine/types.ts';
import { formatPrice, PRICES } from '../pricing.ts';
import { canUse, gateSettings, type ProFeature } from '../pro.ts';
import type { Ctx } from './context.ts';
import { initAlerts } from './alerts-ui.ts';
import { initDetectors } from './detectors-ui.ts';
import { initFleet } from './fleet-ui.ts';
import { initLicense } from './license-ui.ts';
import { initHealthLog } from './health-log-ui.ts';
import { renderList } from './list-editor.ts';
import { initLock } from './lock-ui.ts';
import { initSchedule } from './schedule-ui.ts';
import { $, flashSaved, sendToBackground } from './ui.ts';

const field = (name: keyof Settings) => document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`);
const BOOLEANS = ['autoStart', 'pauseOnActivity', 'skipLoading', 'selfHeal'] as const;
const NUMBERS = {
  defaultDurationSec: clampDuration,
  resumeAfterIdleSec: (n: number) => Math.max(MIN_IDLE_SEC, Math.round(n) || MIN_IDLE_SEC),
  loadTimeoutSec: (n: number) => Math.min(600, Math.max(10, Math.round(n) || 60)),
} as const;

async function main() {
  const [settings, state, license] = await Promise.all([settingsStore.get(), stateStore.get(), getLicense()]);
  const ctx: Ctx = {
    settings,
    state,
    license,
    async save(patch) {
      ctx.settings = { ...ctx.settings, ...patch };
      await settingsStore.set(patch);
      flashSaved();
    },
  };

  // --- Status ---
  let windowLabel = '';
  async function refreshWindowLabel() {
    windowLabel = '';
    if (!ctx.state.running || ctx.state.windowId === null) return;
    const [here, tabs] = await Promise.all([chrome.windows.getCurrent(), chrome.tabs.query({ windowId: ctx.state.windowId })]);
    const rotated = tabs.filter((t) => !t.url?.startsWith(chrome.runtime.getURL('')));
    const n = `${rotated.length} tab${rotated.length === 1 ? '' : 's'}`;
    windowLabel = here.id === ctx.state.windowId
      ? `rotating ${n} in this window`
      : `rotating ${n} in another window (showing "${tabs.find((t) => t.active)?.title ?? '…'}")`;
  }
  function renderStatus() {
    const { running, paused, offHours, nextSwitchAt } = ctx.state;
    const kind = !running ? 'stopped' : paused ? 'paused' : 'running';
    $('.status').dataset.state = kind;
    $('#status-text').textContent = !running ? 'Stopped' : paused ? 'Paused' : offHours ? 'Off hours' : 'Rotating';
    $('#toggle').textContent = running ? 'Stop' : 'Start';
    let detail = '';
    if (running && paused) detail = 'Someone is using this computer. Resumes after the idle time below.';
    else if (running && nextSwitchAt) detail = `Next switch in ${formatDuration(Math.max(0, nextSwitchAt - Date.now()))}`;
    if (running && windowLabel) detail += ` · ${windowLabel}`;
    $('#status-detail').textContent = detail;
  }

  // --- Basic settings ---
  function renderBasics() {
    const s = ctx.settings;
    for (const radio of field('source')) radio.checked = radio.value === s.source;
    for (const name of BOOLEANS) field(name)[0]!.checked = s[name];
    for (const name of Object.keys(NUMBERS) as (keyof typeof NUMBERS)[]) field(name)[0]!.value = String(s[name]);
    const screenName = $<HTMLInputElement>('#screen-name');
    if (document.activeElement !== screenName) screenName.value = s.screenName;
    $('#playlist-section').hidden = s.source !== 'playlist';
    $('#rules-section').hidden = s.source !== 'window';
    renderList($('#playlist'), s.playlist, {
      urlField: 'url', urlLabel: 'URL', placeholder: 'https://grafana.example.com/d/abc', addLabel: 'Add URL',
      defaultDurationSec: () => ctx.settings.defaultDurationSec,
      onChange: (playlist) => ctx.save({ playlist }),
    });
    renderList($('#rules'), s.tabRules, {
      urlField: 'urlPrefix', urlLabel: 'URL starts with', placeholder: 'https://app.datadoghq.com/', addLabel: 'Add rule',
      defaultDurationSec: () => ctx.settings.defaultDurationSec,
      onChange: (tabRules) => ctx.save({ tabRules }),
    });
  }

  // --- Pro gating: greyed out and inert unless licensed ---
  function renderPro() {
    for (const section of document.querySelectorAll<HTMLElement>('section.pro')) {
      const allowed = canUse(ctx.license, section.dataset.feature as ProFeature);
      section.classList.toggle('locked', !allowed);
      const fieldset = section.querySelector('fieldset');
      if (fieldset) fieldset.disabled = !allowed;
      for (const el of section.querySelectorAll<HTMLElement>('.pro-only button, .pro-only input, .pro-only select')) {
        (el as HTMLInputElement).disabled = !allowed;
      }
    }
    const plan = $('#plan');
    plan.textContent = !ctx.license.pro ? 'Free' : ctx.license.source === 'dev' ? 'Pro (developer)' : 'Pro';
    plan.classList.toggle('pro', ctx.license.pro);
    $<HTMLInputElement>('#dev-pro-toggle').checked = ctx.license.pro && ctx.license.source === 'dev';
  }

  // The lock only applies while licensed; gateSettings decides, same as the engine.
  const lockCtx: Ctx = {
    get settings() { return gateSettings(ctx.settings, ctx.license); },
    get state() { return ctx.state; },
    get license() { return ctx.license; },
    save: (patch) => ctx.save(patch),
  };

  renderBasics();
  renderPro();
  const renderSchedule = initSchedule(ctx);
  const renderDetectors = initDetectors(ctx);
  const renderLog = initHealthLog(ctx);
  const renderLock = initLock(lockCtx, () => void refreshWindowLabel().then(renderStatus));
  const renderAlerts = initAlerts(ctx);
  const renderFleet = initFleet(ctx);
  const renderLicense = initLicense(ctx);
  const renderAll = () => {
    renderBasics();
    renderPro();
    renderSchedule();
    renderDetectors();
    renderLog();
    renderLock();
    renderAlerts();
    renderFleet();
    renderLicense();
  };
  renderSchedule();
  renderDetectors();
  renderAlerts();
  renderFleet();
  renderLicense();
  await refreshWindowLabel();
  renderStatus();

  // --- Wiring ---
  $('#toggle').addEventListener('click', () => void sendToBackground(ctx.state.running ? 'stop' : 'start'));
  $<HTMLInputElement>('#screen-name').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    input.value = input.value.trim().slice(0, 64);
    if (input.value && !input.checkValidity()) return input.reportValidity();
    void ctx.save({ screenName: input.value });
  });
  for (const radio of field('source')) {
    radio.addEventListener('change', () => void ctx.save({ source: radio.value as Settings['source'] }).then(renderBasics));
  }
  for (const name of BOOLEANS) {
    field(name)[0]!.addEventListener('change', (e) => void ctx.save({ [name]: (e.target as HTMLInputElement).checked }));
  }
  for (const [name, clamp] of Object.entries(NUMBERS) as [keyof typeof NUMBERS, (n: number) => number][]) {
    field(name)[0]!.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      const value = clamp(Number(input.value));
      input.value = String(value);
      void ctx.save({ [name]: value });
    });
  }
  $('#change-shortcut').addEventListener('click', () => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
  window.addEventListener('focus', () => void renderShortcut());

  $('#prices').textContent = `${formatPrice(PRICES.monthly)}/month · ${formatPrice(PRICES.yearly)}/year · ${formatPrice(PRICES.lifetime)} lifetime`;
  licenseStore.watch(() => renderLicense());
  if (isDevBuild()) {
    $('#dev-pro').hidden = false;
    $('#dev-pro-toggle').addEventListener('change', (e) => void setDevPro((e.target as HTMLInputElement).checked));
  }

  // --- Live updates from the service worker, other tabs, or (later) fleet config ---
  stateStore.watch((s) => {
    const windowChanged = s.windowId !== ctx.state.windowId || s.running !== ctx.state.running;
    ctx.state = s;
    if (windowChanged) void refreshWindowLabel().then(renderStatus);
    renderStatus();
  });
  settingsStore.watch((s) => {
    if (JSON.stringify(s) === JSON.stringify(ctx.settings)) return; // our own save
    ctx.settings = s;
    renderAll();
  });
  licenseStore.watch(async () => {
    ctx.license = await getLicense();
    renderAll();
  });
  setInterval(renderStatus, 1000);

  async function renderShortcut() {
    const commands = await chrome.commands.getAll();
    $('#shortcut').textContent = commands.find((c) => c.name === 'toggle-rotation')?.shortcut || 'not set';
  }
  await renderShortcut();
  $('#version').textContent = `Version ${chrome.runtime.getManifest().version}`;
}

void main();
