import { YTNodes, type Innertube } from 'youtubei.js';
import {
  buildCanonicalVideoUrl,
  getVideoLifecycle,
  inferPremiereFlag,
  isPortraitEmbed,
  isShortsUrl,
  toIsoDateString,
} from './video-shape.js';
import type {
  ChannelBrowseData,
  ChannelBrowseMode,
  ChannelDetailsData,
  ChannelFeedData,
  ChannelLink,
  ChannelSummary,
  CommentAuthor,
  CommentSort,
  CommentSortOption,
  CommunityPostCommentsData,
  CommunityPostData,
  CommunityPostItem,
  CommunityPostsData,
  CommunityPostPreview,
  DiscoveryFeedData,
  DiscoveryFeedKind,
  DiscoveryFeedOption,
  DiscoveryFeedSection,
  DiscoveryOptionType,
  PlaylistDetailsData,
  PlaylistEntry,
  RelatedItem,
  SearchResponseData,
  SearchResultItem,
  SearchVideoItem,
  Thumbnail,
  VideoCommentItem,
  VideoCommentReplyItem,
  VideoCommentRepliesData,
  VideoCommentsData,
  VideoDetailsData,
  VideoRelatedData,
} from '@ytpa/shared';

type BasicVideoInfo = Awaited<ReturnType<Innertube['getBasicInfo']>>;
type ChannelFeed = Awaited<ReturnType<Innertube['getChannel']>>;
type ChannelAbout = Awaited<ReturnType<ChannelFeed['getAbout']>>;
type PlaylistFeed = Awaited<ReturnType<Innertube['getPlaylist']>>;
type DetailedVideoInfo = Awaited<ReturnType<Innertube['getInfo']>>;
type CommentsFeed = Awaited<ReturnType<Innertube['getComments']>>;
type VideoSearchNode =
  | InstanceType<typeof YTNodes.Video>
  | InstanceType<typeof YTNodes.CompactVideo>
  | InstanceType<typeof YTNodes.GridVideo>
  | InstanceType<typeof YTNodes.Movie>;
type ChannelSearchNode =
  | InstanceType<typeof YTNodes.Channel>
  | InstanceType<typeof YTNodes.CompactChannel>;
type PlaylistSearchNode =
  | InstanceType<typeof YTNodes.Playlist>
  | InstanceType<typeof YTNodes.CompactPlaylist>;
type CommunityPostNode =
  | InstanceType<typeof YTNodes.BackstagePost>
  | InstanceType<typeof YTNodes.Post>
  | InstanceType<typeof YTNodes.SharedPost>;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const toText = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const text = value.trim();
    return text.length > 0 ? text : null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.toString !== 'function' ||
    value.toString === Object.prototype.toString
  ) {
    return null;
  }

  const text = value.toString().trim();
  return text.length > 0 ? text : null;
};

const toBoolean = (value: unknown): boolean | null => {
  return typeof value === 'boolean' ? value : null;
};

const toThumbnailList = (value: unknown): Thumbnail[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.url !== 'string') {
      return [];
    }

    return [{
      url: item.url,
      width: typeof item.width === 'number' ? item.width : 0,
      height: typeof item.height === 'number' ? item.height : 0,
    } satisfies Thumbnail];
  });
};

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => toText(item))
      .filter((item): item is string => item !== null);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  return [];
};

const getEndpointUrl = (value: unknown): string | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.toURL === 'function') {
    const url = value.toURL();
    if (typeof url === 'string' && url.trim().length > 0) {
      return url;
    }
  }

  if (isRecord(value.metadata) && typeof value.metadata.url === 'string') {
    return value.metadata.url;
  }

  return null;
};

const extractHandleFromUrl = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const normalized = value.startsWith('http://')
    ? value.replace('http://', 'https://')
    : value;

  try {
    const url = new URL(normalized);
    const segments = url.pathname.split('/').filter(Boolean);
    const handle = segments.find((segment) => segment.startsWith('@'));
    return handle ?? null;
  } catch {
    return null;
  }
};

const getExplicitPremiereFlag = (value: unknown): boolean => {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.is_premiere === 'boolean' ? value.is_premiere : false;
};

const getUpcomingDate = (value: unknown): Date | null => {
  if (!isRecord(value)) {
    return null;
  }

  return value.upcoming instanceof Date ? value.upcoming : null;
};

const getBadgeTexts = (value: unknown): string[] => {
  if (!isRecord(value) || !Array.isArray(value.badges)) {
    return [];
  }

  return value.badges
    .map((badge) => {
      if (!isRecord(badge)) {
        return null;
      }

      return toText(badge.label) ?? toText(badge.text);
    })
    .filter((badge): badge is string => badge !== null);
};

const toChannelSummary = (value: unknown): ChannelSummary | null => {
  const textFallback = toText(value);

  if (!isRecord(value)) {
    return textFallback
      ? {
          id: null,
          name: textFallback,
          url: null,
          thumbnails: [],
          subscriberCountText: null,
          videoCountText: null,
          verified: null,
        }
      : null;
  }

  const name =
    toText(value.name) ??
    toText(value.display_name) ??
    toText(value.title) ??
    textFallback;

  if (!name) {
    return null;
  }

  const verifiedFlag = [
    toBoolean(value.is_verified),
    toBoolean(value.is_verified_artist),
  ].find((flag) => flag !== null) ?? null;

  return {
    id: toText(value.id) ?? toText(value.channel_id),
    name,
    url: toText(value.url) ?? getEndpointUrl(value.endpoint),
    thumbnails: toThumbnailList(value.thumbnails ?? value.thumbnail),
    subscriberCountText: toText(value.subscriber_count),
    videoCountText: toText(value.video_count),
    verified: verifiedFlag,
  };
};

const toDuration = (value: Record<string, unknown>): {
  text: string | null;
  seconds: number | null;
} => {
  const rawDuration = value.duration;

  if (isRecord(rawDuration) && typeof rawDuration.seconds === 'number') {
    return {
      text: toText(rawDuration.text) ?? toText(value.length_text),
      seconds: rawDuration.seconds,
    };
  }

  return {
    text: toText(value.length_text) ?? toText(rawDuration),
    seconds: null,
  };
};

const normalizeVideoSearchNode = (node: VideoSearchNode): SearchVideoItem | null => {
  const value = node as unknown as Record<string, unknown>;
  const id = toText(value.video_id) ?? toText(value.id);

  if (!id) {
    return null;
  }

  const duration = toDuration(value);
  const endpointUrl = getEndpointUrl(value.endpoint) ?? getEndpointUrl(node);
  const kind: SearchVideoItem['kind'] =
    node instanceof YTNodes.Movie
      ? 'movie'
      : isShortsUrl(endpointUrl)
        ? 'shorts'
        : 'video';
  const isLive = toBoolean(value.is_live) ?? false;
  const upcomingDate = getUpcomingDate(value);
  const isUpcoming = toBoolean(value.is_upcoming) ?? upcomingDate !== null;
  const badgeTexts = getBadgeTexts(value);
  const isPremiere = inferPremiereFlag({
    explicit: getExplicitPremiereFlag(node as unknown as Record<string, unknown>),
    isUpcoming,
    textHints: [
      toText(value.published),
      ...badgeTexts,
    ],
  });

  return {
    kind,
    id,
    title: toText(value.title) ?? id,
    description: toText(value.description_snippet),
    thumbnails: toThumbnailList(value.thumbnails),
    durationText: duration.text,
    durationSeconds: duration.seconds,
    channel: toChannelSummary(value.author),
    viewCountText:
      toText(value.short_view_count) ??
      toText(value.view_count) ??
      toText(value.views) ??
      toText(value.top_metadata_items),
    publishedText: toText(value.published),
    isLive,
    isUpcoming,
    isPremiere,
    scheduledStartTime: toIsoDateString(upcomingDate),
    liveLifecycle: getVideoLifecycle({
      isLive,
      isUpcoming,
      isPremiere,
      isLiveDvrEnabled: false,
      isPostLiveDvr: false,
    }),
  };
};

