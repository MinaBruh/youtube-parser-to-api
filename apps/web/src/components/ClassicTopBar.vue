<template>
  <header class="classic-header">
    <div class="classic-header__left">
      <RouterLink class="classic-logo" to="/">
        <span class="classic-logo__wordmark">You</span>
        <span class="classic-logo__badge">Tube</span>
      </RouterLink>
      <button class="classic-header__menu" type="button" aria-label="Browse">
        ?
      </button>
    </div>

    <form class="classic-search" @submit.prevent="submitSearch">
      <input
        v-model="searchQuery"
        class="classic-search__input"
        type="search"
        placeholder="Search"
        autocomplete="off"
      />
      <button class="classic-search__button" type="submit" aria-label="Search">
        <span>?</span>
      </button>
    </form>

    <div class="classic-header__right">
      <button class="classic-header__utility" type="button">Upload</button>
      <button class="classic-header__signin" type="button">Sign in</button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();
const searchQuery = ref('');

const routeSearchQuery = computed(() => {
  const rawValue = route.query.search_query;
  return typeof rawValue === 'string' ? rawValue : '';
});

watch(
  routeSearchQuery,
  (value) => {
    searchQuery.value = value;
  },
  { immediate: true },
);

const submitSearch = () => {
  const normalizedQuery = searchQuery.value.trim();
  if (!normalizedQuery) {
    void router.push({ path: '/' });
    return;
  }

  void router.push({
    path: '/results',
    query: {
      search_query: normalizedQuery,
      type: 'all',
    },
  });
};
</script>
