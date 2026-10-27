import { validate, type JsonSchema, type SchemaError } from '@ext/shared/json-schema';
import schemaJson from '@ext/shared/schemas/tab-rotator-config.schema.json';
import { DEFAULT_SETTINGS } from '../engine/defaults.ts';
import type { AlertSettings, Detector, PlaylistEntry, Schedule, Settings, TabRule } from '../engine/types.ts';

export const CONFIG_SCHEMA = schemaJson as JsonSchema;
export const SCHEMA_URL = CONFIG_SCHEMA.$id as string;

type Entry = { url: string; durationSec?: number | null; reloadBeforeShow?: boolean };
type Rule = { urlPrefix: string; durationSec?: number | null; reloadBeforeShow?: boolean };

/** One screen's section of the config file (also the shape of `defaults`). Mirrors the JSON Schema. */
export interface ScreenConfig {
  rotation?: 'running' | 'stopped';
  source?: Settings['source'];
  defaultDurationSec?: number;
  playlist?: Entry[];
  tabRules?: Rule[];
  skipLoading?: boolean;
  selfHeal?: boolean;
  loadTimeoutSec?: number;
  pauseOnActivity?: boolean;
  resumeAfterIdleSec?: number;
  autoStart?: boolean;
  detectors?: Array<Omit<Detector, 'id' | 'enabled' | 'pattern' | 'minutes' | 'checkContent' | 'appliesTo'> & Partial<Detector>>;
  schedule?: { enabled?: boolean; timeZone?: string; windows?: Array<{ days: number[]; start: string; end: string }>; offHours?: { kind?: Schedule['offHours']['kind']; url?: string; playlist?: Entry[] } };
  alerts?: Partial<AlertSettings>;
  lock?: { enabled?: boolean; pin?: string };
  license?: { key: string };
  pollMinutes?: number;
}

export interface FleetConfig {
  version: 1;
  defaults?: ScreenConfig;
  screens?: Record<string, ScreenConfig>;
}

export type ParseResult = { ok: true; config: FleetConfig } | { ok: false; errors: SchemaError[] };

/** JSON text -> validated config. Never throws. */
export function parseConfig(text: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [{ path: '/', message: `not valid JSON: ${error instanceof Error ? error.message : String(error)}` }] };
  }
  const errors = validate(CONFIG_SCHEMA, value);
  return errors.length ? { ok: false, errors } : { ok: true, config: value as FleetConfig };
}

export const formatErrors = (errors: SchemaError[]) => errors.map((e) => `${e.path}: ${e.message}`).join('; ');

/** Objects merge recursively; arrays and scalars from `over` replace. */
export function deepMerge<T>(base: T, over: unknown): T {
  if (over === undefined) return base;
  if (typeof base !== 'object' || base === null || Array.isArray(base) || typeof over !== 'object' || over === null || Array.isArray(over)) {
    return over as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(out[k], v);
  return out as T;
}

/** `defaults` + this screen's section. `found` is false if the screen has no section of its own. */
export function sectionFor(config: FleetConfig, screenName: string): { section: ScreenConfig; found: boolean } {
  const own = screenName ? config.screens?.[screenName] : undefined;
  return { section: deepMerge(config.defaults ?? {}, own ?? {}), found: own !== undefined };
}

/** Stable IDs for config entries, so editing the file doesn't make every screen reopen every tab. */
function stableIds<T>(items: T[], keyOf: (item: T) => string, prefix: string): string[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const key = keyOf(item);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    let h = 5381;
    for (let i = 0; i < key.length; i++) h = (Math.imul(h, 33) ^ key.charCodeAt(i)) >>> 0;
    return `${prefix}-${h.toString(36)}-${n}`;
  });
}

const toEntries = (entries: Entry[], prefix: string): PlaylistEntry[] => {
  const ids = stableIds(entries, (e) => e.url, prefix);
  return entries.map((e, i) => ({ id: ids[i]!, url: e.url, durationSec: e.durationSec ?? null, reloadBeforeShow: e.reloadBeforeShow ?? false }));
};

export interface AppliedConfig {
  /** Settings fields the config manages. Anything absent stays as set locally. */
  patch: Partial<Settings>;
  /** PIN to (re)lock with; null = remove the lock; undefined = leave the lock alone. */
  lockPin?: string | null;
  licenseKey?: string;
  rotation?: 'running' | 'stopped';
}

