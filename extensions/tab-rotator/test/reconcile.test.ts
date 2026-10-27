import { describe, expect, it } from 'vitest';
import { INITIAL_STATE } from '../src/engine/defaults.ts';
import { BACKOFF_MS, PRELOAD_LEAD_MS, reconcile, urlMatches } from '../src/engine/reconcile.ts';
import { FakeChrome, SELF, T0, playlist, settings } from './harness.ts';

const S = 1000;

function windowOf(n: number, s = settings()) {
  const chrome = new FakeChrome(s);
  const tabs = Array.from({ length: n }, (_, i) => chrome.addTab(`https://dash.example/${i + 1}`, { active: i === 0 }));
  return { chrome, tabs };
}

describe('reconcile: basics', () => {
  it('does nothing and asks for no wake when stopped', () => {
    const { chrome } = windowOf(3);
    const result = chrome.step();
    expect(result.actions).toEqual([]);
    expect(result.wakeAt).toBeNull();
  });

  it('starts on the active tab and wakes when its time is up', () => {
    const { chrome, tabs } = windowOf(3);
    chrome.activate(tabs[1]!.id, false);
    const result = chrome.start();
    expect(result.state.currentKey).toBe(`tab:${tabs[1]!.id}`);
    expect(result.actions).toEqual([]);
    expect(result.wakeAt).toBe(T0 + 10 * S);
    expect(chrome.codes()).toEqual(['started']);
  });

  it('rotates in tab order and wraps around', () => {
    const { chrome, tabs } = windowOf(3);
    chrome.start();
    for (let i = 0; i < 6; i++) chrome.wake();
    expect(chrome.activations).toEqual([1, 2, 0, 1, 2, 0].map((i) => tabs[i]!.id));
    expect(chrome.now).toBe(T0 + 60 * S);
  });

  it('is idempotent: reconciling again at the same instant changes nothing', () => {
    const { chrome } = windowOf(3);
    chrome.start();
    chrome.wake();
    const again = reconcile(chrome.state, chrome.settings, chrome.world());
    expect(again.actions).toEqual([]);
    expect(again.log).toEqual([]);
    expect(again.state).toEqual(chrome.state);
  });

  it('does not switch early when woken before time (watchdog, tab events)', () => {
    const { chrome } = windowOf(3);
    chrome.start();
    const result = chrome.wake(4 * S);
    expect(result.actions).toEqual([]);
    expect(result.wakeAt).toBe(T0 + 10 * S);
  });

  it('applies per-tab durations from URL rules (first match wins)', () => {
    const s = settings({
      tabRules: [
        { id: 'r1', urlPrefix: 'https://dash.example/2', durationSec: 60, reloadBeforeShow: false },
        { id: 'r2', urlPrefix: 'https://dash.example/', durationSec: 5, reloadBeforeShow: false },
      ],
    });
    const { chrome } = windowOf(3, s);
    chrome.start();
    expect(chrome.state.nextSwitchAt - chrome.now).toBe(5 * S);
    chrome.wake();
    expect(chrome.state.nextSwitchAt - chrome.now).toBe(60 * S);
  });

  it('never rotates its own pages, and holds while the options page is in front', () => {
    const { chrome, tabs } = windowOf(2);
    const options = chrome.addTab(`${SELF}options/options.html`);
    chrome.start();
    chrome.activate(options.id, false);
    const held = chrome.wake(60 * S);
    expect(held.actions).toEqual([]);
    expect(held.items.map((i) => i.tabId)).toEqual([tabs[0]!.id, tabs[1]!.id]);
    chrome.activate(tabs[1]!.id, false); // user goes back to a dashboard
    chrome.step();
    expect(chrome.state.currentKey).toBe(`tab:${tabs[1]!.id}`);
    expect(chrome.state.nextSwitchAt).toBe(chrome.now + 10 * S);
  });

  it('clamps silly durations', () => {
    const { chrome } = windowOf(2, settings({ defaultDurationSec: 0 }));
    chrome.start();
    expect(chrome.state.nextSwitchAt - chrome.now).toBe(2 * S);
  });
});

