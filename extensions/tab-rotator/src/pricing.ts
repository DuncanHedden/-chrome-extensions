/** Per-screen Pro prices, shown on the options page and the store listing. Change them here only. */
export const PRICES = {
  currency: 'USD',
  monthly: 4,
  yearly: 36,
  lifetime: 69,
} as const;

export const formatPrice = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: PRICES.currency, maximumFractionDigits: 0 }).format(amount);
