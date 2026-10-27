import { getLicense } from '@ext/shared/license';
import { alertOn } from '../alerts/send.ts';
import { gateSettings } from '../pro.ts';
import { INITIAL_STATE } from './defaults.ts';
import { reconcile, type Item } from './reconcile.ts';
import { appendLog, logStore, settingsStore, stateStore } from './stores.ts';
import { scheduleWake } from './timer.ts';
import type { Action, LogEntry, RotationState, Settings, TabSnapshot, World } from './types.ts';

// Every entry point goes through this queue, so an alarm, a tab event and a click arriving together
// can't interleave their read-reconcile-write cycles.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/** Settings as the engine should see them: Pro features switched off unless licensed. */
export async function effectiveSettings(): Promise<Settings> {
  const [settings, license] = await Promise.all([settingsStore.get(), getLicense()]);
  return gateSettings(settings, license);
}

async function snapshot(settings: Settings): Promise<World> {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  // `focused` is false for every window when another app is in front (common on macOS), so use the
  // last-focused browser window instead.
  const lastFocused = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => undefined);
  const tabs: TabSnapshot[] = windows.flatMap((w) =>
    (w.tabs ?? []).map((t) => ({
      id: t.id!,
      windowId: t.windowId,
      index: t.index,
      url: t.url ?? t.pendingUrl ?? '',
      status: t.status,
      active: t.active,
      discarded: t.discarded,
      title: t.title ?? '',
      favIconUrl: t.favIconUrl ?? '',
    })),
  );
  return {
    now: Date.now(),
    selfOrigin: chrome.runtime.getURL(''),
    windows: windows.map((w) => ({ id: w.id!, focused: w.id === lastFocused?.id })),
    tabs,
    contentHashes: await contentHashes(settings, tabs),
  };
}

// Page-text hashes for "unchanged" detectors with content checks. Only for sites the user granted
// (optional host permission + scripting), and at most once a minute per tab. A lost cache just means
// a re-read.
const CONTENT_CHECK_INTERVAL_MS = 60_000;
const contentCache = new Map<number, { hash: string; at: number }>();

async function contentHashes(settings: Settings, tabs: TabSnapshot[]): Promise<Record<number, string>> {
  const detectors = settings.detectors.filter((d) => d.enabled && d.kind === 'unchanged' && d.checkContent);
  const result: Record<number, string> = {};
  if (!detectors.length) return result;
  for (const tab of tabs) {
    if (tab.status !== 'complete' || !/^https?:/.test(tab.url)) continue;
    if (!detectors.some((d) => !d.appliesTo || tab.url.startsWith(d.appliesTo))) continue;
    const cached = contentCache.get(tab.id);
    if (cached && Date.now() - cached.at < CONTENT_CHECK_INTERVAL_MS) {
      result[tab.id] = cached.hash;
      continue;
    }
    const origin = `${new URL(tab.url).origin}/*`;
    if (!(await chrome.permissions.contains({ permissions: ['scripting'], origins: [origin] }))) continue;
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        // Sampled rolling hash of the visible text: cheap on huge pages, changes when the numbers do.
        func: () => {
          const text = document.body?.innerText ?? '';
          const step = Math.max(1, Math.floor(text.length / 4096));
          let h = 0;
          for (let i = 0; i < text.length; i += step) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
          return `${text.length}:${h}`;
        },
      });
      const hash = String(injection?.result ?? '');
      contentCache.set(tab.id, { hash, at: Date.now() });
      result[tab.id] = hash;
    } catch {
      // Error page or a page we may not script: the title/URL fingerprint still applies.
    }
  }
  return result;
}

