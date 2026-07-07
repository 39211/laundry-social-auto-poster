import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { posix } from "node:path";

export function projectRoot(root = process.env.PROJECT_ROOT || process.cwd()): string {
  return resolve(root);
}

export function padSlot(slot: number): string {
  return String(slot).padStart(2, "0");
}

export function relativeAssetPath(date: string, slot: number): string {
  return posix.join("docs", "assets", date, `slot-${padSlot(slot)}.png`);
}

export function publicAssetPath(date: string, slot: number): string {
  return posix.join("assets", date, `slot-${padSlot(slot)}.png`);
}

export function assetDirectory(date: string, root = projectRoot()): string {
  return join(root, "docs", "assets", date);
}

export function assetFilePath(date: string, slot: number, root = projectRoot()): string {
  return join(root, "docs", "assets", date, `slot-${padSlot(slot)}.png`);
}

export function contentCalendarPath(date: string, root = projectRoot()): string {
  return join(root, "data", "content-calendar", `${date}.json`);
}

export function docsContentCalendarPath(date: string, root = projectRoot()): string {
  return join(root, "docs", "content-calendar", `${date}.json`);
}

export function imagePromptManifestPath(date: string, root = projectRoot()): string {
  return join(root, "data", "image-prompts", `${date}.json`);
}

export function dailyContextPath(date: string, root = projectRoot()): string {
  return join(root, "data", "daily-context", `${date}.json`);
}

export function imageSourcesPath(date: string, root = projectRoot()): string {
  return join(root, "data", "image-sources", `${date}.json`);
}

export function postedLogPath(date: string, root = projectRoot()): string {
  return join(root, "data", "posted-log", `${date}.json`);
}

export function approvedLogPath(date: string, root = projectRoot()): string {
  return join(root, "data", "approved-log", `${date}.json`);
}

export async function ensureProjectDirectories(date: string, root = projectRoot()): Promise<void> {
  await Promise.all([
    mkdir(assetDirectory(date, root), { recursive: true }),
    mkdir(join(root, "docs", "content-calendar"), { recursive: true }),
    mkdir(join(root, "data", "daily-context"), { recursive: true }),
    mkdir(join(root, "data", "content-calendar"), { recursive: true }),
    mkdir(join(root, "data", "image-prompts"), { recursive: true }),
    mkdir(join(root, "data", "image-sources"), { recursive: true }),
    mkdir(join(root, "data", "approved-log"), { recursive: true }),
    mkdir(join(root, "data", "posted-log"), { recursive: true })
  ]);
}
