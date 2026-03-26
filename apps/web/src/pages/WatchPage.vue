<template>
  <main class="watch-page page-frame">
    <section class="watch-main-column">
      <section v-if="isLoading" class="panel-card loading-card watch-panel">
        <p>Loading watch page...</p>
      </section>

      <section v-else-if="errorMessage" class="panel-card error-card watch-panel">
        <h2>Video unavailable</h2>
        <p>{{ errorMessage }}</p>
      </section>

      <template v-else-if="watchData && commentsData && relatedFeed">
        <section class="watch-panel watch-stage-card">
          <ClassicPlayer
            ref="playerRef"
            :details="watchData.details"
            :playback="watchData.playback"
            :captions="watchData.captions"
            @ended="handlePlayerEnded"
          />

          <div v-if="watchWarningItems.length" class="watch-warning-strip">
            <span class="watch-warning-strip__label">Playback notes</span>
            <ul class="watch-warning-strip__list">
              <li v-for="warning in watchWarningItems" :key="warning">{{ warning }}</li>
            </ul>
          </div>
        </section>

        <section class="panel-card watch-meta-card watch-card-2014">
          <header class="watch-heading-block">
            <div>
              <h1 class="watch-title">{{ watchData.details.title }}</h1>
              <div class="watch-title-badges">
                <span v-for="badge in watchStatusBadges" :key="badge" class="watch-title-badge">{{ badge }}</span>
              </div>
            </div>

            <div class="watch-stats-block watch-stats-block--hero">
              <p class="watch-stats-block__views">{{ viewsLabel }}</p>
              <p class="watch-stats-block__meta">{{ publishMeta }}</p>
            </div>
          </header>

          <div class="watch-engagement-meter">
            <div class="watch-engagement-meter__bar"></div>
            <div class="watch-engagement-meter__meta">
              <span>{{ watchData.playback.recommendedPlaybackMode.replace('-', ' ') }}</span>
              <span>{{ qualitySummaryLabel }}</span>
              <span>{{ captionsSummaryLabel }}</span>
            </div>
          </div>

          <div class="watch-channel-row watch-channel-row--legacy">
            <div class="watch-channel-row__identity">
              <img
                class="watch-channel-row__avatar"
                :src="channelAvatar"
                :alt="watchData.details.channel?.name ?? 'Channel avatar'"
              />
              <div>
                <p class="watch-channel-row__name">
                  {{ watchData.details.channel?.name ?? 'Unknown channel' }}
                  <span v-if="watchData.details.channel?.verified" class="watch-inline-verified">Verified</span>
                </p>
                <p class="watch-channel-row__meta">{{ channelMeta }}</p>
                <p class="watch-channel-row__submeta">{{ channelDetailMeta }}</p>
              </div>
            </div>

            <div class="watch-channel-row__actions">
              <button class="watch-subscribe-button" type="button">
                Subscribe
                <strong v-if="watchData.details.channel?.subscriberCountText">{{ watchData.details.channel.subscriberCountText }}</strong>
              </button>
              <RouterLink
                v-if="watchData.details.channel?.id"
                class="watch-action-button"
                :to="{ path: `/channel/${watchData.details.channel.id}` }"
              >
                Channel
              </RouterLink>
            </div>
          </div>

          <div class="watch-actions-row watch-actions-row--legacy">
            <button class="watch-action-button" type="button" @click="activeMetaTab = 'description'">+ Add to</button>
            <button class="watch-action-button" type="button" @click="activeMetaTab = 'technical'">Share</button>
            <button class="watch-action-button" type="button" :disabled="!watchData.transcript.available" @click="activeMetaTab = 'transcript'">Transcript</button>
            <button class="watch-action-button" type="button" @click="activeMetaTab = 'warnings'">More</button>
          </div>

          <div class="watch-utility-tabs">
            <button
              v-for="tab in metaTabs"
              :key="tab.id"
              class="watch-utility-tab"
              :class="{ 'is-active': activeMetaTab === tab.id }"
              type="button"
              @click="activeMetaTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>

          <div class="watch-utility-panel">
            <template v-if="activeMetaTab === 'description'">
              <div class="watch-description">
                <p>{{ displayedDescription }}</p>
                <div v-if="watchData.details.tags.length" class="watch-tag-row">
                  <span v-for="tag in watchData.details.tags.slice(0, 10)" :key="tag" class="watch-tag-chip">{{ tag }}</span>
                </div>
                <button
                  v-if="canExpandDescription"
                  class="watch-expand-button"
                  type="button"
                  @click="isDescriptionExpanded = !isDescriptionExpanded"
                >
                  {{ isDescriptionExpanded ? 'Show less' : 'Show more' }}
                </button>
              </div>
            </template>

            <template v-else-if="activeMetaTab === 'transcript'">
              <div v-if="watchData.transcript.available && watchData.transcript.segments.length" class="watch-transcript-panel">
                <button
                  v-for="segment in watchData.transcript.segments"
                  :key="`${segment.startMs}-${segment.text}`"
                  class="transcript-segment"
                  type="button"
                  @click="seekToTranscriptSegment(segment.startMs)"
                >
                  <span class="transcript-segment__time">{{ segment.startText }}</span>
                  <span class="transcript-segment__text">{{ segment.text }}</span>
                </button>
              </div>
              <div v-else class="watch-empty-state">
                <p>{{ watchData.transcript.unavailableReason ?? 'Transcript is unavailable for this video.' }}</p>
              </div>
            </template>

            <template v-else-if="activeMetaTab === 'technical'">
              <dl class="watch-tech-grid">
                <div v-for="fact in technicalFacts" :key="fact.label" class="watch-tech-grid__item">
                  <dt>{{ fact.label }}</dt>
                  <dd>{{ fact.value }}</dd>
                </div>
              </dl>
            </template>

            <template v-else>
              <div v-if="watchWarningItems.length" class="watch-warning-panel">
                <p v-for="warning in watchWarningItems" :key="warning">{{ warning }}</p>
              </div>
              <div v-else class="watch-empty-state">
                <p>No extra warnings. This watch page is using the unified API payload cleanly.</p>
              </div>
            </template>
          </div>
        </section>

        <section class="panel-card comments-card comments-card--legacy">
          <header class="comments-card__head comments-card__head--legacy">
            <div>
              <h2>{{ commentsData.commentsCountText ?? 'Comments' }}</h2>
              <span>{{ commentsData.countText ?? 'Public thread view' }}</span>
            </div>

            <div class="comment-sort-row">
              <button
                v-for="sortOption in commentsData.availableSorts"
                :key="sortOption.id"
                class="comment-sort-button"
                :class="{ 'is-active': commentsData.sort === sortOption.id }"
                type="button"
                :disabled="isRefreshingComments && commentsData.sort === sortOption.id"
                @click="loadComments(sortOption.id)"
              >
                {{ sortOption.label }}
              </button>
            </div>
          </header>

          <p v-if="commentsError" class="watch-inline-error">{{ commentsError }}</p>
          <p v-else-if="isRefreshingComments" class="watch-inline-note">Refreshing comments...</p>

          <div v-if="commentsData.items.length === 0" class="watch-empty-state">
            <p>No public comments were returned for this video.</p>
          </div>

          <article class="comment-thread comment-thread--legacy" v-for="comment in commentsData.items" :key="comment.id">
            <img class="comment-thread__avatar" :src="commentAvatar(comment.author?.thumbnails)" :alt="comment.author?.name ?? 'Comment avatar'" />
            <div class="comment-thread__body">
              <p class="comment-thread__meta comment-thread__meta--rich">
                <strong>{{ comment.author?.name ?? 'Anonymous' }}</strong>
                <span>{{ comment.publishedText }}</span>
                <span v-if="comment.isPinned" class="comment-badge">Pinned</span>
                <span v-if="comment.isHearted" class="comment-badge">Hearted</span>
                <span v-if="comment.isMember" class="comment-badge">Member</span>
                <span v-if="comment.authorIsChannelOwner" class="comment-badge comment-badge--owner">Creator</span>
              </p>

              <p class="comment-thread__content">{{ comment.content }}</p>

              <div class="comment-thread__footer-row">
                <p class="comment-thread__footer">
                  {{ comment.likeCountText || '0 likes' }}
                  <span v-if="comment.replyCountText"> | {{ comment.replyCountText }}</span>
                </p>

                <button
                  v-if="comment.hasReplies || comment.canLoadReplies || replyFeeds[comment.id]?.items.length"
                  class="comment-replies-toggle"
                  type="button"
                  @click="toggleReplies(comment)"
                >
                  {{ expandedReplies[comment.id] ? 'Hide replies' : (comment.replyCountText || 'Show replies') }}
                </button>
              </div>

              <div v-if="expandedReplies[comment.id]" class="comment-replies-block">
                <p v-if="replyErrors[comment.id]" class="watch-inline-error">{{ replyErrors[comment.id] }}</p>
                <p v-else-if="loadingReplies[comment.id] && !replyFeeds[comment.id]" class="watch-inline-note">Loading replies...</p>

                <div v-if="replyFeeds[comment.id]?.items.length" class="comment-replies-list">
                  <article class="comment-reply" v-for="reply in replyFeeds[comment.id].items" :key="reply.id">
                    <img class="comment-reply__avatar" :src="commentAvatar(reply.author?.thumbnails)" :alt="reply.author?.name ?? 'Reply avatar'" />
                    <div>
                      <p class="comment-thread__meta comment-thread__meta--rich">
                        <strong>{{ reply.author?.name ?? 'Anonymous' }}</strong>
                        <span>{{ reply.publishedText }}</span>
                        <span v-if="reply.authorIsChannelOwner" class="comment-badge comment-badge--owner">Creator</span>
                      </p>
                      <p class="comment-thread__content comment-thread__content--reply">{{ reply.content }}</p>
                      <p class="comment-thread__footer">{{ reply.likeCountText || '0 likes' }}</p>
                    </div>
                  </article>
                </div>

                <div v-else-if="!loadingReplies[comment.id]" class="watch-inline-note">No public replies returned.</div>

                <button
                  v-if="replyFeeds[comment.id]?.hasContinuation"
                  class="watch-load-more-button watch-load-more-button--compact"
                  type="button"
                  :disabled="loadingReplies[comment.id]"
                  @click="loadMoreReplies(comment.id)"
                >
                  {{ loadingReplies[comment.id] ? 'Loading replies...' : 'Load more replies' }}
                </button>
              </div>
            </div>
          </article>

          <div class="watch-load-more-row" v-if="commentsData.hasContinuation">
            <button
              class="watch-load-more-button"
              type="button"
              :disabled="isLoadingMoreComments"
              @click="loadMoreComments"
            >
              {{ isLoadingMoreComments ? 'Loading more comments...' : 'Load more comments' }}
            </button>
          </div>
        </section>
      </template>
    </section>

    <aside class="watch-side-column" v-if="watchData && relatedFeed">
      <section class="panel-card up-next-card up-next-card--legacy">
        <header class="up-next-card__head up-next-card__head--legacy">
          <div>
            <h2>Up Next</h2>
            <span>{{ autoplayStatusLabel }}</span>
          </div>

          <label class="watch-autoplay-toggle">
            <span>Autoplay</span>
            <input v-model="autoplayEnabled" type="checkbox" />
          </label>
        </header>

        <p v-if="autoplayLeadTitle" class="watch-autoplay-lead">
          Autoplay is ready for <strong>{{ autoplayLeadTitle }}</strong>
        </p>

        <div class="watch-rail-stack">
          <div
            v-for="item in relatedFeed.items"
            :key="`${item.kind}:${item.id}`"
            class="watch-rail-entry"
            :class="{ 'is-autoplay': item.id === relatedFeed.autoplayVideoId }"
          >
            <div v-if="item.id === relatedFeed.autoplayVideoId" class="watch-rail-entry__badge">Autoplay</div>
            <VideoCard :item="item" layout="rail" />
          </div>
        </div>

        <div class="watch-load-more-row" v-if="relatedFeed.hasContinuation">
          <button
            class="watch-load-more-button"
            type="button"
            :disabled="isLoadingMoreRelated"
            @click="loadMoreRelated"
          >
            {{ isLoadingMoreRelated ? 'Loading more videos...' : 'Load more' }}
          </button>
        </div>

        <p v-if="relatedError" class="watch-inline-error">{{ relatedError }}</p>
      </section>

      <section class="panel-card watch-side-summary-card">
        <header class="watch-side-summary-card__head">
          <h2>This video at a glance</h2>
          <span>Classic 2014 utility rail</span>
        </header>

        <dl class="watch-side-summary-grid">
          <div>
            <dt>Mode</dt>
            <dd>{{ watchData.playback.recommendedPlaybackMode }}</dd>
          </div>
          <div>
            <dt>Qualities</dt>
            <dd>{{ watchData.playback.qualityOptions.length }}</dd>
          </div>
          <div>
            <dt>Audio tracks</dt>
            <dd>{{ watchData.playback.audioTracks.length }}</dd>
          </div>
          <div>
            <dt>Captions</dt>
            <dd>{{ watchData.captions.tracks.length }}</dd>
          </div>
          <div>
            <dt>Transcript</dt>
            <dd>{{ watchData.transcript.available ? 'Available' : 'Unavailable' }}</dd>
          </div>
          <div>
            <dt>Related queue</dt>
            <dd>{{ relatedFeed.items.length }}</dd>
          </div>
        </dl>
      </section>
    </aside>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import ClassicPlayer from '@/components/ClassicPlayer.vue';
