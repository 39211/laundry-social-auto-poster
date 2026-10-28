import { writeFile as nodeWriteFile } from "node:fs/promises";

type NodeWriteFile = typeof nodeWriteFile;

const RETRYABLE_CODES = new Set(["UNKNOWN", "EBUSY", "EPERM", "EACCES"]);
const MAX_ATTEMPTS = 6;
const RETRY_DELAYS_MS = [250, 500, 1000, 2000, 3000] as const;

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function errorErrno(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("errno" in error)) return undefined;
  const errno = (error as { errno?: unknown }).errno;
  return typeof errno === "number" ? errno : undefined;
}

export function createWriteFileWithRetry(deps: {
  write: NodeWriteFile;
  sleep: (ms: number) => Promise<void>;
  now?: () => Date;
}): NodeWriteFile {
  const now = deps.now ?? (() => new Date());
  const writeFileWithRetry: NodeWriteFile = async (file, data, options) => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        await deps.write(file, data, options);
        return;
      } catch (error) {
        lastError = error;
        const code = errorCode(error);
        const errno = errorErrno(error);
        const retryable = (code !== undefined && RETRYABLE_CODES.has(code)) || errno === -4094;
        if (!retryable) throw error;
        const errnoText = errno === undefined ? "" : ` errno=${errno}`;
        process.stderr.write(
          `${now().toISOString()} writeFile retry ${attempt}/${MAX_ATTEMPTS} ${String(file)}: ${code ?? "UNKNOWN"}${errnoText}\n`
        );
        if (attempt >= MAX_ATTEMPTS) throw error;
        const delay = RETRY_DELAYS_MS[attempt - 1];
        if (delay === undefined) throw error;
        await deps.sleep(delay);
      }
    }
    throw lastError;
  };

  return writeFileWithRetry;
}

export const writeFileWithRetry = createWriteFileWithRetry({
  write: nodeWriteFile,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
});
