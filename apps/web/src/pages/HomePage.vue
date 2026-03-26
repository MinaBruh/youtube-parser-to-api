<template>
  <main class="browse-layout page-frame">
    <ClassicSidebar :items="sidebarOptions" @select="handleSidebarSelect" />

    <section class="browse-content">
      <header class="browse-hero panel-card">
        <div>
          <p class="browse-hero__eyebrow">Classic Feed</p>
          <h1>{{ feedTitle }}</h1>
          <p>{{ feedSubtitle }}</p>
        </div>

        <nav class="browse-tabs">
          <RouterLink class="browse-tab" :class="{ 'is-active': mode === 'home' }" to="/">
            What to Watch
          </RouterLink>
          <RouterLink class="browse-tab" :class="{ 'is-active': mode === 'explore' }" :to="{ path: '/', query: { mode: 'explore' } }">
            Explore
          </RouterLink>
          <RouterLink class="browse-tab" :class="{ 'is-active': mode === 'trending' }" :to="{ path: '/', query: { mode: 'trending' } }">
            Trending
          </RouterLink>
        </nav>
      </header>

      <section v-if="isLoading" class="panel-card loading-card">
        <p>Loading the front page feed...</p>
      </section>

      <section v-else-if="errorMessage" class="panel-card error-card">
        <h2>Front page is unavailable</h2>
        <p>{{ errorMessage }}</p>
      </section>

      <template v-else>
        <section v-if="heroItem" class="feature-strip panel-card">
          <VideoCard :item="heroItem" layout="list" />
        </section>

        <RailSection
          v-if="mode === 'home' && recommendationItems.length > 0"
          :title="recommendationTitle"
          :subtitle="recommendationSubtitle"
          :items="recommendationItems"
        />

        <section v-if="mode === 'home' && (recommendationItems.length > 0 || recommendationLoadError)" class="panel-card browse-load-card">
          <div class="browse-load-row">
            <div>
              <p class="browse-load-title">Personalized recommendations</p>
              <p v-if="recommendationProfileLine" class="browse-load-caption">{{ recommendationProfileLine }}</p>
              <p v-if="recommendationLoadError" class="browse-load-error">{{ recommendationLoadError }}</p>
            </div>

            <button
              v-if="recommendations?.hasContinuation"
              class="watch-action-button"
              type="button"
              :disabled="isLoadingMoreRecommendations"
              @click="loadMoreRecommendations"
            >
              {{ isLoadingMoreRecommendations ? 'Loading...' : 'Load more recommendations' }}
            </button>
          </div>
        </section>

        <RailSection
          v-for="section in feedSections"
          :key="`${section.title ?? 'section'}-${section.items[0]?.id ?? 'empty'}`"
          :title="section.title ?? 'Featured uploads'"
          :subtitle="section.subtitle"
          :items="section.items"
        />

        <section v-if="fallbackItems.length > 0 && feedSections.length === 0" class="panel-card simple-grid-block">
          <header class="rail-section__head">
            <div>
              <h2 class="rail-section__title">Featured videos</h2>
              <p class="rail-section__subtitle">Anonymous feed from the current discovery surface.</p>
            </div>
          </header>

          <div class="rail-section__grid">
            <VideoCard
              v-for="item in fallbackItems"
              :key="`${item.kind}:${item.id}`"
              :item="item"
              layout="grid"
            />
          </div>
        </section>

        <section v-if="feed && (feed.hasContinuation || feedLoadError)" class="panel-card browse-load-card">
          <div class="browse-load-row">
            <div>
              <p class="browse-load-title">Discovery feed</p>
              <p class="browse-load-caption">Load the next batch from the current {{ mode === 'home' ? 'home' : mode }} surface.</p>
              <p v-if="feedLoadError" class="browse-load-error">{{ feedLoadError }}</p>
            </div>

            <button
              v-if="feed.hasContinuation"
              class="watch-action-button"
              type="button"
              :disabled="isLoadingMoreFeed"
              @click="loadMoreFeed"
            >
              {{ isLoadingMoreFeed ? 'Loading...' : 'Load more' }}
            </button>
          </div>
        </section>
      </template>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import ClassicSidebar from '@/components/ClassicSidebar.vue';
