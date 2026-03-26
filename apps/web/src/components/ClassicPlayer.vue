<template>
  <div class="legacy-player panel-card">
    <div class="legacy-player__stage" @mouseleave="settingsPanel = null">
      <div class="legacy-player__topline">
        <div class="legacy-player__identity">
          <p class="legacy-player__title">{{ props.details.title ?? 'Untitled video' }}</p>
          <div class="legacy-player__pill-row">
            <span v-for="pill in statusPills" :key="pill" class="legacy-player__pill">{{ pill }}</span>
          </div>
        </div>
        <div class="legacy-player__status">{{ engineStatusLabel }}</div>
      </div>

      <video
        ref="videoElement"
        class="legacy-player__video"
        :poster="posterUrl"
        preload="metadata"
        playsinline
        crossorigin="anonymous"
        @click="togglePlayback"
        @dblclick="toggleFullscreen"
        @timeupdate="syncTimeline"
        @loadedmetadata="syncTimeline"
        @durationchange="syncTimeline"
        @progress="syncBuffered"
        @play="isPlaying = true"
        @pause="isPlaying = false"
        @waiting="isLoading = true"
        @canplay="isLoading = false"
        @ended="handleEnded"
      >
        <track
          v-for="track in subtitleTracks"
          :key="track.id"
          kind="subtitles"
          :src="toClientUrl(track.urls.vttProxyUrl) ?? track.urls.vttProxyUrl"
          :srclang="track.languageCode"
          :label="track.name"
        />
      </video>

      <div v-if="isLoading" class="legacy-player__loading">
        {{ loadingLabel }}
      </div>

      <div v-if="playerError" class="legacy-player__loading legacy-player__loading--error">
        {{ playerError }}
      </div>

      <div class="legacy-player__chrome">
        <div class="legacy-player__seek-row">
          <input
            class="legacy-player__seek"
            type="range"
            min="0"
            :max="Math.max(durationSeconds, 1)"
            step="0.1"
            :value="currentTimeSeconds"
            :style="seekStyle"
            @input="handleSeek"
          />
        </div>

        <div class="legacy-player__controls-row">
          <div class="legacy-player__controls-left">
            <button class="legacy-control-button" type="button" @click="togglePlayback">
              {{ isPlaying ? 'Pause' : 'Play' }}
            </button>

            <label class="legacy-volume-control">
              <span>Vol</span>
              <input type="range" min="0" max="1" step="0.05" :value="volumeLevel" @input="handleVolume" />
            </label>

            <span class="legacy-time-label">{{ timeLabel }}</span>
          </div>

          <div class="legacy-player__controls-right">
            <button class="legacy-control-button legacy-control-button--light" type="button" @click="togglePanel('quality')">
              {{ qualityButtonLabel }}
            </button>
            <button class="legacy-control-button legacy-control-button--light" type="button" @click="togglePanel('speed')">
              {{ speedButtonLabel }}
            </button>
            <button class="legacy-control-button legacy-control-button--light" type="button" @click="togglePanel('subtitles')">
              {{ subtitlesButtonLabel }}
            </button>
            <button v-if="audioTrackOptions.length > 1" class="legacy-control-button legacy-control-button--light" type="button" @click="togglePanel('audio')">
              {{ audioButtonLabel }}
            </button>
            <button class="legacy-control-button legacy-control-button--light" type="button" @click="toggleFullscreen">
              Fullscreen
            </button>
          </div>
        </div>

        <p class="legacy-player__footer-note">{{ footerNote }}</p>

        <div v-if="settingsPanel" class="legacy-settings-menu">
          <div v-if="settingsPanel === 'quality'" class="legacy-settings-group">
            <button
              v-for="option in qualityMenuOptions"
              :key="option.id"
              class="legacy-settings-item"
              :class="{ 'is-active': selectedQualityId === option.id }"
              type="button"
              @click="selectQuality(option.id)"
            >
              {{ option.label }}
            </button>
          </div>

          <div v-else-if="settingsPanel === 'speed'" class="legacy-settings-group">
            <button
              v-for="option in speedOptions"
              :key="option"
              class="legacy-settings-item"
              :class="{ 'is-active': selectedSpeed === option }"
              type="button"
              @click="selectSpeed(option)"
            >
              {{ option.toFixed(2) }}x
            </button>
          </div>

          <div v-else-if="settingsPanel === 'subtitles'" class="legacy-settings-group">
            <button
              class="legacy-settings-item"
              :class="{ 'is-active': selectedSubtitleId === 'off' }"
              type="button"
              @click="selectSubtitle('off')"
            >
              Off
            </button>
            <button
              v-for="track in subtitleTracks"
              :key="track.id"
              class="legacy-settings-item"
              :class="{ 'is-active': selectedSubtitleId === track.id }"
              type="button"
              @click="selectSubtitle(track.id)"
            >
              {{ track.name }}
            </button>
          </div>

          <div v-else-if="settingsPanel === 'audio'" class="legacy-settings-group">
            <button
              v-for="track in audioTrackOptions"
              :key="track.id"
              class="legacy-settings-item"
              :class="{ 'is-active': selectedAudioTrackId === track.id }"
              type="button"
              @click="selectAudioTrack(track.id)"
            >
              {{ track.label }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { CaptionTrack, VideoDetailsData, VideoPlaybackData } from '@/lib/api-types';
import { toClientUrl } from '@/lib/api';
import { formatDuration, pickThumbnail } from '@/lib/formatters';

const props = defineProps<{
  details: VideoDetailsData;
  playback: VideoPlaybackData;
  captions: {
    hasCaptions: boolean;
    tracks: CaptionTrack[];
    defaultTrackId: string | null;
  };
}>();

const emit = defineEmits<{
  ended: [];
}>();

type SettingsPanel = 'quality' | 'speed' | 'subtitles' | 'audio' | null;
type PlayerSourceMode = 'dash' | 'hls' | 'muxed' | 'none';

const videoElement = ref<HTMLVideoElement | null>(null);
const isPlaying = ref(false);
const isLoading = ref(true);
const playerError = ref('');
const durationSeconds = ref(0);
const currentTimeSeconds = ref(0);
const bufferedPercent = ref(0);
const volumeLevel = ref(1);
const selectedSpeed = ref(1);
const selectedQualityId = ref('auto');
const selectedSubtitleId = ref('off');
const selectedAudioTrackId = ref('');
const settingsPanel = ref<SettingsPanel>(null);
const sourceMode = ref<PlayerSourceMode>('none');

const speedOptions = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const dashHandle = ref<any>(null);
const hlsHandle = ref<any>(null);

const subtitleTracks = computed(() => props.captions.tracks ?? []);
const audioTrackOptions = computed(() => props.playback.audioTracks ?? []);
const qualityMenuOptions = computed(() => {
  const dynamicOptions = (props.playback.qualityOptions ?? []).map((option) => ({
    id: option.id,
    label: option.label,
  }));

  return [{ id: 'auto', label: 'Auto' }, ...dynamicOptions];
});

const posterUrl = computed(() => pickThumbnail(props.details.thumbnails));
const timeLabel = computed(() => `${formatDuration(Math.round(currentTimeSeconds.value))} / ${formatDuration(Math.round(durationSeconds.value))}`);
const qualityButtonLabel = computed(() => {
  if (selectedQualityId.value === 'auto') {
    return 'Quality: Auto';
  }

  return `Quality: ${qualityMenuOptions.value.find((option) => option.id === selectedQualityId.value)?.label ?? 'Auto'}`;
});
const speedButtonLabel = computed(() => `Speed: ${selectedSpeed.value.toFixed(2)}x`);
const subtitlesButtonLabel = computed(() => {
  if (selectedSubtitleId.value === 'off') {
    return 'CC: Off';
  }

  return `CC: ${subtitleTracks.value.find((track) => track.id === selectedSubtitleId.value)?.name ?? 'On'}`;
});
const audioButtonLabel = computed(() => {
  const activeTrack = audioTrackOptions.value.find((track) => track.id === selectedAudioTrackId.value);
  return `Audio: ${activeTrack?.label ?? 'Default'}`;
});
const engineStatusLabel = computed(() => {
  const labels: string[] = [];

  if (sourceMode.value === 'dash') {
    labels.push('DASH');
  } else if (sourceMode.value === 'hls') {
    labels.push('HLS');
  } else if (sourceMode.value === 'muxed') {
    labels.push('Muxed');
  } else {
    labels.push('Pending');
  }

  labels.push(`${props.playback.qualityOptions.length} q`);

  if (subtitleTracks.value.length) {
    labels.push(`${subtitleTracks.value.length} cc`);
  }

  return labels.join(' | ');
});
const footerNote = computed(() => {
  return [
    props.playback.recommendedPlaybackMode,
    props.playback.audioTracks.length ? `${props.playback.audioTracks.length} audio tracks` : null,
    props.playback.muxedStreams.length ? `${props.playback.muxedStreams.length} muxed streams` : null,
  ].filter((value): value is string => Boolean(value)).join(' • ');
});
const loadingLabel = computed(() => {
  if (sourceMode.value === 'dash') {
    return 'Loading DASH stream...';
  }

  if (sourceMode.value === 'hls') {
    return 'Loading HLS stream...';
  }

  if (sourceMode.value === 'muxed') {
    return 'Loading fallback stream...';
  }

  return 'Loading stream...';
});
const statusPills = computed(() => {
  return [
    props.details.isLive ? 'Live' : null,
    props.details.isPremiere ? 'Premiere' : null,
    props.details.isUpcoming ? 'Upcoming' : null,
    props.details.isShorts ? 'Shorts' : null,
    props.playback.manifests.dashProxyUrl ? 'DASH ready' : null,
    props.playback.manifests.hlsProxyUrl ? 'HLS ready' : null,
  ].filter((value): value is string => Boolean(value));
});
const seekStyle = computed(() => {
  const playedPercent = durationSeconds.value > 0
    ? (currentTimeSeconds.value / durationSeconds.value) * 100
    : 0;

  return {
    background: `linear-gradient(to right, #cc181e 0%, #cc181e ${playedPercent}%, #9c9c9c ${playedPercent}%, #9c9c9c ${Math.max(bufferedPercent.value, playedPercent)}%, #4f4f4f ${Math.max(bufferedPercent.value, playedPercent)}%, #4f4f4f 100%)`,
  };
});

const syncTimeline = () => {
  const video = videoElement.value;
  if (!video) {
    return;
  }

  durationSeconds.value = Number.isFinite(video.duration) ? video.duration : props.playback.durationSeconds ?? 0;
  currentTimeSeconds.value = video.currentTime;
};

const syncBuffered = () => {
  const video = videoElement.value;
  if (!video || !video.duration || video.buffered.length === 0) {
    bufferedPercent.value = 0;
    return;
  }

  try {
    const bufferedEnd = video.buffered.end(video.buffered.length - 1);
    bufferedPercent.value = Math.min(100, (bufferedEnd / video.duration) * 100);
  } catch {
    bufferedPercent.value = 0;
  }
};

const disposePlaybackEngines = () => {
  if (dashHandle.value) {
    dashHandle.value.reset?.();
    dashHandle.value = null;
  }

  if (hlsHandle.value) {
    hlsHandle.value.destroy?.();
    hlsHandle.value = null;
  }
};

const resolveDefaultSourceMode = (): PlayerSourceMode => {
  const fallbackOrder = props.playback.fallbackOrder ?? [];

  for (const strategy of fallbackOrder) {
    if (strategy === 'dash-manifest' && props.playback.manifests.dashProxyUrl) {
      return 'dash';
    }

    if (strategy === 'hls-manifest' && props.playback.manifests.hlsProxyUrl) {
      return 'hls';
    }

    if (strategy === 'muxed-stream' && props.playback.muxedStreams.length > 0) {
      return 'muxed';
    }

    if (strategy === 'adaptive-pair' && props.playback.manifests.dashProxyUrl) {
      return 'dash';
    }
  }

  if (props.playback.manifests.dashProxyUrl) {
    return 'dash';
  }

  if (props.playback.manifests.hlsProxyUrl) {
    return 'hls';
  }

  if (props.playback.muxedStreams.length > 0) {
    return 'muxed';
  }

  return 'none';
};

const resolveMuxedStreamUrl = (): string | null => {
  let candidate = props.playback.muxedStreams[0] ?? null;

  if (selectedQualityId.value !== 'auto') {
    const quality = props.playback.qualityOptions.find((option) => option.id === selectedQualityId.value);
    if (quality?.muxedItag) {
      candidate = props.playback.muxedStreams.find((stream) => stream.itag === quality.muxedItag) ?? candidate;
    }
  } else if (props.playback.defaultSelection?.muxedItag) {
    candidate = props.playback.muxedStreams.find((stream) => stream.itag === props.playback.defaultSelection?.muxedItag) ?? candidate;
  }

  if (selectedAudioTrackId.value) {
    const audioTrack = props.playback.audioTracks.find((track) => track.id === selectedAudioTrackId.value);
    if (audioTrack?.muxedItag) {
      candidate = props.playback.muxedStreams.find((stream) => stream.itag === audioTrack.muxedItag) ?? candidate;
    }
  }

  return candidate ? toClientUrl(candidate.proxyUrl) ?? candidate.proxyUrl : null;
};

const setNativeSource = async (sourceUrl: string): Promise<void> => {
  const video = videoElement.value;
  if (!video) {
    return;
  }

  const resumeAt = video.currentTime || 0;
  const shouldResume = !video.paused;
  video.src = sourceUrl;
  video.load();

  await new Promise<void>((resolve) => {
    const onLoaded = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      resolve();
    };

    video.addEventListener('loadedmetadata', onLoaded, { once: true });
  });

  if (resumeAt > 0 && Number.isFinite(video.duration)) {
    video.currentTime = Math.min(resumeAt, Math.max(video.duration - 1, 0));
  }

  video.playbackRate = selectedSpeed.value;
  video.volume = volumeLevel.value;

  if (shouldResume) {
    void video.play().catch(() => undefined);
  }
};

