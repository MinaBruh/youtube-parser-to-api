<template>
  <main class="channel-page page-frame">
    <section v-if="isLoading" class="panel-card loading-card">
      <p>Loading channel page...</p>
    </section>

    <section v-else-if="errorMessage" class="panel-card error-card">
      <h2>Channel unavailable</h2>
      <p>{{ errorMessage }}</p>
    </section>

    <template v-else-if="channelDetails">
      <section class="panel-card channel-hero-card">
        <div class="channel-hero-banner" :style="bannerStyle"></div>
        <div class="channel-hero-body">
          <img class="channel-hero-avatar" :src="avatarUrl" :alt="channelDetails.title ?? 'Channel avatar'" />

          <div class="channel-hero-copy">
            <p class="browse-hero__eyebrow">Channel</p>
            <h1>{{ channelDetails.title ?? channelDetails.handle ?? channelDetails.id }}</h1>
            <p class="channel-hero-meta">{{ channelHeroMeta }}</p>
            <p class="channel-hero-submeta">{{ channelSecondaryMeta }}</p>
            <p class="channel-hero-description">{{ channelDescription }}</p>

            <div v-if="channelDetails.links.length" class="channel-link-row">
              <a
                v-for="link in channelDetails.links.slice(0, 5)"
                :key="link.url"
                class="channel-link-pill"
                :href="link.url"
                target="_blank"
                rel="noreferrer"
              >
                {{ link.title }}
              </a>
            </div>
          </div>

          <div class="channel-hero-actions">
            <button class="watch-subscribe-button" type="button">
              Subscribe
              <strong v-if="channelDetails.subscriberCountText">{{ channelDetails.subscriberCountText }}</strong>
            </button>
          </div>
        </div>
      </section>

      <section class="panel-card channel-nav-card">
        <div class="channel-nav-tabs">
          <button
            v-for="tab in visibleTabs"
            :key="tab.id"
            class="channel-nav-tab"
            :class="{ 'is-active': !isSearchMode && selectedTab === tab.id }"
            type="button"
            @click="setTab(tab.id)"
          >
            {{ tab.label }}
          </button>
        </div>

        <form v-if="channelDetails.capabilities.hasSearch" class="channel-search-row" @submit.prevent="submitSearch">
          <input v-model="searchInput" class="channel-search-input" type="search" placeholder="Search in this channel" />
          <button class="watch-action-button" type="submit">Search</button>
          <button v-if="isSearchMode" class="watch-action-button" type="button" @click="clearSearch">Back to channel</button>
        </form>

        <div v-if="isSearchMode && browseData" class="channel-option-rows">
          <div v-if="browseData.sortOptions.length" class="channel-option-row">
            <button
              v-for="option in browseData.sortOptions"
              :key="option.id"
              class="search-filter-pill"
              :class="{ 'is-active': option.selected }"
              type="button"
              @click="setSearchSort(option.id)"
            >
              {{ option.label }}
            </button>
          </div>

          <div v-if="browseData.contentTypeOptions.length" class="channel-option-row">
            <button
              v-for="option in browseData.contentTypeOptions"
              :key="option.id"
              class="search-filter-pill"
              :class="{ 'is-active': option.selected }"
              type="button"
              @click="setSearchContentType(option.id)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div v-else-if="browseData?.filterOptions.length" class="channel-option-row">
          <button
            v-for="option in browseData.filterOptions"
            :key="option.id"
            class="search-filter-pill"
            :class="{ 'is-active': option.selected }"
            type="button"
            @click="setHomeFilter(option.id)"
          >
            {{ option.label }}
          </button>
        </div>
      </section>

      <section v-if="isLoadingContent" class="panel-card loading-card">
        <p>Loading channel feed...</p>
      </section>

      <section v-else-if="contentError" class="panel-card error-card">
        <h2>Feed unavailable</h2>
        <p>{{ contentError }}</p>
      </section>

      <template v-else>
        <header class="channel-page-header panel-card">
          <div>
            <p class="browse-hero__eyebrow">{{ headerEyebrow }}</p>
            <h2>{{ contentHeading }}</h2>
            <p>{{ contentSubtitle }}</p>
          </div>
        </header>

        <template v-if="isCommunityMode && communityData">
          <section v-if="communityData.items.length === 0" class="panel-card empty-card">
            <h2>No public posts</h2>
            <p>This channel does not expose public community items right now.</p>
          </section>

          <section v-else class="channel-community-stack">
            <article v-for="post in communityData.items" :key="post.id" class="panel-card community-post-card">
              <header class="community-post-card__head">
                <div>
                  <p class="community-post-card__author">{{ post.author?.name ?? channelDetails.title ?? 'Channel post' }}</p>
                  <p class="community-post-card__meta">{{ formatRelativeLabel(post.publishedText, post.likeCountText, post.replyCountText) }}</p>
                </div>
                <span class="watch-title-badge">{{ post.kind === 'shared_post' ? 'Shared post' : 'Post' }}</span>
              </header>

              <p v-if="post.content" class="community-post-card__content">{{ post.content }}</p>

              <div v-if="post.attachment?.kind === 'image'" class="community-image-grid">
                <img
                  v-for="(image, index) in post.attachment.images"
                  :key="`${post.id}-${index}`"
                  class="community-image-grid__item"
                  :src="pickThumbnail(image.thumbnails)"
                  :alt="post.content ?? 'Community image'"
                />
              </div>

              <div v-else-if="post.attachment?.kind === 'poll'" class="community-poll-list">
                <div v-for="(choice, index) in post.attachment.choices" :key="`${post.id}-choice-${index}`" class="community-poll-choice">
                  <span>{{ choice.text ?? 'Option' }}</span>
                  <strong>{{ choice.votePercentageText ?? 'Vote data unavailable' }}</strong>
                </div>
                <p v-if="post.attachment.totalVotesText" class="community-post-card__meta">{{ post.attachment.totalVotesText }}</p>
              </div>

              <div v-else-if="post.attachment?.kind === 'content' && post.attachment.items.length" class="community-content-grid">
                <VideoCard
                  v-for="item in post.attachment.items"
                  :key="`${post.id}-${item.kind}-${item.id}`"
                  :item="item"
                  layout="grid"
                />
              </div>

              <div v-if="post.originalPost" class="community-shared-card">
                <p class="community-post-card__meta">Originally from {{ post.originalPost.author?.name ?? 'another channel' }}</p>
                <p class="community-post-card__content">{{ post.originalPost.content }}</p>
              </div>
            </article>
          </section>
        </template>

        <template v-else-if="browseData">
          <RailSection
            v-for="section in browseSections"
            :key="`${section.title ?? 'section'}-${section.items[0]?.id ?? 'empty'}`"
            :title="section.title ?? contentHeading"
            :subtitle="section.subtitle"
            :items="section.items"
          />

          <section v-if="browseFallbackItems.length && browseSections.length === 0" class="panel-card simple-grid-block">
            <div class="rail-section__grid">
              <VideoCard
                v-for="item in browseFallbackItems"
                :key="`${item.kind}:${item.id}`"
                :item="item"
                layout="grid"
              />
            </div>
          </section>
        </template>

        <section v-else-if="feedData" class="panel-card search-results-stack channel-feed-stack">
          <VideoCard
            v-for="item in feedData.items"
            :key="`${item.kind}:${item.id}`"
            :item="item"
            :layout="feedCardLayout"
          />
        </section>

        <section v-else class="panel-card empty-card">
          <h2>No public feed</h2>
          <p>This surface is currently empty for the selected channel tab.</p>
        </section>

        <section v-if="hasContinuation || loadMoreError" class="panel-card browse-load-card">
          <div class="browse-load-row">
            <div>
              <p class="browse-load-title">More from this channel</p>
              <p class="browse-load-caption">Load the next page from the current channel surface.</p>
              <p v-if="loadMoreError" class="browse-load-error">{{ loadMoreError }}</p>
            </div>

            <button
              v-if="hasContinuation"
              class="watch-action-button"
              type="button"
              :disabled="isLoadingMore"
              @click="loadMore"
            >
              {{ isLoadingMore ? 'Loading...' : 'Load more' }}
            </button>
          </div>
        </section>
      </template>
    </template>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import RailSection from '@/components/RailSection.vue';
