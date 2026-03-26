import type { FastifyRequest } from 'fastify';
import type { Innertube } from 'youtubei.js';
import {
  getDefaultPort,
  type CaptionTrack,
  type CaptionTrackUrls,
  type CaptionTranslationLanguage,
  type TranscriptSegmentData,
  type VideoCaptionsData,
  type VideoTranscriptData,
} from '@ytpa/shared';
import type { CaptionContentFormat } from './subtitle-content.js';

type BasicVideoInfo = Awaited<ReturnType<Innertube['getBasicInfo']>>;
type DetailedVideoInfo = Awaited<ReturnType<Innertube['getInfo']>>;
type TranscriptInfoResult = Awaited<ReturnType<DetailedVideoInfo['getTranscript']>>;
type CaptionsSource = Pick<BasicVideoInfo, 'basic_info' | 'captions'>;

type CaptionTrackData = NonNullable<
  NonNullable<NonNullable<CaptionsSource['captions']>['caption_tracks']>
>[number];

interface TranscriptSegmentLike {
  start_ms: string;
  end_ms: string;
  snippet: unknown;
  start_time_text: unknown;
  target_id?: string;
}

type HeaderValue = string | string[] | undefined;

const trimTrailingSlash = (value: string): string => {
  return value.endsWith('/') ? value.slice(0, -1) : value;
};

const getHeaderValue = (value: HeaderValue): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
};

const getDerivedApiBaseUrl = (request: FastifyRequest): string => {
  const forwardedProto = getHeaderValue(request.headers['x-forwarded-proto']);
  const forwardedHost = getHeaderValue(request.headers['x-forwarded-host']);
  const host = forwardedHost ?? request.headers.host ?? `127.0.0.1:${getDefaultPort('api')}`;
  const protocol = forwardedProto?.split(',')[0]?.trim() || request.protocol || 'http';
  return trimTrailingSlash(`${protocol}://${host}`);
};

const getApiBaseUrl = (request: FastifyRequest): string => {
  const configuredBaseUrl = process.env.API_BASE_URL?.trim();

  if (configuredBaseUrl) {
    return trimTrailingSlash(configuredBaseUrl);
  }

  return getDerivedApiBaseUrl(request);
};

