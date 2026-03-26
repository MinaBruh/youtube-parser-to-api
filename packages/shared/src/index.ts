export type ServiceName = 'api' | 'media';

export const SEARCH_TYPES = [
  'all',
  'video',
  'shorts',
  'channel',
  'playlist',
  'movie',
] as const;

export const SEARCH_UPLOAD_DATES = [
  'all',
  'today',
  'week',
  'month',
  'year',
] as const;

export const SEARCH_DURATIONS = [
  'all',
  'under_three_mins',
  'three_to_twenty_mins',
  'over_twenty_mins',
] as const;

export const SEARCH_PRIORITIES = ['relevance', 'popularity'] as const;

export const SEARCH_FEATURES = [
  'hd',
  'subtitles',
  'creative_commons',
  '3d',
  'live',
  'purchased',
  '4k',
  '360',
  'location',
  'hdr',
  'vr180',
] as const;

export const COMMENT_SORTS = ['top', 'newest'] as const;
export const CHANNEL_FEED_TABS = ['videos', 'shorts', 'streams', 'playlists'] as const;

export type SearchType = (typeof SEARCH_TYPES)[number];
export type SearchUploadDate = (typeof SEARCH_UPLOAD_DATES)[number];
export type SearchDuration = (typeof SEARCH_DURATIONS)[number];
export type SearchPriority = (typeof SEARCH_PRIORITIES)[number];
export type SearchFeature = (typeof SEARCH_FEATURES)[number];
export type CommentSort = (typeof COMMENT_SORTS)[number];
export type ChannelFeedTab = (typeof CHANNEL_FEED_TABS)[number];
export type RecommendedPlaybackMode = 'streams' | 'hls-manifest' | 'dash-manifest';
export type VideoLifecycle = 'vod' | 'upcoming' | 'premiere-upcoming' | 'live' | 'live-dvr' | 'post-live-dvr';
export type DiscoveryFeedKind = 'home' | 'explore' | 'trending';
export type DiscoveryOptionType = 'filter' | 'tab';

export interface HealthPayload {
  ok: true;
  service: ServiceName;
  timestamp: string;
}

export interface SuccessPayload<T> {
  ok: true;
  data: T;
}

export interface ErrorPayload {
  ok: false;
  statusCode: number;
  message: string;
  details?: string[];
  nextSteps?: string[];
}

export interface Thumbnail {
  url: string;
  proxyUrl?: string | null;
  width: number;
  height: number;
}

export interface ChannelSummary {
  id: string | null;
  name: string;
  url: string | null;
  thumbnails: Thumbnail[];
  subscriberCountText: string | null;
  videoCountText: string | null;
  verified: boolean | null;
}

export interface SearchVideoItem {
  kind: 'video' | 'movie' | 'shorts';
  id: string;
  title: string;
  description: string | null;
  thumbnails: Thumbnail[];
  durationText: string | null;
  durationSeconds: number | null;
  channel: ChannelSummary | null;
  viewCountText: string | null;
  publishedText: string | null;
  isLive: boolean;
  isUpcoming: boolean;
  isPremiere: boolean;
  scheduledStartTime: string | null;
  liveLifecycle: VideoLifecycle;
}

export interface SearchChannelItem {
  kind: 'channel';
  id: string;
  title: string;
  description: string | null;
  thumbnails: Thumbnail[];
  subscriberCountText: string | null;
  videoCountText: string | null;
  verified: boolean | null;
}

export interface SearchPlaylistItem {
  kind: 'playlist';
  id: string;
  title: string;
  thumbnails: Thumbnail[];
  videoCountText: string | null;
  channel: ChannelSummary | null;
}

export type SearchResultItem =
  | SearchVideoItem
  | SearchChannelItem
  | SearchPlaylistItem;

export interface SearchFilters {
  type?: Exclude<SearchType, 'all'>;
  uploadDate?: Exclude<SearchUploadDate, 'all'>;
  duration?: Exclude<SearchDuration, 'all'>;
  prioritize?: SearchPriority;
  features: SearchFeature[];
  limit: number;
}