const normalizeChannelSearchNode = (node: ChannelSearchNode): SearchResultItem | null => {
  const value = node as unknown as Record<string, unknown>;
  const summary = toChannelSummary(value.author) ?? toChannelSummary(node);
  const id = toText(value.id) ?? toText(value.channel_id) ?? summary?.id;

  if (!id || !summary) {
    return null;
  }

  return {
    kind: 'channel',
    id,
    title: summary.name,
    description: toText(value.description_snippet),
    thumbnails:
      summary.thumbnails.length > 0
        ? summary.thumbnails
        : toThumbnailList(value.thumbnail),
    subscriberCountText:
      toText(value.subscriber_count) ?? summary.subscriberCountText,
    videoCountText: toText(value.video_count) ?? summary.videoCountText,
    verified: summary.verified,
  };
};

const normalizePlaylistSearchNode = (node: PlaylistSearchNode): SearchResultItem | null => {
  const value = node as unknown as Record<string, unknown>;
  const id = toText(value.id);

  if (!id) {
    return null;
  }

  return {
    kind: 'playlist',
    id,
    title: toText(value.title) ?? id,
    thumbnails: toThumbnailList(value.thumbnails),
    videoCountText:
      toText(value.video_count) ?? toText(value.video_count_short),
    channel: toChannelSummary(value.author),
  };
};

const normalizeSearchResultNode = (node: unknown): SearchResultItem | null => {
  if (
    node instanceof YTNodes.Video ||
    node instanceof YTNodes.CompactVideo ||
    node instanceof YTNodes.GridVideo ||
    node instanceof YTNodes.Movie
  ) {
    return normalizeVideoSearchNode(node);
  }

  if (
    node instanceof YTNodes.Channel ||
    node instanceof YTNodes.CompactChannel
  ) {
    return normalizeChannelSearchNode(node);
  }

  if (node instanceof YTNodes.Playlist) {
    return normalizePlaylistSearchNode(node);
  }

  return null;
};

const getNestedSearchNodes = (node: unknown): unknown[] => {
  if (node instanceof YTNodes.Shelf) {
    return node.content ? [node.content] : [];
  }

  if (node instanceof YTNodes.GridShelfView) {
    return [...node.contents];
  }

  if (!isRecord(node)) {
    return [];
  }

  const nested: unknown[] = [];

  for (const key of ['content', 'contents', 'items']) {
    const value = node[key];

    if (Array.isArray(value)) {
      nested.push(...value);
      continue;
    }

    if (value) {
      nested.push(value);
    }
  }

  return nested;
};

const getChannelHeader = (channel: ChannelFeed): Record<string, unknown> | null => {
  return isRecord(channel.header) ? channel.header : null;
};

const getChannelBanner = (channel: ChannelFeed): Thumbnail[] => {
  const header = getChannelHeader(channel);

  if (!header) {
    return [];
  }

  const directBanner = toThumbnailList(header.banner);
  if (directBanner.length > 0) {
    return directBanner;
  }

  const mobileBanner = toThumbnailList(header.mobile_banner);
  if (mobileBanner.length > 0) {
    return mobileBanner;
  }

  const pageHeaderBanner =
    isRecord(header.content) && isRecord(header.content.banner)
      ? toThumbnailList(header.content.banner.image)
      : [];

  return pageHeaderBanner;
};

const getAboutMetadata = (about: ChannelAbout | null): Record<string, unknown> | null => {
  if (!about) {
    return null;
  }

  if (about instanceof YTNodes.AboutChannel) {
    return isRecord(about.metadata) ? about.metadata : null;
  }

  return isRecord(about) ? about : null;
};

const toChannelLinks = (about: ChannelAbout | null): ChannelLink[] => {
  const metadata = getAboutMetadata(about);

  if (!metadata) {
    return [];
  }

  const rawLinks = Array.isArray(metadata.links)
    ? metadata.links
    : Array.isArray(metadata.primary_links)
      ? metadata.primary_links
      : [];

  return rawLinks.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const title = toText(item.title);
    const url =
      toText(item.link) ??
      getEndpointUrl(item.endpoint) ??
      getEndpointUrl(item);

    if (!title || !url) {
      return [];
    }

    return [{
      title,
      url,
      thumbnails: toThumbnailList(item.favicon ?? item.icon),
    } satisfies ChannelLink];
  });
};

const resolveChannelHandle = (
  metadata: Record<string, unknown>,
  aboutMetadata: Record<string, unknown> | null,
  header: Record<string, unknown> | null,
): string | null => {
  return (
    toText(header?.channel_handle) ??
    extractHandleFromUrl(toText(metadata.vanity_channel_url)) ??
    extractHandleFromUrl(toText(aboutMetadata?.canonical_channel_url))
  );
};

export const collectSearchResultItems = (
  results: readonly unknown[],
  limit: number,
): SearchResultItem[] => {
  const items: SearchResultItem[] = [];
  const queue = [...results];

  while (queue.length > 0 && items.length < limit) {
    const candidate = queue.shift();

    if (!candidate) {
      continue;
    }

    const normalized = normalizeSearchResultNode(candidate);

    if (normalized) {
      items.push(normalized);
      continue;
    }

    queue.push(...getNestedSearchNodes(candidate));
  }

  return items;
};

const getSearchNodesFromMemoSource = (value: unknown): unknown[] => {
  const memo = getMergedMemoLike(value);

  if (!memo) {
    return [];
  }

  return memo.getType(
    YTNodes.Video,
    YTNodes.CompactVideo,
    YTNodes.GridVideo,
    YTNodes.Movie,
    YTNodes.Channel,
    YTNodes.CompactChannel,
    YTNodes.Playlist,
    YTNodes.CompactPlaylist,
  );
};

export const createSearchResponseData = (
  query: string,
  estimatedResults: number,
  appliedFilters: SearchResponseData['appliedFilters'],
  results: readonly unknown[],
  continuation: string | null,
): SearchResponseData => {
  return {
    query,
    estimatedResults,
    appliedFilters,
    hasContinuation: continuation !== null,
    continuation,
    items: collectSearchResultItems(results, appliedFilters.limit),
  };
};

export const createSearchContinuationData = (
  query: string,
  estimatedResults: number,
  appliedFilters: SearchResponseData['appliedFilters'],
  response: unknown,
  continuation: string | null,
): SearchResponseData => {
  return {
    query,
    estimatedResults,
    appliedFilters,
    hasContinuation: continuation !== null,
    continuation,
    items: collectSearchResultItems(
      getSearchNodesFromMemoSource(response),
      appliedFilters.limit,
    ),
  };
};

export const createVideoDetailsData = (
  requestedVideoId: string,
  info: BasicVideoInfo,
  playbackEndpoint: string,
  storyboardsEndpoint: string,
): VideoDetailsData => {
  const isShorts = isPortraitEmbed(info.basic_info.embed);
  const channel =
    toChannelSummary(info.basic_info.channel) ??
    toChannelSummary({
      id: info.basic_info.channel_id,
      name: info.basic_info.author,
      url: null,
      thumbnails: [],
      subscriber_count: null,
      video_count: null,
      is_verified: null,
    });
  const isLive = info.basic_info.is_live ?? false;
  const isUpcoming = info.basic_info.is_upcoming ?? false;
  const isLiveDvrEnabled = info.basic_info.is_live_dvr_enabled ?? false;
  const isPostLiveDvr = info.basic_info.is_post_live_dvr ?? false;
  const playabilityReason = info.playability_status?.reason ?? null;
  const isPremiere = inferPremiereFlag({
    isUpcoming,
    textHints: [playabilityReason],
  });

  return {
    id: info.basic_info.id ?? requestedVideoId,
    title: info.basic_info.title ?? null,
    description: info.basic_info.short_description ?? null,
    thumbnails: toThumbnailList(info.basic_info.thumbnail),
    channel,
    durationSeconds: info.basic_info.duration ?? null,
    viewCount: info.basic_info.view_count ?? null,
    tags: info.basic_info.tags ?? info.basic_info.keywords ?? [],
    category: info.basic_info.category,
    canonicalUrl:
      info.basic_info.url_canonical ??
      buildCanonicalVideoUrl(info.basic_info.id ?? requestedVideoId, isShorts),
    embedUrl: info.basic_info.embed?.iframe_url ?? null,
    playabilityStatus: info.playability_status?.status ?? null,
    playabilityReason,
    playbackEndpoint,
    storyboardsEndpoint,
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
    isUnlisted: info.basic_info.is_unlisted ?? null,
    isFamilySafe: info.basic_info.is_family_safe ?? null,
  };
};

