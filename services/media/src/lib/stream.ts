import type { FastifyReply, FastifyRequest } from 'fastify';
import { createErrorPayload } from '@ytpa/shared';
import { getPlaybackInnertubeClient } from './innertube.js';
import { proxyTargetUrlRequest } from './proxy.js';

interface VideoStreamParams {
  videoId: string;
}

interface VideoStreamQuerystring {
  itag?: string;
}

const parseItag = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const itag = Number(value);
  return Number.isInteger(itag) ? itag : null;
};

export const proxyVideoStreamRequest = async (
  request: FastifyRequest<{
    Params: VideoStreamParams;
    Querystring: VideoStreamQuerystring;
  }>,
  reply: FastifyReply,
  method: 'GET' | 'HEAD',
): Promise<FastifyReply | void> => {
  const videoId = request.params.videoId.trim();
  const itag = parseItag(request.query.itag);

  if (!videoId) {
    return reply.code(400).send(
      createErrorPayload(400, 'Route parameter "videoId" is required.'),
    );
  }

  if (itag === null) {
    return reply.code(400).send(
      createErrorPayload(400, 'Query parameter "itag" must be an integer.'),
    );
  }

  try {
    const innertube = await getPlaybackInnertubeClient();
    const info = await innertube.getBasicInfo(videoId);
    const player = info.actions.session.player;

    if (!player) {
      return reply.code(502).send(
        createErrorPayload(502, 'Player script is unavailable for stream URL deciphering.'),
      );
    }

    const format = [
      ...(info.streaming_data?.formats ?? []),
      ...(info.streaming_data?.adaptive_formats ?? []),
    ].find((candidate) => candidate.itag === itag);

    if (!format) {
      return reply.code(404).send(
        createErrorPayload(404, `No format found for itag ${itag}.`),
      );
    }

    let upstreamUrl: string;

    try {
      upstreamUrl = await format.decipher(player);
    } catch (error) {
      request.log.warn(
        { err: error, videoId, itag },
        'Failed to decipher requested stream format',
      );

      return reply.code(502).send(
        createErrorPayload(502, `Failed to decipher stream itag ${itag}.`),
      );
    }

    return proxyTargetUrlRequest(request, reply, method, new URL(upstreamUrl));
  } catch (error) {
    request.log.error(
      { err: error, videoId, itag },
      'Failed to resolve video stream for media proxy',
    );

    return reply.code(502).send(
      createErrorPayload(502, 'Failed to resolve video stream from upstream.'),
    );
  }
};

