/**
 * Marketplace license gating. Forge only populates `context.license` for paid apps in production; in
 * development/staging it is undefined, so we treat those environments as licensed unless an explicit
 * override says otherwise (set with `forge variables set LICENSE_OVERRIDE inactive`).
 */
export interface LicenseInput {
  /** Backend function context: `context.license.isActive`. Custom UI uses `license.active`. */
  license?: { isActive?: boolean; active?: boolean; isEvaluation?: boolean; trialEndDate?: string | null } | null;
  environmentType?: string;
  override?: string;
}

export interface LicenseState {
  active: boolean;
  reason: 'licensed' | 'trial' | 'inactive' | 'missing' | 'non-production' | 'override';
  trialEndDate?: string | null;
}

export function evaluateLicense({ license, environmentType, override }: LicenseInput): LicenseState {
  const env = environmentType?.toUpperCase();
  if (override && env !== 'PRODUCTION') {
    return { active: override.toLowerCase() === 'active', reason: 'override' };
  }
  if (license) {
    const active = license.isActive ?? license.active ?? false;
    if (!active) return { active: false, reason: 'inactive' };
    return { active: true, reason: license.isEvaluation ? 'trial' : 'licensed', trialEndDate: license.trialEndDate };
  }
  if (env && env !== 'PRODUCTION') return { active: true, reason: 'non-production' };
  // Production with no license object: paid Forge apps always receive one, so this means unlicensed.
  return { active: false, reason: 'missing' };
}
