import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { Mixins, YTNodes } from 'youtubei.js';
import {
  CHANNEL_FEED_TABS,
  COMMENT_SORTS,
  SEARCH_DURATIONS,
  SEARCH_FEATURES,
  SEARCH_PRIORITIES,
  SEARCH_TYPES,
  SEARCH_UPLOAD_DATES,
  createErrorPayload,
  createHealthPayload,
  createSuccessPayload,
  getDefaultPort,
  FixedWindowRateLimiter,
  withRetries,
  type ChannelFeedTab,
  type CommentSort,
  type SearchDuration,
  type SearchFeature,
  type SearchFilters,
  type SearchPriority,
  type SearchType,
  type SearchUploadDate,
  type ServiceName,
} from '@ytpa/shared';
import {
  getInnertubeClient,
  getPlaybackInnertubeClient,
} from './lib/innertube.js';
import {
  buildPlaybackEndpointPath,
  buildStoryboardsEndpointPath,
  createPlaybackData,
  getMediaProxyBaseUrl,
} from './lib/playback.js';
import {
  createVideoCaptionsData,
  createVideoTranscriptData,
} from './lib/captions.js';
import { withImageProxyUrls } from './lib/images.js';
import { createVideoStoryboardsData } from './lib/storyboards.js';
import {
  CaptionTrackNotFoundError,
  parseCaptionContentFormat,
  resolveCaptionTrackContent,
} from './lib/subtitle-content.js';
import {
  createChannelBrowseData,
  createChannelDetailsData,
  createChannelFeedData,
  createChannelSearchContentTypeOptions,
  createChannelSearchSortOptions,
  createCommunityPostCommentsContinuationData,
  createCommunityPostCommentsData,
  createCommunityPostData,
  createCommunityPostsData,
  createDiscoveryFeedData,
  createDiscoveryFeedOptions,
  createPlaylistContinuationData,
  createPlaylistDetailsData,
  createSearchContinuationData,
  createSearchResponseData,
  createVideoCommentRepliesData,
  createVideoCommentsContinuationData,
  createVideoCommentsData,
  createVideoDetailsData,
  createVideoRelatedData,
  getContinuationTokenFromMemoSource,
} from './lib/normalize.js';
import {
  decodeChannelFeedPaginationToken,
  decodeChannelHomePaginationToken,
  decodeChannelSearchPaginationToken,
  decodeCommunityPaginationToken,
  decodeDiscoveryPaginationToken,
  decodePlaylistPaginationToken,
  decodeRecommendationPaginationToken,
  decodeSearchPaginationToken,
  encodeChannelFeedPaginationToken,
  encodeChannelHomePaginationToken,
  encodeChannelSearchPaginationToken,
  encodeCommunityPaginationToken,
  encodeDiscoveryPaginationToken,
  encodePlaylistPaginationToken,
  encodeSearchPaginationToken,
} from './lib/pagination.js';
import { InMemoryAsyncCache } from './lib/cache.js';
import {
  buildAnonymousRecommendationFeed,
  buildRecommendationContinuationFeed,
} from './lib/recommendation-feed.js';
import {
  getAnonymousRecommendationVisitorKey,
  recordAnonymousSearchSignal,
  recordAnonymousWatchSignal,
} from './lib/recommendations.js';

const serviceName: ServiceName = 'api';
const port = Number(process.env.API_PORT ?? getDefaultPort(serviceName));
const defaultSearchLimit = 20;
const maxSearchLimit = 50;
const defaultCommunityLimit = 20;
const maxCommunityLimit = 50;
const defaultPlaylistLimit = 100;
const maxPlaylistLimit = 200;
const defaultWatchRelatedLimit = 18;
const defaultWatchCommentsLimit = 20;
const defaultRecommendationLimit = 18;
const maxRecommendationLimit = 48;
const defaultExploreBrowseId = 'FEtrending';
const currentDir = dirname(fileURLToPath(import.meta.url));
const publicDir = join(currentDir, '../public');
const DEBUG_UI_ASSETS = {
  index: {
    fileName: 'index.html',
    contentType: 'text/html; charset=utf-8',
  },
  script: {
    fileName: 'app.js',
    contentType: 'text/javascript; charset=utf-8',
  },
  styles: {
    fileName: 'styles.css',
    contentType: 'text/css; charset=utf-8',
  },
} as const;

interface SearchQuerystring {
  q?: string;
  continuation?: string;
  type?: string;
  uploadDate?: string;
  duration?: string;
  sort?: string;
  features?: string;
  limit?: string;
}

interface HomeQuerystring {
  filter?: string;
  continuation?: string;
}

interface DiscoveryQuerystring {
  tab?: string;
  continuation?: string;
}

interface RecommendationsQuerystring {
  continuation?: string;
  limit?: string;
}

interface RelatedQuerystring {
  limit?: string;
}

interface PlaylistQuerystring {
  continuation?: string;
  limit?: string;
}

interface ChannelFeedQuerystring {
  continuation?: string;
  limit?: string;
}

interface ChannelHomeQuerystring {
  filter?: string;
  continuation?: string;
}

interface ChannelSearchQuerystring {
  q?: string;
  sort?: string;
  contentType?: string;
  continuation?: string;
}

interface CommunityQuerystring {
  continuation?: string;
  limit?: string;
}

interface CommentsQuerystring {
  continuation?: string;
  limit?: string;
  sort?: string;
}

interface CommentRepliesQuerystring {
  continuation?: string;
  limit?: string;
}

interface CaptionContentQuerystring {
  format?: string;
}

interface TranscriptQuerystring {
  language?: string;
}

interface WatchQuerystring {
  relatedLimit?: string;
  commentsLimit?: string;
  commentsSort?: string;
  transcriptLanguage?: string;
}

type HeaderValue = string | string[] | undefined;
type InnertubeClient = Awaited<ReturnType<typeof getInnertubeClient>>;
type ChannelResource = Awaited<ReturnType<InnertubeClient['getChannel']>>;

const app = Fastify({
  logger: true,
});

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

const trimTrailingSlash = (value: string): string => {
  return value.endsWith('/') ? value.slice(0, -1) : value;
};

const getHeaderValue = (value: HeaderValue): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
};

const getApiBaseUrlForCacheKey = (request: FastifyRequest): string => {
  const configuredBaseUrl = process.env.API_BASE_URL?.trim();
  if (configuredBaseUrl) {
    return trimTrailingSlash(configuredBaseUrl);
  }

  const forwardedProto = getHeaderValue(request.headers['x-forwarded-proto']);
  const forwardedHost = getHeaderValue(request.headers['x-forwarded-host']);
  const host = forwardedHost ?? request.headers.host ?? `127.0.0.1:${getDefaultPort('api')}`;
  const protocol = forwardedProto?.split(',')[0]?.trim() || request.protocol || 'http';
  return trimTrailingSlash(`${protocol}://${host}`);
};

const buildCacheKey = (scope: string, parts: unknown[]): string => {
  return JSON.stringify([scope, ...parts]);
};

const responseCache = new InMemoryAsyncCache({
  maxEntries: parsePositiveIntegerEnv(process.env.API_RESPONSE_CACHE_MAX_ENTRIES, 500),
  redisKeyPrefix: 'api:response-cache',
});

const apiRateLimitConfig = {
  limit: parseNonNegativeIntegerEnv(process.env.API_RATE_LIMIT_MAX_REQUESTS, 180),
  windowMs: parsePositiveIntegerEnv(process.env.API_RATE_LIMIT_WINDOW_MS, 60_000),
  maxKeys: parsePositiveIntegerEnv(process.env.API_RATE_LIMIT_MAX_KEYS, 10_000),
} as const;

const apiRateLimiter = apiRateLimitConfig.limit > 0
  ? new FixedWindowRateLimiter({
      ...apiRateLimitConfig,
      keyPrefix: 'api:rate-limit',
    })
  : null;

const apiRetryConfig = {
  maxAttempts: parsePositiveIntegerEnv(process.env.API_UPSTREAM_RETRY_MAX_ATTEMPTS, 3),
  initialDelayMs: parsePositiveIntegerEnv(process.env.API_UPSTREAM_RETRY_INITIAL_DELAY_MS, 250),
  maxDelayMs: parsePositiveIntegerEnv(process.env.API_UPSTREAM_RETRY_MAX_DELAY_MS, 1_500),
} as const;

const isRetryableUpstreamError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return [
    'timeout',
    'timed out',
    'fetch failed',
    'network',
    'socket hang up',
    'econnreset',
    'econnrefused',
    'enotfound',
    'eai_again',
    '429',
    '500',
    '502',
    '503',
    '504',
  ].some((part) => message.includes(part));
};

const responseCacheTtlsMs = {
  search: 30_000,
  videoDetails: 2 * 60_000,
  storyboards: 2 * 60_000,
  playback: 45_000,
  captions: 5 * 60_000,
  transcript: 5 * 60_000,
  watch: 45_000,
  recommendations: 45_000,
  discovery: 45_000,
  related: 45_000,
  comments: 30_000,
  channelDetails: 5 * 60_000,
  channelBrowse: 60_000,
  community: 60_000,
  communityPost: 60_000,
  channelFeed: 60_000,
  playlist: 2 * 60_000,
} as const;

app.addHook('onRequest', async (request, reply) => {
  if (!apiRateLimiter) {
    return;
  }

  const pathname = getRequestPathname(request);
  if (pathname === '/health') {
    return;
  }

  const decision = await apiRateLimiter.consume(getClientAddress(request));
  const resetAfterSeconds = Math.max(0, Math.ceil((decision.resetAt - Date.now()) / 1000));

  reply.header('RateLimit-Limit', String(decision.limit));
  reply.header('RateLimit-Remaining', String(decision.remaining));
  reply.header('RateLimit-Reset', String(resetAfterSeconds));
  reply.header('RateLimit-Policy', `${decision.limit};w=${Math.max(1, Math.ceil(apiRateLimitConfig.windowMs / 1000))}`);

  if (!decision.allowed) {
    return reply
      .header('Retry-After', String(decision.retryAfterSeconds))
      .code(429)
      .send(createErrorPayload(429, 'Rate limit exceeded.', [
        `Try again in ${decision.retryAfterSeconds} seconds.`,
      ]));
  }
});

