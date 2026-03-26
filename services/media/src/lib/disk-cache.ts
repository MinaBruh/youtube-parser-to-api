import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export interface CachedMediaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer;
  createdAt: number;
  expiresAt: number;
}

export interface MediaDiskCacheConfig {
  enabled: boolean;
  rootDir: string;
  maxTotalBytes: number;
  sweepIntervalMs: number;
}

interface CachedMediaMetadata {
  statusCode: number;
  headers: Record<string, string>;
  createdAt: number;
  expiresAt: number;
  bodyBytes?: number;
}

interface DiskCacheEntryPaths {
  directory: string;
  metadataPath: string;
  bodyPath: string;
}

interface DiskCacheIndexEntry {
  paths: DiskCacheEntryPaths;
  metadata: CachedMediaMetadata;
  bodyBytes: number;
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

const getMediaDiskCacheConfig = (): MediaDiskCacheConfig => {
  const configuredRootDir = process.env.MEDIA_DISK_CACHE_DIR?.trim();

  return {
    enabled: process.env.MEDIA_DISK_CACHE_ENABLED
      ? isTruthyEnvFlag(process.env.MEDIA_DISK_CACHE_ENABLED)
      : true,
    rootDir: configuredRootDir
      ? resolve(configuredRootDir)
      : resolve(process.cwd(), 'var/media-cache'),
    maxTotalBytes: parsePositiveIntegerEnv(process.env.MEDIA_DISK_CACHE_MAX_TOTAL_BYTES, 2 * 1024 * 1024 * 1024),
    sweepIntervalMs: parsePositiveIntegerEnv(process.env.MEDIA_DISK_CACHE_SWEEP_INTERVAL_MS, 5 * 60 * 1000),
  };
};

const mediaDiskCacheConfig = getMediaDiskCacheConfig();
let cleanupInFlight: Promise<void> | null = null;
let lastCleanupAt = 0;

const toHash = (key: string): string => {
  return createHash('sha256').update(key).digest('hex');
};

const getEntryPaths = (hash: string): DiskCacheEntryPaths => {
  const directory = join(mediaDiskCacheConfig.rootDir, hash.slice(0, 2), hash.slice(2, 4));
  return {
    directory,
    metadataPath: join(directory, `${hash}.json`),
    bodyPath: join(directory, `${hash}.bin`),
  };
};

const safeDelete = async (path: string): Promise<void> => {
  try {
    await rm(path, { force: true });
  } catch {
    return;
  }
};

const safeStat = async (path: string): Promise<Awaited<ReturnType<typeof stat>> | null> => {
  try {
    return await stat(path);
  } catch {
    return null;
  }
};

const deleteEntryFiles = async (paths: DiskCacheEntryPaths): Promise<void> => {
  await Promise.all([
    safeDelete(paths.metadataPath),
    safeDelete(paths.bodyPath),
  ]);
};

const walkDirectory = async (directoryPath: string): Promise<string[]> => {
  let dirents;

  try {
    dirents = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];

  for (const dirent of dirents) {
    const absolutePath = join(directoryPath, dirent.name);

    if (dirent.isDirectory()) {
      files.push(...await walkDirectory(absolutePath));
      continue;
    }

    if (dirent.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
};

const listMetadataPaths = async (): Promise<string[]> => {
  const files = await walkDirectory(mediaDiskCacheConfig.rootDir);
  return files.filter((filePath) => filePath.endsWith('.json'));
};

const toPathsFromMetadataPath = (metadataPath: string): DiskCacheEntryPaths => {
  const bodyPath = metadataPath.replace(/\.json$/i, '.bin');
  return {
    directory: dirname(metadataPath),
    metadataPath,
    bodyPath,
  };
};

const loadDiskCacheIndexEntry = async (
  metadataPath: string,
): Promise<DiskCacheIndexEntry | null> => {
  const paths = toPathsFromMetadataPath(metadataPath);

  try {
    const metadataBuffer = await readFile(paths.metadataPath, 'utf8');
    const metadata = JSON.parse(metadataBuffer) as CachedMediaMetadata;
    const bodyStats = await safeStat(paths.bodyPath);

    if (!bodyStats?.isFile()) {
      await deleteEntryFiles(paths);
      return null;
    }

    if (metadata.expiresAt <= Date.now()) {
      await deleteEntryFiles(paths);
      return null;
    }

    return {
      paths,
      metadata,
      bodyBytes: metadata.bodyBytes ?? Number(bodyStats.size),
    };
  } catch {
    await deleteEntryFiles(paths);
    return null;
  }
};

const sweepDiskCacheInternal = async (): Promise<void> => {
  const metadataPaths = await listMetadataPaths();
  const entries = await Promise.all(metadataPaths.map((metadataPath) => loadDiskCacheIndexEntry(metadataPath)));
  const validEntries = entries.filter((entry): entry is DiskCacheIndexEntry => entry !== null);

  let totalBytes = validEntries.reduce((sum, entry) => sum + entry.bodyBytes, 0);
  if (totalBytes <= mediaDiskCacheConfig.maxTotalBytes) {
    return;
  }

  const evictionCandidates = [...validEntries].sort((left, right) => {
    return left.metadata.createdAt - right.metadata.createdAt;
  });

  for (const entry of evictionCandidates) {
    if (totalBytes <= mediaDiskCacheConfig.maxTotalBytes) {
      break;
    }

    await deleteEntryFiles(entry.paths);
    totalBytes = Math.max(0, totalBytes - entry.bodyBytes);
  }
};

const runDiskCacheCleanup = async (force = false): Promise<void> => {
  if (!mediaDiskCacheConfig.enabled) {
    return;
  }

  const now = Date.now();
  if (!force && now - lastCleanupAt < mediaDiskCacheConfig.sweepIntervalMs) {
    return;
  }

  if (cleanupInFlight) {
    return cleanupInFlight;
  }

  cleanupInFlight = (async () => {
    try {
      await sweepDiskCacheInternal();
    } finally {
      cleanupInFlight = null;
      lastCleanupAt = Date.now();
    }
  })();

  return cleanupInFlight;
};

const scheduleDiskCacheCleanup = (): void => {
  void runDiskCacheCleanup(false);
};

export const isMediaDiskCacheEnabled = (): boolean => {
  return mediaDiskCacheConfig.enabled;
};

export const readCachedMediaResponse = async (
  key: string,
): Promise<CachedMediaResponse | null> => {
  if (!mediaDiskCacheConfig.enabled) {
    return null;
  }

  scheduleDiskCacheCleanup();
  const paths = getEntryPaths(toHash(key));

  try {
    const [metadataBuffer, body] = await Promise.all([
      readFile(paths.metadataPath, 'utf8'),
      readFile(paths.bodyPath),
    ]);
    const metadata = JSON.parse(metadataBuffer) as CachedMediaMetadata;

    if (metadata.expiresAt <= Date.now()) {
      await deleteEntryFiles(paths);
      return null;
    }

    return {
      statusCode: metadata.statusCode,
      headers: metadata.headers,
      body,
      createdAt: metadata.createdAt,
      expiresAt: metadata.expiresAt,
    };
  } catch {
    return null;
  }
};

export const writeCachedMediaResponse = async (
  key: string,
  entry: CachedMediaResponse,
): Promise<void> => {
  if (!mediaDiskCacheConfig.enabled) {
    return;
  }

  const hash = toHash(key);
  const paths = getEntryPaths(hash);

  await mkdir(dirname(paths.metadataPath), { recursive: true });

  const metadata: CachedMediaMetadata = {
    statusCode: entry.statusCode,
    headers: entry.headers,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
    bodyBytes: entry.body.length,
  };

  await Promise.all([
    writeFile(paths.metadataPath, JSON.stringify(metadata)),
    writeFile(paths.bodyPath, entry.body),
  ]);

  scheduleDiskCacheCleanup();
};

export const runMediaDiskCacheCleanup = async (): Promise<void> => {
  await runDiskCacheCleanup(true);
};