export interface SearchResponseData {
  query: string;
  estimatedResults: number;
  appliedFilters: SearchFilters;
  hasContinuation: boolean;
  continuation: string | null;
  items: SearchResultItem[];
}

export interface VideoDetailsData {
  id: string;
  title: string | null;
  description: string | null;
  thumbnails: Thumbnail[];
  channel: ChannelSummary | null;
  durationSeconds: number | null;
  viewCount: number | null;
  tags: string[];
  category: string | null;
  canonicalUrl: string | null;
  embedUrl: string | null;
  playabilityStatus: string | null;
  playabilityReason: string | null;
  playbackEndpoint: string;
  storyboardsEndpoint: string;
  isShorts: boolean;
  isLive: boolean;
  isUpcoming: boolean;
  isPremiere: boolean;
  isLiveContent: boolean;
  isLiveDvrEnabled: boolean;
  isPostLiveDvr: boolean;
  isLowLatencyLiveStream: boolean;
  liveLifecycle: VideoLifecycle;
  scheduledStartTime: string | null;
  endedAt: string | null;
  isUnlisted: boolean | null;
  isFamilySafe: boolean | null;
}

export interface PlaybackManifestUrls {
  dashProxyUrl: string | null;
  hlsProxyUrl: string | null;
  upstreamDashProxyUrl: string | null;
  upstreamHlsProxyUrl: string | null;
}

export type PlaybackStreamRole = 'muxed' | 'audio' | 'video';
export type PlaybackStrategy = 'muxed-stream' | 'adaptive-pair' | 'dash-manifest' | 'hls-manifest';

export interface PlaybackStream {
  itag: number;
  mimeType: string;
  container: string;
  codecs: string | null;
  quality: string | null;
  qualityLabel: string | null;
  audioQuality: string | null;
  bitrate: number;
  averageBitrate: number | null;
  contentLength: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
  isAdaptive: boolean;
  role: PlaybackStreamRole;
  language: string | null;
  audioTrackId: string | null;
  audioTrackName: string | null;
  isDefaultAudioTrack: boolean | null;
  audioChannels: number | null;
  audioSampleRate: number | null;
  isDrc: boolean | null;
  proxyUrl: string;
}

export interface PlaybackQualityOption {
  id: string;
  label: string;
  quality: string | null;
  qualityLabel: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasMuxedStream: boolean;
  hasAdaptiveStream: boolean;
  muxedItag: number | null;
  videoOnlyItag: number | null;
}

export interface PlaybackAudioTrackOption {
  id: string;
  label: string;
  language: string | null;
  isDefault: boolean;
  streamCount: number;
  audioOnlyItag: number | null;
  muxedItag: number | null;
}

export interface PlaybackAdaptivePair {
  id: string;
  qualityId: string | null;
  qualityLabel: string | null;
  videoItag: number;
  audioItag: number;
  audioTrackId: string | null;
  audioTrackName: string | null;
  bitrate: number;
  videoProxyUrl: string;
  audioProxyUrl: string;
}

export interface PlaybackDefaultSelection {
  strategy: PlaybackStrategy;
  qualityId: string | null;
  audioTrackId: string | null;
  muxedItag: number | null;
  videoItag: number | null;
  audioItag: number | null;
  manifestProxyUrl: string | null;
}

export interface VideoPlaybackData {
  id: string;
  playbackEndpoint: string;
  durationSeconds: number | null;
  isShorts: boolean;
  isLive: boolean;
  isUpcoming: boolean;
  isPremiere: boolean;
  isLiveContent: boolean;
  isLiveDvrEnabled: boolean;
  isPostLiveDvr: boolean;
  isLowLatencyLiveStream: boolean;
  liveLifecycle: VideoLifecycle;
  scheduledStartTime: string | null;
  endedAt: string | null;
  recommendedPlaybackMode: RecommendedPlaybackMode;
  playabilityStatus: string | null;
  playabilityReason: string | null;
  manifests: PlaybackManifestUrls;
  streams: PlaybackStream[];
  muxedStreams: PlaybackStream[];
  audioOnlyStreams: PlaybackStream[];
  videoOnlyStreams: PlaybackStream[];
  qualityOptions: PlaybackQualityOption[];
  audioTracks: PlaybackAudioTrackOption[];
  adaptivePairs: PlaybackAdaptivePair[];
  defaultSelection: PlaybackDefaultSelection | null;
  fallbackOrder: PlaybackStrategy[];
  unresolvedFormatsCount: number;
}

