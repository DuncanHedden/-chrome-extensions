import { createStore } from '@ext/shared/storage';
import { logStore } from '../engine/stores.ts';
import type { LogEntry, Settings } from '../engine/types.ts';
import { decideAlerts, heartbeat, INITIAL_ALERT_STATE, nextDailyAt, payload, type Alert } from './alerts.ts';

export const alertStateStore = createStore('local', 'alertState', INITIAL_ALERT_STATE);
export const HEARTBEAT_ALARM = 'heartbeat';
const TIMEOUT_MS = 10_000;

export function originPattern(url: string): string | null {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? `${u.origin}/*` : null;
  } catch {
    return null;
  }
}

/** POST one alert. Returns a log entry if it couldn't be delivered (never alerts about alerts). */
export async function deliver(alert: Alert, settings: Settings): Promise<LogEntry | null> {
  const { webhookUrl, format } = settings.alerts;
  const origin = originPattern(webhookUrl);
  const fail = (message: string): LogEntry => ({ at: Date.now(), level: 'warn', code: 'alert-failed', message });
  if (!origin) return fail('Alert not sent: the webhook URL is not a valid http(s) URL.');
  if (!(await chrome.permissions.contains({ origins: [origin] }))) {
    return fail(`Alert not sent: open Settings on this screen and grant access to ${new URL(webhookUrl).host}.`);
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(alert, format, chrome.runtime.getManifest().version)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (resp.ok) return null;
      if (resp.status < 500 && resp.status !== 429) return fail(`Alert rejected by webhook (HTTP ${resp.status}).`);
    } catch (error) {
      if (attempt === 2) return fail(`Alert not sent: ${error instanceof Error ? error.message : String(error)}.`);
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return fail('Alert not sent: webhook kept failing.');
}

/** Turn new log entries into alerts (rate-limited) and send them. Returns delivery-failure log entries. */
export async function alertOn(entries: readonly LogEntry[], settings: Settings): Promise<LogEntry[]> {
  if (!settings.alerts.webhookUrl || !entries.length) return [];
  const { state, alerts } = decideAlerts(await alertStateStore.get(), entries, settings.screenName, Date.now());
  await alertStateStore.replace(state);
  const failures = await Promise.all(alerts.map((a) => deliver(a, settings)));
  return failures.filter((f): f is LogEntry => f !== null);
}

export async function sendHeartbeat(settings: Settings): Promise<LogEntry[]> {
  if (!settings.alerts.webhookUrl || !settings.alerts.heartbeat) return [];
  const [state, { entries }] = await Promise.all([alertStateStore.get(), logStore.get()]);
  const failure = await deliver(heartbeat(entries, state, settings.screenName, Date.now()), settings);
  await alertStateStore.set({ lastHeartbeatAt: Date.now() });
  return failure ? [failure] : [];
}

export async function sendTest(settings: Settings): Promise<LogEntry | null> {
  return deliver({ kind: 'test', screen: settings.screenName, level: 'info', message: 'Alerts from this screen are working.', at: Date.now() }, settings);
}

/** (Re)schedule the daily heartbeat alarm, or clear it if heartbeats are off. */
export async function scheduleHeartbeat(settings: Settings) {
  if (!settings.alerts.webhookUrl || !settings.alerts.heartbeat) {
    await chrome.alarms.clear(HEARTBEAT_ALARM);
    return;
  }
  const when = nextDailyAt(Date.now(), settings.alerts.heartbeatTime, settings.schedule.timeZone);
  const existing = await chrome.alarms.get(HEARTBEAT_ALARM);
  if (existing?.scheduledTime !== when) await chrome.alarms.create(HEARTBEAT_ALARM, { when });
}
