import { clampDuration } from './defaults.ts';
import type {
  Action,
  FailureReason,
  LogEntry,
  LogLevel,
  RotationState,
  Settings,
  TabSnapshot,
  World,
} from './types.ts';

/** One thing in the rotation: a window tab, or a playlist entry (whose tab may not exist yet). */
export interface Item {
  key: string;
  tabId: number | null;
  url: string;
  durationMs: number;
  reloadBeforeShow: boolean;
}

export interface ReconcileResult {
  state: RotationState;
  actions: Action[];
  log: LogEntry[];
  /** When reconcile next needs to run, or null if only an external event can change anything. */
  wakeAt: number | null;
  items: Item[];
}

/** Reload backoff for a failing tab: 5 s, 15 s, 1 min, 5 min, then every 15 min. */
export const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000, 900_000];
/** How long before a switch the next item is reloaded, at most (and at most half the current item's time). */
export const PRELOAD_LEAD_MS = 15_000;
/** Late by more than this on wake: log it (sleep, suspended Chrome, clock change). */
export const LATE_LOG_MS = 60_000;
/** A reloaded tab must stay healthy this long before we call it recovered. */
const RECOVERY_GRACE_MS = 3_000;
const RETRY_SOON_MS = 2_000;
const FAILING_ALERT_ATTEMPTS = BACKOFF_MS.length;

/**
 * The rotation engine, as a pure function: given what we stored last time and what Chrome looks like
 * now, decide what should be on screen, what to fix, and when to look again.
 *
 * It runs on every wake (timer, alarm, tab event, Chrome start), so anything that happened in
 * between — the service worker being killed, the laptop sleeping for hours, the clock jumping, a tab
 * being closed or crashing, the playlist being edited — is corrected from facts, not remembered.
 * Running it twice with the same inputs is a no-op the second time.
 */
