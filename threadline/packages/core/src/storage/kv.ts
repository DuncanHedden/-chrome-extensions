/**
 * Storage seam. The Forge adapter maps these onto @forge/kvs; tests and the integration simulator use MemoryKv.
 * Kept deliberately small so the Confluence app and any future backend can implement it.
 */
export interface KvSetOptions {
  ttlSeconds?: number;
}

export interface KvEntry<T> {
  key: string;
  value: T;
}

export interface KvStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, options?: KvSetOptions): Promise<void>;
  /** Atomic create. Returns false (no write) when the key already exists. */
  setIfAbsent<T>(key: string, value: T, options?: KvSetOptions): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Keys starting with `prefix`, in ascending key order. May be eventually consistent. */
  listByPrefix<T>(prefix: string, limit: number): Promise<KvEntry<T>[]>;
}

export interface SecretStore {
  getSecret(key: string): Promise<string | undefined>;
  setSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
}

export class MemoryKv implements KvStore, SecretStore {
  readonly data = new Map<string, { value: unknown; expires?: number }>();
  readonly secrets = new Map<string, string>();
  constructor(private readonly now: () => number = Date.now) {}

  private live(key: string) {
    const e = this.data.get(key);
    if (e?.expires !== undefined && e.expires <= this.now()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }

  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.live(key)?.value as T | undefined);
  }

  async set<T>(key: string, value: T, options?: KvSetOptions): Promise<void> {
    const expires = options?.ttlSeconds ? this.now() + options.ttlSeconds * 1000 : undefined;
    this.data.set(key, { value: structuredClone(value), expires });
  }

  async setIfAbsent<T>(key: string, value: T, options?: KvSetOptions): Promise<boolean> {
    if (this.live(key)) return false;
    await this.set(key, value, options);
    return true;
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async listByPrefix<T>(prefix: string, limit: number): Promise<KvEntry<T>[]> {
    const keys = [...this.data.keys()].filter((k) => k.startsWith(prefix) && this.live(k)).sort();
    return keys.slice(0, limit).map((key) => ({ key, value: structuredClone(this.data.get(key)!.value as T) }));
  }

  async getSecret(key: string) {
    return this.secrets.get(key);
  }
  async setSecret(key: string, value: string) {
    this.secrets.set(key, value);
  }
  async deleteSecret(key: string) {
    this.secrets.delete(key);
  }
}