describe('reconcile: surviving restarts, sleep and clock changes', () => {
  it('service worker killed mid-rotation: a later wake continues from stored state alone', () => {
    const { chrome, tabs } = windowOf(3);
    chrome.start();
    chrome.wake(); // now on tab 2
    // Simulate a fresh service worker: only the persisted JSON survives.
    chrome.state = JSON.parse(JSON.stringify(chrome.state));
    chrome.now += 3 * S; // woken by the watchdog, not yet due
    expect(chrome.step().actions).toEqual([]);
    chrome.wake();
    expect(chrome.activeTab()!.id).toBe(tabs[2]!.id);
  });

  it('slept for 3 hours: advances exactly one tab, restarts the timer, logs the gap', () => {
    const { chrome, tabs } = windowOf(3);
    chrome.start();
    chrome.now += 3 * 60 * 60 * S;
    const result = chrome.step();
    expect(chrome.activations).toEqual([tabs[1]!.id]);
    expect(result.state.nextSwitchAt).toBe(chrome.now + 10 * S);
    expect(chrome.codes()).toContain('late');
    expect(result.log.find((e) => e.code === 'late')!.message).toMatch(/3h 0m late/);
  });

  it('does not log small lateness (normal timer jitter)', () => {
    const { chrome } = windowOf(3);
    chrome.start();
    chrome.wake(10 * S + 900);
    expect(chrome.codes()).not.toContain('late');
  });

  it('clock jumped backwards by an hour: restarts the timer instead of freezing', () => {
    const { chrome } = windowOf(3);
    chrome.start();
    chrome.now -= 60 * 60 * S;
    const result = chrome.step();
    expect(result.state.nextSwitchAt).toBe(chrome.now + 10 * S);
    expect(chrome.codes()).toContain('clock-backwards');
  });

  it('duration shortened while running: applies to the tab on screen, without a clock-change log', () => {
    const { chrome, tabs } = windowOf(3, settings({ defaultDurationSec: 30 }));
    chrome.start();
    chrome.now += 4 * S;
    chrome.settings = { ...chrome.settings, defaultDurationSec: 5 };
    expect(chrome.step().wakeAt).toBe(T0 + 5 * S);
    chrome.wake();
    expect(chrome.activeTab()!.id).toBe(tabs[1]!.id);
    expect(chrome.codes()).not.toContain('clock-backwards');
  });

  it('starts in the window it was asked to, even if another window is focused', () => {
    const { chrome } = windowOf(2);
    chrome.windows = [{ id: 1, focused: false }, { id: 2, focused: true }];
    const other = chrome.addTab('https://other.example/', { active: true }, 2);
    chrome.state = { ...structuredClone(INITIAL_STATE), running: true, windowId: 1 };
    chrome.step();
    expect(chrome.state.windowId).toBe(1);
    expect(chrome.state.currentKey).not.toBe(`tab:${other.id}`);
  });

  it('clock jumped forwards: treated like sleep, one step', () => {
    const { chrome, tabs } = windowOf(3);
    chrome.start();
    chrome.now += 24 * 60 * 60 * S;
    chrome.step();
    expect(chrome.activations).toEqual([tabs[1]!.id]);
  });

  it('DST change does not affect timing (epoch-based, not wall-clock)', () => {
    // 2026-11-01 02:00 EDT -> 01:00 EST in America/New_York is 06:00 UTC.
    const { chrome, tabs } = windowOf(2, settings({ defaultDurationSec: 600 }));
    chrome.now = Date.UTC(2026, 10, 1, 5, 55);
    chrome.start();
    chrome.wake();
    expect(chrome.now).toBe(Date.UTC(2026, 10, 1, 6, 5));
    expect(chrome.activations).toEqual([tabs[1]!.id]);
    expect(chrome.codes()).not.toContain('clock-backwards');
  });

  it('rotation window closed (or new IDs after a Chrome restart): moves to the focused window', () => {
    const { chrome } = windowOf(2);
    chrome.start();
    chrome.windows = [{ id: 7, focused: true }];
    chrome.tabs = [];
    const a = chrome.addTab('https://dash.example/a', { active: true }, 7);
    chrome.addTab('https://dash.example/b', {}, 7);
    chrome.wake();
    expect(chrome.state.windowId).toBe(7);
    expect(chrome.codes()).toContain('window-replaced');
    expect(chrome.state.currentKey).toBe(`tab:${a.id}`);
  });

  it('no browser window at all: waits and retries', () => {
    const { chrome } = windowOf(2);
    chrome.start();
    chrome.windows = [];
    chrome.tabs = [];
    const result = chrome.wake(10 * S);
    expect(result.actions).toEqual([]);
    expect(result.wakeAt).toBe(chrome.now + 5 * S);
  });
});

