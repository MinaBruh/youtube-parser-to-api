import { toClientUrl } from './api';

export const pickThumbnail = (thumbnails: Array<{ proxyUrl?: string | null; url: string }> | null | undefined): string => {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) {
    return '';
  }

  const preferred = thumbnails[thumbnails.length - 1] ?? thumbnails[0];
  return toClientUrl(preferred?.proxyUrl ?? preferred?.url ?? '') ?? '';
};

export const formatViewCount = (value: number | null | undefined): string => {
  if (!value) {
    return 'No views yet';
  }

  return `${new Intl.NumberFormat().format(value)} views`;
};

export const formatDuration = (value: number | null | undefined): string => {
  if (!value || value <= 0) {
    return 'Live';
  }

  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;

  if (hours > 0) {
    return [hours, minutes, seconds].map((segment) => String(segment).padStart(2, '0')).join(':');
  }

  return [minutes, seconds].map((segment) => String(segment).padStart(2, '0')).join(':');
};

export const formatRelativeLabel = (...values: Array<string | null | undefined>): string => {
  return values.filter((value) => typeof value === 'string' && value.trim().length > 0).join(' | ');
};
