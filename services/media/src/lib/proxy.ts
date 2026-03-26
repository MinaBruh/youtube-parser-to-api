import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createErrorPayload, withRetries } from '@ytpa/shared';
import {
  type CachedMediaResponse,
  readCachedMediaResponse,
  writeCachedMediaResponse,
} from './disk-cache.js';
import {
  readHotCachedMediaResponse,
  writeHotCachedMediaResponse,
} from './hot-cache.js';

const defaultAllowedHostSuffixes = [
  'youtube.com',
  'youtube-nocookie.com',
  'googlevideo.com',
  'ytimg.com',
  'googleusercontent.com',
];

const forwardedRequestHeaderNames = [
  'range',
  'if-match',
  'if-none-match',
  'if-modified-since',
  'if-unmodified-since',
  'if-range',
  'accept',
  'user-agent',
] as const;

const hopByHopResponseHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const cachedResponseHeaderNames = [
  'accept-ranges',
  'cache-control',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'expires',
  'last-modified',
] as const;

type MediaCacheState = 'memory-hit' | 'disk-hit' | 'coalesced' | 'miss' | 'bypass';

interface MediaProxyQuerystring {
  url?: string;
}

interface ExactByteRange {
  start: number;
  end: number;
  length: number;
}

interface CacheCandidate {
  key: string;
  exactRange: ExactByteRange | null;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

const parsePositiveIntegerEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const mediaDiskCacheConfig = {
  maxAssetBytes: parsePositiveIntegerEnv(process.env.MEDIA_DISK_CACHE_MAX_ASSET_BYTES, 8 * 1024 * 1024),
  maxRangeBytes: parsePositiveIntegerEnv(process.env.MEDIA_DISK_CACHE_MAX_RANGE_BYTES, 2 * 1024 * 1024),
  defaultTtlMs: parsePositiveIntegerEnv(process.env.MEDIA_DISK_CACHE_DEFAULT_TTL_MS, 6 * 60 * 60 * 1000),
  maxTtlMs: parsePositiveIntegerEnv(process.env.MEDIA_DISK_CACHE_MAX_TTL_MS, 24 * 60 * 60 * 1000),
} as const;

const inFlightCacheableRequests = new Map<string, Deferred<CachedMediaResponse | null>>();

const isTruthyEnvFlag = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
};

const getAllowedHostSuffixes = (): string[] => {
  const extraHosts = (process.env.MEDIA_PROXY_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);

  return [...new Set([...defaultAllowedHostSuffixes, ...extraHosts])];
};

const isLoopbackOrPrivateIpv4 = (hostname: string): boolean => {
  const parts = hostname.split('.').map((part) => Number(part));

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }

  const [first, second] = parts;

  if (first === 127 || first === 10) {
    return true;
  }

  if (first === 192 && second === 168) {
    return true;
  }

  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }

  if (first === 169 && second === 254) {
    return true;
  }

  return false;
};

const isLocalHostname = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase();

  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    isLoopbackOrPrivateIpv4(normalized) ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  );
};

const isAllowedHost = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase();
  const allowedHostSuffixes = getAllowedHostSuffixes();

  return allowedHostSuffixes.some((suffix) => {
    return normalized === suffix || normalized.endsWith(`.${suffix}`);
  });
};

const parseTargetUrl = (value: string | undefined): URL | null => {
  if (!value || value.trim().length === 0) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const hasConditionalHeaders = (request: FastifyRequest): boolean => {
  return Boolean(
    request.headers['if-match'] ||
      request.headers['if-none-match'] ||
      request.headers['if-modified-since'] ||
      request.headers['if-unmodified-since'] ||
      request.headers['if-range'],
  );
};

const parseExactByteRange = (value: string | undefined): ExactByteRange | null => {
  if (!value) {
    return null;
  }

  const match = /^bytes=(\d+)-(\d+)$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
    return null;
  }

  return {
    start,
    end,
    length: end - start + 1,
  };
};

