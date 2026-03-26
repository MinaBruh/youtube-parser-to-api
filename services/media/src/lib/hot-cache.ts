import { Buffer } from 'node:buffer';
import type { CachedMediaResponse } from './disk-cache.js';

interface HotCacheEntry {
  value: CachedMediaResponse;
  sizeBytes: number;
}

interface MediaMemoryCacheConfig {
  enabled: boolean;
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

const isTruthyEnvFlag = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const parsePositiveIntegerEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const getMediaMemoryCacheConfig = (): MediaMemoryCacheConfig => {
  return {
    enabled: process.env.MEDIA_MEMORY_CACHE_ENABLED
      ? isTruthyEnvFlag(process.env.MEDIA_MEMORY_CACHE_ENABLED)
      : true,
    maxEntries: parsePositiveIntegerEnv(process.env.MEDIA_MEMORY_CACHE_MAX_ENTRIES, 512),
    maxEntryBytes: parsePositiveIntegerEnv(process.env.MEDIA_MEMORY_CACHE_MAX_ENTRY_BYTES, 4 * 1024 * 1024),
    maxTotalBytes: parsePositiveIntegerEnv(process.env.MEDIA_MEMORY_CACHE_MAX_TOTAL_BYTES, 64 * 1024 * 1024),
  };
};

const mediaMemoryCacheConfig = getMediaMemoryCacheConfig();
const hotEntries = new Map<string, HotCacheEntry>();
let currentSizeBytes = 0;

const cloneCachedMediaResponse = (entry: CachedMediaResponse): CachedMediaResponse => {
  return {
    statusCode: entry.statusCode,
    headers: { ...entry.headers },
    body: Buffer.from(entry.body),
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
  };
};

const deleteHotEntry = (key: string, entry: HotCacheEntry | undefined): void => {
  if (!entry) {
    return;
  }

  hotEntries.delete(key);
  currentSizeBytes = Math.max(0, currentSizeBytes - entry.sizeBytes);
};

const pruneExpiredEntries = (): void => {
  const now = Date.now();

  for (const [key, entry] of hotEntries.entries()) {
    if (entry.value.expiresAt <= now) {
      deleteHotEntry(key, entry);
    }
  }
};

const touchHotEntry = (key: string, entry: HotCacheEntry): void => {
  hotEntries.delete(key);
  hotEntries.set(key, entry);
};

const evictOverflowEntries = (): void => {
  while (
    hotEntries.size > mediaMemoryCacheConfig.maxEntries ||
    currentSizeBytes > mediaMemoryCacheConfig.maxTotalBytes
  ) {
    const oldestKey = hotEntries.keys().next().value;

    if (!oldestKey) {
      return;
    }

    deleteHotEntry(oldestKey, hotEntries.get(oldestKey));
  }
};

export const isMediaMemoryCacheEnabled = (): boolean => {
  return mediaMemoryCacheConfig.enabled;
};

export const readHotCachedMediaResponse = (
  key: string,
): CachedMediaResponse | null => {
  if (!mediaMemoryCacheConfig.enabled) {
    return null;
  }

  pruneExpiredEntries();

  const entry = hotEntries.get(key);
  if (!entry) {
    return null;
  }

  touchHotEntry(key, entry);
  return cloneCachedMediaResponse(entry.value);
};

export const writeHotCachedMediaResponse = (
  key: string,
  entry: CachedMediaResponse,
): boolean => {
  if (!mediaMemoryCacheConfig.enabled) {
    return false;
  }

  if (entry.expiresAt <= Date.now()) {
    return false;
  }

  const sizeBytes = entry.body.length;
  if (sizeBytes <= 0 || sizeBytes > mediaMemoryCacheConfig.maxEntryBytes) {
    return false;
  }

  pruneExpiredEntries();

  const clonedEntry = cloneCachedMediaResponse(entry);
  const existingEntry = hotEntries.get(key);
  if (existingEntry) {
    deleteHotEntry(key, existingEntry);
  }

  hotEntries.set(key, {
    value: clonedEntry,
    sizeBytes,
  });
  currentSizeBytes += sizeBytes;
  evictOverflowEntries();
  return hotEntries.has(key);
};
