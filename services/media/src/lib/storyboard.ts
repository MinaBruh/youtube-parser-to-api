import type { FastifyReply, FastifyRequest } from 'fastify';
import { createErrorPayload } from '@ytpa/shared';
import { getPlaybackInnertubeClient } from './innertube.js';
import { proxyTargetUrlRequest } from './proxy.js';

interface VideoStoryboardParams {
  videoId: string;
  storyboardId: string;
  sheetIndex: string;
}

interface StoryboardRepresentationLike {
  uid?: string;
  template_duration?: number;
  template_url?: string;
}

interface StoryboardImageSetLike {
  representations?: StoryboardRepresentationLike[];
}

const parseNonNegativeInteger = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

const toNumber = (value: unknown): number | null => {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const resolveStoryboardSheetUrl = (
  representation: StoryboardRepresentationLike,
  durationSeconds: number | null,
  sheetIndex: number,
): { url: string; sheetCount: number } | null => {
  const templateUrl = typeof representation.template_url === 'string' ? representation.template_url : null;

  if (!templateUrl) {
    return null;
  }

  const hasTemplatePlaceholder = templateUrl.includes('$Number$');
  const templateDurationSeconds = toNumber(representation.template_duration);
  const sheetCount =
    hasTemplatePlaceholder && durationSeconds && templateDurationSeconds && templateDurationSeconds > 0
      ? Math.max(1, Math.ceil(durationSeconds / templateDurationSeconds))
      : 1;

  if (sheetIndex >= sheetCount) {
    return null;
  }

  if (!hasTemplatePlaceholder) {
    return sheetIndex === 0
      ? { url: templateUrl, sheetCount }
      : null;
  }

  return {
    url: templateUrl.replace('$Number$', String(sheetIndex)),
    sheetCount,
  };
};

export const proxyVideoStoryboardRequest = async (
  request: FastifyRequest<{ Params: VideoStoryboardParams }>,
  reply: FastifyReply,
  method: 'GET' | 'HEAD',
): Promise<FastifyReply | void> => {
  const videoId = request.params.videoId.trim();
  const storyboardId = request.params.storyboardId.trim();
  const sheetIndex = parseNonNegativeInteger(request.params.sheetIndex);

  if (!videoId) {
    return reply.code(400).send(
      createErrorPayload(400, 'Route parameter "videoId" is required.'),
    );
  }

  if (!storyboardId) {
    return reply.code(400).send(
      createErrorPayload(400, 'Route parameter "storyboardId" is required.'),
    );
  }

  if (sheetIndex === null) {
    return reply.code(400).send(
      createErrorPayload(400, 'Route parameter "sheetIndex" must be a non-negative integer.'),
    );
  }

  try {
    const innertube = await getPlaybackInnertubeClient();
    const info = await innertube.getBasicInfo(videoId);
    const streamingInfo = await info.getStreamingInfo();
    const rawImageSets = Array.isArray(streamingInfo?.image_sets)
      ? (streamingInfo.image_sets as StoryboardImageSetLike[])
      : [];
    const representations = rawImageSets.flatMap((imageSet) => {
      return Array.isArray(imageSet.representations) ? imageSet.representations : [];
    });
    const representation = representations.find((candidate) => candidate.uid === storyboardId);

    if (!representation) {
      return reply.code(404).send(
        createErrorPayload(404, `No storyboard found for id ${storyboardId}.`),
      );
    }

    const resolved = resolveStoryboardSheetUrl(
      representation,
      info.basic_info.duration ?? null,
      sheetIndex,
    );

    if (!resolved) {
      return reply.code(404).send(
        createErrorPayload(404, `No storyboard sheet found for index ${sheetIndex}.`),
      );
    }

    return proxyTargetUrlRequest(request, reply, method, new URL(resolved.url));
  } catch (error) {
    request.log.error(
      { err: error, videoId, storyboardId, sheetIndex },
      'Failed to resolve storyboard sheet for media proxy',
    );

    return reply.code(502).send(
      createErrorPayload(502, 'Failed to resolve storyboard sheet from upstream.'),
    );
  }
};
