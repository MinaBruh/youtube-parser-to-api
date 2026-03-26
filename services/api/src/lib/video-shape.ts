export type RecommendedPlaybackMode = 'streams' | 'hls-manifest' | 'dash-manifest';
export type VideoLifecycle = 'vod' | 'upcoming' | 'premiere-upcoming' | 'live' | 'live-dvr' | 'post-live-dvr';

const toNumber = (value: unknown): number | null => {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const toUrl = (value: string | null): URL | null => {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, 'https://www.youtube.com');
  } catch {
    return null;
  }
};

export const toIsoDateString = (value: Date | string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const isShortsUrl = (value: string | null): boolean => {
  const url = toUrl(value);
  return url?.pathname.startsWith('/shorts/') ?? false;
};

export const isPortraitEmbed = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const width = toNumber((value as { width?: unknown }).width);
  const height = toNumber((value as { height?: unknown }).height);

  return width !== null && height !== null && width > 0 && height > width;
};

export const inferPremiereFlag = (params: {
  explicit?: boolean | null;
  isUpcoming: boolean;
  textHints?: Array<string | null | undefined>;
}): boolean => {
  if (params.explicit === true) {
    return true;
  }

  if (!params.isUpcoming) {
    return false;
  }

  return (params.textHints ?? []).some((value) => /premier/i.test(value ?? ''));
};

export const getVideoLifecycle = (params: {
  isLive: boolean;
  isUpcoming: boolean;
  isPremiere: boolean;
  isLiveDvrEnabled: boolean;
  isPostLiveDvr: boolean;
}): VideoLifecycle => {
  if (params.isPostLiveDvr) {
    return 'post-live-dvr';
  }

  if (params.isLive) {
    return params.isLiveDvrEnabled ? 'live-dvr' : 'live';
  }

  if (params.isUpcoming) {
    return params.isPremiere ? 'premiere-upcoming' : 'upcoming';
  }

  return 'vod';
};

export const buildCanonicalVideoUrl = (
  videoId: string,
  isShorts: boolean,
): string => {
  return isShorts
    ? `https://www.youtube.com/shorts/${encodeURIComponent(videoId)}`
    : `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
};

export const getRecommendedPlaybackMode = (params: {
  muxedStreamCount: number;
  dashManifestUrl: string | null;
  hlsManifestUrl: string | null;
  isLive: boolean;
  isUpcoming: boolean;
  isPostLiveDvr: boolean;
}): RecommendedPlaybackMode => {
  if (params.isUpcoming) {
    if (params.hlsManifestUrl) {
      return 'hls-manifest';
    }

    if (params.dashManifestUrl) {
      return 'dash-manifest';
    }

    return 'streams';
  }

  if (params.isLive) {
    if (params.hlsManifestUrl) {
      return 'hls-manifest';
    }

    if (params.dashManifestUrl) {
      return 'dash-manifest';
    }

    return 'streams';
  }

  if (params.isPostLiveDvr) {
    if (params.dashManifestUrl) {
      return 'dash-manifest';
    }

    if (params.hlsManifestUrl) {
      return 'hls-manifest';
    }

    return 'streams';
  }

  if (params.muxedStreamCount === 0) {
    if (params.dashManifestUrl) {
      return 'dash-manifest';
    }

    if (params.hlsManifestUrl) {
      return 'hls-manifest';
    }
  }

  return 'streams';
};