async function execute(action: Action, state: RotationState, log: LogEntry[]) {
  try {
    switch (action.type) {
      case 'activate':
        await chrome.tabs.update(action.tabId, { active: true });
        break;
      case 'reload':
        await chrome.tabs.reload(action.tabId);
        break;
      case 'create': {
        const tab = await chrome.tabs.create({ windowId: action.windowId, url: action.url, active: false });
        (action.list === 'offHours' ? state.offHoursTabs : state.playlistTabs)[action.entryId] = tab.id!;
        break;
      }
      case 'close':
        await chrome.tabs.remove(action.tabId);
        break;
      case 'navigate':
        await chrome.tabs.update(action.tabId, { url: action.url });
        break;
    }
  } catch (error) {
    // Usually the tab vanished between snapshot and action; the next reconcile sees the new reality.
    log.push({ at: Date.now(), level: 'warn', code: 'action-failed', message: `${action.type} failed: ${String(error)}` });
  }
}

/** Append to the health log and send any alerts those entries call for (Pro, webhook configured). */
async function record(entries: LogEntry[]) {
  if (!entries.length) return;
  await appendLog(entries);
  await appendLog(await alertOn(entries, await effectiveSettings()));
}

async function step(): Promise<{ state: RotationState; items: Item[] }> {
  const [state, settings] = await Promise.all([stateStore.get(), effectiveSettings()]);
  const world = await snapshot(settings);
  const result = reconcile(state, settings, world);
  for (const action of result.actions) await execute(action, result.state, result.log);
  await stateStore.set(result.state);
  await record(result.log);
  await scheduleWake(result.wakeAt, result.state.running);
  await updateBadge(result.state);
  return { state: result.state, items: result.items };
}

export const tick = () => serialized(step);

/** Health-log writes from other contexts go through the same queue as the engine's own. */
export const writeLog = (entries: LogEntry[]) => serialized(() => record(entries));
export const clearLog = () => serialized(() => logStore.set({ entries: [] }));

/** Apply a change to stored state, then reconcile. */
export const mutate = (fn: (state: RotationState) => RotationState | void, log: LogEntry[] = []) =>
  serialized(async () => {
    const state = await stateStore.get();
    await stateStore.set(fn(state) ?? state);
    await record(log);
    return step();
  });

const entry = (level: LogEntry['level'], code: string, message: string): LogEntry => ({ at: Date.now(), level, code, message });

/** Start rotating `windowId` (the window the user clicked in), or the last-focused window. */
export const start = (windowId?: number) =>
  mutate(() => ({ ...structuredClone(INITIAL_STATE), running: true, windowId: windowId ?? null }));

export const stop = () =>
  mutate((s) => ({ ...s, running: false, paused: false, currentKey: null }), [entry('info', 'stopped', 'Rotation stopped.')]);

export const toggle = async (windowId?: number) => ((await stateStore.get()).running ? stop() : start(windowId));

export const setPaused = (paused: boolean) =>
  serialized(async () => {
    const state = await stateStore.get();
    // Idle events arrive whether or not we're rotating; only a real change is applied and logged.
    if (!state.running || state.paused === paused) return;
    await stateStore.set({ ...state, paused, restartSlot: !paused });
    await record([paused ? entry('info', 'paused', 'Paused: someone is using this computer.') : entry('info', 'resumed', 'Resumed after inactivity.')]);
    await step();
  });

/** webNavigation results are facts about tabs; store them for reconcile to act on. */
export const recordLoadError = (tabId: number, error: string) =>
  mutate((s) => {
    s.loadErrors[tabId] = { error, at: Date.now() };
  });

export const clearLoadError = (tabId: number) =>
  mutate((s) => {
    delete s.loadErrors[tabId];
  });

async function updateBadge(state: RotationState) {
  const [text, color, title] = !state.running
    ? ['', '#5f6368', 'Tab Rotator: stopped (click to start)']
    : state.paused
      ? ['II', '#e37400', 'Tab Rotator: paused while someone uses this computer (click to stop)']
      : ['ON', '#188038', 'Tab Rotator: rotating (click to stop)'];
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setTitle({ title });
}
