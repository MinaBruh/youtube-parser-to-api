<template>
  <section class="rail-section panel-card">
    <header class="rail-section__head">
      <div>
        <h2 class="rail-section__title">{{ title }}</h2>
        <p v-if="subtitle" class="rail-section__subtitle">{{ subtitle }}</p>
      </div>
    </header>

    <div class="rail-section__grid">
      <VideoCard
        v-for="item in items"
        :key="`${item.kind}:${item.id}`"
        :item="item"
        layout="grid"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import type { RelatedItem } from '@/lib/api-types';
import VideoCard from './VideoCard.vue';

defineProps<{
  title: string;
  subtitle?: string | null;
  items: RelatedItem[];
}>();
</script>