export const createChannelDetailsData = (
  requestedChannelId: string,
  channel: ChannelFeed,
  about: ChannelAbout | null,
): ChannelDetailsData => {
  const metadata = isRecord(channel.metadata) ? channel.metadata : {};
  const aboutMetadata = getAboutMetadata(about);
  const header = getChannelHeader(channel);
  const headerAuthor = header ? toChannelSummary(header.author) : null;

  const avatarFromMetadata = toThumbnailList(metadata.avatar);
  const thumbnailFallback = toThumbnailList(metadata.thumbnail);
  const avatarFromAbout = aboutMetadata ? toThumbnailList(aboutMetadata.avatar) : [];

  const title =
    toText(metadata.title) ??
    headerAuthor?.name ??
    (aboutMetadata ? toText(aboutMetadata.name) : null);

  const vanityChannelUrl =
    toText(metadata.vanity_channel_url) ??
    (aboutMetadata ? toText(aboutMetadata.canonical_channel_url) : null);

  return {
    id:
      toText(metadata.external_id) ??
      (aboutMetadata ? toText(aboutMetadata.channel_id) : null) ??
      headerAuthor?.id ??
      requestedChannelId,
    title,
    handle: resolveChannelHandle(metadata, aboutMetadata, header),
    description:
      (aboutMetadata ? toText(aboutMetadata.description) : null) ??
      toText(metadata.description),
    country: aboutMetadata ? toText(aboutMetadata.country) : null,
    joinedDateText: aboutMetadata ? toText(aboutMetadata.joined_date) : null,
    subscriberCountText:
      (aboutMetadata ? toText(aboutMetadata.subscriber_count) : null) ??
      toText(header?.subscribers) ??
      headerAuthor?.subscriberCountText ??
      null,
    viewCountText: aboutMetadata ? toText(aboutMetadata.view_count) : null,
    videoCountText:
      (aboutMetadata ? toText(aboutMetadata.video_count) : null) ??
      toText(header?.videos_count) ??
      headerAuthor?.videoCountText ??
      null,
    canonicalUrl:
      (aboutMetadata ? toText(aboutMetadata.canonical_channel_url) : null) ??
      toText(metadata.url_canonical) ??
      toText(metadata.url),
    rssUrl: toText(metadata.rss_url),
    vanityChannelUrl,
    avatar:
      avatarFromMetadata.length > 0
        ? avatarFromMetadata
        : thumbnailFallback.length > 0
          ? thumbnailFallback
          : avatarFromAbout,
    banner: getChannelBanner(channel),
    tabs: [...channel.tabs],
    capabilities: {
      hasHome: channel.has_home,
      hasVideos: channel.has_videos,
      hasShorts: channel.has_shorts,
      hasLiveStreams: channel.has_live_streams,
      hasReleases: channel.has_releases,
      hasPodcasts: channel.has_podcasts,
      hasCourses: channel.has_courses,
      hasPlaylists: channel.has_playlists,
      hasCommunity: channel.has_community,
      hasSearch: channel.has_search,
      hasAbout: channel.has_about,
    },
    links: toChannelLinks(about),
    tags:
      toStringArray(metadata.tags).length > 0
        ? toStringArray(metadata.tags)
        : toStringArray(metadata.keywords),
    availableCountries: toStringArray(metadata.available_countries),
    isFamilySafe: toBoolean(metadata.is_family_safe),
    isUnlisted: toBoolean(metadata.is_unlisted),
  };
};

type PlaylistFeedItemNode =
  | InstanceType<typeof YTNodes.PlaylistVideo>
  | InstanceType<typeof YTNodes.ReelItem>
  | InstanceType<typeof YTNodes.ShortsLockupView>;

const extractVideoIdFromUrl = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const normalized = value.startsWith('http://')
    ? value.replace('http://', 'https://')
    : value;

  try {
    const url = new URL(normalized);
    const queryVideoId = url.searchParams.get('v')?.trim();

    if (queryVideoId) {
      return queryVideoId;
    }

    const segments = url.pathname.split('/').filter(Boolean);
    const markerIndex = segments.findIndex((segment) => {
      return segment === 'shorts' || segment === 'live';
    });

    if (markerIndex >= 0 && markerIndex + 1 < segments.length) {
      return segments[markerIndex + 1] ?? null;
    }
  } catch {
    return null;
  }

  return null;
};

const getEndpointVideoId = (value: unknown): string | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (isRecord(value.payload)) {
    return toText(value.payload.videoId) ?? toText(value.payload.video_id);
  }

  return extractVideoIdFromUrl(getEndpointUrl(value));
};

const normalizePlaylistFeedItem = (node: unknown): PlaylistEntry | null => {
  if (node instanceof YTNodes.PlaylistVideo) {
    const value = node as unknown as Record<string, unknown>;
    const id =
      toText(value.id) ??
      toText(value.video_id) ??
      getEndpointVideoId(value.endpoint);

    if (!id) {
      return null;
    }

    const duration = toDuration(value);
    const isLive = toBoolean(value.is_live) ?? false;
    const upcomingDate = getUpcomingDate(value);
    const isUpcoming = toBoolean(value.is_upcoming) ?? upcomingDate !== null;
    const isPremiere = inferPremiereFlag({
      explicit: getExplicitPremiereFlag(node as unknown as Record<string, unknown>),
      isUpcoming,
      textHints: [toText(value.video_info)],
    });

    return {
      kind: 'video',
      id,
      title: toText(value.title) ?? id,
      thumbnails: toThumbnailList(value.thumbnails),
      indexText: toText(value.index),
      durationText: duration.text,
      durationSeconds: duration.seconds,
      channel: toChannelSummary(value.author),
      videoInfoText: toText(value.video_info),
      isPlayable: toBoolean(value.is_playable) ?? true,
      isLive,
      isUpcoming,
      isPremiere,
      scheduledStartTime: toIsoDateString(upcomingDate),
      liveLifecycle: getVideoLifecycle({
        isLive,
        isUpcoming,
        isPremiere,
        isLiveDvrEnabled: false,
        isPostLiveDvr: false,
      }),
    };
  }

  if (node instanceof YTNodes.ReelItem) {
    const value = node as unknown as Record<string, unknown>;
    const id = toText(value.id) ?? getEndpointVideoId(value.endpoint);

    if (!id) {
      return null;
    }

    return {
      kind: 'shorts',
      id,
      title: toText(value.title) ?? id,
      thumbnails: toThumbnailList(value.thumbnails),
      indexText: null,
      durationText: null,
      durationSeconds: null,
      channel: null,
      videoInfoText: toText(value.views),
      isPlayable: true,
      isLive: false,
      isUpcoming: false,
      isPremiere: false,
      scheduledStartTime: null,
      liveLifecycle: 'vod',
    };
  }

  if (node instanceof YTNodes.ShortsLockupView) {
    const value = node as unknown as Record<string, unknown>;
    const overlayMetadata =
      isRecord(value.overlay_metadata) ? value.overlay_metadata : null;
    const id =
      getEndpointVideoId(value.inline_player_data) ??
      getEndpointVideoId(value.on_tap_endpoint);

    if (!id) {
      return null;
    }

    return {
      kind: 'shorts',
      id,
      title:
        (overlayMetadata ? toText(overlayMetadata.primary_text) : null) ?? id,
      thumbnails: toThumbnailList(value.thumbnail),
      indexText: toText(value.index_in_collection),
      durationText: null,
      durationSeconds: null,
      channel: null,
      videoInfoText:
        (overlayMetadata ? toText(overlayMetadata.secondary_text) : null) ??
        toText(value.accessibility_text),
      isPlayable: true,
      isLive: false,
      isUpcoming: false,
      isPremiere: false,
      scheduledStartTime: null,
      liveLifecycle: 'vod',
    };
  }

  return null;
};

const getPlaylistFeedNodesFromMemoSource = (value: unknown): unknown[] => {
  const memo = getMergedMemoLike(value);

  if (!memo) {
    return [];
  }

  return memo.getType(
    YTNodes.PlaylistVideo,
    YTNodes.ReelItem,
    YTNodes.ShortsLockupView,
  );
};

