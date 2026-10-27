import { createStore } from './storage.ts';

/**
 * The one place an extension asks "is this user Pro?", backed by Polar license keys.
 *
 * Polar's customer-portal License Key API is public (no secret key, no server of ours): a key is
 * *activated* once per screen with a label (the screen's name), which counts against the key's
 * activation limit, then periodically *validated* against that activation. Keys are scoped to our
 * Polar organization server-side; we also pin the license-key benefit(s) that may unlock Pro.
 * Network failures never downgrade a working screen inside the offline grace period.
 */
export interface License {
  pro: boolean;
  source: 'free' | 'dev' | 'paid';
  /** Last time we heard from the license server (or changed the dev override). */
  checkedAt: number;
  key?: string;
  /** Polar activation ID for this screen. */
  instanceId?: string;
  instanceName?: string;
  activationLimit?: number | null;
  customerEmail?: string;
  benefitId?: string;
  expiresAt?: string | null;
  /** Last successful validation; offline grace counts from here. */
  validatedAt?: number;
  lastError?: string;
}

export interface LicenseConfig {
  /** Polar organization that sells the product. */
  organizationId: string;
  /** License-key benefits that unlock Pro (empty = any benefit in the organization). */
  benefitIds: string[];
  apiBase?: string;
}

export const FREE_LICENSE: License = { pro: false, source: 'free', checkedAt: 0 };
export const OFFLINE_GRACE_MS = 14 * 24 * 60 * 60 * 1000;
export const POLAR_API = 'https://api.polar.sh/v1/customer-portal/license-keys';

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

interface PolarKey {
  benefit_id?: string;
  limit_activations?: number | null;
  expires_at?: string | null;
  customer?: { email?: string } | null;
}
interface PolarActivation {
  id?: string;
  label?: string;
  license_key?: PolarKey;
}
type PolarBody = PolarKey & PolarActivation & { activation?: PolarActivation | null; detail?: unknown; error?: string };

export class NetworkError extends Error {}

/** POST to the License Key API. Returns status + body; throws NetworkError when the server can't be reached or is failing. */
async function call(config: LicenseConfig, action: 'activate' | 'validate' | 'deactivate', body: Record<string, unknown>, fetchImpl: typeof fetch) {
  const resp = await fetchImpl(`${config.apiBase ?? POLAR_API}/${action}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, organization_id: config.organizationId }),
  });
  if (resp.status >= 500 || resp.status === 429) throw new NetworkError(`License server returned HTTP ${resp.status}`);
  if (resp.status === 204) return { status: resp.status, body: {} as PolarBody };
  let parsed: PolarBody;
  try {
    parsed = (await resp.json()) as PolarBody;
  } catch {
    throw new NetworkError(`License server returned HTTP ${resp.status}`);
  }
  return { status: resp.status, body: parsed };
}

/** A human message from a Polar error body (string detail, or a 422 validation list). */
function errorText(status: number, body: PolarBody): string {
  if (typeof body.detail === 'string') return body.detail;
  if (status === 404) return 'License key not found, or it has been revoked or has expired.';
  if (status === 403) return 'This license key cannot be activated (revoked, expired, or its screen limit is reached).';
  if (status === 422) return 'That doesn’t look like a valid license key.';
  return `License server returned HTTP ${status}.`;
}

/** Pure: is this key's benefit one that unlocks Pro? */
export const benefitAllowed = (config: LicenseConfig, benefitId: string | undefined) =>
  config.benefitIds.length === 0 || (benefitId !== undefined && config.benefitIds.includes(benefitId));

export async function activateLicense(config: LicenseConfig, key: string, label: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<License> {
  const trimmed = key.trim();
  const { status, body } = await call(config, 'activate', { key: trimmed, label }, fetchImpl);
  const base: License = { pro: false, source: 'paid', checkedAt: now, key: trimmed };
  if (status !== 200 || !body.id) return { ...base, lastError: errorText(status, body) };
  const lk = body.license_key ?? {};
  const license: License = {
    ...base,
    instanceId: body.id,
    instanceName: body.label ?? label,
    activationLimit: lk.limit_activations ?? null,
    customerEmail: lk.customer?.email,
    benefitId: lk.benefit_id,
    expiresAt: lk.expires_at ?? null,
  };
  if (!benefitAllowed(config, lk.benefit_id)) {
    // A key for something else we sell: give the activation slot straight back.
    await call(config, 'deactivate', { key: trimmed, activation_id: body.id }, fetchImpl).catch(() => {});
    return { ...license, instanceId: undefined, lastError: 'This license key is for a different product.' };
  }
  return { ...license, pro: true, validatedAt: now };
}

/**
 * Re-check an activated key. A definite "not valid" (404) turns Pro off. Offline or server trouble keeps
 * Pro until OFFLINE_GRACE_MS after the last successful validation, so a network outage never turns
 * features off on a screen nobody is watching.
 */
export async function validateLicense(config: LicenseConfig, license: License, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<License> {
  if (license.source !== 'paid' || !license.key || !license.instanceId) return license;
  try {
    const { status, body } = await call(config, 'validate', { key: license.key, activation_id: license.instanceId }, fetchImpl);
    if (status !== 200) return { ...license, pro: false, checkedAt: now, lastError: errorText(status, body) };
    if (!benefitAllowed(config, body.benefit_id)) return { ...license, pro: false, checkedAt: now, lastError: 'This license key is for a different product.' };
    return {
      ...license,
      pro: true,
      checkedAt: now,
      validatedAt: now,
      activationLimit: body.limit_activations ?? null,
      customerEmail: body.customer?.email ?? license.customerEmail,
      expiresAt: body.expires_at ?? null,
      lastError: undefined,
    };
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

/** Free this screen's activation (e.g. before moving the key to another screen). */
export async function deactivateLicense(config: LicenseConfig, license: License, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!license.key || !license.instanceId) return;
  const { status, body } = await call(config, 'deactivate', { key: license.key, activation_id: license.instanceId }, fetchImpl);
  // 404: already gone (e.g. removed in the Polar dashboard), which is the outcome we wanted.
  if (status !== 204 && status !== 404) throw new Error(errorText(status, body));
}
