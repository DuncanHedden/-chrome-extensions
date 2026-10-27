import { clampDuration } from './defaults.ts';
import { fingerprint, matchingDetector } from './detectors.ts';
import { isWithinSchedule } from './schedule.ts';
import type {
  Action,
  Detector,
  FailureReason,
  LogEntry,
  LogLevel,
  PlaylistEntry,
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
  /** Where "reopen" sends the tab: the playlist URL, or the URL a window tab had when it joined. */
  homeUrl: string;
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

/** Retry backoff for a failing tab: 5 s, 15 s, 1 min, 5 min, then every 15 min. */
export const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000, 900_000];
/** How long before a switch the next item is reloaded, at most (and at most half the current item's time). */
export const PRELOAD_LEAD_MS = 15_000;
/** Late by more than this on wake: log it (sleep, suspended Chrome, clock change). */
export const LATE_LOG_MS = 60_000;
export const OFF_HOURS_PAGE = 'offhours/offhours.html';
/** A fixed tab must stay healthy this long before we call it recovered. */
const RECOVERY_GRACE_MS = 3_000;
const RETRY_SOON_MS = 2_000;
const FAILING_ALERT_ATTEMPTS = BACKOFF_MS.length;

type Note = (level: LogLevel, code: string, message: string, url?: string) => void;

/**
 * The rotation engine, as a pure function: given what we stored last time and what Chrome looks like
 * now, decide what should be on screen, what to fix, and when to look again.
 *
 * It runs on every wake (timer, alarm, tab event, Chrome start), so anything that happened in
 * between — the service worker being killed, the laptop sleeping for hours, the clock jumping, a tab
 * being closed or crashing, the playlist being edited, display hours starting — is corrected from
 * facts, not remembered. Running it twice with the same inputs is a no-op the second time.
 *
 * `settings` must already be gated by license (see pro.ts): this function applies whatever it's given.
 */