const sendError = (
  reply: FastifyReply,
  statusCode: number,
  message: string,
  details?: string[],
) => {
  return reply.code(statusCode).send(createErrorPayload(statusCode, message, details));
};

const sendSuccess = <T>(request: FastifyRequest, data: T) => {
  const clonedData = structuredClone(data);
  return createSuccessPayload(withImageProxyUrls(request, clonedData));
};

const sendCachedSuccess = async <T>(
  request: FastifyRequest,
  reply: FastifyReply,
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
) => {
  const cached = await responseCache.getOrLoad(key, ttlMs, () => {
    return withRetries(load, {
      maxAttempts: apiRetryConfig.maxAttempts,
      initialDelayMs: apiRetryConfig.initialDelayMs,
      maxDelayMs: apiRetryConfig.maxDelayMs,
      shouldRetry: (error) => isRetryableUpstreamError(error),
      onRetry: ({ attempt, nextDelayMs, error }) => {
        request.log.warn(
          { err: error, attempt, nextDelayMs, cacheKey: key },
          'Retrying transient upstream API operation',
        );
      },
    });
  });
  reply.header('X-YTPA-Cache', cached.status);
  return sendSuccess(request, cached.value);
};

const trackAnonymousSearch = (request: FastifyRequest, query: string) => {
  void recordAnonymousSearchSignal(request, query).catch((error) => {
    request.log.warn({ err: error, query }, 'Failed to record anonymous search signal');
  });
};

const trackAnonymousWatch = (
  request: FastifyRequest,
  details: Parameters<typeof recordAnonymousWatchSignal>[1] | null | undefined,
) => {
  if (!details) {
    return;
  }

  void recordAnonymousWatchSignal(request, details).catch((error) => {
    request.log.warn({ err: error, videoId: details.id }, 'Failed to record anonymous watch signal');
  });
};

const sendUiAsset = async (
  reply: FastifyReply,
  assetKey: keyof typeof DEBUG_UI_ASSETS,
) => {
  const asset = DEBUG_UI_ASSETS[assetKey];

  try {
    const fileBuffer = await readFile(join(publicDir, asset.fileName));

    return reply
      .header('Cache-Control', 'no-store')
      .type(asset.contentType)
      .send(fileBuffer);
  } catch (error) {
    app.log.error({ err: error, assetKey }, 'Failed to load debug frontend asset');
    return sendError(reply, 500, 'Failed to load debug frontend asset.');
  }
};

const parseEnum = <T extends readonly string[]>(
  value: string | undefined,
  allowedValues: T,
  fieldName: string,
): T[number] | undefined => {
  if (!value) {
    return undefined;
  }

  if (allowedValues.includes(value as T[number])) {
    return value as T[number];
  }

  throw new Error(
    `Invalid "${fieldName}" value. Allowed values: ${allowedValues.join(', ')}.`,
  );
};

const parseFeatures = (value: string | undefined): SearchFeature[] => {
  if (!value) {
    return [];
  }

  const rawFeatures = value
    .split(',')
    .map((feature) => feature.trim())
    .filter((feature) => feature.length > 0);

  const features = Array.from(new Set(rawFeatures));

  for (const feature of features) {
    if (!SEARCH_FEATURES.includes(feature as SearchFeature)) {
      throw new Error(
        `Invalid "features" value "${feature}". Allowed values: ${SEARCH_FEATURES.join(', ')}.`,
      );
    }
  }

  return features as SearchFeature[];
};

const parseLimit = (
  value: string | undefined,
  options: {
    defaultValue?: number;
    maxValue?: number;
  } = {},
): number => {
  const defaultValue = options.defaultValue ?? defaultSearchLimit;
  const maxValue = options.maxValue ?? maxSearchLimit;

  if (!value) {
    return defaultValue;
  }

  const limit = Number(value);

  if (!Number.isInteger(limit) || limit < 1 || limit > maxValue) {
    throw new Error(`"limit" must be an integer between 1 and ${maxValue}.`);
  }

  return limit;
};

const parseSearchFilters = (query: SearchQuerystring): SearchFilters => {
  const type = parseEnum(query.type, SEARCH_TYPES, 'type');
  const uploadDate = parseEnum(query.uploadDate, SEARCH_UPLOAD_DATES, 'uploadDate');
  const duration = parseEnum(query.duration, SEARCH_DURATIONS, 'duration');
  const prioritize = parseEnum(query.sort, SEARCH_PRIORITIES, 'sort');
  const features = parseFeatures(query.features);
  const limit = parseLimit(query.limit);

  return {
    type: type && type !== 'all' ? (type as Exclude<SearchType, 'all'>) : undefined,
    uploadDate:
      uploadDate && uploadDate !== 'all'
        ? (uploadDate as Exclude<SearchUploadDate, 'all'>)
        : undefined,
    duration:
      duration && duration !== 'all'
        ? (duration as Exclude<SearchDuration, 'all'>)
        : undefined,
    prioritize: prioritize as SearchPriority | undefined,
    features,
    limit,
  };
};

const toInnertubeFilters = (filters: SearchFilters) => {
  return {
    type: filters.type,
    upload_date: filters.uploadDate,
    duration: filters.duration,
    prioritize: filters.prioritize,
    features: filters.features.length > 0 ? filters.features : undefined,
  };
};

const parseCommentSort = (value: string | undefined): CommentSort => {
  const sort = parseEnum(value, COMMENT_SORTS, 'sort');
  return sort ?? 'top';
};

const getCommentSortLabel = (sort: CommentSort): string => {
  return sort === 'newest' ? 'Newest' : 'Top';
};

const createUnavailableTranscriptData = (
  videoId: string,
  requestedLanguage: string | null,
  unavailableReason: string,
) => {
  return {
    id: videoId,
    available: false,
    source: 'unavailable' as const,
    requestedLanguage,
    selectedLanguage: null,
    languages: [],
    unavailableReason,
    segmentCount: 0,
    segments: [],
  };
};

const createEmptyRelatedData = (videoId: string) => {
  return {
    id: videoId,
    filters: [],
    hasContinuation: false,
    autoplayVideoId: null,
    items: [],
  };
};

const createEmptyCommentsData = (videoId: string, sort: CommentSort) => {
  return {
    id: videoId,
    title: 'Comments',
    countText: null,
    commentsCountText: null,
    sort,
    availableSorts: [{
      id: sort,
      label: getCommentSortLabel(sort),
      selected: true,
    }],
    hasContinuation: false,
    continuation: null,
    items: [],
  };
};

const createEmptyCommunityPostsData = (channelId: string) => {
  return {
    id: channelId,
    hasContinuation: false,
    continuation: null,
    items: [],
  };
};

const createBrowseEndpoint = (browseId: string) => {
  return new YTNodes.NavigationEndpoint({
    browseEndpoint: {
      browseId,
    },
  });
};

const normalizeDiscoveryOptionKey = (value: string): string => {
  return value.trim().toLowerCase();
};

const matchesDiscoveryOptionValue = (
  value: string,
  requestedValue: string,
): boolean => {
  return normalizeDiscoveryOptionKey(value) === normalizeDiscoveryOptionKey(requestedValue);
};

const findDiscoveryOption = (
  options: Array<{ id: string; label: string; selected: boolean }>,
  requestedValue: string,
) => {
  const normalizedRequestedValue = normalizeDiscoveryOptionKey(requestedValue);

  return options.find((option) => {
    return matchesDiscoveryOptionValue(option.id, normalizedRequestedValue) ||
      matchesDiscoveryOptionValue(option.label, normalizedRequestedValue);
  }) ?? null;
};

const selectDiscoveryOption = (
  options: Array<{ id: string; label: string; selected: boolean }>,
  selectedId: string | null,
) => {
  if (!selectedId) {
    return options;
  }

  return options.map((option) => ({
    ...option,
    selected: normalizeDiscoveryOptionKey(option.id) === normalizeDiscoveryOptionKey(selectedId),
  }));
};

const getSelectedDiscoveryOptionLabel = (
  options: Array<{ id: string; label: string; selected: boolean }>,
): string | null => {
  return options.find((option) => option.selected)?.label ?? null;
};

const createDiscoveryTitle = (
  feedId: 'home' | 'explore' | 'trending',
  selectedOptionLabel: string | null,
  fallbackTitle: string | null,
): string => {
  if (feedId === 'home') {
    return fallbackTitle ?? 'Home';
  }

  if (selectedOptionLabel) {
    return selectedOptionLabel;
  }

  if (feedId === 'trending') {
    return 'Trending';
  }

  return fallbackTitle ?? 'Explore';
};

const createContinuationEndpoint = (
  token: string,
  request:
    | 'CONTINUATION_REQUEST_TYPE_SEARCH'
    | 'CONTINUATION_REQUEST_TYPE_BROWSE'
    | 'CONTINUATION_REQUEST_TYPE_WATCH_NEXT',
) => {
  return new YTNodes.NavigationEndpoint({
    continuationCommand: {
      request,
      token,
    },
  });
};

const getChannelFeedByTab = async (
  channel: ChannelResource,
  tab: ChannelFeedTab,
) => {
  switch (tab) {
    case 'videos':
      return channel.getVideos();
    case 'shorts':
      return channel.getShorts();
    case 'streams':
      return channel.getLiveStreams();
    case 'playlists':
      return channel.getPlaylists();
    default:
      throw new Error('Unsupported channel feed tab.');
  }
};

app.get('/debug', async (_request, reply) => {
  return sendUiAsset(reply, 'index');
});

