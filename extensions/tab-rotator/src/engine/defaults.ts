import type { RotationState, Settings } from './types.ts';

export const DEFAULT_SETTINGS: Settings = {
  source: 'window',
  defaultDurationSec: 30,
  playlist: [],
  tabRules: [],
  skipLoading: true,
  selfHeal: true,
  loadTimeoutSec: 60,
  pauseOnActivity: true,
  resumeAfterIdleSec: 60,
  autoStart: false,
  detectors: [],
  schedule: {
    enabled: false,
    windows: [{ id: 'weekdays', days: [1, 2, 3, 4, 5], start: '07:00', end: '18:00' }],
    timeZone: '',
    offHours: { kind: 'blank', url: '', entries: [] },
  },
  lock: { enabled: false, salt: '', hash: '' },
};

export const INITIAL_STATE: RotationState = {
  running: false,
  paused: false,
  windowId: null,
  currentKey: null,
  position: 0,
  shownAt: 0,
  nextSwitchAt: 0,
  restartSlot: false,
  preloadedFor: null,
  playlistTabs: {},
  failures: {},
  loadErrors: {},
  loadingSince: {},
  offHours: false,
  offHoursTabs: {},
  fingerprints: {},
  detectorHits: {},
  homeUrls: {},
};

export const MIN_DURATION_SEC = 2;
export const MAX_DURATION_SEC = 24 * 60 * 60;
export const MIN_IDLE_SEC = 15;

export const clampDuration = (sec: number) =>
  Math.min(MAX_DURATION_SEC, Math.max(MIN_DURATION_SEC, Number.isFinite(sec) ? sec : DEFAULT_SETTINGS.defaultDurationSec));
