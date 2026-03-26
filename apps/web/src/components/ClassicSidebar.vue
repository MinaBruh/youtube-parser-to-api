<template>
  <aside class="classic-sidebar">
    <div class="classic-sidebar__section">
      <p class="classic-sidebar__title">What to Watch</p>
      <RouterLink
        class="classic-sidebar__link"
        :class="{ 'is-active': activeKey === 'home' }"
        to="/"
      >
        Home
      </RouterLink>
      <RouterLink
        class="classic-sidebar__link"
        :class="{ 'is-active': activeKey === 'explore' }"
        :to="{ path: '/', query: { mode: 'explore' } }"
      >
        Explore
      </RouterLink>
      <RouterLink
        class="classic-sidebar__link"
        :class="{ 'is-active': activeKey === 'trending' }"
        :to="{ path: '/', query: { mode: 'trending' } }"
      >
        Trending
      </RouterLink>
    </div>

    <div class="classic-sidebar__section" v-if="items.length > 0">
      <p class="classic-sidebar__title">Browse</p>
      <button
        v-for="item in items"
        :key="item.id"
        class="classic-sidebar__button"
        :class="{ 'is-active': item.selected }"
        type="button"
        @click="$emit('select', item.id)"
      >
        {{ item.label }}
      </button>
    </div>

    <div class="classic-sidebar__signin-box">
      <p>Sign in to see your channels and recommendations.</p>
      <button class="classic-header__signin" type="button">Sign in</button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import type { DiscoveryFeedOption } from '@/lib/api-types';

const props = defineProps<{
  items?: DiscoveryFeedOption[];
}>();

defineEmits<{
  (event: 'select', value: string): void;
}>();

const route = useRoute();

const activeKey = computed(() => {
  const mode = typeof route.query.mode === 'string' ? route.query.mode : 'home';
  return mode;
});

const items = computed(() => props.items ?? []);
</script>