export const createPlaylistDetailsData = (
  requestedPlaylistId: string,
  playlist: PlaylistFeed,
  continuation: string | null,
): PlaylistDetailsData => {
  const items = playlist.items
    .map((item) => normalizePlaylistFeedItem(item))
    .filter((item): item is PlaylistEntry => item !== null);

  return {
    id: requestedPlaylistId,
    title: toText(playlist.info.title),
    description: toText(playlist.info.description),
    subtitle: toText(playlist.info.subtitle),
    canonicalUrl:
      getEndpointUrl(playlist.endpoint) ??
      `https://www.youtube.com/playlist?list=${encodeURIComponent(requestedPlaylistId)}`,
    thumbnails: toThumbnailList(playlist.info.thumbnails),
    channel: toChannelSummary(playlist.info.author),
    totalItemsText: toText(playlist.info.total_items),
    viewCountText: toText(playlist.info.views),
    lastUpdatedText: toText(playlist.info.last_updated),
    privacy: toText(playlist.info.privacy),
    canShare: playlist.info.can_share,
    canDelete: playlist.info.can_delete,
    canReorder: playlist.info.can_reorder,
    isEditable: playlist.info.is_editable,
    hasContinuation: continuation !== null,
    continuation,
    items,
  };
};

export const createPlaylistContinuationData = (
  requestedPlaylistId: string,
  response: unknown,
  limit: number,
  continuation: string | null,
): PlaylistDetailsData => {
  const items = getPlaylistFeedNodesFromMemoSource(response)
    .map((item) => normalizePlaylistFeedItem(item))
    .filter((item): item is PlaylistEntry => item !== null)
    .slice(0, limit);

  return {
    id: requestedPlaylistId,
    title: null,
    description: null,
    subtitle: null,
    canonicalUrl: `https://www.youtube.com/playlist?list=${encodeURIComponent(requestedPlaylistId)}`,
    thumbnails: [],
    channel: null,
    totalItemsText: null,
    viewCountText: null,
    lastUpdatedText: null,
    privacy: null,
    canShare: false,
    canDelete: false,
    canReorder: false,
    isEditable: false,
    hasContinuation: continuation !== null,
    continuation,
    items,
  };
};
const toThumbnailListFromView = (value: unknown): Thumbnail[] => {
  if (!isRecord(value)) {
    return [];
  }

  const directImages = toThumbnailList(value.image);
  if (directImages.length > 0) {
    return directImages;
  }

  if (isRecord(value.primary_thumbnail)) {
    const primaryImages = toThumbnailList(value.primary_thumbnail.image);
    if (primaryImages.length > 0) {
      return primaryImages;
    }
  }

  return [];
};

const getMetadataRowTexts = (value: unknown): string[][] => {
  if (!isRecord(value) || !Array.isArray(value.metadata_rows)) {
    return [];
  }

  return value.metadata_rows.flatMap((row) => {
    if (!isRecord(row) || !Array.isArray(row.metadata_parts)) {
      return [];
    }

    const texts = row.metadata_parts
      .map((part) => (isRecord(part) ? toText(part.text) : null))
      .filter((part): part is string => part !== null);

    return texts.length > 0 ? [texts] : [];
  });
};

const getThumbnailBadgeTexts = (value: unknown): string[] => {
  if (!isRecord(value) || !Array.isArray(value.overlays)) {
    return [];
  }

  return value.overlays.flatMap((overlay) => {
    if (!isRecord(overlay) || !Array.isArray(overlay.badges)) {
      return [];
    }

    return overlay.badges
      .map((badge) => (isRecord(badge) ? toText(badge.text) : null))
      .filter((badge): badge is string => badge !== null);
  });
};

const parseDurationText = (value: string | null): number | null => {
  if (!value) {
    return null;
  }

  const parts = value
    .split(':')
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part));

  if (parts.length < 2 || parts.length > 3) {
    return null;
  }

  return parts.reduce((total, part) => total * 60 + part, 0);
};

const findDurationText = (values: readonly string[]): string | null => {
  return values.find((value) => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(value.trim())) ?? null;
};

const hasLiveBadgeText = (values: readonly string[]): boolean => {
  return values.some((value) => /(^|\s)live(\s|$)|watching/i.test(value));
};

const hasUpcomingText = (values: readonly string[]): boolean => {
  return values.some((value) => /upcoming|premiere/i.test(value));
};

const hasPremiereText = (values: readonly string[]): boolean => {
  return values.some((value) => /premier/i.test(value));
};

const flattenRowTexts = (rows: string[][]): string[] => {
  return rows.flatMap((row) => row);
};

const findTextMatching = (values: readonly string[], pattern: RegExp): string | null => {
  return values.find((value) => pattern.test(value)) ?? null;
};

export const toRelatedItemFromSearchResult = (item: SearchResultItem): RelatedItem => {
  switch (item.kind) {
    case 'video':
    case 'movie':
    case 'shorts':
      return {
        kind: item.kind,
        id: item.id,
        title: item.title,
        thumbnails: item.thumbnails,
        channel: item.channel,
        bylineText: item.channel?.name ?? null,
        viewCountText: item.viewCountText,
        publishedText: item.publishedText,
        durationText: item.durationText,
        durationSeconds: item.durationSeconds,
        videoCountText: null,
        subscriberCountText: null,
        isLive: item.isLive,
        isUpcoming: item.isUpcoming,
        isPremiere: item.isPremiere,
        scheduledStartTime: item.scheduledStartTime,
        liveLifecycle: item.liveLifecycle,
      };
    case 'playlist':
      return {
        kind: 'playlist',
        id: item.id,
        title: item.title,
        thumbnails: item.thumbnails,
        channel: item.channel,
        bylineText: item.channel?.name ?? null,
        viewCountText: null,
        publishedText: null,
        durationText: null,
        durationSeconds: null,
        videoCountText: item.videoCountText,
        subscriberCountText: null,
        isLive: false,
        isUpcoming: false,
        isPremiere: false,
        scheduledStartTime: null,
        liveLifecycle: 'vod',
      };
    case 'channel':
      return {
        kind: 'channel',
        id: item.id,
        title: item.title,
        thumbnails: item.thumbnails,
        channel: toChannelSummary({
          id: item.id,
          name: item.title,
          url: null,
          thumbnails: item.thumbnails,
          subscriber_count: item.subscriberCountText,
          video_count: item.videoCountText,
          is_verified: item.verified,
        }),
        bylineText: null,
        viewCountText: null,
        publishedText: null,
        durationText: null,
        durationSeconds: null,
        videoCountText: item.videoCountText,
        subscriberCountText: item.subscriberCountText,
        isLive: false,
        isUpcoming: false,
        isPremiere: false,
        scheduledStartTime: null,
        liveLifecycle: 'vod',
      };
  }
};

const toRelatedItemFromPlaylistEntry = (entry: PlaylistEntry): RelatedItem => {
  return {
    kind: entry.kind,
    id: entry.id,
    title: entry.title,
    thumbnails: entry.thumbnails,
    channel: entry.channel,
    bylineText: entry.channel?.name ?? null,
    viewCountText: entry.videoInfoText,
    publishedText: null,
    durationText: entry.durationText,
    durationSeconds: entry.durationSeconds,
    videoCountText: null,
    subscriberCountText: null,
    isLive: entry.isLive,
    isUpcoming: entry.isUpcoming,
    isPremiere: entry.isPremiere,
    scheduledStartTime: entry.scheduledStartTime,
    liveLifecycle: entry.liveLifecycle,
  };
};

const normalizeCompactMovieNode = (
  node: InstanceType<typeof YTNodes.CompactMovie>,
): RelatedItem | null => {
  const value = node as unknown as Record<string, unknown>;
  const id = toText(value.id) ?? getEndpointVideoId(value.endpoint);

  if (!id) {
    return null;
  }

  const duration = toDuration(value);

  return {
    kind: 'movie',
    id,
    title: toText(value.title) ?? id,
    thumbnails: toThumbnailList(value.thumbnails),
    channel: toChannelSummary(value.author),
    bylineText: toText(value.author),
    viewCountText: toText(value.top_metadata_items),
    publishedText: null,
    durationText: duration.text,
    durationSeconds: duration.seconds,
    videoCountText: null,
    subscriberCountText: null,
    isLive: false,
    isUpcoming: false,
    isPremiere: false,
    scheduledStartTime: null,
    liveLifecycle: 'vod',
  };
};

