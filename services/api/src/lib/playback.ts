import type { FastifyRequest } from 'fastify';
import type { Innertube } from 'youtubei.js';
import {
  getDefaultPort,
  type PlaybackAdaptivePair,
  type PlaybackAudioTrackOption,
  type PlaybackDefaultSelection,
  type PlaybackManifestUrls,
  type PlaybackQualityOption,
  type PlaybackStrategy,
  type PlaybackStream,
  type PlaybackStreamRole,
  type VideoPlaybackData,
} from '@ytpa/shared';
import {
  getRecommendedPlaybackMode,
  getVideoLifecycle,
  inferPremiereFlag,
  isPortraitEmbed,
  toIsoDateString,
} from './video-shape.js';

type VideoMediaInfo = Awaited<ReturnType<Innertube['getBasicInfo']>>;
type PlaybackFormat = NonNullable<
  NonNullable<VideoMediaInfo['streaming_data']>['formats']
>[number];

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

const getDerivedMediaBaseUrl = (request: FastifyRequest): string => {
  const forwardedProto = getHeaderValue(request.headers['x-forwarded-proto']);
  const forwardedHost = getHeaderValue(request.headers['x-forwarded-host']);
  const host = forwardedHost ?? request.headers.host ?? `127.0.0.1:${getDefaultPort('api')}`;
  const protocol = forwardedProto?.split(',')[0]?.trim() || request.protocol || 'http';
  const url = new URL(`${protocol}://${host}`);
  url.port = String(Number(process.env.MEDIA_PORT ?? getDefaultPort('media')));
  return trimTrailingSlash(url.toString());
};

const slugify = (value: string): string => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'default';
};

const pushUniqueStrategy = (
  strategies: PlaybackStrategy[],
  strategy: PlaybackStrategy | null,
): void => {
  if (strategy && !strategies.includes(strategy)) {
    strategies.push(strategy);
  }
};

const getStreamRole = (format: {
  has_audio: boolean;
  has_video: boolean;
}): PlaybackStreamRole => {
  if (format.has_audio && format.has_video) {
    return 'muxed';
  }

  if (format.has_audio) {
    return 'audio';
  }

  return 'video';
};

const getContainerScore = (stream: PlaybackStream): number => {
  if (stream.container === 'mp4') {
    return 2;
  }

  if (stream.container === 'webm') {
    return 1;
  }

  return 0;
};

const compareVideoPriority = (left: PlaybackStream, right: PlaybackStream): number => {
  const heightDelta = (right.height ?? 0) - (left.height ?? 0);
  if (heightDelta !== 0) {
    return heightDelta;
  }

  const fpsDelta = (right.fps ?? 0) - (left.fps ?? 0);
  if (fpsDelta !== 0) {
    return fpsDelta;
  }

  const containerDelta = getContainerScore(right) - getContainerScore(left);
  if (containerDelta !== 0) {
    return containerDelta;
  }

  return right.bitrate - left.bitrate;
};

const compareAudioPriority = (left: PlaybackStream, right: PlaybackStream): number => {
  const defaultTrackDelta = Number(Boolean(right.isDefaultAudioTrack)) - Number(Boolean(left.isDefaultAudioTrack));
  if (defaultTrackDelta !== 0) {
    return defaultTrackDelta;
  }

  const channelDelta = (right.audioChannels ?? 0) - (left.audioChannels ?? 0);
  if (channelDelta !== 0) {
    return channelDelta;
  }

  const qualityDelta = (right.audioSampleRate ?? 0) - (left.audioSampleRate ?? 0);
  if (qualityDelta !== 0) {
    return qualityDelta;
  }

  return right.bitrate - left.bitrate;
};

const sortPlaybackStreams = (streams: PlaybackStream[]): PlaybackStream[] => {
  return [...streams].sort((left, right) => {
    const rolePriority = {
      muxed: 3,
      video: 2,
      audio: 1,
    } as const;

    const roleDelta = rolePriority[right.role] - rolePriority[left.role];
    if (roleDelta !== 0) {
      return roleDelta;
    }

    if (left.role === 'audio' && right.role === 'audio') {
      return compareAudioPriority(left, right);
    }

    return compareVideoPriority(left, right);
  });
};

