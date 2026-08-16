import { createHash } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { contradictorySubject } from "./contentPlan";

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
  imagePath: string,
  slot?: number
): ManifestEntry | undefined {
  if (!manifest) return undefined;
  // Matched per file, not per slot: a carousel has one entry per slide, and
  // matching by slot alone meant slides 2-4 were judged by slide 1's prompt.
  // But element shape is not assumed -- a null or non-object entry used to
  // throw here, turning malformed data into a crash rather than a refusal --
  // and an ambiguous manifest is not evidence, so duplicates are rejected
  // rather than resolved by taking the first.
  const matches = manifest.filter(
    (entry): entry is ManifestEntry =>
      Boolean(entry) &&
      typeof entry === "object" &&
      (entry as ManifestEntry).target_path === imagePath &&
      (slot === undefined || (entry as ManifestEntry).slot === slot)
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export function promptHashFor(
  manifest: ManifestEntry[] | undefined,
  imagePath: string,
  slot?: number
): string | undefined {
  const prompt = manifestEntryFor(manifest, imagePath, slot)?.prompt;
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

    const entry = manifestEntryFor(manifest, path, slot.slot);
    if (!entry) {
      say("在圖片 manifest 中沒有唯一對應的條目(缺漏、重複、或掛在別的時段),圖文一致性未證明");
      continue;
    }
    if (entry.topic !== slot.topic) {
      say(
        `文不配圖:manifest 記為「${String(entry.topic).slice(0, 16)}」,文案是「${slot.topic.slice(0, 16)}」`
      );
      continue;
    }

    // Everything above compares records to records. They can all agree while
    // describing the wrong object, which is exactly ERROR-BOOK A1 and A7:
    // change the topic, leave image_prompt stale, delete the images and let the
    // placer regenerate from that stale prompt. The manifest topic is fresh,
    // the stamp is fresh, the hashes match -- and the picture is of the old
    // object, because nothing compared the caption to what the prompt asked
    // for.
    const clash = contradictorySubject(slot.topic, String(entry.prompt ?? ""));
    if (clash) {
      say(`提示詞要的是「${clash.found}」,文案講的是「${clash.expected}」`);
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

    const currentPromptHash = promptHashFor(manifest, path, slot.slot);
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
 * The digests approval actually saw, per slot, per image path.
 *
 * Kept apart from the source records on purpose. A source record is written by
 * the marking command and can be written again; comparing a publish against it
 * only ever asks "does this file match the most recent thing anyone said about
 * it", which stays true through approve -> swap -> re-stamp -> publish. This
 * file is written once, by approval, and no other command touches it, so it can
 * answer the question that actually matters: is this the picture that was
 * approved.
 */
export type ApprovedImageDigests = Record<string, Record<string, string>>;

export function imageDigestsPath(root: string, date: string): string {
  return join(root, "data", "approved-log", `${date}.image-digests.json`);
}

/**
 * The one writer for the digest snapshot (luna D6). A plain writeFile can be
 * interrupted mid-write, and a half-written snapshot parses as "unusable",
 * which downgrades the publish check for the whole day. Writing to a temp
 * file and renaming over the target means the file on disk is always either
 * the previous complete snapshot or the new complete snapshot — never a torn
 * one. On any failure the temp file is removed and the target stays whatever
 * it was.
 */
export async function writeApprovedImageDigests(
  root: string,
  date: string,
  digests: ApprovedImageDigests
): Promise<void> {
  const target = imageDigestsPath(root, date);
  const temp = `${target}.tmp-${process.pid}`;
  try {
    await writeFile(temp, JSON.stringify(digests, null, 2), "utf8");
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

export async function loadApprovedImageDigests(
  root: string,
  date: string
): Promise<ApprovedImageDigests | undefined> {
  try {
    const parsed = JSON.parse(await readFile(imageDigestsPath(root, date), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ApprovedImageDigests)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Images that are not the ones approval signed off on.
 *
 * Fail-closed within a slot that has a snapshot: an image approval never
 * recorded is as suspect as one whose bytes moved, because both mean the set of
 * pictures changed after consent. Slots with no snapshot fall through to the
 * weaker byte check, which is what keeps days approved before snapshots existed
 * publishable.
 */
export async function imagesDifferFromApproval(
  root: string,
  slot: { slot: number },
  assets: Array<{ local_image_path: string }>,
  snapshot: ApprovedImageDigests | undefined
): Promise<string[]> {
  const key = String(slot.slot);
  if (!snapshot || !Object.hasOwn(snapshot, key)) return [];
  const approved = snapshot[key];
  // A slot key that exists but holds junk is not "no snapshot". Callers that
  // guard first never reach this; callers that forget must get a finding, not
  // a silent pass -- null under the key used to read as a pre-snapshot day.
  if (!isApprovedSlotDigestMap(approved)) {
    return [`slot ${slot.slot} image-digest entry is not a digest map; refusing to treat it as approval evidence`];
  }

  const problems: string[] = [];
  for (const asset of assets) {
    const path = asset.local_image_path;
    const expected = approved[path];
    if (!expected) {
      problems.push(`slot ${slot.slot} ${path} 不在核准當下的圖片清單裡,核准後被加進來的`);
      continue;
    }
    const onDisk = await hashImageFile(root, path);
    if (!onDisk) {
      problems.push(`slot ${slot.slot} ${path} 讀不到,無法確認是不是被核准的那一張`);
      continue;
    }
    if (onDisk !== expected) {
      problems.push(`slot ${slot.slot} ${path} 不是被核准的那一張,核准後被換過`);
    }
  }
  return problems;
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


/**
 * The digest file, read without collapsing its three states.
 *
 * `loadApprovedImageDigests` returns undefined for both "no file" and "file is
 * damaged", and publishing treated undefined as "pre-snapshot day, use the
 * weaker check" -- which turned deleting or corrupting the sidecar into a
 * downgrade attack. Absent is legacy; damaged is refusal.
 */
export type ApprovedImageDigestFile =
  | { kind: "absent" }
  | { kind: "unusable" }
  | { kind: "ready"; snapshot: ApprovedImageDigests };

export async function inspectApprovedImageDigestFile(
  root: string,
  date: string
): Promise<ApprovedImageDigestFile> {
  let raw: string;
  try {
    raw = await readFile(imageDigestsPath(root, date), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    // Only a missing file is a pre-snapshot day. A file that exists but cannot
    // be read still claims an approval happened; it must not read as legacy.
    return code === "ENOENT" ? { kind: "absent" } : { kind: "unusable" };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { kind: "unusable" };
    return { kind: "ready", snapshot: parsed as ApprovedImageDigests };
  } catch {
    return { kind: "unusable" };
  }
}

/** A slot entry must be a plain map of image path to sha256 string. */
export function isApprovedSlotDigestMap(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === "string");
}

export interface ImageSourceLike {
  slot: number;
  image_path: string;
  topic?: string;
  prompt_sha256?: string;
  image_sha256?: string;
}
