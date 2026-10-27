import { activateLicense, deactivateLicense, FREE_LICENSE, licenseStore, validateLicense, type License } from '@ext/shared/license';
import { settingsStore } from './engine/stores.ts';
import type { LogEntry } from './engine/types.ts';
import { LEMON_SQUEEZY, paymentsConfigured } from './pricing.ts';

const entry = (level: LogEntry['level'], code: string, message: string): LogEntry => ({ at: Date.now(), level, code, message });

async function instanceName() {
  const { screenName } = await settingsStore.get();
  return `Tab Rotator – ${screenName || 'unnamed screen'}`;
}

/** Activate `key` on this screen. Returns log entries describing the outcome. */
export async function activate(key: string): Promise<{ license: License; log: LogEntry[] }> {
  if (!paymentsConfigured()) {
    return { license: await licenseStore.get(), log: [entry('warn', 'license-error', 'License keys are not configured in this build.')] };
  }
  const current = await licenseStore.get();
  // Re-activating the same key on the same screen would use a second slot.
  if (current.source === 'paid' && current.key === key.trim() && current.pro) return { license: current, log: [] };
  const license = await activateLicense(LEMON_SQUEEZY, key, await instanceName());
  await licenseStore.replace(license);
  return {
    license,
    log: [license.pro
      ? entry('info', 'license-activated', `Pro activated (${license.activationUsage ?? '?'} of ${license.activationLimit ?? 'unlimited'} screens on this key).`)
      : entry('error', 'license-invalid', `License key rejected: ${license.lastError}`)],
  };
}

export async function deactivate(): Promise<LogEntry[]> {
  const license = await licenseStore.get();
  if (license.source === 'paid') await deactivateLicense(LEMON_SQUEEZY, license);
  await licenseStore.replace({ ...FREE_LICENSE, checkedAt: Date.now() });
  return [entry('info', 'license-deactivated', 'Pro deactivated on this screen; its activation is free for another screen.')];
}

/** Periodic re-validation. Logs only when something changes. */
export async function revalidate(): Promise<LogEntry[]> {
  const before = await licenseStore.get();
  if (before.source !== 'paid' || !paymentsConfigured()) return [];
  const after = await validateLicense(LEMON_SQUEEZY, before);
  await licenseStore.replace(after);
  if (before.pro && !after.pro) return [entry('error', 'license-invalid', `Pro turned off: ${after.lastError}`)];
  if (!before.pro && after.pro) return [entry('info', 'license-activated', 'Pro license is valid again.')];
  return [];
}