app.get('/debug/', async (_request, reply) => {
  return sendUiAsset(reply, 'index');
});

app.get('/debug/app.js', async (_request, reply) => {
  return sendUiAsset(reply, 'script');
});

app.get('/debug/styles.css', async (_request, reply) => {
  return sendUiAsset(reply, 'styles');
});

app.get('/health', async () => {
  return createHealthPayload(serviceName);
});

app.get('/v1/recommendations', async (request, reply) => {
  const querystring = request.query as RecommendationsQuerystring;
  const continuation = querystring.continuation?.trim();

  let limit: number;

  try {
    limit = parseLimit(querystring.limit, {
      defaultValue: defaultRecommendationLimit,
      maxValue: maxRecommendationLimit,
    });
  } catch (error) {
    return sendError(
      reply,
      400,
      error instanceof Error ? error.message : 'Invalid recommendations query.',
    );
  }

  try {
    if (continuation) {
      const decodedContinuation = await decodeRecommendationPaginationToken(continuation);
      const payload = await sendCachedSuccess(
        request,
        reply,
        buildCacheKey('recommendations-continuation', [continuation, limit]),
        responseCacheTtlsMs.recommendations,
        async () => {
          return buildRecommendationContinuationFeed(request, decodedContinuation, limit);
        },
      );

      return payload;
    }

    const visitorKey = getAnonymousRecommendationVisitorKey(request);
    const payload = await sendCachedSuccess(
      request,
      reply,
      buildCacheKey('recommendations', [visitorKey, limit]),
      responseCacheTtlsMs.recommendations,
      async () => {
        return buildAnonymousRecommendationFeed(request, limit);
      },
    );

    return payload;
  } catch (error) {
    if (
      error instanceof Error &&
      (
        error.message === 'Invalid or expired continuation token.' ||
        error.message === 'Invalid recommendations continuation token.' ||
        error.message === 'Recommendations continuation token does not belong to the current anonymous visitor profile.'
      )
    ) {
      return sendError(reply, 400, error.message);
    }

    request.log.error(
      { err: error, hasContinuation: !!continuation, limit },
      'Failed to fetch anonymous recommendations',
    );

    return sendError(reply, 502, 'Failed to fetch anonymous recommendations from upstream.');
  }
});

app.get('/v1/home', async (request, reply) => {
  const querystring = request.query as HomeQuerystring;
  const continuation = querystring.continuation?.trim();
  const requestedFilter = querystring.filter?.trim() || null;

  try {
    if (continuation) {
      return sendCachedSuccess(
        request,
        reply,
        buildCacheKey('discovery-home-continuation', [continuation]),
        responseCacheTtlsMs.discovery,
        async () => {
          const decodedContinuation = await decodeDiscoveryPaginationToken(continuation);

          if (decodedContinuation.feed !== 'home') {
            throw new Error('Home continuation token does not match the requested feed.');
          }

          const innertube = await getInnertubeClient();
          const response = await innertube.call(
            createContinuationEndpoint(
              decodedContinuation.token,
              'CONTINUATION_REQUEST_TYPE_BROWSE',
            ),
            { parse: true },
          );
          const feed = new Mixins.Feed(innertube.actions, response, true);
          const rawContinuation = getContinuationTokenFromMemoSource(response);
          const nextContinuation = rawContinuation
            ? await encodeDiscoveryPaginationToken({
                token: rawContinuation,
                feed: decodedContinuation.feed,
                optionType: decodedContinuation.optionType,
                title: decodedContinuation.title,
                options: decodedContinuation.options,
              })
            : null;

          return createDiscoveryFeedData(
            'home',
            decodedContinuation.title,
            decodedContinuation.optionType,
            decodedContinuation.options,
            feed,
            nextContinuation,
          );
        },
      );
    }

    return sendCachedSuccess(
      request,
      reply,
      buildCacheKey('discovery-home', [requestedFilter]),
      responseCacheTtlsMs.discovery,
      async () => {
        const innertube = await getInnertubeClient();
        let homeFeed = await innertube.getHomeFeed();
        let options = createDiscoveryFeedOptions(homeFeed, 'filter');

        if (requestedFilter) {
          const targetOption = findDiscoveryOption(options, requestedFilter);

          if (!targetOption) {
            throw new Error('Invalid home filter.');
          }

          if (!targetOption.selected) {
            homeFeed = await homeFeed.applyFilter(targetOption.label);
            const updatedOptions = createDiscoveryFeedOptions(homeFeed, 'filter');
            options = updatedOptions.length > 0
              ? updatedOptions
              : selectDiscoveryOption(options, targetOption.id);
          }
        }

        const title = createDiscoveryTitle(
          'home',
          getSelectedDiscoveryOptionLabel(options),
          homeFeed.header?.title?.toString() ?? null,
        );
        const rawContinuation = getContinuationTokenFromMemoSource(homeFeed.page);
        const nextContinuation = rawContinuation
          ? await encodeDiscoveryPaginationToken({
              token: rawContinuation,
              feed: 'home',
              optionType: 'filter',
              title,
              options,
            })
          : null;

        return createDiscoveryFeedData(
          'home',
          title,
          'filter',
          options,
          homeFeed,
          nextContinuation,
        );
      },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (
        error.message === 'Invalid home filter.' ||
        error.message === 'Home continuation token does not match the requested feed.' ||
        error.message === 'Invalid or expired continuation token.' ||
        error.message === 'Invalid discovery continuation token.'
      )
    ) {
      return sendError(reply, 400, error.message);
    }

    request.log.error(
      { err: error, requestedFilter, hasContinuation: !!continuation },
      'Failed to fetch home discovery feed',
    );

    return sendError(reply, 502, 'Failed to fetch home feed from upstream.');
  }
});

const handleDiscoveryBrowseRequest = async (
  request: FastifyRequest<{ Querystring: DiscoveryQuerystring }>,
  reply: FastifyReply,
  feedId: 'explore' | 'trending',
) => {
  const querystring = request.query;
  const continuation = querystring.continuation?.trim();
  const requestedTab = querystring.tab?.trim() || null;

  try {
    if (continuation) {
      return sendCachedSuccess(
        request,
        reply,
        buildCacheKey('discovery-continuation', [feedId, continuation]),
        responseCacheTtlsMs.discovery,
        async () => {
          const decodedContinuation = await decodeDiscoveryPaginationToken(continuation);

          if (decodedContinuation.feed !== feedId) {
            throw new Error('Discovery continuation token does not match the requested feed.');
          }

          const innertube = await getInnertubeClient();
          const response = await innertube.call(
            createContinuationEndpoint(
              decodedContinuation.token,
              'CONTINUATION_REQUEST_TYPE_BROWSE',
            ),
            { parse: true },
          );
          const feed = new Mixins.Feed(innertube.actions, response, true);
          const rawContinuation = getContinuationTokenFromMemoSource(response);
          const nextContinuation = rawContinuation
            ? await encodeDiscoveryPaginationToken({
                token: rawContinuation,
                feed: decodedContinuation.feed,
                optionType: decodedContinuation.optionType,
                title: decodedContinuation.title,
                options: decodedContinuation.options,
              })
            : null;

          return createDiscoveryFeedData(
            feedId,
            decodedContinuation.title,
            decodedContinuation.optionType,
            decodedContinuation.options,
            feed,
            nextContinuation,
          );
        },
      );
    }

    return sendCachedSuccess(
      request,
      reply,
      buildCacheKey('discovery-feed', [feedId, requestedTab]),
      responseCacheTtlsMs.discovery,
      async () => {
        const innertube = await getInnertubeClient();
        const initialResponse = await innertube.call(
          createBrowseEndpoint(defaultExploreBrowseId),
          { parse: true },
        );
        let feed = new Mixins.Feed(innertube.actions, initialResponse, true);
        let options = createDiscoveryFeedOptions(feed, 'tab');

        if (requestedTab) {
          const targetOption = findDiscoveryOption(options, requestedTab);
          const rawTargetOption = feed.memo
            .getType(YTNodes.SubFeedOption)
            .find((option) => matchesDiscoveryOptionValue(option.name.toString(), requestedTab));

          if (!targetOption || !rawTargetOption) {
            throw new Error('Invalid explore tab.');
          }

          if (!targetOption.selected) {
            const selectedResponse = await rawTargetOption.endpoint.call(innertube.actions, {
              parse: true,
            });
            feed = new Mixins.Feed(innertube.actions, selectedResponse, true);
            const updatedOptions = createDiscoveryFeedOptions(feed, 'tab');
            options = updatedOptions.length > 0
              ? updatedOptions
              : selectDiscoveryOption(options, targetOption.id);
          }
        }

        const title = createDiscoveryTitle(
          feedId,
          getSelectedDiscoveryOptionLabel(options),
          null,
        );
        const rawContinuation = getContinuationTokenFromMemoSource(feed.page);
        const nextContinuation = rawContinuation
          ? await encodeDiscoveryPaginationToken({
              token: rawContinuation,
              feed: feedId,
              optionType: 'tab',
              title,
              options,
            })
          : null;

        return createDiscoveryFeedData(
          feedId,
          title,
          'tab',
          options,
          feed,
          nextContinuation,
        );
      },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (
        error.message === 'Invalid explore tab.' ||
        error.message === 'Discovery continuation token does not match the requested feed.' ||
        error.message === 'Invalid or expired continuation token.' ||
        error.message === 'Invalid discovery continuation token.'
      )
    ) {
      return sendError(reply, 400, error.message);
    }

    request.log.error(
      { err: error, feedId, requestedTab, hasContinuation: !!continuation },
      'Failed to fetch discovery browse feed',
    );

    return sendError(reply, 502, 'Failed to fetch ' + feedId + ' feed from upstream.');
  }
};

