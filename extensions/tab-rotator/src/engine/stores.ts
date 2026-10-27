import { createStore } from '@ext/shared/storage';
import { DEFAULT_SETTINGS, INITIAL_STATE } from './defaults.ts';
import type { LogEntry } from './types.ts';

// storage.local, not sync: screens often share one Google account, and sync would give every TV in the
// building the same playlist.
export const settingsStore = createStore('local', 'settings', DEFAULT_SETTINGS);
export const stateStore = createStore('local', 'rotationState', INITIAL_STATE);
export const logStore = createStore<{ entries: LogEntry[] }>('local', 'healthLog', { entries: [] });

export const LOG_LIMIT = 2000;

export async function appendLog(entries: LogEntry[]) {
  if (!entries.length) return;
  const { entries: existing } = await logStore.get();
  await logStore.set({ entries: [...existing, ...entries].slice(-LOG_LIMIT) });
}
