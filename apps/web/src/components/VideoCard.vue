<template>
  <article class="video-card" :class="layoutClass">
    <RouterLink class="video-card__thumb-link" :to="targetLocation">
      <div class="video-card__thumb-wrap">
        <img class="video-card__thumb" :src="thumbnailUrl" :alt="item.title" />
        <span v-if="durationLabel" class="video-card__duration">{{ durationLabel }}</span>
      </div>
    </RouterLink>

    <div class="video-card__body">
      <RouterLink class="video-card__title" :to="targetLocation">
        {{ item.title }}
      </RouterLink>
      <p class="video-card__meta">{{ channelLabel }}</p>
      <p class="video-card__meta">{{ infoLabel }}</p>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import type { RelatedItem, SearchResultItem } from '@/lib/api-types';
import { formatRelativeLabel, pickThumbnail } from '@/lib/formatters';

type CardItem = RelatedItem | SearchResultItem;

const props = withDefaults(defineProps<{
  item: CardItem;
  layout?: 'grid' | 'list' | 'rail';
}>(), {
  layout: 'grid',
});

const thumbnailUrl = computed(() => {
  return pickThumbnail(props.item.thumbnails) || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"%3E%3Crect width="320" height="180" fill="%23d9d9d9"/%3E%3C/svg%3E';
});

const durationLabel = computed(() => {
  if ('durationText' in props.item) {
    return props.item.durationText;
  }

  return null;
});

const targetLocation = computed(() => {
  if (props.item.kind === 'channel') {
    return { path: `/channel/${props.item.id}` };
  }

  if (props.item.kind === 'playlist') {
    return { path: `/playlist/${props.item.id}` };
  }

  return { path: '/watch', query: { v: props.item.id } };
});

const channelLabel = computed(() => {
  if ('channel' in props.item && props.item.channel?.name) {
    return props.item.channel.name;
  }

  if ('bylineText' in props.item && props.item.bylineText) {
    return props.item.bylineText;
  }

  return 'YouTube Proxy';
});

const infoLabel = computed(() => {
  if ('viewCountText' in props.item) {
    return formatRelativeLabel(props.item.viewCountText, props.item.publishedText);
  }

  if ('subscriberCountText' in props.item) {
    return formatRelativeLabel(props.item.subscriberCountText, props.item.videoCountText);
  }

  return '';
});

const layoutClass = computed(() => `video-card--${props.layout}`);
</script>