app.get('/v1/explore', async (request, reply) => {
  return handleDiscoveryBrowseRequest(
    request as FastifyRequest<{ Querystring: DiscoveryQuerystring }>,
    reply,
    'explore',
  );
});

app.get('/v1/trending', async (request, reply) => {
  return handleDiscoveryBrowseRequest(
    request as FastifyRequest<{ Querystring: DiscoveryQuerystring }>,
    reply,
    'trending',
  );
});

app.get('/v1/search', async (request, reply) => {
  const querystring = request.query as SearchQuerystring;
  const continuation = querystring.continuation?.trim();

  let filters: SearchFilters;

  try {
    filters = parseSearchFilters(querystring);
  } catch (error) {
    return sendError(
      reply,
      400,
      error instanceof Error ? error.message : 'Invalid search query.',
    );
  }

  if (!continuation) {
    const query = querystring.q?.trim();

    if (!query) {
      return sendError(reply, 400, 'Query parameter "q" is required.');
    }

    try {
      const payload = await sendCachedSuccess(
        request,
        reply,
        buildCacheKey('search', [query, filters]),
        responseCacheTtlsMs.search,
        async () => {
          const innertube = await getInnertubeClient();
          const search = await innertube.search(query, toInnertubeFilters(filters));
          const fullPageData = createSearchResponseData(
            query,
            search.estimated_results,
            { ...filters, limit: maxSearchLimit },
            search.results,
            null,
          );
          const rawContinuation = getContinuationTokenFromMemoSource(search.page);
          const bufferedItems = fullPageData.items.slice(filters.limit);
          const nextContinuation =
            bufferedItems.length > 0 || rawContinuation
              ? await encodeSearchPaginationToken({
                  token: rawContinuation,
                  query,
                  estimatedResults: search.estimated_results,
                  filters,
                  bufferedItems,
                })
              : null;

          return {
            ...fullPageData,
            appliedFilters: filters,
            hasContinuation: nextContinuation !== null,
            continuation: nextContinuation,
            items: fullPageData.items.slice(0, filters.limit),
          };
        },
      );

      if (payload.ok) {
        trackAnonymousSearch(request, query);
      }

      return payload;
    } catch (error) {
      request.log.error({ err: error, query, filters }, 'Failed to fetch search results');

      return sendError(reply, 502, 'Failed to fetch search results from upstream.');
    }
  }

  let decodedContinuation;

  try {
    decodedContinuation = await decodeSearchPaginationToken(continuation);
  } catch (error) {
    return sendError(
      reply,
      400,
      error instanceof Error ? error.message : 'Invalid search continuation token.',
    );
  }

  const appliedFilters: SearchFilters = {
    ...decodedContinuation.filters,
    limit: filters.limit,
  };

  try {
    return sendCachedSuccess(
      request,
      reply,
      buildCacheKey('search-continuation', [continuation, appliedFilters.limit]),
      responseCacheTtlsMs.search,
      async () => {
        const innertube = await getInnertubeClient();
        let bufferedItems = decodedContinuation.bufferedItems ?? [];
        let rawContinuation = decodedContinuation.token;

        if (bufferedItems.length < appliedFilters.limit && rawContinuation) {
          const response = await innertube.call(
            createContinuationEndpoint(
              rawContinuation,
              'CONTINUATION_REQUEST_TYPE_SEARCH',
            ),
            { parse: true },
          );
          const fullPageData = createSearchContinuationData(
            decodedContinuation.query,
            decodedContinuation.estimatedResults,
            { ...appliedFilters, limit: maxSearchLimit },
            response,
            null,
          );
          bufferedItems = [...bufferedItems, ...fullPageData.items];
          rawContinuation = getContinuationTokenFromMemoSource(response);
        }

        const items = bufferedItems.slice(0, appliedFilters.limit);
        const remainingItems = bufferedItems.slice(appliedFilters.limit);
        const nextContinuation =
          remainingItems.length > 0 || rawContinuation
            ? await encodeSearchPaginationToken({
                token: rawContinuation,
                query: decodedContinuation.query,
                estimatedResults: decodedContinuation.estimatedResults,
                filters: appliedFilters,
                bufferedItems: remainingItems,
              })
            : null;

        return {
          query: decodedContinuation.query,
          estimatedResults: decodedContinuation.estimatedResults,
          appliedFilters,
          hasContinuation: nextContinuation !== null,
          continuation: nextContinuation,
          items,
        };
      },
    );
  } catch (error) {
    request.log.error(
      {
        err: error,
        query: decodedContinuation.query,
        filters: appliedFilters,
        hasContinuation: true,
      },
      'Failed to fetch search continuation results',
    );

    return sendError(reply, 502, 'Failed to fetch search results from upstream.');
  }
});

app.get('/v1/watch/:videoId', async (request, reply) => {
  const { videoId } = request.params as { videoId: string };
  const querystring = request.query as WatchQuerystring;
  const normalizedVideoId = videoId.trim();

  if (!normalizedVideoId) {
    return sendError(reply, 400, 'Route parameter "videoId" is required.');
  }

  let relatedLimit: number;
  let commentsLimit: number;
  let commentsSort: CommentSort;

  try {
    relatedLimit = parseLimit(querystring.relatedLimit, {
      defaultValue: defaultWatchRelatedLimit,
    });
    commentsLimit = parseLimit(querystring.commentsLimit, {
      defaultValue: defaultWatchCommentsLimit,
    });
    commentsSort = parseCommentSort(querystring.commentsSort);
  } catch (error) {
    return sendError(
      reply,
      400,
      error instanceof Error ? error.message : 'Invalid watch query.',
    );
  }

  const requestedTranscriptLanguage = querystring.transcriptLanguage?.trim() || null;
  const mediaProxyBaseUrl = getMediaProxyBaseUrl(request);
  const apiBaseUrl = getApiBaseUrlForCacheKey(request);

  try {
    const payload = await sendCachedSuccess(
      request,
      reply,
      buildCacheKey('video-watch', [
        normalizedVideoId,
        mediaProxyBaseUrl,
        apiBaseUrl,
        relatedLimit,
        commentsLimit,
        commentsSort,
        requestedTranscriptLanguage,
      ]),
      responseCacheTtlsMs.watch,
      async () => {
        const [innertube, playbackInnertube] = await Promise.all([
          getInnertubeClient(),
          getPlaybackInnertubeClient(),
        ]);

        const detailedInfoPromise = innertube.getInfo(normalizedVideoId).catch((error) => {
          request.log.warn(
            { err: error, videoId: normalizedVideoId },
            'Failed to fetch detailed watch data, returning partial watch payload',
          );
          return null;
        });

        const commentsPromise = innertube.getComments(
          normalizedVideoId,
          commentsSort === 'newest' ? 'NEWEST_FIRST' : 'TOP_COMMENTS',
        ).catch((error) => {
          request.log.warn(
            { err: error, videoId: normalizedVideoId, commentsSort },
            'Failed to fetch watch comments, returning watch payload without comments',
          );
          return null;
        });

        const [apiBasicInfo, playbackBasicInfo, detailedInfo, commentsFeed] = await Promise.all([
          innertube.getBasicInfo(normalizedVideoId),
          playbackInnertube.getBasicInfo(normalizedVideoId),
          detailedInfoPromise,
          commentsPromise,
        ]);

        const playbackEndpoint = buildPlaybackEndpointPath(normalizedVideoId);
        const storyboardsEndpoint = buildStoryboardsEndpointPath(normalizedVideoId);
        const warnings: string[] = [];

        if (!detailedInfo) {
          warnings.push('Related content and transcript could not be loaded from upstream.');
        }

        if (!commentsFeed) {
          warnings.push('Top-level comments could not be loaded from upstream.');
        }

        const transcript = detailedInfo
          ? await createVideoTranscriptData(
              normalizedVideoId,
              detailedInfo,
              requestedTranscriptLanguage,
            )
          : createUnavailableTranscriptData(
              normalizedVideoId,
              requestedTranscriptLanguage,
              'Transcript data could not be loaded from upstream.',
            );

        const [playback, storyboards] = await Promise.all([
          createPlaybackData(request, normalizedVideoId, playbackBasicInfo),
          createVideoStoryboardsData(request, normalizedVideoId, playbackBasicInfo),
        ]);

        return {
          id: normalizedVideoId,
          details: createVideoDetailsData(
            normalizedVideoId,
            apiBasicInfo,
            playbackEndpoint,
            storyboardsEndpoint,
          ),
          playback,
          storyboards,
          captions: createVideoCaptionsData(request, normalizedVideoId, apiBasicInfo),
          transcript,
          related: detailedInfo
            ? createVideoRelatedData(normalizedVideoId, detailedInfo, relatedLimit)
            : createEmptyRelatedData(normalizedVideoId),
          comments: commentsFeed
            ? createVideoCommentsData(
                normalizedVideoId,
                commentsFeed,
                commentsSort,
                commentsLimit,
              )
            : createEmptyCommentsData(normalizedVideoId, commentsSort),
          warnings,
        };
      },
    );

    if (payload.ok) {
      trackAnonymousWatch(request, payload.data.details);
    }

    return payload;
  } catch (error) {
    request.log.error(
      {
        err: error,
        videoId: normalizedVideoId,
        relatedLimit,
        commentsLimit,
        commentsSort,
        requestedTranscriptLanguage,
      },
      'Failed to fetch unified watch payload',
    );

    return sendError(reply, 502, 'Failed to fetch unified watch payload from upstream.');
  }
});

