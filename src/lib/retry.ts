import { output } from './output.ts';

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  const retryablePatterns = [
    'too many connections',
    'serviceUnavailableexception',
    'throttling',
    'rate exceeded',
    '503 service unavailable',
  ];

  return retryablePatterns.some((pattern) => message.includes(pattern));
}

export async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  const delays = [1000, 2000, 4000];

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === delays.length) throw error;

      if (isRetryable(error)) {
        const delay = delays[attempt]!;
        output.warning(`AWS busy, retrying in ${delay / 1000}s...`);
        await sleep(delay);
      } else {
        throw error;
      }
    }
  }

  throw new Error('Retry loop failed unexpectedly');
}
