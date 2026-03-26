import { randomUUID } from 'node:crypto';
import {
  getRedisClient,
  getRedisKeyPrefix,
  isRedisConfigured,
  type ChannelFeedTab,
  type CommunityPostItem,
  type DiscoveryFeedKind,
  type DiscoveryFeedOption,
  type DiscoveryOptionType,
  type RecommendationFeedReason,
  type RecommendationProfileSummary,
  type RelatedItem,
  type SearchFilters,
  type SearchResultItem,
} from '@ytpa/shared';

const paginationStateTtlMs = 30 * 60 * 1000;
const paginationRedisKeyPrefix = 'api:pagination';

interface PaginationTokenBase {
  scope: string;
}

export interface SearchPaginationToken extends PaginationTokenBase {
  scope: 'search';
  token: string | null;
  query: string;
  estimatedResults: number;
  filters: SearchFilters;
  bufferedItems?: SearchResultItem[];
}

export interface PlaylistPaginationToken extends PaginationTokenBase {
  scope: 'playlist';
  token: string;
  playlistId: string;
}

export interface ChannelFeedPaginationToken extends PaginationTokenBase {
  scope: 'channel-feed';
  token: string | null;
  channelId: string;
  tab: ChannelFeedTab;
  bufferedItems?: RelatedItem[];
}

export interface DiscoveryPaginationToken extends PaginationTokenBase {
  scope: 'discovery-feed';
  token: string;
  feed: DiscoveryFeedKind;
  optionType: DiscoveryOptionType;
  title: string | null;
  options: DiscoveryFeedOption[];
}

export interface CommunityPaginationToken extends PaginationTokenBase {
  scope: 'community-feed';
  token: string | null;
  channelId: string;
  bufferedItems?: CommunityPostItem[];
}

export interface ChannelHomePaginationToken extends PaginationTokenBase {
  scope: 'channel-home';
  token: string;
  channelId: string;
  title: string | null;
  filterOptions: DiscoveryFeedOption[];
}

export interface ChannelSearchPaginationToken extends PaginationTokenBase {
  scope: 'channel-search';
  token: string;
  channelId: string;
  query: string;
  title: string | null;
  sortOptions: DiscoveryFeedOption[];
  contentTypeOptions: DiscoveryFeedOption[];
}

export interface RecommendationPaginationToken extends PaginationTokenBase {
  scope: 'recommendations';
  visitorKey: string;
  title: string;
  subtitle: string | null;
  reason: RecommendationFeedReason;
  profile: RecommendationProfileSummary;
  bufferedItems: RelatedItem[];
}

type PaginationToken =
  | SearchPaginationToken
  | PlaylistPaginationToken
  | ChannelFeedPaginationToken
  | DiscoveryPaginationToken
  | CommunityPaginationToken
  | ChannelHomePaginationToken
  | ChannelSearchPaginationToken
  | RecommendationPaginationToken;

interface StoredPaginationToken {
  expiresAt: number;
  value: PaginationToken;
}

const paginationState = new Map<string, StoredPaginationToken>();

const buildRedisKey = (tokenId: string): string => {
  return `${getRedisKeyPrefix()}:${paginationRedisKeyPrefix}:${tokenId}`;
};

const pruneExpiredTokens = () => {
  const now = Date.now();

  for (const [key, entry] of paginationState.entries()) {
    if (entry.expiresAt <= now) {
      paginationState.delete(key);
    }
  }
};

const storeTokenInMemory = (
  tokenId: string,
  value: PaginationToken,
  ttlMs: number,
) => {
  paginationState.set(tokenId, {
    expiresAt: Date.now() + ttlMs,
    value,
  });
};

const readTokenFromMemory = (tokenId: string): PaginationToken | null => {
  pruneExpiredTokens();

  const entry = paginationState.get(tokenId);
  if (!entry || entry.expiresAt <= Date.now()) {
    paginationState.delete(tokenId);
    return null;
  }

  return entry.value;
};

