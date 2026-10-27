import { describe, expect, it } from 'vitest';
import { activateLicense, OFFLINE_GRACE_MS, validateLicense, type License, type LicenseConfig } from '../src/license.ts';

const CONFIG: LicenseConfig = { storeId: 11, productIds: [22], apiBase: 'https://ls.test' };
const META = { store_id: 11, product_id: 22, variant_name: '10 screens', customer_email: 'it@acme.example' };
const KEY = { status: 'active', key: 'K-1', activation_limit: 10, activation_usage: 3, expires_at: null };

/** Fake License API: records calls, answers with the given (status, body) or throws. */
function server(answer: (action: string, params: URLSearchParams) => [number, unknown] | Error) {
  const calls: Array<{ action: string; params: URLSearchParams }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const action = url.split('/').pop()!;
    const params = new URLSearchParams(String(init.body));
    calls.push({ action, params });
    const a = answer(action, params);
    if (a instanceof Error) throw a;
    return new Response(JSON.stringify(a[1]), { status: a[0] });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('activateLicense', () => {
  it('activates a valid key as a named instance', async () => {
    const { fetchImpl, calls } = server(() => [200, { activated: true, error: null, license_key: KEY, instance: { id: 'i-1', name: 'Lobby' }, meta: META }]);
    const license = await activateLicense(CONFIG, ' K-1 ', 'Tab Rotator – Lobby', fetchImpl, 1000);
    expect(calls[0]!.params.get('license_key')).toBe('K-1');
    expect(calls[0]!.params.get('instance_name')).toBe('Tab Rotator – Lobby');
    expect(license).toMatchObject({ pro: true, source: 'paid', key: 'K-1', instanceId: 'i-1', activationUsage: 3, activationLimit: 10, validatedAt: 1000, customerEmail: 'it@acme.example' });
  });

  it('reports the server’s reason when activation is refused (e.g. limit reached)', async () => {
    const { fetchImpl } = server(() => [400, { activated: false, error: 'This license key has reached the activation limit.', license_key: KEY, meta: META }]);
    const license = await activateLicense(CONFIG, 'K-1', 'x', fetchImpl);
    expect(license.pro).toBe(false);
    expect(license.lastError).toMatch(/activation limit/);
  });

  it('rejects keys from another store or product, and frees the slot it took', async () => {
    const { fetchImpl, calls } = server((action) =>
      action === 'activate'
        ? [200, { activated: true, license_key: KEY, instance: { id: 'i-9' }, meta: { ...META, store_id: 999 } }]
        : [200, { deactivated: true }],
    );
    const license = await activateLicense(CONFIG, 'K-1', 'x', fetchImpl);
    expect(license.pro).toBe(false);
    expect(license.lastError).toMatch(/different product/);
    expect(calls.map((c) => c.action)).toEqual(['activate', 'deactivate']);
    expect(calls[1]!.params.get('instance_id')).toBe('i-9');
  });
});

describe('validateLicense', () => {
  const active: License = { pro: true, source: 'paid', checkedAt: 0, key: 'K-1', instanceId: 'i-1', validatedAt: 0 };

  it('stays Pro while valid, and refreshes usage', async () => {
    const { fetchImpl, calls } = server(() => [200, { valid: true, license_key: { ...KEY, activation_usage: 7 }, instance: { id: 'i-1' }, meta: META }]);
    const license = await validateLicense(CONFIG, active, fetchImpl, 5000);
    expect(calls[0]!.params.get('instance_id')).toBe('i-1');
    expect(license).toMatchObject({ pro: true, activationUsage: 7, validatedAt: 5000 });
  });

  it('turns Pro off when the subscription has expired', async () => {
    const { fetchImpl } = server(() => [200, { valid: false, error: null, license_key: { ...KEY, status: 'expired' }, meta: META }]);
    const license = await validateLicense(CONFIG, active, fetchImpl, 5000);
    expect(license.pro).toBe(false);
    expect(license.lastError).toMatch(/expired/);
  });

  it('keeps Pro through network outages inside the grace period, then drops it', async () => {
    const { fetchImpl } = server(() => new TypeError('Failed to fetch'));
    const inside = await validateLicense(CONFIG, active, fetchImpl, OFFLINE_GRACE_MS - 1);
    expect(inside.pro).toBe(true);
    expect(inside.lastError).toMatch(/offline grace/);
    const outside = await validateLicense(CONFIG, active, fetchImpl, OFFLINE_GRACE_MS + 1);
    expect(outside.pro).toBe(false);
  });

  it('treats a 5xx from the license server like an outage, not a revocation', async () => {
    const { fetchImpl } = server(() => [503, { error: 'Service Unavailable' }]);
    expect((await validateLicense(CONFIG, active, fetchImpl, 1000)).pro).toBe(true);
  });

  it('leaves free and developer licenses alone (no network)', async () => {
    const { fetchImpl, calls } = server(() => [200, {}]);
    await validateLicense(CONFIG, { pro: true, source: 'dev', checkedAt: 0 }, fetchImpl);
    expect(calls).toEqual([]);
  });
});
