import { wallClock, parseTime } from '../engine/schedule.ts';
import type { AlertFormat, LogEntry } from '../engine/types.ts';

export type AlertKind = 'incident' | 'recovered' | 'heartbeat' | 'test';

export interface Alert {
  kind: AlertKind;
  screen: string;
  level: LogEntry['level'];
  message: string;
  url?: string;
  at: number;
  /** Alerts held back by the rate limiter since the last one sent. */
  suppressed?: number;
}

/** Codes that close an open incident for the same page. */
const RECOVERY_CODES = new Set(['recovered', 'detector-cleared']);

export interface AlertState {
  /** `${code}|${url}` -> last time that alert was sent, for de-duplication. */
  lastSent: Record<string, number>;
  /** Pages with an alerted, unresolved incident -> when it was alerted. */
  open: Record<string, number>;
  /** Start of the current rate-limit hour and alerts sent in it. */
  windowStart: number;
  sentInWindow: number;
  suppressed: number;
  lastHeartbeatAt: number;
}

export const INITIAL_ALERT_STATE: AlertState = { lastSent: {}, open: {}, windowStart: 0, sentInWindow: 0, suppressed: 0, lastHeartbeatAt: 0 };
export const DEDUPE_MS = 30 * 60_000;
export const MAX_PER_HOUR = 10;

/**
 * Pure: which new log entries become webhook alerts. Errors (problems the screen couldn't fix itself)
 * become incidents; a recovery for a page with an open incident becomes a "recovered" alert. The same
 * incident is sent at most every 30 min, and at most 10 alerts go out per hour; the rest are counted and
 * reported on the next one, so a flapping dashboard can't flood a channel.
 */
export function decideAlerts(prev: AlertState, entries: readonly LogEntry[], screen: string, now: number): { state: AlertState; alerts: Alert[] } {
  const state = structuredClone(prev);
  const alerts: Alert[] = [];
  if (now - state.windowStart >= 60 * 60_000) {
    state.windowStart = now;
    state.sentInWindow = 0;
  }
  const send = (alert: Alert) => {
    if (state.sentInWindow >= MAX_PER_HOUR) {
      state.suppressed++;
      return false;
    }
    state.sentInWindow++;
    alerts.push(state.suppressed ? { ...alert, suppressed: state.suppressed } : alert);
    state.suppressed = 0;
    return true;
  };

  for (const entry of entries) {
    const page = entry.url ?? '';
    if (entry.level === 'error') {
      const key = `${entry.code}|${page}`;
      if (now - (state.lastSent[key] ?? -Infinity) < DEDUPE_MS) continue;
      if (send({ kind: 'incident', screen, level: 'error', message: entry.message, url: entry.url, at: entry.at })) {
        state.lastSent[key] = now;
        state.open[page] = now;
      }
    } else if (RECOVERY_CODES.has(entry.code) && state.open[page] !== undefined) {
      delete state.open[page];
      send({ kind: 'recovered', screen, level: 'info', message: entry.message, url: entry.url, at: entry.at });
    }
  }
  // Forget de-duplication keys older than the window.
  for (const [key, at] of Object.entries(state.lastSent)) if (now - at >= DEDUPE_MS) delete state.lastSent[key];
  return { state, alerts };
}

/** Pure: the daily heartbeat summary from the last 24 h of the health log. */
export function heartbeat(entries: readonly LogEntry[], state: AlertState, screen: string, now: number): Alert {
  const day = entries.filter((e) => now - e.at < 24 * 60 * 60_000);
  const incidents = day.filter((e) => e.level === 'error').length;
  const warnings = day.filter((e) => e.level === 'warn').length;
  const unresolved = Object.keys(state.open);
  const healthy = incidents === 0 && unresolved.length === 0;
  const parts = [`${incidents} incident${incidents === 1 ? '' : 's'}`, `${warnings} warning${warnings === 1 ? '' : 's'}`];
  const message = healthy
    ? `Healthy: ${parts.join(', ')} in the last 24 h.`
    : `Needs attention: ${parts.join(', ')} in the last 24 h${unresolved.length ? `; still broken: ${unresolved.filter(Boolean).join(', ') || 'a page'}` : ''}.`;
  return { kind: 'heartbeat', screen, level: healthy ? 'info' : 'warn', message, at: now };
}

/** Next epoch ms at which the wall clock reads `hhmm` (in `timeZone`), strictly after `now`. DST-safe. */
export function nextDailyAt(now: number, hhmm: string, timeZone = ''): number {
  const target = parseTime(hhmm) ?? 9 * 60;
  const current = wallClock(now, timeZone).minutes;
  let ahead = (target - current + 1440) % 1440 || 1440;
  // Snap to the start of the minute, then correct for a DST jump between now and then.
  let candidate = Math.floor(now / 60_000) * 60_000 + ahead * 60_000;
  for (let i = 0; i < 2; i++) {
    const drift = target - wallClock(candidate, timeZone).minutes;
    if (drift === 0) break;
    ahead += drift;
    candidate += drift * 60_000;
  }
  return candidate <= now ? candidate + 1440 * 60_000 : candidate;
}

const ICON: Record<AlertKind, string> = { incident: '🔴', recovered: '✅', heartbeat: '💓', test: '🔔' };
const TITLE: Record<AlertKind, string> = { incident: 'Problem', recovered: 'Recovered', heartbeat: 'Daily check', test: 'Test alert' };

/** Pure: request body for each webhook flavour. */
export function payload(alert: Alert, format: AlertFormat, version: string): unknown {
  const screen = alert.screen || 'Unnamed screen';
  const extra = alert.suppressed ? ` (+${alert.suppressed} more alert${alert.suppressed === 1 ? '' : 's'} held back by rate limiting)` : '';
  const line = `${ICON[alert.kind]} ${TITLE[alert.kind]} on ${screen}: ${alert.message}${extra}`;
  switch (format) {
    case 'slack':
      return { text: alert.url ? `${line}\n<${alert.url}>` : line };
    case 'discord':
      return { username: 'Tab Rotator', content: alert.url ? `${line}\n<${alert.url}>` : line };
    case 'teams':
      // Works with Teams "Workflows" webhooks (and the older connectors) as an Adaptive Card.
      return {
        type: 'message',
        attachments: [{
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body: [
              { type: 'TextBlock', text: `${ICON[alert.kind]} ${TITLE[alert.kind]}: ${screen}`, weight: 'Bolder', wrap: true },
              { type: 'TextBlock', text: alert.message + extra, wrap: true },
              ...(alert.url ? [{ type: 'TextBlock', text: alert.url, isSubtle: true, wrap: true }] : []),
            ],
          },
        }],
      };
    case 'json':
      return {
        source: 'tab-rotator',
        version,
        event: alert.kind,
        screen: alert.screen,
        level: alert.level,
        message: alert.message,
        url: alert.url ?? null,
        at: new Date(alert.at).toISOString(),
        suppressed: alert.suppressed ?? 0,
      };
  }
}
