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
  organizationId: '',
  benefitIds: [] as string[],
  checkout: { monthly: '', yearly: '', lifetime: '' },
};

export const paymentsConfigured = () => POLAR.organizationId !== '';