const applyDashQuality = () => {
  const player = dashHandle.value;
  if (!player) {
    return;
  }

  try {
    if (selectedQualityId.value === 'auto') {
      player.updateSettings?.({ streaming: { abr: { autoSwitchBitrate: { video: true } } } });
      return;
    }

    const targetQuality = props.playback.qualityOptions.find((option) => option.id === selectedQualityId.value);
    const levels = player.getBitrateInfoListFor?.('video') ?? [];
    const targetIndex = levels.findIndex((level: any) => level.height === targetQuality?.height)
      ?? -1;

    player.updateSettings?.({ streaming: { abr: { autoSwitchBitrate: { video: false } } } });
    if (targetIndex >= 0) {
      player.setQualityFor?.('video', targetIndex);
    }
  } catch {
    // keep playback going even if manual quality switching is unavailable
  }
};

const applyDashAudioTrack = () => {
  const player = dashHandle.value;
  const targetTrack = props.playback.audioTracks.find((track) => track.id === selectedAudioTrackId.value);
  if (!player || !targetTrack) {
    return;
  }

  try {
    const tracks = player.getTracksFor?.('audio') ?? [];
    const match = tracks.find((track: any) => {
      return track.lang === targetTrack.language || track.labels?.[0]?.text === targetTrack.label || track.label === targetTrack.label;
    });

    if (match) {
      player.setCurrentTrack?.(match);
    }
  } catch {
    // ignore when engine does not expose audio track switching
  }
};

