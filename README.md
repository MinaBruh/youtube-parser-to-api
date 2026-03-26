# YouTube Proxy API

Self-hosted backend for a YouTube-style client with a hard split between `control-plane` and `media-plane`.

## Why This Shape

The project is optimized for:

- fast iteration on a reverse-engineered backend
- separate scaling for JSON API and media proxy traffic
- one normalized API for web and mobile clients
- a later auth layer without rewriting the whole backend

## Current Stack

- `Node.js` + `TypeScript`
- `npm workspaces`
- `Fastify` for both backend services
- `youtubei.js` as the first InnerTube extractor adapter
- `packages/shared` for common types and helpers

## Repository Layout

```text
services/
  api/       control-plane API for search, watch metadata, channels and playlists
  media/     media-plane proxy for manifests, chunks and upstream transport
packages/
  shared/    shared types, constants and response helpers
```

## Module Responsibilities

### `services/api`

Owns the normalized HTTP API that clients use directly.

All thumbnail-like objects now include `proxyUrl`, so clients can render images through `media-plane` without talking to `ytimg` directly.

Current operational behavior:

- `search`, `/v1/videos/:videoId`, `/v1/videos/:videoId/playback` and `/v1/channels/:channelId` use an in-memory response cache with TTLs
- the same hot request is deduped in-flight so concurrent callers share one upstream fetch
- `X-YTPA-Cache` reports `miss`, `hit` or `deduped`
- `API_RESPONSE_CACHE_MAX_ENTRIES` controls cache size and defaults to `500`
- `api` and `media` now apply in-memory fixed-window rate limiting with `429` responses and rate-limit headers
- `API_RATE_LIMIT_MAX_REQUESTS` defaults to `180/min` and `MEDIA_RATE_LIMIT_MAX_REQUESTS` defaults to `900/min`; set either to `0` to disable locally
- cache coverage now includes storyboards, captions metadata, transcript, related, comments, playlists and channel feeds in addition to the earlier hot routes
- transient upstream API and media fetch failures now use bounded retry/backoff before returning an error
- `YTPA_REDIS_URL` or `VALKEY_URL` enables shared response cache, rate limiting and continuation storage across instances
- `media-plane` now has a disk-backed cache for cacheable images, manifests, text-like assets and small exact byte ranges, exposed via `X-YTPA-Media-Cache`

Current endpoints:

- `GET /health`
- `GET /debug`
- `GET /v1/home`
- `GET /v1/explore`
- `GET /v1/trending`
- `GET /v1/search`
- `GET /v1/watch/:videoId`
- `GET /v1/videos/:videoId`
- `GET /v1/videos/:videoId/storyboards`
- `GET /v1/videos/:videoId/playback`
- `GET /v1/videos/:videoId/captions`
- `GET /v1/videos/:videoId/captions/:trackId`
- `GET /v1/videos/:videoId/transcript`
- `GET /v1/videos/:videoId/related`
- `GET /v1/videos/:videoId/comments`
- `GET /v1/videos/:videoId/comments/:commentId/replies`
- `GET /v1/channels/:channelId`
- `GET /v1/channels/:channelId/home`
- `GET /v1/channels/:channelId/search`
- `GET /v1/channels/:channelId/community`
- `GET /v1/channels/:channelId/posts/:postId`
- `GET /v1/channels/:channelId/posts/:postId/comments`
- `GET /v1/channels/:channelId/feed/:tab`
- `GET /v1/playlists/:playlistId`

#### `GET /debug`

Serves a lightweight manual QA frontend for the current API surface.

Current UI includes:

- old-YouTube-inspired watch layout
- search rail powered by `GET /v1/search`
- direct open forms for videos, playlists and channels
- simple muxed-stream playback using `GET /v1/videos/:videoId/playback`
- watch-next rail powered by `GET /v1/videos/:videoId/related`
- playlist queue and channel side card for quick browsing

Run both backend services and then open:

```text
http://127.0.0.1:3000/debug
```

#### `GET /v1/home`

Returns a normalized anonymous home feed built from YouTube's browse home surface.