import VideoCard from '@/components/VideoCard.vue';
import { api } from '@/lib/api';
import type {
  ChannelBrowseData,
  ChannelDetailsData,
  ChannelFeedData,
  CommunityPostsData,
  DiscoveryFeedSection,
  RelatedItem,
} from '@/lib/api-types';
import { formatRelativeLabel, pickThumbnail } from '@/lib/formatters';

type ChannelTab = 'home' | 'videos' | 'shorts' | 'streams' | 'playlists' | 'community';

const route = useRoute();
const router = useRouter();

const channelDetails = ref<ChannelDetailsData | null>(null);
const browseData = ref<ChannelBrowseData | null>(null);
const feedData = ref<ChannelFeedData | null>(null);
const communityData = ref<CommunityPostsData | null>(null);
const isLoading = ref(true);
const isLoadingContent = ref(true);
const isLoadingMore = ref(false);
const errorMessage = ref('');
const contentError = ref('');
const loadMoreError = ref('');
const searchInput = ref('');

const channelId = computed(() => String(route.params.channelId ?? '').trim());
const selectedTab = computed<ChannelTab>(() => {
  const rawValue = typeof route.query.tab === 'string' ? route.query.tab : 'home';
  return rawValue === 'videos' || rawValue === 'shorts' || rawValue === 'streams' || rawValue === 'playlists' || rawValue === 'community'
    ? rawValue
    : 'home';
});
const searchQuery = computed(() => typeof route.query.q === 'string' ? route.query.q.trim() : '');
const selectedHomeFilter = computed(() => typeof route.query.filter === 'string' ? route.query.filter : undefined);
const selectedSearchSort = computed(() => typeof route.query.sort === 'string' ? route.query.sort : undefined);
const selectedSearchContentType = computed(() => typeof route.query.contentType === 'string' ? route.query.contentType : undefined);
const isSearchMode = computed(() => searchQuery.value.length > 0);
const isCommunityMode = computed(() => !isSearchMode.value && selectedTab.value === 'community');

