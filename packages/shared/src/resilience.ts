export interface RetryContext {
  attempt: number;
  maxAttempts: number;
  nextDelayMs: number;
  error: unknown;
}

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (context: RetryContext) => void;
}

const sleep = (delayMs: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
};

const toPositiveInteger = (value: number | undefined, fallback: number): number => {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
};

export const isRetriableHttpStatus = (statusCode: number): boolean => {
  return [408, 425, 429, 500, 502, 503, 504].includes(statusCode);
};

export const withRetries = async <T>(
  run: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> => {
  const maxAttempts = toPositiveInteger(options.maxAttempts, 3);
  const initialDelayMs = toPositiveInteger(options.initialDelayMs, 250);
  const maxDelayMs = toPositiveInteger(options.maxDelayMs, 2_000);

  let attempt = 0;
  let delayMs = initialDelayMs;

  while (true) {
    attempt += 1;

    try {
      return await run();
    } catch (error) {
      const shouldRetry =
        attempt < maxAttempts && (options.shouldRetry ? options.shouldRetry(error, attempt) : true);

      if (!shouldRetry) {
        throw error;
      }

      options.onRetry?.({
        attempt,
        maxAttempts,
        nextDelayMs: delayMs,
        error,
      });

      await sleep(delayMs);
      delayMs = Math.min(maxDelayMs, delayMs * 2);
    }
  }
};