export function reconcile(prev: RotationState, settings: Settings, world: World): ReconcileResult {
  const { now } = world;
  const state = structuredClone(prev);
  const actions: Action[] = [];
  const log: LogEntry[] = [];
  const wakes: number[] = [];
  const note = (level: LogLevel, code: string, message: string, url?: string) =>
    log.push({ at: now, level, code, message, ...(url ? { url } : {}) });
  const done = (items: Item[]): ReconcileResult => ({
    state,
    actions,
    log,
    wakeAt: wakes.length ? Math.max(now + 250, Math.min(...wakes)) : null,
    items,
  });

  if (!state.running) return done([]);

  // --- Which window are we rotating? ---
  if (state.windowId === null || !world.windows.some((w) => w.id === state.windowId)) {
    const window = world.windows.find((w) => w.focused) ?? world.windows[0];
    if (!window) {
      wakes.push(now + 5_000);
      return done([]);
    }
    if (state.windowId !== null) note('warn', 'window-replaced', 'The rotation window was closed; continuing in another window.');
    state.windowId = window.id;
  }
  const windowTabs = world.tabs.filter((t) => t.windowId === state.windowId).sort((a, b) => a.index - b.index);
  const tabsById = new Map(world.tabs.map((t) => [t.id, t]));

  // --- Bookkeeping: forget tabs that are gone, track how long tabs have been loading. ---
  for (const record of [state.failures, state.loadErrors, state.loadingSince]) {
    for (const id of Object.keys(record)) if (!tabsById.has(Number(id))) delete record[Number(id)];
  }
  for (const tab of world.tabs) {
    if (tab.status === 'loading') state.loadingSince[tab.id] ??= now;
    else delete state.loadingSince[tab.id];
  }

  // --- Build the item list. ---
  const items =
    settings.source === 'window'
      ? windowItems(settings, windowTabs, world.selfOrigin)
      : playlistItems(state, settings, windowTabs, tabsById, actions, note);
  if (actions.some((a) => a.type === 'create')) wakes.push(now + 1_000);

  // --- Health: detect broken tabs and reload them with backoff. ---
  const failureOf = (tab: TabSnapshot): FailureReason | null => {
    if (tab.status === 'unloaded' && !tab.discarded) return 'crashed';
    if (state.loadErrors[tab.id]) return 'load-error';
    const since = state.loadingSince[tab.id];
    if (since !== undefined && now - since >= settings.loadTimeoutSec * 1000) return 'load-timeout';
    return null;
  };
  for (const item of items) {
    const tab = item.tabId === null ? undefined : tabsById.get(item.tabId);
    if (!tab) continue;
    const reason = failureOf(tab);
    let failure = state.failures[tab.id];
    if (reason && settings.selfHeal) {
      if (!failure) {
        failure = { reason, count: 0, since: now, lastAttemptAt: 0, retryAt: now };
        note('warn', reason, describeFailure(reason, state.loadErrors[tab.id]?.error), tab.url);
      }
      failure.reason = reason;
      if (now >= failure.retryAt) {
        actions.push({ type: 'reload', tabId: tab.id });
        failure.count++;
        failure.lastAttemptAt = now;
        failure.retryAt = now + BACKOFF_MS[Math.min(failure.count, BACKOFF_MS.length) - 1]!;
        delete state.loadErrors[tab.id];
        delete state.loadingSince[tab.id];
        if (failure.count === FAILING_ALERT_ATTEMPTS) {
          note('error', 'still-failing', `Still failing after ${failure.count} reloads; retrying every 15 min.`, tab.url);
        } else {
          note('info', 'reload', `Reloading (attempt ${failure.count}).`, tab.url);
        }
      }
      state.failures[tab.id] = failure;
      wakes.push(failure.retryAt);
    } else if (!reason && failure && tab.status === 'complete' && now - failure.lastAttemptAt >= RECOVERY_GRACE_MS) {
      delete state.failures[tab.id];
      note('info', 'recovered', `Recovered after ${failure.count} reload${failure.count === 1 ? '' : 's'}.`, tab.url);
    } else if (failure && !reason) {
      wakes.push(failure.lastAttemptAt + RECOVERY_GRACE_MS);
    }
    const since = state.loadingSince[tab.id];
    if (since !== undefined) wakes.push(since + settings.loadTimeoutSec * 1000);
  }

  if (items.length === 0) {
    wakes.push(now + 5_000);
    return done(items);
  }

  const tabOf = (item: Item) => (item.tabId === null ? undefined : tabsById.get(item.tabId));
  const healthy = (item: Item) => {
    const tab = tabOf(item);
    return !!tab && !failureOf(tab) && !state.failures[tab.id]?.count;
  };

  // --- Which item is current? The tab actually in front wins over what we remember. ---
  const active = windowTabs.find((t) => t.active);
  const activeIdx = active ? items.findIndex((i) => i.tabId === active.id) : -1;
  let idx = state.currentKey === null ? -1 : items.findIndex((i) => i.key === state.currentKey);
  const fresh = state.currentKey === null;

  const startSlot = (i: number) => {
    const item = items[i]!;
    state.currentKey = item.key;
    state.position = i;
    state.shownAt = now;
    state.nextSwitchAt = now + item.durationMs;
    state.preloadedFor = null;
    const tab = tabOf(item);
    if (tab && !tab.active) actions.push({ type: 'activate', tabId: tab.id });
  };

  if (fresh) {
    idx = activeIdx >= 0 ? activeIdx : 0;
    startSlot(idx);
    note('info', 'started', `Rotation started with ${items.length} item${items.length === 1 ? '' : 's'}.`);
  } else if (activeIdx >= 0 && activeIdx !== idx) {
    // Someone (or Chrome, after the current tab closed) brought another rotation tab to the front.
    if (idx === -1) note('warn', 'current-closed', 'The tab on screen was closed; continuing from its neighbour.');
    idx = activeIdx;
    startSlot(idx);
  } else if (idx === -1) {
    idx = Math.min(state.position, items.length - 1);
    note('warn', 'current-closed', 'The tab on screen was closed; continuing from its neighbour.');
    startSlot(idx);
  } else if (state.restartSlot) {
    startSlot(idx);
  }
  state.restartSlot = false;
  state.position = idx;

  // A playlist entry whose tab is still being opened: its slot starts once the tab exists.
  if (items[idx]!.tabId === null) {
    state.restartSlot = true;
    wakes.push(now + 1_000);
    return done(items);
  }

  // --- Paused for a human, or our own options page is in front: hold, but keep healing. ---
  if (state.paused && !settings.pauseOnActivity) {
    state.paused = false;
    startSlot(idx);
  }
  const holding = !!active && active.url.startsWith(world.selfOrigin);
  if (state.paused || holding) return done(items);

  // Something that isn't part of the rotation (e.g. a stray tab in playlist mode) is covering the screen.
  const currentTab = tabOf(items[idx]!);
  if (currentTab && !currentTab.active && activeIdx === -1 && !actions.some((a) => a.type === 'activate')) {
    actions.push({ type: 'activate', tabId: currentTab.id });
  }

  // --- Clock moved backwards: don't sit on one tab for an hour. ---
  const current = items[idx]!;
  if (state.nextSwitchAt - now > current.durationMs + 1_000) {
    note('info', 'clock-backwards', 'The system clock moved backwards; restarted the current timer.');
    state.nextSwitchAt = now + current.durationMs;
  }

  // --- Time to switch (or the current item broke)? ---
  const switchAt = state.nextSwitchAt;
  const preloadedKey = state.preloadedFor;
  const eligible = (item: Item, forPreload = false) => {
    const tab = tabOf(item);
    if (!tab || !healthy(item)) return false;
    if (forPreload) return true;
    if (tab.discarded) return false; // reloaded ahead of time below; activating it now would show a spinner
    const preloadedByUs = preloadedKey === `${item.key}@${switchAt}`;
    return !(settings.skipLoading && tab.status === 'loading' && !preloadedByUs);
  };
  const nextEligible = (from: number, forPreload = false) => {
    for (let step = 1; step <= items.length; step++) {
      const i = (from + step) % items.length;
      if (eligible(items[i]!, forPreload)) return i;
    }
    return -1;
  };

  if (now >= switchAt || !healthy(current)) {
    const late = now - switchAt;
    if (!fresh && late > LATE_LOG_MS) {
      note('info', 'late', `Woke ${formatDuration(late)} late (sleep, suspended browser or clock change); continuing.`);
    }
    // Discarded tabs (memory saver) are reloaded in the background and picked up next time round.
    for (const item of items) {
      const tab = tabOf(item);
      if (tab?.discarded && item !== current) actions.push({ type: 'reload', tabId: tab.id });
    }
    const next = nextEligible(idx);
    if (next === -1) {
      // Nothing healthy to show; keep what's there and look again shortly.
      state.nextSwitchAt = now + RETRY_SOON_MS;
    } else {
      idx = next;
      startSlot(idx);
    }
  }

  // --- Reload the upcoming item just before its turn, if configured. ---
  const shown = items[idx]!;
  const upcomingIdx = nextEligible(idx, true);
  const upcoming = upcomingIdx === -1 ? undefined : items[upcomingIdx];
  const upcomingTab = upcoming && tabOf(upcoming);
  if (upcoming && upcomingTab && upcoming.reloadBeforeShow) {
    const preloadAt = state.nextSwitchAt - Math.min(PRELOAD_LEAD_MS, shown.durationMs / 2);
    const key = `${upcoming.key}@${state.nextSwitchAt}`;
    if (state.preloadedFor !== key) {
      if (now >= preloadAt) {
        actions.push({ type: 'reload', tabId: upcomingTab.id });
        state.preloadedFor = key;
      } else {
        wakes.push(preloadAt);
      }
    }
  }

  wakes.push(state.nextSwitchAt);
  return done(items);
}

