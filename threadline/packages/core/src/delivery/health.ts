import type { ClassifiedError } from '../chat/errors';
import type { KvStore } from '../storage/kv';

export interface ConnectionHealth {
  state: 'ok' | 'error';
  lastSuccessAt?: number;
  lastErrorAt?: number;
  errorCode?: string;
  explanation?: string;
  helpUrl?: string;
}

const OK_REFRESH_MS = 10 * 60_000;

/**
 * Last-known delivery health per connection, for the admin banner. Failures are always written; successes
 * are written only when they change the state (or every 10 min), keeping KVS writes off the hot path.
 */
export class HealthStore {
  private readonly lastOkWrite = new Map<string, number>();

  constructor(private readonly kv: KvStore) {}

  private key(id: string) {
    return `health:${id}`;
  }

  async recordSuccess(connectionId: string, now: number): Promise<void> {
    const last = this.lastOkWrite.get(connectionId);
    if (last !== undefined && now - last < OK_REFRESH_MS) return;
    const prev = await this.kv.get<ConnectionHealth>(this.key(connectionId));
    if (prev?.state !== 'ok' || !prev.lastSuccessAt || now - prev.lastSuccessAt >= OK_REFRESH_MS) {
      await this.kv.set<ConnectionHealth>(this.key(connectionId), { state: 'ok', lastSuccessAt: now, lastErrorAt: prev?.lastErrorAt });
    }
    this.lastOkWrite.set(connectionId, now);
  }

  async recordFailure(connectionId: string, now: number, err: Pick<ClassifiedError, 'code' | 'explanation' | 'helpUrl'>): Promise<void> {
    this.lastOkWrite.delete(connectionId);
    const prev = await this.kv.get<ConnectionHealth>(this.key(connectionId));
    await this.kv.set<ConnectionHealth>(this.key(connectionId), {
      state: 'error',
      lastSuccessAt: prev?.lastSuccessAt,
      lastErrorAt: now,
      errorCode: err.code,
      explanation: err.explanation,
      helpUrl: err.helpUrl,
    });
  }

  async get(connectionId: string): Promise<ConnectionHealth | undefined> {
    return this.kv.get<ConnectionHealth>(this.key(connectionId));
  }

  async clear(connectionId: string): Promise<void> {
    this.lastOkWrite.delete(connectionId);
    await this.kv.delete(this.key(connectionId));
  }
}