Current payload includes:

- `optionType: filter` and selectable home chips in `options`
- `sections` with shelf titles and normalized items
- a flattened `items` array for simpler clients
- an opaque `continuation` token when upstream has more home content

Supported query params:

- `filter` optional home chip label
- `continuation` opaque token returned by the previous home response

Examples:

```text
GET /v1/home
GET /v1/home?filter=Music
GET /v1/home?continuation=...
```

#### `GET /v1/explore`

Returns a normalized anonymous explore feed backed by YouTube's trending/explore browse surface.

Current payload includes:

- `optionType: tab` and available subfeeds in `options`
- `sections` with normalized items suitable for a discovery page
- a flattened `items` array for simpler clients
- an opaque `continuation` token when upstream has more browse content

Supported query params:

- `tab` optional explore subfeed label
- `continuation` opaque token returned by the previous explore response

Examples:

```text
GET /v1/explore
GET /v1/explore?tab=Gaming
GET /v1/explore?continuation=...
```

#### `GET /v1/trending`

Convenience alias over the same anonymous explore/trending browse surface.

Supported query params:

- `tab` optional trending subfeed label
- `continuation` opaque token returned by the previous trending response

Examples:

```text
GET /v1/trending
GET /v1/trending?tab=Music
GET /v1/trending?continuation=...
```

#### `GET /v1/recommendations`

Returns backend-side anonymous recommendations using the visitor profile collected from recent search and watch activity. The current implementation keys the profile to an anonymous visitor fingerprint derived from client IP plus user-agent, then mixes:

- related videos from recent watch history
- search-based candidates from recent queries
- fallback discovery items when the profile is still sparse

Supported query params:

- `limit` optional page size, default `18`, max `48`
- `continuation` opaque token for the next recommendation batch

Examples:

```text
GET /v1/recommendations
GET /v1/recommendations?limit=24
GET /v1/recommendations?continuation=...
```

#### `GET /v1/search`

Supported query params:

- `q` required search query for the first page
- `continuation` opaque token returned by the previous search response
- `type` one of `all`, `video`, `shorts`, `channel`, `playlist`, `movie`
- `uploadDate` one of `all`, `today`, `week`, `month`, `year`
- `duration` one of `all`, `under_three_mins`, `three_to_twenty_mins`, `over_twenty_mins`
- `sort` one of `relevance`, `popularity`
- `features` comma-separated list from `hd`, `subtitles`, `creative_commons`, `3d`, `live`, `purchased`, `4k`, `360`, `location`, `hdr`, `vr180`
- `limit` integer from `1` to `50`

Behavior:

- returns `hasContinuation` and an opaque `continuation` token for stateless paging
- when upstream points a result at `/shorts/...`, the normalized item is emitted with `kind: shorts` even if YouTube still labels the raw node as `Video`
- live-capable search items now also expose `isPremiere`, `scheduledStartTime` and normalized `liveLifecycle`
- search continuation tokens are short opaque tokens with a `30 minute` TTL and use shared Redis/Valkey storage when configured

Examples:

```text
GET /v1/search?q=openai&type=video&limit=10
GET /v1/search?continuation=...&limit=10
```

#### `GET /v1/watch/:videoId`

Returns a unified watch payload so a frontend can render the main watch page from one request.

Current payload includes:

- `details` from the normalized video details contract
- `playback` with proxy-ready media sources
- `storyboards` for preview sheets
- `captions` metadata
- `transcript` data or an unavailable payload when upstream refuses transcript access
- `related` watch-next items
- `comments` first-page top-level comments
- `warnings` when non-critical sections had to degrade gracefully

Supported query params:

- `relatedLimit` integer from `1` to `50`, defaults to `18`
- `commentsLimit` integer from `1` to `50`, defaults to `20`
- `commentsSort` one of `top`, `newest`
- `transcriptLanguage` optional transcript language hint

Behavior:

- caches the aggregated watch response as a hot read-only route
- still returns a successful watch payload when `related/transcript` or `comments` fail individually
- records those partial failures in `warnings` so the frontend can react without losing the whole page