app.get('/v1/videos/:videoId', async (request, reply) => {
  const { videoId } = request.params as { videoId: string };
  const normalizedVideoId = videoId.trim();

  if (!normalizedVideoId) {
    return sendError(reply, 400, 'Route parameter "videoId" is required.');
  }

  try {
    return sendCachedSuccess(
      request,
      reply,
      buildCacheKey('video-details', [normalizedVideoId]),
      responseCacheTtlsMs.videoDetails,
      async () => {
        const innertube = await getInnertubeClient();
        const info = await innertube.getBasicInfo(normalizedVideoId);
        const playbackEndpoint = buildPlaybackEndpointPath(normalizedVideoId);
        const storyboardsEndpoint = buildStoryboardsEndpointPath(normalizedVideoId);

        return createVideoDetailsData(
          normalizedVideoId,
          info,
          playbackEndpoint,
          storyboardsEndpoint,
        );
      },
    );
  } catch (error) {
    request.log.error({ err: error, videoId: normalizedVideoId }, 'Failed to fetch video details');

    return sendError(reply, 502, 'Failed to fetch video details from upstream.');
  }
});

app.get('/v1/videos/:videoId/storyboards', async (request, reply) => {
  const { videoId } = request.params as { videoId: string };
  const normalizedVideoId = videoId.trim();

  if (!normalizedVideoId) {
    return sendError(reply, 400, 'Route parameter "videoId" is required.');
  }

  const mediaProxyBaseUrl = getMediaProxyBaseUrl(request);

  try {
    return sendCachedSuccess(
      request,
      reply,
      buildCacheKey('video-storyboards', [normalizedVideoId, mediaProxyBaseUrl]),
      responseCacheTtlsMs.storyboards,
      async () => {
        const innertube = await getPlaybackInnertubeClient();
        const info = await innertube.getBasicInfo(normalizedVideoId);
        return createVideoStoryboardsData(request, normalizedVideoId, info);
      },
    );
  } catch (error) {
    request.log.error(
      { err: error, videoId: normalizedVideoId },
      'Failed to fetch video storyboard data',
    );

    return sendError(reply, 502, 'Failed to fetch video storyboard data from upstream.');
  }
});
app.get('/v1/videos/:videoId/playback', async (request, reply) => {
  const { videoId } = request.params as { videoId: string };
  const normalizedVideoId = videoId.trim();

  if (!normalizedVideoId) {
    return sendError(reply, 400, 'Route parameter "videoId" is required.');
  }

  const mediaProxyBaseUrl = getMediaProxyBaseUrl(request);

  try {
    return sendCachedSuccess(
      request,
      reply,
      buildCacheKey('video-playback', [normalizedVideoId, mediaProxyBaseUrl]),
      responseCacheTtlsMs.playback,
      async () => {
        const innertube = await getPlaybackInnertubeClient();
        const info = await innertube.getBasicInfo(normalizedVideoId);

        return createPlaybackData(request, normalizedVideoId, info);
      },
    );
  } catch (error) {
    request.log.error(
      { err: error, videoId: normalizedVideoId },
      'Failed to fetch video playback data',
    );

    return sendError(reply, 502, 'Failed to fetch video playback data from upstream.');
  }
});

app.get('/v1/videos/:videoId/captions', async (request, reply) => {
  const { videoId } = request.params as { videoId: string };
  const normalizedVideoId = videoId.trim();

  if (!normalizedVideoId) {
    return sendError(reply, 400, 'Route parameter "videoId" is required.');
  }

  const apiBaseUrl = getApiBaseUrlForCacheKey(request);

  try {
    return sendCachedSuccess(
      request,
      reply,
      buildCacheKey('video-captions', [normalizedVideoId, apiBaseUrl]),
      responseCacheTtlsMs.captions,
      async () => {
        const innertube = await getInnertubeClient();
        const info = await innertube.getBasicInfo(normalizedVideoId);
        return createVideoCaptionsData(request, normalizedVideoId, info);
      },
    );
  } catch (error) {
    request.log.error(
      { err: error, videoId: normalizedVideoId },
      'Failed to fetch video captions data',
    );

    return sendError(reply, 502, 'Failed to fetch video captions data from upstream.');
  }
});

app.get('/v1/videos/:videoId/captions/:trackId', async (request, reply) => {
  const { videoId, trackId } = request.params as { videoId: string; trackId: string };
  const querystring = request.query as CaptionContentQuerystring;
  const normalizedVideoId = videoId.trim();
  const normalizedTrackId = trackId.trim();

  if (!normalizedVideoId) {
    return sendError(reply, 400, 'Route parameter "videoId" is required.');
  }

  if (!normalizedTrackId) {
    return sendError(reply, 400, 'Route parameter "trackId" is required.');
  }

  let format;

  try {
    format = parseCaptionContentFormat(querystring.format);
  } catch (error) {
    return sendError(
      reply,
      400,
      error instanceof Error ? error.message : 'Invalid caption content query.',
    );
  }

  try {
    const innertube = await getInnertubeClient();
    const info = await innertube.getBasicInfo(normalizedVideoId);
    const content = await resolveCaptionTrackContent(
      normalizedVideoId,
      info,
      normalizedTrackId,
      format,
    );

    return reply
      .header('Cache-Control', 'no-store')
      .header('X-Subtitle-Source', content.source)
      .type(content.contentType)
      .send(content.body);
  } catch (error) {
    if (error instanceof CaptionTrackNotFoundError) {
      return sendError(reply, 404, error.message);
    }

    request.log.error(
      {
        err: error,
        videoId: normalizedVideoId,
        trackId: normalizedTrackId,
        format,
      },
      'Failed to fetch caption track content',
    );

    return sendError(reply, 502, 'Failed to fetch caption track content from upstream.');
  }
});

app.get('/v1/videos/:videoId/transcript', async (request, reply) => {
  const { videoId } = request.params as { videoId: string };
  const querystring = request.query as TranscriptQuerystring;
  const normalizedVideoId = videoId.trim();
  const requestedLanguage = querystring.language?.trim() || null;

  if (!normalizedVideoId) {
    return sendError(reply, 400, 'Route parameter "videoId" is required.');
  }

  try {
    return sendCachedSuccess(
      request,
      reply,
      buildCacheKey('video-transcript', [normalizedVideoId, requestedLanguage]),
      responseCacheTtlsMs.transcript,
      async () => {
        const innertube = await getInnertubeClient();
        const info = await innertube.getInfo(normalizedVideoId);
        return createVideoTranscriptData(
          normalizedVideoId,
          info,
          requestedLanguage,
        );
      },
    );
  } catch (error) {
    request.log.error(
      { err: error, videoId: normalizedVideoId, requestedLanguage },
      'Failed to fetch video transcript data',
    );

    return sendError(reply, 502, 'Failed to fetch video transcript data from upstream.');
  }
});

const handleVideoRelatedRequest = async (
  request: FastifyRequest<{
    Params: { videoId: string };
    Querystring: RelatedQuerystring;
  }>,
  reply: FastifyReply,
) => {
  const { videoId } = request.params;
  const normalizedVideoId = videoId.trim();

  if (!normalizedVideoId) {
    return sendError(reply, 400, 'Route parameter "videoId" is required.');
  }

  let limit: number;

  try {
    limit = parseLimit(request.query.limit);
  } catch (error) {
    return sendError(
      reply,
      400,
      error instanceof Error ? error.message : 'Invalid related query.',
    );
  }

  try {
    return sendCachedSuccess(
      request,
      reply,
      buildCacheKey('video-related', [normalizedVideoId, limit]),
      responseCacheTtlsMs.related,
      async () => {
        const innertube = await getInnertubeClient();
        const info = await innertube.getInfo(normalizedVideoId);
        return createVideoRelatedData(normalizedVideoId, info, limit);
      },
    );
  } catch (error) {
    request.log.error(
      { err: error, videoId: normalizedVideoId, limit },
      'Failed to fetch watch-next related feed',
    );

    return sendError(reply, 502, 'Failed to fetch related content from upstream.');
  }
};

