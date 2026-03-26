import Fastify, { type FastifyRequest } from 'fastify';
import {
  createErrorPayload,
  createHealthPayload,
  getDefaultPort,
  FixedWindowRateLimiter,
  type ServiceName,
} from '@ytpa/shared';
import { proxyVideoDashManifestRequest, proxyVideoHlsManifestRequest } from './lib/manifest.js';
import { proxyMediaRequest } from './lib/proxy.js';
import { proxyVideoStoryboardRequest } from './lib/storyboard.js';
import { proxyVideoStreamRequest } from './lib/stream.js';

const serviceName: ServiceName = 'media';
const port = Number(process.env.MEDIA_PORT ?? getDefaultPort(serviceName));

const parsePositiveIntegerEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseNonNegativeIntegerEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const getClientAddress = (request: FastifyRequest): string => {
  const forwardedFor = request.headers['x-forwarded-for'];
  const rawForwardedFor = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const firstForwardedAddress = rawForwardedFor?.split(',')[0]?.trim();

  return firstForwardedAddress || request.ip || request.socket.remoteAddress || 'unknown';
};

const getRequestPathname = (request: FastifyRequest): string => {
  return (request.raw.url ?? '/').split('?')[0] || '/';
};

const mediaRateLimitConfig = {
  limit: parseNonNegativeIntegerEnv(process.env.MEDIA_RATE_LIMIT_MAX_REQUESTS, 900),
  windowMs: parsePositiveIntegerEnv(process.env.MEDIA_RATE_LIMIT_WINDOW_MS, 60_000),
  maxKeys: parsePositiveIntegerEnv(process.env.MEDIA_RATE_LIMIT_MAX_KEYS, 10_000),
} as const;

const mediaRateLimiter = mediaRateLimitConfig.limit > 0
  ? new FixedWindowRateLimiter({
      ...mediaRateLimitConfig,
      keyPrefix: 'media:rate-limit',
    })
  : null;

interface MediaProxyQuerystring {
  url?: string;
}

interface VideoStreamParams {
  videoId: string;
}

interface VideoStreamQuerystring {
  itag?: string;
}

interface VideoManifestQuerystring {
  url?: string;
}

interface VideoStoryboardParams {
  videoId: string;
  storyboardId: string;
  sheetIndex: string;
}

const app = Fastify({
  logger: true,
  exposeHeadRoutes: false,
});

app.addHook('onRequest', async (request, reply) => {
  if (!mediaRateLimiter) {
    return;
  }

  const pathname = getRequestPathname(request);
  if (pathname === '/health') {
    return;
  }

  const decision = await mediaRateLimiter.consume(getClientAddress(request));
  const resetAfterSeconds = Math.max(0, Math.ceil((decision.resetAt - Date.now()) / 1000));

  reply.header('RateLimit-Limit', String(decision.limit));
  reply.header('RateLimit-Remaining', String(decision.remaining));
  reply.header('RateLimit-Reset', String(resetAfterSeconds));
  reply.header('RateLimit-Policy', `${decision.limit};w=${Math.max(1, Math.ceil(mediaRateLimitConfig.windowMs / 1000))}`);

  if (!decision.allowed) {
    return reply
      .header('Retry-After', String(decision.retryAfterSeconds))
      .code(429)
      .send(createErrorPayload(429, 'Rate limit exceeded.', [
        `Try again in ${decision.retryAfterSeconds} seconds.`,
      ]));
  }
});

app.get('/health', async () => {
  return createHealthPayload(serviceName);
});

app.get<{ Querystring: MediaProxyQuerystring }>('/v1/media/proxy', async (request, reply) => {
  return proxyMediaRequest(request, reply, 'GET');
});

app.head<{ Querystring: MediaProxyQuerystring }>('/v1/media/proxy', async (request, reply) => {
  return proxyMediaRequest(request, reply, 'HEAD');
});

app.get<{ Querystring: MediaProxyQuerystring }>('/v1/media/image', async (request, reply) => {
  return proxyMediaRequest(request, reply, 'GET');
});

app.head<{ Querystring: MediaProxyQuerystring }>('/v1/media/image', async (request, reply) => {
  return proxyMediaRequest(request, reply, 'HEAD');
});

app.get<{
  Params: VideoStreamParams;
  Querystring: VideoStreamQuerystring;
}>('/v1/media/video/:videoId/stream', async (request, reply) => {
  return proxyVideoStreamRequest(request, reply, 'GET');
});

app.head<{
  Params: VideoStreamParams;
  Querystring: VideoStreamQuerystring;
}>('/v1/media/video/:videoId/stream', async (request, reply) => {
  return proxyVideoStreamRequest(request, reply, 'HEAD');
});

app.get<{
  Params: VideoStreamParams;
}>('/v1/media/video/:videoId/dash.mpd', async (request, reply) => {
  return proxyVideoDashManifestRequest(request, reply, 'GET');
});

app.head<{
  Params: VideoStreamParams;
}>('/v1/media/video/:videoId/dash.mpd', async (request, reply) => {
  return proxyVideoDashManifestRequest(request, reply, 'HEAD');
});

app.get<{
  Params: VideoStreamParams;
  Querystring: VideoManifestQuerystring;
}>('/v1/media/video/:videoId/hls.m3u8', async (request, reply) => {
  return proxyVideoHlsManifestRequest(request, reply, 'GET');
});

app.head<{
  Params: VideoStreamParams;
  Querystring: VideoManifestQuerystring;
}>('/v1/media/video/:videoId/hls.m3u8', async (request, reply) => {
  return proxyVideoHlsManifestRequest(request, reply, 'HEAD');
});

app.get<{
  Params: VideoStoryboardParams;
}>('/v1/media/video/:videoId/storyboards/:storyboardId/sheets/:sheetIndex', async (request, reply) => {
  return proxyVideoStoryboardRequest(request, reply, 'GET');
});

app.head<{
  Params: VideoStoryboardParams;
}>('/v1/media/video/:videoId/storyboards/:storyboardId/sheets/:sheetIndex', async (request, reply) => {
  return proxyVideoStoryboardRequest(request, reply, 'HEAD');
});

const start = async (): Promise<void> => {
  try {
    await app.listen({
      port,
      host: '0.0.0.0',
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
