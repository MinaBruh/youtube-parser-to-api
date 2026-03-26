import {
  getRedisClient,
  getRedisKeyPrefix,
  isRedisConfigured,
} from '@ytpa/shared';

export type CacheLookupStatus = 'hit' | 'miss' | 'deduped';

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

interface InMemoryAsyncCacheOptions {
  maxEntries: number;
  redisKeyPrefix?: string;
}

export interface CacheLookupResult<T> {
  status: CacheLookupStatus;
  value: T;
}

const toPositiveInteger = (value: number, fallback: number): number => {
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

export class InMemoryAsyncCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;
  private readonly redisKeyPrefix: string;

  constructor(options: Partial<InMemoryAsyncCacheOptions> = {}) {
    this.maxEntries = toPositiveInteger(options.maxEntries ?? 500, 500);
    this.redisKeyPrefix = options.redisKeyPrefix?.trim() || 'response-cache';
  }

  private buildRedisKey(key: string): string {
    return `${getRedisKeyPrefix()}:${this.redisKeyPrefix}:${key}`;
  }

  private pruneExpiredEntries(): void {
    const now = Date.now();

    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  private touchEntry<T>(key: string, entry: CacheEntry<T>): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private evictOverflowEntries(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;

      if (!oldestKey) {
        return;
      }

      this.entries.delete(oldestKey);
    }
  }

  private async readFromRedis<T>(key: string): Promise<T | null> {
    if (!isRedisConfigured()) {
      return null;
    }

    try {
      const client = await getRedisClient();
      if (!client) {
        return null;
      }

      const encoded = await client.get(this.buildRedisKey(key));
      if (!encoded) {
        return null;
      }

      return JSON.parse(encoded) as T;
    } catch {
      return null;
    }
  }

  private async writeToRedis<T>(key: string, ttlMs: number, value: T): Promise<void> {
    if (!isRedisConfigured() || ttlMs <= 0) {
      return;
    }

    try {
      const client = await getRedisClient();
      if (!client) {
        return;
      }

      await client.set(this.buildRedisKey(key), JSON.stringify(value), {
        PX: ttlMs,
      });
    } catch {
      return;
    }
  }

  async getOrLoad<T>(
    key: string,
    ttlMs: number,
    load: () => Promise<T>,
  ): Promise<CacheLookupResult<T>> {
    const normalizedTtlMs = Math.max(0, ttlMs);
    this.pruneExpiredEntries();

    const cachedEntry = this.entries.get(key) as CacheEntry<T> | undefined;
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      this.touchEntry(key, cachedEntry);
      return {
        status: 'hit',
        value: cachedEntry.value,
      };
    }

    if (cachedEntry) {
      this.entries.delete(key);
    }

    const redisValue = await this.readFromRedis<T>(key);
    if (redisValue !== null) {
      if (normalizedTtlMs > 0) {
        const entry = {
          expiresAt: Date.now() + normalizedTtlMs,
          value: redisValue,
        } satisfies CacheEntry<T>;
        this.entries.set(key, entry);
        this.evictOverflowEntries();
      }

      return {
        status: 'hit',
        value: redisValue,
      };
    }

    const existingInFlight = this.inFlight.get(key) as Promise<T> | undefined;
    if (existingInFlight) {
      return {
        status: 'deduped',
        value: await existingInFlight,
      };
    }

    const loadPromise = load();
    this.inFlight.set(key, loadPromise);

    try {
      const value = await loadPromise;

      if (normalizedTtlMs > 0) {
        this.entries.set(key, {
          expiresAt: Date.now() + normalizedTtlMs,
          value,
        });
        this.evictOverflowEntries();
        void this.writeToRedis(key, normalizedTtlMs, value);
      }

      return {
        status: 'miss',
        value,
      };
    } finally {
      this.inFlight.delete(key);
    }
  }
}