app.get('/v1/videos/:videoId/watch-next', handleVideoRelatedRequest);
app.get('/v1/videos/:videoId/related', handleVideoRelatedRequest);
app.get('/v1/videos/:videoId/comments', async (request, reply) => {
  const { videoId } = request.params as { videoId: string };
  const querystring = request.query as CommentsQuerystring;
  const normalizedVideoId = videoId.trim();

  if (!normalizedVideoId) {
    return sendError(reply, 400, 'Route parameter "videoId" is required.');
  }

  let limit: number;
  let sort: CommentSort;

  try {
    limit = parseLimit(querystring.limit);
    sort = parseCommentSort(querystring.sort);
  } catch (error) {
    return sendError(
      reply,
      400,
      error instanceof Error ? error.message : 'Invalid comments query.',
    );
  }

  const continuation = querystring.continuation?.trim();

  try {
    if (continuation) {
      return sendCachedSuccess(
        request,
        reply,
        buildCacheKey('video-comments-continuation', [continuation, sort, limit]),
        responseCacheTtlsMs.comments,
        async () => {
          const innertube = await getInnertubeClient();
          const response = await innertube.call(
            createContinuationEndpoint(
              continuation,
              'CONTINUATION_REQUEST_TYPE_WATCH_NEXT',
            ),
            { parse: true },
          );

          return createVideoCommentsContinuationData(
            normalizedVideoId,
            response,
            sort,
            limit,
          );
        },
      );
    }

    return sendCachedSuccess(
      request,
      reply,
      buildCacheKey('video-comments', [normalizedVideoId, sort, limit]),
      responseCacheTtlsMs.comments,
      async () => {
        const innertube = await getInnertubeClient();
        const comments = await innertube.getComments(
          normalizedVideoId,
          sort === 'newest' ? 'NEWEST_FIRST' : 'TOP_COMMENTS',
        );

        return createVideoCommentsData(normalizedVideoId, comments, sort, limit);
      },
    );
  } catch (error) {
    request.log.error(
      {
        err: error,
        videoId: normalizedVideoId,
        sort,
        limit,
        hasContinuation: !!continuation,
      },
      'Failed to fetch video comments',
    );

    return sendError(reply, 502, 'Failed to fetch video comments from upstream.');
  }
});
app.get('/v1/videos/:videoId/comments/:commentId/replies', async (request, reply) => {
  const { videoId, commentId } = request.params as { videoId: string; commentId: string };
  const querystring = request.query as CommentRepliesQuerystring;
  const normalizedVideoId = videoId.trim();
  const normalizedCommentId = commentId.trim();

  if (!normalizedVideoId) {
    return sendError(reply, 400, 'Route parameter "videoId" is required.');
  }

  if (!normalizedCommentId) {
    return sendError(reply, 400, 'Route parameter "commentId" is required.');
  }

  let limit: number;

  try {
    limit = parseLimit(querystring.limit);
  } catch (error) {
    return sendError(
      reply,
      400,
      error instanceof Error ? error.message : 'Invalid comment replies query.',
    );
  }

  const continuation = querystring.continuation?.trim();

  try {
    if (continuation) {
      return sendCachedSuccess(
        request,
        reply,
        buildCacheKey('video-comment-replies-continuation', [normalizedVideoId, normalizedCommentId, continuation, limit]),
        responseCacheTtlsMs.comments,
        async () => {
          const innertube = await getInnertubeClient();
          const response = await innertube.call(
            createContinuationEndpoint(
              continuation,
              'CONTINUATION_REQUEST_TYPE_WATCH_NEXT',
            ),
            { parse: true },
          );

          return createVideoCommentRepliesData(
            normalizedVideoId,
            normalizedCommentId,
            response,
            limit,
          );
        },
      );
    }

    return sendCachedSuccess(
      request,
      reply,
      buildCacheKey('video-comment-replies', [normalizedVideoId, normalizedCommentId, limit]),
      responseCacheTtlsMs.comments,
      async () => {
        const innertube = await getInnertubeClient();
        const comments = await innertube.getComments(
          normalizedVideoId,
          'TOP_COMMENTS',
          normalizedCommentId,
        );
        const thread = comments.contents.find((candidate) => {
          return candidate.comment?.comment_id === normalizedCommentId;
        }) ?? comments.contents[0] ?? null;

        if (!thread) {
          throw new Error('Comment thread not found.');
        }

        const repliesContinuation = thread.comment_replies_data?.contents?.firstOfType(
          YTNodes.ContinuationItem,
        );

        if (!thread.has_replies || !repliesContinuation) {
          return {
            id: normalizedVideoId,
            commentId: normalizedCommentId,
            hasContinuation: false,
            continuation: null,
            items: [],
          };
        }

        const response = await repliesContinuation.endpoint.call(innertube.actions, {
          parse: true,
        });

        return createVideoCommentRepliesData(
          normalizedVideoId,
          normalizedCommentId,
          response,
          limit,
        );
      },
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Comment thread not found.') {
      return sendError(reply, 404, error.message);
    }

    request.log.error(
      {
        err: error,
        videoId: normalizedVideoId,
        commentId: normalizedCommentId,
        limit,
        hasContinuation: !!continuation,
      },
      'Failed to fetch video comment replies',
    );

    return sendError(reply, 502, 'Failed to fetch video comment replies from upstream.');
  }
});

app.get('/v1/channels/:channelId', async (request, reply) => {
  const { channelId } = request.params as { channelId: string };
  const normalizedChannelId = channelId.trim();

  if (!normalizedChannelId) {
    return sendError(reply, 400, 'Route parameter "channelId" is required.');
  }

  try {
    return sendCachedSuccess(
      request,
      reply,
      buildCacheKey('channel-details', [normalizedChannelId]),
      responseCacheTtlsMs.channelDetails,
      async () => {
        const innertube = await getInnertubeClient();
        const channel = await innertube.getChannel(normalizedChannelId);

        let about = null;

        if (channel.has_about) {
          try {
            about = await channel.getAbout();
          } catch (error) {
            request.log.warn(
              { err: error, channelId: normalizedChannelId },
              'Failed to fetch channel about section, returning partial channel details',
            );
          }
        }

        return createChannelDetailsData(normalizedChannelId, channel, about);
      },
    );
  } catch (error) {
    request.log.error({ err: error, channelId: normalizedChannelId }, 'Failed to fetch channel details');

    return sendError(reply, 502, 'Failed to fetch channel details from upstream.');
  }
});

app.get('/v1/channels/:channelId/home', async (request, reply) => {
  const { channelId } = request.params as { channelId: string };
  const querystring = request.query as ChannelHomeQuerystring;
  const normalizedChannelId = channelId.trim();
  const continuation = querystring.continuation?.trim();
  const requestedFilter = querystring.filter?.trim() || null;

  if (!normalizedChannelId) {
    return sendError(reply, 400, 'Route parameter "channelId" is required.');
  }

  try {
    if (continuation) {
      return sendCachedSuccess(
        request,
        reply,
        buildCacheKey('channel-home-continuation', [continuation]),
        responseCacheTtlsMs.channelBrowse,
        async () => {
          const decodedContinuation = await decodeChannelHomePaginationToken(continuation);

          if (decodedContinuation.channelId !== normalizedChannelId) {
            throw new Error('Channel home continuation token does not match "channelId".');
          }

          const innertube = await getInnertubeClient();
          const response = await innertube.call(
            createContinuationEndpoint(
              decodedContinuation.token,
              'CONTINUATION_REQUEST_TYPE_BROWSE',
            ),
            { parse: true },
          );
          const feed = new Mixins.Feed(innertube.actions, response, true);
          const rawContinuation = getContinuationTokenFromMemoSource(response);
          const nextContinuation = rawContinuation
            ? await encodeChannelHomePaginationToken({
                token: rawContinuation,
                channelId: decodedContinuation.channelId,
                title: decodedContinuation.title,
                filterOptions: decodedContinuation.filterOptions,
              })
            : null;

          return createChannelBrowseData(
            normalizedChannelId,
            'home',
            decodedContinuation.title,
            null,
            decodedContinuation.filterOptions,
            [],
            [],
            feed,
            nextContinuation,
          );
        },
      );
    }

    return sendCachedSuccess(
      request,
      reply,
      buildCacheKey('channel-home', [normalizedChannelId, requestedFilter]),
      responseCacheTtlsMs.channelBrowse,
      async () => {
        const innertube = await getInnertubeClient();
        const channel = await innertube.getChannel(normalizedChannelId);

        if (!channel.has_home) {
          throw new Error('Channel home is not available.');
        }

        let homeFeed: any = await channel.getHome();
        let filterOptions = createDiscoveryFeedOptions(homeFeed, 'filter');

        if (requestedFilter) {
          const targetOption = findDiscoveryOption(filterOptions, requestedFilter);

          if (!targetOption) {
            throw new Error('Invalid channel home filter.');
          }

          if (!targetOption.selected) {
            homeFeed = await homeFeed.applyFilter(targetOption.label);
            const updatedOptions = createDiscoveryFeedOptions(homeFeed, 'filter');
            filterOptions = updatedOptions.length > 0
              ? updatedOptions
              : selectDiscoveryOption(filterOptions, targetOption.id);
          }
        }

        const title = 'Home';
        const rawContinuation = getContinuationTokenFromMemoSource(homeFeed.page);
        const nextContinuation = rawContinuation
          ? await encodeChannelHomePaginationToken({
              token: rawContinuation,
              channelId: normalizedChannelId,
              title,
              filterOptions,
            })
          : null;

        return createChannelBrowseData(
          normalizedChannelId,
          'home',
          title,
          null,
          filterOptions,
          [],
          [],
          homeFeed,
          nextContinuation,
        );
      },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (
        error.message === 'Invalid channel home filter.' ||
        error.message === 'Channel home continuation token does not match "channelId".' ||
        error.message === 'Invalid or expired continuation token.' ||
        error.message === 'Invalid channel home continuation token.'
      )
    ) {
      return sendError(reply, 400, error.message);
    }

    if (error instanceof Error && error.message === 'Channel home is not available.') {
      return sendError(reply, 404, error.message);
    }

    request.log.error(
      { err: error, channelId: normalizedChannelId, requestedFilter, hasContinuation: !!continuation },
      'Failed to fetch channel home feed',
    );

    return sendError(reply, 502, 'Failed to fetch channel home feed from upstream.');
  }
});