Example:

```text
GET /v1/watch/dQw4w9WgXcQ
GET /v1/watch/dQw4w9WgXcQ?relatedLimit=12&commentsLimit=10&commentsSort=top
GET /v1/watch/dQw4w9WgXcQ?transcriptLanguage=en
```

#### `GET /v1/videos/:videoId`

Returns normalized basic video details built from `getBasicInfo`, including:

- title and description
- channel summary
- duration, tags and view count
- playability status and reason
- embed and canonical URLs with fallback generation for standard watch pages and Shorts
- relative `playbackEndpoint` pointing to the playback contract
- relative `storyboardsEndpoint` pointing to normalized storyboard metadata
- `isPremiere`, normalized `liveLifecycle`, `scheduledStartTime` and `endedAt` for live/premiere/upcoming handling
- `isShorts`, `isLiveDvrEnabled`, `isPostLiveDvr` and `isLowLatencyLiveStream` flags for client-side watch mode decisions
- proxied thumbnail URLs in `thumbnails[].proxyUrl`

Example:

```text
GET /v1/videos/dQw4w9WgXcQ
```

#### `GET /v1/videos/:videoId/storyboards`

Returns normalized storyboard metadata built from `youtubei.js` image sets, including:

- `available` and `durationSeconds`
- one or more storyboard variants with tile dimensions, rows, columns and estimated sheet count
- `sheetProxyUrlTemplate` for clients that want to request arbitrary sheet indexes through `media-plane`
- `firstSheetProxyUrl` for a ready-to-use first sheet preview

Example:

```text
GET /v1/videos/dQw4w9WgXcQ/storyboards
```

#### `GET /v1/videos/:videoId/playback`

Returns proxy-ready playback metadata built from deciphered stream variants and the media service.

Current playback behavior:

- returns stream variants with `proxyUrl` pointing to the media-plane stream resolver instead of a pre-signed upstream URL
- keeps URL deciphering in the media service so the same egress both signs and downloads the stream
- classifies streams into `muxedStreams`, `audioOnlyStreams`, and `videoOnlyStreams`
- exposes `qualityOptions`, `audioTracks`, `adaptivePairs`, `defaultSelection` and `fallbackOrder` so clients can build manual quality and audio-track selectors without guessing from raw `itag` lists
- exposes local manifest entrypoints through `manifests.dashProxyUrl` and `manifests.hlsProxyUrl`
- keeps `manifests.upstreamDashProxyUrl` and `manifests.upstreamHlsProxyUrl` for diagnostics when clients want to compare local versus upstream delivery
- generates a local DASH manifest for VOD and post-live-DVR playback so adaptive audio/video pairs stay inside the proxy infrastructure
- rewrites HLS playlists through the media service so nested playlist and segment URLs also stay inside the proxy infrastructure
- includes `recommendedPlaybackMode` with improved live/upcoming/post-live-DVR preference ordering
- includes `isPremiere`, normalized `liveLifecycle`, `scheduledStartTime` and `endedAt` for countdown/offline/live UI states
- includes `isShorts`, `isLive`, `isLiveContent`, `isLiveDvrEnabled`, `isPostLiveDvr` and `isLowLatencyLiveStream` for client-side playback strategy
- includes `unresolvedFormatsCount` because some adaptive formats are not yet resolved in the current client context

Environment support:

- `MEDIA_PROXY_BASE_URL` overrides the base URL used when building media-plane playback URLs
- without it, the API derives a media-plane URL from the incoming request host and `MEDIA_PORT`

Example:

```text
GET /v1/videos/dQw4w9WgXcQ/playback
```

#### `GET /v1/videos/:videoId/captions`

Returns normalized caption metadata for the video, including:

- `hasCaptions` and `defaultTrackId`
- a list of caption tracks with `languageCode`, display `name`, auto-generated flag and translatability
- local caption content URLs in raw, `vtt`, `ttml`, `srv3` and `json3` variants
- available translation languages when upstream exposes them
- `vtt` and other content URLs now point back to the API so the backend can fall back to `yt-dlp` when direct timedtext responses are empty