export interface VideoStoryboardVariant {
  id: string;
  mimeType: string | null;
  thumbnailWidth: number;
  thumbnailHeight: number;
  sheetWidth: number;
  sheetHeight: number;
  rows: number;
  columns: number;
  sheetCount: number;
  sheetDurationSeconds: number | null;
  sheetProxyUrlTemplate: string;
  firstSheetProxyUrl: string;
}

export interface VideoStoryboardsData {
  id: string;
  available: boolean;
  durationSeconds: number | null;
  variants: VideoStoryboardVariant[];
}
export interface ChannelLink {
  title: string;
  url: string;
  thumbnails: Thumbnail[];
}

export interface ChannelCapabilities {
  hasHome: boolean;
  hasVideos: boolean;
  hasShorts: boolean;
  hasLiveStreams: boolean;
  hasReleases: boolean;
  hasPodcasts: boolean;
  hasCourses: boolean;
  hasPlaylists: boolean;
  hasCommunity: boolean;
  hasSearch: boolean;
  hasAbout: boolean;
}

export interface ChannelDetailsData {
  id: string;
  title: string | null;
  handle: string | null;
  description: string | null;
  country: string | null;
  joinedDateText: string | null;
  subscriberCountText: string | null;
  viewCountText: string | null;
  videoCountText: string | null;
  canonicalUrl: string | null;
  rssUrl: string | null;
  vanityChannelUrl: string | null;
  avatar: Thumbnail[];
  banner: Thumbnail[];
  tabs: string[];
  capabilities: ChannelCapabilities;
  links: ChannelLink[];
  tags: string[];
  availableCountries: string[];
  isFamilySafe: boolean | null;
  isUnlisted: boolean | null;
}

export interface PlaylistEntry {
  kind: 'video' | 'shorts';
  id: string;
  title: string;
  thumbnails: Thumbnail[];
  indexText: string | null;
  durationText: string | null;
  durationSeconds: number | null;
  channel: ChannelSummary | null;
  videoInfoText: string | null;
  isPlayable: boolean;
  isLive: boolean;
  isUpcoming: boolean;
  isPremiere: boolean;
  scheduledStartTime: string | null;
  liveLifecycle: VideoLifecycle;
}
export interface PlaylistDetailsData {
  id: string;
  title: string | null;
  description: string | null;
  subtitle: string | null;
  canonicalUrl: string | null;
  thumbnails: Thumbnail[];
  channel: ChannelSummary | null;
  totalItemsText: string | null;
  viewCountText: string | null;
  lastUpdatedText: string | null;
  privacy: string | null;
  canShare: boolean;
  canDelete: boolean;
  canReorder: boolean;
  isEditable: boolean;
  hasContinuation: boolean;
  continuation: string | null;
  items: PlaylistEntry[];
}
export interface RelatedItem {
  kind: 'video' | 'playlist' | 'channel' | 'shorts' | 'movie';
  id: string;
  title: string;
  thumbnails: Thumbnail[];
  channel: ChannelSummary | null;
  bylineText: string | null;
  viewCountText: string | null;
  publishedText: string | null;
  durationText: string | null;
  durationSeconds: number | null;
  videoCountText: string | null;
  subscriberCountText: string | null;
  isLive: boolean;
  isUpcoming: boolean;
  isPremiere: boolean;
  scheduledStartTime: string | null;
  liveLifecycle: VideoLifecycle;
}

export interface ChannelFeedData {
  id: string;
  tab: ChannelFeedTab;
  hasContinuation: boolean;
  continuation: string | null;
  items: RelatedItem[];
}

