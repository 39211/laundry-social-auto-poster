import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getSlotPublishTime } from "./publishTimes";

// 成功發布後的清單。posted-log 維持原格式；這份檔只追加列。
// dry-run 預設只寫暫存目錄。寫入失敗記一筆 log，不重試、不往外拋。

export interface PublishListRow {
  topic: string;
  platform: "facebook" | "instagram" | "youtube";
  published_at: string;
  slot: string;
  title: string;
  hashtags: string[];
  link: string;
}

export interface SuccessfulPublishInput {
  status: string;
  root: string;
  date: string;
  slot: number;
  topic: string;
  platform: string;
  publishedAt: string;
  caption: string;
  dryRun?: boolean;
  youtubeTitle?: string;
  postId?: string;
  mediaType?: string;
}

const LIST_PLATFORMS = new Set(["facebook", "instagram", "youtube"]);

export function extractPublishHashtags(caption: string): string[] {
  const matches = caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const match of matches) {
    const tag = match.replace(/[，。！？、,.;:!?)]+$/u, "");
    if (tag.length <= 1 || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

export function publishListFilePath(root: string, dryRun = true): string {
  if (dryRun) {
    const key = createHash("sha256").update(root).digest("hex").slice(0, 16);
    return join(tmpdir(), "laundry-publish-list", key, "publish-list.jsonl");
  }
  return join(root, "data", "publish-list.jsonl");
}

export async function readPublishList(root: string, dryRun = true): Promise<PublishListRow[]> {
  try {
    const raw = await readFile(publishListFilePath(root, dryRun), "utf8");
    return raw
      .split(/\n/u)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as PublishListRow);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function shouldRecord(status: string, platform: string): boolean {
  if (!LIST_PLATFORMS.has(platform)) return false;
  if (status === "uncertain" || status === "failed") return false;
  if (status === "success" || status === "posted") return true;
  return platform === "youtube" && status === "scheduled";
}

function titleFor(input: SuccessfulPublishInput): string {
  if (input.platform === "youtube") return input.youtubeTitle ?? "";
  return (input.caption.split(/\r?\n/u)[0] ?? "").trim();
}

export function buildPublishLink(platform: string, postId: string | undefined, mediaType?: string): string {
  const id = postId?.trim() ?? "";
  if (!id) return "";
  if (platform === "youtube") {
    return /^[A-Za-z0-9_-]{11}$/u.test(id) ? `https://www.youtube.com/shorts/${id}` : "";
  }
  if (platform === "facebook") {
    const pair = id.match(/^(\d+)_(\d+)$/u);
    if (pair) return `https://www.facebook.com/${pair[1]}/posts/${pair[2]}`;
    if ((mediaType === "reel" || mediaType === "mixed-carousel") && /^\d+$/u.test(id)) {
      return `https://www.facebook.com/reel/${id}`;
    }
  }
  return "";
}

export async function recordSuccessfulPublish(input: SuccessfulPublishInput): Promise<void> {
  if (!shouldRecord(input.status, input.platform)) return;
  const dryRun = input.dryRun !== false;
  try {
    const time = getSlotPublishTime(input.date, input.slot, input.root);
    const row: PublishListRow = {
      topic: input.topic,
      platform: input.platform as PublishListRow["platform"],
      published_at: input.publishedAt,
      slot: `${input.slot} ${time}`,
      title: titleFor(input),
      hashtags: extractPublishHashtags(input.caption),
      link: buildPublishLink(input.platform, input.postId, input.mediaType)
    };
    const filePath = publishListFilePath(input.root, dryRun);
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(row)}\n`, "utf8");
  } catch (error) {
    console.warn(`publish-list write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