Example:

```text
GET /v1/videos/dQw4w9WgXcQ/captions
```

#### `GET /v1/videos/:videoId/captions/:trackId`

Returns the actual subtitle document for a previously discovered caption track.

Supported query params:

- `format` one of `raw`, `vtt`, `ttml`, `srv3`, `json3`

Behavior:

- first tries direct timedtext delivery from YouTube
- when timedtext returns an empty body, falls back to local `yt-dlp` extraction if `tools/yt_dlp_vendor` is installed
- sets `X-Subtitle-Source` to either `upstream` or `yt-dlp` so clients can inspect which path was used

Example:

```text
GET /v1/videos/dQw4w9WgXcQ/captions/.en?format=vtt
```

#### `GET /v1/videos/:videoId/transcript`

Returns a normalized transcript payload built from YouTube's transcript panel when upstream exposes it.

Behavior:

- returns transcript segments with `startMs`, `endMs`, `startText` and plain `text` when the transcript panel is available
- accepts optional `language` to request a translated transcript language by display name or language code when upstream supports it
- returns `available: false` with `unavailableReason` when captions exist but transcript retrieval is refused or missing in the current upstream context

Supported query params:

- `language` optional caption or transcript language hint

Examples:

```text
GET /v1/videos/dQw4w9WgXcQ/transcript
GET /v1/videos/dQw4w9WgXcQ/transcript?language=en
```

#### `GET /v1/videos/:videoId/related`

Returns a normalized watch-next rail built from `getInfo`, including:

- related videos, playlists, channels, shorts and compact movie entries when upstream exposes them
- `isPremiere`, `scheduledStartTime` and `liveLifecycle` on live-capable related items
- `autoplayVideoId` from the watch page autoplay target
- `hasContinuation` so later pagination can build on the same contract
- `filters` for watch-next variants when upstream exposes filter tabs

Supported query params:

- `limit` integer from `1` to `50`

Example:

```text
GET /v1/videos/dQw4w9WgXcQ/related?limit=18
```

Alias:

```text
GET /v1/videos/dQw4w9WgXcQ/watch-next?limit=18
```
#### `GET /v1/videos/:videoId/comments`

Returns a normalized comments feed built from `getComments`, including:

- top-level comment threads with author summary, publish text, likes and reply counters
- pinned, hearted, member and channel-owner flags when upstream exposes them
- `availableSorts`, selected `sort`, and an opaque `continuation` token for stateless pagination

Supported query params:

- `sort` one of `top`, `newest`
- `limit` integer from `1` to `50`
- `continuation` opaque token returned by the previous comments response

Examples:

```text
GET /v1/videos/dQw4w9WgXcQ/comments?limit=20
GET /v1/videos/dQw4w9WgXcQ/comments?sort=newest&limit=20
GET /v1/videos/dQw4w9WgXcQ/comments?continuation=...
```

#### `GET /v1/videos/:videoId/comments/:commentId/replies`

Returns a normalized replies feed for a specific top-level comment thread.

Behavior:

- resolves the target thread by `commentId`
- loads the replies batch through the same InnerTube comment stack
- returns reply items with author summary, publish text and like counters
- exposes `continuation` when upstream has more reply pages
- returns an empty `items` array when the thread exists but has no public replies

Supported query params:

- `limit` integer from `1` to `50`
- `continuation` opaque token returned by the previous replies response

Examples:

```text
GET /v1/videos/dQw4w9WgXcQ/comments/Ugz.../replies?limit=20
GET /v1/videos/dQw4w9WgXcQ/comments/Ugz.../replies?continuation=...
```

#### `GET /v1/channels/:channelId`

Returns normalized channel details built from `getChannel` and, when available, `getAbout`, including:

- title, handle and description
- subscriber, view and video counters
- avatar, banner and canonical URLs
- tabs and channel capability flags
- external links and regional availability

Example:

```text
GET /v1/channels/UCXZCJLdBC09xxGZ6gcdrc6A
```

#### `GET /v1/channels/:channelId/home`