const applyHlsQuality = () => {
  const player = hlsHandle.value;
  if (!player) {
    return;
  }

  if (selectedQualityId.value === 'auto') {
    player.currentLevel = -1;
    return;
  }

  const targetQuality = props.playback.qualityOptions.find((option) => option.id === selectedQualityId.value);
  const targetIndex = player.levels.findIndex((level: any) => level.height === targetQuality?.height);
  if (targetIndex >= 0) {
    player.currentLevel = targetIndex;
  }
};

const applyHlsAudioTrack = () => {
  const player = hlsHandle.value;
  const targetTrack = props.playback.audioTracks.find((track) => track.id === selectedAudioTrackId.value);
  if (!player || !targetTrack) {
    return;
  }

  const targetIndex = player.audioTracks.findIndex((track: any) => {
    return track.lang === targetTrack.language || track.name === targetTrack.label;
  });

  if (targetIndex >= 0) {
    player.audioTrack = targetIndex;
  }
};

const applySubtitleSelection = async () => {
  await nextTick();
  const video = videoElement.value;
  if (!video) {
    return;
  }

  const tracks = Array.from(video.textTracks);
  for (const track of tracks) {
    track.mode = 'disabled';
  }

  if (selectedSubtitleId.value === 'off') {
    return;
  }

  const index = subtitleTracks.value.findIndex((track) => track.id === selectedSubtitleId.value);
  if (index >= 0 && video.textTracks[index]) {
    video.textTracks[index].mode = 'showing';
  }
};

