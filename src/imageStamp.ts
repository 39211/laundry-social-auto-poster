import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The evidence an image file carries about how it was made.
 *
 * Both the approval gate and the marking command need to compute the same three
 * things from the same inputs, and when those two computations lived in two
 * files they drifted -- the gate compared a topic the marker had never promised
 * to write. One module, one definition.
 */

export interface ManifestEntry {
  slot?: number;
  target_path?: string;
  topic?: string;
  prompt?: string;
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function hashImageFile(root: string, imagePath: string): Promise<string | undefined> {
  try {
    return sha256(await readFile(join(root, ...imagePath.split("/"))));
  } catch {
    return undefined;
  }
}

export async function loadImagePromptManifest(
  root: string,
  date: string
): Promise<ManifestEntry[] | undefined> {
  try {
    const raw = await readFile(join(root, "data", "image-prompts", `${date}.json`), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ManifestEntry[]) : undefined;
  } catch {
    // Unreadable is not "absent": both callers must treat it as unproven rather
    // than as permission to skip the check.
    return undefined;
  }
}

export function manifestEntryFor(
  manifest: ManifestEntry[] | undefined,
  imagePath: string
): ManifestEntry | undefined {
  // Matched per file, not per slot. A carousel has one entry per slide, and
  // matching by slot alone meant slides 2-4 were judged by slide 1's prompt.
  return manifest?.find((entry) => entry.target_path === imagePath);
}

export function promptHashFor(
  manifest: ManifestEntry[] | undefined,
  imagePath: string
): string | undefined {
  const prompt = manifestEntryFor(manifest, imagePath)?.prompt;
  return typeof prompt === "string" ? sha256(prompt) : undefined;
}

/**
 * Every reason a slot's images fail to prove they belong to its caption.
 *
 * This lives here, and is the only implementation, because three entry points
 * need it and the pipeline has already been bitten twice by one rule with two
 * implementations -- the caption contact line that Reels skipped, and the gate
 * that compared a field the marker never wrote. Approval, manual approval and
 * publishing all ask this same function.
 *
 * Returns one message per failing image. An empty array means proven.
 */
export async function imageEvidenceFailures(
  root: string,
  date: string,
  slot: { slot: number; topic: string },
  assets: Array<{ local_image_path: string }>,
  records: ImageSourceLike[]
): Promise<string[]> {
  if (assets.length === 0) return [];
  const manifest = await loadImagePromptManifest(root, date);
  if (!manifest) {
    return [`slot ${slot.slot} 圖片 manifest 缺失或無法解析,圖文一致性未證明`];
  }

  const failures: string[] = [];
  for (const asset of assets) {
    const path = asset.local_image_path;
    const say = (why: string) => failures.push(`slot ${slot.slot} ${path} ${why}`);

    const entry = manifestEntryFor(manifest, path);
    if (!entry) {
      say("在圖片 manifest 中沒有對應條目,圖文一致性未證明");
      continue;
    }
    if (entry.topic !== slot.topic) {
      say(
        `文不配圖:manifest 記為「${String(entry.topic).slice(0, 16)}」,文案是「${slot.topic.slice(0, 16)}」`
      );
      continue;
    }

    // Matched on slot AND path. The publishable-image gate matches on path
    // alone, so a record filed under the wrong slot satisfies it while proving
    // nothing here -- which is why this refuses rather than deferring to it.
    const record = records.find((r) => r.slot === slot.slot && r.image_path === path);
    if (!record) {
      say("沒有屬於這一格的來源紀錄,圖文一致性未證明");
      continue;
    }
    if (typeof record.topic !== "string") {
      say("來源紀錄沒有記錄產生當下的主題,圖文一致性未證明");
      continue;
    }
    if (record.topic !== slot.topic) {
      say(`文不配圖:這個檔案是為「${record.topic.slice(0, 16)}」產生的,文案是「${slot.topic.slice(0, 16)}」`);
      continue;
    }

    // The bytes must be the bytes that were stamped. Without this the topic is
    // just a label anyone can move onto any file.
    const onDisk = await hashImageFile(root, path);
    if (!onDisk) {
      say("讀不到檔案,無法比對蓋章時的位元");
      continue;
    }
    if (typeof record.image_sha256 !== "string") {
      say("來源紀錄沒有記錄蓋章時的檔案雜湊,圖文一致性未證明");
      continue;
    }
    if (record.image_sha256 !== onDisk) {
      say("圖片在蓋章之後被換過,現在的檔案沒有被任何紀錄背書");
      continue;
    }

    const currentPromptHash = promptHashFor(manifest, path);
    if (typeof record.prompt_sha256 !== "string" || currentPromptHash === undefined) {
      say("來源紀錄或 manifest 沒有提示詞雜湊,圖文一致性未證明");
      continue;
    }
    if (record.prompt_sha256 !== currentPromptHash) {
      say("提示詞已經改過,但圖片還是舊的那一張");
    }
  }
  return failures;
}

/**
 * Images whose bytes no longer match the stamp they were approved with.
 *
 * Deliberately narrower than `imageEvidenceFailures`: proving provenance is the
 * approval gate's job, and re-asking that question at publish time would strand
 * every day approved before stamps existed. This asks only "did the picture
 * change after we agreed to it", which is the one thing approval cannot see
 * because it happens afterwards, and which no fingerprint catches because the
 * fingerprint hashes the calendar slot and not one byte of any image.
 *
 * An unstamped file is not a finding here. It is a finding at approval.
 */
export async function imagesChangedSinceStamp(
  root: string,
  slot: { slot: number },
  assets: Array<{ local_image_path: string }>,
  records: ImageSourceLike[]
): Promise<string[]> {
  const changed: string[] = [];
  for (const asset of assets) {
    const path = asset.local_image_path;
    const record = records.find((r) => r.slot === slot.slot && r.image_path === path);
    if (typeof record?.image_sha256 !== "string") continue;
    const onDisk = await hashImageFile(root, path);
    if (onDisk && onDisk !== record.image_sha256) {
      changed.push(`slot ${slot.slot} ${path} 在核准之後被換過,現在的檔案不是被核准的那一張`);
    }
  }
  return changed;
}

export interface ImageSourceLike {
  slot: number;
  image_path: string;
  topic?: string;
  prompt_sha256?: string;
  image_sha256?: string;
}
