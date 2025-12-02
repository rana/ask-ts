import chalk from 'chalk';

export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  
  const message = error.message.toLowerCase();
  const retryablePatterns = [
    'too many connections',
    'serviceUnavailableexception',
    'throttling',
    'rate exceeded',
    '503 service unavailable'
  ];
  
  return retryablePatterns.some(pattern => message.includes(pattern));
}

export async function withRetry<T>(
  operation: () => Promise<T>
): Promise<T> {
  const delays = [1000, 2000, 4000]; // Max 3 retries
  
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === delays.length) throw error;
      
      if (isRetryable(error)) {
        const delay = delays[attempt]!;
        console.log(chalk.yellow(`AWS busy, retrying in ${delay/1000}s...`));
        await sleep(delay);
      } else {
        throw error;
      }
    }
  }
  
  // TypeScript requires this, but we never reach here
  throw new Error('Retry loop failed unexpectedly');
}