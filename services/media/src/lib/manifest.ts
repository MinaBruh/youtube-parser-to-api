import type { FastifyReply, FastifyRequest } from 'fastify';
import { createErrorPayload, withRetries } from '@ytpa/shared';
import { getPlaybackInnertubeClient } from './innertube.js';
import { validateTargetUrl } from './proxy.js';

interface VideoManifestParams {
  videoId: string;
}

interface VideoManifestQuerystring {
  url?: string;
}

type HeaderValue = string | string[] | undefined;

const trimTrailingSlash = (value: string): string => {
  return value.endsWith('/') ? value.slice(0, -1) : value;
};

const getHeaderValue = (value: HeaderValue): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
};

const getSelfBaseUrl = (request: FastifyRequest): string => {
  const forwardedProto = getHeaderValue(request.headers['x-forwarded-proto']);
  const forwardedHost = getHeaderValue(request.headers['x-forwarded-host']);
  const host = forwardedHost ?? request.headers.host ?? '127.0.0.1:3001';
  const protocol = forwardedProto?.split(',')[0]?.trim() || request.protocol || 'http';

  return trimTrailingSlash(`${protocol}://${host}`);
};

const buildMediaProxyUrl = (baseUrl: string, upstreamUrl: string): string => {
  return `${baseUrl}/v1/media/proxy?url=${encodeURIComponent(upstreamUrl)}`;
};

const buildNestedHlsManifestUrl = (
  baseUrl: string,
  videoId: string,
  upstreamUrl: string,
): string => {
  return `${baseUrl}/v1/media/video/${encodeURIComponent(videoId)}/hls.m3u8?url=${encodeURIComponent(upstreamUrl)}`;
};

const parseAbsoluteUrl = (value: string | undefined): URL | null => {
  if (!value || value.trim().length === 0) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const createUpstreamManifestHeaders = (accept: string): Headers => {
  const headers = new Headers();
  headers.set('accept', accept);
  headers.set('accept-encoding', 'identity');
  headers.set('user-agent', 'youtube-proxy-api/0.1');
  return headers;
};

const isRetryableManifestFetchError = (error: unknown): boolean => {
  return error instanceof TypeError;
};

const fetchManifestText = async (
  request: FastifyRequest,
  targetUrl: URL,
  accept: string,
  description: string,
): Promise<string> => {
  const response = await withRetries(
    async () => {
      return fetch(targetUrl, {
        method: 'GET',
        headers: createUpstreamManifestHeaders(accept),
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
      });
    },
    {
      maxAttempts: 3,
      initialDelayMs: 250,
      maxDelayMs: 1_000,
      shouldRetry: (error) => isRetryableManifestFetchError(error),
      onRetry: ({ attempt, nextDelayMs, error }) => {
        request.log.warn(
          { err: error, attempt, nextDelayMs, description, targetUrl: targetUrl.toString() },
          'Retrying transient manifest request',
        );
      },
    },
  );

  if (!response.ok) {
    throw new Error(`${description} upstream request failed with status ${response.status}.`);
  }

  return response.text();
};

const resolveHlsManifestUrl = async (
  request: FastifyRequest<{
    Params: VideoManifestParams;
    Querystring: VideoManifestQuerystring;
  }>,
): Promise<URL | null> => {
  const overrideUrl = parseAbsoluteUrl(request.query.url);
  if (overrideUrl) {
    return overrideUrl;
  }

  const videoId = request.params.videoId.trim();
  const innertube = await getPlaybackInnertubeClient();
  const info = await innertube.getBasicInfo(videoId);
  const upstreamManifestUrl = info.streaming_data?.hls_manifest_url;

  return upstreamManifestUrl ? new URL(upstreamManifestUrl) : null;
};

const rewriteHlsUri = (
  rawValue: string,
  manifestUrl: URL,
  selfBaseUrl: string,
  videoId: string,
  treatAsPlaylist: boolean,
): string => {
  const resolvedUrl = new URL(rawValue, manifestUrl).toString();

  return treatAsPlaylist
    ? buildNestedHlsManifestUrl(selfBaseUrl, videoId, resolvedUrl)
    : buildMediaProxyUrl(selfBaseUrl, resolvedUrl);
};

const rewriteHlsAttributeUris = (
  line: string,
  manifestUrl: URL,
  selfBaseUrl: string,
  videoId: string,
): string => {
  const trimmed = line.trim();
  const treatAsPlaylist = /^#EXT-X-(MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT)/.test(trimmed);

  return line.replace(/URI="([^"]+)"/g, (_match, uriValue: string) => {
    return `URI="${rewriteHlsUri(uriValue, manifestUrl, selfBaseUrl, videoId, treatAsPlaylist)}"`;
  });
};

