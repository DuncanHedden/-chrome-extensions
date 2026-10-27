import { DEFAULT_SETTINGS, INITIAL_STATE } from '../src/engine/defaults.ts';
import { reconcile, type ReconcileResult } from '../src/engine/reconcile.ts';
import type { LogEntry, RotationState, Settings, TabSnapshot, World } from '../src/engine/types.ts';

export const SELF = 'chrome-extension://abc/';
export const T0 = Date.UTC(2026, 9, 26, 12, 0, 0);

export function settings(patch: Partial<Settings> = {}): Settings {
  return { ...structuredClone(DEFAULT_SETTINGS), defaultDurationSec: 10, ...patch };
}

export function playlist(...urls: string[]): Settings['playlist'] {
  return urls.map((url, i) => ({ id: `e${i + 1}`, url, durationSec: null, reloadBeforeShow: false }));
}

/**
 * A fake Chrome: windows, tabs, a clock. `apply` executes reconcile's actions the way runtime.ts does,
 * so tests can run the engine through time and poke at the world in between.
 */
export class FakeChrome {
  now = T0;
  windows = [{ id: 1, focused: true }];
  tabs: TabSnapshot[] = [];
  private nextId = 100;
  state: RotationState = structuredClone(INITIAL_STATE);
  log: LogEntry[] = [];
  /** Tab IDs activated, in order. */
  activations: number[] = [];
  reloads: number[] = [];
  navigations: Array<{ tabId: number; url: string }> = [];
  contentHashes: Record<number, string> = {};

  constructor(public settings: Settings = settingsDefault()) {}

  addTab(url: string, patch: Partial<TabSnapshot> = {}, windowId = 1): TabSnapshot {
    const index = this.tabs.filter((t) => t.windowId === windowId).length;
    const tab: TabSnapshot = {
      id: this.nextId++, windowId, index, url, status: 'complete', active: false, discarded: false, title: url, favIconUrl: '', ...patch,
    };
    this.tabs.push(tab);
    if (tab.active) this.activate(tab.id, false);
    return tab;
  }

  tab(id: number) {
    return this.tabs.find((t) => t.id === id)!;
  }

  activeTab(windowId = 1) {
    return this.tabs.find((t) => t.windowId === windowId && t.active);
  }

  activate(tabId: number, record = true) {
    const tab = this.tab(tabId);
    for (const t of this.tabs) if (t.windowId === tab.windowId) t.active = t.id === tabId;
    if (record) this.activations.push(tabId);
  }

  closeTab(tabId: number) {
    const tab = this.tab(tabId);
    this.tabs = this.tabs.filter((t) => t.id !== tabId);
    for (const t of this.tabs) if (t.windowId === tab.windowId && t.index > tab.index) t.index--;
    // Chrome activates a neighbour when the active tab closes.
    if (tab.active) {
      const neighbour = this.tabs.filter((t) => t.windowId === tab.windowId).sort((a, b) => a.index - b.index)[Math.max(0, tab.index - 1)];
      if (neighbour) this.activate(neighbour.id, false);
    }
  }

  world(): World {
    return { now: this.now, windows: this.windows, tabs: structuredClone(this.tabs), selfOrigin: SELF, contentHashes: this.contentHashes };
  }

  start() {
    this.state = { ...structuredClone(INITIAL_STATE), running: true };
    return this.step();
  }

  /** One reconcile + apply, as runtime.ts does on every wake. */
  step(): ReconcileResult {
    const result = reconcile(this.state, this.settings, this.world());
    for (const action of result.actions) {
      switch (action.type) {
        case 'activate':
          this.activate(action.tabId);
          break;
        case 'reload': {
          this.reloads.push(action.tabId);
          const tab = this.tab(action.tabId);
          Object.assign(tab, { status: 'loading', discarded: false });
          break;
        }
        case 'create': {
          const tab = this.addTab(action.url, {}, action.windowId);
          (action.list === 'offHours' ? result.state.offHoursTabs : result.state.playlistTabs)[action.entryId] = tab.id;
          break;
        }
        case 'close':
          this.closeTab(action.tabId);
          break;
        case 'navigate':
          this.navigations.push({ tabId: action.tabId, url: action.url });
          Object.assign(this.tab(action.tabId), { url: action.url, status: 'loading' });
          break;
      }
    }
    this.state = result.state;
    this.log.push(...result.log);
    return result;
  }

  /** Advance the clock to the engine's requested wake time (or by `ms`) and step. */
  wake(ms?: number): ReconcileResult {
    const last = reconcile(this.state, this.settings, this.world());
    this.now = ms === undefined ? (last.wakeAt ?? this.now + 30_000) : this.now + ms;
    return this.step();
  }

  /** Mark all loading tabs as finished loading. */
  finishLoading() {
    for (const t of this.tabs) if (t.status === 'loading') t.status = 'complete';
  }

  codes() {
    return this.log.map((e) => e.code);
  }
}

function settingsDefault() {
  return settings();
}