const buildMediaCacheKey = (targetUrl: URL, rangeHeader: string | null): string => {
  return JSON.stringify({
    targetUrl: targetUrl.toString(),
    range: rangeHeader,
  });
};

const getCacheCandidate = (
  request: FastifyRequest,
  method: 'GET' | 'HEAD',
  targetUrl: URL,
): CacheCandidate | null => {
  if (!['GET', 'HEAD'].includes(method) || hasConditionalHeaders(request)) {
    return null;
  }

  const rawRange = typeof request.headers.range === 'string' ? request.headers.range : null;
  if (rawRange && !parseExactByteRange(rawRange)) {
    return null;
  }

  return {
    key: buildMediaCacheKey(targetUrl, rawRange),
    exactRange: rawRange ? parseExactByteRange(rawRange) : null,
  };
};

const parseCacheControl = (value: string | null): Map<string, string | true> => {
  const directives = new Map<string, string | true>();

  if (!value) {
    return directives;
  }

  for (const part of value.split(',')) {
    const [rawKey, rawDirectiveValue] = part.trim().split('=');
    const key = rawKey?.trim().toLowerCase();

    if (!key) {
      continue;
    }

    directives.set(key, rawDirectiveValue ? rawDirectiveValue.trim() : true);
  }

  return directives;
};

const resolveTtlMs = (upstreamResponse: Response): number => {
  const directives = parseCacheControl(upstreamResponse.headers.get('cache-control'));

  if (directives.has('no-store') || directives.has('private')) {
    return 0;
  }

  const maxAge = directives.get('s-maxage') ?? directives.get('max-age');
  if (typeof maxAge === 'string') {
    const seconds = Number(maxAge);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(mediaDiskCacheConfig.maxTtlMs, seconds * 1000);
    }
  }

  if (directives.has('immutable')) {
    return mediaDiskCacheConfig.maxTtlMs;
  }

  return mediaDiskCacheConfig.defaultTtlMs;
};

const isCacheableContentType = (contentType: string | null): boolean => {
  if (!contentType) {
    return false;
  }

  const normalized = contentType.toLowerCase();
  return (
    normalized.startsWith('image/') ||
    normalized.startsWith('text/') ||
    normalized.includes('application/json') ||
    normalized.includes('application/xml') ||
    normalized.includes('application/ttml+xml') ||
    normalized.includes('application/dash+xml') ||
    normalized.includes('application/vnd.apple.mpegurl') ||
    normalized.includes('application/x-mpegurl') ||
    normalized.includes('audio/mpegurl')
  );
};

const parseContentLength = (value: string | null): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

const getCacheableBodyLimit = (
  upstreamResponse: Response,
  cacheCandidate: CacheCandidate,
): number | null => {
  if (![200, 206].includes(upstreamResponse.status)) {
    return null;
  }

  if (cacheCandidate.exactRange) {
    if (upstreamResponse.status !== 206 || cacheCandidate.exactRange.length > mediaDiskCacheConfig.maxRangeBytes) {
      return null;
    }

    return cacheCandidate.exactRange.length;
  }

  if (!isCacheableContentType(upstreamResponse.headers.get('content-type'))) {
    return null;
  }

  const contentLength = parseContentLength(upstreamResponse.headers.get('content-length'));
  if (contentLength === null || contentLength > mediaDiskCacheConfig.maxAssetBytes) {
    return null;
  }

  return contentLength;
};

const toCachedHeaders = (upstreamResponse: Response, bodyLength: number): Record<string, string> => {
  const headers: Record<string, string> = {
    'content-length': String(bodyLength),
  };

  for (const headerName of cachedResponseHeaderNames) {
    const value = upstreamResponse.headers.get(headerName);

    if (value) {
      headers[headerName] = headerName === 'content-length' ? String(bodyLength) : value;
    }
  }

  return headers;
};

const copyCachedHeaders = (reply: FastifyReply, headers: Record<string, string>): void => {
  for (const [key, value] of Object.entries(headers)) {
    reply.header(key, value);
  }
};

