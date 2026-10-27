import { describe, expect, it } from 'vitest';
import { activateLicense, deactivateLicense, OFFLINE_GRACE_MS, validateLicense, type License, type LicenseConfig } from '../src/license.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const BENEFIT = '22222222-2222-4222-8222-222222222222';
const CONFIG: LicenseConfig = { organizationId: ORG, benefitIds: [BENEFIT], apiBase: 'https://polar.test' };
const KEY = { benefit_id: BENEFIT, limit_activations: 10, expires_at: null, customer: { email: 'it@acme.example' } };

/** Fake Polar License Key API: records calls, answers with (status, body) or throws. */
function server(answer: (action: string, body: Record<string, unknown>) => [number, unknown?] | Error) {
  const calls: Array<{ action: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const action = url.split('/').pop()!;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ action, body });
    const a = answer(action, body);
    if (a instanceof Error) throw a;
    return new Response(a[1] === undefined ? null : JSON.stringify(a[1]), { status: a[0] });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('activateLicense', () => {
  it('activates a key for this screen, scoped to our organization', async () => {
    const { fetchImpl, calls } = server(() => [200, { id: 'act-1', label: 'Tab Rotator – Lobby', license_key: KEY }]);
    const license = await activateLicense(CONFIG, ' K-1 ', 'Tab Rotator – Lobby', fetchImpl, 1000);
    expect(calls[0]).toEqual({ action: 'activate', body: { key: 'K-1', label: 'Tab Rotator – Lobby', organization_id: ORG } });
    expect(license).toMatchObject({ pro: true, source: 'paid', key: 'K-1', instanceId: 'act-1', activationLimit: 10, validatedAt: 1000, customerEmail: 'it@acme.example' });
  });

  it('explains refusals: screen limit reached (403), unknown key (404), malformed (422)', async () => {
    for (const [status, body, expected] of [
      [403, { error: 'NotPermitted', detail: 'License key activation limit reached' }, /limit reached/],
      [404, { error: 'ResourceNotFound', detail: 'Not found' }, /Not found/],
      [422, { detail: [{ msg: 'bad' }] }, /valid license key/],
    ] as const) {
      const { fetchImpl } = server(() => [status, body]);
      const license = await activateLicense(CONFIG, 'K-1', 'x', fetchImpl);
      expect(license.pro).toBe(false);
      expect(license.lastError).toMatch(expected);
    }
  });

  it('rejects keys for another benefit, and frees the activation it took', async () => {
    const { fetchImpl, calls } = server((action) =>
      action === 'activate' ? [200, { id: 'act-9', license_key: { ...KEY, benefit_id: 'other' } }] : [204],
    );
    const license = await activateLicense(CONFIG, 'K-1', 'x', fetchImpl);
    expect(license.pro).toBe(false);
    expect(license.lastError).toMatch(/different product/);
    expect(calls.map((c) => [c.action, c.body.activation_id])).toEqual([['activate', undefined], ['deactivate', 'act-9']]);
  });
});

describe('validateLicense', () => {
  const active: License = { pro: true, source: 'paid', checkedAt: 0, key: 'K-1', instanceId: 'act-1', validatedAt: 0 };

  it('stays Pro while valid, checking this screen’s activation', async () => {
    const { fetchImpl, calls } = server(() => [200, { ...KEY, activation: { id: 'act-1' } }]);
    const license = await validateLicense(CONFIG, active, fetchImpl, 5000);
    expect(calls[0]!.body).toEqual({ key: 'K-1', activation_id: 'act-1', organization_id: ORG });
    expect(license).toMatchObject({ pro: true, validatedAt: 5000, activationLimit: 10 });
  });

  it('turns Pro off when the key is revoked, expired, or this activation was removed (404)', async () => {
    const { fetchImpl } = server(() => [404, { error: 'ResourceNotFound', detail: 'License key not found.' }]);
    const license = await validateLicense(CONFIG, active, fetchImpl, 5000);
    expect(license.pro).toBe(false);
    expect(license.lastError).toMatch(/not found/);
  });

  it('keeps Pro through network outages inside the grace period, then drops it', async () => {
    const { fetchImpl } = server(() => new TypeError('Failed to fetch'));
    const inside = await validateLicense(CONFIG, active, fetchImpl, OFFLINE_GRACE_MS - 1);
    expect(inside.pro).toBe(true);
    expect(inside.lastError).toMatch(/offline grace/);
    expect((await validateLicense(CONFIG, active, fetchImpl, OFFLINE_GRACE_MS + 1)).pro).toBe(false);
  });

  it('treats 5xx and rate limiting like an outage, not a revocation', async () => {
    for (const status of [503, 429]) {
      const { fetchImpl } = server(() => [status, { detail: 'busy' }]);
      expect((await validateLicense(CONFIG, active, fetchImpl, 1000)).pro).toBe(true);
    }
  });

  it('leaves free and developer licenses alone (no network)', async () => {
    const { fetchImpl, calls } = server(() => [200, {}]);
    await validateLicense(CONFIG, { pro: true, source: 'dev', checkedAt: 0 }, fetchImpl);
    expect(calls).toEqual([]);
  });
});

describe('deactivateLicense', () => {
  it('frees the activation; an already-removed activation counts as success', async () => {
    const lic: License = { pro: true, source: 'paid', checkedAt: 0, key: 'K-1', instanceId: 'act-1' };
    const ok = server(() => [204]);
    await deactivateLicense(CONFIG, lic, ok.fetchImpl);
    expect(ok.calls[0]!.body).toEqual({ key: 'K-1', activation_id: 'act-1', organization_id: ORG });
    await expect(deactivateLicense(CONFIG, lic, server(() => [404, { detail: 'gone' }]).fetchImpl)).resolves.toBeUndefined();
    await expect(deactivateLicense(CONFIG, lic, server(() => [422, { detail: 'bad' }]).fetchImpl)).rejects.toThrow('bad');
  });
});