const normalizePlaylistPanelVideoNode = (
  node: InstanceType<typeof YTNodes.PlaylistPanelVideo>,
): RelatedItem | null => {
  const value = node as unknown as Record<string, unknown>;
  const id = toText(value.video_id) ?? getEndpointVideoId(value.endpoint);

  if (!id) {
    return null;
  }

  const duration = toDuration(value);
  const channel = toChannelSummary(value.author);

  return {
    kind: 'video',
    id,
    title: toText(value.title) ?? id,
    thumbnails: toThumbnailList(value.thumbnail),
    channel,
    bylineText: channel?.name ?? toText(value.author),
    viewCountText: null,
    publishedText: null,
    durationText: duration.text,
    durationSeconds: duration.seconds,
    videoCountText: null,
    subscriberCountText: null,
    isLive: false,
    isUpcoming: false,
    isPremiere: false,
    scheduledStartTime: null,
    liveLifecycle: 'vod',
  };
};

const toRelatedKindFromLockupType = (
  value: string | null,
): RelatedItem['kind'] | null => {
  switch (value) {
    case 'VIDEO':
      return 'video';
    case 'PLAYLIST':
      return 'playlist';
    case 'CHANNEL':
      return 'channel';
    case 'SHORT':
      return 'shorts';
    case 'MOVIE':
      return 'movie';
    default:
      return null;
  }
};

const normalizeLockupViewNode = (
  node: InstanceType<typeof YTNodes.LockupView>,
): RelatedItem | null => {
  const value = node as unknown as Record<string, unknown>;
  const id = toText(value.content_id);
  const kind = toRelatedKindFromLockupType(toText(value.content_type));

  if (!id || !kind) {
    return null;
  }

  const metadata = isRecord(value.metadata) ? value.metadata : null;
  const rows = metadata && isRecord(metadata.metadata)
    ? getMetadataRowTexts(metadata.metadata)
    : [];
  const flatRowTexts = flattenRowTexts(rows);
  const badgeTexts = getThumbnailBadgeTexts(value.content_image);
  const durationText = findDurationText(badgeTexts);
  const title = metadata ? toText(metadata.title) ?? id : id;
  const thumbnails = toThumbnailListFromView(value.content_image);

  if (kind === 'channel') {
    const subscriberCountText =
      findTextMatching(flatRowTexts, /subscriber/i) ??
      rows[0]?.[0] ??
      null;
    const videoCountText =
      findTextMatching(flatRowTexts, /video/i) ??
      rows[0]?.[1] ??
      rows[1]?.[0] ??
      null;

    return {
      kind,
      id,
      title,
      thumbnails,
      channel: toChannelSummary({
        id,
        name: title,
        url: null,
        thumbnails,
        subscriber_count: subscriberCountText,
        video_count: videoCountText,
        is_verified: null,
      }),
      bylineText: null,
      viewCountText: null,
      publishedText: null,
      durationText: null,
      durationSeconds: null,
      videoCountText,
      subscriberCountText,
      isLive: false,
      isUpcoming: false,
      isPremiere: false,
      scheduledStartTime: null,
      liveLifecycle: 'vod',
    };
  }

  if (kind === 'playlist') {
    const ownerName = rows[0]?.[0] ?? null;
    const videoCountText =
      findTextMatching(flatRowTexts, /video|track|episode/i) ??
      rows[0]?.[1] ??
      rows[1]?.[0] ??
      null;

    return {
      kind,
      id,
      title,
      thumbnails,
      channel: toChannelSummary(ownerName),
      bylineText: ownerName,
      viewCountText: null,
      publishedText: null,
      durationText: null,
      durationSeconds: null,
      videoCountText,
      subscriberCountText: null,
      isLive: false,
      isUpcoming: false,
      isPremiere: false,
      scheduledStartTime: null,
      liveLifecycle: 'vod',
    };
  }

  const ownerName = rows[0]?.[0] ?? null;
  const isLive = hasLiveBadgeText([...badgeTexts, ...flatRowTexts]);
  const isUpcoming = hasUpcomingText(flatRowTexts);
  const isPremiere = inferPremiereFlag({
    explicit: hasPremiereText([...badgeTexts, ...flatRowTexts]),
    isUpcoming,
    textHints: [...badgeTexts, ...flatRowTexts],
  });

  return {
    kind,
    id,
    title,
    thumbnails,
    channel: toChannelSummary(ownerName),
    bylineText: ownerName,
    viewCountText: rows[1]?.[0] ?? null,
    publishedText: rows[1]?.[1] ?? null,
    durationText,
    durationSeconds: parseDurationText(durationText),
    videoCountText: null,
    subscriberCountText: null,
    isLive,
    isUpcoming,
    isPremiere,
    scheduledStartTime: null,
    liveLifecycle: getVideoLifecycle({
      isLive,
      isUpcoming,
      isPremiere,
      isLiveDvrEnabled: false,
      isPostLiveDvr: false,
    }),
  };
};

const normalizeRelatedNode = (node: unknown): RelatedItem[] => {
  if (
    node instanceof YTNodes.Video ||
    node instanceof YTNodes.CompactVideo ||
    node instanceof YTNodes.GridVideo ||
    node instanceof YTNodes.Movie
  ) {
    const normalized = normalizeVideoSearchNode(node);
    return normalized ? [toRelatedItemFromSearchResult(normalized)] : [];
  }

  if (
    node instanceof YTNodes.Channel ||
    node instanceof YTNodes.CompactChannel
  ) {
    const normalized = normalizeChannelSearchNode(node);
    return normalized ? [toRelatedItemFromSearchResult(normalized)] : [];
  }

  if (node instanceof YTNodes.Playlist || node instanceof YTNodes.CompactPlaylist) {
    const normalized = normalizePlaylistSearchNode(node);
    return normalized ? [toRelatedItemFromSearchResult(normalized)] : [];
  }

  if (node instanceof YTNodes.CompactMovie) {
    const normalized = normalizeCompactMovieNode(node);
    return normalized ? [normalized] : [];
  }

  if (node instanceof YTNodes.PlaylistPanelVideo) {
    const normalized = normalizePlaylistPanelVideoNode(node);
    return normalized ? [normalized] : [];
  }

  if (
    node instanceof YTNodes.ReelItem ||
    node instanceof YTNodes.ShortsLockupView
  ) {
    const normalized = normalizePlaylistFeedItem(node);
    return normalized ? [toRelatedItemFromPlaylistEntry(normalized)] : [];
  }

  if (node instanceof YTNodes.ReelShelf) {
    return node.contents.flatMap((item) => normalizeRelatedNode(item));
  }

  if (node instanceof YTNodes.LockupView) {
    const normalized = normalizeLockupViewNode(node);
    return normalized ? [normalized] : [];
  }

  return [];
};

const getNestedRelatedNodes = (node: unknown): unknown[] => {
  if (node instanceof YTNodes.ReelShelf) {
    return [...node.contents];
  }

  if (!isRecord(node)) {
    return [];
  }

  const nested: unknown[] = [];

  for (const key of ['content', 'contents', 'items']) {
    const value = node[key];

    if (Array.isArray(value)) {
      nested.push(...value);
      continue;
    }

    if (value) {
      nested.push(value);
    }
  }

  return nested;
};

const collectRelatedItems = (
  items: readonly unknown[],
  requestedVideoId: string,
  limit: number,
): RelatedItem[] => {
  const normalizedItems: RelatedItem[] = [];
  const seenKeys = new Set<string>();
  const queue = [...items];

  while (queue.length > 0 && normalizedItems.length < limit) {
    const candidate = queue.shift();

    if (!candidate) {
      continue;
    }

    const resolved = normalizeRelatedNode(candidate);

    if (resolved.length > 0) {
      for (const item of resolved) {
        if (item.id === requestedVideoId) {
          continue;
        }

        const dedupeKey = `${item.kind}:${item.id}`;
        if (seenKeys.has(dedupeKey)) {
          continue;
        }

        seenKeys.add(dedupeKey);
        normalizedItems.push(item);

        if (normalizedItems.length >= limit) {
          break;
        }
      }

      continue;
    }

    queue.push(...getNestedRelatedNodes(candidate));
  }

  return normalizedItems;
};