import VideoCard from '@/components/VideoCard.vue';
import { api } from '@/lib/api';
import type {
  Thumbnail,
  VideoCommentItem,
  VideoCommentRepliesData,
  VideoCommentsData,
  VideoWatchData,
} from '@/lib/api-types';
import { formatDuration, formatRelativeLabel, formatViewCount, pickThumbnail } from '@/lib/formatters';

type CommentSort = 'top' | 'newest';
type MetaTab = 'description' | 'transcript' | 'technical' | 'warnings';
type PlayerHandle = {
  seekTo: (seconds: number) => void;
  play: () => Promise<void> | void;
};

const route = useRoute();
const router = useRouter();
const playerRef = ref<PlayerHandle | null>(null);

const watchData = ref<VideoWatchData | null>(null);
const commentsData = ref<VideoCommentsData | null>(null);
const relatedFeed = ref<VideoWatchData['related'] | null>(null);
const isLoading = ref(true);
const errorMessage = ref('');
const commentsError = ref('');
const relatedError = ref('');
const isRefreshingComments = ref(false);
const isLoadingMoreComments = ref(false);
const isLoadingMoreRelated = ref(false);
const autoplayEnabled = ref(true);
const isDescriptionExpanded = ref(false);
const activeMetaTab = ref<MetaTab>('description');
const replyFeeds = ref<Record<string, VideoCommentRepliesData>>({});
const expandedReplies = ref<Record<string, boolean>>({});
const loadingReplies = ref<Record<string, boolean>>({});
const replyErrors = ref<Record<string, string>>({});

