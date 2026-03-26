import { getRedisClient, getRedisKeyPrefix, isRedisConfigured } from './redis.js';

export interface FixedWindowRateLimitOptions {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  keyPrefix?: string;
}

interface FixedWindowRateLimitState {
  count: number;
  resetAt: number;
  lastSeenAt: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

const fixedWindowRedisScript = `
local current = redis.call('INCRBY', KEYS[1], ARGV[1])
if current == tonumber(ARGV[1]) then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
`;

const toPositiveInteger = (value: number, fallback: number): number => {
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

const createDecision = (
  limit: number,
  count: number,
  resetAt: number,
  now: number,
): RateLimitDecision => {
  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
  };
};

export class InMemoryFixedWindowRateLimiter {
  private readonly states = new Map<string, FixedWindowRateLimitState>();
  readonly limit: number;
  readonly windowMs: number;
  readonly maxKeys: number;

  constructor(options: FixedWindowRateLimitOptions) {
    this.limit = toPositiveInteger(options.limit, 1);
    this.windowMs = toPositiveInteger(options.windowMs, 60_000);
    this.maxKeys = toPositiveInteger(options.maxKeys ?? 10_000, 10_000);
  }

  private pruneExpiredStates(): void {
    const now = Date.now();

    for (const [key, state] of this.states.entries()) {
      if (state.resetAt <= now) {
        this.states.delete(key);
      }
    }
  }

  private touchState(key: string, state: FixedWindowRateLimitState): void {
    this.states.delete(key);
    this.states.set(key, state);
  }

  private evictOverflowStates(): void {
    while (this.states.size > this.maxKeys) {
      const oldestKey = this.states.keys().next().value;

      if (!oldestKey) {
        return;
      }

      this.states.delete(oldestKey);
    }
  }

  consume(key: string, cost = 1): RateLimitDecision {
    const normalizedCost = Math.max(1, Math.trunc(cost));
    const now = Date.now();
    this.pruneExpiredStates();

    let state = this.states.get(key);
    if (!state || state.resetAt <= now) {
      state = {
        count: 0,
        resetAt: now + this.windowMs,
        lastSeenAt: now,
      };
    }

    state.count += normalizedCost;
    state.lastSeenAt = now;
    this.touchState(key, state);
    this.evictOverflowStates();

    return createDecision(this.limit, state.count, state.resetAt, now);
  }
}

export class FixedWindowRateLimiter {
  private readonly fallbackLimiter: InMemoryFixedWindowRateLimiter;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly redisKeyPrefix: string;

  constructor(options: FixedWindowRateLimitOptions) {
    this.fallbackLimiter = new InMemoryFixedWindowRateLimiter(options);
    this.limit = this.fallbackLimiter.limit;
    this.windowMs = this.fallbackLimiter.windowMs;
    this.redisKeyPrefix = options.keyPrefix?.trim() || 'rate-limit';
  }

  private buildRedisKey(key: string): string {
    return `${getRedisKeyPrefix()}:${this.redisKeyPrefix}:${key}`;
  }

  async consume(key: string, cost = 1): Promise<RateLimitDecision> {
    const normalizedCost = Math.max(1, Math.trunc(cost));

    if (!isRedisConfigured()) {
      return this.fallbackLimiter.consume(key, normalizedCost);
    }

    try {
      const client = await getRedisClient();
      if (!client) {
        return this.fallbackLimiter.consume(key, normalizedCost);
      }

      const redisKey = this.buildRedisKey(key);
      const rawResult = await client.eval(fixedWindowRedisScript, {
        keys: [redisKey],
        arguments: [String(normalizedCost), String(this.windowMs)],
      }) as unknown;

      if (!Array.isArray(rawResult) || rawResult.length < 2) {
        return this.fallbackLimiter.consume(key, normalizedCost);
      }

      const count = Number(rawResult[0]);
      const ttlMs = Number(rawResult[1]);
      const now = Date.now();
      const normalizedTtlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : this.windowMs;

      return createDecision(this.limit, count, now + normalizedTtlMs, now);
    } catch {
      return this.fallbackLimiter.consume(key, normalizedCost);
    }
  }
}