describe('reconcile: tabs changing underneath', () => {
  it('current tab closed: continues from the tab Chrome brought forward', () => {
    const { chrome, tabs } = windowOf(3);
    chrome.start();
    chrome.wake(); // on tab 2
    chrome.closeTab(tabs[1]!.id); // Chrome activates tab 1
    chrome.step();
    expect(chrome.state.currentKey).toBe(`tab:${tabs[0]!.id}`);
    expect(chrome.state.nextSwitchAt).toBe(chrome.now + 10 * S);
    expect(chrome.codes()).toContain('current-closed');
  });

  it('current tab closed with nothing active in the list: picks the tab at the same position', () => {
    const { chrome, tabs } = windowOf(3);
    chrome.start();
    chrome.wake(); // on tab 2 (position 1)
    chrome.tabs = chrome.tabs.filter((t) => t.id !== tabs[1]!.id);
    chrome.tab(tabs[2]!.id).index = 1;
    chrome.step();
    expect(chrome.activeTab()!.id).toBe(tabs[2]!.id);
  });

  it('another tab closed: rotation carries on over the remaining ones', () => {
    const { chrome, tabs } = windowOf(3);
    chrome.start();
    chrome.closeTab(tabs[1]!.id);
    chrome.wake();
    chrome.wake();
    expect(chrome.activations).toEqual([tabs[2]!.id, tabs[0]!.id]);
  });

  it('new tab opened in the window joins the rotation', () => {
    const { chrome, tabs } = windowOf(2);
    chrome.start();
    const added = chrome.addTab('https://dash.example/new');
    chrome.wake();
    chrome.wake();
    expect(chrome.activations).toEqual([tabs[1]!.id, added.id]);
  });

  it('a person switches tabs by hand: rotation continues from there', () => {
    const { chrome, tabs } = windowOf(3);
    chrome.start();
    chrome.now += 4 * S;
    chrome.activate(tabs[2]!.id, false);
    chrome.step();
    expect(chrome.state.currentKey).toBe(`tab:${tabs[2]!.id}`);
    expect(chrome.state.nextSwitchAt).toBe(chrome.now + 10 * S);
    chrome.wake();
    expect(chrome.activeTab()!.id).toBe(tabs[0]!.id);
  });

  it('window with no rotatable tabs: waits', () => {
    const chrome = new FakeChrome(settings());
    chrome.addTab(`${SELF}options/options.html`, { active: true });
    const result = chrome.start();
    expect(result.actions).toEqual([]);
    expect(result.wakeAt).toBe(chrome.now + 5 * S);
  });

  it('a single tab just restarts its own timer', () => {
    const { chrome } = windowOf(1);
    chrome.start();
    const result = chrome.wake();
    expect(result.actions).toEqual([]);
    expect(result.state.nextSwitchAt).toBe(chrome.now + 10 * S);
  });
});

