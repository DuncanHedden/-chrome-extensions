// Wakes the service worker at a given time. chrome.alarms can't fire sooner than 30 s ahead, so shorter
// waits go to a worker inside an offscreen document (a hidden extension page that outlives the service
// worker). A dedicated worker because timers in hidden pages get throttled to once a minute after 5 min.
const TICK_ALARM = 'tick';
const WATCHDOG_ALARM = 'watchdog';
const ALARM_MIN_MS = 30_000;
const OFFSCREEN_URL = 'offscreen/offscreen.html';

let creating: Promise<void> | null = null;

async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Runs a timer in a web worker to switch tabs on intervals shorter than chrome.alarms allows (30 s).',
    })
    .finally(() => (creating = null));
  await creating;
}

export async function scheduleWake(wakeAt: number | null, running: boolean) {
  if (!running) {
    // Only our own timers: fleet polling, heartbeats and license checks run whether or not we rotate.
    await Promise.all([chrome.alarms.clear(TICK_ALARM), chrome.alarms.clear(WATCHDOG_ALARM)]);
    if (await hasOffscreen()) await chrome.offscreen.closeDocument();
    return;
  }
  // Backstop: even if every other timer is lost, reconcile runs at least every 30 s while rotating.
  if (!(await chrome.alarms.get(WATCHDOG_ALARM))) {
    await chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 0.5 });
  }
  if (wakeAt === null) {
    await chrome.alarms.clear(TICK_ALARM);
    return;
  }
  if (wakeAt - Date.now() >= ALARM_MIN_MS) {
    await chrome.alarms.create(TICK_ALARM, { when: wakeAt });
  } else {
    await chrome.alarms.clear(TICK_ALARM);
    await ensureOffscreen();
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'schedule', at: wakeAt });
  }
}

export const isTimerAlarm = (name: string) => name === TICK_ALARM || name === WATCHDOG_ALARM;
