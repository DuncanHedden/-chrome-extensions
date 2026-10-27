import { TtlCache } from './cache';
import { fnv1a } from './hash';
import type { KvStore } from './storage/kv';

/**
 * At-most-once processing per event key. Forge gives no ordering or exactly-once guarantees for product
 * events, so each event is claimed with an atomic create-if-absent (TTL'd so the keys clean themselves up).
 * The in-memory layer catches same-instance repeats without a KVS write.
 */
export class Deduper {
  private readonly recent: TtlCache<true>;

  constructor(
    private readonly kv: KvStore,
    private readonly ttlSeconds = 24 * 3600,
    now: () => number = Date.now,
  ) {
    this.recent = new TtlCache<true>(5_000, ttlSeconds * 1000, now);
  }

  /** True if this caller won the claim and should process the event. */
  async claim(eventKey: string): Promise<boolean> {
    const key = `dedupe:${fnv1a(eventKey)}:${eventKey.length}`;
    if (this.recent.get(key)) return false;
    this.recent.set(key, true);
    return this.kv.setIfAbsent(key, 1, { ttlSeconds: this.ttlSeconds });
  }
}