describe('reconcile: skipping and self-healing', () => {
  it('skips tabs that are still loading', () => {
    const { chrome, tabs } = windowOf(3);
    chrome.start();
    chrome.tab(tabs[1]!.id).status = 'loading';
    chrome.wake();
    expect(chrome.activeTab()!.id).toBe(tabs[2]!.id);
  });

  it('shows loading tabs when skipLoading is off', () => {
    const { chrome, tabs } = windowOf(3, settings({ skipLoading: false }));
    chrome.start();
    chrome.tab(tabs[1]!.id).status = 'loading';
    chrome.wake();
    expect(chrome.activeTab()!.id).toBe(tabs[1]!.id);
  });

  it('everything else loading: stays put and looks again shortly', () => {
    const { chrome, tabs } = windowOf(3);
    chrome.start();
    chrome.tab(tabs[1]!.id).status = 'loading';
    chrome.tab(tabs[2]!.id).status = 'loading';
    const result = chrome.wake();
    expect(chrome.activations).toEqual([]);
    expect(result.state.nextSwitchAt).toBe(chrome.now + 10 * S); // current re-shown for another slot
  });

  it('crashed tab (status "unloaded", not discarded): skipped, reloaded with backoff, then recovered', () => {
    const { chrome, tabs } = windowOf(3);
    chrome.start();
    const crashed = chrome.tab(tabs[1]!.id);
    crashed.status = 'unloaded';

    const first = chrome.wake(1 * S);
    expect(first.actions).toContainEqual({ type: 'reload', tabId: crashed.id });
    expect(chrome.codes()).toEqual(['started', 'crashed', 'reload']);

    // The reload doesn't fix it: retries back off 5 s, 15 s, 60 s, ...
    crashed.status = 'unloaded';
    chrome.wake(BACKOFF_MS[0]! - 1);
    expect(chrome.reloads).toHaveLength(1);
    chrome.wake(1);
    expect(chrome.reloads).toHaveLength(2);
    crashed.status = 'unloaded';
    chrome.wake(BACKOFF_MS[1]!);
    expect(chrome.reloads).toHaveLength(3);

    // Meanwhile rotation skips it.
    chrome.now = chrome.state.nextSwitchAt;
    crashed.status = 'unloaded';
    chrome.step();
    expect(chrome.activeTab()!.id).not.toBe(crashed.id);

    // It comes back.
    crashed.status = 'complete';
    chrome.now = chrome.state.failures[crashed.id]!.retryAt;
    chrome.step();
    expect(chrome.state.failures[crashed.id]).toBeUndefined();
    expect(chrome.codes()).toContain('recovered');
  });

  it('logs an error after repeated failures', () => {
    const { chrome, tabs } = windowOf(2);
    chrome.start();
    const tab = chrome.tab(tabs[1]!.id);
    for (let i = 0; i < BACKOFF_MS.length; i++) {
      tab.status = 'unloaded';
      chrome.now = (chrome.state.failures[tab.id]?.retryAt ?? chrome.now) + 1;
      chrome.step();
    }
    expect(chrome.codes()).toContain('still-failing');
    expect(chrome.state.failures[tab.id]!.retryAt - chrome.now).toBe(BACKOFF_MS.at(-1));
  });

  it('the tab on screen crashes: switches away immediately', () => {
    const { chrome, tabs } = windowOf(3);
    chrome.start();
    chrome.tab(tabs[0]!.id).status = 'unloaded';
    chrome.wake(2 * S);
    expect(chrome.activeTab()!.id).toBe(tabs[1]!.id);
  });

  it('page failed to load (webNavigation error): reloads it and skips it until it loads', () => {
    const { chrome, tabs } = windowOf(3);
    chrome.start();
    chrome.state.loadErrors[tabs[1]!.id] = { error: 'net::ERR_NAME_NOT_RESOLVED', at: chrome.now };
    const result = chrome.wake(1 * S);
    expect(result.actions).toContainEqual({ type: 'reload', tabId: tabs[1]!.id });
    expect(result.log[0]!.message).toContain('ERR_NAME_NOT_RESOLVED');
    chrome.finishLoading();
    // The reload succeeded; by the next switch it's been healthy past the grace period, so it's shown.
    chrome.wake(9 * S);
    expect(chrome.codes()).toContain('recovered');
    expect(chrome.activeTab()!.id).toBe(tabs[1]!.id);
  });

  it('page stuck loading past the timeout: treated as failed', () => {
    const { chrome, tabs } = windowOf(2, settings({ loadTimeoutSec: 30 }));
    chrome.start();
    chrome.tab(tabs[1]!.id).status = 'loading';
    chrome.step(); // first seen loading
    const wakes: number[] = [];
    for (let i = 0; i < 5 && !chrome.reloads.length; i++) wakes.push(chrome.wake().wakeAt!);
    expect(chrome.reloads).toEqual([tabs[1]!.id]);
    expect(chrome.codes()).toContain('load-timeout');
    expect(chrome.now).toBe(T0 + 30 * S);
  });

  it('with self-healing off, broken tabs are skipped but not reloaded', () => {
    const { chrome, tabs } = windowOf(3, settings({ selfHeal: false }));
    chrome.start();
    chrome.tab(tabs[1]!.id).status = 'unloaded';
    chrome.wake();
    expect(chrome.reloads).toEqual([]);
    expect(chrome.activeTab()!.id).toBe(tabs[2]!.id);
  });

  it('discarded tabs (memory saver) are reloaded in the background and shown next round', () => {
    const { chrome, tabs } = windowOf(3);
    chrome.start();
    Object.assign(chrome.tab(tabs[1]!.id), { status: 'unloaded', discarded: true });
    chrome.wake();
    expect(chrome.reloads).toContain(tabs[1]!.id);
    expect(chrome.activeTab()!.id).toBe(tabs[2]!.id);
    expect(chrome.codes()).not.toContain('crashed');
  });
});

