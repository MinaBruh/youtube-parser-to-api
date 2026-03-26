import type { FastifyRequest } from 'fastify';
import type { Innertube } from 'youtubei.js';
import type { VideoStoryboardVariant, VideoStoryboardsData } from '@ytpa/shared';
import { buildMediaStoryboardSheetUrl, getMediaProxyBaseUrl } from './playback.js';

type VideoMediaInfo = Awaited<ReturnType<Innertube['getBasicInfo']>>;

interface StoryboardRepresentationLike {
  uid?: string;
  sheet_width?: number;
  sheet_height?: number;
  thumbnail_width?: number;
  thumbnail_height?: number;
  rows?: number;
  columns?: number;
  template_duration?: number;
  template_url?: string;
}

interface StoryboardImageSetLike {
  probable_mime_type?: string;
  representations?: StoryboardRepresentationLike[];
}

const toNumber = (value: unknown): number | null => {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const createStoryboardVariant = (
  mediaProxyBaseUrl: string,
  videoId: string,
  durationSeconds: number | null,
  imageSet: StoryboardImageSetLike,
  representation: StoryboardRepresentationLike,
): VideoStoryboardVariant | null => {
  const id = typeof representation.uid === 'string' ? representation.uid : null;
  const templateUrl = typeof representation.template_url === 'string' ? representation.template_url : null;
  const thumbnailWidth = toNumber(representation.thumbnail_width);
  const thumbnailHeight = toNumber(representation.thumbnail_height);
  const sheetWidth = toNumber(representation.sheet_width);
  const sheetHeight = toNumber(representation.sheet_height);
  const rows = toNumber(representation.rows);
  const columns = toNumber(representation.columns);
  const sheetDurationSeconds = toNumber(representation.template_duration);

  if (!id || !templateUrl || !thumbnailWidth || !thumbnailHeight || !sheetWidth || !sheetHeight || !rows || !columns) {
    return null;
  }

  const hasTemplatePlaceholder = templateUrl.includes('$Number$');
  const sheetCount =
    hasTemplatePlaceholder && durationSeconds && sheetDurationSeconds && sheetDurationSeconds > 0
      ? Math.max(1, Math.ceil(durationSeconds / sheetDurationSeconds))
      : 1;

  return {
    id,
    mimeType: typeof imageSet.probable_mime_type === 'string' ? imageSet.probable_mime_type : null,
    thumbnailWidth,
    thumbnailHeight,
    sheetWidth,
    sheetHeight,
    rows,
    columns,
    sheetCount,
    sheetDurationSeconds,
    sheetProxyUrlTemplate: buildMediaStoryboardSheetUrl(
      mediaProxyBaseUrl,
      videoId,
      id,
      '{sheetIndex}',
    ),
    firstSheetProxyUrl: buildMediaStoryboardSheetUrl(mediaProxyBaseUrl, videoId, id, 0),
  };
};

export const createVideoStoryboardsData = async (
  request: FastifyRequest,
  videoId: string,
  info: VideoMediaInfo,
): Promise<VideoStoryboardsData> => {
  const mediaProxyBaseUrl = getMediaProxyBaseUrl(request);
  const durationSeconds = info.basic_info.duration ?? null;
  const streamingInfo = await info.getStreamingInfo();
  const rawImageSets = Array.isArray(streamingInfo?.image_sets)
    ? (streamingInfo.image_sets as StoryboardImageSetLike[])
    : [];
  const variants = rawImageSets.flatMap((imageSet) => {
    const representations = Array.isArray(imageSet.representations)
      ? imageSet.representations
      : [];

    return representations
      .map((representation) => {
        return createStoryboardVariant(
          mediaProxyBaseUrl,
          videoId,
          durationSeconds,
          imageSet,
          representation,
        );
      })
      .filter((variant): variant is VideoStoryboardVariant => variant !== null);
  });

  return {
    id: info.basic_info.id ?? videoId,
    available: variants.length > 0,
    durationSeconds,
    variants,
  };
};
