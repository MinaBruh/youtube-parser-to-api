<template>
  <main class="playlist-page page-frame">
    <section v-if="isLoading" class="panel-card loading-card">
      <p>Loading playlist...</p>
    </section>

    <section v-else-if="errorMessage" class="panel-card error-card">
      <h2>Playlist unavailable</h2>
      <p>{{ errorMessage }}</p>
    </section>

    <template v-else-if="playlist">
      <section class="playlist-page-grid">
        <aside class="playlist-summary-column">
          <section class="panel-card playlist-hero-card">
            <img class="playlist-hero-thumb" :src="playlistThumbnail" :alt="playlist.title ?? 'Playlist thumbnail'" />

            <div class="playlist-hero-copy">
              <p class="browse-hero__eyebrow">Playlist</p>
              <h1>{{ playlist.title ?? playlist.id }}</h1>
              <p class="playlist-hero-meta">{{ playlistMeta }}</p>
              <p class="playlist-hero-submeta">{{ playlistSecondaryMeta }}</p>
              <p class="playlist-hero-description">{{ playlist.description || 'No public description was returned for this playlist.' }}</p>

              <div class="playlist-hero-actions">
                <RouterLink
                  v-if="firstPlayableVideoId"
                  class="watch-action-button"
                  :to="{ path: '/watch', query: { v: firstPlayableVideoId } }"
                >
                  Play from top
                </RouterLink>
                <RouterLink
                  v-if="playlist.channel?.id"
                  class="watch-action-button"
                  :to="{ path: `/channel/${playlist.channel.id}` }"
                >
                  Open channel
                </RouterLink>
              </div>
            </div>
          </section>

          <section class="panel-card playlist-side-card">
            <header class="watch-side-summary-card__head">
              <h2>Queue summary</h2>
              <span>Classic playlist rail</span>
            </header>

            <dl class="watch-side-summary-grid">
              <div>
                <dt>Total items</dt>
                <dd>{{ playlist.totalItemsText ?? playlist.items.length }}</dd>
              </div>
              <div>
                <dt>Views</dt>
                <dd>{{ playlist.viewCountText ?? 'Unavailable' }}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{{ playlist.lastUpdatedText ?? 'Unknown' }}</dd>
              </div>
              <div>
                <dt>Privacy</dt>
                <dd>{{ playlist.privacy ?? 'Public' }}</dd>
              </div>
            </dl>
          </section>
        </aside>

        <section class="panel-card playlist-items-card">
          <header class="playlist-items-card__head">
            <div>
              <p class="browse-hero__eyebrow">Playlist queue</p>
              <h2>{{ playlist.title ?? 'Playlist items' }}</h2>
              <p>{{ playlist.subtitle ?? 'Public queue rendered through the proxy API.' }}</p>
            </div>
          </header>

          <div v-if="playlist.items.length === 0" class="empty-card">
            <h2>No items</h2>
            <p>This playlist did not expose public entries.</p>
          </div>

          <article v-for="entry in playlist.items" :key="`${entry.id}-${entry.indexText ?? 'row'}`" class="playlist-entry-row">
            <div class="playlist-entry-row__index">{{ entry.indexText ?? '-' }}</div>

            <RouterLink class="playlist-entry-row__thumb-link" :to="{ path: '/watch', query: { v: entry.id } }">
              <div class="playlist-entry-row__thumb-wrap">
                <img class="playlist-entry-row__thumb" :src="entryThumbnail(entry)" :alt="entry.title" />
                <span v-if="entry.durationText" class="video-card__duration">{{ entry.durationText }}</span>
              </div>
            </RouterLink>

            <div class="playlist-entry-row__body">
              <RouterLink class="video-card__title" :to="{ path: '/watch', query: { v: entry.id } }">
                {{ entry.title }}
              </RouterLink>
              <p class="video-card__meta">{{ entry.channel?.name ?? playlist.channel?.name ?? 'Playlist entry' }}</p>
              <p class="video-card__meta">{{ formatRelativeLabel(entry.videoInfoText, entry.liveLifecycle) }}</p>
              <div class="playlist-entry-row__badges">
                <span v-if="entry.isLive" class="watch-title-badge">Live</span>
                <span v-if="entry.isUpcoming" class="watch-title-badge">Upcoming</span>
                <span v-if="entry.isPremiere" class="watch-title-badge">Premiere</span>
                <span v-if="!entry.isPlayable" class="watch-title-badge">Unavailable</span>
              </div>
            </div>
          </article>

          <div class="watch-load-more-row" v-if="playlist.hasContinuation || loadMoreError">
            <p v-if="loadMoreError" class="browse-load-error">{{ loadMoreError }}</p>
            <button
              v-if="playlist.hasContinuation"
              class="watch-load-more-button"
              type="button"
              :disabled="isLoadingMore"
              @click="loadMore"
            >
              {{ isLoadingMore ? 'Loading...' : 'Load more' }}
            </button>
          </div>
        </section>
      </section>
    </template>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { api } from '@/lib/api';
import type { PlaylistDetailsData, PlaylistEntry } from '@/lib/api-types';
import { formatRelativeLabel, pickThumbnail } from '@/lib/formatters';

const route = useRoute();
const playlist = ref<PlaylistDetailsData | null>(null);
const isLoading = ref(true);
const isLoadingMore = ref(false);
const errorMessage = ref('');
const loadMoreError = ref('');

const playlistId = computed(() => String(route.params.playlistId ?? '').trim());
const playlistThumbnail = computed(() => pickThumbnail(playlist.value?.thumbnails) || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270"%3E%3Crect width="480" height="270" fill="%23d9d9d9"/%3E%3C/svg%3E');
const firstPlayableVideoId = computed(() => playlist.value?.items.find((entry) => entry.isPlayable)?.id ?? null);
const playlistMeta = computed(() => formatRelativeLabel(
  playlist.value?.channel?.name,
  playlist.value?.totalItemsText,
  playlist.value?.viewCountText,
));
const playlistSecondaryMeta = computed(() => formatRelativeLabel(
  playlist.value?.lastUpdatedText,
  playlist.value?.privacy,
  playlist.value?.isEditable ? 'Editable' : null,
));

const entryThumbnail = (entry: PlaylistEntry) => {
  return pickThumbnail(entry.thumbnails) || playlistThumbnail.value;
};

const loadPlaylist = async () => {
  if (!playlistId.value) {
    errorMessage.value = 'Missing playlist id.';
    isLoading.value = false;
    playlist.value = null;
    return;
  }

  isLoading.value = true;
  errorMessage.value = '';
  loadMoreError.value = '';

  try {
    playlist.value = await api.getPlaylist(playlistId.value);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to load playlist.';
    playlist.value = null;
  } finally {
    isLoading.value = false;
  }
};

const loadMore = async () => {
  if (!playlist.value?.continuation || isLoadingMore.value) {
    return;
  }

  isLoadingMore.value = true;
  loadMoreError.value = '';

  try {
    const nextPage = await api.getPlaylist(playlistId.value, playlist.value.continuation);
    playlist.value = {
      ...playlist.value,
      ...nextPage,
      items: [...playlist.value.items, ...nextPage.items],
    };
  } catch (error) {
    loadMoreError.value = error instanceof Error ? error.message : 'Failed to load more playlist items.';
  } finally {
    isLoadingMore.value = false;
  }
};

watch(playlistId, () => {
  void loadPlaylist();
}, { immediate: true });
</script>