export const buildCaptionContentUrl = (
  apiBaseUrl: string,
  videoId: string,
  trackId: string,
  format: CaptionContentFormat,
): string => {
  return `${apiBaseUrl}/v1/videos/${encodeURIComponent(videoId)}/captions/${encodeURIComponent(trackId)}?format=${format}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const toText = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const text = value.trim();
    return text.length > 0 ? text : null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.toString !== 'function' ||
    value.toString === Object.prototype.toString
  ) {
    return null;
  }

  const text = value.toString().trim();
  return text.length > 0 ? text : null;
};

const uniqueStrings = (values: Array<string | null | undefined>): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = value?.trim();

    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
};

const createCaptionTrackUrls = (
  apiBaseUrl: string,
  videoId: string,
  trackId: string,
): CaptionTrackUrls => {
  return {
    rawProxyUrl: buildCaptionContentUrl(apiBaseUrl, videoId, trackId, 'raw'),
    vttProxyUrl: buildCaptionContentUrl(apiBaseUrl, videoId, trackId, 'vtt'),
    ttmlProxyUrl: buildCaptionContentUrl(apiBaseUrl, videoId, trackId, 'ttml'),
    srv3ProxyUrl: buildCaptionContentUrl(apiBaseUrl, videoId, trackId, 'srv3'),
    json3ProxyUrl: buildCaptionContentUrl(apiBaseUrl, videoId, trackId, 'json3'),
  };
};

const createTranslationLanguages = (
  source: CaptionsSource,
): CaptionTranslationLanguage[] => {
  return (source.captions?.translation_languages ?? []).flatMap((language) => {
    const languageCode = language.language_code?.trim();
    const languageName = toText(language.language_name);

    if (!languageCode || !languageName) {
      return [];
    }

    return [{
      languageCode,
      languageName,
    } satisfies CaptionTranslationLanguage];
  });
};

const getDefaultTrackId = (source: CaptionsSource): string | null => {
  const tracks = source.captions?.caption_tracks ?? [];

  if (tracks.length === 0) {
    return null;
  }

  const defaultAudioTrackIndex = source.captions?.default_audio_track_index ?? 0;
  const defaultAudioTrack = source.captions?.audio_tracks?.[defaultAudioTrackIndex];
  const defaultCaptionTrackIndex = defaultAudioTrack?.default_caption_track_index;

  if (
    typeof defaultCaptionTrackIndex === 'number' &&
    defaultCaptionTrackIndex >= 0 &&
    defaultCaptionTrackIndex < tracks.length
  ) {
    return tracks[defaultCaptionTrackIndex]?.vss_id ?? null;
  }

  const manualTrack = tracks.find((track) => track.kind !== 'asr');
  return manualTrack?.vss_id ?? tracks[0]?.vss_id ?? null;
};

const createCaptionTrack = (
  apiBaseUrl: string,
  videoId: string,
  track: CaptionTrackData,
): CaptionTrack => {
  const name = toText(track.name) ?? track.language_code;
  const kind = track.kind === 'asr' || track.kind === 'frc' ? track.kind : null;

  return {
    id: track.vss_id,
    vssId: track.vss_id,
    name,
    languageCode: track.language_code,
    kind,
    isAutoGenerated: kind === 'asr',
    isTranslatable: track.is_translatable,
    urls: createCaptionTrackUrls(apiBaseUrl, videoId, track.vss_id),
  };
};

const getKnownLanguageNames = (source: CaptionsSource): string[] => {
  return uniqueStrings([
    ...(source.captions?.caption_tracks ?? []).map((track) => toText(track.name)),
    ...(source.captions?.translation_languages ?? []).map((language) =>
      toText(language.language_name),
    ),
  ]);
};

const resolveRequestedLanguageLabel = (
  requestedLanguage: string | null,
  transcriptLanguages: string[],
  source: CaptionsSource,
): string | null => {
  if (!requestedLanguage) {
    return null;
  }

  const normalizedRequestedLanguage = requestedLanguage.trim().toLowerCase();

  if (!normalizedRequestedLanguage) {
    return null;
  }

  const aliases = new Map<string, string>();

  for (const language of transcriptLanguages) {
    aliases.set(language.toLowerCase(), language);
  }

  for (const track of source.captions?.caption_tracks ?? []) {
    const name = toText(track.name);

    if (name) {
      aliases.set(name.toLowerCase(), name);
    }

    if (track.language_code) {
      aliases.set(track.language_code.toLowerCase(), name ?? track.language_code);
    }
  }

  for (const language of source.captions?.translation_languages ?? []) {
    const languageName = toText(language.language_name);

    if (languageName) {
      aliases.set(languageName.toLowerCase(), languageName);
    }

    if (language.language_code) {
      aliases.set(
        language.language_code.toLowerCase(),
        languageName ?? language.language_code,
      );
    }
  }

  return aliases.get(normalizedRequestedLanguage) ?? requestedLanguage;
};

const isTranscriptSegment = (
  segment: unknown,
): segment is TranscriptSegmentLike => {
  return (
    typeof segment === 'object' &&
    segment !== null &&
    'start_ms' in segment &&
    'end_ms' in segment &&
    'snippet' in segment &&
    'start_time_text' in segment
  );
};

const toTranscriptSegment = (
  segment: unknown,
): TranscriptSegmentData | null => {
  if (!isTranscriptSegment(segment)) {
    return null;
  }

  const startMs = Number(segment.start_ms);
  const endMs = Number(segment.end_ms);
  const text = toText(segment.snippet);
  const startText = toText(segment.start_time_text);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !text || !startText) {
    return null;
  }

  return {
    startMs,
    endMs,
    startText,
    text,
    targetId: typeof segment.target_id === 'string' ? segment.target_id : null,
  };
};

const createUnavailableReason = (
  source: CaptionsSource,
  error: unknown,
): string => {
  if ((source.captions?.caption_tracks?.length ?? 0) === 0) {
    return 'This video does not expose caption tracks.';
  }

  if (error instanceof Error) {
    if (
      error.message.includes('FAILED_PRECONDITION') ||
      (error.message.includes('get_transcript') && error.message.includes('status code 400'))
    ) {
      return 'Upstream refused to provide transcript data for this video in the current client context.';
    }

    if (error.message.includes('Language not found')) {
      return 'Requested transcript language is not available from upstream.';
    }

    const message = error.message.trim();

    if (message.length > 0) {
      return message;
    }
  }

  return 'Transcript is not available from upstream.';
};

export const createVideoCaptionsData = (
  request: FastifyRequest,
  videoId: string,
  source: CaptionsSource,
): VideoCaptionsData => {
  const apiBaseUrl = getApiBaseUrl(request);
  const tracks = (source.captions?.caption_tracks ?? []).map((track) =>
    createCaptionTrack(apiBaseUrl, videoId, track),
  );

  return {
    id: source.basic_info.id ?? videoId,
    hasCaptions: tracks.length > 0,
    defaultTrackId: getDefaultTrackId(source),
    translationLanguages: createTranslationLanguages(source),
    tracks,
  };
};

export const createVideoTranscriptData = async (
  videoId: string,
  source: DetailedVideoInfo,
  requestedLanguage: string | null,
): Promise<VideoTranscriptData> => {
  const knownLanguages = getKnownLanguageNames(source);

  try {
    let transcript = await source.getTranscript();
    const targetLanguage = resolveRequestedLanguageLabel(
      requestedLanguage,
      transcript.languages,
      source,
    );

    if (targetLanguage && targetLanguage !== transcript.selectedLanguage) {
      transcript = await transcript.selectLanguage(targetLanguage);
    }

    const segments = (transcript.transcript.content?.body?.initial_segments ?? [])
      .map((segment) => toTranscriptSegment(segment))
      .filter((segment): segment is TranscriptSegmentData => segment !== null);

    return {
      id: source.basic_info.id ?? videoId,
      available: true,
      source: 'transcript_panel',
      requestedLanguage,
      selectedLanguage: transcript.selectedLanguage || targetLanguage,
      languages: transcript.languages.length > 0 ? transcript.languages : knownLanguages,
      unavailableReason: null,
      segmentCount: segments.length,
      segments,
    };
  } catch (error) {
    return {
      id: source.basic_info.id ?? videoId,
      available: false,
      source: 'unavailable',
      requestedLanguage,
      selectedLanguage: null,
      languages: knownLanguages,
      unavailableReason: createUnavailableReason(source, error),
      segmentCount: 0,
      segments: [],
    };
  }
};