describe('reconcile: reload before show', () => {
  it('reloads the upcoming tab once, shortly before its turn', () => {
    const s = settings({
      defaultDurationSec: 60,
      tabRules: [{ id: 'r', urlPrefix: 'https://dash.example/2', durationSec: null, reloadBeforeShow: true }],
    });
    const { chrome, tabs } = windowOf(3, s);
    const start = chrome.start();
    expect(start.wakeAt).toBe(T0 + 60 * S - PRELOAD_LEAD_MS);
    chrome.wake();
    expect(chrome.reloads).toEqual([tabs[1]!.id]);
    // Still loading at switch time: shown anyway, because we caused the load.
    const atSwitch = chrome.wake();
    expect(atSwitch.state.currentKey).toBe(`tab:${tabs[1]!.id}`);
    expect(chrome.reloads).toEqual([tabs[1]!.id]);
  });

  it('short slots preload at half the slot', () => {
    const s = settings({
      defaultDurationSec: 4,
      tabRules: [{ id: 'r', urlPrefix: 'https://dash.example/2', durationSec: null, reloadBeforeShow: true }],
    });
    const { chrome } = windowOf(2, s);
    expect(chrome.start().wakeAt).toBe(T0 + 2 * S);
  });
});

describe('reconcile: pause for humans', () => {
  it('holds while paused and restarts the slot on resume', () => {
    const { chrome, tabs } = windowOf(3);
    chrome.start();
    chrome.state.paused = true;
    const paused = chrome.wake(60 * S);
    expect(paused.actions).toEqual([]);
    expect(paused.wakeAt).toBeNull();
    chrome.state.paused = false;
    chrome.state.restartSlot = true;
    const resumed = chrome.step();
    expect(resumed.state.nextSwitchAt).toBe(chrome.now + 10 * S);
    expect(chrome.activeTab()!.id).toBe(tabs[0]!.id);
  });

  it('resumes from whatever tab the person left in front', () => {
    const { chrome, tabs } = windowOf(3);
    chrome.start();
    chrome.state.paused = true;
    chrome.activate(tabs[2]!.id, false);
    chrome.wake(60 * S);
    chrome.state.paused = false;
    chrome.state.restartSlot = true;
    chrome.step();
    expect(chrome.state.currentKey).toBe(`tab:${tabs[2]!.id}`);
  });

  it('unpauses if pause-on-activity is switched off while paused', () => {
    const { chrome } = windowOf(2);
    chrome.start();
    chrome.state.paused = true;
    chrome.settings = { ...chrome.settings, pauseOnActivity: false };
    expect(chrome.step().state.paused).toBe(false);
  });
});