const videoId = computed(() => {
  const rawValue = route.query.v;
  return typeof rawValue === 'string' ? rawValue.trim() : '';
});

const metaTabs = computed(() => {
  const tabs: Array<{ id: MetaTab; label: string }> = [
    { id: 'description', label: 'About' },
    { id: 'technical', label: 'Technical' },
  ];

  if (watchData.value?.transcript.available) {
    tabs.splice(1, 0, { id: 'transcript', label: 'Transcript' });
  }

  tabs.push({ id: 'warnings', label: 'Warnings' });
  return tabs;
});

const channelAvatar = computed(() => {
  return pickThumbnail(watchData.value?.details.channel?.thumbnails ?? watchData.value?.details.thumbnails) || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"%3E%3Crect width="48" height="48" fill="%23d9d9d9"/%3E%3C/svg%3E';
});

const channelMeta = computed(() => {
  return formatRelativeLabel(
    watchData.value?.details.channel?.subscriberCountText,
    watchData.value?.details.channel?.videoCountText,
  ) || 'Public channel';
});

const channelDetailMeta = computed(() => {
  return formatRelativeLabel(
    watchData.value?.details.category,
    watchData.value?.details.liveLifecycle,
    watchData.value?.details.isFamilySafe ? 'Family safe' : null,
  );
});

