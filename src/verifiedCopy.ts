import { createHash, randomUUID } from "node:crypto";
import { copyFile, readFile, rename, unlink } from "node:fs/promises";

export const VERIFIED_COPY_ATTEMPTS = 6;
export const VERIFIED_COPY_BACKOFF_MS = [250, 500, 1000, 2000, 3000] as const;

export function isLockedError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, errno } = error as NodeJS.ErrnoException;
  return code === "EBUSY" || code === "EPERM" || code === "EACCES" || errno === -4094;
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

/**
 * 複製一個檔，最多試 6 次（fsRetry 的 writeFile 共用同一組次數與退避）；先複製到同目錄暫存檔、比對 sha256，再 rename 成目標並再驗一次。
 * 遇到 EBUSY、EPERM、EACCES 或 errno -4094 會退避重試；都失敗或都對不上就丟錯，錯誤訊息寫出是哪個檔，讓 CLI 以 exit 1 結束。
 */
export async function copyFileVerified(
  source: string,
  target: string,
  label: string = target,
  attempts: number = VERIFIED_COPY_ATTEMPTS,
  delay: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds))
): Promise<void> {
  const expected = await sha256(source);
  let lastProblem = "";
  for (let attempt = 0; attempt < Math.min(attempts, VERIFIED_COPY_ATTEMPTS); attempt += 1) {
    const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
    let locked = false;
    try {
      await copyFile(source, temporary);
      const staged = await sha256(temporary);
      if (staged !== expected) {
        lastProblem = `sha256 mismatch: source ${expected}, temporary ${staged}`;
        continue;
      }
      await rename(temporary, target);
      const actual = await sha256(target);
      if (actual === expected) return;
      lastProblem = `sha256 mismatch: source ${expected}, destination ${actual}`;
    } catch (error) {
      const problem = error as NodeJS.ErrnoException;
      lastProblem = `copy error: ${problem.message}`;
      locked = isLockedError(error);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    // 其他錯誤照舊直接重試；檔案被鎖（EBUSY／EPERM／EACCES／-4094）才退避。
    if (locked && attempt + 1 < Math.min(attempts, VERIFIED_COPY_ATTEMPTS)) await delay(VERIFIED_COPY_BACKOFF_MS[attempt]!);
  }
  throw new Error(`Copy verification failed for ${label} after ${attempts} attempts: ${lastProblem}`);
}