const readTokenFromRedis = async (tokenId: string): Promise<PaginationToken | null> => {
  if (!isRedisConfigured()) {
    return null;
  }

  try {
    const client = await getRedisClient();
    if (!client) {
      return null;
    }

    const redisKey = buildRedisKey(tokenId);
    const encoded = await client.get(redisKey);
    if (!encoded) {
      return null;
    }

    const parsed = JSON.parse(encoded) as PaginationToken;
    const ttlMs = await client.pTTL(redisKey);

    if (Number.isFinite(ttlMs) && ttlMs > 0) {
      storeTokenInMemory(tokenId, parsed, ttlMs);
    }

    return parsed;
  } catch {
    return null;
  }
};

const storeToken = async (value: PaginationToken): Promise<string> => {
  pruneExpiredTokens();

  const tokenId = randomUUID();
  storeTokenInMemory(tokenId, value, paginationStateTtlMs);

  if (isRedisConfigured()) {
    try {
      const client = await getRedisClient();
      if (client) {
        await client.set(buildRedisKey(tokenId), JSON.stringify(value), {
          PX: paginationStateTtlMs,
        });
      }
    } catch {
      return tokenId;
    }
  }

  return tokenId;
};

const readToken = async (value: string): Promise<PaginationToken> => {
  const inMemoryValue = readTokenFromMemory(value);
  if (inMemoryValue) {
    return inMemoryValue;
  }

  const redisValue = await readTokenFromRedis(value);
  if (redisValue) {
    return redisValue;
  }

  paginationState.delete(value);
  throw new Error('Invalid or expired continuation token.');
};

export const encodeSearchPaginationToken = async (
  value: Omit<SearchPaginationToken, 'scope'>,
): Promise<string> => {
  return storeToken({
    scope: 'search',
    ...value,
  });
};

export const encodePlaylistPaginationToken = async (
  value: Omit<PlaylistPaginationToken, 'scope'>,
): Promise<string> => {
  return storeToken({
    scope: 'playlist',
    ...value,
  });
};

export const encodeChannelFeedPaginationToken = async (
  value: Omit<ChannelFeedPaginationToken, 'scope'>,
): Promise<string> => {
  return storeToken({
    scope: 'channel-feed',
    ...value,
  });
};

export const encodeDiscoveryPaginationToken = async (
  value: Omit<DiscoveryPaginationToken, 'scope'>,
): Promise<string> => {
  return storeToken({
    scope: 'discovery-feed',
    ...value,
  });
};

export const encodeCommunityPaginationToken = async (
  value: Omit<CommunityPaginationToken, 'scope'>,
): Promise<string> => {
  return storeToken({
    scope: 'community-feed',
    ...value,
  });
};

export const encodeChannelHomePaginationToken = async (
  value: Omit<ChannelHomePaginationToken, 'scope'>,
): Promise<string> => {
  return storeToken({
    scope: 'channel-home',
    ...value,
  });
};

export const encodeChannelSearchPaginationToken = async (
  value: Omit<ChannelSearchPaginationToken, 'scope'>,
): Promise<string> => {
  return storeToken({
    scope: 'channel-search',
    ...value,
  });
};

export const encodeRecommendationPaginationToken = async (
  value: Omit<RecommendationPaginationToken, 'scope'>,
): Promise<string> => {
  return storeToken({
    scope: 'recommendations',
    ...value,
  });
};

export const decodeSearchPaginationToken = async (
  value: string,
): Promise<SearchPaginationToken> => {
  const parsed = await readToken(value);

  if (
    parsed.scope !== 'search' ||
    (parsed.token !== null && typeof parsed.token !== 'string') ||
    typeof parsed.query !== 'string' ||
    typeof parsed.estimatedResults !== 'number' ||
    !parsed.filters ||
    typeof parsed.filters !== 'object' ||
    (parsed.bufferedItems !== undefined && !Array.isArray(parsed.bufferedItems))
  ) {
    throw new Error('Invalid search continuation token.');
  }

  return parsed;
};

