import { createStore } from './storage.ts';

/**
 * The one place an extension asks "is this user Pro?", backed by Lemon Squeezy license keys.
 *
 * Lemon Squeezy's License API is public (no secret key, no server of ours): a key is *activated* once
 * per screen as a named instance, which counts against the key's activation limit, then periodically
 * *validated*. Keys must belong to our store and product, or anyone could mint a free key in their own
 * store. Network failures never downgrade a working screen inside the offline grace period.
 */
export interface License {
  pro: boolean;
  source: 'free' | 'dev' | 'paid';
  /** Last time we heard from the license server (or changed the dev override). */
  checkedAt: number;
  key?: string;
  instanceId?: string;
  instanceName?: string;
  status?: string;
  activationUsage?: number;
  activationLimit?: number | null;
  customerEmail?: string;
  variantName?: string;
  expiresAt?: string | null;
  /** Last successful validation; offline grace counts from here. */
  validatedAt?: number;
  lastError?: string;
}

export interface LicenseConfig {
  /** Lemon Squeezy store and product IDs that may unlock Pro. */
  storeId: number;
  productIds: number[];
  apiBase?: string;
}

export const FREE_LICENSE: License = { pro: false, source: 'free', checkedAt: 0 };
export const OFFLINE_GRACE_MS = 14 * 24 * 60 * 60 * 1000;
export const LEMON_SQUEEZY_API = 'https://api.lemonsqueezy.com/v1/licenses';

export const licenseStore = createStore('local', 'license', FREE_LICENSE);

/** Unpacked (developer) builds have no update_url; anything installed from the Web Store does. */
export function isDevBuild(): boolean {
  return !chrome.runtime.getManifest().update_url;
}

export async function getLicense(): Promise<License> {
  const license = await licenseStore.get();
  // A developer override never survives into a store install.
  if (license.source === 'dev' && !isDevBuild()) return FREE_LICENSE;
  return license;
}

/** Developer builds only: turn Pro on/off to test gated features without a key. */
export async function setDevPro(pro: boolean): Promise<void> {
  if (!isDevBuild()) throw new Error('Developer Pro is only available in unpacked builds.');
  await licenseStore.replace({ ...FREE_LICENSE, pro, source: pro ? 'dev' : 'free', checkedAt: Date.now() });
}

interface ApiResponse {
  activated?: boolean;
  valid?: boolean;
  deactivated?: boolean;
  error?: string | null;
  license_key?: { status?: string; key?: string; activation_limit?: number | null; activation_usage?: number; expires_at?: string | null };
  instance?: { id?: string; name?: string } | null;
  meta?: { store_id?: number; product_id?: number; variant_name?: string; customer_email?: string };
}

async function call(config: LicenseConfig, action: 'activate' | 'validate' | 'deactivate', params: Record<string, string>, fetchImpl: typeof fetch): Promise<ApiResponse> {
  const resp = await fetchImpl(`${config.apiBase ?? LEMON_SQUEEZY_API}/${action}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  // 4xx responses carry a JSON body with `error`; only treat unparseable/5xx answers as "offline".
  let body: ApiResponse;
  try {
    body = (await resp.json()) as ApiResponse;
  } catch {
    throw new NetworkError(`License server returned HTTP ${resp.status}`);
  }
  if (resp.status >= 500) throw new NetworkError(body.error ?? `License server returned HTTP ${resp.status}`);
  return body;
}

export class NetworkError extends Error {}

/** Pure: turn an API answer into a License, enforcing store/product. */
export function interpretResponse(config: LicenseConfig, body: ApiResponse, ok: boolean, key: string, now: number): License {
  const base: License = {
    pro: false,
    source: 'paid',
    checkedAt: now,
    key,
    status: body.license_key?.status,
    activationUsage: body.license_key?.activation_usage,
    activationLimit: body.license_key?.activation_limit ?? null,
    expiresAt: body.license_key?.expires_at ?? null,
    customerEmail: body.meta?.customer_email,
    variantName: body.meta?.variant_name,
    instanceId: body.instance?.id,
    instanceName: body.instance?.name,
  };
  if (body.meta && (body.meta.store_id !== config.storeId || !config.productIds.includes(body.meta.product_id ?? -1))) {
    return { ...base, instanceId: undefined, lastError: 'This license key is for a different product.' };
  }
  if (!ok) return { ...base, lastError: body.error ?? `License is ${body.license_key?.status ?? 'not valid'}.` };
  return { ...base, pro: true, validatedAt: now };
}

export async function activateLicense(config: LicenseConfig, key: string, instanceName: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<License> {
  const body = await call(config, 'activate', { license_key: key.trim(), instance_name: instanceName }, fetchImpl);
  const license = interpretResponse(config, body, body.activated === true, key.trim(), now);
  // Activated a key for the wrong product: give the activation slot straight back.
  if (body.activated && !license.pro && body.instance?.id) {
    await call(config, 'deactivate', { license_key: key.trim(), instance_id: body.instance.id }, fetchImpl).catch(() => {});
  }
  return license;
}

/**
 * Re-check an activated key. Offline (or server down): keep Pro until OFFLINE_GRACE_MS after the last
 * successful validation, so a network outage never turns features off on a screen nobody is watching.
 */
export async function validateLicense(config: LicenseConfig, license: License, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<License> {
  if (license.source !== 'paid' || !license.key || !license.instanceId) return license;
  try {
    const body = await call(config, 'validate', { license_key: license.key, instance_id: license.instanceId }, fetchImpl);
    const next = interpretResponse(config, body, body.valid === true, license.key, now);
    return { ...next, instanceId: next.instanceId ?? license.instanceId, instanceName: next.instanceName ?? license.instanceName };
  } catch (error) {
    const withinGrace = license.validatedAt !== undefined && now - license.validatedAt < OFFLINE_GRACE_MS;
    return {
      ...license,
      pro: license.pro && withinGrace,
      checkedAt: now,
      lastError: `Couldn't reach the license server (${error instanceof Error ? error.message : String(error)})${withinGrace ? '; Pro stays on during the offline grace period.' : '.'}`,
    };
  }
}

/** Free this screen's activation slot (e.g. before moving the key to another screen). */
export async function deactivateLicense(config: LicenseConfig, license: License, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!license.key || !license.instanceId) return;
  const body = await call(config, 'deactivate', { license_key: license.key, instance_id: license.instanceId }, fetchImpl);
  if (!body.deactivated) throw new Error(body.error ?? 'Could not deactivate this screen.');
}