const getChannelFeedNodesFromSource = (
  value: unknown,
  tab: ChannelFeedData['tab'],
): unknown[] => {
  if (isRecord(value)) {
    if (tab === 'playlists' && Array.isArray(value.playlists)) {
      return value.playlists;
    }

    if (Array.isArray(value.videos)) {
      return value.videos;
    }
  }

  const memo = getMergedMemoLike(value);

  if (!memo) {
    return [];
  }

  switch (tab) {
    case 'playlists':
      return memo.getType(
        YTNodes.LockupView,
        YTNodes.Playlist,
        YTNodes.GridPlaylist,
        YTNodes.CompactPlaylist,
      );
    case 'shorts':
      return memo.getType(YTNodes.ShortsLockupView, YTNodes.ReelItem);
    case 'videos':
    case 'streams':
    default:
      return memo.getType(
        YTNodes.Video,
        YTNodes.CompactVideo,
        YTNodes.GridVideo,
        YTNodes.Movie,
      );
  }
};

const collectChannelFeedItems = (
  items: readonly unknown[],
  limit: number,
): RelatedItem[] => {
  const normalizedItems: RelatedItem[] = [];
  const seenKeys = new Set<string>();
  const queue = [...items];

  while (queue.length > 0 && normalizedItems.length < limit) {
    const candidate = queue.shift();

    if (!candidate) {
      continue;
    }

    const resolved = normalizeRelatedNode(candidate);

    if (resolved.length > 0) {
      for (const item of resolved) {
        const dedupeKey = `${item.kind}:${item.id}`;

        if (seenKeys.has(dedupeKey)) {
          continue;
        }

        seenKeys.add(dedupeKey);
        normalizedItems.push(item);

        if (normalizedItems.length >= limit) {
          break;
        }
      }

      continue;
    }

    queue.push(...getNestedRelatedNodes(candidate));
  }

  return normalizedItems;
};

export const createChannelFeedData = (
  requestedChannelId: string,
  tab: ChannelFeedData['tab'],
  source: unknown,
  limit: number,
  continuation: string | null,
): ChannelFeedData => {
  return {
    id: requestedChannelId,
    tab,
    hasContinuation: continuation !== null,
    continuation,
    items: collectChannelFeedItems(
      getChannelFeedNodesFromSource(source, tab),
      limit,
    ),
  };
};

const normalizeDiscoveryOptionNode = (
  node: unknown,
): DiscoveryFeedOption | null => {
  if (node instanceof YTNodes.ChipCloudChip) {
    const label = node.text.toString().trim();

    if (!label) {
      return null;
    }

    return {
      id: label,
      label,
      selected: node.is_selected,
    };
  }

  if (node instanceof YTNodes.SubFeedOption) {
    const label = node.name.toString().trim();

    if (!label) {
      return null;
    }

    return {
      id: label,
      label,
      selected: node.is_selected,
    };
  }

  return null;
};

export const createDiscoveryFeedOptions = (
  source: unknown,
  optionType: DiscoveryOptionType,
): DiscoveryFeedOption[] => {
  const memo = getMergedMemoLike(source);

  if (!memo) {
    return [];
  }

  const rawOptions = optionType === 'filter'
    ? memo.getType(YTNodes.ChipCloudChip)
    : memo.getType(YTNodes.SubFeedOption);

  return rawOptions
    .map((option) => normalizeDiscoveryOptionNode(option))
    .filter((option): option is DiscoveryFeedOption => option !== null);
};

interface DiscoveryFeedSourceLike {
  shelves?: readonly unknown[];
  videos?: readonly unknown[];
  playlists?: readonly unknown[];
  channels?: readonly unknown[];
  has_continuation?: boolean;
}

const getDiscoverySectionItems = (shelf: unknown): RelatedItem[] => {
  if (shelf instanceof YTNodes.Shelf) {
    return collectChannelFeedItems(shelf.content ? [shelf.content] : [], Number.MAX_SAFE_INTEGER);
  }

  if (shelf instanceof YTNodes.RichShelf || shelf instanceof YTNodes.ReelShelf) {
    return collectChannelFeedItems([...shelf.contents], Number.MAX_SAFE_INTEGER);
  }

  return [];
};

const normalizeDiscoverySection = (
  shelf: unknown,
): DiscoveryFeedSection | null => {
  const items = getDiscoverySectionItems(shelf);

  if (items.length === 0) {
    return null;
  }

  if (
    shelf instanceof YTNodes.Shelf ||
    shelf instanceof YTNodes.RichShelf ||
    shelf instanceof YTNodes.ReelShelf
  ) {
    return {
      title: toText(shelf.title),
      subtitle: 'subtitle' in shelf ? toText(shelf.subtitle) : null,
      items,
    };
  }

  return {
    title: null,
    subtitle: null,
    items,
  };
};

const collectDiscoverySections = (
  source: DiscoveryFeedSourceLike,
): DiscoveryFeedSection[] => {
  const shelfSections = (source.shelves ?? [])
    .map((shelf) => normalizeDiscoverySection(shelf))
    .filter((section): section is DiscoveryFeedSection => section !== null);

  if (shelfSections.length > 0) {
    return shelfSections;
  }

  const fallbackItems = collectChannelFeedItems(
    [
      ...(source.videos ?? []),
      ...(source.playlists ?? []),
      ...(source.channels ?? []),
    ],
    Number.MAX_SAFE_INTEGER,
  );

  if (fallbackItems.length === 0) {
    return [];
  }

  return [{
    title: null,
    subtitle: null,
    items: fallbackItems,
  }];
};

const flattenDiscoveryItems = (
  sections: readonly DiscoveryFeedSection[],
): RelatedItem[] => {
  const flattened: RelatedItem[] = [];
  const seenKeys = new Set<string>();

  for (const section of sections) {
    for (const item of section.items) {
      const key = item.kind + ':' + item.id;

      if (seenKeys.has(key)) {
        continue;
      }

      seenKeys.add(key);
      flattened.push(item);
    }
  }

  return flattened;
};

export const createDiscoveryFeedData = (
  feedId: DiscoveryFeedKind,
  title: string | null,
  optionType: DiscoveryOptionType,
  options: DiscoveryFeedOption[],
  source: DiscoveryFeedSourceLike,
  continuation: string | null,
): DiscoveryFeedData => {
  const sections = collectDiscoverySections(source);

  return {
    id: feedId,
    title,
    optionType,
    options,
    hasContinuation: continuation !== null || Boolean(source.has_continuation),
    continuation,
    sections,
    items: flattenDiscoveryItems(sections),
  };
};

const createBrowseOptions = (
  items: Array<{ title: string; selected: boolean }>,
): DiscoveryFeedOption[] => {
  return items
    .map((item) => {
      const label = item.title.trim();

      if (!label) {
        return null;
      }

      return {
        id: label,
        label,
        selected: item.selected,
      } satisfies DiscoveryFeedOption;
    })
    .filter((item): item is DiscoveryFeedOption => item !== null);
};

export const createChannelSearchSortOptions = (
  source: unknown,
): DiscoveryFeedOption[] => {
  const memo = getMergedMemoLike(source);

  if (!memo) {
    return [];
  }

  const submenu = memo.getType(YTNodes.SortFilterSubMenu)[0] as {
    sub_menu_items?: Array<{ title: string; selected: boolean }>;
  } | undefined;

  return createBrowseOptions(submenu?.sub_menu_items ?? []);
};

export const createChannelSearchContentTypeOptions = (
  source: unknown,
): DiscoveryFeedOption[] => {
  const memo = getMergedMemoLike(source);

  if (!memo) {
    return [];
  }

  const submenu = memo.getType(YTNodes.ChannelSubMenu)[0] as {
    content_type_sub_menu_items?: Array<{ title: string; selected: boolean }>;
  } | undefined;

  return createBrowseOptions(submenu?.content_type_sub_menu_items ?? []);
};

