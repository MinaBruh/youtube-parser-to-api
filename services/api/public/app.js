const DEFAULT_PLAYLIST_ID = 'UUXZCJLdBC09xxGZ6gcdrc6A';
const DEFAULT_SEARCH_QUERY = 'openai';

const state = {
  currentVideoId: null,
  currentPlaylistId: null,
  currentChannelId: null,
  currentVideo: null,
  currentPlayback: null,
  currentStream: null,
  currentPlaylist: null,
  currentChannel: null,
  currentRelated: null,
  searchResults: [],
  searchQuery: '',
};

const elements = {
  searchForm: document.querySelector('#search-form'),
  searchQuery: document.querySelector('#search-query'),
  searchType: document.querySelector('#search-type'),
  searchLimit: document.querySelector('#search-limit'),
  videoForm: document.querySelector('#video-form'),
  videoIdInput: document.querySelector('#video-id-input'),
  playlistForm: document.querySelector('#playlist-form'),
  playlistIdInput: document.querySelector('#playlist-id-input'),
  channelForm: document.querySelector('#channel-form'),
  channelIdInput: document.querySelector('#channel-id-input'),
  statusIndicator: document.querySelector('#status-indicator'),
  statusText: document.querySelector('#status-text'),
  player: document.querySelector('#player'),
  playerOverlay: document.querySelector('#player-overlay'),
  streamPillRow: document.querySelector('#stream-pill-row'),
  videoMeta: document.querySelector('#video-meta'),
  playlistMeta: document.querySelector('#playlist-meta'),
  playlistItems: document.querySelector('#playlist-items'),
  resultsSummary: document.querySelector('#results-summary'),
  searchResults: document.querySelector('#search-results'),
  relatedSummary: document.querySelector('#related-summary'),
  relatedItems: document.querySelector('#related-items'),
  channelCard: document.querySelector('#channel-card'),
};

const escapeHtml = (value) => {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
};

const isNonEmptyString = (value) => {
  return typeof value === 'string' && value.trim().length > 0;
};

const pickThumbnail = (thumbnails) => {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) {
    return '';
  }

  const preferred = thumbnails[thumbnails.length - 1] ?? thumbnails[0] ?? null;
  return preferred?.proxyUrl ?? preferred?.url ?? thumbnails[0]?.proxyUrl ?? thumbnails[0]?.url ?? '';
};

const createPlaceholderImage = (label) => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" role="img" aria-label="${label}">
      <rect width="320" height="180" fill="#d9d9d9" />
      <text
        x="160"
        y="96"
        text-anchor="middle"
        font-family="Trebuchet MS, Tahoma, Verdana, sans-serif"
        font-size="22"
        fill="#666666"
      >${label}</text>
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

const setStatus = (label, message, tone = 'idle') => {
  elements.statusIndicator.textContent = label;
  elements.statusIndicator.dataset.tone = tone;
  elements.statusText.textContent = message;
};

const showPlayerOverlay = ({ eyebrow, title, body }) => {
  elements.playerOverlay.innerHTML = `
    <p class="player-overlay__eyebrow">${escapeHtml(eyebrow)}</p>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(body)}</p>
  `;
  elements.playerOverlay.classList.add('is-visible');
};

const hidePlayerOverlay = () => {
  elements.playerOverlay.classList.remove('is-visible');
};

const createApiUrl = (path, searchParams = {}) => {
  const url = new URL(path, window.location.origin);

  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url.toString();
};

const fetchApi = async (path, searchParams) => {
  const response = await fetch(createApiUrl(path, searchParams));
  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.ok) {
    const errorMessage = payload?.message ?? `Request failed with status ${response.status}`;
    throw new Error(errorMessage);
  }

  return payload.data;
};

