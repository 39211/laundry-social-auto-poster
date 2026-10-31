import { randomUUID } from "node:crypto";
import { mkdir as nodeMkdir, rename as nodeRename, unlink as nodeUnlink, writeFile as nodeWriteFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { projectRoot } from "./paths";

type NodeWriteFile = typeof nodeWriteFile;

const RETRYABLE_CODES = new Set(["UNKNOWN", "EBUSY", "EPERM", "EACCES"]);
const MAX_ATTEMPTS = 6;
const RETRY_DELAYS_MS = [250, 500, 1000, 2000, 3000] as const;

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function errorDescription(error: unknown): string {
  const code = errorCode(error);
  if (code !== undefined) return code;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

/**
 * Last resort after every direct write failed with a retryable code (2026-10-31 hotfix):
 * write a sibling temp file and rename it over the target. On Windows a direct write
 * (CREATE_ALWAYS) fails with UNKNOWN while another process holds a mapped section of
 * the target (seen on docs/rss.xml during scans); a rename still replaces it.
 */
export type AtomicReplace = (file: string, data: Parameters<NodeWriteFile>[1], options: Parameters<NodeWriteFile>[2]) => Promise<void>;

export type AtomicReplaceDependencies = {
  writeFile: NodeWriteFile;
  rename: (oldPath: string, newPath: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
  mkdir: (path: string, options: { recursive: true }) => Promise<unknown>;
  lockedFilesDirectory: () => string;
  uniqueId: () => string;
  now: () => Date;
};

const MOVE_REPLACE_CODES = new Set(["EPERM", "EACCES", "EBUSY", "UNKNOWN"]);

function isSameOrWithin(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(parentPath), resolve(candidatePath));
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

export function createAtomicReplace(deps: AtomicReplaceDependencies): AtomicReplace {
  return async (file, data, options) => {
    const tempPath = `${file}.${process.pid}.${deps.uniqueId()}.tmp`;
    try {
      await deps.writeFile(tempPath, data, options);
      try {
        await deps.rename(tempPath, file);
        return;
      } catch (initialRenameError) {
        const initialCode = errorCode(initialRenameError);
        if (initialCode === undefined || !MOVE_REPLACE_CODES.has(initialCode)) throw initialRenameError;

        const targetDirectory = dirname(file);
        const lockedFilesDirectory = deps.lockedFilesDirectory();
        if (isSameOrWithin(targetDirectory, lockedFilesDirectory)) throw initialRenameError;

        await deps.mkdir(lockedFilesDirectory, { recursive: true });
        const timestamp = deps.now().toISOString().replace(/[:.]/g, "-");
        const asidePath = join(lockedFilesDirectory, `${timestamp}-${process.pid}-${deps.uniqueId()}-${basename(file)}`);
        await deps.rename(file, asidePath);
        try {
          await deps.rename(tempPath, file);
        } catch (installError) {
          try {
            await deps.rename(asidePath, file);
          } catch {
            process.stderr.write(`writeFile atomic fallback restore failed ${file}: original left at ${asidePath}\n`);
          }
          throw installError;
        }
        process.stderr.write(`writeFile atomic fallback moved locked original ${file} -> ${asidePath}\n`);
      }
    } finally {
      await deps.unlink(tempPath).catch(() => undefined);
    }
  };
}

const defaultAtomicReplaceDependencies: AtomicReplaceDependencies = {
  writeFile: nodeWriteFile,
  rename: nodeRename,
  unlink: nodeUnlink,
  mkdir: (path, options) => nodeMkdir(path, options),
  lockedFilesDirectory: () => join(projectRoot(), "output", "locked-files"),
  uniqueId: randomUUID,
  now: () => new Date()
};

export const atomicReplace: AtomicReplace = createAtomicReplace(defaultAtomicReplaceDependencies);

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
          } catch (replaceError) {
            process.stderr.write(`writeFile atomic fallback failed ${file}: ${errorDescription(replaceError)}\n`);
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