import RailSection from '@/components/RailSection.vue';
import VideoCard from '@/components/VideoCard.vue';
import { api } from '@/lib/api';
import type {
  DiscoveryFeedData,
  DiscoveryFeedSection,
  RecommendationFeedData,
  RelatedItem,
} from '@/lib/api-types';

const route = useRoute();
const router = useRouter();
const feed = ref<DiscoveryFeedData | null>(null);
const recommendations = ref<RecommendationFeedData | null>(null);
const isLoading = ref(true);
const isLoadingMoreFeed = ref(false);
const isLoadingMoreRecommendations = ref(false);
const errorMessage = ref('');
const feedLoadError = ref('');
const recommendationLoadError = ref('');

const mode = computed<'home' | 'explore' | 'trending'>(() => {
  const rawMode = typeof route.query.mode === 'string' ? route.query.mode : 'home';
  return rawMode === 'explore' || rawMode === 'trending' ? rawMode : 'home';
});

const selectedOption = computed(() => {
  return typeof route.query.filter === 'string'
    ? route.query.filter
    : typeof route.query.tab === 'string'
      ? route.query.tab
      : undefined;
});

const buildItemKey = (item: RelatedItem): string => `${item.kind}:${item.id}`;

const mergeItems = (currentItems: RelatedItem[], nextItems: RelatedItem[]): RelatedItem[] => {
  const mergedItems: RelatedItem[] = [];
  const seenKeys = new Set<string>();

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
  const mergedSections: DiscoveryFeedSection[] = currentSections.map((section) => ({
    ...section,
    items: [...section.items],
  }));

  for (const nextSection of nextSections) {
    const key = `${nextSection.title ?? ''}::${nextSection.subtitle ?? ''}`;
    const existing = mergedSections.find((section) => `${section.title ?? ''}::${section.subtitle ?? ''}` === key);

    if (!existing) {
      mergedSections.push({
        ...nextSection,
        items: [...nextSection.items],
      });
      continue;
    }

    existing.items = mergeItems(existing.items, nextSection.items);
  }

  return mergedSections;
};

const mergeDiscoveryFeed = (currentFeed: DiscoveryFeedData, nextFeed: DiscoveryFeedData): DiscoveryFeedData => {
  return {
    ...currentFeed,
    title: nextFeed.title ?? currentFeed.title,
    optionType: nextFeed.optionType,
    options: nextFeed.options.length > 0 ? nextFeed.options : currentFeed.options,
    hasContinuation: nextFeed.hasContinuation,
    continuation: nextFeed.continuation,
    sections: mergeSections(currentFeed.sections, nextFeed.sections),
    items: mergeItems(currentFeed.items, nextFeed.items),
  };
};

const mergeRecommendationFeed = (
  currentFeed: RecommendationFeedData,
  nextFeed: RecommendationFeedData,
): RecommendationFeedData => {
  return {
    ...currentFeed,
    title: nextFeed.title,
    subtitle: nextFeed.subtitle,
    reason: nextFeed.reason,
    profile: nextFeed.profile,
    hasContinuation: nextFeed.hasContinuation,
    continuation: nextFeed.continuation,
    items: mergeItems(currentFeed.items, nextFeed.items),
  };
};

const feedTitle = computed(() => {
  if (mode.value === 'explore') {
    return 'Explore channels, topics and current loops';
  }

  if (mode.value === 'trending') {
    return 'Trending now in the classic layout';
  }

  return 'What to Watch';
});

const feedSubtitle = computed(() => {
  if (!feed.value) {
    return 'Loading discovery feed...';
  }

  return feed.value.title ?? 'Anonymous discovery feed from your proxy API.';
});