app.get('/v1/channels/:channelId/search', async (request, reply) => {
  const { channelId } = request.params as { channelId: string };
  const querystring = request.query as ChannelSearchQuerystring;
  const normalizedChannelId = channelId.trim();
  const continuation = querystring.continuation?.trim();
  const requestedQuery = querystring.q?.trim();
  const requestedSort = querystring.sort?.trim() || null;
  const requestedContentType = querystring.contentType?.trim() || null;

  if (!normalizedChannelId) {
    return sendError(reply, 400, 'Route parameter "channelId" is required.');
  }

  try {
    if (continuation) {
      return sendCachedSuccess(
        request,
        reply,
        buildCacheKey('channel-search-continuation', [continuation]),
        responseCacheTtlsMs.channelBrowse,
        async () => {
          const decodedContinuation = await decodeChannelSearchPaginationToken(continuation);

          if (decodedContinuation.channelId !== normalizedChannelId) {
            throw new Error('Channel search continuation token does not match "channelId".');
          }

          const innertube = await getInnertubeClient();
          const response = await innertube.call(
            createContinuationEndpoint(
              decodedContinuation.token,
              'CONTINUATION_REQUEST_TYPE_BROWSE',
            ),
            { parse: true },
          );
          const feed = new Mixins.Feed(innertube.actions, response, true);
          const rawContinuation = getContinuationTokenFromMemoSource(response);
          const nextContinuation = rawContinuation
            ? await encodeChannelSearchPaginationToken({
                token: rawContinuation,
                channelId: decodedContinuation.channelId,
                query: decodedContinuation.query,
                title: decodedContinuation.title,
                sortOptions: decodedContinuation.sortOptions,
                contentTypeOptions: decodedContinuation.contentTypeOptions,
              })
            : null;

          return createChannelBrowseData(
            normalizedChannelId,
            'search',
            decodedContinuation.title,
            decodedContinuation.query,
            [],
            decodedContinuation.sortOptions,
            decodedContinuation.contentTypeOptions,
            feed,
            nextContinuation,
          );
        },
      );
    }

    if (!requestedQuery) {
      return sendError(reply, 400, 'Query parameter "q" is required.');
    }

    return sendCachedSuccess(
      request,
      reply,
      buildCacheKey('channel-search', [normalizedChannelId, requestedQuery, requestedSort, requestedContentType]),
      responseCacheTtlsMs.channelBrowse,
      async () => {
        const innertube = await getInnertubeClient();
        const channel = await innertube.getChannel(normalizedChannelId);

        if (!channel.has_search) {
          throw new Error('Channel search is not available.');
        }

        let searchFeed = await channel.search(requestedQuery);
        let sortOptions = createChannelSearchSortOptions(searchFeed);
        let contentTypeOptions = createChannelSearchContentTypeOptions(searchFeed);

        if (requestedContentType) {
          const targetOption = findDiscoveryOption(contentTypeOptions, requestedContentType);

          if (!targetOption) {
            throw new Error('Invalid channel search contentType filter.');
          }

          if (!targetOption.selected) {
            searchFeed = await searchFeed.applyContentTypeFilter(targetOption.label);
            const updatedSortOptions = createChannelSearchSortOptions(searchFeed);
            const updatedContentTypeOptions = createChannelSearchContentTypeOptions(searchFeed);
            sortOptions = updatedSortOptions.length > 0 ? updatedSortOptions : sortOptions;
            contentTypeOptions = updatedContentTypeOptions.length > 0
              ? updatedContentTypeOptions
              : selectDiscoveryOption(contentTypeOptions, targetOption.id);
          }
        }

        if (requestedSort) {
          const targetOption = findDiscoveryOption(sortOptions, requestedSort);

          if (!targetOption) {
            throw new Error('Invalid channel search sort.');
          }

          if (!targetOption.selected) {
            searchFeed = await searchFeed.applySort(targetOption.label);
            const updatedSortOptions = createChannelSearchSortOptions(searchFeed);
            const updatedContentTypeOptions = createChannelSearchContentTypeOptions(searchFeed);
            sortOptions = updatedSortOptions.length > 0
              ? updatedSortOptions
              : selectDiscoveryOption(sortOptions, targetOption.id);
            contentTypeOptions = updatedContentTypeOptions.length > 0
              ? updatedContentTypeOptions
              : contentTypeOptions;
          }
        }

        const title = 'Search';
        const rawContinuation = getContinuationTokenFromMemoSource(searchFeed.page);
        const nextContinuation = rawContinuation
          ? await encodeChannelSearchPaginationToken({
              token: rawContinuation,
              channelId: normalizedChannelId,
              query: requestedQuery,
              title,
              sortOptions,
              contentTypeOptions,
            })
          : null;

        return createChannelBrowseData(
          normalizedChannelId,
          'search',
          title,
          requestedQuery,
          [],
          sortOptions,
          contentTypeOptions,
          searchFeed,
          nextContinuation,
        );
      },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (
        error.message === 'Invalid channel search contentType filter.' ||
        error.message === 'Invalid channel search sort.' ||
        error.message === 'Channel search continuation token does not match "channelId".' ||
        error.message === 'Invalid or expired continuation token.' ||
        error.message === 'Invalid channel search continuation token.'
      )
    ) {
      return sendError(reply, 400, error.message);
    }

    if (error instanceof Error && error.message === 'Channel search is not available.') {
      return sendError(reply, 404, error.message);
    }

    request.log.error(
      {
        err: error,
        channelId: normalizedChannelId,
        requestedQuery,
        requestedSort,
        requestedContentType,
        hasContinuation: !!continuation,
      },
      'Failed to fetch channel search feed',
    );

    return sendError(reply, 502, 'Failed to fetch channel search feed from upstream.');
  }
});

app.get('/v1/channels/:channelId/community', async (request, reply) => {
  const { channelId } = request.params as { channelId: string };
  const querystring = request.query as CommunityQuerystring;
  const normalizedChannelId = channelId.trim();
  const continuation = querystring.continuation?.trim();

  if (!normalizedChannelId) {
    return sendError(reply, 400, 'Route parameter "channelId" is required.');
  }

  let limit: number;

  try {
    limit = parseLimit(querystring.limit, {
      defaultValue: defaultCommunityLimit,
      maxValue: maxCommunityLimit,
    });
  } catch (error) {
    return sendError(
      reply,
      400,
      error instanceof Error ? error.message : 'Invalid community query.',
    );
  }

  if (!continuation) {
    try {
      return sendCachedSuccess(
        request,
        reply,
        buildCacheKey('channel-community', [normalizedChannelId, limit]),
        responseCacheTtlsMs.community,
        async () => {
          const innertube = await getInnertubeClient();
          const channel = await innertube.getChannel(normalizedChannelId);

          if (!channel.has_community) {
            return createEmptyCommunityPostsData(normalizedChannelId);
          }

          const community = await channel.getCommunity();
          const fullPageData = createCommunityPostsData(
            normalizedChannelId,
            community.page,
            maxCommunityLimit,
            null,
          );
          const rawContinuation = getContinuationTokenFromMemoSource(community.page);
          const bufferedItems = fullPageData.items.slice(limit);
          const nextContinuation =
            bufferedItems.length > 0 || rawContinuation
              ? await encodeCommunityPaginationToken({
                  token: rawContinuation,
                  channelId: normalizedChannelId,
                  bufferedItems,
                })
              : null;

          return {
            ...fullPageData,
            hasContinuation: nextContinuation !== null,
            continuation: nextContinuation,
            items: fullPageData.items.slice(0, limit),
          };
        },
      );
    } catch (error) {
      request.log.error(
        { err: error, channelId: normalizedChannelId, limit },
        'Failed to fetch channel community feed',
      );

      return sendError(reply, 502, 'Failed to fetch channel community feed from upstream.');
    }
  }

  let decodedContinuation;

  try {
    decodedContinuation = await decodeCommunityPaginationToken(continuation);
  } catch (error) {
    return sendError(
      reply,
      400,
      error instanceof Error ? error.message : 'Invalid community continuation token.',
    );
  }

  if (decodedContinuation.channelId !== normalizedChannelId) {
    return sendError(reply, 400, 'Community continuation token does not match "channelId".');
  }

  try {
    return sendCachedSuccess(
      request,
      reply,
      buildCacheKey('channel-community-continuation', [continuation, limit]),
      responseCacheTtlsMs.community,
      async () => {
        const innertube = await getInnertubeClient();
        let bufferedItems = decodedContinuation.bufferedItems ?? [];
        let rawContinuation = decodedContinuation.token;

        if (bufferedItems.length < limit && rawContinuation) {
          const response = await innertube.call(
            createContinuationEndpoint(
              rawContinuation,
              'CONTINUATION_REQUEST_TYPE_BROWSE',
            ),
            { parse: true },
          );
          const fullPageData = createCommunityPostsData(
            normalizedChannelId,
            response,
            maxCommunityLimit,
            null,
          );
          bufferedItems = [...bufferedItems, ...fullPageData.items];
          rawContinuation = getContinuationTokenFromMemoSource(response);
        }

        const items = bufferedItems.slice(0, limit);
        const remainingItems = bufferedItems.slice(limit);
        const nextContinuation =
          remainingItems.length > 0 || rawContinuation
            ? await encodeCommunityPaginationToken({
                token: rawContinuation,
                channelId: normalizedChannelId,
                bufferedItems: remainingItems,
              })
            : null;

        return {
          id: normalizedChannelId,
          hasContinuation: nextContinuation !== null,
          continuation: nextContinuation,
          items,
        };
      },
    );
  } catch (error) {
    request.log.error(
      {
        err: error,
        channelId: normalizedChannelId,
        limit,
        hasContinuation: true,
      },
      'Failed to fetch channel community continuation',
    );

    return sendError(reply, 502, 'Failed to fetch channel community feed from upstream.');
  }
});

app.get('/v1/channels/:channelId/posts/:postId', async (request, reply) => {
  const { channelId, postId } = request.params as { channelId: string; postId: string };
  const normalizedChannelId = channelId.trim();
  const normalizedPostId = postId.trim();

  if (!normalizedChannelId) {
    return sendError(reply, 400, 'Route parameter "channelId" is required.');
  }

  if (!normalizedPostId) {
    return sendError(reply, 400, 'Route parameter "postId" is required.');
  }

  try {
    return sendCachedSuccess(
      request,
      reply,
      buildCacheKey('community-post', [normalizedChannelId, normalizedPostId]),
      responseCacheTtlsMs.communityPost,
      async () => {
        const innertube = await getInnertubeClient();
        const postFeed = await innertube.getPost(normalizedPostId, normalizedChannelId);
        const postData = createCommunityPostData(
          normalizedChannelId,
          normalizedPostId,
          postFeed.page,
        );

        if (!postData) {
          throw new Error('Community post not found.');
        }

        return postData;
      },
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Community post not found.') {
      return sendError(reply, 404, error.message);
    }

    request.log.error(
      { err: error, channelId: normalizedChannelId, postId: normalizedPostId },
      'Failed to fetch community post',
    );

    return sendError(reply, 502, 'Failed to fetch community post from upstream.');
  }
});

