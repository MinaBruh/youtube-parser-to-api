import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import {
  getRedisClient,
  getRedisKeyPrefix,
  isRedisConfigured,
  type RecommendationFeedReason,
  type RecommendationFeedData,
  type RecommendationProfileSummary,
  type VideoDetailsData,
} from '@ytpa/shared';

const recommendationProfileTtlMs = 30 * 24 * 60 * 60 * 1000;
const maxTrackedSearches = 12;
const maxTrackedWatchedVideos = 18;
const recommendationProfileRedisKeyPrefix = 'api:anonymous-recommendation-profile';

interface SearchSignal {
  query: string;
  count: number;
  lastSeenAt: string;
}

interface WatchedVideoSignal {
  videoId: string;
  title: string | null;
  channelName: string | null;
  count: number;
  lastSeenAt: string;
}

export interface AnonymousRecommendationProfile {
  updatedAt: string | null;
  searches: SearchSignal[];
  watchedVideos: WatchedVideoSignal[];
}

interface StoredRecommendationProfile {
  expiresAt: number;
  value: AnonymousRecommendationProfile;
}

const recommendationProfileState = new Map<string, StoredRecommendationProfile>();

const getHeaderValue = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
};

const getClientAddress = (request: FastifyRequest): string => {
  const forwardedFor = getHeaderValue(request.headers['x-forwarded-for']);
  const forwardedAddress = forwardedFor?.split(',')[0]?.trim();

  return forwardedAddress || request.ip || request.socket.remoteAddress || 'unknown';
};

const getVisitorUserAgent = (request: FastifyRequest): string => {
  return getHeaderValue(request.headers['user-agent'])?.trim() || 'unknown-user-agent';
};

const nowIsoString = (): string => new Date().toISOString();

const normalizeSearchQuery = (value: string): string | null => {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized.slice(0, 120) : null;
};

const compareSignals = <T extends { count: number; lastSeenAt: string }>(left: T, right: T): number => {
  if (right.count !== left.count) {
    return right.count - left.count;
  }

  return Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt);
};

const createEmptyProfile = (): AnonymousRecommendationProfile => {
  return {
    updatedAt: null,
    searches: [],
    watchedVideos: [],
  };
};

const buildRedisKey = (visitorKey: string): string => {
  return `${getRedisKeyPrefix()}:${recommendationProfileRedisKeyPrefix}:${visitorKey}`;
};

const pruneExpiredProfiles = (): void => {
  const now = Date.now();

  for (const [key, entry] of recommendationProfileState.entries()) {
    if (entry.expiresAt <= now) {
      recommendationProfileState.delete(key);
    }
  }
};

const storeProfileInMemory = (
  visitorKey: string,
  value: AnonymousRecommendationProfile,
  ttlMs: number,
): void => {
  recommendationProfileState.set(visitorKey, {
    expiresAt: Date.now() + ttlMs,
    value,
  });
};

const readProfileFromMemory = (visitorKey: string): AnonymousRecommendationProfile | null => {
  pruneExpiredProfiles();

  const entry = recommendationProfileState.get(visitorKey);
  if (!entry || entry.expiresAt <= Date.now()) {
    recommendationProfileState.delete(visitorKey);
    return null;
  }

  return entry.value;
};

const readProfileFromRedis = async (visitorKey: string): Promise<AnonymousRecommendationProfile | null> => {
  if (!isRedisConfigured()) {
    return null;
  }

  try {
    const client = await getRedisClient();
    if (!client) {
      return null;
    }

    const redisKey = buildRedisKey(visitorKey);
    const encoded = await client.get(redisKey);
    if (!encoded) {
      return null;
    }

    const profile = JSON.parse(encoded) as AnonymousRecommendationProfile;
    const ttlMs = await client.pTTL(redisKey);
    if (Number.isFinite(ttlMs) && ttlMs > 0) {
      storeProfileInMemory(visitorKey, profile, ttlMs);
    }

    return profile;
  } catch {
    return null;
  }
};

const storeProfile = async (visitorKey: string, profile: AnonymousRecommendationProfile): Promise<void> => {
  storeProfileInMemory(visitorKey, profile, recommendationProfileTtlMs);

  if (!isRedisConfigured()) {
    return;
  }

  try {
    const client = await getRedisClient();
    if (!client) {
      return;
    }

    await client.set(buildRedisKey(visitorKey), JSON.stringify(profile), {
      PX: recommendationProfileTtlMs,
    });
  } catch {
    return;
  }
};

const loadProfile = async (visitorKey: string): Promise<AnonymousRecommendationProfile> => {
  const inMemoryProfile = readProfileFromMemory(visitorKey);
  if (inMemoryProfile) {
    return inMemoryProfile;
  }

  const redisProfile = await readProfileFromRedis(visitorKey);
  if (redisProfile) {
    return redisProfile;
  }

  return createEmptyProfile();
};

