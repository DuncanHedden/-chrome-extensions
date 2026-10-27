import { describe, expect, it } from 'vitest';
import { validate } from '@ext/shared/json-schema';
import { DEFAULT_SETTINGS } from '../src/engine/defaults.ts';
import { CONFIG_SCHEMA, deepMerge, exportConfig, parseConfig, sectionFor, toSettings, type FleetConfig } from '../src/fleet/config.ts';
import exampleJson from '../../../docs/examples/screens.json';

const example = JSON.stringify(exampleJson);

describe('parseConfig', () => {
  it('accepts the documented 3-screen example', () => {
    const result = parseConfig(example);
    expect(result.ok ? Object.keys(result.config.screens ?? {}) : result.errors).toEqual(['NOC-Wall-1', 'NOC-Wall-2', 'Lobby-1']);
  });

  it('rejects broken JSON and schema violations with useful paths, never throwing', () => {
    expect(parseConfig('{ "version": 1, ')).toMatchObject({ ok: false, errors: [{ path: '/', message: expect.stringMatching(/not valid JSON/) }] });
    const bad = parseConfig(JSON.stringify({
      version: 1,
      screens: { 'NOC-Wall-1': { defaultDurationSec: 1, playlist: [{ url: 'grafana' }], detectors: [{ name: 'x', kind: 'title', action: 'explode' }] } },
    }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.map((e) => e.path)).toEqual([
        '/screens/NOC-Wall-1/defaultDurationSec',
        '/screens/NOC-Wall-1/playlist/0/url',
        '/screens/NOC-Wall-1/detectors/0/action',
      ]);
    }
    expect(parseConfig(JSON.stringify({ version: 1, screens: { '../evil': {} } })).ok).toBe(false);
    expect(parseConfig(JSON.stringify({ version: 1, defaults: { surprise: true } })).ok).toBe(false);
  });
});

describe('merging defaults with a screen section', () => {
  it('objects merge, arrays and scalars replace', () => {
    expect(deepMerge({ a: 1, o: { x: 1, y: 2 }, l: [1, 2] }, { o: { y: 3 }, l: [9] })).toEqual({ a: 1, o: { x: 1, y: 3 }, l: [9] });
  });

  it('uses the screen’s own section over defaults, and reports when there is none', () => {
    const config: FleetConfig = {
      version: 1,
      defaults: { defaultDurationSec: 30, schedule: { enabled: true, timeZone: 'Europe/London' } },
      screens: { 'Lobby-1': { defaultDurationSec: 60, schedule: { timeZone: 'America/New_York' } } },
    };
    expect(sectionFor(config, 'Lobby-1')).toEqual({
      section: { defaultDurationSec: 60, schedule: { enabled: true, timeZone: 'America/New_York' } },
      found: true,
    });
    expect(sectionFor(config, 'Unknown')).toEqual({ section: config.defaults, found: false });
    expect(sectionFor(config, '')).toMatchObject({ found: false });
  });
});

describe('toSettings', () => {
  it('maps a section onto settings, leaving unmanaged fields alone', () => {
    const current = { ...DEFAULT_SETTINGS, screenName: 'Lobby-1', autoStart: true };
    const { patch, licenseKey, lockPin, rotation } = toSettings({
      source: 'playlist',
      playlist: [{ url: 'https://a.example/' }, { url: 'https://b.example/', durationSec: 60, reloadBeforeShow: true }],
      detectors: [{ name: 'Signed out', kind: 'url', pattern: '/login', action: 'reopen' }],
      alerts: { webhookUrl: 'https://hooks.slack.com/services/T/B/X' },
      lock: { pin: '2468' },
      license: { key: 'KEY-123456' },
      rotation: 'running',
    }, current);
    expect(patch.source).toBe('playlist');
    expect(patch.playlist!.map((e) => [e.url, e.durationSec, e.reloadBeforeShow])).toEqual([['https://a.example/', null, false], ['https://b.example/', 60, true]]);
    expect(patch.detectors![0]).toMatchObject({ name: 'Signed out', enabled: true, kind: 'url', action: 'reopen', appliesTo: '' });
    expect(patch.alerts).toEqual({ ...DEFAULT_SETTINGS.alerts, webhookUrl: 'https://hooks.slack.com/services/T/B/X' });
    expect('autoStart' in patch).toBe(false);
    expect('screenName' in patch).toBe(false); // never set by the file
    expect('fleet' in patch).toBe(false);
    expect([licenseKey, lockPin, rotation]).toEqual(['KEY-123456', '2468', 'running']);
  });

  it('keeps playlist IDs stable across edits, so screens don’t reopen every tab', () => {
    const a = toSettings({ playlist: [{ url: 'https://a.example/' }, { url: 'https://b.example/' }] }, DEFAULT_SETTINGS).patch.playlist!;
    const b = toSettings({ playlist: [{ url: 'https://b.example/', durationSec: 90 }, { url: 'https://a.example/' }, { url: 'https://c.example/' }] }, DEFAULT_SETTINGS).patch.playlist!;
    expect(b.find((e) => e.url === 'https://a.example/')!.id).toBe(a[0]!.id);
    expect(b.find((e) => e.url === 'https://b.example/')!.id).toBe(a[1]!.id);
    const dupes = toSettings({ playlist: [{ url: 'https://a.example/' }, { url: 'https://a.example/' }] }, DEFAULT_SETTINGS).patch.playlist!;
    expect(new Set(dupes.map((e) => e.id)).size).toBe(2);
  });

  it('lock: enabled false removes it', () => {
    expect(toSettings({ lock: { enabled: false } }, DEFAULT_SETTINGS).lockPin).toBeNull();
  });
});

describe('exportConfig', () => {
  it('produces a file that passes the schema and round-trips through toSettings', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      screenName: 'NOC-Wall-1',
      source: 'playlist' as const,
      playlist: [{ id: 'x', url: 'https://grafana.example/d/1', durationSec: 45, reloadBeforeShow: true }],
      detectors: [{ id: 'd', name: 'Frozen', enabled: true, kind: 'unchanged' as const, pattern: '', minutes: 30, checkContent: false, appliesTo: '', action: 'reload' as const }],
    };
    const exported = exportConfig(settings, true);
    expect(validate(CONFIG_SCHEMA, exported)).toEqual([]);
    const { section } = sectionFor(exported, 'NOC-Wall-1');
    const { patch, rotation } = toSettings(section, DEFAULT_SETTINGS);
    expect(patch.playlist!.map(({ id: _id, ...e }) => e)).toEqual([{ url: 'https://grafana.example/d/1', durationSec: 45, reloadBeforeShow: true }]);
    expect(patch.detectors![0]!.name).toBe('Frozen');
    expect(rotation).toBe('running');
  });

  it('never exports secrets (lock hash, license key)', () => {
    const text = JSON.stringify(exportConfig({ ...DEFAULT_SETTINGS, lock: { enabled: true, salt: 's', hash: 'SECRET' } }, false));
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('"lock"');
    expect(text).not.toContain('"license"');
  });
});
