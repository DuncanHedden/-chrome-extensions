import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/engine/defaults.ts';
import { BACKOFF_MS, OFF_HOURS_PAGE } from '../src/engine/reconcile.ts';
import type { Detector, Schedule, Settings } from '../src/engine/types.ts';
import { FakeChrome, SELF, playlist, settings } from './harness.ts';

const S = 1000;
const MIN = 60 * S;
const NY = 'America/New_York';
const at = (iso: string) => Date.parse(iso);

const officeHours = (offHours: Partial<Schedule['offHours']> = {}): Schedule => ({
  enabled: true,
  timeZone: NY,
  windows: [{ id: 'w', days: [1, 2, 3, 4, 5], start: '07:00', end: '18:00' }],
  offHours: { ...DEFAULT_SETTINGS.schedule.offHours, ...offHours },
});

function screen(patch: Partial<Settings>, start = at('2026-10-26T17:58:00-04:00')) {
  const chrome = new FakeChrome(settings({ source: 'playlist', playlist: playlist('https://a.example/', 'https://b.example/'), ...patch }));
  chrome.now = start;
  chrome.start();
  chrome.wake(); // playlist tabs opened and first one shown
  return chrome;
}

describe('schedules', () => {
  it('at closing time switches to a blank off-hours page, and back at opening time', () => {
    const chrome = screen({ schedule: officeHours() });
    expect(chrome.activeTab()!.url).toBe('https://a.example/');

    chrome.now = at('2026-10-26T18:00:05-04:00');
    chrome.step();
    chrome.wake(); // off-hours tab created, then shown
    expect(chrome.activeTab()!.url).toBe(`${SELF}${OFF_HOURS_PAGE}`);
    expect(chrome.state.offHours).toBe(true);
    expect(chrome.codes()).toContain('schedule-off');
    // Playlist tabs stay open in the background, ready for the morning.
    expect(chrome.tabs.filter((t) => t.url.startsWith('https://')).length).toBe(2);

    chrome.now = at('2026-10-27T07:00:10-04:00');
    chrome.step();
    expect(chrome.codes()).toContain('schedule-on');
    expect(chrome.activeTab()!.url).toBe('https://a.example/');
    expect(chrome.tabs.some((t) => t.url.includes(OFF_HOURS_PAGE))).toBe(false); // closed again
  });

  it('a boundary crossed while asleep is applied on wake', () => {
    const chrome = screen({ schedule: officeHours() });
    // Laptop lid closed at 17:58 Friday, opened Monday 08:00.
    chrome.now = at('2026-10-30T17:58:00-04:00');
    chrome.step();
    chrome.now = at('2026-11-02T08:00:00-05:00');
    chrome.step();
    expect(chrome.state.offHours).toBe(false);
    expect(chrome.activeTab()!.url).toMatch(/^https:\/\/[ab]\.example\/$/);
    // Asleep across the whole off period: no spurious off/on flapping in the log.
    expect(chrome.codes().filter((c) => c.startsWith('schedule-'))).toEqual([]);
  });

  it('off-hours custom page', () => {
    const chrome = screen({ schedule: officeHours({ kind: 'page', url: 'https://intranet.example/welcome' }) });
    chrome.now = at('2026-10-26T19:00:00-04:00');
    chrome.step();
    chrome.wake();
    expect(chrome.activeTab()!.url).toBe('https://intranet.example/welcome');
  });

  it('off-hours playlist rotates on its own, without adopting the main playlist’s tabs', () => {
    const night = playlist('https://news.example/', 'https://a.example/').map((e) => ({ ...e, id: `n-${e.id}` }));
    const chrome = screen({ schedule: officeHours({ kind: 'playlist', entries: night }) });
    chrome.now = at('2026-10-26T19:00:00-04:00');
    chrome.step();
    chrome.wake();
    // a.example appears in both lists; the off-hours list gets its own tab.
    expect(chrome.tabs.filter((t) => t.url === 'https://a.example/')).toHaveLength(2);
    const shown = new Set<string>();
    for (let i = 0; i < 4; i++) {
      chrome.wake();
      shown.add(chrome.activeTab()!.url);
    }
    expect([...shown].sort()).toEqual(['https://a.example/', 'https://news.example/']);
    expect(Object.values(chrome.state.offHoursTabs)).toContain(chrome.activeTab()!.id);
  });

  it('window mode never rotates the off-hours tab into the daytime rotation', () => {
    const chrome = new FakeChrome(settings({ schedule: officeHours({ kind: 'page', url: 'https://intranet.example/' }) }));
    chrome.now = at('2026-10-26T17:59:59-04:00');
    chrome.addTab('https://dash.example/1', { active: true });
    chrome.addTab('https://dash.example/2');
    chrome.start();
    chrome.now = at('2026-10-26T18:00:01-04:00');
    chrome.step();
    chrome.wake();
    const offTab = chrome.activeTab()!;
    expect(offTab.url).toBe('https://intranet.example/');
    chrome.now = at('2026-10-27T07:00:01-04:00');
    const result = chrome.step();
    expect(result.items.map((i) => i.url)).toEqual(['https://dash.example/1', 'https://dash.example/2']);
    expect(chrome.tabs.some((t) => t.id === offTab.id)).toBe(false);
  });

  it('a disabled schedule (e.g. gated for free users) means always on', () => {
    const chrome = screen({ schedule: { ...officeHours(), enabled: false } }, at('2026-10-25T03:00:00-04:00'));
    expect(chrome.state.offHours).toBe(false);
    expect(chrome.activeTab()!.url).toBe('https://a.example/');
  });
});

