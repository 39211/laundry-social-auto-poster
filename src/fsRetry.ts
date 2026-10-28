import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile as nodeWriteFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createConcurrencyLimiter } from "./concurrencyLimit";
import { isLockedError, VERIFIED_COPY_ATTEMPTS, VERIFIED_COPY_BACKOFF_MS } from "./verifiedCopy";

type NodeWriteFile = typeof nodeWriteFile;

/** 同時進行中的寫檔上限（含重試與等待）；產生公開站一次會丟出數百個 writeFile，不限制會同時搶檔案鎖（-4094）。 */
export const MAX_CONCURRENT_WRITES = 8;

function errorErrno(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("errno" in error)) return undefined;
  const errno = (error as { errno?: unknown }).errno;
  return typeof errno === "number" ? errno : undefined;
}

export function createWriteFileWithRetry(deps: {
  write: NodeWriteFile;
  sleep: (ms: number) => Promise<void>;
  rename?: typeof rename;
  read?: (file: string) => Promise<Buffer>;
  remove?: typeof unlink;
  now?: () => Date;
  maxConcurrentWrites?: number;
}): NodeWriteFile {
  const limit = createConcurrencyLimiter(deps.maxConcurrentWrites ?? MAX_CONCURRENT_WRITES);
  const now = deps.now ?? (() => new Date());
  const writeOne: NodeWriteFile = async (file, data, options) => {
    if (typeof file === "object" && !Buffer.isBuffer(file) && !(file instanceof URL)) {
      throw new TypeError("writeFileWithRetry requires a file path");
    }
    const target = file instanceof URL ? fileURLToPath(file) : String(file);
    const encoding = typeof options === "string" ? options : options?.encoding ?? "utf8";
    // 先固定本次寫入的位元組，串流重試時也不會讀到空資料。
    const chunks: Buffer[] = [];
    if (typeof data === "string") chunks.push(Buffer.from(data, encoding));
    else if (ArrayBuffer.isView(data)) chunks.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    else for await (const chunk of data as AsyncIterable<string | NodeJS.ArrayBufferView> | Iterable<string | NodeJS.ArrayBufferView>) chunks.push(typeof chunk === "string" ? Buffer.from(chunk, encoding) : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    const bytes = Buffer.concat(chunks);
    const expected = createHash("sha256").update(bytes).digest("hex");
    for (let attempt = 0; attempt < VERIFIED_COPY_ATTEMPTS; attempt += 1) {
      const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
      try {
        await deps.write(temporary, bytes, options);
        await (deps.rename ?? rename)(temporary, target);
        const actual = createHash("sha256").update(await (deps.read ?? readFile)(target)).digest("hex");
        if (actual !== expected) throw new Error(`Write verification failed for ${target}: sha256 mismatch`);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | null)?.code;
        if (!isLockedError(error) && code !== "UNKNOWN") throw error;
        const errno = errorErrno(error);
        const errnoText = errno === undefined ? "" : ` errno=${errno}`;
        // 每次失敗都記錄時間；用完次數的最後一次也先寫 log 再丟錯。
        process.stderr.write(
          `${now().toISOString()} writeFile retry ${attempt + 1}/${VERIFIED_COPY_ATTEMPTS} ${target}: ${code ?? "none"}${errnoText}\n`
        );
        if (attempt + 1 >= VERIFIED_COPY_ATTEMPTS) throw error;
      } finally {
        await (deps.remove ?? unlink)(temporary).catch(() => {});
      }
      await deps.sleep(VERIFIED_COPY_BACKOFF_MS[attempt]!);
    }
  };

  const writeFileWithRetry: NodeWriteFile = (file, data, options) => limit(() => writeOne(file, data, options));
  return writeFileWithRetry;
}

export const writeFileWithRetry = createWriteFileWithRetry({
  write: nodeWriteFile,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
});