export interface VideoRelatedData {
  id: string;
  filters: string[];
  hasContinuation: boolean;
  autoplayVideoId: string | null;
  items: RelatedItem[];
}

export interface CommunityPostAttachmentImage {
  thumbnails: Thumbnail[];
  url: string | null;
}

export interface CommunityPostPollChoice {
  text: string | null;
  image: Thumbnail[];
  voteRatio: number | null;
  votePercentageText: string | null;
}

export interface CommunityPostImageAttachment {
  kind: 'image';
  images: CommunityPostAttachmentImage[];
}

export interface CommunityPostPollAttachment {
  kind: 'poll';
  totalVotesText: string | null;
  choices: CommunityPostPollChoice[];
}

export interface CommunityPostContentAttachment {
  kind: 'content';
  items: RelatedItem[];
}

export interface CommunityPostUnknownAttachment {
  kind: 'unknown';
}

export type CommunityPostAttachment =
  | CommunityPostImageAttachment
  | CommunityPostPollAttachment
  | CommunityPostContentAttachment
  | CommunityPostUnknownAttachment;

export interface CommunityPostPreview {
  kind: 'post' | 'shared_post';
  id: string;
  content: string | null;
  publishedText: string | null;
  author: ChannelSummary | null;
  likeCountText: string | null;
  replyCountText: string | null;
  attachment: CommunityPostAttachment | null;
}

export interface CommunityPostItem extends CommunityPostPreview {
  surface: string | null;
  postEndpoint: string;
  commentsEndpoint: string;
  originalPost: CommunityPostPreview | null;
}

export interface CommunityPostsData {
  id: string;
  hasContinuation: boolean;
  continuation: string | null;
  items: CommunityPostItem[];
}

export interface CommunityPostData {
  channelId: string;
  item: CommunityPostItem;
}

export interface CommunityPostCommentsData {
  channelId: string;
  postId: string;
  title: string | null;
  countText: string | null;
  commentsCountText: string | null;
  sort: CommentSort;
  availableSorts: CommentSortOption[];
  hasContinuation: boolean;
  continuation: string | null;
  items: VideoCommentItem[];
}

export interface CommentAuthor {
  id: string | null;
  name: string | null;
  url: string | null;
  thumbnails: Thumbnail[];
  isVerified: boolean | null;
  isVerifiedArtist: boolean | null;
  isCurrentUser: boolean | null;
}

export interface CommentSortOption {
  id: CommentSort;
  label: string;
  selected: boolean;
}

export interface VideoCommentItem {
  id: string;
  content: string | null;
  publishedText: string | null;
  likeCountText: string | null;
  replyCountText: string | null;
  author: CommentAuthor | null;
  isPinned: boolean;
  isHearted: boolean;
  isMember: boolean;
  authorIsChannelOwner: boolean;
  hasReplies: boolean;
  canLoadReplies: boolean;
  hasChannelOwnerReplied: boolean;
}

export interface VideoCommentReplyItem {
  id: string;
  content: string | null;
  publishedText: string | null;
  likeCountText: string | null;
  author: CommentAuthor | null;
  isPinned: boolean;
  isHearted: boolean;
  isMember: boolean;
  authorIsChannelOwner: boolean;
}

export interface VideoCommentRepliesData {
  id: string;
  commentId: string;
  hasContinuation: boolean;
  continuation: string | null;
  items: VideoCommentReplyItem[];
}

export interface VideoCommentsData {
  id: string;
  title: string | null;
  countText: string | null;
  commentsCountText: string | null;
  sort: CommentSort;
  availableSorts: CommentSortOption[];
  hasContinuation: boolean;
  continuation: string | null;
  items: VideoCommentItem[];
}

export interface CaptionTrackUrls {
  rawProxyUrl: string;
  vttProxyUrl: string;
  ttmlProxyUrl: string;
  srv3ProxyUrl: string;
  json3ProxyUrl: string;
}

export interface CaptionTranslationLanguage {
  languageCode: string;
  languageName: string;
}