const getQualityKey = (stream: PlaybackStream): string => {
  const base = stream.qualityLabel ?? stream.quality ?? (stream.height ? `${stream.height}p` : `itag-${stream.itag}`);
  return slugify(`${base}-${stream.fps ?? 0}`);
};

const getQualityLabel = (stream: PlaybackStream): string => {
  const base = stream.qualityLabel ?? stream.quality ?? (stream.height ? `${stream.height}p` : 'Unknown');

  if (stream.fps && stream.fps > 30 && !base.includes(String(stream.fps))) {
    return `${base} ${stream.fps}fps`;
  }

  return base;
};

const getAudioTrackKey = (stream: PlaybackStream): string => {
  if (stream.audioTrackId) {
    return stream.audioTrackId;
  }

  if (stream.language) {
    return `lang:${stream.language}`;
  }

  return stream.isDefaultAudioTrack ? 'default' : 'unknown-audio';
};

const getAudioTrackLabel = (stream: PlaybackStream): string => {
  return stream.audioTrackName ?? stream.language ?? (stream.isDefaultAudioTrack ? 'Default audio' : 'Unknown audio');
};

export const getMediaProxyBaseUrl = (request: FastifyRequest): string => {
  const configuredBaseUrl = process.env.MEDIA_PROXY_BASE_URL?.trim();

  if (configuredBaseUrl) {
    return trimTrailingSlash(configuredBaseUrl);
  }

  return getDerivedMediaBaseUrl(request);
};

export const buildPlaybackEndpointPath = (videoId: string): string => {
  return `/v1/videos/${encodeURIComponent(videoId)}/playback`;
};

export const buildStoryboardsEndpointPath = (videoId: string): string => {
  return `/v1/videos/${encodeURIComponent(videoId)}/storyboards`;
};

export const buildMediaProxyUrl = (
  mediaProxyBaseUrl: string,
  upstreamUrl: string,
): string => {
  return `${mediaProxyBaseUrl}/v1/media/proxy?url=${encodeURIComponent(upstreamUrl)}`;
};

export const buildMediaImageUrl = (
  mediaProxyBaseUrl: string,
  upstreamUrl: string,
): string => {
  return `${mediaProxyBaseUrl}/v1/media/image?url=${encodeURIComponent(upstreamUrl)}`;
};

export const buildMediaStreamUrl = (
  mediaProxyBaseUrl: string,
  videoId: string,
  itag: number,
): string => {
  return `${mediaProxyBaseUrl}/v1/media/video/${encodeURIComponent(videoId)}/stream?itag=${itag}`;
};

export const buildMediaDashManifestUrl = (
  mediaProxyBaseUrl: string,
  videoId: string,
): string => {
  return `${mediaProxyBaseUrl}/v1/media/video/${encodeURIComponent(videoId)}/dash.mpd`;
};

export const buildMediaHlsManifestUrl = (
  mediaProxyBaseUrl: string,
  videoId: string,
): string => {
  return `${mediaProxyBaseUrl}/v1/media/video/${encodeURIComponent(videoId)}/hls.m3u8`;
};

export const buildMediaStoryboardSheetUrl = (
  mediaProxyBaseUrl: string,
  videoId: string,
  storyboardId: string,
  sheetIndex: number | string,
): string => {
  return `${mediaProxyBaseUrl}/v1/media/video/${encodeURIComponent(videoId)}/storyboards/${encodeURIComponent(storyboardId)}/sheets/${encodeURIComponent(String(sheetIndex))}`;
};

const parseMimeType = (mimeType: string): {
  container: string;
  codecs: string | null;
} => {
  const [baseMimeType] = mimeType.split(';');
  const codecsMatch = /codecs="([^"]+)"/.exec(mimeType);
  const container = baseMimeType.includes('/')
    ? baseMimeType.split('/')[1] ?? baseMimeType
    : baseMimeType;

  return {
    container,
    codecs: codecsMatch?.[1] ?? null,
  };
};

