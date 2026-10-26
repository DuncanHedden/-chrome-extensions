import { createStore } from '@ext/shared/storage';
import type { Flags } from './pattern.ts';

export interface Settings extends Flags {
  matchColor: string;
  currentColor: string;
  rememberHistory: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  caseInsensitive: true,
  multiline: false,
  wholeWord: false,
  matchColor: '#ffeb3b',
  currentColor: '#ff9632',
  rememberHistory: true,
};

export const HISTORY_LIMIT = 20;

/** Synced across the user's Chrome profiles; small and non-sensitive. */
export const settingsStore = createStore('sync', 'settings', DEFAULT_SETTINGS);
/** Patterns can contain anything the user typed, so they stay on this device only. */
export const historyStore = createStore<{ patterns: string[] }>('local', 'history', { patterns: [] });

export function pushHistory(patterns: readonly string[], pattern: string, limit = HISTORY_LIMIT): string[] {
  return [pattern, ...patterns.filter((p) => p !== pattern)].slice(0, limit);
}

/** Guards CSS we build from stored values: only #rrggbb gets through. */
export function safeColor(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export const DONATE_URL = 'https://buymeacoffee.com/YOUR_HANDLE';