export const decodePlaylistPaginationToken = async (
  value: string,
): Promise<PlaylistPaginationToken> => {
  const parsed = await readToken(value);

  if (
    parsed.scope !== 'playlist' ||
    typeof parsed.token !== 'string' ||
    typeof parsed.playlistId !== 'string'
  ) {
    throw new Error('Invalid playlist continuation token.');
  }

  return parsed;
};

export const decodeChannelFeedPaginationToken = async (
  value: string,
): Promise<ChannelFeedPaginationToken> => {
  const parsed = await readToken(value);

  if (
    parsed.scope !== 'channel-feed' ||
    (parsed.token !== null && typeof parsed.token !== 'string') ||
    typeof parsed.channelId !== 'string' ||
    typeof parsed.tab !== 'string' ||
    (parsed.bufferedItems !== undefined && !Array.isArray(parsed.bufferedItems))
  ) {
    throw new Error('Invalid channel feed continuation token.');
  }

  return parsed;
};

export const decodeDiscoveryPaginationToken = async (
  value: string,
): Promise<DiscoveryPaginationToken> => {
  const parsed = await readToken(value);

  if (
    parsed.scope !== 'discovery-feed' ||
    typeof parsed.token !== 'string' ||
    typeof parsed.feed !== 'string' ||
    typeof parsed.optionType !== 'string' ||
    (parsed.title !== null && typeof parsed.title !== 'string') ||
    !Array.isArray(parsed.options)
  ) {
    throw new Error('Invalid discovery continuation token.');
  }

  return parsed;
};


export const decodeCommunityPaginationToken = async (
  value: string,
): Promise<CommunityPaginationToken> => {
  const parsed = await readToken(value);

  if (
    parsed.scope !== 'community-feed' ||
    (parsed.token !== null && typeof parsed.token !== 'string') ||
    typeof parsed.channelId !== 'string' ||
    (parsed.bufferedItems !== undefined && !Array.isArray(parsed.bufferedItems))
  ) {
    throw new Error('Invalid community continuation token.');
  }

  return parsed;
};


export const decodeChannelHomePaginationToken = async (
  value: string,
): Promise<ChannelHomePaginationToken> => {
  const parsed = await readToken(value);

  if (
    parsed.scope !== 'channel-home' ||
    typeof parsed.token !== 'string' ||
    typeof parsed.channelId !== 'string' ||
    (parsed.title !== null && typeof parsed.title !== 'string') ||
    !Array.isArray(parsed.filterOptions)
  ) {
    throw new Error('Invalid channel home continuation token.');
  }

  return parsed;
};

export const decodeChannelSearchPaginationToken = async (
  value: string,
): Promise<ChannelSearchPaginationToken> => {
  const parsed = await readToken(value);

  if (
    parsed.scope !== 'channel-search' ||
    typeof parsed.token !== 'string' ||
    typeof parsed.channelId !== 'string' ||
    typeof parsed.query !== 'string' ||
    (parsed.title !== null && typeof parsed.title !== 'string') ||
    !Array.isArray(parsed.sortOptions) ||
    !Array.isArray(parsed.contentTypeOptions)
  ) {
    throw new Error('Invalid channel search continuation token.');
  }

  return parsed;
};

export const decodeRecommendationPaginationToken = async (
  value: string,
): Promise<RecommendationPaginationToken> => {
  const parsed = await readToken(value);

  if (
    parsed.scope !== 'recommendations' ||
    typeof parsed.visitorKey !== 'string' ||
    typeof parsed.title !== 'string' ||
    (parsed.subtitle !== null && typeof parsed.subtitle !== 'string') ||
    typeof parsed.reason !== 'string' ||
    !parsed.profile ||
    typeof parsed.profile !== 'object' ||
    !Array.isArray(parsed.bufferedItems)
  ) {
    throw new Error('Invalid recommendations continuation token.');
  }

  return parsed;
};