Returns a normalized channel home feed for the public `featured` tab.

Supported query params:

- `filter` optional chip/filter label from the current home feed
- `continuation` opaque token returned by the previous home response

Behavior:

- exposes `sections` and flattened `items` for home shelves
- returns `filterOptions` with selected state when the channel exposes home chips
- keeps continuation state opaque and safe for multi-instance deployments when Redis/Valkey is configured

Examples:

```text
GET /v1/channels/UCXZCJLdBC09xxGZ6gcdrc6A/home
GET /v1/channels/UCXZCJLdBC09xxGZ6gcdrc6A/home?filter=Popular
GET /v1/channels/UCXZCJLdBC09xxGZ6gcdrc6A/home?continuation=...
```

#### `GET /v1/channels/:channelId/search`

Returns a normalized public channel-search feed.

Supported query params:

- `q` required search query for the first page
- `sort` optional selected sort label when the channel exposes sort controls
- `contentType` optional selected content-type label when the channel exposes content-type filters
- `continuation` opaque token returned by the previous search response

Behavior:

- exposes `sortOptions` and `contentTypeOptions` with selected state
- returns the same section/item shape as channel home for easier frontend reuse
- returns `404` when the channel does not expose a public search tab

Examples:

```text
GET /v1/channels/UCXZCJLdBC09xxGZ6gcdrc6A/search?q=gpt
GET /v1/channels/UCXZCJLdBC09xxGZ6gcdrc6A/search?q=gpt&sort=Upload date
GET /v1/channels/UCXZCJLdBC09xxGZ6gcdrc6A/search?q=gpt&contentType=Videos
GET /v1/channels/UCXZCJLdBC09xxGZ6gcdrc6A/search?continuation=...
```

#### `GET /v1/channels/:channelId/community`

Returns a normalized community feed for channels that expose the public `posts` tab.

Supported query params:

- `limit` integer from `1` to `50`, defaults to `20`
- `continuation` opaque token returned by the previous community response

Behavior:

- returns normalized community posts and shared posts
- exposes `postEndpoint` and `commentsEndpoint` per item for frontend drill-down
- normalizes image, poll and linked-content attachments when upstream exposes them
- returns an empty feed when the channel has no public community tab
- community continuation tokens are opaque short tokens backed by in-memory storage or shared Redis/Valkey when configured

Examples:

```text
GET /v1/channels/UCXZCJLdBC09xxGZ6gcdrc6A/community
GET /v1/channels/UCXZCJLdBC09xxGZ6gcdrc6A/community?limit=10
GET /v1/channels/UCXZCJLdBC09xxGZ6gcdrc6A/community?continuation=...
```

#### `GET /v1/channels/:channelId/posts/:postId`

Returns a single normalized community post payload for direct post pages.

Examples:

```text
GET /v1/channels/UCXZCJLdBC09xxGZ6gcdrc6A/posts/Ugkx...
```

#### `GET /v1/channels/:channelId/posts/:postId/comments`

Returns the top-level comments feed for a community post.

Supported query params:

- `sort` one of `top`, `newest`
- `limit` integer from `1` to `50`
- `continuation` opaque token returned by the previous post-comments response

Behavior:

- uses the dedicated community-post comments stack from InnerTube
- returns the same normalized comment item shape as video comments for easier frontend reuse
- currently covers top-level comments only; replies can be added later on the same model

Examples:

```text
GET /v1/channels/UCXZCJLdBC09xxGZ6gcdrc6A/posts/Ugkx.../comments
GET /v1/channels/UCXZCJLdBC09xxGZ6gcdrc6A/posts/Ugkx.../comments?sort=newest&limit=20
GET /v1/channels/UCXZCJLdBC09xxGZ6gcdrc6A/posts/Ugkx.../comments?continuation=...
```

#### `GET /v1/channels/:channelId/feed/:tab`

Returns a normalized channel feed for one of the supported public tabs.

Supported route params:

- `tab` one of `videos`, `shorts`, `streams`, `playlists`

Supported query params:

- `limit` integer from `1` to `50`
- `continuation` opaque token returned by the previous channel feed response

