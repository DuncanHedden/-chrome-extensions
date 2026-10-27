import { createStore } from '@ext/shared/storage';
import { verifyPin, createLock } from '../lock.ts';
import { settingsStore } from '../engine/stores.ts';
import type { LogEntry, Settings } from '../engine/types.ts';
import { formatErrors, parseConfig, sectionFor, toSettings, type AppliedConfig } from './config.ts';

export interface FleetStatus {
  lastFetchAt: number;
  lastAppliedAt: number;
  /** Hash of the last config text applied, so an unchanged file is a no-op. */
  appliedHash: string;
  etag: string;
  lastError: string;
  /** Last config text that passed validation; kept when a newer one is rejected. */
  lastGoodText: string;
  /** Whether this screen had its own section in the last good config. */
  screenFound: boolean;
}

export const fleetStatusStore = createStore<FleetStatus>('local', 'fleetStatus', {
  lastFetchAt: 0, lastAppliedAt: 0, appliedHash: '', etag: '', lastError: '', lastGoodText: '', screenFound: false,
});
export const FLEET_ALARM = 'fleet';

const entry = (level: LogEntry['level'], code: string, message: string, url?: string): LogEntry => ({ at: Date.now(), level, code, message, ...(url ? { url } : {}) });

async function sha(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ApplyHooks {
  activateLicense(key: string): Promise<LogEntry[]>;
  setRotation(running: boolean): Promise<void>;
}

/**
 * Validate and apply config text for this screen. Invalid config is rejected and the last good one
 * stays in effect. Returns log entries (a rejection is an error, so it also alerts).
 */
export async function applyConfigText(text: string, source: string, hooks: ApplyHooks, force = false, licenseOnly = false): Promise<LogEntry[]> {
  const status = await fleetStatusStore.get();
  const parsed = parseConfig(text);
  if (!parsed.ok) {
    const message = `Config rejected (keeping the last good one): ${formatErrors(parsed.errors)}`;
    const changed = status.lastError !== message;
    await fleetStatusStore.set({ lastError: message });
    // Log once per distinct problem, not on every poll.
    return changed ? [entry('error', 'config-rejected', message, source)] : [];
  }
  const hash = await sha(text);
  if (!force && hash === status.appliedHash) {
    await fleetStatusStore.set({ lastError: '' });
    return [];
  }

  const settings = await settingsStore.get();
  const { section, found } = sectionFor(parsed.config, settings.screenName);
  const applied = toSettings(section, settings);
  const log: LogEntry[] = [];
  if (licenseOnly) {
    // Not Pro yet: the only thing a free screen takes from the file is its license key.
    await fleetStatusStore.set({ lastError: applied.licenseKey ? '' : 'Fleet config needs Pro: add a "license" key to the file, or activate one in Settings.' });
    return applied.licenseKey ? hooks.activateLicense(applied.licenseKey) : [];
  }
  await settingsStore.set(await withLock(applied, settings));
  if (applied.licenseKey) log.push(...(await hooks.activateLicense(applied.licenseKey)));
  if (applied.rotation) await hooks.setRotation(applied.rotation === 'running');

  await fleetStatusStore.set({ appliedHash: hash, lastAppliedAt: Date.now(), lastError: '', lastGoodText: text, screenFound: found });
  log.push(entry('info', 'config-applied', found
    ? `Applied fleet config for "${settings.screenName}".`
    : `Applied fleet config defaults; no section for "${settings.screenName || '(no screen name)'}".`, source));
  return log;
}

async function withLock(applied: AppliedConfig, settings: Settings): Promise<Partial<Settings>> {
  if (applied.lockPin === undefined) return applied.patch;
  if (applied.lockPin === null) return { ...applied.patch, lock: { enabled: false, salt: '', hash: '' } };
  // Same PIN as now: keep the existing hash rather than re-salting on every poll.
  if (settings.lock.enabled && (await verifyPin(settings.lock, applied.lockPin))) return applied.patch;
  return { ...applied.patch, lock: await createLock(applied.lockPin) };
}

/** Fetch the config URL (conditional GET) and apply it. Network problems keep the current config. */
export async function poll(settings: Settings, hooks: ApplyHooks, force = false, licenseOnly = false): Promise<LogEntry[]> {
  const { configUrl, authHeader } = settings.fleet;
  if (!configUrl) return [];
  const status = await fleetStatusStore.get();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (authHeader) headers.Authorization = authHeader;
  if (status.etag && !force) headers['If-None-Match'] = status.etag;
  try {
    const resp = await fetch(configUrl, { headers, cache: 'no-cache', signal: AbortSignal.timeout(15_000) });
    await fleetStatusStore.set({ lastFetchAt: Date.now() });
    if (resp.status === 304) return [];
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    await fleetStatusStore.set({ etag: resp.headers.get('ETag') ?? '' });
    return await applyConfigText(await resp.text(), configUrl, hooks, force || licenseOnly, licenseOnly);
  } catch (error) {
    const message = `Couldn't fetch fleet config (${error instanceof Error ? error.message : String(error)}); keeping the current settings.`;
    const changed = status.lastError !== message;
    await fleetStatusStore.set({ lastError: message, lastFetchAt: Date.now() });
    return changed ? [entry('warn', 'config-fetch-failed', message, configUrl)] : [];
  }
}

export async function scheduleFleetPoll(settings: Settings) {
  if (!settings.fleet.configUrl) {
    await chrome.alarms.clear(FLEET_ALARM);
    return;
  }
  const period = Math.max(1, settings.fleet.pollMinutes);
  const existing = await chrome.alarms.get(FLEET_ALARM);
  if (existing?.periodInMinutes !== period) await chrome.alarms.create(FLEET_ALARM, { periodInMinutes: period, delayInMinutes: 0.1 });
}
