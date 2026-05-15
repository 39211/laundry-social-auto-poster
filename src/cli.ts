import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function isMain(metaUrl: string): boolean {
  return Boolean(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(metaUrl));
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