const toPlaybackStream = async (
  videoId: string,
  format: PlaybackFormat,
  isAdaptive: boolean,
  mediaProxyBaseUrl: string,
  player: VideoMediaInfo['actions']['session']['player'],
): Promise<PlaybackStream | null> => {
  if (!player) {
    return null;
  }

  try {
    await format.decipher(player);
    const mimeInfo = parseMimeType(format.mime_type);

    return {
      itag: format.itag,
      mimeType: format.mime_type,
      container: mimeInfo.container,
      codecs: mimeInfo.codecs,
      quality: format.quality ?? null,
      qualityLabel: format.quality_label ?? null,
      audioQuality: format.audio_quality ?? null,
      bitrate: format.bitrate,
      averageBitrate: format.average_bitrate ?? null,
      contentLength: format.content_length ?? null,
      width: format.width ?? null,
      height: format.height ?? null,
      fps: format.fps ?? null,
      hasAudio: format.has_audio,
      hasVideo: format.has_video,
      isAdaptive,
      role: getStreamRole(format),
      language: format.language ?? null,
      audioTrackId: format.audio_track?.id ?? null,
      audioTrackName: format.audio_track?.display_name ?? null,
      isDefaultAudioTrack: format.audio_track?.audio_is_default ?? null,
      audioChannels: format.audio_channels ?? null,
      audioSampleRate: format.audio_sample_rate ?? null,
      isDrc: format.is_drc ?? null,
      proxyUrl: buildMediaStreamUrl(mediaProxyBaseUrl, videoId, format.itag),
    };
  } catch {
    return null;
  }
};

const buildQualityOptions = (
  streams: PlaybackStream[],
): PlaybackQualityOption[] => {
  const qualityMap = new Map<string, {
    id: string;
    label: string;
    quality: string | null;
    qualityLabel: string | null;
    width: number | null;
    height: number | null;
    fps: number | null;
    muxedStream: PlaybackStream | null;
    videoOnlyStream: PlaybackStream | null;
  }>();

  for (const stream of streams.filter((candidate) => candidate.hasVideo)) {
    const id = getQualityKey(stream);
    const existing = qualityMap.get(id);

    if (!existing) {
      qualityMap.set(id, {
        id,
        label: getQualityLabel(stream),
        quality: stream.quality,
        qualityLabel: stream.qualityLabel,
        width: stream.width,
        height: stream.height,
        fps: stream.fps,
        muxedStream: stream.role === 'muxed' ? stream : null,
        videoOnlyStream: stream.role === 'video' ? stream : null,
      });
      continue;
    }

    existing.width = Math.max(existing.width ?? 0, stream.width ?? 0) || null;
    existing.height = Math.max(existing.height ?? 0, stream.height ?? 0) || null;
    existing.fps = Math.max(existing.fps ?? 0, stream.fps ?? 0) || null;

    if (stream.role === 'muxed') {
      existing.muxedStream = existing.muxedStream
        ? [existing.muxedStream, stream].sort(compareVideoPriority)[0]
        : stream;
    }

    if (stream.role === 'video') {
      existing.videoOnlyStream = existing.videoOnlyStream
        ? [existing.videoOnlyStream, stream].sort(compareVideoPriority)[0]
        : stream;
    }
  }

  return [...qualityMap.values()]
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      quality: entry.quality,
      qualityLabel: entry.qualityLabel,
      width: entry.width,
      height: entry.height,
      fps: entry.fps,
      hasMuxedStream: entry.muxedStream !== null,
      hasAdaptiveStream: entry.videoOnlyStream !== null,
      muxedItag: entry.muxedStream?.itag ?? null,
      videoOnlyItag: entry.videoOnlyStream?.itag ?? null,
    }))
    .sort((left, right) => {
      const heightDelta = (right.height ?? 0) - (left.height ?? 0);
      if (heightDelta !== 0) {
        return heightDelta;
      }

      const fpsDelta = (right.fps ?? 0) - (left.fps ?? 0);
      if (fpsDelta !== 0) {
        return fpsDelta;
      }

      return left.label.localeCompare(right.label);
    });
};

