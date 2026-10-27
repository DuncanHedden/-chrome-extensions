/** Per-screen Pro prices, shown on the options page and the store listing. Change them here only. */
export const PRICES = {
  currency: 'USD',
  monthly: 4,
  yearly: 36,
  lifetime: 69,
} as const;

export const formatPrice = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: PRICES.currency, maximumFractionDigits: 0 }).format(amount);

/**
 * Polar organization and license-key benefits that may unlock Pro, and the checkout links for each plan.
 * Fill these in from the Polar dashboard (see docs/payments-setup.md). While organizationId is empty,
 * license activation reports "not configured".
 */
export const POLAR = {
  organizationId: '6dfd03c5-27cd-4694-a01b-51404411e240',
  /** "Tab Rotator Pro – 1 screen" license-key benefit. Add bundle benefits here as they're created. */
  benefitIds: ['c4921181-3bfa-4cb4-ba53-9ba89fcf1f15'] as string[],
  checkout: {
    monthly: 'https://buy.polar.sh/polar_cl_UTmhTG1gdwS8NjScbJrny6Hgjc2mu1n0Vzk3W1ogc2P',
    yearly: 'https://buy.polar.sh/polar_cl_oUv0sKEDn6dM7N6rgXa13H9MnUlePFwJgKc5G2Mw1Ww',
    lifetime: 'https://buy.polar.sh/polar_cl_bqD6U4oiazY84i32hFLv5h329g7UsgHWZVylw0384CD',
  },
};

export const paymentsConfigured = () => POLAR.organizationId !== '';