const pickPlayableStream = (playback) => {
  const muxed = Array.isArray(playback?.muxedStreams) ? playback.muxedStreams : [];

  if (muxed.length === 0) {
    return null;
  }

  const preferredMuxedItag = playback?.defaultSelection?.muxedItag;
  const preferredStream = preferredMuxedItag
    ? muxed.find((stream) => stream.itag === preferredMuxedItag) ?? null
    : null;

  if (preferredStream) {
    return preferredStream;
  }

  const mp4 = muxed.filter((stream) => stream.mimeType?.includes('mp4'));
  const candidates = mp4.length > 0 ? mp4 : muxed;

  return [...candidates].sort((left, right) => {
    const leftHeight = left.height ?? 0;
    const rightHeight = right.height ?? 0;

    if (rightHeight !== leftHeight) {
      return rightHeight - leftHeight;
    }

    return (right.bitrate ?? 0) - (left.bitrate ?? 0);
  })[0] ?? null;
};

const describeStream = (stream) => {
  if (!stream) {
    return 'No direct muxed stream';
  }

  const quality = stream.qualityLabel ?? stream.quality ?? 'Auto';
  const container = stream.container?.toUpperCase() ?? 'Stream';
  const audioTrack = stream.audioTrackName ? ` | ${stream.audioTrackName}` : '';
  return `${quality} ${container}${audioTrack}`;
};

const renderStreamPills = () => {
  const playback = state.currentPlayback;
  const stream = state.currentStream;

  if (!playback) {
    elements.streamPillRow.innerHTML = '';
    return;
  }

  const pills = [
    {
      label: 'Selected',
      value: describeStream(stream),
    },
    {
      label: 'Muxed',
      value: String(playback.muxedStreams.length),
    },
    {
      label: 'Tracks',
      value: String(Array.isArray(playback.audioTracks) ? playback.audioTracks.length : 0),
    },
    {
      label: 'Qualities',
      value: String(Array.isArray(playback.qualityOptions) ? playback.qualityOptions.length : 0),
    },
    {
      label: 'Fallback',
      value: Array.isArray(playback.fallbackOrder) && playback.fallbackOrder.length > 0
        ? playback.fallbackOrder[0]
        : 'none',
    },
    {
      label: 'Status',
      value: playback.playabilityStatus ?? 'Unknown',
    },
  ];

  elements.streamPillRow.innerHTML = pills.map((pill) => `
    <span class="stream-pill">
      <span class="pill-label">${escapeHtml(pill.label)}</span>
      <strong>${escapeHtml(pill.value)}</strong>
    </span>
  `).join('');
};

const renderVideoMeta = () => {
  const video = state.currentVideo;
  const playback = state.currentPlayback;
  const stream = state.currentStream;

  if (!video) {
    elements.videoMeta.className = 'video-meta empty-state';
    elements.videoMeta.innerHTML = '<p>No video selected yet.</p>';
    renderStreamPills();
    return;
  }

  const tags = Array.isArray(video.tags) ? video.tags.slice(0, 8) : [];
  const tagMarkup = tags.length > 0
    ? tags.map((tag) => `<span class="info-pill">#${escapeHtml(tag)}</span>`).join('')
    : '<span class="info-pill">No tags</span>';

  const channelName = video.channel?.name ?? 'Unknown channel';
  const metrics = [
    {
      label: 'Views',
      value: video.viewCount ? new Intl.NumberFormat().format(video.viewCount) : 'Unavailable',
    },
    {
      label: 'Duration',
      value: video.durationSeconds ? `${video.durationSeconds}s` : 'Live / unknown',
    },
    {
      label: 'Playability',
      value: video.playabilityStatus ?? playback?.playabilityStatus ?? 'Unknown',
    },
    {
      label: 'Source',
      value: describeStream(stream),
    },
  ];

  elements.videoMeta.className = 'video-meta';
  elements.videoMeta.innerHTML = `
    <div class="video-head">
      <div>
        <h3 class="video-title">${escapeHtml(video.title ?? state.currentVideoId)}</h3>
        <p class="video-subline">
          ${escapeHtml(channelName)}
          ${video.category ? ` � ${escapeHtml(video.category)}` : ''}
          ${video.isLive ? ' � Live' : ''}
          ${video.isUpcoming ? ' � Upcoming' : ''}
        </p>
      </div>

      <div class="pill-row">${tagMarkup}</div>
    </div>

    <div class="metric-grid">
      ${metrics.map((metric) => `
        <div class="metric-card">
          <span class="metric-label">${escapeHtml(metric.label)}</span>
          <strong>${escapeHtml(metric.value)}</strong>
        </div>
      `).join('')}
    </div>

    <div class="description-block">${escapeHtml(video.description ?? 'No description available.')}</div>
  `;

  renderStreamPills();
};

