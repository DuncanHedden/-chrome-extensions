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
 * Lemon Squeezy store/product that may unlock Pro, and the checkout links for each plan. Fill these in
 * from the Lemon Squeezy dashboard (Store settings -> Store ID; Products -> product ID; each variant's
 * "Share" checkout link). While storeId is 0, license activation reports "not configured".
 */
export const LEMON_SQUEEZY = {
  storeId: 0,
  productIds: [] as number[],
  checkout: { monthly: '', yearly: '', lifetime: '' },
};

export const paymentsConfigured = () => LEMON_SQUEEZY.storeId !== 0 && LEMON_SQUEEZY.productIds.length > 0;