const initializePlayback = async () => {
  const video = videoElement.value;
  if (!video) {
    return;
  }

  disposePlaybackEngines();
  playerError.value = '';
  isLoading.value = true;
  sourceMode.value = resolveDefaultSourceMode();

  try {
    if (sourceMode.value === 'dash') {
      const dashUrl = toClientUrl(props.playback.manifests.dashProxyUrl) ?? props.playback.manifests.dashProxyUrl;
      if (!dashUrl) {
        throw new Error('DASH manifest is unavailable.');
      }

      const dashjsModule = await import('dashjs');
      const dashjs = (dashjsModule as any).default ?? dashjsModule;
      const player = dashjs.MediaPlayer().create();
      player.initialize(video, dashUrl, false);
      player.updateSettings?.({ streaming: { abr: { autoSwitchBitrate: { video: selectedQualityId.value === 'auto' } } } });
      dashHandle.value = player;
      applyDashQuality();
      applyDashAudioTrack();
    } else if (sourceMode.value === 'hls') {
      const hlsUrl = toClientUrl(props.playback.manifests.hlsProxyUrl) ?? props.playback.manifests.hlsProxyUrl;
      if (!hlsUrl) {
        throw new Error('HLS manifest is unavailable.');
      }

      const hlsModule = await import('hls.js');
      const Hls = (hlsModule as any).default ?? hlsModule;

      if (Hls.isSupported?.()) {
        const instance = new Hls({ enableWorker: true });
        instance.loadSource(hlsUrl);
        instance.attachMedia(video);
        hlsHandle.value = instance;
        instance.on(Hls.Events.MANIFEST_PARSED, () => {
          applyHlsQuality();
          applyHlsAudioTrack();
          isLoading.value = false;
        });
      } else {
        await setNativeSource(hlsUrl);
      }
    } else if (sourceMode.value === 'muxed') {
      const muxedUrl = resolveMuxedStreamUrl();
      if (!muxedUrl) {
        throw new Error('No muxed fallback stream is available for this video.');
      }

      await setNativeSource(muxedUrl);
    } else {
      throw new Error('No playable source was returned by the API.');
    }

    await applySubtitleSelection();
  } catch (error) {
    playerError.value = error instanceof Error ? error.message : 'Failed to initialize player.';
    isLoading.value = false;
  }
};

