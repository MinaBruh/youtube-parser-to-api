<template>
  <main class="browse-layout page-frame">
    <ClassicSidebar />

    <section class="browse-content">
      <header class="browse-hero panel-card browse-hero--search">
        <div>
          <p class="browse-hero__eyebrow">Search Results</p>
          <h1>{{ heading }}</h1>
          <p>{{ subtitle }}</p>
        </div>

        <div class="search-filter-row">
          <button
            v-for="option in typeOptions"
            :key="option.id"
            class="search-filter-pill"
            :class="{ 'is-active': option.id === selectedType }"
            type="button"
            @click="setType(option.id)"
          >
            {{ option.label }}
          </button>
        </div>
      </header>

      <section v-if="isLoading" class="panel-card loading-card">
        <p>Searching the archive...</p>
      </section>

      <section v-else-if="errorMessage" class="panel-card error-card">
        <h2>Search failed</h2>
        <p>{{ errorMessage }}</p>
      </section>

      <section v-else-if="results.length === 0" class="panel-card empty-card">
        <h2>No results</h2>
        <p>Try another query or switch the result type.</p>
      </section>

      <section v-else class="search-results-stack panel-card">
        <VideoCard
          v-for="item in results"
          :key="`${item.kind}:${item.id}`"
          :item="item"
          layout="list"
        />
      </section>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ClassicSidebar from '@/components/ClassicSidebar.vue';
import VideoCard from '@/components/VideoCard.vue';
import { api } from '@/lib/api';
import type { SearchResultItem } from '@/lib/api-types';

const route = useRoute();
const router = useRouter();
const results = ref<SearchResultItem[]>([]);
const isLoading = ref(true);
const errorMessage = ref('');

const query = computed(() => {
  const rawValue = route.query.search_query;
  return typeof rawValue === 'string' ? rawValue.trim() : '';
});

const selectedType = computed(() => {
  const rawValue = route.query.type;
  return typeof rawValue === 'string' ? rawValue : 'all';
});

const typeOptions = [
  { id: 'all', label: 'All' },
  { id: 'video', label: 'Videos' },
  { id: 'shorts', label: 'Shorts' },
  { id: 'playlist', label: 'Playlists' },
  { id: 'channel', label: 'Channels' },
];

const heading = computed(() => query.value || 'Search the proxy');
const subtitle = computed(() => {
  return query.value
    ? `Showing ${selectedType.value} results for "${query.value}".`
    : 'Use the search bar above to start browsing.';
});

const loadResults = async () => {
  if (!query.value) {
    results.value = [];
    isLoading.value = false;
    errorMessage.value = '';
    return;
  }

  isLoading.value = true;
  errorMessage.value = '';

  try {
    const response = await api.search(query.value, undefined, selectedType.value);
    results.value = response.items;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to load search results.';
    results.value = [];
  } finally {
    isLoading.value = false;
  }
};

const setType = (type: string) => {
  void router.push({
    path: '/results',
    query: {
      search_query: query.value,
      type,
    },
  });
};

watch([query, selectedType], () => {
  void loadResults();
}, { immediate: true });
</script>

