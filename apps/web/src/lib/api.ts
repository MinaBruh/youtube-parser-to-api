import type {
  ChannelBrowseData,
  ChannelDetailsData,
  ChannelFeedData,
  CommunityPostsData,
  DiscoveryFeedData,
  PlaylistDetailsData,
  RecommendationFeedData,
  SearchResponseData,
  VideoCommentRepliesData,
  VideoCommentsData,
  VideoWatchData,
} from './api-types';

interface SuccessPayload<T> {
  ok: true;
  data: T;
}

interface ErrorPayload {
  ok: false;
  statusCode: number;
  message: string;
}

const trimTrailingSlash = (value: string): string => {
  return value.endsWith('/') ? value.slice(0, -1) : value;
};

export const apiBaseUrl = trimTrailingSlash(
  import.meta.env.VITE_API_BASE_URL?.trim() || '/api',
);

export const toClientUrl = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value, window.location.origin);

    if (url.pathname.startsWith('/v1/media/')) {
      return `/media${url.pathname}${url.search}`;
    }

    if (url.pathname.startsWith('/v1/')) {
      return `/api${url.pathname}${url.search}`;
    }

    return url.toString();
  } catch {
    return value;
  }
};

const createApiUrl = (path: string, searchParams?: Record<string, string | number | boolean | null | undefined>): string => {
  const normalizedBase = apiBaseUrl.startsWith('http')
    ? `${trimTrailingSlash(apiBaseUrl)}/`
    : new URL(`${apiBaseUrl.replace(/^\/?/, '').replace(/\/?$/, '')}/`, `${window.location.origin}/`).toString();
  const url = new URL(path.replace(/^\//, ''), normalizedBase);

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }

      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
};

const fetchApi = async <T>(path: string, searchParams?: Record<string, string | number | boolean | null | undefined>): Promise<T> => {
  const response = await fetch(createApiUrl(path, searchParams));
  const payload = await response.json().catch(() => null) as SuccessPayload<T> | ErrorPayload | null;

  if (!response.ok || !payload || !('ok' in payload) || !payload.ok) {
    const message = payload && 'message' in payload ? payload.message : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload.data;
};

export const api = {
  getHome(filter?: string, continuation?: string) {
    return fetchApi<DiscoveryFeedData>('/v1/home', {
      filter,
      continuation,
    });
  },
  getExplore(tab?: string, continuation?: string) {
    return fetchApi<DiscoveryFeedData>('/v1/explore', {
      tab,
      continuation,
    });
  },
  getTrending(tab?: string, continuation?: string) {
    return fetchApi<DiscoveryFeedData>('/v1/trending', {
      tab,
      continuation,
    });
  },
  getRecommendations(continuation?: string, limit = 18) {
    return fetchApi<RecommendationFeedData>('/v1/recommendations', {
      continuation,
      limit,
    });
  },
  search(query: string, continuation?: string, type = 'all') {
    return fetchApi<SearchResponseData>('/v1/search', {
      q: query,
      continuation,
      type,
      limit: 24,
    });
  },
  getWatch(videoId: string) {
    return fetchApi<VideoWatchData>(`/v1/watch/${encodeURIComponent(videoId)}`, {
      relatedLimit: 24,
      commentsLimit: 20,
      commentsSort: 'top',
    });
  },
  getRelated(videoId: string, continuation?: string, limit = 18) {
    return fetchApi<VideoWatchData['related']>(`/v1/videos/${encodeURIComponent(videoId)}/related`, {
      continuation,
      limit,
    });
  },
  getVideoComments(videoId: string, continuation?: string, limit = 20, sort: 'top' | 'newest' = 'top') {
    return fetchApi<VideoCommentsData>(`/v1/videos/${encodeURIComponent(videoId)}/comments`, {
      continuation,
      limit,
      sort,
    });
  },
  getVideoCommentReplies(videoId: string, commentId: string, continuation?: string, limit = 12) {
    return fetchApi<VideoCommentRepliesData>(`/v1/videos/${encodeURIComponent(videoId)}/comments/${encodeURIComponent(commentId)}/replies`, {
      continuation,
      limit,
    });
  },
  getChannelDetails(channelId: string) {
    return fetchApi<ChannelDetailsData>(`/v1/channels/${encodeURIComponent(channelId)}`);
  },
  getChannelHome(channelId: string, options?: { filter?: string; continuation?: string }) {
    return fetchApi<ChannelBrowseData>(`/v1/channels/${encodeURIComponent(channelId)}/home`, {
      filter: options?.filter,
      continuation: options?.continuation,
    });
  },
  getChannelSearch(channelId: string, options: { q?: string; continuation?: string; sort?: string; contentType?: string }) {
    return fetchApi<ChannelBrowseData>(`/v1/channels/${encodeURIComponent(channelId)}/search`, {
      q: options.q,
      continuation: options.continuation,
      sort: options.sort,
      contentType: options.contentType,
    });
  },
  getChannelFeed(channelId: string, tab: 'videos' | 'shorts' | 'streams' | 'playlists', continuation?: string, limit = 24) {
    return fetchApi<ChannelFeedData>(`/v1/channels/${encodeURIComponent(channelId)}/feed/${encodeURIComponent(tab)}`, {
      continuation,
      limit,
    });
  },
  getChannelCommunity(channelId: string, continuation?: string, limit = 20) {
    return fetchApi<CommunityPostsData>(`/v1/channels/${encodeURIComponent(channelId)}/community`, {
      continuation,
      limit,
    });
  },
  getPlaylist(playlistId: string, continuation?: string) {
    return fetchApi<PlaylistDetailsData>(`/v1/playlists/${encodeURIComponent(playlistId)}`, {
      continuation,
    });
  },
};
