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

export function createWriteFileWithRetry(deps: {
  write: NodeWriteFile;
  sleep: (ms: number) => Promise<void>;
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
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
});
