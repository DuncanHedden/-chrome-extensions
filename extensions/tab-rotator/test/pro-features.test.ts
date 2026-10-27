import { describe, expect, it } from 'vitest';
import { FREE_LICENSE, type License } from '@ext/shared/license';
import { healthLogCsv } from '../src/csv.ts';
import { DEFAULT_SETTINGS } from '../src/engine/defaults.ts';
import { createLock, isLockedOut, LOCKOUT_MS, NO_ATTEMPTS, recordAttempt, verifyPin } from '../src/lock.ts';
import { canUse, gateSettings } from '../src/pro.ts';

const PRO: License = { pro: true, source: 'paid', checkedAt: 1 };

describe('license gating', () => {
  const configured = {
    ...DEFAULT_SETTINGS,
    detectors: [{ id: 'd', name: 'd', enabled: true, kind: 'title' as const, pattern: 'x', minutes: 1, checkContent: false, appliesTo: '', action: 'reload' as const }],
    schedule: { ...DEFAULT_SETTINGS.schedule, enabled: true },
    lock: { enabled: true, salt: 's', hash: 'h' },
  };

  it('free: Pro features have no effect, but their configuration is kept', () => {
    const gated = gateSettings(configured, FREE_LICENSE);
    expect(gated.detectors).toEqual([]);
    expect(gated.schedule.enabled).toBe(false);
    expect(gated.schedule.windows).toEqual(configured.schedule.windows);
    expect(gated.lock.enabled).toBe(false);
    expect(gated.lock.hash).toBe('h');
    expect(configured.detectors).toHaveLength(1); // not mutated
  });

  it('pro: settings pass through untouched', () => {
    expect(gateSettings(configured, PRO)).toEqual(configured);
  });

  it('free features are never gated', () => {
    const gated = gateSettings({ ...configured, selfHeal: true, pauseOnActivity: true, autoStart: true }, FREE_LICENSE);
    expect([gated.selfHeal, gated.pauseOnActivity, gated.autoStart]).toEqual([true, true, true]);
  });

  it('canUse follows the license', () => {
    expect(canUse(FREE_LICENSE, 'healthLog')).toBe(false);
    expect(canUse(PRO, 'healthLog')).toBe(true);
  });
});

describe('settings lock', () => {
  it('verifies the right PIN only, and never stores it', async () => {
    const lock = await createLock('2468');
    expect(JSON.stringify(lock)).not.toContain('2468');
    expect(await verifyPin(lock, '2468')).toBe(true);
    expect(await verifyPin(lock, '2469')).toBe(false);
    expect(await verifyPin(lock, '')).toBe(false);
  });

  it('salts: the same PIN hashes differently each time', async () => {
    expect((await createLock('1111')).hash).not.toBe((await createLock('1111')).hash);
  });

  it('rejects non-numeric or wrong-length PINs', async () => {
    await expect(createLock('12')).rejects.toThrow();
    await expect(createLock('abcd')).rejects.toThrow();
  });

  it('locks out after 5 wrong PINs, doubling each round, and resets on success', () => {
    let a = NO_ATTEMPTS;
    for (let i = 0; i < 4; i++) a = recordAttempt(a, false, 0);
    expect(isLockedOut(a, 0)).toBe(false);
    a = recordAttempt(a, false, 0);
    expect(isLockedOut(a, LOCKOUT_MS - 1)).toBe(true);
    expect(isLockedOut(a, LOCKOUT_MS)).toBe(false);
    for (let i = 0; i < 5; i++) a = recordAttempt(a, false, LOCKOUT_MS);
    expect(a.lockedUntil).toBe(LOCKOUT_MS + 2 * LOCKOUT_MS);
    expect(recordAttempt(a, true, 0)).toEqual(NO_ATTEMPTS);
  });
});

describe('health log CSV', () => {
  it('has a header, ISO times, and escapes commas, quotes and newlines', () => {
    const csv = healthLogCsv([
      { at: Date.UTC(2026, 9, 26, 12), level: 'warn', code: 'crashed', message: 'Tab crashed.', url: 'https://a.example/?x=1,2' },
      { at: Date.UTC(2026, 9, 26, 13), level: 'info', code: 'note', message: 'He said "hi"\nthen left' },
    ], 'Lobby-2');
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('time_utc,local_time,screen,level,event,message,url');
    expect(lines[1]).toMatch(/^2026-10-26T12:00:00\.000Z,.*,Lobby-2,warn,crashed,Tab crashed\.,"https:\/\/a\.example\/\?x=1,2"$/);
    expect(csv).toContain('"He said ""hi""\nthen left"');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});
