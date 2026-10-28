/**
 * 同時最多跑 `max` 個非同步工作，其餘排隊，先進先出。
 * 用在大量並行寫檔：Windows 上同時開太多檔會撞 EBUSY／errno -4094，限制同時數量比事後重試更根本。
 * 工作丟錯或回傳都會釋放名額，不會卡住後面的排隊者。
 */
export function createConcurrencyLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  if (!Number.isInteger(max) || max < 1) throw new RangeError(`concurrency limit must be a positive integer, got ${max}`);
  let active = 0;
  const waiting: Array<() => void> = [];

  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };

  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) {
      // 名額由前一個工作直接交棒，active 不變，避免被新進來的工作插隊。
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      active += 1;
    }
    try {
      return await task();
    } finally {
      release();
    }
  };
}
