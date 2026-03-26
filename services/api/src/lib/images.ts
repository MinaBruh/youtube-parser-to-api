import type { FastifyRequest } from 'fastify';
import { buildMediaImageUrl, getMediaProxyBaseUrl } from './playback.js';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const isThumbnailLike = (value: unknown): value is Record<string, unknown> & { url: string } => {
  return (
    isRecord(value) &&
    typeof value.url === 'string' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number'
  );
};

const attachProxyUrlsInPlace = (
  value: unknown,
  mediaProxyBaseUrl: string,
  seen: WeakSet<object>,
): void => {
  if (Array.isArray(value)) {
    for (const item of value) {
      attachProxyUrlsInPlace(item, mediaProxyBaseUrl, seen);
    }

    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (seen.has(value)) {
    return;
  }

  seen.add(value);

  if (isThumbnailLike(value)) {
    value.proxyUrl = buildMediaImageUrl(mediaProxyBaseUrl, value.url);
    return;
  }

  for (const nested of Object.values(value)) {
    attachProxyUrlsInPlace(nested, mediaProxyBaseUrl, seen);
  }
};

export const withImageProxyUrls = <T>(request: FastifyRequest, data: T): T => {
  const mediaProxyBaseUrl = getMediaProxyBaseUrl(request);
  attachProxyUrlsInPlace(data, mediaProxyBaseUrl, new WeakSet<object>());
  return data;
};