const viewsLabel = computed(() => formatViewCount(watchData.value?.details.viewCount));
const publishMeta = computed(() => {
  const details = watchData.value?.details;
  if (!details) {
    return '';
  }

  return formatRelativeLabel(
    details.scheduledStartTime ? `Scheduled ${details.scheduledStartTime}` : null,
    details.endedAt ? `Ended ${details.endedAt}` : null,
    details.liveLifecycle,
    details.category,
  ) || 'Classic watch page';
});

const qualitySummaryLabel = computed(() => {
  const playback = watchData.value?.playback;
  if (!playback) {
    return 'No quality data';
  }

  return `${playback.qualityOptions.length} quality options`;
});

const captionsSummaryLabel = computed(() => {
  const captions = watchData.value?.captions;
  if (!captions?.tracks.length) {
    return 'No captions';
  }

  return `${captions.tracks.length} caption tracks`;
});

const watchStatusBadges = computed(() => {
  const details = watchData.value?.details;
  if (!details) {
    return [] as string[];
  }

  return [
    details.isLive ? 'Live' : null,
    details.isPremiere ? 'Premiere' : null,
    details.isUpcoming ? 'Upcoming' : null,
    details.isShorts ? 'Shorts' : null,
    details.isLowLatencyLiveStream ? 'Low latency' : null,
    details.isLiveDvrEnabled ? 'DVR' : null,
    details.isUnlisted ? 'Unlisted' : null,
  ].filter((value): value is string => Boolean(value));
});

