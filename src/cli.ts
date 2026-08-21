import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// argv[1] and import.meta.url can name the same file through different links:
// invoking a CLI via a directory junction leaves the junction path in argv[1]
// while the ESM loader resolves import.meta.url through the real path, so a
// lexical comparison silently skips main() (ERROR-BOOK F28). Each operand
// therefore names its file under every spelling it can prove — the path as
// given plus its realpath when that resolves — and the operands match when
// any spellings coincide. Demanding one shared layer instead (both real, or
// both lexical) turns a realpath failure on one side into a junction-style
// mismatch again, because the surviving spellings are the ones that agree.
// Windows paths are case-insensitive.
function fold(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function spellings(path: string): string[] {
  const known = [fold(path)];
  try {
    const real = fold(realpathSync(path));
    if (!known.includes(real)) known.push(real);
  } catch {
    // realpath needs the file to exist; the given spelling still counts.
  }
  return known;
}

export function isMain(metaUrl: string): boolean {
  if (!process.argv[1]) return false;
  const argvSpellings = spellings(resolve(process.argv[1]));
  return spellings(fileURLToPath(metaUrl)).some((spelling) =>
    argvSpellings.includes(spelling),
  );
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