const buildAudioTrackOptions = (
  audioOnlyStreams: PlaybackStream[],
  muxedStreams: PlaybackStream[],
): PlaybackAudioTrackOption[] => {
  const trackMap = new Map<string, {
    id: string;
    label: string;
    language: string | null;
    isDefault: boolean;
    streamCount: number;
    bestAudioOnly: PlaybackStream | null;
    bestMuxed: PlaybackStream | null;
  }>();

  for (const stream of [...audioOnlyStreams, ...muxedStreams]) {
    const id = getAudioTrackKey(stream);
    const existing = trackMap.get(id);

    if (!existing) {
      trackMap.set(id, {
        id,
        label: getAudioTrackLabel(stream),
        language: stream.language,
        isDefault: Boolean(stream.isDefaultAudioTrack),
        streamCount: 1,
        bestAudioOnly: stream.role === 'audio' ? stream : null,
        bestMuxed: stream.role === 'muxed' ? stream : null,
      });
      continue;
    }

    existing.streamCount += 1;
    existing.isDefault = existing.isDefault || Boolean(stream.isDefaultAudioTrack);
    existing.language = existing.language ?? stream.language;

    if (stream.role === 'audio') {
      existing.bestAudioOnly = existing.bestAudioOnly
        ? [existing.bestAudioOnly, stream].sort(compareAudioPriority)[0]
        : stream;
    }

    if (stream.role === 'muxed') {
      existing.bestMuxed = existing.bestMuxed
        ? [existing.bestMuxed, stream].sort(compareVideoPriority)[0]
        : stream;
    }
  }

  return [...trackMap.values()]
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      language: entry.language,
      isDefault: entry.isDefault,
      streamCount: entry.streamCount,
      audioOnlyItag: entry.bestAudioOnly?.itag ?? null,
      muxedItag: entry.bestMuxed?.itag ?? null,
    }))
    .sort((left, right) => {
      const defaultDelta = Number(right.isDefault) - Number(left.isDefault);
      if (defaultDelta !== 0) {
        return defaultDelta;
      }

      return left.label.localeCompare(right.label);
    });
};

const buildAdaptivePairs = (
  qualityOptions: PlaybackQualityOption[],
  audioTracks: PlaybackAudioTrackOption[],
  audioOnlyStreams: PlaybackStream[],
  videoOnlyStreams: PlaybackStream[],
): PlaybackAdaptivePair[] => {
  const audioStreamByItag = new Map(audioOnlyStreams.map((stream) => [stream.itag, stream]));
  const videoStreamByItag = new Map(videoOnlyStreams.map((stream) => [stream.itag, stream]));
  const defaultAudioTrackId = audioTracks.find((track) => track.isDefault)?.id ?? audioTracks[0]?.id ?? null;
  const pairs: PlaybackAdaptivePair[] = [];

  for (const qualityOption of qualityOptions) {
    if (qualityOption.videoOnlyItag === null) {
      continue;
    }

    const videoStream = videoStreamByItag.get(qualityOption.videoOnlyItag);
    if (!videoStream) {
      continue;
    }

    for (const audioTrack of audioTracks) {
      if (audioTrack.audioOnlyItag === null) {
        continue;
      }

      const audioStream = audioStreamByItag.get(audioTrack.audioOnlyItag);
      if (!audioStream) {
        continue;
      }

      pairs.push({
        id: `${videoStream.itag}:${audioStream.itag}`,
        qualityId: qualityOption.id,
        qualityLabel: qualityOption.label,
        videoItag: videoStream.itag,
        audioItag: audioStream.itag,
        audioTrackId: audioTrack.id,
        audioTrackName: audioTrack.label,
        bitrate: videoStream.bitrate + audioStream.bitrate,
        videoProxyUrl: videoStream.proxyUrl,
        audioProxyUrl: audioStream.proxyUrl,
      });
    }
  }

  return pairs.sort((left, right) => {
    const leftVideo = videoStreamByItag.get(left.videoItag);
    const rightVideo = videoStreamByItag.get(right.videoItag);
    const videoDelta = compareVideoPriority(leftVideo ?? videoOnlyStreams[0], rightVideo ?? videoOnlyStreams[0]);
    if (videoDelta !== 0) {
      return videoDelta;
    }

    const defaultDelta = Number(right.audioTrackId === defaultAudioTrackId) - Number(left.audioTrackId === defaultAudioTrackId);
    if (defaultDelta !== 0) {
      return defaultDelta;
    }

    return right.bitrate - left.bitrate;
  });
};

