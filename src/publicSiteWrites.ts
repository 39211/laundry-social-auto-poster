/** The limit belongs to this generator; other writers keep their own behavior. */
export function publicSiteWriteConcurrency(value: number | string | undefined): number {
  const limit = value === undefined || value === "" ? 8 : Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("Public site write concurrency must be a positive integer (PUBLIC_SITE_WRITE_CONCURRENCY / --write-concurrency).");
  }
  return limit;
}

/** Preserve input order, stop dispatch on failure, and drain writes already in flight. */
export async function mapPublicSiteWrites<T, R>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failed = false;
  let firstError: unknown;
  async function worker(): Promise<void> {
    while (!failed && cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await operation(items[index]!, index);
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  if (failed) throw firstError;
  return results;
}
