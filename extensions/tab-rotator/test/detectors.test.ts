import { describe, expect, it } from 'vitest';
import { compileMatcher, DETECTOR_PRESETS, fingerprint, matchingDetector } from '../src/engine/detectors.ts';
import type { Detector, TabSnapshot } from '../src/engine/types.ts';

const tab = (patch: Partial<TabSnapshot> = {}): TabSnapshot => ({
  id: 1, windowId: 1, index: 0, url: 'https://grafana.example/d/abc', status: 'complete', active: true, discarded: false,
  title: 'Ops overview - Grafana', favIconUrl: 'https://grafana.example/favicon.ico', ...patch,
});
const detector = (patch: Partial<Detector>): Detector => ({
  id: 'd', name: 'd', enabled: true, kind: 'title', pattern: '', minutes: 30, checkContent: false, appliesTo: '', action: 'reload', ...patch,
});
const MIN = 60_000;

describe('compileMatcher', () => {
  it('plain text is a case-insensitive substring', () => {
    const m = compileMatcher('Session Expired');
    expect(m.ok && m.test('Your session expired, please sign in')).toBe(true);
  });

  it('/regex/flags is a regular expression', () => {
    const m = compileMatcher('/\\b50[234]\\b/');
    expect(m.ok && m.test('502 Bad Gateway')).toBe(true);
    expect(m.ok && m.test('Order 5021')).toBe(false);
  });

  it('ignores g/y flags (stateful lastIndex would make repeated tests flaky)', () => {
    const m = compileMatcher('/a/g');
    expect(m.ok && [m.test('a'), m.test('a'), m.test('a')]).toEqual([true, true, true]);
  });

  it('reports invalid patterns instead of throwing', () => {
    expect(compileMatcher('/(/')).toMatchObject({ ok: false });
    expect(compileMatcher('   ')).toMatchObject({ ok: false });
  });
});

describe('matchingDetector', () => {
  it('matches URL and title patterns, first enabled match wins', () => {
    const login = detector({ id: 'login', kind: 'url', pattern: '/login' });
    const expired = detector({ id: 'expired', kind: 'title', pattern: 'expired' });
    expect(matchingDetector([login, expired], tab({ url: 'https://sso.example/login?next=x' }), 0, 0)?.id).toBe('login');
    expect(matchingDetector([login, expired], tab({ title: 'Session expired' }), 0, 0)?.id).toBe('expired');
    expect(matchingDetector([{ ...login, enabled: false }, expired], tab({ url: 'https://x/login', title: 'ok' }), 0, 0)).toBeNull();
  });

  it('does not judge URL/title while the page is still loading', () => {
    const d = detector({ kind: 'title', pattern: 'loading' });
    expect(matchingDetector([d], tab({ status: 'loading', title: 'loading…' }), 0, 0)).toBeNull();
  });

  it('respects appliesTo', () => {
    const d = detector({ kind: 'title', pattern: 'error', appliesTo: 'https://jira.example/' });
    expect(matchingDetector([d], tab({ title: 'Error' }), 0, 0)).toBeNull();
    expect(matchingDetector([d], tab({ url: 'https://jira.example/board', title: 'Error' }), 0, 0)).not.toBeNull();
  });

  it('unchanged fires once the fingerprint has been stable for N minutes', () => {
    const d = detector({ kind: 'unchanged', minutes: 30 });
    expect(matchingDetector([d], tab(), 0, 29 * MIN)).toBeNull();
    expect(matchingDetector([d], tab(), 0, 30 * MIN)?.id).toBe('d');
  });

  it('fingerprint changes with URL, title, favicon or content hash', () => {
    const base = fingerprint(tab(), 'h1');
    expect(fingerprint(tab({ title: 'x' }), 'h1')).not.toBe(base);
    expect(fingerprint(tab({ favIconUrl: 'x' }), 'h1')).not.toBe(base);
    expect(fingerprint(tab(), 'h2')).not.toBe(base);
    expect(fingerprint(tab(), 'h1')).toBe(base);
  });

  it('the presets compile and catch what they claim to', () => {
    for (const p of DETECTOR_PRESETS) if (p.kind !== 'unchanged') expect(compileMatcher(p.pattern).ok).toBe(true);
    const [signedOut, errorTitle, errorUrl] = DETECTOR_PRESETS.map((p, i) => ({ ...p, id: String(i) }));
    const hit = (d: Detector, t: Partial<TabSnapshot>) => matchingDetector([d], tab(t), 0, 0) !== null;
    expect(hit(signedOut!, { url: 'https://login.microsoftonline.com/common/oauth2/authorize' })).toBe(true);
    expect(hit(signedOut!, { url: 'https://grafana.example/login' })).toBe(true);
    expect(hit(signedOut!, { url: 'https://grafana.example/d/logins-per-hour' })).toBe(false);
    expect(hit(errorTitle!, { title: '502 Bad Gateway' })).toBe(true);
    expect(hit(errorTitle!, { title: 'Your session has expired' })).toBe(true);
    expect(hit(errorTitle!, { title: 'Q3 revenue: 5020 units' })).toBe(false);
    expect(hit(errorUrl!, { url: 'https://app.example/error?code=1' })).toBe(true);
    expect(hit(errorUrl!, { url: 'https://app.example/errors-dashboard' })).toBe(false);
  });
});
