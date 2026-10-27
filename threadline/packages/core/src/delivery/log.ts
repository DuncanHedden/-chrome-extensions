import type { DeliveryErrorCode } from '../chat/errors';
import { randomId } from '../hash';
import type { KvStore } from '../storage/kv';
import type { DeliveryJob } from './job';

export interface DeliveryLogEntry {
  id: string;
  at: number;
  connectionId: string;
  connectionName: string;
  itemKey: string;
  eventKind: string;
  outcome: 'sent' | 'failed' | 'skipped';
  attempts: number;
  httpStatus?: number;
  latencyMs?: number;
  usedFallback?: boolean;
  errorCode?: DeliveryErrorCode | 'license_inactive' | 'connection_disabled' | 'missing_secret';
  explanation?: string;
  helpUrl?: string;
  /** Present on failed entries that can be retried and haven't been yet. */
  retryable?: boolean;
  retriedAt?: number;
}

interface StoredEntry extends DeliveryLogEntry {
  /** Kept only for failed deliveries, so "Retry" can resend exactly what failed. */
  job?: DeliveryJob;
}

const PREFIX = 'dlog:';
const MAX_TS = 9_999_999_999_999;

/**
 * Capped, newest-first delivery log in KVS. Keys embed an inverted timestamp so an ascending prefix scan returns
 * the newest entries first. Pruning is probabilistic (≈1 in `pruneEvery` writes) so idle sites cost nothing and
 * busy sites never accumulate more than a few dozen entries over the cap.
 */
export class DeliveryLog {
  constructor(
    private readonly kv: KvStore,
    private readonly cap = 200,
    private readonly pruneEvery = 20,
    private readonly random: () => number = Math.random,
  ) {}

  static idFor(at: number): string {
    return `${String(MAX_TS - at).padStart(13, '0')}:${randomId(6)}`;
  }

  async append(entry: Omit<DeliveryLogEntry, 'id'> & { id?: string }, job?: DeliveryJob): Promise<string> {
    const id = entry.id ?? DeliveryLog.idFor(entry.at);
    const stored: StoredEntry = { ...entry, id, ...(job && entry.outcome === 'failed' ? { job } : {}) };
    await this.kv.set(PREFIX + id, stored);
    if (this.random() < 1 / this.pruneEvery) await this.prune();
    return id;
  }

  async list(limit = this.cap): Promise<DeliveryLogEntry[]> {
    const rows = await this.kv.listByPrefix<StoredEntry>(PREFIX, Math.min(limit, this.cap));
    return rows.map(({ value }) => {
      const { job, ...rest } = value;
      return { ...rest, retryable: !!job && !rest.retriedAt };
    });
  }

  async takeJobForRetry(id: string, now: number): Promise<DeliveryJob | undefined> {
    const stored = await this.kv.get<StoredEntry>(PREFIX + id);
    if (!stored?.job || stored.retriedAt) return undefined;
    const { job, ...rest } = stored;
    await this.kv.set(PREFIX + id, { ...rest, retriedAt: now });
    return job;
  }

  async prune(): Promise<number> {
    const rows = await this.kv.listByPrefix<StoredEntry>(PREFIX, this.cap + 100);
    const extra = rows.slice(this.cap);
    await Promise.all(extra.map((r) => this.kv.delete(r.key)));
    return extra.length;
  }
}