const avatarUrl = computed(() => pickThumbnail(channelDetails.value?.avatar) || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"%3E%3Crect width="96" height="96" fill="%23d9d9d9"/%3E%3C/svg%3E');
const bannerUrl = computed(() => pickThumbnail(channelDetails.value?.banner));
const bannerStyle = computed(() => {
  return bannerUrl.value
    ? { backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.12), rgba(0,0,0,0.12)), url('${bannerUrl.value}')` }
    : undefined;
});
const channelHeroMeta = computed(() => formatRelativeLabel(
  channelDetails.value?.handle,
  channelDetails.value?.subscriberCountText,
  channelDetails.value?.videoCountText,
  channelDetails.value?.viewCountText,
));
const channelSecondaryMeta = computed(() => formatRelativeLabel(
  channelDetails.value?.country,
  channelDetails.value?.joinedDateText,
  channelDetails.value?.isFamilySafe ? 'Family safe' : null,
));
const channelDescription = computed(() => channelDetails.value?.description || 'No public description was returned for this channel.');
const visibleTabs = computed(() => {
  const capabilities = channelDetails.value?.capabilities;

  return [
    { id: 'home', label: 'Home', enabled: capabilities?.hasHome ?? true },
    { id: 'videos', label: 'Videos', enabled: capabilities?.hasVideos ?? true },
    { id: 'shorts', label: 'Shorts', enabled: capabilities?.hasShorts ?? true },
    { id: 'streams', label: 'Live', enabled: capabilities?.hasLiveStreams ?? true },
    { id: 'playlists', label: 'Playlists', enabled: capabilities?.hasPlaylists ?? true },
    { id: 'community', label: 'Community', enabled: capabilities?.hasCommunity ?? true },
  ].filter((tab) => tab.enabled) as Array<{ id: ChannelTab; label: string }>;
});
const browseSections = computed(() => (browseData.value?.sections ?? []).filter((section) => section.items.length > 0));
const browseFallbackItems = computed(() => browseData.value?.items ?? []);
const hasContinuation = computed(() => {
  if (isCommunityMode.value) {
    return Boolean(communityData.value?.hasContinuation && communityData.value.continuation);
  }

  if (isSearchMode.value || selectedTab.value === 'home') {
    return Boolean(browseData.value?.hasContinuation && browseData.value.continuation);
  }

  return Boolean(feedData.value?.hasContinuation && feedData.value.continuation);
});
const contentHeading = computed(() => {
  if (isSearchMode.value) {
    return searchQuery.value ? `Search results for "${searchQuery.value}"` : 'Channel search';
  }

  return visibleTabs.value.find((tab) => tab.id === selectedTab.value)?.label ?? 'Channel';
});
const contentSubtitle = computed(() => {
  if (isSearchMode.value) {
    return browseData.value?.title ?? 'Public results from the selected channel.';
  }

  if (isCommunityMode.value) {
    return 'Public community posts exposed by the channel.';
  }

  if (selectedTab.value === 'home') {
    return browseData.value?.title ?? 'Featured shelves and highlighted uploads.';
  }

  return `Browsing the public ${selectedTab.value} surface.`;
});
const headerEyebrow = computed(() => isSearchMode.value ? 'Channel Search' : 'Channel Surface');
const feedCardLayout = computed<'grid' | 'list'>(() => selectedTab.value === 'playlists' ? 'grid' : 'list');

const buildItemKey = (item: RelatedItem): string => `${item.kind}:${item.id}`;
const mergeItems = (currentItems: RelatedItem[], nextItems: RelatedItem[]): RelatedItem[] => {
  const seenKeys = new Set<string>();
  const mergedItems: RelatedItem[] = [];

  for (const item of [...currentItems, ...nextItems]) {
    const key = buildItemKey(item);
    if (seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    mergedItems.push(item);
  }

  return mergedItems;
};
const mergeSections = (currentSections: DiscoveryFeedSection[], nextSections: DiscoveryFeedSection[]): DiscoveryFeedSection[] => {
  const mergedSections = currentSections.map((section) => ({ ...section, items: [...section.items] }));

  for (const nextSection of nextSections) {
    const key = `${nextSection.title ?? ''}::${nextSection.subtitle ?? ''}`;
    const existing = mergedSections.find((section) => `${section.title ?? ''}::${section.subtitle ?? ''}` === key);

    if (!existing) {
      mergedSections.push({ ...nextSection, items: [...nextSection.items] });
      continue;
    }

    existing.items = mergeItems(existing.items, nextSection.items);
  }

  return mergedSections;
};
const mergeBrowseData = (currentData: ChannelBrowseData, nextData: ChannelBrowseData): ChannelBrowseData => {
  return {
    ...currentData,
    ...nextData,
    filterOptions: nextData.filterOptions.length > 0 ? nextData.filterOptions : currentData.filterOptions,
    sortOptions: nextData.sortOptions.length > 0 ? nextData.sortOptions : currentData.sortOptions,
    contentTypeOptions: nextData.contentTypeOptions.length > 0 ? nextData.contentTypeOptions : currentData.contentTypeOptions,
    sections: mergeSections(currentData.sections, nextData.sections),
    items: mergeItems(currentData.items, nextData.items),
  };
};
const mergeFeedData = (currentData: ChannelFeedData, nextData: ChannelFeedData): ChannelFeedData => {
  return {
    ...currentData,
    ...nextData,
    items: mergeItems(currentData.items, nextData.items),
  };
};
const mergeCommunityData = (currentData: CommunityPostsData, nextData: CommunityPostsData): CommunityPostsData => {
  const seenIds = new Set<string>();
  const items = [...currentData.items, ...nextData.items].filter((item) => {
    if (seenIds.has(item.id)) {
      return false;
    }

    seenIds.add(item.id);
    return true;
  });

  return {
    ...currentData,
    ...nextData,
    items,
  };
};

const loadPage = async () => {
  if (!channelId.value) {
    errorMessage.value = 'Missing channel id.';
    isLoading.value = false;
    return;
  }

  isLoading.value = true;
  isLoadingContent.value = true;
  errorMessage.value = '';
  contentError.value = '';
  loadMoreError.value = '';
  browseData.value = null;
  feedData.value = null;
  communityData.value = null;

  try {
    const detailsPromise = api.getChannelDetails(channelId.value);
    const contentPromise = isSearchMode.value
      ? api.getChannelSearch(channelId.value, {
          q: searchQuery.value,
          sort: selectedSearchSort.value,
          contentType: selectedSearchContentType.value,
        })
      : selectedTab.value === 'home'
        ? api.getChannelHome(channelId.value, { filter: selectedHomeFilter.value })
        : selectedTab.value === 'community'
          ? api.getChannelCommunity(channelId.value)
          : api.getChannelFeed(channelId.value, selectedTab.value);

    const [details, content] = await Promise.all([detailsPromise, contentPromise]);
    channelDetails.value = details;
    searchInput.value = searchQuery.value;

    if (isSearchMode.value || selectedTab.value === 'home') {
      browseData.value = content as ChannelBrowseData;
    } else if (selectedTab.value === 'community') {
      communityData.value = content as CommunityPostsData;
    } else {
      feedData.value = content as ChannelFeedData;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load channel page.';
    errorMessage.value = message;
    contentError.value = message;
    channelDetails.value = null;
  } finally {
    isLoading.value = false;
    isLoadingContent.value = false;
  }
};

const loadMore = async () => {
  if (!channelId.value || isLoadingMore.value || !hasContinuation.value) {
    return;
  }

  isLoadingMore.value = true;
  loadMoreError.value = '';

  try {
    if (isCommunityMode.value && communityData.value?.continuation) {
      const nextPage = await api.getChannelCommunity(channelId.value, communityData.value.continuation);
      communityData.value = mergeCommunityData(communityData.value, nextPage);
      return;
    }

    if ((isSearchMode.value || selectedTab.value === 'home') && browseData.value?.continuation) {
      const nextPage = isSearchMode.value
        ? await api.getChannelSearch(channelId.value, { continuation: browseData.value.continuation })
        : await api.getChannelHome(channelId.value, { continuation: browseData.value.continuation });
      browseData.value = mergeBrowseData(browseData.value, nextPage);
      return;
    }

    if (feedData.value?.continuation) {
      const nextPage = await api.getChannelFeed(channelId.value, selectedTab.value as 'videos' | 'shorts' | 'streams' | 'playlists', feedData.value.continuation);
      feedData.value = mergeFeedData(feedData.value, nextPage);
    }
  } catch (error) {
    loadMoreError.value = error instanceof Error ? error.message : 'Failed to load more items.';
  } finally {
    isLoadingMore.value = false;
  }
};

const setTab = (tab: ChannelTab) => {
  void router.push({
    path: `/channel/${channelId.value}`,
    query: tab === 'home' ? {} : { tab },
  });
};

const setHomeFilter = (filter: string) => {
  void router.push({
    path: `/channel/${channelId.value}`,
    query: {
      ...(selectedTab.value !== 'home' ? { tab: selectedTab.value } : {}),
      ...(filter ? { filter } : {}),
    },
  });
};

const submitSearch = () => {
  const nextQuery = searchInput.value.trim();
  if (!nextQuery) {
    clearSearch();
    return;
  }

  void router.push({
    path: `/channel/${channelId.value}`,
    query: {
      q: nextQuery,
    },
  });
};

const clearSearch = () => {
  searchInput.value = '';
  void router.push({
    path: `/channel/${channelId.value}`,
    query: selectedTab.value === 'home' ? {} : { tab: selectedTab.value },
  });
};

const setSearchSort = (sort: string) => {
  void router.push({
    path: `/channel/${channelId.value}`,
    query: {
      q: searchQuery.value,
      ...(sort ? { sort } : {}),
      ...(selectedSearchContentType.value ? { contentType: selectedSearchContentType.value } : {}),
    },
  });
};

const setSearchContentType = (contentType: string) => {
  void router.push({
    path: `/channel/${channelId.value}`,
    query: {
      q: searchQuery.value,
      ...(selectedSearchSort.value ? { sort: selectedSearchSort.value } : {}),
      ...(contentType ? { contentType } : {}),
    },
  });
};

watch([channelId, selectedTab, searchQuery, selectedHomeFilter, selectedSearchSort, selectedSearchContentType], () => {
  void loadPage();
}, { immediate: true });
</script>