describe('reconcile: playlists', () => {
  const urls = ['https://grafana.example/d/a', 'https://grafana.example/d/b', 'https://jira.example/board'];

  it('opens a tab per entry, then rotates them in playlist order', () => {
    const chrome = new FakeChrome(settings({ source: 'playlist', playlist: playlist(...urls) }));
    const home = chrome.addTab('chrome://newtab/', { active: true });
    chrome.start();
    expect(chrome.tabs.map((t) => t.url)).toEqual(['chrome://newtab/', ...urls]);
    expect(chrome.tabs.find((t) => t.id === home.id)).toBeDefined(); // we don't close the user's tabs
    chrome.wake(); // pending creates resolve
    expect(chrome.activeTab()!.url).toBe(urls[0]);
    chrome.wake();
    chrome.wake();
    expect(chrome.activations.map((id) => chrome.tab(id).url)).toEqual([urls[0], urls[1], urls[2]]);
  });

  it('adopts existing matching tabs instead of opening duplicates (e.g. after a Chrome restart)', () => {
    const chrome = new FakeChrome(settings({ source: 'playlist', playlist: playlist(...urls) }));
    chrome.addTab('https://grafana.example/d/a?orgId=1&refresh=30s', { active: true }); // redirect added a query
    chrome.addTab('https://grafana.example/d/b');
    chrome.addTab('https://jira.example/board/');
    const result = chrome.start();
    expect(result.actions.filter((a) => a.type === 'create')).toEqual([]);
    expect(Object.keys(chrome.state.playlistTabs)).toHaveLength(3);
  });

  it('a playlist tab closed mid-rotation is reopened and logged', () => {
    const chrome = new FakeChrome(settings({ source: 'playlist', playlist: playlist(...urls) }));
    chrome.start();
    chrome.wake();
    const victim = chrome.state.playlistTabs.e2!;
    chrome.closeTab(victim);
    chrome.step();
    expect(chrome.tabs.filter((t) => t.url === urls[1])).toHaveLength(1);
    expect(chrome.state.playlistTabs.e2).not.toBe(victim);
    expect(chrome.codes()).toContain('reopened');
  });

  it('the playlist tab on screen is closed: moves on and reopens it', () => {
    const chrome = new FakeChrome(settings({ source: 'playlist', playlist: playlist(...urls) }));
    chrome.start();
    chrome.wake();
    const onScreen = chrome.activeTab()!;
    chrome.closeTab(onScreen.id);
    chrome.step();
    expect(chrome.tabs.filter((t) => t.url === onScreen.url)).toHaveLength(1);
    chrome.wake();
    expect(chrome.activeTab()).toBeDefined();
  });

  describe('edited while running', () => {
    function running() {
      const chrome = new FakeChrome(settings({ source: 'playlist', playlist: playlist(...urls) }));
      chrome.start();
      chrome.wake();
      chrome.wake(); // on entry 2
      return chrome;
    }

    it('entry added: opened and included', () => {
      const chrome = running();
      chrome.settings = { ...chrome.settings, playlist: [...chrome.settings.playlist, { id: 'e4', url: 'https://new.example/', durationSec: null, reloadBeforeShow: false }] };
      chrome.step();
      expect(chrome.tabs.some((t) => t.url === 'https://new.example/')).toBe(true);
      expect(chrome.state.currentKey).toBe('entry:e2');
    });

    it('entry removed: its tab is closed, rotation unaffected', () => {
      const chrome = running();
      const doomed = chrome.state.playlistTabs.e3!;
      chrome.settings = { ...chrome.settings, playlist: chrome.settings.playlist.filter((e) => e.id !== 'e3') };
      chrome.step();
      expect(chrome.tabs.some((t) => t.id === doomed)).toBe(false);
      expect(chrome.state.currentKey).toBe('entry:e2');
      chrome.wake();
      expect(chrome.state.currentKey).toBe('entry:e1');
    });

    it('current entry removed: continues with what is now in front', () => {
      const chrome = running();
      chrome.settings = { ...chrome.settings, playlist: chrome.settings.playlist.filter((e) => e.id !== 'e2') };
      chrome.step();
      chrome.step(); // after the close lands
      expect(['entry:e1', 'entry:e3']).toContain(chrome.state.currentKey);
      expect(chrome.activeTab()!.id).toBe(chrome.state.playlistTabs[chrome.state.currentKey!.slice(6)]);
    });

    it('reordered: current entry kept, new order followed', () => {
      const chrome = running();
      const [a, b, c] = chrome.settings.playlist;
      chrome.settings = { ...chrome.settings, playlist: [b!, c!, a!].reverse() }; // a, c, b
      chrome.step();
      expect(chrome.state.currentKey).toBe('entry:e2');
      chrome.wake();
      expect(chrome.state.currentKey).toBe('entry:e1'); // after b comes (wrap) a
    });

    it('duration changed: takes effect from the next slot', () => {
      const chrome = running();
      chrome.settings = { ...chrome.settings, playlist: chrome.settings.playlist.map((e) => ({ ...e, durationSec: 45 })) };
      expect(chrome.step().wakeAt).toBe(chrome.state.nextSwitchAt);
      chrome.wake();
      expect(chrome.state.nextSwitchAt - chrome.now).toBe(45 * S);
    });
  });

  it('switching source from playlist to window keeps going', () => {
    const chrome = new FakeChrome(settings({ source: 'playlist', playlist: playlist(...urls) }));
    chrome.start();
    chrome.wake();
    chrome.settings = { ...chrome.settings, source: 'window' };
    const result = chrome.step();
    expect(result.items).toHaveLength(3);
    expect(result.state.currentKey).toMatch(/^tab:/);
  });
});

