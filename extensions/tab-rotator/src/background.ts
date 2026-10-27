import { MIN_IDLE_SEC } from './engine/defaults.ts';
import { clearLoadError, recordLoadError, setPaused, start, stop, tick, toggle } from './engine/runtime.ts';
import { settingsStore, stateStore } from './engine/stores.ts';
import { isTimerAlarm, scheduleWake } from './engine/timer.ts';

const STARTUP_DELAY_MS = 5_000;

// Listeners are registered synchronously at top level: that's what lets Chrome wake this service
// worker for them after it has been shut down.

chrome.alarms.onAlarm.addListener((alarm) => {
  if (isTimerAlarm(alarm.name)) void tick();
});

chrome.runtime.onMessage.addListener((message: { target?: string; type?: string }, sender, sendResponse) => {
  if (message.target !== 'background') return;
  // From the options page, rotate the window it's open in.
  const windowId = sender.tab?.windowId;
  const handlers: Record<string, () => Promise<unknown>> = {
    wake: tick,
    start: () => start(windowId),
    stop,
    toggle: () => toggle(windowId),
  };
  const handler = handlers[message.type ?? ''];
  if (handler) {
    handler().then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e) }));
    return true; // keep the channel open for the async response
  }
});

chrome.action.onClicked.addListener((tab) => void toggle(tab.windowId));
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-rotation') void toggle(tab?.windowId);
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
  if (area !== 'local' || !changes.settings) return;
  void applyIdleInterval();
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

// Playwright can't press browser-level shortcuts or click the toolbar, so e2e tests call these directly.
// The service worker's global scope is private to the extension.
Object.assign(globalThis, { tabRotator: { start, stop, toggle, tick, scheduleWake } });