const sidebarOptions = computed(() => feed.value?.options ?? []);
const feedSections = computed(() => (feed.value?.sections ?? []).filter((section) => section.items.length > 0));
const fallbackItems = computed(() => feed.value?.items ?? []);
const recommendationItems = computed(() => recommendations.value?.items ?? []);
const recommendationTitle = computed(() => recommendations.value?.title ?? 'Recommended for you');
const recommendationSubtitle = computed(() => recommendations.value?.subtitle ?? 'Anonymous recommendations built by the backend.');
const recommendationProfileLine = computed(() => {
  const profile = recommendations.value?.profile;
  if (!profile || (!profile.hasHistory && profile.topSearches.length === 0 && profile.topWatchedTitles.length === 0)) {
    return '';
  }

  const parts: string[] = [];
  if (profile.topSearches.length > 0) {
    parts.push(`Searches: ${profile.topSearches.join(', ')}`);
  }
  if (profile.topWatchedTitles.length > 0) {
    parts.push(`Watched: ${profile.topWatchedTitles.join(', ')}`);
  }

  return parts.join(' | ');
});
const heroItem = computed<RelatedItem | null>(() => {
  const firstSectionItem = feedSections.value[0]?.items[0] ?? null;
  return firstSectionItem ?? fallbackItems.value[0] ?? recommendationItems.value[0] ?? null;
});

const fetchCurrentFeed = async (continuation?: string): Promise<DiscoveryFeedData> => {
  if (mode.value === 'explore') {
    return api.getExplore(selectedOption.value, continuation);
  }

  if (mode.value === 'trending') {
    return api.getTrending(selectedOption.value, continuation);
  }

  return api.getHome(selectedOption.value, continuation);
};

const loadFeed = async () => {
  isLoading.value = true;
  errorMessage.value = '';
  feedLoadError.value = '';
  recommendationLoadError.value = '';

  try {
    const [nextFeed, nextRecommendations] = await Promise.all([
      fetchCurrentFeed(),
      mode.value === 'home'
        ? api.getRecommendations(undefined, 18)
        : Promise.resolve(null),
    ]);

    feed.value = nextFeed;
    recommendations.value = nextRecommendations;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to load front page feed.';
    feed.value = null;
    recommendations.value = null;
  } finally {
    isLoading.value = false;
  }
};

const loadMoreFeed = async () => {
  if (!feed.value?.continuation || isLoadingMoreFeed.value) {
    return;
  }

  isLoadingMoreFeed.value = true;
  feedLoadError.value = '';

  try {
    const nextFeed = await fetchCurrentFeed(feed.value.continuation);
    feed.value = feed.value ? mergeDiscoveryFeed(feed.value, nextFeed) : nextFeed;
  } catch (error) {
    feedLoadError.value = error instanceof Error ? error.message : 'Failed to load more discovery items.';
  } finally {
    isLoadingMoreFeed.value = false;
  }
};

const loadMoreRecommendations = async () => {
  if (!recommendations.value?.continuation || isLoadingMoreRecommendations.value) {
    return;
  }

  isLoadingMoreRecommendations.value = true;
  recommendationLoadError.value = '';

  try {
    const nextRecommendations = await api.getRecommendations(recommendations.value.continuation, 18);
    recommendations.value = recommendations.value
      ? mergeRecommendationFeed(recommendations.value, nextRecommendations)
      : nextRecommendations;
  } catch (error) {
    recommendationLoadError.value = error instanceof Error ? error.message : 'Failed to load more recommendations.';
  } finally {
    isLoadingMoreRecommendations.value = false;
  }
};

const handleSidebarSelect = (value: string) => {
  if (mode.value === 'home') {
    void router.push({ path: '/', query: value ? { filter: value } : {} });
    return;
  }

  void router.push({
    path: '/',
    query: {
      mode: mode.value,
      tab: value,
    },
  });
};

watch([mode, selectedOption], () => {
  void loadFeed();
}, { immediate: true });
</script>