const fullDescription = computed(() => watchData.value?.details.description?.trim() || 'No description available.');
const canExpandDescription = computed(() => fullDescription.value.length > 420 || fullDescription.value.split('\n').length > 6);
const displayedDescription = computed(() => {
  if (isDescriptionExpanded.value || !canExpandDescription.value) {
    return fullDescription.value;
  }

  return `${fullDescription.value.slice(0, 420).trimEnd()}...`;
});

const watchWarningItems = computed(() => {
  const items = [
    ...(watchData.value?.warnings ?? []),
    watchData.value?.details.playabilityReason,
    watchData.value?.playback.playabilityReason,
  ];

  return Array.from(new Set(items.filter((value): value is string => Boolean(value && value.trim()))));
});

const technicalFacts = computed(() => {
  const payload = watchData.value;
  if (!payload) {
    return [] as Array<{ label: string; value: string }>;
  }

  return [
    { label: 'Playback mode', value: payload.playback.recommendedPlaybackMode },
    { label: 'Duration', value: formatDuration(payload.playback.durationSeconds ?? payload.details.durationSeconds) },
    { label: 'Muxed streams', value: String(payload.playback.muxedStreams.length) },
    { label: 'Adaptive pairs', value: String(payload.playback.adaptivePairs.length) },
    { label: 'Audio tracks', value: String(payload.playback.audioTracks.length) },
    { label: 'Storyboard sheets', value: String(payload.storyboards.variants.length) },
    { label: 'Transcript', value: payload.transcript.available ? `${payload.transcript.segmentCount} segments` : 'Unavailable' },
    { label: 'Captions', value: payload.captions.hasCaptions ? `${payload.captions.tracks.length} tracks` : 'Unavailable' },
    { label: 'Playability', value: payload.playback.playabilityStatus ?? payload.details.playabilityStatus ?? 'Unknown' },
    { label: 'Lifecycle', value: payload.details.liveLifecycle || 'vod' },
  ];
});

const autoplayLeadTitle = computed(() => {
  const targetId = relatedFeed.value?.autoplayVideoId;
  if (!targetId) {
    return null;
  }

  return relatedFeed.value?.items.find((item) => item.id === targetId)?.title ?? null;
});

const autoplayStatusLabel = computed(() => {
  if (!relatedFeed.value?.autoplayVideoId) {
    return 'Classic rail';
  }

  return autoplayEnabled.value ? 'Autoplay armed' : 'Autoplay paused';
});

const commentAvatar = (thumbnails: Thumbnail[] | null | undefined): string => {
  return pickThumbnail(thumbnails) || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"%3E%3Crect width="40" height="40" fill="%23d9d9d9"/%3E%3C/svg%3E';
};

const resetReplyState = () => {
  replyFeeds.value = {};
  expandedReplies.value = {};
  loadingReplies.value = {};
  replyErrors.value = {};
};

const applyWatchPayload = (payload: VideoWatchData) => {
  watchData.value = payload;
  commentsData.value = payload.comments;
  relatedFeed.value = payload.related;
  commentsError.value = '';
  relatedError.value = '';
  isDescriptionExpanded.value = false;
  activeMetaTab.value = payload.transcript.available ? 'description' : 'technical';
  resetReplyState();
};

const mergeRelatedItems = (
  currentItems: VideoWatchData['related']['items'],
  incomingItems: VideoWatchData['related']['items'],
) => {
  const seen = new Set(currentItems.map((item) => `${item.kind}:${item.id}`));
  const merged = [...currentItems];

  for (const item of incomingItems) {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(item);
  }

  return merged;
};

