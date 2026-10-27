import type { License } from '@ext/shared/license';
import type { Settings } from './engine/types.ts';

export type ProFeature = 'healthLog' | 'detectors' | 'schedules' | 'settingsLock' | 'alerts' | 'fleetConfig';

export const canUse = (license: License, _feature: ProFeature): boolean => license.pro;

/**
 * Settings as the engine should see them for this license. Free users keep their Pro configuration
 * (so upgrading later restores it), but it has no effect. This is the only place Pro behaviour is gated
 * in the engine; the options page greys out the same features.
 */
export function gateSettings(settings: Settings, license: License): Settings {
  return {
    ...settings,
    detectors: canUse(license, 'detectors') ? settings.detectors : [],
    schedule: canUse(license, 'schedules') ? settings.schedule : { ...settings.schedule, enabled: false },
    lock: canUse(license, 'settingsLock') ? settings.lock : { ...settings.lock, enabled: false },
  };
}
