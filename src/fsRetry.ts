import { randomUUID } from "node:crypto";
import { rename as nodeRename, unlink as nodeUnlink, writeFile as nodeWriteFile } from "node:fs/promises";

type NodeWriteFile = typeof nodeWriteFile;

const RETRYABLE_CODES = new Set(["UNKNOWN", "EBUSY", "EPERM", "EACCES"]);
const MAX_ATTEMPTS = 6;
const RETRY_DELAYS_MS = [250, 500, 1000, 2000, 3000] as const;

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Last resort after every direct write failed with a retryable code (2026-10-31 hotfix):
 * write a sibling temp file and rename it over the target. On Windows a direct write
 * (CREATE_ALWAYS) fails with UNKNOWN while another process holds a mapped section of
 * the target (seen on docs/rss.xml during scans); a rename still replaces it.
 */
export type AtomicReplace = (file: string, data: Parameters<NodeWriteFile>[1], options: Parameters<NodeWriteFile>[2]) => Promise<void>;

export const atomicReplace: AtomicReplace = async (file, data, options) => {
  const tempPath = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await nodeWriteFile(tempPath, data, options);
    await nodeRename(tempPath, file);
  } finally {
    await nodeUnlink(tempPath).catch(() => undefined);
  }
};

export function createWriteFileWithRetry(deps: {
  write: NodeWriteFile;
  sleep: (ms: number) => Promise<void>;
  replace?: AtomicReplace;
}): NodeWriteFile {
  const writeFileWithRetry: NodeWriteFile = async (file, data, options) => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        await deps.write(file, data, options);
        return;
      } catch (error) {
        lastError = error;
        const code = errorCode(error);
        const retryable = code !== undefined && RETRYABLE_CODES.has(code);
        if (retryable && attempt >= MAX_ATTEMPTS && deps.replace && typeof file === "string") {
          try {
            await deps.replace(file, data, options);
            process.stderr.write(`writeFile atomic fallback ok ${file}: ${code}\n`);
            return;
          } catch {
            throw error;
          }
        }
        if (!retryable || attempt >= MAX_ATTEMPTS) throw error;
        const delay = RETRY_DELAYS_MS[attempt - 1];
        if (delay === undefined) throw error;
        process.stderr.write(`writeFile retry ${attempt}/${MAX_ATTEMPTS} ${String(file)}: ${code}\n`);
        await deps.sleep(delay);
      }
    }
    throw lastError;
  };

  return writeFileWithRetry;
}

export const writeFileWithRetry = createWriteFileWithRetry({
  write: nodeWriteFile,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  replace: atomicReplace
});
