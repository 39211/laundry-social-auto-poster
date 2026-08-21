import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// argv[1] and import.meta.url can name the same file through different links:
// invoking a CLI via a directory junction leaves the junction path in argv[1]
// while the ESM loader resolves import.meta.url through the real path, so a
// lexical comparison silently skips main() (ERROR-BOOK F28). Compare real
// paths instead. realpath needs the file to exist — when it fails on either
// side, compare both sides lexically: mixing a resolved path with an
// unresolved one can only manufacture a junction-style mismatch. Windows
// paths are case-insensitive.
function tryRealpath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

function fold(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

export function isMain(metaUrl: string): boolean {
  if (!process.argv[1]) return false;
  const argvPath = resolve(process.argv[1]);
  const modulePath = fileURLToPath(metaUrl);
  const argvReal = tryRealpath(argvPath);
  const moduleReal = tryRealpath(modulePath);
  return argvReal !== undefined && moduleReal !== undefined
    ? fold(argvReal) === fold(moduleReal)
    : fold(argvPath) === fold(modulePath);
}

export function getFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

export function getOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = args.indexOf(`--${name}`);
  if (index >= 0) return args[index + 1];
  return undefined;
}

export function getNumberOption(args: string[], name: string): number | undefined {
  const value = getOption(args, name);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`--${name} must be an integer.`);
  }
  return parsed;
}
