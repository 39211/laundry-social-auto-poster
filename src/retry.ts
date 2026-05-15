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
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  throw lastError;
}