const renderPlaylist = () => {
  const playlist = state.currentPlaylist;

  if (!playlist) {
    elements.playlistMeta.className = 'playlist-meta empty-state';
    elements.playlistMeta.innerHTML = '<p>No playlist loaded yet.</p>';
    elements.playlistItems.innerHTML = '';
    return;
  }

  const pills = [
    playlist.totalItemsText,
    playlist.viewCountText,
    playlist.lastUpdatedText,
    playlist.privacy,
    playlist.hasContinuation ? 'Has continuation' : 'Single page',
  ].filter(isNonEmptyString);

  elements.playlistMeta.className = 'playlist-meta';
  elements.playlistMeta.innerHTML = `
    <div class="playlist-header">
      <div>
        <p class="utility-title">Active Playlist</p>
        <h3 class="playlist-title">${escapeHtml(playlist.title ?? state.currentPlaylistId)}</h3>
        <p class="playlist-subline">
          ${escapeHtml(playlist.channel?.name ?? 'Unknown owner')}
          ${playlist.subtitle ? ` � ${escapeHtml(playlist.subtitle)}` : ''}
        </p>
      </div>
      <div class="pill-row">
        ${pills.map((pill) => `<span class="info-pill">${escapeHtml(pill)}</span>`).join('')}
      </div>
      <div class="description-block">${escapeHtml(playlist.description ?? 'No playlist description available.')}</div>
    </div>
  `;

  elements.playlistItems.innerHTML = playlist.items.map((item) => {
    const isActive = item.id === state.currentVideoId;
    const thumb = pickThumbnail(item.thumbnails) || createPlaceholderImage('No Thumb');

    return `
      <div
        class="playlist-item ${isActive ? 'is-active' : ''}"
        role="button"
        tabindex="0"
        data-playlist-video-id="${escapeHtml(item.id)}"
      >
        <div class="playlist-thumb">
          <img src="${escapeHtml(thumb)}" alt="" />
        </div>
        <div class="playlist-item-body">
          <div class="pill-row">
            <span class="result-kind" data-kind="${escapeHtml(item.kind)}">${escapeHtml(item.kind)}</span>
            ${item.durationText ? `<span class="info-pill">${escapeHtml(item.durationText)}</span>` : ''}
            ${item.indexText ? `<span class="info-pill">#${escapeHtml(item.indexText)}</span>` : ''}
          </div>
          <h4 class="playlist-item-title">${escapeHtml(item.title)}</h4>
          <p class="item-meta">
            ${escapeHtml(item.channel?.name ?? playlist.channel?.name ?? 'Unknown owner')}
            ${item.videoInfoText ? ` � ${escapeHtml(item.videoInfoText)}` : ''}
          </p>
        </div>
      </div>
    `;
  }).join('');

  bindPlaylistActions();
};

const renderResults = () => {
  const items = state.searchResults;

  if (!Array.isArray(items) || items.length === 0) {
    elements.searchResults.className = 'result-list empty-state';
    elements.resultsSummary.textContent = state.searchQuery
      ? `No results for �${state.searchQuery}�.`
      : 'No search performed yet.';
    elements.searchResults.innerHTML = '<p>Try a broader query or switch the result type.</p>';
    return;
  }

  elements.searchResults.className = 'result-list';
  elements.resultsSummary.textContent = `${items.length} result${items.length === 1 ? '' : 's'} for �${state.searchQuery}�.`;
  elements.searchResults.innerHTML = items.map((item) => {
    const title = item.title ?? item.name ?? item.id;
    const subtitle = item.kind === 'channel'
      ? [item.subscriberCountText, item.videoCountText].filter(isNonEmptyString).join(' � ')
      : item.kind === 'playlist'
        ? [item.channel?.name, item.videoCountText].filter(isNonEmptyString).join(' � ')
        : [item.channel?.name, item.viewCountText, item.publishedText].filter(isNonEmptyString).join(' � ');
    const thumb = pickThumbnail(item.thumbnails) || createPlaceholderImage('No Thumb');

    return `
      <div
        class="result-card"
        role="button"
        tabindex="0"
        data-result-id="${escapeHtml(item.id)}"
        data-result-kind="${escapeHtml(item.kind)}"
      >
        <div class="result-thumb">
          <img src="${escapeHtml(thumb)}" alt="" />
        </div>
        <div class="result-body">
          <div class="pill-row">
            <span class="result-kind" data-kind="${escapeHtml(item.kind)}">${escapeHtml(item.kind)}</span>
            ${item.durationText ? `<span class="info-pill">${escapeHtml(item.durationText)}</span>` : ''}
          </div>
          <h3 class="result-title">${escapeHtml(title)}</h3>
          <p class="result-meta">${escapeHtml(subtitle || 'No extra metadata')}</p>
          ${item.description ? `<p class="result-meta">${escapeHtml(item.description)}</p>` : ''}
        </div>
      </div>
    `;
  }).join('');

  bindResultActions();
};

const renderRelated = () => {
  const related = state.currentRelated;

  if (!related) {
    elements.relatedItems.className = 'result-list empty-state';
    elements.relatedSummary.textContent = 'Open a video to load related content.';
    elements.relatedItems.innerHTML = '<p>Related recommendations will appear here once a video is active.</p>';
    return;
  }

  if (related.isLoading) {
    elements.relatedItems.className = 'result-list empty-state';
    elements.relatedSummary.textContent = 'Loading watch-next rail...';
    elements.relatedItems.innerHTML = '<p>Fetching related videos, playlists and channels for the active watch page.</p>';
    return;
  }

  const items = Array.isArray(related.items) ? related.items : [];

  if (items.length === 0) {
    elements.relatedItems.className = 'result-list empty-state';
    elements.relatedSummary.textContent = related.errorMessage
      ? 'Related rail could not be loaded.'
      : 'No related content was returned for the active video.';
    elements.relatedItems.innerHTML = `<p>${escapeHtml(related.errorMessage ?? 'Try another video to inspect a different watch-next rail.')}</p>`;
    return;
  }

  const summaryParts = [
    related.autoplayVideoId ? `Autoplay ${related.autoplayVideoId}` : null,
    related.hasContinuation ? 'Has continuation' : 'Single page',
    Array.isArray(related.filters) && related.filters.length > 0
      ? `Filters: ${related.filters.join(', ')}`
      : 'Default rail',
  ].filter(isNonEmptyString);

  elements.relatedItems.className = 'result-list';
  elements.relatedSummary.textContent = summaryParts.join(' � ');
  elements.relatedItems.innerHTML = items.map((item) => {
    const subtitle = item.kind === 'channel'
      ? [item.subscriberCountText, item.videoCountText].filter(isNonEmptyString).join(' � ')
      : item.kind === 'playlist'
        ? [item.bylineText, item.videoCountText].filter(isNonEmptyString).join(' � ')
        : [item.bylineText, item.viewCountText, item.publishedText].filter(isNonEmptyString).join(' � ');
    const thumb = pickThumbnail(item.thumbnails) || createPlaceholderImage('Related');

    return `
      <div
        class="result-card"
        role="button"
        tabindex="0"
        data-related-id="${escapeHtml(item.id)}"
        data-related-kind="${escapeHtml(item.kind)}"
      >
        <div class="result-thumb">
          <img src="${escapeHtml(thumb)}" alt="" />
        </div>
        <div class="result-body">
          <div class="pill-row">
            <span class="result-kind" data-kind="${escapeHtml(item.kind)}">${escapeHtml(item.kind)}</span>
            ${item.durationText ? `<span class="info-pill">${escapeHtml(item.durationText)}</span>` : ''}
            ${item.isLive ? '<span class="info-pill">Live</span>' : ''}
            ${item.isUpcoming ? '<span class="info-pill">Upcoming</span>' : ''}
          </div>
          <h3 class="result-title">${escapeHtml(item.title)}</h3>
          <p class="result-meta">${escapeHtml(subtitle || 'No extra metadata')}</p>
        </div>
      </div>
    `;
  }).join('');

  bindRelatedActions();
};

const renderChannel = () => {
  const channel = state.currentChannel;

  if (!channel) {
    elements.channelCard.className = 'channel-card empty-state';
    elements.channelCard.innerHTML = '<p>No channel selected yet.</p>';
    return;
  }

  const heroThumb = pickThumbnail(channel.avatar) || createPlaceholderImage('Channel');
  const pills = [
    channel.handle,
    channel.country,
    channel.subscriberCountText,
    channel.videoCountText,
    channel.viewCountText,
    channel.joinedDateText,
  ].filter(isNonEmptyString);

  const links = Array.isArray(channel.links) ? channel.links.slice(0, 6) : [];

  elements.channelCard.className = 'channel-card';
  elements.channelCard.innerHTML = `
    <div class="channel-hero">
      <img src="${escapeHtml(heroThumb)}" alt="" />
      <div>
        <p class="utility-title">Channel Snapshot</p>
        <h3 class="channel-title">${escapeHtml(channel.title ?? state.currentChannelId)}</h3>
        <p class="channel-subline">${escapeHtml(channel.handle ?? 'No handle')}</p>
      </div>
    </div>

    <div class="pill-row">
      ${pills.map((pill) => `<span class="info-pill">${escapeHtml(pill)}</span>`).join('')}
    </div>

    <div class="description-block">${escapeHtml(channel.description ?? 'No channel description available.')}</div>

    <div class="channel-links">
      ${links.length > 0
        ? links.map((link) => `
            <a class="channel-link" href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer noopener">
              ${escapeHtml(link.title)}
            </a>
          `).join('')
        : '<span class="result-meta">No public links exposed in the current response.</span>'}
    </div>
  `;
};

const bindActionNodes = (container, selector, handler) => {
  container.querySelectorAll(selector).forEach((node) => {
    node.addEventListener('click', () => handler(node));
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handler(node);
      }
    });
  });
};

const bindResultActions = () => {
  bindActionNodes(elements.searchResults, '[data-result-id]', (node) => {
    const id = node.dataset.resultId;
    const kind = node.dataset.resultKind;

    if (!id || !kind) {
      return;
    }

    if (kind === 'playlist') {
      void openPlaylist(id, { autoplayFirst: true });
      return;
    }

    if (kind === 'channel') {
      void openChannel(id);
      return;
    }

    void openVideo(id, { autoplay: true });
  });
};

const bindRelatedActions = () => {
  bindActionNodes(elements.relatedItems, '[data-related-id]', (node) => {
    const id = node.dataset.relatedId;
    const kind = node.dataset.relatedKind;

    if (!id || !kind) {
      return;
    }

    if (kind === 'playlist') {
      void openPlaylist(id, { autoplayFirst: true });
      return;
    }

    if (kind === 'channel') {
      void openChannel(id);
      return;
    }

    void openVideo(id, { autoplay: true });
  });
};

const bindPlaylistActions = () => {
  bindActionNodes(elements.playlistItems, '[data-playlist-video-id]', (node) => {
    const videoId = node.dataset.playlistVideoId;

    if (!videoId) {
      return;
    }

    void openVideo(videoId, { autoplay: true });
  });
};

const renderAll = () => {
  renderVideoMeta();
  renderPlaylist();
  renderResults();
  renderRelated();
  renderChannel();
};

const openChannel = async (channelId, options = {}) => {
  if (!isNonEmptyString(channelId)) {
    return;
  }

  const { silent = false } = options;

  if (!silent) {
    setStatus('Busy', `Loading channel ${channelId}...`, 'busy');
  }

  try {
    const channel = await fetchApi(`/v1/channels/${encodeURIComponent(channelId)}`);
    state.currentChannelId = channelId;
    state.currentChannel = channel;
    renderChannel();

    if (!silent) {
      setStatus('Ready', `Loaded channel ${channel.title ?? channelId}.`, 'ready');
    }
  } catch (error) {
    if (!silent) {
      setStatus('Error', error instanceof Error ? error.message : 'Failed to load channel.', 'error');
    }
  }
};

const openPlaylist = async (playlistId, options = {}) => {
  if (!isNonEmptyString(playlistId)) {
    return;
  }

  const { autoplayFirst = false } = options;
  setStatus('Busy', `Loading playlist ${playlistId}...`, 'busy');

  try {
    const playlist = await fetchApi(`/v1/playlists/${encodeURIComponent(playlistId)}`);
    state.currentPlaylistId = playlistId;
    state.currentPlaylist = playlist;
    elements.playlistIdInput.value = playlistId;
    renderPlaylist();

    if (playlist.channel?.id) {
      void openChannel(playlist.channel.id, { silent: true });
    }

    setStatus('Ready', `Loaded playlist ${playlist.title ?? playlistId}.`, 'ready');

    if (autoplayFirst && Array.isArray(playlist.items) && playlist.items.length > 0) {
      void openVideo(playlist.items[0].id, { autoplay: false });
    }
  } catch (error) {
    setStatus('Error', error instanceof Error ? error.message : 'Failed to load playlist.', 'error');
  }
};

const loadRelated = async (videoId) => {
  if (!isNonEmptyString(videoId)) {
    return;
  }

  try {
    const related = await fetchApi(`/v1/videos/${encodeURIComponent(videoId)}/related`, {
      limit: 18,
    });

    if (state.currentVideoId !== videoId) {
      return;
    }

    state.currentRelated = related;
    renderRelated();
  } catch (error) {
    if (state.currentVideoId !== videoId) {
      return;
    }

    state.currentRelated = {
      id: videoId,
      filters: [],
      hasContinuation: false,
      autoplayVideoId: null,
      items: [],
      errorMessage: error instanceof Error ? error.message : 'Failed to load related content.',
    };
    renderRelated();
  }
};

const openVideo = async (videoId, options = {}) => {
  if (!isNonEmptyString(videoId)) {
    return;
  }

  const { autoplay = true } = options;
  setStatus('Busy', `Loading video ${videoId}...`, 'busy');
  showPlayerOverlay({
    eyebrow: 'Loading',
    title: 'Preparing playback contract',
    body: 'Fetching metadata and stream variants from the API.',
  });

  try {
    const [video, playback] = await Promise.all([
      fetchApi(`/v1/videos/${encodeURIComponent(videoId)}`),
      fetchApi(`/v1/videos/${encodeURIComponent(videoId)}/playback`),
    ]);

    const stream = pickPlayableStream(playback);
    state.currentVideoId = videoId;
    state.currentVideo = video;
    state.currentPlayback = playback;
    state.currentStream = stream;
    state.currentRelated = {
      id: videoId,
      filters: [],
      hasContinuation: false,
      autoplayVideoId: null,
      items: [],
      isLoading: true,
    };
    elements.videoIdInput.value = videoId;

    if (video.channel?.id) {
      void openChannel(video.channel.id, { silent: true });
    }

    renderVideoMeta();
    renderPlaylist();
    renderRelated();
    void loadRelated(videoId);

    if (!stream) {
      elements.player.removeAttribute('src');
      elements.player.load();
      showPlayerOverlay({
        eyebrow: 'Muxed stream missing',
        title: video.title ?? videoId,
        body: 'This lightweight debug player only plays muxed streams right now. The playback API has data, but this UI is intentionally staying simple.',
      });
      setStatus('Warn', 'Video loaded, but no muxed stream was available for the simple player.', 'warn');
      return;
    }

    elements.player.poster = pickThumbnail(video.thumbnails);
    elements.player.src = stream.proxyUrl;
    elements.player.load();
    hidePlayerOverlay();

    if (autoplay) {
      void elements.player.play().catch(() => {
        setStatus('Ready', `Loaded ${video.title ?? videoId}. Press play to start.`, 'ready');
      });
    }

    setStatus('Ready', `Loaded ${video.title ?? videoId}.`, 'ready');
  } catch (error) {
    elements.player.removeAttribute('src');
    elements.player.load();
    showPlayerOverlay({
      eyebrow: 'Playback error',
      title: 'Video could not be loaded',
      body: error instanceof Error ? error.message : 'Unexpected playback failure.',
    });
    setStatus('Error', error instanceof Error ? error.message : 'Failed to load video.', 'error');
  }
};

const performSearch = async ({ query, type, limit }) => {
  if (!isNonEmptyString(query)) {
    return;
  }

  state.searchQuery = query.trim();
  setStatus('Busy', `Searching for �${state.searchQuery}�...`, 'busy');

  try {
    const data = await fetchApi('/v1/search', {
      q: state.searchQuery,
      type,
      limit,
    });

    state.searchResults = Array.isArray(data.items) ? data.items : [];
    renderResults();
    setStatus('Ready', `Search complete for �${state.searchQuery}�.`, 'ready');
  } catch (error) {
    state.searchResults = [];
    renderResults();
    setStatus('Error', error instanceof Error ? error.message : 'Search failed.', 'error');
  }
};

const attachForms = () => {
  elements.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = elements.searchQuery.value.trim();
    const type = elements.searchType.value;
    const limit = Number(elements.searchLimit.value || 12);
    void performSearch({ query, type, limit });
  });

  elements.videoForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void openVideo(elements.videoIdInput.value.trim(), { autoplay: true });
  });

  elements.playlistForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void openPlaylist(elements.playlistIdInput.value.trim(), { autoplayFirst: true });
  });

  elements.channelForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void openChannel(elements.channelIdInput.value.trim());
  });
};

const attachPlayerObservers = () => {
  elements.player.addEventListener('error', () => {
    showPlayerOverlay({
      eyebrow: 'Media path issue',
      title: 'Player failed to start',
      body: 'Check that the media service is running and reachable from the browser. The current UI expects the media-plane proxy to be alive.',
    });
    setStatus('Warn', 'Player could not fetch the media stream. Make sure services/api and services/media are both running.', 'warn');
  });

  elements.player.addEventListener('playing', () => {
    hidePlayerOverlay();
    if (state.currentVideo?.title) {
      setStatus('Ready', `Now playing ${state.currentVideo.title}.`, 'ready');
    }
  });
};

const bootstrap = async () => {
  attachForms();
  attachPlayerObservers();
  elements.searchQuery.value = DEFAULT_SEARCH_QUERY;
  elements.playlistIdInput.value = DEFAULT_PLAYLIST_ID;

  renderAll();
  showPlayerOverlay({
    eyebrow: 'Warm start',
    title: 'Bootstrapping the debug deck',
    body: 'Loading a default playlist and a starter search so the page is useful right away.',
  });

  await Promise.allSettled([
    performSearch({ query: DEFAULT_SEARCH_QUERY, type: 'video', limit: 12 }),
    openPlaylist(DEFAULT_PLAYLIST_ID, { autoplayFirst: true }),
  ]);
};

void bootstrap();