const upsertSearchSignal = (
  profile: AnonymousRecommendationProfile,
  query: string,
): AnonymousRecommendationProfile => {
  const timestamp = nowIsoString();
  const existing = profile.searches.find((item) => item.query.toLowerCase() === query.toLowerCase());

  const searches = existing
    ? profile.searches.map((item) => item.query.toLowerCase() === query.toLowerCase()
      ? {
          ...item,
          count: item.count + 1,
          lastSeenAt: timestamp,
          query,
        }
      : item)
    : [
        ...profile.searches,
        {
          query,
          count: 1,
          lastSeenAt: timestamp,
        },
      ];

  return {
    ...profile,
    updatedAt: timestamp,
    searches: searches.sort(compareSignals).slice(0, maxTrackedSearches),
  };
};

const upsertWatchedVideoSignal = (
  profile: AnonymousRecommendationProfile,
  details: Pick<VideoDetailsData, 'id' | 'title' | 'channel'>,
): AnonymousRecommendationProfile => {
  const timestamp = nowIsoString();
  const videoId = details.id;
  const title = details.title?.trim() || null;
  const channelName = details.channel?.name?.trim() || null;
  const existing = profile.watchedVideos.find((item) => item.videoId === videoId);

  const watchedVideos = existing
    ? profile.watchedVideos.map((item) => item.videoId === videoId
      ? {
          ...item,
          count: item.count + 1,
          lastSeenAt: timestamp,
          title,
          channelName,
        }
      : item)
    : [
        ...profile.watchedVideos,
        {
          videoId,
          title,
          channelName,
          count: 1,
          lastSeenAt: timestamp,
        },
      ];

  return {
    ...profile,
    updatedAt: timestamp,
    watchedVideos: watchedVideos.sort(compareSignals).slice(0, maxTrackedWatchedVideos),
  };
};

export const getAnonymousRecommendationVisitorKey = (request: FastifyRequest): string => {
  const fingerprint = `${getClientAddress(request)}\n${getVisitorUserAgent(request)}`;
  return createHash('sha256').update(fingerprint).digest('hex').slice(0, 32);
};

export const loadAnonymousRecommendationProfile = async (
  request: FastifyRequest,
): Promise<AnonymousRecommendationProfile> => {
  return loadProfile(getAnonymousRecommendationVisitorKey(request));
};

export const recordAnonymousSearchSignal = async (
  request: FastifyRequest,
  rawQuery: string,
): Promise<void> => {
  const query = normalizeSearchQuery(rawQuery);
  if (!query) {
    return;
  }

  const visitorKey = getAnonymousRecommendationVisitorKey(request);
  const profile = await loadProfile(visitorKey);
  await storeProfile(visitorKey, upsertSearchSignal(profile, query));
};

export const recordAnonymousWatchSignal = async (
  request: FastifyRequest,
  details: Pick<VideoDetailsData, 'id' | 'title' | 'channel'>,
): Promise<void> => {
  if (!details.id) {
    return;
  }

  const visitorKey = getAnonymousRecommendationVisitorKey(request);
  const profile = await loadProfile(visitorKey);
  await storeProfile(visitorKey, upsertWatchedVideoSignal(profile, details));
};

export const getRecommendationFeedReason = (
  profile: AnonymousRecommendationProfile,
): RecommendationFeedReason => {
  const hasSearchHistory = profile.searches.length > 0;
  const hasWatchHistory = profile.watchedVideos.length > 0;

  if (hasSearchHistory && hasWatchHistory) {
    return 'mixed-history';
  }

  if (hasWatchHistory) {
    return 'watch-history';
  }

  if (hasSearchHistory) {
    return 'search-history';
  }

  return 'fallback-discovery';
};

export const createRecommendationProfileSummary = (
  profile: AnonymousRecommendationProfile,
): RecommendationProfileSummary => {
  return {
    hasHistory: profile.searches.length > 0 || profile.watchedVideos.length > 0,
    trackedSearchCount: profile.searches.length,
    trackedWatchCount: profile.watchedVideos.length,
    topSearches: profile.searches.slice(0, 3).map((item) => item.query),
    topWatchedTitles: profile.watchedVideos
      .slice(0, 3)
      .map((item) => item.title)
      .filter((item): item is string => Boolean(item)),
    updatedAt: profile.updatedAt,
  };
};

export const createRecommendationSubtitle = (
  reason: RecommendationFeedReason,
  profile: RecommendationProfileSummary,
): string => {
  switch (reason) {
    case 'mixed-history':
      return 'Built from recent searches and watched videos for this anonymous visitor profile.';
    case 'watch-history':
      return 'Built from the videos this anonymous visitor profile opened recently.';
    case 'search-history':
      return 'Built from the recent search terms used by this anonymous visitor profile.';
    case 'fallback-discovery':
    default:
      return profile.hasHistory
        ? 'Fallback discovery feed while the recommendation engine collects stronger signals.'
        : 'Fallback discovery feed until this anonymous visitor profile builds up search and watch history.';
  }
};

export const createRecommendationFeedData = (
  title: string,
  subtitle: string | null,
  reason: RecommendationFeedReason,
  profile: RecommendationProfileSummary,
  items: RecommendationFeedData['items'],
  continuation: string | null,
): RecommendationFeedData => {
  return {
    id: 'recommendations',
    title,
    subtitle,
    reason,
    profile,
    hasContinuation: continuation !== null,
    continuation,
    items,
  };
};