export const createChannelBrowseData = (
  requestedChannelId: string,
  mode: ChannelBrowseMode,
  title: string | null,
  query: string | null,
  filterOptions: DiscoveryFeedOption[],
  sortOptions: DiscoveryFeedOption[],
  contentTypeOptions: DiscoveryFeedOption[],
  source: DiscoveryFeedSourceLike,
  continuation: string | null,
): ChannelBrowseData => {
  const sections = collectDiscoverySections(source);

  return {
    id: requestedChannelId,
    mode,
    title,
    query,
    filterOptions,
    sortOptions,
    contentTypeOptions,
    hasContinuation: continuation !== null || Boolean(source.has_continuation),
    continuation,
    sections,
    items: flattenDiscoveryItems(sections),
  };
};

export const createVideoRelatedData = (
  requestedVideoId: string,
  info: DetailedVideoInfo,
  limit: number,
): VideoRelatedData => {
  return {
    id: info.basic_info.id ?? requestedVideoId,
    filters: [...info.filters],
    hasContinuation: info.wn_has_continuation,
    autoplayVideoId: getEndpointVideoId(info.autoplay_video_endpoint),
    items: collectRelatedItems(info.watch_next_feed ?? [], requestedVideoId, limit),
  };
};




const buildCommunityPostEndpointPath = (channelId: string, postId: string): string => {
  return '/v1/channels/' + encodeURIComponent(channelId) + '/posts/' + encodeURIComponent(postId);
};

const buildCommunityPostCommentsEndpointPath = (channelId: string, postId: string): string => {
  return buildCommunityPostEndpointPath(channelId, postId) + '/comments';
};

const getCommunityPostLikeCountText = (node: CommunityPostNode): string | null => {
  if (!(node instanceof YTNodes.BackstagePost || node instanceof YTNodes.Post)) {
    return null;
  }

  return (
    node.action_buttons?.like_button?.short_like_count ??
    toText(node.action_buttons?.like_button?.like_count)
  );
};

const getCommunityPostReplyCountText = (node: CommunityPostNode): string | null => {
  if (!(node instanceof YTNodes.BackstagePost || node instanceof YTNodes.Post)) {
    return null;
  }

  return (
    toText(node.action_buttons?.reply_button?.text) ??
    toText(node.action_buttons?.reply_button?.label)
  );
};

const createCommunityPostImageAttachment = (
  images: Array<{ thumbnails: Thumbnail[]; url: string | null }>,
): CommunityPostPreview['attachment'] => {
  if (images.length === 0) {
    return null;
  }

  return {
    kind: 'image',
    images,
  };
};

const normalizeCommunityPostAttachment = (
  attachment: unknown,
): CommunityPostPreview['attachment'] => {
  if (!attachment) {
    return null;
  }

  if (attachment instanceof YTNodes.BackstageImage) {
    return createCommunityPostImageAttachment([{
      thumbnails: toThumbnailList(attachment.image),
      url: getEndpointUrl(attachment.endpoint),
    }]);
  }

  if (attachment instanceof YTNodes.PostMultiImage) {
    return createCommunityPostImageAttachment(
      attachment.images.map((image) => ({
        thumbnails: toThumbnailList(image.image),
        url: getEndpointUrl(image.endpoint),
      })),
    );
  }

  if (attachment instanceof YTNodes.Poll) {
    return {
      kind: 'poll',
      totalVotesText: toText(attachment.total_votes),
      choices: attachment.choices.map((choice) => ({
        text: toText(choice.text),
        image: toThumbnailList(choice.image),
        voteRatio: choice.vote_ratio_if_selected ?? choice.vote_ratio_if_not_selected ?? null,
        votePercentageText:
          toText(choice.vote_percentage_if_selected) ??
          toText(choice.vote_percentage_if_not_selected),
      })),
    };
  }

  const contentItems = normalizeRelatedNode(attachment);
  if (contentItems.length > 0) {
    return {
      kind: 'content',
      items: contentItems,
    };
  }

  return {
    kind: 'unknown',
  };
};

const normalizeCommunityPostPreview = (
  channelId: string,
  node: CommunityPostNode,
): CommunityPostPreview => {
  const isSharedPost = node instanceof YTNodes.SharedPost;
  const sharedOriginalPost = isSharedPost ? node.original_post : null;
  const sharedThumbnailAttachment =
    isSharedPost && node.thumbnail.length > 0
      ? createCommunityPostImageAttachment([{
          thumbnails: toThumbnailList(node.thumbnail),
          url: getEndpointUrl(node.endpoint),
        }])
      : null;

  const attachment = isSharedPost
    ? normalizeCommunityPostAttachment(sharedOriginalPost?.attachment) ?? sharedThumbnailAttachment
    : normalizeCommunityPostAttachment(node.attachment);

  return {
    kind: isSharedPost ? 'shared_post' : 'post',
    id: node.id,
    content: toText(node.content),
    publishedText: toText(node.published),
    author: toChannelSummary(node.author),
    likeCountText: getCommunityPostLikeCountText(node),
    replyCountText: getCommunityPostReplyCountText(node),
    attachment,
  };
};

const normalizeCommunityPostItem = (
  channelId: string,
  node: CommunityPostNode,
): CommunityPostItem => {
  const preview = normalizeCommunityPostPreview(channelId, node);
  const originalPost = node instanceof YTNodes.SharedPost && node.original_post
    ? normalizeCommunityPostPreview(channelId, node.original_post)
    : null;

  return {
    ...preview,
    surface:
      node instanceof YTNodes.BackstagePost || node instanceof YTNodes.Post
        ? node.surface
        : null,
    postEndpoint: buildCommunityPostEndpointPath(channelId, node.id),
    commentsEndpoint: buildCommunityPostCommentsEndpointPath(channelId, node.id),
    originalPost,
  };
};

const getCommunityPostNodesFromSource = (value: unknown): CommunityPostNode[] => {
  const memo = getMergedMemoLike(value);

  if (!memo) {
    return [];
  }

  return memo.getType(
    YTNodes.BackstagePost,
    YTNodes.Post,
    YTNodes.SharedPost,
  ) as CommunityPostNode[];
};

const collectCommunityPostItems = (
  items: readonly CommunityPostNode[],
  channelId: string,
  limit: number,
): CommunityPostItem[] => {
  const normalizedItems: CommunityPostItem[] = [];
  const seenIds = new Set<string>();

  for (const item of items) {
    if (!item?.id || seenIds.has(item.id)) {
      continue;
    }

    seenIds.add(item.id);
    normalizedItems.push(normalizeCommunityPostItem(channelId, item));

    if (normalizedItems.length >= limit) {
      break;
    }
  }

  return normalizedItems;
};

export const createCommunityPostsData = (
  requestedChannelId: string,
  source: unknown,
  limit: number,
  continuation: string | null,
): CommunityPostsData => {
  return {
    id: requestedChannelId,
    hasContinuation: continuation !== null,
    continuation,
    items: collectCommunityPostItems(
      getCommunityPostNodesFromSource(source),
      requestedChannelId,
      limit,
    ),
  };
};

export const createCommunityPostData = (
  requestedChannelId: string,
  requestedPostId: string,
  source: unknown,
): CommunityPostData | null => {
  const item = collectCommunityPostItems(
    getCommunityPostNodesFromSource(source),
    requestedChannelId,
    Number.MAX_SAFE_INTEGER,
  ).find((candidate) => candidate.id === requestedPostId);

  if (!item) {
    return null;
  }

  return {
    channelId: requestedChannelId,
    item,
  };
};

export const createCommunityPostCommentsData = (
  requestedChannelId: string,
  requestedPostId: string,
  comments: CommentsFeed,
  fallbackSort: CommentSort,
  limit: number,
): CommunityPostCommentsData => {
  const availableSorts = toCommentSortOptions(
    comments.header?.sort_menu?.sub_menu_items ?? [],
    fallbackSort,
  );
  const continuation = getContinuationTokenFromMemoSource(comments.page);

  return {
    channelId: requestedChannelId,
    postId: requestedPostId,
    title: toText(comments.header?.title),
    countText: toText(comments.header?.count),
    commentsCountText: toText(comments.header?.comments_count),
    sort: getSelectedCommentSort(availableSorts, fallbackSort),
    availableSorts,
    hasContinuation: continuation !== null,
    continuation,
    items: collectCommentItems(comments.contents, limit),
  };
};