describe('detectors', () => {
  const det = (patch: Partial<Detector>): Detector => ({
    id: 'd1', name: 'Signed out', enabled: true, kind: 'url', pattern: '/login', minutes: 30, checkContent: false, appliesTo: '', action: 'reload', ...patch,
  });

  it('reopen: a signed-out tab is sent back to its playlist URL, with backoff, until it stays there', () => {
    const chrome = screen({ detectors: [det({ action: 'reopen' })] });
    const tab = chrome.tab(chrome.state.playlistTabs.e2!);
    Object.assign(tab, { url: 'https://sso.example/login?next=b' });
    chrome.step();
    expect(chrome.navigations).toEqual([{ tabId: tab.id, url: 'https://b.example/' }]);
    expect(chrome.codes()).toEqual(expect.arrayContaining(['detector', 'reopen']));

    // SSO bounces it straight back to the login page: retried after the backoff, not in a loop.
    Object.assign(tab, { url: 'https://sso.example/login?next=b', status: 'complete' });
    chrome.wake(BACKOFF_MS[0]! - 1);
    expect(chrome.navigations).toHaveLength(1);
    chrome.wake(1);
    expect(chrome.navigations).toHaveLength(2);

    // Meanwhile it's skipped.
    chrome.now = chrome.state.nextSwitchAt;
    Object.assign(tab, { url: 'https://sso.example/login?next=b', status: 'complete' });
    chrome.step();
    expect(chrome.activeTab()!.id).not.toBe(tab.id);

    // Session restored: recovered and cleared.
    Object.assign(tab, { url: 'https://b.example/', status: 'complete' });
    chrome.wake(BACKOFF_MS[1]!);
    expect(chrome.codes()).toEqual(expect.arrayContaining(['detector-cleared', 'recovered']));
    expect(chrome.state.failures[tab.id]).toBeUndefined();
  });

  it('reload: an error title triggers reloads, logged once on entry, not every wake', () => {
    const chrome = screen({ detectors: [det({ kind: 'title', pattern: '502', action: 'reload' })] });
    const tab = chrome.tab(chrome.state.playlistTabs.e2!);
    tab.title = '502 Bad Gateway';
    chrome.step();
    chrome.step();
    expect(chrome.reloads).toEqual([tab.id]);
    expect(chrome.codes().filter((c) => c === 'detector')).toHaveLength(1);
  });

  it('skip: matching tabs are left out of the rotation but not touched', () => {
    const chrome = screen({ detectors: [det({ kind: 'title', pattern: 'maintenance', action: 'skip' })] });
    chrome.tab(chrome.state.playlistTabs.e2!).title = 'Down for maintenance';
    for (let i = 0; i < 3; i++) chrome.wake();
    expect(chrome.activations.map((id) => chrome.tab(id).url)).not.toContain('https://b.example/');
    expect(chrome.reloads).toEqual([]);
  });

  it('alert: logs an error but keeps showing the tab', () => {
    const chrome = screen({ detectors: [det({ kind: 'title', pattern: 'degraded', action: 'alert' })] });
    chrome.tab(chrome.state.playlistTabs.e2!).title = 'Status: degraded';
    chrome.wake();
    expect(chrome.log.find((e) => e.code === 'detector')!.level).toBe('error');
    expect(chrome.activeTab()!.url).toBe('https://b.example/');
  });

  it('unchanged: a frozen page is reloaded after N minutes, then the clock restarts', () => {
    const chrome = screen({ defaultDurationSec: 60, detectors: [det({ kind: 'unchanged', minutes: 10, action: 'reload' })] });
    const a = chrome.state.playlistTabs.e1!;
    for (let t = 0; t < 9; t++) chrome.wake(MIN);
    expect(chrome.reloads).toEqual([]);
    chrome.wake(MIN + S);
    expect(chrome.reloads).toContain(a);
    expect(chrome.codes()).toContain('refresh');
    chrome.finishLoading();
    const before = chrome.reloads.length;
    chrome.wake(5 * MIN);
    expect(chrome.reloads.length).toBe(before); // not again until another 10 quiet minutes
  });

  it('unchanged: a changing page (title, or page text via content hash) is left alone', () => {
    const chrome = screen({ defaultDurationSec: 60, detectors: [det({ kind: 'unchanged', minutes: 10, action: 'reload' })] });
    const a = chrome.state.playlistTabs.e1!;
    for (let t = 0; t < 30; t++) {
      chrome.contentHashes[a] = `h${t}`;
      chrome.contentHashes[chrome.state.playlistTabs.e2!] = `h${t}`;
      chrome.wake(MIN);
    }
    expect(chrome.reloads).toEqual([]);
  });

  it('appliesTo limits a detector to matching URLs', () => {
    const chrome = screen({ detectors: [det({ kind: 'title', pattern: 'error', appliesTo: 'https://a.example/' })] });
    chrome.tab(chrome.state.playlistTabs.e2!).title = 'error';
    chrome.step();
    expect(chrome.reloads).toEqual([]);
  });

  it('detectors fix things even with built-in self-healing switched off (they are explicit rules)', () => {
    const chrome = screen({ selfHeal: false, detectors: [det({ kind: 'title', pattern: '502' })] });
    chrome.tab(chrome.state.playlistTabs.e2!).title = '502';
    chrome.step();
    expect(chrome.reloads).toHaveLength(1);
  });

  it('window mode reopen goes back to the URL the tab had when it joined the rotation', () => {
    const chrome = new FakeChrome(settings({ detectors: [det({ action: 'reopen' })] }));
    const t1 = chrome.addTab('https://grafana.example/d/abc', { active: true });
    chrome.addTab('https://other.example/');
    chrome.start();
    Object.assign(chrome.tab(t1.id), { url: 'https://grafana.example/login' });
    chrome.step();
    expect(chrome.navigations).toEqual([{ tabId: t1.id, url: 'https://grafana.example/d/abc' }]);
  });
});

describe('settings lock and holding', () => {
  it('an unlocked settings page holds rotation; a locked one is rotated away from', () => {
    const chrome = screen({ lock: { enabled: true, salt: 's', hash: 'h' } });
    const options = chrome.addTab(`${SELF}options/options.html`);
    chrome.activate(options.id, false);
    chrome.wake(60 * S);
    expect(chrome.activeTab()!.id).not.toBe(options.id); // PIN prompt left on screen: rotation takes over

    chrome.tab(options.id).url = `${SELF}options/options.html#unlocked`;
    chrome.activate(options.id, false);
    const held = chrome.wake(60 * S);
    expect(held.actions).toEqual([]);
  });
});