const cloneCachedMediaResponse = (entry: CachedMediaResponse): CachedMediaResponse => {
  return {
    statusCode: entry.statusCode,
    headers: { ...entry.headers },
    body: Buffer.from(entry.body),
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
  };
};

const sendCachedMediaResponse = (
  reply: FastifyReply,
  method: 'GET' | 'HEAD',
  cacheState: MediaCacheState,
  cachedResponse: CachedMediaResponse,
): FastifyReply => {
  reply.header('X-YTPA-Media-Cache', cacheState);
  reply.code(cachedResponse.statusCode);
  copyCachedHeaders(reply, cachedResponse.headers);

  if (method === 'HEAD') {
    return reply.send();
  }

  return reply.send(Buffer.from(cachedResponse.body));
};

const writeThroughMediaCaches = async (
  key: string,
  entry: CachedMediaResponse,
): Promise<void> => {
  writeHotCachedMediaResponse(key, entry);
  await writeCachedMediaResponse(key, entry);
};

const readThroughMediaCaches = async (
  key: string,
): Promise<{ state: 'memory-hit' | 'disk-hit'; entry: CachedMediaResponse } | null> => {
  const hotEntry = readHotCachedMediaResponse(key);
  if (hotEntry) {
    return {
      state: 'memory-hit',
      entry: hotEntry,
    };
  }

  const diskEntry = await readCachedMediaResponse(key);
  if (!diskEntry) {
    return null;
  }

  writeHotCachedMediaResponse(key, diskEntry);
  return {
    state: 'disk-hit',
    entry: diskEntry,
  };
};

export const validateTargetUrl = (targetUrl: URL): string | null => {
  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    return 'Only http and https upstream URLs are supported.';
  }

  if (isLocalHostname(targetUrl.hostname) && !isTruthyEnvFlag(process.env.MEDIA_PROXY_ALLOW_LOCALHOST)) {
    return 'Local and private upstream hosts are blocked unless MEDIA_PROXY_ALLOW_LOCALHOST=1 is set.';
  }

  if (!isLocalHostname(targetUrl.hostname) && !isAllowedHost(targetUrl.hostname)) {
    return `Target host is not allowed. Allowed suffixes: ${getAllowedHostSuffixes().join(', ')}.`;
  }

  return null;
};

const buildUpstreamHeaders = (request: FastifyRequest): Headers => {
  const headers = new Headers();

  headers.set('accept-encoding', 'identity');
  headers.set('user-agent', 'youtube-proxy-api/0.1');

  for (const headerName of forwardedRequestHeaderNames) {
    const value = request.headers[headerName];

    if (typeof value === 'string' && value.length > 0) {
      headers.set(headerName, value);
    }
  }

  return headers;
};

const isRetryableProxyFetchError = (error: unknown): boolean => {
  return error instanceof TypeError;
};

const copyUpstreamHeaders = (reply: FastifyReply, upstreamResponse: Response): void => {
  upstreamResponse.headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase();

    if (hopByHopResponseHeaders.has(normalizedKey)) {
      return;
    }

    reply.header(key, value);
  });
};