app.get('/v1/channels/:channelId/posts/:postId/comments', async (request, reply) => {
  const { channelId, postId } = request.params as { channelId: string; postId: string };
  const querystring = request.query as CommentsQuerystring;
  const normalizedChannelId = channelId.trim();
  const normalizedPostId = postId.trim();

  if (!normalizedChannelId) {
    return sendError(reply, 400, 'Route parameter "channelId" is required.');
  }

  if (!normalizedPostId) {
    return sendError(reply, 400, 'Route parameter "postId" is required.');
  }

  let limit: number;
  let sort: CommentSort;

  try {
    limit = parseLimit(querystring.limit);
    sort = parseCommentSort(querystring.sort);
  } catch (error) {
    return sendError(
      reply,
      400,
      error instanceof Error ? error.message : 'Invalid community post comments query.',
    );
  }

  const continuation = querystring.continuation?.trim();

  try {
    if (continuation) {
      return sendCachedSuccess(
        request,
        reply,
        buildCacheKey('community-post-comments-continuation', [normalizedChannelId, normalizedPostId, continuation, sort, limit]),
        responseCacheTtlsMs.comments,
        async () => {
          const innertube = await getInnertubeClient();
          const response = await innertube.call(
            createContinuationEndpoint(
              continuation,
              'CONTINUATION_REQUEST_TYPE_BROWSE',
            ),
            { parse: true },
          );

          return createCommunityPostCommentsContinuationData(
            normalizedChannelId,
            normalizedPostId,
            response,
            sort,
            limit,
          );
        },
      );
    }

    return sendCachedSuccess(
      request,
      reply,
      buildCacheKey('community-post-comments', [normalizedChannelId, normalizedPostId, sort, limit]),
      responseCacheTtlsMs.comments,
      async () => {
        const innertube = await getInnertubeClient();
        const comments = await innertube.getPostComments(
          normalizedPostId,
          normalizedChannelId,
          sort === 'newest' ? 'NEWEST_FIRST' : 'TOP_COMMENTS',
        );

        return createCommunityPostCommentsData(
          normalizedChannelId,
          normalizedPostId,
          comments,
          sort,
          limit,
        );
      },
    );
  } catch (error) {
    request.log.error(
      {
        err: error,
        channelId: normalizedChannelId,
        postId: normalizedPostId,
        sort,
        limit,
        hasContinuation: !!continuation,
      },
      'Failed to fetch community post comments',
    );

    return sendError(reply, 502, 'Failed to fetch community post comments from upstream.');
  }
});

app.get('/v1/channels/:channelId/feed/:tab', async (request, reply) => {
  const { channelId, tab } = request.params as { channelId: string; tab: string };
  const querystring = request.query as ChannelFeedQuerystring;
  const normalizedChannelId = channelId.trim();
  const continuation = querystring.continuation?.trim();

  if (!normalizedChannelId) {
    return sendError(reply, 400, 'Route parameter "channelId" is required.');
  }

  let normalizedTab: ChannelFeedTab;
  let limit: number;

  try {
    normalizedTab = parseEnum(tab, CHANNEL_FEED_TABS, 'tab') ?? 'videos';
    limit = parseLimit(querystring.limit);
  } catch (error) {
    return sendError(
      reply,
      400,
      error instanceof Error ? error.message : 'Invalid channel feed query.',
    );
  }

  if (!continuation) {
    try {
      return sendCachedSuccess(
        request,
        reply,
        buildCacheKey('channel-feed', [normalizedChannelId, normalizedTab, limit]),
        responseCacheTtlsMs.channelFeed,
        async () => {
          const innertube = await getInnertubeClient();
          const channel = await innertube.getChannel(normalizedChannelId);
          const feed = await getChannelFeedByTab(channel, normalizedTab);
          const fullPageData = createChannelFeedData(
            normalizedChannelId,
            normalizedTab,
            feed,
            maxPlaylistLimit,
            null,
          );
          const rawContinuation = getContinuationTokenFromMemoSource(feed.page);
          const bufferedItems = fullPageData.items.slice(limit);
          const nextContinuation =
            bufferedItems.length > 0 || rawContinuation
              ? await encodeChannelFeedPaginationToken({
                  token: rawContinuation,
                  channelId: normalizedChannelId,
                  tab: normalizedTab,
                  bufferedItems,
                })
              : null;

          return {
            ...fullPageData,
            hasContinuation: nextContinuation !== null,
            continuation: nextContinuation,
            items: fullPageData.items.slice(0, limit),
          };
        },
      );
    } catch (error) {
      request.log.error(
        { err: error, channelId: normalizedChannelId, tab: normalizedTab, limit },
        'Failed to fetch channel feed',
      );

      return sendError(reply, 502, 'Failed to fetch channel feed from upstream.');
    }
  }

  let decodedContinuation;

  try {
    decodedContinuation = await decodeChannelFeedPaginationToken(continuation);
  } catch (error) {
    return sendError(
      reply,
      400,
      error instanceof Error ? error.message : 'Invalid channel feed continuation token.',
    );
  }

  if (decodedContinuation.channelId !== normalizedChannelId) {
    return sendError(reply, 400, 'Channel feed continuation token does not match "channelId".');
  }

  if (decodedContinuation.tab !== normalizedTab) {
    return sendError(reply, 400, 'Channel feed continuation token does not match "tab".');
  }

  try {
    return sendCachedSuccess(
      request,
      reply,
      buildCacheKey('channel-feed-continuation', [continuation, limit]),
      responseCacheTtlsMs.channelFeed,
      async () => {
        const innertube = await getInnertubeClient();
        let bufferedItems = decodedContinuation.bufferedItems ?? [];
        let rawContinuation = decodedContinuation.token;

        if (bufferedItems.length < limit && rawContinuation) {
          const response = await innertube.call(
            createContinuationEndpoint(
              rawContinuation,
              'CONTINUATION_REQUEST_TYPE_BROWSE',
            ),
            { parse: true },
          );
          const fullPageData = createChannelFeedData(
            normalizedChannelId,
            normalizedTab,
            response,
            maxPlaylistLimit,
            null,
          );
          bufferedItems = [...bufferedItems, ...fullPageData.items];
          rawContinuation = getContinuationTokenFromMemoSource(response);
        }

        const items = bufferedItems.slice(0, limit);
        const remainingItems = bufferedItems.slice(limit);
        const nextContinuation =
          remainingItems.length > 0 || rawContinuation
            ? await encodeChannelFeedPaginationToken({
                token: rawContinuation,
                channelId: normalizedChannelId,
                tab: normalizedTab,
                bufferedItems: remainingItems,
              })
            : null;

        return {
          id: normalizedChannelId,
          tab: normalizedTab,
          hasContinuation: nextContinuation !== null,
          continuation: nextContinuation,
          items,
        };
      },
    );
  } catch (error) {
    request.log.error(
      {
        err: error,
        channelId: normalizedChannelId,
        tab: normalizedTab,
        limit,
        hasContinuation: true,
      },
      'Failed to fetch channel feed continuation',
    );

    return sendError(reply, 502, 'Failed to fetch channel feed from upstream.');
  }
});

app.get('/v1/playlists/:playlistId', async (request, reply) => {
  const { playlistId } = request.params as { playlistId: string };
  const querystring = request.query as PlaylistQuerystring;
  const normalizedPlaylistId = playlistId.trim();
  const continuation = querystring.continuation?.trim();

  if (!normalizedPlaylistId) {
    return sendError(reply, 400, 'Route parameter "playlistId" is required.');
  }

  let limit: number;

  try {
    limit = parseLimit(querystring.limit, {
      defaultValue: defaultPlaylistLimit,
      maxValue: maxPlaylistLimit,
    });
  } catch (error) {
    return sendError(
      reply,
      400,
      error instanceof Error ? error.message : 'Invalid playlist query.',
    );
  }

  if (!continuation) {
    try {
      return sendCachedSuccess(
        request,
        reply,
        buildCacheKey('playlist-details', [normalizedPlaylistId]),
        responseCacheTtlsMs.playlist,
        async () => {
          const innertube = await getInnertubeClient();
          const playlist = await innertube.getPlaylist(normalizedPlaylistId);
          const rawContinuation = getContinuationTokenFromMemoSource(playlist.page);
          const nextContinuation = rawContinuation
            ? await encodePlaylistPaginationToken({
                token: rawContinuation,
                playlistId: normalizedPlaylistId,
              })
            : null;

          return createPlaylistDetailsData(
            normalizedPlaylistId,
            playlist,
            nextContinuation,
          );
        },
      );
    } catch (error) {
      request.log.error(
        { err: error, playlistId: normalizedPlaylistId },
        'Failed to fetch playlist details',
      );

      return sendError(reply, 502, 'Failed to fetch playlist details from upstream.');
    }
  }

  let decodedContinuation;

  try {
    decodedContinuation = await decodePlaylistPaginationToken(continuation);
  } catch (error) {
    return sendError(
      reply,
      400,
      error instanceof Error ? error.message : 'Invalid playlist continuation token.',
    );
  }

  if (decodedContinuation.playlistId !== normalizedPlaylistId) {
    return sendError(reply, 400, 'Playlist continuation token does not match "playlistId".');
  }

  try {
    return sendCachedSuccess(
      request,
      reply,
      buildCacheKey('playlist-continuation', [continuation]),
      responseCacheTtlsMs.playlist,
      async () => {
        const innertube = await getInnertubeClient();
        const response = await innertube.call(
          createContinuationEndpoint(
            decodedContinuation.token,
            'CONTINUATION_REQUEST_TYPE_BROWSE',
          ),
          { parse: true },
        );
        const rawContinuation = getContinuationTokenFromMemoSource(response);
        const nextContinuation = rawContinuation
          ? await encodePlaylistPaginationToken({
              token: rawContinuation,
              playlistId: normalizedPlaylistId,
            })
          : null;

        return createPlaylistContinuationData(
          normalizedPlaylistId,
          response,
          maxPlaylistLimit,
          nextContinuation,
        );
      },
    );
  } catch (error) {
    request.log.error(
      {
        err: error,
        playlistId: normalizedPlaylistId,
        limit,
        hasContinuation: true,
      },
      'Failed to fetch playlist continuation',
    );

    return sendError(reply, 502, 'Failed to fetch playlist details from upstream.');
  }
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











