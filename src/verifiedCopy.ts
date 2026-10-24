import { createHash, randomUUID } from "node:crypto";
import { copyFile, readFile, rename, unlink } from "node:fs/promises";

export const VERIFIED_COPY_ATTEMPTS = 3;

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

/**
 * 複製一個檔，最多試 3 次；先複製到同目錄暫存檔、比對 sha256，再 rename 成目標並再驗一次。
 * 遇到 EBUSY 或 errno -4094 會退避重試；都失敗或都對不上就丟錯，錯誤訊息寫出是哪個檔，讓 CLI 以 exit 1 結束。
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
  for (let attempt = 0; attempt < attempts; attempt += 1) {
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
      locked = problem.code === "EBUSY" || problem.errno === -4094;
    } finally {
      await unlink(temporary).catch(() => {});
    }
    // 其他錯誤照舊直接重試；檔案被鎖（EBUSY／-4094）才退避。
    if (locked && attempt + 1 < attempts) await delay(50 * 2 ** attempt);
  }
  throw new Error(`Copy verification failed for ${label} after ${attempts} attempts: ${lastProblem}`);
}