/** Pure: a screen section -> what to change on this screen. */
export function toSettings(section: ScreenConfig, current: Settings): AppliedConfig {
  const patch: Partial<Settings> = {};
  const simple = ['source', 'defaultDurationSec', 'skipLoading', 'selfHeal', 'loadTimeoutSec', 'pauseOnActivity', 'resumeAfterIdleSec', 'autoStart'] as const;
  for (const key of simple) if (section[key] !== undefined) (patch as Record<string, unknown>)[key] = section[key];

  if (section.playlist) patch.playlist = toEntries(section.playlist, 'cfg');
  if (section.tabRules) {
    const ids = stableIds(section.tabRules, (r) => r.urlPrefix, 'rule');
    patch.tabRules = section.tabRules.map((r, i): TabRule => ({ id: ids[i]!, urlPrefix: r.urlPrefix, durationSec: r.durationSec ?? null, reloadBeforeShow: r.reloadBeforeShow ?? false }));
  }
  if (section.detectors) {
    const ids = stableIds(section.detectors, (d) => d.name, 'det');
    patch.detectors = section.detectors.map((d, i): Detector => ({
      id: ids[i]!, name: d.name, enabled: d.enabled ?? true, kind: d.kind, pattern: d.pattern ?? '', minutes: d.minutes ?? 30,
      checkContent: d.checkContent ?? false, appliesTo: d.appliesTo ?? '', action: d.action,
    }));
  }
  if (section.schedule) {
    const s = section.schedule;
    const base = current.schedule ?? DEFAULT_SETTINGS.schedule;
    patch.schedule = {
      enabled: s.enabled ?? base.enabled,
      timeZone: s.timeZone ?? base.timeZone,
      windows: s.windows ? s.windows.map((w, i) => ({ id: `cfg-${i}`, ...w })) : base.windows,
      offHours: {
        kind: s.offHours?.kind ?? base.offHours.kind,
        url: s.offHours?.url ?? base.offHours.url,
        entries: s.offHours?.playlist ? toEntries(s.offHours.playlist, 'off') : base.offHours.entries,
      },
    };
  }
  if (section.alerts) patch.alerts = { ...current.alerts, ...section.alerts };
  if (section.pollMinutes !== undefined) patch.fleet = { ...current.fleet, pollMinutes: section.pollMinutes };

  const result: AppliedConfig = { patch };
  if (section.lock) result.lockPin = section.lock.enabled === false ? null : section.lock.pin;
  if (section.license) result.licenseKey = section.license.key;
  if (section.rotation) result.rotation = section.rotation;
  return result;
}

/** This screen's current settings, written out as a config file (for export, or to seed a fleet file). */
export function exportConfig(settings: Settings, running: boolean): FleetConfig & { $schema: string } {
  const entry = (e: PlaylistEntry) => ({ url: e.url, ...(e.durationSec !== null ? { durationSec: e.durationSec } : {}), ...(e.reloadBeforeShow ? { reloadBeforeShow: true } : {}) });
  const section: ScreenConfig = {
    rotation: running ? 'running' : 'stopped',
    source: settings.source,
    defaultDurationSec: settings.defaultDurationSec,
    playlist: settings.playlist.filter((e) => e.url).map(entry),
    tabRules: settings.tabRules.filter((r) => r.urlPrefix).map((r) => ({ urlPrefix: r.urlPrefix, durationSec: r.durationSec, reloadBeforeShow: r.reloadBeforeShow })),
    skipLoading: settings.skipLoading,
    selfHeal: settings.selfHeal,
    loadTimeoutSec: settings.loadTimeoutSec,
    pauseOnActivity: settings.pauseOnActivity,
    resumeAfterIdleSec: settings.resumeAfterIdleSec,
    autoStart: settings.autoStart,
    detectors: settings.detectors.map(({ id: _id, ...d }) => d),
    schedule: {
      enabled: settings.schedule.enabled,
      timeZone: settings.schedule.timeZone,
      windows: settings.schedule.windows.map(({ id: _id, ...w }) => w),
      offHours: { kind: settings.schedule.offHours.kind, url: settings.schedule.offHours.url, playlist: settings.schedule.offHours.entries.filter((e) => e.url).map(entry) },
    },
    alerts: settings.alerts,
  };
  const name = settings.screenName || 'This-Screen';
  return { $schema: SCHEMA_URL, version: 1, defaults: {}, screens: { [name]: section } };
}
