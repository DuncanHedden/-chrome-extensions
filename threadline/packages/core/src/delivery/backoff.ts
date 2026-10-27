export interface BackoffOptions {
  baseSeconds: number;
  maxSeconds: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = { baseSeconds: 5, maxSeconds: 900 };

/**
 * Exponential backoff with "equal jitter": half fixed, half random, so retries from a burst spread out but
 * never collapse to ~0. attempt 0 → 2.5–5 s, 1 → 5–10 s, … capped at 900 s (the Async Events max delay).
 */
export function backoffSeconds(attempt: number, opts: BackoffOptions = DEFAULT_BACKOFF, random: () => number = Math.random): number {
  const exp = Math.min(opts.maxSeconds, opts.baseSeconds * 2 ** Math.max(0, attempt));
  return Math.max(1, Math.min(opts.maxSeconds, Math.round(exp / 2 + random() * (exp / 2))));
}