export const createCommunityPostCommentsContinuationData = (
  requestedChannelId: string,
  requestedPostId: string,
  response: unknown,
  sort: CommentSort,
  limit: number,
): CommunityPostCommentsData => {
  const memo = getMergedMemoLike(response);
  const threads = memo ? memo.getType(YTNodes.CommentThread) : [];
  const continuation = getContinuationTokenFromMemoSource(response);

  return {
    channelId: requestedChannelId,
    postId: requestedPostId,
    title: 'Comments',
    countText: null,
    commentsCountText: null,
    sort,
    availableSorts: [{
      id: sort,
      label: getCommentSortLabel(sort),
      selected: true,
    }],
    hasContinuation: continuation !== null,
    continuation,
    items: collectCommentItems(threads, limit),
  };
};

const getCommentSortLabel = (sort: CommentSort): string => {
  return sort === 'newest' ? 'Newest' : 'Top';
};

const toCommentSortId = (
  label: string | null,
  fallback: CommentSort,
): CommentSort => {
  if (label && /newest/i.test(label)) {
    return 'newest';
  }

  if (label && /top/i.test(label)) {
    return 'top';
  }

  return fallback;
};

const toCommentAuthorData = (value: unknown): CommentAuthor | null => {
  if (!isRecord(value)) {
    return null;
  }

  return {
    id: toText(value.id),
    name: toText(value.name),
    url: toText(value.url),
    thumbnails: toThumbnailList(value.thumbnails),
    isVerified: toBoolean(value.is_verified),
    isVerifiedArtist: toBoolean(value.is_verified_artist),
    isCurrentUser: toBoolean(value.is_current_user),
  };
};

const toCommentSortOptions = (
  items: readonly unknown[],
  fallbackSort: CommentSort,
): CommentSortOption[] => {
  const normalized = items.flatMap((item, index) => {
    if (!isRecord(item)) {
      return [];
    }

    const fallback = index === 1 ? 'newest' : 'top';
    const label = toText(item.title) ?? getCommentSortLabel(fallback);

    return [{
      id: toCommentSortId(label, fallback),
      label,
      selected: toBoolean(item.selected) ?? false,
    } satisfies CommentSortOption];
  });

  if (normalized.length > 0) {
    return normalized;
  }

  return [{
    id: fallbackSort,
    label: getCommentSortLabel(fallbackSort),
    selected: true,
  } satisfies CommentSortOption];
};

const getSelectedCommentSort = (
  options: readonly CommentSortOption[],
  fallbackSort: CommentSort,
): CommentSort => {
  return options.find((option) => option.selected)?.id ?? fallbackSort;
};

type MemoLike = {
  getType: (...types: unknown[]) => unknown[];
};

const memoFieldNames = [
  'contents_memo',
  'continuation_contents_memo',
  'on_response_received_commands_memo',
  'on_response_received_endpoints_memo',
  'on_response_received_actions_memo',
  'sidebar_memo',
  'header_memo',
] as const;

const getMergedMemoLike = (value: unknown): MemoLike | null => {
  if (!isRecord(value)) {
    return null;
  }

  const memos = memoFieldNames.flatMap((fieldName) => {
    const memo = value[fieldName];

    if (!isRecord(memo) || typeof memo.getType !== 'function') {
      return [];
    }

    return [memo as unknown as MemoLike];
  });

  if (memos.length === 0) {
    return null;
  }

  return {
    getType: (...types: unknown[]) => {
      return memos.flatMap((memo) => memo.getType(...types));
    },
  };
};

const findContinuationToken = (value: unknown): string | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.token === 'string') {
    const token = value.token.trim();
    return token.length > 0 ? token : null;
  }

  for (const nestedValue of Object.values(value)) {
    if (Array.isArray(nestedValue)) {
      for (const item of nestedValue) {
        const token = findContinuationToken(item);

        if (token) {
          return token;
        }
      }

      continue;
    }

    const token = findContinuationToken(nestedValue);

    if (token) {
      return token;
    }
  }

  return null;
};

export const getContinuationTokenFromMemoSource = (value: unknown): string | null => {
  const memo = getMergedMemoLike(value);

  if (!memo) {
    return null;
  }

  const continuationItem = memo.getType(YTNodes.ContinuationItem)[0];

  if (!isRecord(continuationItem) || !isRecord(continuationItem.endpoint)) {
    return null;
  }

  return findContinuationToken(continuationItem.endpoint.payload);
};

const normalizeCommentBase = (
  comment: InstanceType<typeof YTNodes.CommentView>,
): VideoCommentReplyItem => {
  return {
    id: comment.comment_id,
    content: toText(comment.content),
    publishedText: comment.published_time ?? null,
    likeCountText: comment.like_count ?? null,
    author: toCommentAuthorData(comment.author),
    isPinned: comment.is_pinned,
    isHearted: comment.is_hearted ?? false,
    isMember: comment.is_member ?? false,
    authorIsChannelOwner: comment.author_is_channel_owner ?? false,
  };
};

const normalizeCommentThread = (
  thread: InstanceType<typeof YTNodes.CommentThread>,
): VideoCommentItem | null => {
  const comment = thread.comment;

  if (!(comment instanceof YTNodes.CommentView)) {
    return null;
  }

  return {
    ...normalizeCommentBase(comment),
    replyCountText: comment.reply_count ?? null,
    hasReplies: thread.has_replies,
    canLoadReplies: !!thread.comment_replies_data?.view_replies,
    hasChannelOwnerReplied:
      thread.comment_replies_data?.has_channel_owner_replied ?? false,
  };
};

const collectCommentItems = (
  items: readonly unknown[],
  limit: number,
): VideoCommentItem[] => {
  const normalizedItems: VideoCommentItem[] = [];

  for (const item of items) {
    if (!(item instanceof YTNodes.CommentThread)) {
      continue;
    }

    const normalized = normalizeCommentThread(item);

    if (!normalized) {
      continue;
    }

    normalizedItems.push(normalized);

    if (normalizedItems.length >= limit) {
      break;
    }
  }

  return normalizedItems;
};

const collectCommentReplyItems = (
  items: readonly unknown[],
  limit: number,
): VideoCommentReplyItem[] => {
  const normalizedItems: VideoCommentReplyItem[] = [];

  for (const item of items) {
    if (!(item instanceof YTNodes.CommentView)) {
      continue;
    }

    normalizedItems.push(normalizeCommentBase(item));

    if (normalizedItems.length >= limit) {
      break;
    }
  }

  return normalizedItems;
};

export const createVideoCommentsData = (
  requestedVideoId: string,
  comments: CommentsFeed,
  fallbackSort: CommentSort,
  limit: number,
): VideoCommentsData => {
  const availableSorts = toCommentSortOptions(
    comments.header?.sort_menu?.sub_menu_items ?? [],
    fallbackSort,
  );
  const continuation = getContinuationTokenFromMemoSource(comments.page);

  return {
    id: requestedVideoId,
    title: toText(comments.header?.title),
    countText: toText(comments.header?.count),
    commentsCountText: toText(comments.header?.comments_count),
    sort: getSelectedCommentSort(availableSorts, fallbackSort),
    availableSorts,
    hasContinuation: continuation !== null,
    continuation,
    items: collectCommentItems(comments.contents, limit),
  };
};

export const createVideoCommentsContinuationData = (
  requestedVideoId: string,
  response: unknown,
  sort: CommentSort,
  limit: number,
): VideoCommentsData => {
  const memo = getMergedMemoLike(response);
  const threads = memo ? memo.getType(YTNodes.CommentThread) : [];
  const continuation = getContinuationTokenFromMemoSource(response);

  return {
    id: requestedVideoId,
    title: 'Comments',
    countText: null,
    commentsCountText: null,
    sort,
    availableSorts: [{
      id: sort,
      label: getCommentSortLabel(sort),
      selected: true,
    }],
    hasContinuation: continuation !== null,
    continuation,
    items: collectCommentItems(threads, limit),
  };
};

export const createVideoCommentRepliesData = (
  requestedVideoId: string,
  requestedCommentId: string,
  response: unknown,
  limit: number,
): VideoCommentRepliesData => {
  const memo = getMergedMemoLike(response);
  const replies = memo ? memo.getType(YTNodes.CommentView) : [];
  const continuation = getContinuationTokenFromMemoSource(response);

  return {
    id: requestedVideoId,
    commentId: requestedCommentId,
    hasContinuation: continuation !== null,
    continuation,
    items: collectCommentReplyItems(replies, limit),
  };
};