export function reconcile(prev: RotationState, settings: Settings, world: World): ReconcileResult {
  const { now } = world;
  const state = structuredClone(prev);
  const actions: Action[] = [];
  const log: LogEntry[] = [];
  const wakes: number[] = [];
  const note: Note = (level, code, message, url) => log.push({ at: now, level, code, message, ...(url ? { url } : {}) });
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
  for (const record of [state.failures, state.loadErrors, state.loadingSince, state.fingerprints, state.detectorHits, state.homeUrls]) {
    for (const id of Object.keys(record)) if (!tabsById.has(Number(id))) delete record[Number(id)];
  }
  for (const tab of world.tabs) {
    if (tab.status === 'loading') state.loadingSince[tab.id] ??= now;
    else delete state.loadingSince[tab.id];
  }

  // --- Display hours: switch between the normal rotation and the off-hours content. ---
  const offHours = !isWithinSchedule(settings.schedule, now);
  const transition = offHours !== state.offHours;
  if (transition) {
    state.offHours = offHours;
    state.currentKey = null; // start the other rotation from its first item
    note('info', offHours ? 'schedule-off' : 'schedule-on', offHours ? 'Outside display hours: showing off-hours content.' : 'Display hours started: resuming rotation.');
  }

  // --- Build the item list. ---
  let items: Item[];
  if (offHours) {
    const reserved = new Set(Object.values(state.playlistTabs));
    items = entryItems(offHoursEntries(settings, world.selfOrigin), state.offHoursTabs, 'off', reserved, settings, state, windowTabs, tabsById, actions, note);
  } else {
    // Off-hours tabs we opened are closed once display hours start.
    const closing = new Set(Object.values(state.offHoursTabs).filter((id) => tabsById.has(id)));
    for (const tabId of closing) actions.push({ type: 'close', tabId });
    state.offHoursTabs = {};
    items =
      settings.source === 'window'
        ? windowItems(settings, state, windowTabs.filter((t) => !closing.has(t.id)), world.selfOrigin)
        : entryItems(settings.playlist, state.playlistTabs, 'entry', new Set(), settings, state, windowTabs, tabsById, actions, note);
  }
  if (actions.some((a) => a.type === 'create')) wakes.push(now + 1_000);

  // --- Health: built-in failures (crash, load error, hang) and user-defined detectors. ---
  const failureOf = (tab: TabSnapshot): FailureReason | null => {
    if (tab.status === 'unloaded' && !tab.discarded) return 'crashed';
    if (state.loadErrors[tab.id]) return 'load-error';
    const since = state.loadingSince[tab.id];
    if (since !== undefined && now - since >= settings.loadTimeoutSec * 1000) return 'load-timeout';
    return null;
  };
  const blocked = new Set<number>();
  for (const item of items) {
    const tab = item.tabId === null ? undefined : tabsById.get(item.tabId);
    if (!tab) continue;

    // Track "unchanged since" for stuck-page detection. Loading counts as a change.
    const print = fingerprint(tab, world.contentHashes[tab.id]);
    const previous = state.fingerprints[tab.id];
    const changed = !previous || previous.hash !== print || tab.status !== 'complete';
    if (changed) state.fingerprints[tab.id] = { hash: print, since: now };

    const builtin = failureOf(tab);
    const detector = builtin ? null : matchingDetector(settings.detectors, tab, state.fingerprints[tab.id]!.since, now);
    trackDetectorHit(state, tab, detector, settings.detectors, note);

    if (detector?.kind === 'unchanged' && (detector.action === 'reload' || detector.action === 'reopen')) {
      // Stuck page: a one-off refresh, then the clock starts again. Not a failure; no backoff.
      actions.push(fixFor(detector, tab, item));
      state.fingerprints[tab.id] = { hash: print, since: now };
      delete state.detectorHits[tab.id];
      note('info', 'refresh', `${detector.action === 'reopen' ? 'Reopening' : 'Reloading'}: nothing changed for ${detector.minutes} min.`, tab.url);
      continue;
    }
    // (Stuck-page timing needs no wake of its own: minute-scale, and the 30 s watchdog re-checks.)

    if (detector?.action === 'skip') blocked.add(tab.id);
    const fixing = detector && (detector.action === 'reload' || detector.action === 'reopen') ? detector : null;
    const reason: FailureReason | null = builtin ?? (fixing ? 'detector' : null);
    let failure = state.failures[tab.id];

    if (reason && (reason === 'detector' || settings.selfHeal)) {
      blocked.add(tab.id);
      if (!failure) {
        failure = { reason, count: 0, since: now, lastAttemptAt: 0, retryAt: now };
        if (reason !== 'detector') note('warn', reason, describeFailure(reason, state.loadErrors[tab.id]?.error), tab.url);
      }
      failure.reason = reason;
      if (fixing) failure.detectorId = fixing.id;
      else delete failure.detectorId;
      if (now >= failure.retryAt) {
        actions.push(fixing ? fixFor(fixing, tab, item) : { type: 'reload', tabId: tab.id });
        failure.count++;
        failure.lastAttemptAt = now;
        failure.retryAt = now + BACKOFF_MS[Math.min(failure.count, BACKOFF_MS.length) - 1]!;
        delete state.loadErrors[tab.id];
        delete state.loadingSince[tab.id];
        const verb = fixing?.action === 'reopen' ? 'Reopening' : 'Reloading';
        if (failure.count === FAILING_ALERT_ATTEMPTS) {
          note('error', 'still-failing', `Still failing after ${failure.count} attempts; retrying every 15 min.`, tab.url);
        } else {
          note('info', fixing?.action === 'reopen' ? 'reopen' : 'reload', `${verb} (attempt ${failure.count}).`, tab.url);
        }
      }
      state.failures[tab.id] = failure;
      wakes.push(failure.retryAt);
    } else if (reason) {
      blocked.add(tab.id); // self-healing off: skip it, leave it alone
    } else if (failure && tab.status === 'complete' && now - failure.lastAttemptAt >= RECOVERY_GRACE_MS) {
      delete state.failures[tab.id];
      note('info', 'recovered', `Recovered after ${failure.count} attempt${failure.count === 1 ? '' : 's'}.`, tab.url);
    } else if (failure) {
      blocked.add(tab.id);
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
    return !!tab && !blocked.has(tab.id);
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
    if (!transition) note('info', 'started', `Rotation started with ${items.length} item${items.length === 1 ? '' : 's'}.`);
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

  // --- Paused for a human, or someone is using the (unlocked) settings page: hold, but keep healing. ---
  if (state.paused && !settings.pauseOnActivity) {
    state.paused = false;
    startSlot(idx);
  }
  const optionsPage = `${world.selfOrigin}options/`;
  const holding = !!active && active.url.startsWith(optionsPage) && (!settings.lock.enabled || active.url.includes('#unlocked'));
  if (state.paused || holding) return done(items);

  // Something that isn't part of the rotation (a stray tab, a locked settings page) is covering the screen.
  const currentTab = tabOf(items[idx]!);
  if (currentTab && !currentTab.active && activeIdx === -1 && !actions.some((a) => a.type === 'activate')) {
    actions.push({ type: 'activate', tabId: currentTab.id });
  }

  // --- Clock moved backwards (the slot "started" in the future): don't sit on one tab for an hour. ---
  const current = items[idx]!;
  if (state.shownAt > now + 1_000) {
    note('info', 'clock-backwards', 'The system clock moved backwards; restarted the current timer.');
    state.shownAt = now;
    state.nextSwitchAt = now + current.durationMs;
  }
  // Duration shortened while this item is on screen: the new duration applies now.
  state.nextSwitchAt = Math.min(state.nextSwitchAt, state.shownAt + current.durationMs);

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

  // Display hours are checked on every wake; the 30 s watchdog guarantees one at least that often.
  wakes.push(state.nextSwitchAt);
  return done(items);
}

function fixFor(detector: Detector, tab: TabSnapshot, item: Item): Action {
  return detector.action === 'reopen' && item.homeUrl
    ? { type: 'navigate', tabId: tab.id, url: item.homeUrl }
    : { type: 'reload', tabId: tab.id };
}

/** Log when a tab starts or stops matching a detector (once each, not on every wake). */
function trackDetectorHit(state: RotationState, tab: TabSnapshot, detector: Detector | null, all: readonly Detector[], note: Note) {
  const previous = state.detectorHits[tab.id];
  if (detector && previous !== detector.id) {
    state.detectorHits[tab.id] = detector.id;
    const consequence = { reload: 'reloading', reopen: 'reopening', skip: 'skipping it', alert: 'alerting' }[detector.action];
    note(detector.action === 'alert' ? 'error' : 'warn', 'detector', `Bad state "${detector.name}" detected; ${consequence}.`, tab.url);
  } else if (!detector && previous) {
    delete state.detectorHits[tab.id];
    const name = all.find((d) => d.id === previous)?.name ?? 'a removed detector';
    note('info', 'detector-cleared', `No longer matches "${name}".`, tab.url);
  }
}

function offHoursEntries(settings: Settings, selfOrigin: string): PlaylistEntry[] {
  const { offHours } = settings.schedule;
  const blank: PlaylistEntry = { id: 'blank', url: `${selfOrigin}${OFF_HOURS_PAGE}`, durationSec: null, reloadBeforeShow: false };
  if (offHours.kind === 'page' && offHours.url.trim()) {
    return [{ id: 'page', url: offHours.url.trim(), durationSec: null, reloadBeforeShow: false }];
  }
  if (offHours.kind === 'playlist' && offHours.entries.length) return offHours.entries;
  return [blank];
}

function windowItems(settings: Settings, state: RotationState, windowTabs: TabSnapshot[], selfOrigin: string): Item[] {
  return windowTabs
    .filter((t) => !t.url.startsWith(selfOrigin))
    .map((tab) => {
      const rule = settings.tabRules.find((r) => r.urlPrefix && tab.url.startsWith(r.urlPrefix));
      if (tab.status === 'complete') state.homeUrls[tab.id] ??= tab.url;
      return {
        key: `tab:${tab.id}`,
        tabId: tab.id,
        url: tab.url,
        homeUrl: state.homeUrls[tab.id] ?? tab.url,
        durationMs: clampDuration(rule?.durationSec ?? settings.defaultDurationSec) * 1000,
        reloadBeforeShow: rule?.reloadBeforeShow ?? false,
      };
    });
}

/**
 * Items for a list of URL entries the extension owns (the playlist, or off-hours content): keeps the
 * entry -> tab mapping in `mapping` up to date, adopting matching tabs and opening missing ones.
 * Tabs in `reserved` belong to another list and are never adopted.
 */
function entryItems(
  entries: readonly PlaylistEntry[],
  mapping: Record<string, number>,
  keyPrefix: string,
  reserved: Set<number>,
  settings: Settings,
  state: RotationState,
  windowTabs: TabSnapshot[],
  tabsById: Map<number, TabSnapshot>,
  actions: Action[],
  note: Note,
): Item[] {
  const entryIds = new Set(entries.map((e) => e.id));

  // Entries removed from the list: close the tabs we opened for them.
  for (const [entryId, tabId] of Object.entries(mapping)) {
    if (entryIds.has(entryId)) continue;
    if (tabsById.has(tabId)) actions.push({ type: 'close', tabId });
    delete mapping[entryId];
  }

  // Keep mappings whose tab still exists in the rotation window.
  const used = new Set<number>(reserved);
  const lost = new Set<string>();
  for (const entry of entries) {
    const tabId = mapping[entry.id];
    if (tabId === undefined) continue;
    if (tabsById.get(tabId)?.windowId === state.windowId && !used.has(tabId)) {
      used.add(tabId);
    } else {
      delete mapping[entry.id];
      lost.add(entry.id);
    }
  }

  // Adopt matching tabs (e.g. restored by Chrome after a restart, with new IDs); open the rest.
  for (const entry of entries) {
    if (mapping[entry.id] !== undefined) continue;
    const match = windowTabs.find((t) => !used.has(t.id) && urlMatches(entry.url, t.url));
    if (match) {
      mapping[entry.id] = match.id;
      used.add(match.id);
    } else {
      actions.push({ type: 'create', list: keyPrefix === 'off' ? 'offHours' : 'playlist', entryId: entry.id, url: entry.url, windowId: state.windowId! });
      if (lost.has(entry.id)) note('warn', 'reopened', 'A playlist tab was closed; reopened it.', entry.url);
    }
  }

  return entries.map((entry) => ({
    key: `${keyPrefix}:${entry.id}`,
    tabId: mapping[entry.id] ?? null,
    url: entry.url,
    homeUrl: entry.url,
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
    case 'detector':
      return 'Bad state detected.';
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
