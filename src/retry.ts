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

// Error codes for a request that never reached the server: name lookup,
// connection refused or unreachable, connect timeout. undici reports them as
// TypeError("fetch failed") with the code on `cause`.
const NEVER_SENT = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);

/**
 * True when a fetch rejection means the request was never sent, so nothing
 * can have been committed on the other side. Such a failure is an ordinary,
 * retryable one even at a commit point; treating it as "response lost" (and so
 * as possibly committed) turned an offline minute into a permanently blocked
 * slot. Anything else -- a reset mid-request, a read timeout -- may have
 * reached the server and stays non-retryable at a commit point.
 */
export function requestNeverSent(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && NEVER_SENT.has(code)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
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
