import { createHash } from "node:crypto";
import { copyFile, readFile } from "node:fs/promises";

export const VERIFIED_COPY_ATTEMPTS = 3;

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

/**
 * 複製一個檔，最多試 3 次；每次複製完比對來源和目標的 sha256。
 * 3 次都失敗或都對不上就丟錯，錯誤訊息寫出是哪個檔，讓 CLI 以 exit 1 結束。
 */
export async function copyFileVerified(
  source: string,
  target: string,
  label: string = target,
  attempts: number = VERIFIED_COPY_ATTEMPTS
): Promise<void> {
  const expected = await sha256(source);
  let lastProblem = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await copyFile(source, target);
    } catch (error) {
      lastProblem = `copy error: ${(error as Error).message}`;
      continue;
    }
    const actual = await sha256(target).catch((error: Error) => `unreadable (${error.message})`);
    if (actual === expected) return;
    lastProblem = `sha256 mismatch: source ${expected}, destination ${actual}`;
  }
  throw new Error(`Copy verification failed for ${label} after ${attempts} attempts: ${lastProblem}`);
}