const loadWatch = async () => {
  if (!videoId.value) {
    errorMessage.value = 'Missing video id.';
    isLoading.value = false;
    watchData.value = null;
    commentsData.value = null;
    relatedFeed.value = null;
    return;
  }

  isLoading.value = true;
  errorMessage.value = '';

  try {
    const payload = await api.getWatch(videoId.value);
    applyWatchPayload(payload);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to load watch page.';
    watchData.value = null;
    commentsData.value = null;
    relatedFeed.value = null;
  } finally {
    isLoading.value = false;
  }
};

const loadMoreRelated = async () => {
  if (!videoId.value || !relatedFeed.value?.continuation || isLoadingMoreRelated.value) {
    return;
  }

  isLoadingMoreRelated.value = true;
  relatedError.value = '';

  try {
    const nextFeed = await api.getRelated(videoId.value, relatedFeed.value.continuation, 18);
    relatedFeed.value = {
      ...relatedFeed.value,
      ...nextFeed,
      items: mergeRelatedItems(relatedFeed.value.items, nextFeed.items),
    };
  } catch (error) {
    relatedError.value = error instanceof Error ? error.message : 'Failed to load more related videos.';
  } finally {
    isLoadingMoreRelated.value = false;
  }
};

const loadComments = async (sort: CommentSort) => {
  if (!videoId.value || isRefreshingComments.value) {
    return;
  }

  isRefreshingComments.value = true;
  commentsError.value = '';

  try {
    commentsData.value = await api.getVideoComments(videoId.value, undefined, 20, sort);
    resetReplyState();
  } catch (error) {
    commentsError.value = error instanceof Error ? error.message : 'Failed to refresh comments.';
  } finally {
    isRefreshingComments.value = false;
  }
};

const loadMoreComments = async () => {
  if (!videoId.value || !commentsData.value?.continuation || isLoadingMoreComments.value) {
    return;
  }

  isLoadingMoreComments.value = true;
  commentsError.value = '';

  try {
    const nextPage = await api.getVideoComments(
      videoId.value,
      commentsData.value.continuation,
      20,
      commentsData.value.sort,
    );

    commentsData.value = {
      ...commentsData.value,
      ...nextPage,
      items: [...commentsData.value.items, ...nextPage.items],
    };
  } catch (error) {
    commentsError.value = error instanceof Error ? error.message : 'Failed to load more comments.';
  } finally {
    isLoadingMoreComments.value = false;
  }
};

const fetchReplies = async (commentId: string, continuation?: string) => {
  if (!videoId.value || loadingReplies.value[commentId]) {
    return;
  }

  loadingReplies.value[commentId] = true;
  replyErrors.value[commentId] = '';

  try {
    const response = await api.getVideoCommentReplies(videoId.value, commentId, continuation, 12);
    const previous = replyFeeds.value[commentId];

    replyFeeds.value[commentId] = previous && continuation
      ? {
          ...response,
          items: [...previous.items, ...response.items],
        }
      : response;
  } catch (error) {
    replyErrors.value[commentId] = error instanceof Error ? error.message : 'Failed to load replies.';
  } finally {
    loadingReplies.value[commentId] = false;
  }
};

const toggleReplies = async (comment: VideoCommentItem) => {
  expandedReplies.value[comment.id] = !expandedReplies.value[comment.id];

  if (expandedReplies.value[comment.id] && !replyFeeds.value[comment.id] && (comment.hasReplies || comment.canLoadReplies)) {
    await fetchReplies(comment.id);
  }
};

const loadMoreReplies = async (commentId: string) => {
  const replyFeed = replyFeeds.value[commentId];
  if (!replyFeed?.continuation) {
    return;
  }

  await fetchReplies(commentId, replyFeed.continuation);
};

const seekToTranscriptSegment = (startMs: number) => {
  playerRef.value?.seekTo(Math.max(0, startMs / 1000));
  void playerRef.value?.play?.();
};

const handlePlayerEnded = () => {
  if (!autoplayEnabled.value || !relatedFeed.value?.autoplayVideoId) {
    return;
  }

  void router.push({
    path: '/watch',
    query: { v: relatedFeed.value.autoplayVideoId },
  });
};

watch(videoId, () => {
  void loadWatch();
}, { immediate: true });
</script>

