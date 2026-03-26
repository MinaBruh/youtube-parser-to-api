import type { FastifyRequest } from 'fastify';
import type {
  RecommendationFeedData,
  RecommendationFeedReason,
  RecommendationProfileSummary,
  RelatedItem,
} from '@ytpa/shared';
import { getInnertubeClient } from './innertube.js';
import {
  createDiscoveryFeedData,
  createDiscoveryFeedOptions,
  createSearchResponseData,
  createVideoRelatedData,
  toRelatedItemFromSearchResult,
} from './normalize.js';
import {
  type RecommendationPaginationToken,
  encodeRecommendationPaginationToken,
} from './pagination.js';
import {
  createRecommendationFeedData,
  createRecommendationProfileSummary,
  createRecommendationSubtitle,
  getAnonymousRecommendationVisitorKey,
  getRecommendationFeedReason,
  loadAnonymousRecommendationProfile,
} from './recommendations.js';

const recommendationSeedLimit = 3;
const minimumCandidatePoolSize = 24;

interface RecommendationCandidate {
  item: RelatedItem;
  score: number;
}

const buildItemKey = (item: RelatedItem): string => {
  return `${item.kind}:${item.id}`;
};

const isRecommendationCandidate = (
  item: RelatedItem,
  watchedVideoIds: Set<string>,
): boolean => {
  if (item.kind === 'channel') {
    return false;
  }

  return !watchedVideoIds.has(item.id);
};

const addRecommendationCandidate = (
  candidateMap: Map<string, RecommendationCandidate>,
  item: RelatedItem,
  score: number,
  watchedVideoIds: Set<string>,
): void => {
  if (!isRecommendationCandidate(item, watchedVideoIds)) {
    return;
  }

  const key = buildItemKey(item);
  const existing = candidateMap.get(key);

  if (!existing) {
    candidateMap.set(key, {
      item,
      score,
    });
    return;
  }

  existing.score += Math.max(1, Math.round(score / 4));
};

const sortRecommendationCandidates = (
  candidateMap: Map<string, RecommendationCandidate>,
): RelatedItem[] => {
  return [...candidateMap.values()]
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.item.title.localeCompare(right.item.title);
    })
    .map((candidate) => candidate.item);
};

const createRecommendationPage = async (
  visitorKey: string,
  title: string,
  subtitle: string | null,
  reason: RecommendationFeedReason,
  profile: RecommendationProfileSummary,
  items: RelatedItem[],
  limit: number,
): Promise<RecommendationFeedData> => {
  const pageItems = items.slice(0, limit);
  const bufferedItems = items.slice(limit);
  const continuation = bufferedItems.length > 0
    ? await encodeRecommendationPaginationToken({
        visitorKey,
        title,
        subtitle,
        reason,
        profile,
        bufferedItems,
      })
    : null;

  return createRecommendationFeedData(
    title,
    subtitle,
    reason,
    profile,
    pageItems,
    continuation,
  );
};

export const buildAnonymousRecommendationFeed = async (
  request: FastifyRequest,
  limit: number,
): Promise<RecommendationFeedData> => {
  const visitorKey = getAnonymousRecommendationVisitorKey(request);
  const profile = await loadAnonymousRecommendationProfile(request);
  const reason = getRecommendationFeedReason(profile);
  const profileSummary = createRecommendationProfileSummary(profile);
  const subtitle = createRecommendationSubtitle(reason, profileSummary);
  const title = 'Recommended for you';
  const watchedVideoIds = new Set(profile.watchedVideos.map((item) => item.videoId));
  const candidateMap = new Map<string, RecommendationCandidate>();
  const innertube = await getInnertubeClient();
  const candidatePoolSize = Math.max(limit * 2, minimumCandidatePoolSize);

  await Promise.allSettled(
    profile.watchedVideos.slice(0, recommendationSeedLimit).map(async (seed, seedIndex) => {
      const info = await innertube.getInfo(seed.videoId);
      const relatedItems = createVideoRelatedData(seed.videoId, info, candidatePoolSize).items;

      relatedItems.forEach((item, itemIndex) => {
        addRecommendationCandidate(
          candidateMap,
          item,
          120 + Math.min(seed.count, 5) * 14 - seedIndex * 12 - itemIndex * 2,
          watchedVideoIds,
        );
      });
    }),
  );

  await Promise.allSettled(
    profile.searches.slice(0, recommendationSeedLimit).map(async (seed, seedIndex) => {
      const search = await innertube.search(seed.query);
      const response = createSearchResponseData(
        seed.query,
        search.estimated_results,
        {
          features: [],
          limit: candidatePoolSize,
        },
        search.results,
        null,
      );
      const relatedItems = response.items
        .slice(0, candidatePoolSize)
        .map((item) => toRelatedItemFromSearchResult(item));

      relatedItems.forEach((item, itemIndex) => {
        addRecommendationCandidate(
          candidateMap,
          item,
          90 + Math.min(seed.count, 5) * 10 - seedIndex * 10 - itemIndex * 2,
          watchedVideoIds,
        );
      });
    }),
  );

  if (candidateMap.size < candidatePoolSize) {
    try {
      const homeFeed = await innertube.getHomeFeed();
      const discoveryFeed = createDiscoveryFeedData(
        'home',
        homeFeed.header?.title?.toString() ?? 'Home',
        'filter',
        createDiscoveryFeedOptions(homeFeed, 'filter'),
        homeFeed,
        null,
      );

      discoveryFeed.items.slice(0, candidatePoolSize).forEach((item, itemIndex) => {
        addRecommendationCandidate(candidateMap, item, 30 - itemIndex, watchedVideoIds);
      });
    } catch {
      // keep partial candidate pool when fallback discovery is unavailable
    }
  }

  return createRecommendationPage(
    visitorKey,
    title,
    subtitle,
    reason,
    profileSummary,
    sortRecommendationCandidates(candidateMap),
    limit,
  );
};

export const buildRecommendationContinuationFeed = async (
  request: FastifyRequest,
  continuation: RecommendationPaginationToken,
  limit: number,
): Promise<RecommendationFeedData> => {
  const visitorKey = getAnonymousRecommendationVisitorKey(request);

  if (continuation.visitorKey !== visitorKey) {
    throw new Error('Recommendations continuation token does not belong to the current anonymous visitor profile.');
  }

  return createRecommendationPage(
    continuation.visitorKey,
    continuation.title,
    continuation.subtitle,
    continuation.reason,
    continuation.profile,
    continuation.bufferedItems,
    limit,
  );
};