export interface CaptionTrack {
  id: string;
  vssId: string;
  name: string;
  languageCode: string;
  kind: 'asr' | 'frc' | null;
  isAutoGenerated: boolean;
  isTranslatable: boolean;
  urls: CaptionTrackUrls;
}

export interface VideoCaptionsData {
  id: string;
  hasCaptions: boolean;
  defaultTrackId: string | null;
  translationLanguages: CaptionTranslationLanguage[];
  tracks: CaptionTrack[];
}

export interface TranscriptSegmentData {
  startMs: number;
  endMs: number;
  startText: string;
  text: string;
  targetId: string | null;
}

export interface VideoTranscriptData {
  id: string;
  available: boolean;
  source: 'transcript_panel' | 'unavailable';
  requestedLanguage: string | null;
  selectedLanguage: string | null;
  languages: string[];
  unavailableReason: string | null;
  segmentCount: number;
  segments: TranscriptSegmentData[];
}

export interface DiscoveryFeedOption {
  id: string;
  label: string;
  selected: boolean;
}

export interface DiscoveryFeedSection {
  title: string | null;
  subtitle: string | null;
  items: RelatedItem[];
}

export interface DiscoveryFeedData {
  id: DiscoveryFeedKind;
  title: string | null;
  optionType: DiscoveryOptionType;
  options: DiscoveryFeedOption[];
  hasContinuation: boolean;
  continuation: string | null;
  sections: DiscoveryFeedSection[];
  items: RelatedItem[];
}

export type RecommendationFeedReason =
  | 'watch-history'
  | 'search-history'
  | 'mixed-history'
  | 'fallback-discovery';

export interface RecommendationProfileSummary {
  hasHistory: boolean;
  trackedSearchCount: number;
  trackedWatchCount: number;
  topSearches: string[];
  topWatchedTitles: string[];
  updatedAt: string | null;
}

export interface RecommendationFeedData {
  id: 'recommendations';
  title: string;
  subtitle: string | null;
  reason: RecommendationFeedReason;
  profile: RecommendationProfileSummary;
  hasContinuation: boolean;
  continuation: string | null;
  items: RelatedItem[];
}

export type ChannelBrowseMode = 'home' | 'search';

export interface ChannelBrowseData {
  id: string;
  mode: ChannelBrowseMode;
  title: string | null;
  query: string | null;
  filterOptions: DiscoveryFeedOption[];
  sortOptions: DiscoveryFeedOption[];
  contentTypeOptions: DiscoveryFeedOption[];
  hasContinuation: boolean;
  continuation: string | null;
  sections: DiscoveryFeedSection[];
  items: RelatedItem[];
}

export interface VideoWatchData {
  id: string;
  details: VideoDetailsData;
  playback: VideoPlaybackData;
  storyboards: VideoStoryboardsData;
  captions: VideoCaptionsData;
  transcript: VideoTranscriptData;
  related: VideoRelatedData;
  comments: VideoCommentsData;
  warnings: string[];
}

export const DEFAULT_PORTS: Record<ServiceName, number> = {
  api: 3000,
  media: 3001,
};

export const getDefaultPort = (service: ServiceName): number => {
  return DEFAULT_PORTS[service];
};

export const createHealthPayload = (service: ServiceName): HealthPayload => {
  return {
    ok: true,
    service,
    timestamp: new Date().toISOString(),
  };
};

export const createSuccessPayload = <T>(data: T): SuccessPayload<T> => {
  return {
    ok: true,
    data,
  };
};

export const createErrorPayload = (
  statusCode: number,
  message: string,
  details?: string[],
): ErrorPayload => {
  return {
    ok: false,
    statusCode,
    message,
    details,
  };
};

export const createNotImplementedPayload = (
  message: string,
  nextSteps: string[],
): ErrorPayload => {
  return {
    ok: false,
    statusCode: 501,
    message,
    nextSteps,
  };
};

export * from './rate-limit.js';
export * from './resilience.js';
export * from './redis.js';

