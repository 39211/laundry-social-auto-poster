/**
 * Marks a failure that must never be retried because the remote side may
 * already have committed: rerunning the whole operation would duplicate it
 * (e.g. media_publish whose response was lost in transit — the post can be
 * live even though we saw an error).
 */
export class NonRetryableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NonRetryableError";
  }
}

export async function withRetry<T>(
  run: (attempt: number) => Promise<T>,
  attempts = 3,
  delayMs = 500
): Promise<{ value: T; attempts: number }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return { value: await run(attempt), attempts: attempt };
    } catch (error) {
      if (error instanceof NonRetryableError) throw error;
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  throw lastError;
}