Behavior:

- uses short continuation tokens so small `limit` values do not skip buffered items between pages
- feed continuation tokens expire after `30 minutes` and use shared Redis/Valkey storage when configured

Examples:

```text
GET /v1/channels/UCXZCJLdBC09xxGZ6gcdrc6A/feed/videos?limit=10
GET /v1/channels/UCXZCJLdBC09xxGZ6gcdrc6A/feed/videos?continuation=...&limit=10
```

#### `GET /v1/playlists/:playlistId`

Returns normalized playlist pages built from `getPlaylist` and browse continuations, including:

- title, description and canonical URL on the first page
- owner summary and playlist thumbnails on the first page
- item, view and last-updated counters on the first page
- privacy and editability flags on the first page
- normalized playlist items plus `hasContinuation` and `continuation` for paging

Supported query params:

- `continuation` opaque token returned by the previous playlist response
- `limit` accepted for future compatibility, but playlist pages currently stream in upstream-sized batches to avoid skipping items between continuations

Behavior:

- playlist continuation tokens are short opaque tokens with a `30 minute` TTL and use shared Redis/Valkey storage when configured

Examples:

```text
GET /v1/playlists/UUXZCJLdBC09xxGZ6gcdrc6A
GET /v1/playlists/UUXZCJLdBC09xxGZ6gcdrc6A?continuation=...
```

### `services/media`

Owns all traffic that should not go from the client directly to YouTube.

Current endpoints:

- `GET /health`
- `GET /v1/media/proxy`
- `HEAD /v1/media/proxy`
- `GET /v1/media/image`
- `HEAD /v1/media/image`
- `GET /v1/media/video/:videoId/stream?itag=...`
- `HEAD /v1/media/video/:videoId/stream?itag=...`
- `GET /v1/media/video/:videoId/dash.mpd`
- `HEAD /v1/media/video/:videoId/dash.mpd`
- `GET /v1/media/video/:videoId/hls.m3u8`
- `HEAD /v1/media/video/:videoId/hls.m3u8`
- `GET /v1/media/video/:videoId/storyboards/:storyboardId/sheets/:sheetIndex`
- `HEAD /v1/media/video/:videoId/storyboards/:storyboardId/sheets/:sheetIndex`

#### `GET /v1/media/proxy`

Required query params:

- `url` absolute upstream URL to proxy

Behavior:

- forwards `Range` and conditional cache headers to upstream
- streams upstream body back without buffering the full response in memory when the response is not cacheable
- preserves upstream status code and response headers except hop-by-hop headers
- supports both `GET` and `HEAD`
- caches cacheable `GET` image, manifest and text-like responses on disk when they fit under `MEDIA_DISK_CACHE_MAX_ASSET_BYTES`
- keeps a RAM hot-cache for small frequently reused assets and exact byte ranges before falling back to disk
- caches exact bounded byte ranges when they fit under `MEDIA_DISK_CACHE_MAX_RANGE_BYTES`, which helps with repeated small chunk requests without pretending to be a full CDN
- promotes disk hits back into RAM so repeated small segments avoid filesystem reads on the hot path
- coalesces identical cacheable `GET` requests while an upstream fetch is in flight, so concurrent viewers do not pull the same small segment or manifest twice
- runs a background disk-cache cleanup policy that removes expired entries and evicts the oldest files when total disk cache size grows past `MEDIA_DISK_CACHE_MAX_TOTAL_BYTES`
- reuses cached responses for later `GET` and `HEAD` requests when possible
- reports cache state through `X-YTPA-Media-Cache: memory-hit|disk-hit|coalesced|miss|bypass`

Default host policy:

- allows YouTube-related suffixes such as `youtube.com`, `youtube-nocookie.com`, `googlevideo.com`, `ytimg.com`, `googleusercontent.com`
- blocks localhost and private addresses by default to reduce SSRF risk
- accepts extra allowed suffixes through `MEDIA_PROXY_ALLOWED_HOSTS`
- allows local upstream testing only when `MEDIA_PROXY_ALLOW_LOCALHOST=1`

