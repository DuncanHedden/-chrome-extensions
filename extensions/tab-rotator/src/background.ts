import { MIN_IDLE_SEC } from './engine/defaults.ts';
import {
  clearLoadError,
  clearLog,
  effectiveSettings,
  recordLoadError,
  setPaused,
  start,
  stop,
  tick,
  toggle,
  writeLog,
} from './engine/runtime.ts';
import type { LogEntry } from './engine/types.ts';
import { getLicense } from '@ext/shared/license';
import { HEARTBEAT_ALARM, scheduleHeartbeat, sendHeartbeat, sendTest } from './alerts/send.ts';
import { applyConfigText, FLEET_ALARM, poll, scheduleFleetPoll } from './fleet/poll.ts';
import { activate, deactivate, revalidate } from './license-runtime.ts';
import { canUse } from './pro.ts';

const LICENSE_ALARM = 'license';
import { settingsStore, stateStore } from './engine/stores.ts';
import { isTimerAlarm, scheduleWake } from './engine/timer.ts';

const STARTUP_DELAY_MS = 5_000;

// Listeners are registered synchronously at top level: that's what lets Chrome wake this service
// worker for them after it has been shut down.

chrome.alarms.onAlarm.addListener((alarm) => {
  if (isTimerAlarm(alarm.name)) void tick();
  else if (alarm.name === FLEET_ALARM) void pollFleet();
  else if (alarm.name === LICENSE_ALARM) void revalidate().then(writeLog);
  else if (alarm.name === HEARTBEAT_ALARM) void heartbeatNow();
});

// --- Fleet config, alerts, license: background jobs that run whether or not we're rotating. ---

const fleetHooks = {
  activateLicense: async (key: string) => (await activate(key)).log,
  setRotation: async (running: boolean) => {
    const state = await stateStore.get();
    if (running && !state.running) await start();
    else if (!running && state.running) await stop();
  },
};

async function pollFleet(force = false) {
  // Raw settings: the config URL is set on the screen. Free screens only look for a license key in it.
  const [settings, license] = await Promise.all([settingsStore.get(), getLicense()]);
  await writeLog(await poll(settings, fleetHooks, force, !canUse(license, 'fleetConfig')));
}

async function heartbeatNow() {
  const settings = await effectiveSettings();
  await writeLog(await sendHeartbeat(settings));
  await scheduleHeartbeat(settings);
}

async function scheduleBackgroundJobs() {
  const [raw, effective] = await Promise.all([settingsStore.get(), effectiveSettings()]);
  await scheduleFleetPoll(raw);
  await scheduleHeartbeat(effective);
  // Re-validate paid keys twice a day; nothing to check for free or developer licenses.
  const license = await getLicense();
  if (license.source !== 'paid') await chrome.alarms.clear(LICENSE_ALARM);
  else if (!(await chrome.alarms.get(LICENSE_ALARM))) await chrome.alarms.create(LICENSE_ALARM, { periodInMinutes: 12 * 60, delayInMinutes: 1 });
}

chrome.runtime.onMessage.addListener((message: { target?: string; type?: string; entry?: LogEntry; text?: string; key?: string }, sender, sendResponse) => {
  if (message.target !== 'background') return;
  // From the options page, rotate the window it's open in.
  const windowId = sender.tab?.windowId;
  const handlers: Record<string, () => Promise<unknown>> = {
    wake: tick,
    start: () => start(windowId),
    stop,
    toggle: () => toggle(windowId),
    clearLog,
    log: () => writeLog(message.entry ? [{ ...message.entry, at: Date.now() }] : []),
    pollFleet: () => pollFleet(true),
    importConfig: async () => writeLog(await applyConfigText(message.text ?? '', 'imported file', fleetHooks, true)),
    testAlert: async () => {
      const failure = await sendTest(await effectiveSettings());
      if (failure) await writeLog([failure]);
      return failure?.message ?? null;
    },
    activateLicense: async () => {
      const { license, log } = await activate(message.key ?? '');
      await writeLog(log);
      return license.lastError ?? null;
    },
    deactivateLicense: async () => writeLog(await deactivate()),
  };
  const handler = handlers[message.type ?? ''];
  if (handler) {
    handler().then((result) => sendResponse({ ok: true, result }), (e) => sendResponse({ ok: false, error: String(e) }));
    return true; // keep the channel open for the async response
  }
});

// With the settings lock on, the toolbar and shortcut open the (PIN-protected) settings instead.
async function toggleUnlessLocked(windowId: number | undefined) {
  if ((await effectiveSettings()).lock.enabled) await chrome.runtime.openOptionsPage();
  else await toggle(windowId);
}
chrome.action.onClicked.addListener((tab) => void toggleUnlessLocked(tab.windowId));
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-rotation') void toggleUnlessLocked(tab?.windowId);
});

// Tab changes that matter to rotation. Title/favicon updates are ignored: dashboards change those constantly.
chrome.tabs.onRemoved.addListener(() => void tickIfRunning());
chrome.tabs.onCreated.addListener(() => void tickIfRunning());
chrome.tabs.onActivated.addListener(() => void tickIfRunning());
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.status || change.url || change.discarded !== undefined) void tickIfRunning();
});

chrome.webNavigation.onErrorOccurred.addListener((details) => {
  // ERR_ABORTED is a navigation superseded by another one (e.g. our own reload), not a failure.
  if (details.frameId === 0 && details.error !== 'net::ERR_ABORTED') void recordLoadError(details.tabId, details.error);
});
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0) void clearLoadErrorIfAny(details.tabId);
});

// Pause while someone is using the machine; resume once it has been idle for the configured time.
chrome.idle.onStateChanged.addListener(async (idleState) => {
  const settings = await settingsStore.get();
  if (!settings.pauseOnActivity) return;
  await setPaused(idleState === 'active');
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(changes.settings || changes.license)) return;
  void applyIdleInterval();
void scheduleBackgroundJobs();
  void scheduleBackgroundJobs();
  void tickIfRunning(); // playlist or durations edited while running
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await settingsStore.get();
  if (!settings.autoStart) {
    await stop();
    return;
  }
  // Give session restore a few seconds so playlist tabs are adopted instead of opened twice.
  // (Well within the 30 s a service worker stays alive while handling an event.)
  await new Promise((resolve) => setTimeout(resolve, STARTUP_DELAY_MS));
  await start();
});

chrome.runtime.onInstalled.addListener(() => void tick());

async function tickIfRunning() {
  if ((await stateStore.get()).running) await tick();
}

async function clearLoadErrorIfAny(tabId: number) {
  if ((await stateStore.get()).loadErrors[tabId]) await clearLoadError(tabId);
}

async function applyIdleInterval() {
  const { resumeAfterIdleSec } = await settingsStore.get();
  chrome.idle.setDetectionInterval(Math.max(MIN_IDLE_SEC, resumeAfterIdleSec));
}

void applyIdleInterval();
void scheduleBackgroundJobs();

// Playwright can't press browser-level shortcuts or click the toolbar, so e2e tests call these directly.
// The service worker's global scope is private to the extension.
Object.assign(globalThis, { tabRotator: { start, stop, toggle, tick, scheduleWake, pollFleet } });