function windowItems(settings: Settings, windowTabs: TabSnapshot[], selfOrigin: string): Item[] {
  return windowTabs
    .filter((t) => !t.url.startsWith(selfOrigin))
    .map((tab) => {
      const rule = settings.tabRules.find((r) => r.urlPrefix && tab.url.startsWith(r.urlPrefix));
      return {
        key: `tab:${tab.id}`,
        tabId: tab.id,
        url: tab.url,
        durationMs: clampDuration(rule?.durationSec ?? settings.defaultDurationSec) * 1000,
        reloadBeforeShow: rule?.reloadBeforeShow ?? false,
      };
    });
}

function playlistItems(
  state: RotationState,
  settings: Settings,
  windowTabs: TabSnapshot[],
  tabsById: Map<number, TabSnapshot>,
  actions: Action[],
  note: (level: LogLevel, code: string, message: string, url?: string) => void,
): Item[] {
  const entryIds = new Set(settings.playlist.map((e) => e.id));

  // Entries removed from the playlist: close the tabs we opened for them.
  for (const [entryId, tabId] of Object.entries(state.playlistTabs)) {
    if (entryIds.has(entryId)) continue;
    if (tabsById.has(tabId)) actions.push({ type: 'close', tabId });
    delete state.playlistTabs[entryId];
  }

  // Keep mappings whose tab still exists in the rotation window.
  const used = new Set<number>();
  const lost = new Set<string>();
  for (const entry of settings.playlist) {
    const tabId = state.playlistTabs[entry.id];
    if (tabId === undefined) continue;
    if (tabsById.get(tabId)?.windowId === state.windowId && !used.has(tabId)) {
      used.add(tabId);
    } else {
      delete state.playlistTabs[entry.id];
      lost.add(entry.id);
    }
  }

  // Adopt matching tabs (e.g. restored by Chrome after a restart, with new IDs); open the rest.
  for (const entry of settings.playlist) {
    if (state.playlistTabs[entry.id] !== undefined) continue;
    const match = windowTabs.find((t) => !used.has(t.id) && urlMatches(entry.url, t.url));
    if (match) {
      state.playlistTabs[entry.id] = match.id;
      used.add(match.id);
    } else {
      actions.push({ type: 'create', entryId: entry.id, url: entry.url, windowId: state.windowId! });
      if (lost.has(entry.id)) note('warn', 'reopened', 'A playlist tab was closed; reopened it.', entry.url);
    }
  }

  return settings.playlist.map((entry) => ({
    key: `entry:${entry.id}`,
    tabId: state.playlistTabs[entry.id] ?? null,
    url: entry.url,
    durationMs: clampDuration(entry.durationSec ?? settings.defaultDurationSec) * 1000,
    reloadBeforeShow: entry.reloadBeforeShow,
  }));
}

/** A tab belongs to an entry if its URL starts with the entry's (ignoring #fragment and a trailing slash). */
export function urlMatches(entryUrl: string, tabUrl: string): boolean {
  const norm = (u: string) => u.replace(/#.*$/, '').replace(/\/$/, '');
  const entry = norm(entryUrl);
  return entry !== '' && norm(tabUrl).startsWith(entry);
}

function describeFailure(reason: FailureReason, error?: string): string {
  switch (reason) {
    case 'crashed':
      return 'Tab crashed.';
    case 'load-error':
      return `Page failed to load${error ? ` (${error})` : ''}.`;
    case 'load-timeout':
      return 'Page is taking too long to load.';
  }
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
