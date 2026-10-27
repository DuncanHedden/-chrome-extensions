/** Per-item display settings shared by playlist entries and window-mode URL rules. */
export interface DisplaySettings {
  /** Seconds to show this item; null = use the default. */
  durationSec: number | null;
  /** Reload the tab shortly before it is shown, so it appears fresh. */
  reloadBeforeShow: boolean;
}

export interface PlaylistEntry extends DisplaySettings {
  id: string;
  url: string;
}

/** Window mode: settings for tabs whose URL starts with `urlPrefix`. First match wins. */
export interface TabRule extends DisplaySettings {
  id: string;
  urlPrefix: string;
}

export type DetectorKind = 'url' | 'title' | 'unchanged';
export type DetectorAction = 'reload' | 'reopen' | 'skip' | 'alert';

/** A user-defined "this screen is in a bad state" rule (Pro). */
export interface Detector {
  id: string;
  name: string;
  enabled: boolean;
  kind: DetectorKind;
  /** For url/title: case-insensitive text, or /regex/flags. */
  pattern: string;
  /** For unchanged: minutes without any change before it counts as stuck. */
  minutes: number;
  /** For unchanged: also hash the page text (needs the optional host permission for that site). */
  checkContent: boolean;
  /** Only tabs whose URL starts with this; empty = every rotated tab. */
  appliesTo: string;
  action: DetectorAction;
}

export interface ScheduleWindow {
  id: string;
  /** 0 = Sunday … 6 = Saturday. A window that crosses midnight belongs to the day it starts. */
  days: number[];
  /** "HH:MM", 24-hour wall clock. end <= start means it runs past midnight; end == start means all day. */
  start: string;
  end: string;
}

export interface OffHours {
  kind: 'blank' | 'page' | 'playlist';
  url: string;
  entries: PlaylistEntry[];
}

/** Display hours (Pro). Outside them, show `offHours` instead of the normal rotation. */
export interface Schedule {
  enabled: boolean;
  windows: ScheduleWindow[];
  /** IANA zone like "Europe/London"; empty = this computer's zone. */
  timeZone: string;
  offHours: OffHours;
}

/** PIN lock for settings and start/stop (Pro). A deterrent for passers-by, not a security boundary. */
export interface LockSettings {
  enabled: boolean;
  salt: string;
  hash: string;
}

export interface Settings {
  /** Rotate whatever tabs are in the window, or a playlist of URLs the extension opens and owns. */
  source: 'window' | 'playlist';
  defaultDurationSec: number;
  playlist: PlaylistEntry[];
  tabRules: TabRule[];
  skipLoading: boolean;
  selfHeal: boolean;
  loadTimeoutSec: number;
  pauseOnActivity: boolean;
  /** Resume after this many seconds without input. chrome.idle's minimum is 15. */
  resumeAfterIdleSec: number;
  autoStart: boolean;
  detectors: Detector[];
  schedule: Schedule;
  lock: LockSettings;
}

export type FailureReason = 'crashed' | 'load-error' | 'load-timeout' | 'detector';

export interface TabFailure {
  reason: FailureReason;
  /** Reload attempts so far. */
  count: number;
  since: number;
  lastAttemptAt: number;
  retryAt: number;
  /** For detector failures: which detector, and how it fixes things. */
  detectorId?: string;
}

/**
 * Everything the rotation engine knows, persisted in chrome.storage.local after every step.
 * The service worker holds nothing in memory between wakes. Timestamps are epoch ms.
 * Tab-keyed records use numeric tab IDs as (string) object keys.
 */
export interface RotationState {
  running: boolean;
  /** Paused because someone is using the machine (idle API). */
  paused: boolean;
  windowId: number | null;
  /** Key of the item on screen; null means "just started, pick one". */
  currentKey: string | null;
  /** Index of the current item, used to pick a neighbour if it disappears. */
  position: number;
  shownAt: number;
  nextSwitchAt: number;
  /** Restart the current item's timer on the next reconcile (e.g. after resuming from pause). */
  restartSlot: boolean;
  /** `${itemKey}@${switchAt}` once the upcoming item has been reloaded for that switch. */
  preloadedFor: string | null;
  /** Playlist entry id -> the tab we opened or adopted for it. */
  playlistTabs: Record<string, number>;
  failures: Record<number, TabFailure>;
  /** Main-frame load errors reported by webNavigation, cleared on the next successful load. */
  loadErrors: Record<number, { error: string; at: number }>;
  /** When each tab was first seen loading, to detect loads that hang. */
  loadingSince: Record<number, number>;
  /** Currently outside scheduled display hours. */
  offHours: boolean;
  /** Off-hours entry id -> tab we opened for it. Closed again when display hours start. */
  offHoursTabs: Record<string, number>;
  /** Last observed fingerprint of each tab, and since when it has been unchanged. */
  fingerprints: Record<number, { hash: string; since: number }>;
  /** Detector currently matching each tab, so enter/leave is logged once. */
  detectorHits: Record<number, string>;
  /** Window mode: the URL each tab had when it joined the rotation, for "reopen". */
  homeUrls: Record<number, string>;
}

export interface TabSnapshot {
  id: number;
  windowId: number;
  index: number;
  url: string;
  status: string | undefined;
  active: boolean;
  discarded: boolean;
  title: string;
  favIconUrl: string;
}

export interface WindowSnapshot {
  id: number;
  focused: boolean;
}

/** What Chrome looks like right now. Only normal browser windows are included. */
export interface World {
  now: number;
  windows: WindowSnapshot[];
  tabs: TabSnapshot[];
  /** chrome-extension://<id>/ — our own pages are never rotated. */
  selfOrigin: string;
  /** Page-text hashes for tabs where a content check is enabled and permitted. */
  contentHashes: Record<number, string>;
}

export type Action =
  | { type: 'activate'; tabId: number }
  | { type: 'reload'; tabId: number }
  | { type: 'create'; list: 'playlist' | 'offHours'; entryId: string; url: string; windowId: number }
  | { type: 'close'; tabId: number }
  | { type: 'navigate'; tabId: number; url: string };

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  at: number;
  level: LogLevel;
  code: string;
  message: string;
  url?: string;
}
