import { describe, expect, it } from 'vitest';
import { DEDUPE_MS, decideAlerts, heartbeat, INITIAL_ALERT_STATE, MAX_PER_HOUR, nextDailyAt, payload, type Alert } from '../src/alerts/alerts.ts';
import { wallClock } from '../src/engine/schedule.ts';
import type { LogEntry } from '../src/engine/types.ts';

const MIN = 60_000;
const e = (level: LogEntry['level'], code: string, url = 'https://a.example/', at = 0): LogEntry => ({ at, level, code, message: `${code}!`, url });

describe('decideAlerts', () => {
  it('alerts on errors only, and on recovery of an alerted page', () => {
    const first = decideAlerts(INITIAL_ALERT_STATE, [e('info', 'reload'), e('warn', 'crashed'), e('error', 'still-failing')], 'Lobby', 0);
    expect(first.alerts.map((a) => a.kind)).toEqual(['incident']);
    const second = decideAlerts(first.state, [e('info', 'recovered'), e('info', 'recovered', 'https://other.example/')], 'Lobby', MIN);
    expect(second.alerts.map((a) => [a.kind, a.url])).toEqual([['recovered', 'https://a.example/']]);
    expect(second.state.open).toEqual({});
  });

  it('de-duplicates the same incident for 30 minutes', () => {
    let s = INITIAL_ALERT_STATE;
    const sent: Alert[] = [];
    for (const t of [0, 10 * MIN, DEDUPE_MS - 1, DEDUPE_MS]) {
      const r = decideAlerts(s, [e('error', 'still-failing')], 'Lobby', t);
      s = r.state;
      sent.push(...r.alerts);
    }
    expect(sent).toHaveLength(2);
  });

  it('caps at 10 per hour and reports how many were held back', () => {
    const pages = Array.from({ length: 14 }, (_, i) => e('error', 'detector', `https://p${i}.example/`));
    const burst = decideAlerts(INITIAL_ALERT_STATE, pages, 'Lobby', 0);
    expect(burst.alerts).toHaveLength(MAX_PER_HOUR);
    expect(burst.state.suppressed).toBe(4);
    const later = decideAlerts(burst.state, [e('error', 'config-rejected', '')], 'Lobby', 61 * MIN);
    expect(later.alerts[0]!.suppressed).toBe(4);
    expect(later.state.suppressed).toBe(0);
  });
});

describe('heartbeat', () => {
  it('summarises the last 24 h', () => {
    const now = 48 * 60 * MIN;
    const healthy = heartbeat([e('error', 'x', 'u', 0), e('warn', 'y', 'u', now - MIN)], INITIAL_ALERT_STATE, 'Lobby-2', now);
    expect(healthy).toMatchObject({ kind: 'heartbeat', level: 'info', message: 'Healthy: 0 incidents, 1 warning in the last 24 h.' });
    const bad = heartbeat([e('error', 'x', 'u', now - MIN)], { ...INITIAL_ALERT_STATE, open: { 'https://a.example/': 1 } }, 'Lobby-2', now);
    expect(bad.level).toBe('warn');
    expect(bad.message).toContain('still broken: https://a.example/');
  });
});

describe('nextDailyAt', () => {
  const NY = 'America/New_York';
  it('finds the next occurrence of a wall-clock time, today or tomorrow', () => {
    const now = Date.parse('2026-10-26T08:30:00-04:00');
    expect(nextDailyAt(now, '09:00', NY)).toBe(Date.parse('2026-10-26T09:00:00-04:00'));
    expect(nextDailyAt(now, '08:00', NY)).toBe(Date.parse('2026-10-27T08:00:00-04:00'));
    expect(nextDailyAt(Date.parse('2026-10-26T09:00:00-04:00'), '09:00', NY)).toBe(Date.parse('2026-10-27T09:00:00-04:00'));
  });

  it('lands on the right local time across DST changes', () => {
    const fallBack = nextDailyAt(Date.parse('2026-10-31T12:00:00-04:00'), '09:00', NY);
    expect(fallBack).toBe(Date.parse('2026-11-01T09:00:00-05:00'));
    const springForward = nextDailyAt(Date.parse('2026-03-07T12:00:00-05:00'), '09:00', NY);
    expect(springForward).toBe(Date.parse('2026-03-08T09:00:00-04:00'));
    expect(wallClock(springForward, NY).minutes).toBe(9 * 60);
  });
});

describe('payload', () => {
  const alert: Alert = { kind: 'incident', screen: 'NOC-Wall-1', level: 'error', message: 'Still failing after 5 attempts.', url: 'https://grafana.example/d/1', at: Date.UTC(2026, 9, 26, 12), suppressed: 2 };

  it('slack and discord: one readable line plus the link', () => {
    expect(payload(alert, 'slack', '1.0.0')).toEqual({
      text: '🔴 Problem on NOC-Wall-1: Still failing after 5 attempts. (+2 more alerts held back by rate limiting)\n<https://grafana.example/d/1>',
    });
    expect(payload(alert, 'discord', '1.0.0')).toMatchObject({ username: 'Tab Rotator', content: expect.stringContaining('NOC-Wall-1') });
  });

  it('teams: an Adaptive Card message', () => {
    const body = payload(alert, 'teams', '1.0.0') as { attachments: Array<{ contentType: string; content: { body: Array<{ text: string }> } }> };
    expect(body.attachments[0]!.contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(body.attachments[0]!.content.body.map((b) => b.text)).toContain('https://grafana.example/d/1');
  });

  it('json: structured fields for your own tooling', () => {
    expect(payload(alert, 'json', '1.0.0')).toEqual({
      source: 'tab-rotator', version: '1.0.0', event: 'incident', screen: 'NOC-Wall-1', level: 'error',
      message: 'Still failing after 5 attempts.', url: 'https://grafana.example/d/1', at: '2026-10-26T12:00:00.000Z', suppressed: 2,
    });
  });
});