const getQualityIdForMuxedStream = (
  qualityOptions: PlaybackQualityOption[],
  muxedItag: number | null,
): string | null => {
  if (muxedItag === null) {
    return null;
  }

  return qualityOptions.find((option) => option.muxedItag === muxedItag)?.id ?? null;
};

const toRecommendedStrategy = (
  recommendedPlaybackMode: VideoPlaybackData['recommendedPlaybackMode'],
  hasMuxedStream: boolean,
  hasAdaptivePair: boolean,
): PlaybackStrategy | null => {
  if (recommendedPlaybackMode === 'dash-manifest') {
    return 'dash-manifest';
  }

  if (recommendedPlaybackMode === 'hls-manifest') {
    return 'hls-manifest';
  }

  if (hasMuxedStream) {
    return 'muxed-stream';
  }

  if (hasAdaptivePair) {
    return 'adaptive-pair';
  }

  return null;
};

const buildFallbackOrder = (
  recommendedStrategy: PlaybackStrategy | null,
  hasMuxedStream: boolean,
  hasAdaptivePair: boolean,
  hasDashManifest: boolean,
  hasHlsManifest: boolean,
): PlaybackStrategy[] => {
  const strategies: PlaybackStrategy[] = [];

  pushUniqueStrategy(strategies, recommendedStrategy);
  pushUniqueStrategy(strategies, hasMuxedStream ? 'muxed-stream' : null);
  pushUniqueStrategy(strategies, hasAdaptivePair ? 'adaptive-pair' : null);
  pushUniqueStrategy(strategies, hasDashManifest ? 'dash-manifest' : null);
  pushUniqueStrategy(strategies, hasHlsManifest ? 'hls-manifest' : null);

  return strategies;
};

const buildDefaultSelection = (
  fallbackOrder: PlaybackStrategy[],
  defaultMuxedStream: PlaybackStream | null,
  defaultAdaptivePair: PlaybackAdaptivePair | null,
  dashProxyUrl: string | null,
  hlsProxyUrl: string | null,
  qualityOptions: PlaybackQualityOption[],
  defaultAudioTrackId: string | null,
): PlaybackDefaultSelection | null => {
  const strategy = fallbackOrder[0] ?? null;

  if (!strategy) {
    return null;
  }

  return {
    strategy,
    qualityId: defaultMuxedStream
      ? getQualityIdForMuxedStream(qualityOptions, defaultMuxedStream.itag)
      : defaultAdaptivePair?.qualityId ?? null,
    audioTrackId: defaultAudioTrackId,
    muxedItag: defaultMuxedStream?.itag ?? null,
    videoItag: defaultAdaptivePair?.videoItag ?? null,
    audioItag: defaultAdaptivePair?.audioItag ?? null,
    manifestProxyUrl: strategy === 'dash-manifest'
      ? dashProxyUrl
      : strategy === 'hls-manifest'
        ? hlsProxyUrl
        : null,
  };
};

