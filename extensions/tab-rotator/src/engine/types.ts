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
}

export type FailureReason = 'crashed' | 'load-error' | 'load-timeout';

export interface TabFailure {
  reason: FailureReason;
  /** Reload attempts so far. */
  count: number;
  since: number;
  lastAttemptAt: number;
  retryAt: number;
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
}

export interface TabSnapshot {
  id: number;
  windowId: number;
  index: number;
  url: string;
  status: string | undefined;
  active: boolean;
  discarded: boolean;
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
}

export type Action =
  | { type: 'activate'; tabId: number }
  | { type: 'reload'; tabId: number }
  | { type: 'create'; entryId: string; url: string; windowId: number }
  | { type: 'close'; tabId: number };

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  at: number;
  level: LogLevel;
  code: string;
  message: string;
  url?: string;
}