const rewriteHlsManifest = (
  body: string,
  manifestUrl: URL,
  selfBaseUrl: string,
  videoId: string,
): string => {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  let expectsPlaylistUri = false;

  const rewrittenLines = lines.map((line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      expectsPlaylistUri = false;
      return line;
    }

    if (trimmed.startsWith('#')) {
      const rewrittenTag = rewriteHlsAttributeUris(line, manifestUrl, selfBaseUrl, videoId);
      expectsPlaylistUri = trimmed.startsWith('#EXT-X-STREAM-INF');
      return rewrittenTag;
    }

    const rewrittenUri = rewriteHlsUri(trimmed, manifestUrl, selfBaseUrl, videoId, expectsPlaylistUri);
    expectsPlaylistUri = false;
    return rewrittenUri;
  });

  return rewrittenLines.join('\n');
};

export const proxyVideoDashManifestRequest = async (
  request: FastifyRequest<{ Params: VideoManifestParams }>,
  reply: FastifyReply,
  method: 'GET' | 'HEAD',
): Promise<FastifyReply | void> => {
  const videoId = request.params.videoId.trim();

  if (!videoId) {
    return reply.code(400).send(
      createErrorPayload(400, 'Route parameter "videoId" is required.'),
    );
  }

  try {
    const innertube = await getPlaybackInnertubeClient();
    const info = await innertube.getBasicInfo(videoId);

    if (!info.streaming_data) {
      return reply.code(404).send(
        createErrorPayload(404, 'Streaming data is unavailable for the requested video.'),
      );
    }

    if (info.basic_info.is_live ?? false) {
      return reply.code(400).send(
        createErrorPayload(400, 'Local DASH generation is unavailable for live videos. Use the rewritten HLS manifest instead.'),
      );
    }

    const selfBaseUrl = getSelfBaseUrl(request);
    const manifest = await info.toDash({
      url_transformer: (url: URL) => new URL(buildMediaProxyUrl(selfBaseUrl, url.toString())),
    });

    reply.type('application/dash+xml; charset=utf-8');
    reply.header('Cache-Control', 'no-store');

    if (method === 'HEAD') {
      return reply.send();
    }

    return reply.send(manifest);
  } catch (error) {
    request.log.error(
      { err: error, videoId },
      'Failed to build local DASH manifest',
    );

    return reply.code(502).send(
      createErrorPayload(502, 'Failed to generate local DASH manifest.'),
    );
  }
};

export const proxyVideoHlsManifestRequest = async (
  request: FastifyRequest<{
    Params: VideoManifestParams;
    Querystring: VideoManifestQuerystring;
  }>,
  reply: FastifyReply,
  method: 'GET' | 'HEAD',
): Promise<FastifyReply | void> => {
  const videoId = request.params.videoId.trim();

  if (!videoId) {
    return reply.code(400).send(
      createErrorPayload(400, 'Route parameter "videoId" is required.'),
    );
  }

  const invalidOverrideUrl = request.query.url && !parseAbsoluteUrl(request.query.url);
  if (invalidOverrideUrl) {
    return reply.code(400).send(
      createErrorPayload(400, 'Query parameter "url" must be a valid absolute URL when provided.'),
    );
  }

  try {
    const targetUrl = await resolveHlsManifestUrl(request);

    if (!targetUrl) {
      return reply.code(404).send(
        createErrorPayload(404, 'HLS manifest is unavailable for the requested video.'),
      );
    }

    const validationError = validateTargetUrl(targetUrl);
    if (validationError) {
      return reply.code(403).send(createErrorPayload(403, validationError));
    }

    const playlistBody = await fetchManifestText(
      request,
      targetUrl,
      'application/vnd.apple.mpegurl, application/x-mpegurl, text/plain, */*',
      'HLS manifest',
    );
    const rewrittenManifest = rewriteHlsManifest(
      playlistBody,
      targetUrl,
      getSelfBaseUrl(request),
      videoId,
    );

    reply.type('application/vnd.apple.mpegurl; charset=utf-8');
    reply.header('Cache-Control', 'no-store');

    if (method === 'HEAD') {
      return reply.send();
    }

    return reply.send(rewrittenManifest);
  } catch (error) {
    request.log.error(
      { err: error, videoId, hasOverrideUrl: Boolean(request.query.url) },
      'Failed to rewrite HLS manifest',
    );

    return reply.code(502).send(
      createErrorPayload(502, 'Failed to load rewritten HLS manifest.'),
    );
  }
};
