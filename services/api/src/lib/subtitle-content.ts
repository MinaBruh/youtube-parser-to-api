import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { Innertube } from 'youtubei.js';
import { isRetriableHttpStatus, withRetries } from '@ytpa/shared';

const execFileAsync = promisify(execFile);
const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultYtDlpVendorDir = join(currentDir, '../../../../tools/yt_dlp_vendor');

export const CAPTION_CONTENT_FORMATS = [
  'raw',
  'vtt',
  'ttml',
  'srv3',
  'json3',
] as const;

export type CaptionContentFormat = (typeof CAPTION_CONTENT_FORMATS)[number];

type BasicVideoInfo = Awaited<ReturnType<Innertube['getBasicInfo']>>;
type CaptionsSource = Pick<BasicVideoInfo, 'captions'>;
type CaptionTrackData = NonNullable<
  NonNullable<NonNullable<CaptionsSource['captions']>['caption_tracks']>
>[number];

export interface CaptionContentResult {
  body: Buffer;
  contentType: string;
  source: 'upstream' | 'yt-dlp';
}

export class CaptionTrackNotFoundError extends Error {
  constructor(trackId: string) {
    super(`Caption track "${trackId}" was not found for this video.`);
    this.name = 'CaptionTrackNotFoundError';
  }
}

const getContentType = (format: CaptionContentFormat): string => {
  switch (format) {
    case 'json3':
      return 'application/json; charset=utf-8';
    case 'srv3':
      return 'application/xml; charset=utf-8';
    case 'ttml':
      return 'application/ttml+xml; charset=utf-8';
    case 'vtt':
    case 'raw':
    default:
      return 'text/vtt; charset=utf-8';
  }
};

const withFormat = (baseUrl: string, format: CaptionContentFormat): string => {
  if (format === 'raw') {
    return baseUrl;
  }

  const url = new URL(baseUrl);
  url.searchParams.set('fmt', format);
  return url.toString();
};

const isUsableSubtitleResponse = (
  contentType: string | null,
  body: Buffer,
): boolean => {
  if (body.length === 0) {
    return false;
  }

  if (!contentType) {
    return true;
  }

  return !contentType.toLowerCase().includes('text/html');
};

const buildLanguageSelector = (languageCode: string): string => {
  const baseLanguage = languageCode.split('-')[0];
  return baseLanguage && baseLanguage !== languageCode
    ? `${languageCode},${baseLanguage}`
    : languageCode;
};

const getYtDlpPythonPath = (): string => {
  return process.env.YT_DLP_PYTHON?.trim() || 'python';
};

const getYtDlpPythonPathEnv = async (): Promise<string | null> => {
  const configured = process.env.YT_DLP_PYTHONPATH?.trim();

  if (configured) {
    return configured;
  }

  try {
    await access(defaultYtDlpVendorDir);
    return defaultYtDlpVendorDir;
  } catch {
    return null;
  }
};

class RetryableTimedTextError extends Error {
  constructor(public readonly statusCode: number) {
    super(`Retryable timedtext response: ${statusCode}`);
    this.name = 'RetryableTimedTextError';
  }
}

const isRetryableTimedTextError = (error: unknown): boolean => {
  return error instanceof RetryableTimedTextError || error instanceof TypeError;
};

const fetchFromUpstream = async (
  track: CaptionTrackData,
  format: CaptionContentFormat,
): Promise<CaptionContentResult | null> => {
  const response = await withRetries(
    async () => {
      const upstreamResponse = await fetch(withFormat(track.base_url, format), {
        headers: {
          'accept-encoding': 'identity',
          'accept-language': 'en-US,en;q=0.9',
          'origin': 'https://www.youtube.com',
          'referer': 'https://www.youtube.com/',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
      });

      if (!upstreamResponse.ok && isRetriableHttpStatus(upstreamResponse.status)) {
        throw new RetryableTimedTextError(upstreamResponse.status);
      }

      return upstreamResponse;
    },
    {
      maxAttempts: 3,
      initialDelayMs: 250,
      maxDelayMs: 1_000,
      shouldRetry: (error) => isRetryableTimedTextError(error),
    },
  );

  if (!response.ok) {
    return null;
  }

  const body = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type');

  if (!isUsableSubtitleResponse(contentType, body)) {
    return null;
  }

  return {
    body,
    contentType: contentType ?? getContentType(format),
    source: 'upstream',
  };
};

const downloadWithYtDlp = async (
  videoId: string,
  track: CaptionTrackData,
  format: CaptionContentFormat,
): Promise<CaptionContentResult | null> => {
  const pythonPathEnv = await getYtDlpPythonPathEnv();

  if (!pythonPathEnv) {
    return null;
  }

  const workingDirectory = await mkdtemp(join(tmpdir(), 'ytpa-captions-'));
  const requestedFormat = format === 'raw' ? 'vtt' : format;

  try {
    const args = [
      '-m',
      'yt_dlp',
      '--skip-download',
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs',
      buildLanguageSelector(track.language_code),
      '--sub-format',
      requestedFormat,
      '--output',
      'subtitle.%(ext)s',
      '--quiet',
      '--no-warnings',
      '--no-progress',
      '--js-runtimes',
      'node',
      `https://www.youtube.com/watch?v=${videoId}`,
    ];

    await execFileAsync(getYtDlpPythonPath(), args, {
      cwd: workingDirectory,
      env: {
        ...process.env,
        PYTHONPATH: pythonPathEnv,
      },
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });

    const files = await readdir(workingDirectory);
    const requestedExtension = `.${requestedFormat}`;
    const subtitleFile = files.find((fileName) => fileName.endsWith(requestedExtension));

    if (!subtitleFile) {
      return null;
    }

    const body = await readFile(join(workingDirectory, subtitleFile));

    if (body.length === 0) {
      return null;
    }

    return {
      body,
      contentType: getContentType(format),
      source: 'yt-dlp',
    };
  } catch {
    return null;
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
};

const getTrackById = (
  source: CaptionsSource,
  trackId: string,
): CaptionTrackData => {
  const track = (source.captions?.caption_tracks ?? []).find((item) => item.vss_id === trackId);

  if (!track) {
    throw new CaptionTrackNotFoundError(trackId);
  }

  return track;
};

export const parseCaptionContentFormat = (
  value: string | undefined,
): CaptionContentFormat => {
  if (!value) {
    return 'vtt';
  }

  if (CAPTION_CONTENT_FORMATS.includes(value as CaptionContentFormat)) {
    return value as CaptionContentFormat;
  }

  throw new Error(
    `Invalid "format" value. Allowed values: ${CAPTION_CONTENT_FORMATS.join(', ')}.`,
  );
};

export const resolveCaptionTrackContent = async (
  videoId: string,
  source: CaptionsSource,
  trackId: string,
  format: CaptionContentFormat,
): Promise<CaptionContentResult> => {
  const track = getTrackById(source, trackId);
  const upstreamResult = await fetchFromUpstream(track, format);

  if (upstreamResult) {
    return upstreamResult;
  }

  const ytDlpResult = await downloadWithYtDlp(videoId, track, format);

  if (ytDlpResult) {
    return ytDlpResult;
  }

  throw new Error('Caption content is unavailable from both direct upstream timedtext and yt-dlp fallback.');
};