export const proxyTargetUrlRequest = async (
  request: FastifyRequest,
  reply: FastifyReply,
  method: 'GET' | 'HEAD',
  targetUrl: URL,
): Promise<FastifyReply | void> => {
  const validationError = validateTargetUrl(targetUrl);

  if (validationError) {
    return reply.code(403).send(createErrorPayload(403, validationError));
  }

  const cacheCandidate = getCacheCandidate(request, method, targetUrl);

  if (cacheCandidate) {
    const cachedLookup = await readThroughMediaCaches(cacheCandidate.key);
    if (cachedLookup) {
      return sendCachedMediaResponse(reply, method, cachedLookup.state, cachedLookup.entry);
    }

    const existingInFlight = inFlightCacheableRequests.get(cacheCandidate.key);
    if (existingInFlight) {
      try {
        const coalescedEntry = await existingInFlight.promise;
        if (coalescedEntry) {
          return sendCachedMediaResponse(reply, method, 'coalesced', coalescedEntry);
        }
      } catch (error) {
        request.log.warn(
          { err: error, method, targetUrl: targetUrl.toString() },
          'Coalesced media request leader failed, retrying locally',
        );
      }

      const cachedLookupAfterWait = await readThroughMediaCaches(cacheCandidate.key);
      if (cachedLookupAfterWait) {
        return sendCachedMediaResponse(reply, method, 'coalesced', cachedLookupAfterWait.entry);
      }
    }
  }

  let cacheDeferred: Deferred<CachedMediaResponse | null> | null = null;

  if (method === 'GET' && cacheCandidate) {
    cacheDeferred = createDeferred<CachedMediaResponse | null>();
    inFlightCacheableRequests.set(cacheCandidate.key, cacheDeferred);
  }

  try {
    const upstreamResponse = await withRetries(
      async () => {
        return fetch(targetUrl, {
          method,
          headers: buildUpstreamHeaders(request),
          redirect: 'follow',
          signal: AbortSignal.timeout(30_000),
        });
      },
      {
        maxAttempts: 3,
        initialDelayMs: 250,
        maxDelayMs: 1_000,
        shouldRetry: (error) => isRetryableProxyFetchError(error),
        onRetry: ({ attempt, nextDelayMs, error }) => {
          request.log.warn(
            { err: error, attempt, nextDelayMs, method, targetUrl: targetUrl.toString() },
            'Retrying transient upstream media request',
          );
        },
      },
    );

    if (method === 'GET' && cacheCandidate && upstreamResponse.body) {
      const cacheableBodyLimit = getCacheableBodyLimit(upstreamResponse, cacheCandidate);
      const ttlMs = resolveTtlMs(upstreamResponse);

      if (cacheableBodyLimit !== null && ttlMs > 0) {
        const body = Buffer.from(await upstreamResponse.arrayBuffer());

        if (body.length <= cacheableBodyLimit) {
          const cachedEntry: CachedMediaResponse = {
            statusCode: upstreamResponse.status,
            headers: toCachedHeaders(upstreamResponse, body.length),
            body,
            createdAt: Date.now(),
            expiresAt: Date.now() + ttlMs,
          };

          await writeThroughMediaCaches(cacheCandidate.key, cachedEntry);
          cacheDeferred?.resolve(cloneCachedMediaResponse(cachedEntry));
          return sendCachedMediaResponse(reply, method, 'miss', cachedEntry);
        }
      }
    }

    cacheDeferred?.resolve(null);
    reply.header('X-YTPA-Media-Cache', 'bypass');
    reply.code(upstreamResponse.status);
    copyUpstreamHeaders(reply, upstreamResponse);

    if (method === 'HEAD' || !upstreamResponse.body) {
      return reply.send();
    }

    return reply.send(Readable.fromWeb(upstreamResponse.body));
  } catch (error) {
    cacheDeferred?.reject(error);
    request.log.error(
      { err: error, method, targetUrl: targetUrl.toString() },
      'Failed to proxy upstream media request',
    );

    return reply.code(502).send(
      createErrorPayload(502, 'Failed to proxy upstream media request.'),
    );
  } finally {
    if (cacheCandidate && cacheDeferred) {
      const currentDeferred = inFlightCacheableRequests.get(cacheCandidate.key);
      if (currentDeferred === cacheDeferred) {
        inFlightCacheableRequests.delete(cacheCandidate.key);
      }
    }
  }
};

export const proxyMediaRequest = async (
  request: FastifyRequest<{ Querystring: MediaProxyQuerystring }>,
  reply: FastifyReply,
  method: 'GET' | 'HEAD',
): Promise<FastifyReply | void> => {
  const targetUrl = parseTargetUrl(request.query.url);

  if (!targetUrl) {
    return reply.code(400).send(
      createErrorPayload(400, 'Query parameter "url" must be a valid absolute URL.'),
    );
  }

  return proxyTargetUrlRequest(request, reply, method, targetUrl);
};
