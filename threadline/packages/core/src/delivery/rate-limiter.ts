import type { Clock } from '../clock';
import type { KvStore } from '../storage/kv';

interface BucketState {
  tokens: number;
  at: number;
  blockedUntil?: number;
}

export interface RateLimiterOptions {
  /** Tokens added per second. Google Chat allows ~1 request/second per space across all webhooks. */
  ratePerSecond: number;
  /** Bucket size. 1 means strict pacing with no burst. */
  burst: number;
}

/**
 * Per-space token bucket persisted in KVS. Correctness relies on the delivery queue running at most one
 * consumer per space at a time (Async Events `concurrency: { key: space, limit: 1 }`), so read-modify-write
 * here never races. Without that guarantee it degrades to "mostly paced" and 429 backoff catches the rest.
 */
export class SpaceRateLimiter {
  constructor(
    private readonly kv: KvStore,
    private readonly clock: Clock,
    private readonly opts: RateLimiterOptions = { ratePerSecond: 1, burst: 1 },
  ) {}

  private key(spaceId: string) {
    return `rl:${spaceId}`;
  }

  /** Takes a token and returns 0, or returns how many ms until one is available (taking nothing). */
  async acquire(spaceId: string): Promise<number> {
    const now = this.clock.now();
    const prev = await this.kv.get<BucketState>(this.key(spaceId));
    if (prev?.blockedUntil && prev.blockedUntil > now) return prev.blockedUntil - now;

    const elapsed = prev ? Math.max(0, now - prev.at) : Infinity;
    const tokens = Math.min(this.opts.burst, (prev?.tokens ?? this.opts.burst) + (elapsed * this.opts.ratePerSecond) / 1000);
    if (tokens >= 1) {
      await this.kv.set<BucketState>(this.key(spaceId), { tokens: tokens - 1, at: now }, { ttlSeconds: 3600 });
      return 0;
    }
    return Math.ceil(((1 - tokens) * 1000) / this.opts.ratePerSecond);
  }

  /** After a 429, hold every sender for this space until the backoff expires. */
  async penalize(spaceId: string, ms: number): Promise<void> {
    const now = this.clock.now();
    await this.kv.set<BucketState>(this.key(spaceId), { tokens: 0, at: now, blockedUntil: now + ms }, { ttlSeconds: 3600 });
  }
}
