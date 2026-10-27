import type { License } from '@ext/shared/license';
import type { RotationState, Settings } from '../engine/types.ts';

/** What every options-page module needs: current values and a way to save. */
export interface Ctx {
  settings: Settings;
  state: RotationState;
  license: License;
  save(patch: Partial<Settings>): Promise<void>;
}