Memory cache knobs:

- `MEDIA_MEMORY_CACHE_ENABLED` defaults to `true`
- `MEDIA_MEMORY_CACHE_MAX_ENTRIES` defaults to `512`
- `MEDIA_MEMORY_CACHE_MAX_ENTRY_BYTES` defaults to `4194304`
- `MEDIA_MEMORY_CACHE_MAX_TOTAL_BYTES` defaults to `67108864`

Disk cache knobs:

- `MEDIA_DISK_CACHE_ENABLED` defaults to `true`
- `MEDIA_DISK_CACHE_DIR` defaults to `var/media-cache`
- `MEDIA_DISK_CACHE_MAX_ASSET_BYTES` defaults to `8388608`
- `MEDIA_DISK_CACHE_MAX_RANGE_BYTES` defaults to `2097152`
- `MEDIA_DISK_CACHE_DEFAULT_TTL_MS` defaults to `21600000`
- `MEDIA_DISK_CACHE_MAX_TTL_MS` defaults to `86400000`
- `MEDIA_DISK_CACHE_MAX_TOTAL_BYTES` defaults to `2147483648`
- `MEDIA_DISK_CACHE_SWEEP_INTERVAL_MS` defaults to `300000`

Example:

```text
GET /v1/media/proxy?url=https%3A%2F%2Fr1---sn-example.googlevideo.com%2Fvideoplayback%3F...
```

#### `GET /v1/media/image`

Semantic alias for image delivery through the same upstream-safe proxy transport.

Required query params:

- `url` absolute upstream image URL, typically from `ytimg` or another allowed YouTube-owned host

Behavior:

- uses the same SSRF guardrails and host allowlist as `/v1/media/proxy`
- preserves upstream content type and cache headers for thumbnails, avatars, banners and other image assets

Example:

```text
GET /v1/media/image?url=https%3A%2F%2Fi.ytimg.com%2Fvi%2FdQw4w9WgXcQ%2Fhqdefault.jpg
```

#### `GET /v1/media/video/:videoId/stream?itag=...`

Behavior:

- resolves the requested video format inside the media service using `youtubei.js`
- deciphers the selected stream URL using the media service's own egress
- proxies the resolved upstream stream through the same range-aware transport as `/v1/media/proxy`

This avoids upstream `403` issues caused by signing a Googlevideo URL in one service and downloading it from another.

Example:

```text
GET /v1/media/video/dQw4w9WgXcQ/stream?itag=18
```

#### `GET /v1/media/video/:videoId/dash.mpd`

Behavior:

- generates a local DASH manifest inside `media-plane` using `youtubei.js`
- rewrites media URLs inside the manifest to point back to `/v1/media/proxy`
- keeps adaptive audio/video playback and audio-track selection fully inside the proxy infrastructure for VOD and post-live-DVR videos
- intentionally rejects live-video DASH generation because upstream live playback should use HLS

Example:

```text
GET /v1/media/video/dQw4w9WgXcQ/dash.mpd
```

#### `GET /v1/media/video/:videoId/hls.m3u8`

Behavior:

- resolves the upstream HLS manifest for the requested video inside `media-plane`
- rewrites nested playlist URLs back to `/v1/media/video/:videoId/hls.m3u8?url=...`
- rewrites segment, key and init-map URLs back to `/v1/media/proxy?url=...`
- keeps live and upcoming playback fully inside the proxy infrastructure without exposing direct upstream HLS URLs to the browser

Example:

```text
GET /v1/media/video/5qap5aO4i9A/hls.m3u8
```

#### `GET /v1/media/video/:videoId/storyboards/:storyboardId/sheets/:sheetIndex`

Behavior:

- resolves storyboard metadata for the requested video inside `media-plane`
- validates the requested storyboard variant and sheet index
- proxies the resolved storyboard sheet image back to the client

Example:

```text
GET /v1/media/video/dQw4w9WgXcQ/storyboards/thumbnails_48x27/sheets/0
```

### `apps/web`

Separate classic-style web client built with `Vue 3 + Vite`.