describe('reconcile: long-run simulation', () => {
  it('a day with random event wakes, SW restarts, crashes and closes keeps every invariant', () => {
    const urls = ['https://a.example/', 'https://b.example/', 'https://c.example/', 'https://d.example/'];
    const chrome = new FakeChrome(settings({ source: 'playlist', playlist: playlist(...urls), defaultDurationSec: 20 }));
    chrome.start();
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const end = T0 + 24 * 60 * 60 * S;
    let lastKey = chrome.state.currentKey;
    let lastShownAt = chrome.state.shownAt;
    while (chrome.now < end) {
      const r = rand();
      if (r < 0.6) chrome.wake();
      else if (r < 0.8) chrome.wake(Math.floor(rand() * 15 * S)); // tab event / watchdog
      else if (r < 0.85) chrome.state = JSON.parse(JSON.stringify(chrome.state)); // SW restart
      else if (r < 0.9 && chrome.tabs.length) chrome.tabs[Math.floor(rand() * chrome.tabs.length)]!.status = 'unloaded';
      else if (r < 0.93 && chrome.tabs.length > 1) chrome.closeTab(chrome.tabs[Math.floor(rand() * chrome.tabs.length)]!.id);
      else chrome.finishLoading();
      if (rand() < 0.3) chrome.finishLoading();

      // Invariants
      expect(chrome.tabs.filter((t) => urls.includes(t.url)).length).toBeLessThanOrEqual(urls.length);
      expect(chrome.state.nextSwitchAt).toBeGreaterThanOrEqual(chrome.now - 20 * S);
      if (chrome.state.currentKey !== lastKey) {
        lastKey = chrome.state.currentKey;
        lastShownAt = chrome.state.shownAt;
      }
      expect(chrome.state.shownAt).toBeGreaterThanOrEqual(lastShownAt);
    }
    chrome.finishLoading();
    for (let i = 0; i < 3; i++) chrome.wake(BACKOFF_MS.at(-1));
    // After a quiet period every entry has exactly one healthy tab again.
    for (const url of urls) expect(chrome.tabs.filter((t) => t.url === url)).toHaveLength(1);
    expect(Object.keys(chrome.state.failures)).toHaveLength(0);
  });
});

describe('urlMatches', () => {
  it('matches on prefix, ignoring fragments and a trailing slash', () => {
    expect(urlMatches('https://g.example/d/a', 'https://g.example/d/a?orgId=1')).toBe(true);
    expect(urlMatches('https://g.example/d/a/', 'https://g.example/d/a')).toBe(true);
    expect(urlMatches('https://g.example/d/a#x', 'https://g.example/d/a#y')).toBe(true);
    expect(urlMatches('https://g.example/d/a', 'https://login.example/?next=g.example')).toBe(false);
    expect(urlMatches('', 'https://anything')).toBe(false);
  });
});

it('INITIAL_STATE round-trips through JSON (it is what storage holds)', () => {
  expect(JSON.parse(JSON.stringify(INITIAL_STATE))).toEqual(INITIAL_STATE);
});