export const createPlaybackData = async (
  request: FastifyRequest,
  videoId: string,
  info: VideoMediaInfo,
): Promise<VideoPlaybackData> => {
  const mediaProxyBaseUrl = getMediaProxyBaseUrl(request);
  const playbackEndpoint = buildPlaybackEndpointPath(videoId);
  const player = info.actions.session.player;
  const streamingData = info.streaming_data;
  const rawFormats = [
    ...(streamingData?.formats ?? []).map((format) => ({ format, isAdaptive: false })),
    ...(streamingData?.adaptive_formats ?? []).map((format) => ({ format, isAdaptive: true })),
  ];

  const resolvedStreams = await Promise.all(
    rawFormats.map(({ format, isAdaptive }) => {
      return toPlaybackStream(videoId, format, isAdaptive, mediaProxyBaseUrl, player);
    }),
  );

  const streams = sortPlaybackStreams(
    resolvedStreams.filter((stream): stream is PlaybackStream => stream !== null),
  );

  const isLive = info.basic_info.is_live ?? false;
  const isUpcoming = info.basic_info.is_upcoming ?? false;
  const isLiveDvrEnabled = info.basic_info.is_live_dvr_enabled ?? false;
  const isPostLiveDvr = info.basic_info.is_post_live_dvr ?? false;
  const upstreamDashProxyUrl = streamingData?.dash_manifest_url
    ? buildMediaProxyUrl(mediaProxyBaseUrl, streamingData.dash_manifest_url)
    : null;
  const upstreamHlsProxyUrl = streamingData?.hls_manifest_url
    ? buildMediaProxyUrl(mediaProxyBaseUrl, streamingData.hls_manifest_url)
    : null;
  const dashProxyUrl = !isLive && streamingData
    ? buildMediaDashManifestUrl(mediaProxyBaseUrl, videoId)
    : null;
  const hlsProxyUrl = streamingData?.hls_manifest_url
    ? buildMediaHlsManifestUrl(mediaProxyBaseUrl, videoId)
    : null;
  const manifests: PlaybackManifestUrls = {
    dashProxyUrl,
    hlsProxyUrl,
    upstreamDashProxyUrl,
    upstreamHlsProxyUrl,
  };
  const isShorts = isPortraitEmbed(info.basic_info.embed);
  const muxedStreams = streams.filter((stream) => stream.role === 'muxed');
  const audioOnlyStreams = streams.filter((stream) => stream.role === 'audio');
  const videoOnlyStreams = streams.filter((stream) => stream.role === 'video');
  const qualityOptions = buildQualityOptions(streams);
  const audioTracks = buildAudioTrackOptions(audioOnlyStreams, muxedStreams);
  const adaptivePairs = buildAdaptivePairs(
    qualityOptions,
    audioTracks,
    audioOnlyStreams,
    videoOnlyStreams,
  );
  const playabilityReason = info.playability_status?.reason ?? null;
  const isPremiere = inferPremiereFlag({
    isUpcoming,
    textHints: [playabilityReason],
  });
  const recommendedPlaybackMode = getRecommendedPlaybackMode({
    muxedStreamCount: muxedStreams.length,
    dashManifestUrl: dashProxyUrl,
    hlsManifestUrl: hlsProxyUrl,
    isLive,
    isUpcoming,
    isPostLiveDvr,
  });
  const defaultMuxedStream = muxedStreams.length > 0
    ? [...muxedStreams].sort(compareVideoPriority)[0] ?? null
    : null;
  const defaultAudioTrackId = audioTracks.find((track) => track.isDefault)?.id ?? audioTracks[0]?.id ?? null;
  const defaultAdaptivePair = adaptivePairs.find((pair) => pair.audioTrackId === defaultAudioTrackId)
    ?? adaptivePairs[0]
    ?? null;
  const recommendedStrategy = toRecommendedStrategy(
    recommendedPlaybackMode,
    defaultMuxedStream !== null,
    defaultAdaptivePair !== null,
  );
  const fallbackOrder = buildFallbackOrder(
    recommendedStrategy,
    defaultMuxedStream !== null,
    defaultAdaptivePair !== null,
    dashProxyUrl !== null,
    hlsProxyUrl !== null,
  );

  return {
    id: info.basic_info.id ?? videoId,
    playbackEndpoint,
    durationSeconds: info.basic_info.duration ?? null,
    isShorts,
    isLive,
    isUpcoming,
    isPremiere,
    isLiveContent: info.basic_info.is_live_content ?? false,
    isLiveDvrEnabled,
    isPostLiveDvr,
    isLowLatencyLiveStream: info.basic_info.is_low_latency_live_stream ?? false,
    liveLifecycle: getVideoLifecycle({
      isLive,
      isUpcoming,
      isPremiere,
      isLiveDvrEnabled,
      isPostLiveDvr,
    }),
    scheduledStartTime: toIsoDateString(info.basic_info.start_timestamp),
    endedAt: toIsoDateString(info.basic_info.end_timestamp),
    recommendedPlaybackMode,
    playabilityStatus: info.playability_status?.status ?? null,
    playabilityReason,
    manifests,
    streams,
    muxedStreams,
    audioOnlyStreams,
    videoOnlyStreams,
    qualityOptions,
    audioTracks,
    adaptivePairs,
    defaultSelection: buildDefaultSelection(
      fallbackOrder,
      defaultMuxedStream,
      defaultAdaptivePair,
      dashProxyUrl,
      hlsProxyUrl,
      qualityOptions,
      defaultAudioTrackId,
    ),
    fallbackOrder,
    unresolvedFormatsCount: rawFormats.length - streams.length,
  };
};
