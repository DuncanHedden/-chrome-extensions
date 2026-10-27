import { INITIAL_STATE } from './defaults.ts';
import { reconcile, type Item } from './reconcile.ts';
import { appendLog, settingsStore, stateStore } from './stores.ts';
import { scheduleWake } from './timer.ts';
import type { Action, LogEntry, RotationState, World } from './types.ts';

// Every entry point goes through this queue, so an alarm, a tab event and a click arriving together
// can't interleave their read-reconcile-write cycles.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function snapshot(): Promise<World> {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  // `focused` is false for every window when another app is in front (common on macOS), so use the
  // last-focused browser window instead.
  const lastFocused = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => undefined);
  return {
    now: Date.now(),
    selfOrigin: chrome.runtime.getURL(''),
    windows: windows.map((w) => ({ id: w.id!, focused: w.id === lastFocused?.id })),
    tabs: windows.flatMap((w) =>
      (w.tabs ?? []).map((t) => ({
        id: t.id!,
        windowId: t.windowId,
        index: t.index,
        url: t.url ?? t.pendingUrl ?? '',
        status: t.status,
        active: t.active,
        discarded: t.discarded,
      })),
    ),
  };
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
        state.playlistTabs[action.entryId] = tab.id!;
        break;
      }
      case 'close':
        await chrome.tabs.remove(action.tabId);
        break;
    }
  } catch (error) {
    // Usually the tab vanished between snapshot and action; the next reconcile sees the new reality.
    log.push({ at: Date.now(), level: 'warn', code: 'action-failed', message: `${action.type} failed: ${String(error)}` });
  }
}

async function step(): Promise<{ state: RotationState; items: Item[] }> {
  const [state, settings, world] = await Promise.all([stateStore.get(), settingsStore.get(), snapshot()]);
  const result = reconcile(state, settings, world);
  for (const action of result.actions) await execute(action, result.state, result.log);
  await stateStore.set(result.state);
  await appendLog(result.log);
  await scheduleWake(result.wakeAt, result.state.running);
  await updateBadge(result.state);
  return { state: result.state, items: result.items };
}

export const tick = () => serialized(step);

/** Apply a change to stored state, then reconcile. */
export const mutate = (fn: (state: RotationState) => RotationState | void, log: LogEntry[] = []) =>
  serialized(async () => {
    const state = await stateStore.get();
    await stateStore.set(fn(state) ?? state);
    await appendLog(log);
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
  mutate(
    (s) => {
      if (!s.running || s.paused === paused) return;
      return { ...s, paused, restartSlot: !paused };
    },
    [paused ? entry('info', 'paused', 'Paused: someone is using this computer.') : entry('info', 'resumed', 'Resumed after inactivity.')],
  );

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
