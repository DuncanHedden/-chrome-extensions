import { createStore } from './storage.ts';

/**
 * The one place an extension asks "is this user Pro?". Milestone 3 plugs ExtensionPay in behind
 * getLicense(); callers don't change.
 */
export interface License {
  pro: boolean;
  source: 'free' | 'dev' | 'paid';
  checkedAt: number;
}

export const FREE_LICENSE: License = { pro: false, source: 'free', checkedAt: 0 };

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

/** Developer builds only: turn Pro on/off to test gated features before payments exist. */
export async function setDevPro(pro: boolean): Promise<void> {
  if (!isDevBuild()) throw new Error('Developer Pro is only available in unpacked builds.');
  await licenseStore.set({ pro, source: pro ? 'dev' : 'free', checkedAt: Date.now() });
}