Current frontend scope:

- `home` page powered by anonymous discovery feeds and backend-side personalized recommendations
- `search` page powered by `/v1/search`
- `watch` page powered by `/v1/watch/:videoId`
- old-YouTube-inspired layout with header, sidebar, rails, home `load more` and watch column
- custom player shell with play/pause, seek bar, volume, speed, subtitle, quality and audio-track menus
- playback path prefers local `DASH/HLS` manifests and falls back to muxed streams when needed

Development notes:

- the frontend lives in `apps/web`
- Vite dev server proxies `/api` to `127.0.0.1:3000` and `/media` to `127.0.0.1:3001`
- the client rewrites API-returned absolute `/v1/...` and `/v1/media/...` URLs back through those same-origin proxies during development

### `packages/shared`

Holds the stable surface that both services need:

- service metadata types
- normalized API response contracts
- shared search filter enums and helpers

## Client Flow

1. fetch `/v1/home`, `/v1/explore` or `/v1/trending` for anonymous discovery surfaces, and optionally `/v1/recommendations` for backend-personalized anonymous recommendations
2. fetch `/v1/watch/:videoId` for a one-shot watch-page payload with details, playback, captions, storyboards, transcript, related and first-page comments
3. optionally fall back to the individual `/v1/videos/:videoId/*` endpoints when the client wants finer-grained loading or separate refresh behavior
4. optionally fetch `/v1/videos/:videoId/comments/:commentId/replies` for expanded comment threads
5. play returned media-plane `proxyUrl` values through `services/media`

## MVP Order

1. bring up both Fastify services
2. add normalized read-only routes in `services/api`
3. wire a first extractor adapter for search, video and channel metadata
4. add the first upstream transport in `services/media`
5. link control-plane video data to media-plane playback sources
6. add cache and background jobs
7. add auth and user-context later, as a separate layer

## Running

Optional subtitle fallback setup:

```bash
npm run setup:yt-dlp
```

This installs `yt-dlp` into `tools/yt_dlp_vendor` so caption content routes can fall back when YouTube timedtext replies with an empty body.

Install dependencies and then use:

```bash
npm run dev:all
```

For the classic frontend in dev mode, open:

```text
http://127.0.0.1:5173
```

For the built runtime via `start:web`, `start:all` or `prod:all`, open:

```text
http://127.0.0.1:4173
```

The command map is:

```bash
# local dev
npm run dev:center
npm run dev:media
npm run dev:web
npm run dev:backend
npm run dev:all

# local dev with shared Valkey cache
npm run cache:up
npm run dev:backend:cache
npm run dev:all:cache

# built runtime without Docker
npm run prod:backend
npm run prod:backend:cache
npm run prod:all
npm run prod:all:cache

# start already-built services
npm run start:center
npm run start:media
npm run start:web
npm run start:backend
npm run start:all

# Docker / self-hosted
npm run compose:up
npm run compose:up:detached
npm run compose:logs
npm run compose:down
```

What each group means:

- `dev:center` is the main control-plane API only.
- `dev:backend` runs the shared package watcher plus `api` and `media`.
- `dev:all` runs `shared + api + media + web` in one terminal.
- `cache:*` manages the Valkey cache server from `compose.yaml`.
- `prod:*` builds first and then launches the built services together.
- `compose:*` is the easiest self-hosted path for other people to deploy.

For production-style local validation without Docker:

```bash
npm run prod:all
```

## Self-Hosted Stack

The repository now includes:

- `compose.yaml`
- `services/api/Dockerfile`
- `services/media/Dockerfile`
- `apps/web/Dockerfile`
- `.env.example`

Default container topology:

- `web` serves the classic frontend on `WEB_PORT` and proxies `/api` and `/media`
- `api` is the control-plane / central API on `API_PORT`
- `media` is the media-plane and cache-heavy proxy on `MEDIA_PORT`
- `valkey` backs shared rate limiting, response cache and continuation storage

Typical server deploy:

```bash
cp .env.example .env
npm run compose:up:detached
```

Then open:

```text
http://127.0.0.1:8080
```
