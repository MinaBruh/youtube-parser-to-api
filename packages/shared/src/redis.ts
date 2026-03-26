import { createClient } from 'redis';

export type SharedRedisClient = ReturnType<typeof createClient>;

const redisFailureCooldownMs = 30_000;
const defaultRedisKeyPrefix = 'ytpa';

let redisClientPromise: Promise<SharedRedisClient | null> | null = null;
let lastRedisFailureAt = 0;

const normalizeEnvValue = (value: string | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

export const getRedisUrl = (): string | null => {
  return normalizeEnvValue(process.env.YTPA_REDIS_URL)
    ?? normalizeEnvValue(process.env.REDIS_URL)
    ?? normalizeEnvValue(process.env.VALKEY_URL);
};

export const isRedisConfigured = (): boolean => {
  return getRedisUrl() !== null;
};

export const getRedisKeyPrefix = (): string => {
  return normalizeEnvValue(process.env.YTPA_REDIS_KEY_PREFIX) ?? defaultRedisKeyPrefix;
};

const createRedisClient = async (url: string): Promise<SharedRedisClient> => {
  const client = createClient({
    url,
    socket: {
      reconnectStrategy: (retries) => Math.min(50 * retries, 500),
    },
  });

  client.on('error', () => undefined);
  client.on('end', () => {
    redisClientPromise = null;
  });

  await client.connect();
  return client;
};

export const getRedisClient = async (): Promise<SharedRedisClient | null> => {
  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    return null;
  }

  if (!redisClientPromise && Date.now() - lastRedisFailureAt < redisFailureCooldownMs) {
    return null;
  }

  if (!redisClientPromise) {
    redisClientPromise = createRedisClient(redisUrl).catch(() => {
      lastRedisFailureAt = Date.now();
      redisClientPromise = null;
      return null;
    });
  }

  const client = await redisClientPromise;
  if (!client || !client.isOpen) {
    lastRedisFailureAt = Date.now();
    redisClientPromise = null;
    return null;
  }

  return client;
};

