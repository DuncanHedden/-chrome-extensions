type AreaName = 'sync' | 'local';

export interface Store<T extends object> {
  get(): Promise<T>;
  set(patch: Partial<T>): Promise<void>;
  /** Overwrite the whole value (no merge), e.g. to drop fields that no longer apply. */
  replace(value: T): Promise<void>;
  /** Calls `listener` with the merged value whenever this key changes in any context. Returns an unsubscribe fn. */
  watch(listener: (value: T) => void): () => void;
}

/**
 * A typed, defaults-merged view over one key in chrome.storage.
 * Stored values are shallow-merged over `defaults`, so adding a field later needs no migration.
 */
export function createStore<T extends object>(area: AreaName, key: string, defaults: T): Store<T> {
  // Resolved lazily so modules that define stores can be imported outside an extension (e.g. unit tests).
  const storage = () => chrome.storage[area];
  const merge = (raw: unknown): T => ({ ...defaults, ...(raw && typeof raw === 'object' ? raw : {}) });

  return {
    async get() {
      const result = await storage().get(key);
      return merge(result[key]);
    },
    async set(patch) {
      const current = await this.get();
      await storage().set({ [key]: { ...current, ...patch } });
    },
    async replace(value) {
      await storage().set({ [key]: value });
    },
    watch(listener) {
      const onChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
        const change = changes[key];
        if (areaName === area && change) listener(merge(change.newValue));
      };
      chrome.storage.onChanged.addListener(onChanged);
      return () => chrome.storage.onChanged.removeListener(onChanged);
    },
  };
}