const togglePlayback = () => {
  const video = videoElement.value;
  if (!video) {
    return;
  }

  if (video.paused) {
    void video.play().catch(() => undefined);
  } else {
    video.pause();
  }
};

const handleSeek = (event: Event) => {
  const video = videoElement.value;
  const target = event.target as HTMLInputElement;
  if (!video) {
    return;
  }

  video.currentTime = Number(target.value);
  currentTimeSeconds.value = video.currentTime;
};

const seekTo = (seconds: number) => {
  const video = videoElement.value;
  if (!video) {
    return;
  }

  video.currentTime = Math.max(0, seconds);
  currentTimeSeconds.value = video.currentTime;
};

const play = async () => {
  if (!videoElement.value) {
    return;
  }

  await videoElement.value.play().catch(() => undefined);
};

const handleVolume = (event: Event) => {
  const video = videoElement.value;
  const target = event.target as HTMLInputElement;
  const nextVolume = Number(target.value);
  volumeLevel.value = nextVolume;

  if (video) {
    video.volume = nextVolume;
  }
};

const togglePanel = (panel: Exclude<SettingsPanel, null>) => {
  settingsPanel.value = settingsPanel.value === panel ? null : panel;
};

const toggleFullscreen = async () => {
  const video = videoElement.value;
  if (!video) {
    return;
  }

  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => undefined);
    return;
  }

  await video.requestFullscreen?.().catch(() => undefined);
};

const selectQuality = async (qualityId: string) => {
  selectedQualityId.value = qualityId;
  settingsPanel.value = null;

  if (sourceMode.value === 'dash') {
    applyDashQuality();
    return;
  }

  if (sourceMode.value === 'hls') {
    applyHlsQuality();
    return;
  }

  await initializePlayback();
};

const selectSpeed = (speed: number) => {
  selectedSpeed.value = speed;
  settingsPanel.value = null;

  if (videoElement.value) {
    videoElement.value.playbackRate = speed;
  }
};

const selectSubtitle = async (subtitleId: string) => {
  selectedSubtitleId.value = subtitleId;
  settingsPanel.value = null;
  await applySubtitleSelection();
};

const selectAudioTrack = async (audioTrackId: string) => {
  selectedAudioTrackId.value = audioTrackId;
  settingsPanel.value = null;

  if (sourceMode.value === 'dash') {
    applyDashAudioTrack();
    return;
  }

  if (sourceMode.value === 'hls') {
    applyHlsAudioTrack();
    return;
  }

  await initializePlayback();
};

const handleEnded = () => {
  emit('ended');
};

watch(
  () => props.playback.id,
  () => {
    selectedQualityId.value = props.playback.defaultSelection?.qualityId ?? 'auto';
    selectedAudioTrackId.value = props.playback.defaultSelection?.audioTrackId ?? audioTrackOptions.value[0]?.id ?? '';
    selectedSubtitleId.value = 'off';
    void initializePlayback();
  },
  { immediate: true },
);

watch(
  subtitleTracks,
  () => {
    void applySubtitleSelection();
  },
  { deep: true },
);

onMounted(() => {
  const video = videoElement.value;
  if (video) {
    video.volume = volumeLevel.value;
    video.playbackRate = selectedSpeed.value;
  }

  void initializePlayback();
});

onBeforeUnmount(() => {
  disposePlaybackEngines();
});

defineExpose({
  play,
  seekTo,
});
</script>
