import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { approvePost } from "./approvePost";
import { getFlag, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { hasApprovedPost, loadApprovalLog, loadDailyContent, loadImageSources } from "./logging";
import { inspectDailyImageProvenance } from "./imageProvenance";
import {
  hashImageFile,
  loadImagePromptManifest,
  manifestEntryFor,
  promptHashFor
} from "./imageStamp";
import { imageAssetsForSlot } from "./mediaAssets";
import { projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";
import type { Platform } from "./types";

// Unattended approval for the daily package. Every gate below is objective, and
// anything unproven stops the run instead of approving: an approval written here
// leads directly to a public post. The owner reviews published output rather
// than each package, so the run reports what it did and why.
//
// data/publishing-policy.json was previously only a rule for a human or agent to
// honour. Nothing unattended may rely on that, so it is enforced here.

const PLATFORMS: Platform[] = ["facebook", "instagram"];

interface PublishingPolicy {
  status?: string;
  start_date?: string;
  end_date?: string;
  platforms?: string[];
  slots?: Array<{ slot: number }>;
}

export interface AutoApproveResult {
  date: string;
  approved: boolean;
  already_approved: boolean;
  approved_slots: number[];
  blockers: string[];
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
  // Reported, never gated: whether the day's images still carry the image
  // model's C2PA manifest decides whether Meta shows its "AI info" label, and
  // a resize can drop it without anyone choosing to. Visibility, not a verdict.
  ai_provenance: { with_manifest: number; without_manifest: number; consistent: boolean };
}

async function loadPolicy(root: string): Promise<PublishingPolicy | undefined> {
  try {
    return JSON.parse(await readFile(join(root, "data", "publishing-policy.json"), "utf8")) as PublishingPolicy;
  } catch {
    return undefined;
  }
}

export async function autoApprove(
  options: { date?: string; root?: string; approvedBy?: string; dryRun?: boolean } = {}
): Promise<AutoApproveResult> {
  const root = projectRoot(options.root);
  const config = getConfig();
  const date = options.date || getZonedDateParts(new Date(), config.timezone).date;

  const checks: AutoApproveResult["checks"] = [];
  const blockers: string[] = [];
  // Detail is written to explain a failure, so attaching it to a passing check
  // would print "outside 2026-07-18..2026-10-08" next to an OK and read as broken.
  const record = (name: string, ok: boolean, failureDetail?: string) => {
    checks.push(ok ? { name, ok } : { name, ok, detail: failureDetail });
    if (!ok) blockers.push(failureDetail ? `${name}: ${failureDetail}` : name);
  };

  const policy = await loadPolicy(root);
  if (!policy) {
    record("publishing_policy", false, "data/publishing-policy.json is missing or unreadable.");
  } else {
    record("policy_active", policy.status === "active", `status=${policy.status ?? "unset"}`);
    const inWindow = Boolean(
      policy.start_date && policy.end_date && date >= policy.start_date && date <= policy.end_date
    );
    record("policy_covers_date", inWindow, `${date} outside ${policy.start_date}..${policy.end_date}`);
    record(
      "policy_covers_platforms",
      PLATFORMS.every((platform) => policy.platforms?.includes(platform)),
      `platforms=${policy.platforms?.join(",") ?? "none"}`
    );
  }

  const content = await loadDailyContent(date, root);
  // A calendar copied into the wrong date's path must not be approved as that
  // date: the file's own date field is the identity, not the filename (luna).
  if (content && (content as { date?: string }).date && (content as { date?: string }).date !== date) {
    record("daily_content_date", false, `calendar says ${(content as { date?: string }).date}, expected ${date}`);
    return {
      date,
      approved: false,
      already_approved: false,
      approved_slots: [],
      blockers,
      checks,
      ai_provenance: { with_manifest: 0, without_manifest: 0, consistent: true }
    };
  }
  if (!content) {
    record("daily_content", false, `No content calendar for ${date}.`);
    return {
      date,
      approved: false,
      already_approved: false,
      approved_slots: [],
      blockers,
      checks,
      ai_provenance: { with_manifest: 0, without_manifest: 0, consistent: true }
    };
  }
  record("daily_content", true);

  const provenance = await inspectDailyImageProvenance(date, root);
  const aiProvenance = {
    with_manifest: provenance.with_manifest,
    without_manifest: provenance.without_manifest,
    consistent: provenance.consistent
  };

  const policySlots = policy?.slots?.map((item) => item.slot) ?? [];
  for (const slot of content.slots) {
    record(
      `policy_covers_slot_${slot.slot}`,
      policySlots.includes(slot.slot),
      `slot ${slot.slot} not listed in policy`
    );
  }

  // Asset readiness is judged per slot. The day-level check made approval
  // all-or-nothing, and one broken slot then cost the whole day: on
  // 2026-08-01 a morning regeneration rewrote slot 1's carousel while slot 2
  // held a reviewed, published-ready Reel — and the Reel would have been
  // blocked by slot 1's missing slides. Policy gates above stay day-level:
  // no policy, nothing publishes. Asset gates below block only their slot.
  const slotBlockers = new Map<number, string[]>();
  const blockSlot = (slot: number, reason: string) => {
    slotBlockers.set(slot, [...(slotBlockers.get(slot) ?? []), reason]);
    // Recorded as a failing check but NOT through record(), which feeds the
    // day-level blockers list — that is exactly the all-or-nothing coupling
    // this rewrite removes.
    checks.push({ name: `slot_${slot}`, ok: false, detail: reason });
  };

  // The makeup-bag topic ran four times in five days (08-03, 08-04, 08-05,
  // 08-07) because the morning flow recycles its own earlier slot-1 packages;
  // the owner recognized the reused caption on sight. A slot-1 topic that
  // shares a three-character run (within the leading object phrase) with any
  // topic from the previous seven days is a rerun and must not publish.
  //
  // Template lead-in phrases must not count as "the object": on 2026-08-09
  // the gate matched 「先看懂」 -- a stylistic opener two unrelated topics
  // shared -- and blocked a legitimate day; slot 1 never published. Grams are
  // taken from the topic with lead-in wording stripped, so only object words
  // remain comparable.
  const TOPIC_LEAD_INS = /先看懂|怎麼判斷|怎麼辦|你可能|其實|今天|當天|門市檢查|最髒的|先看|再看/g;
  const objectHead = (topic: string): string =>
    topic.replace(/[（(].*?[)）]/g, "").replace(TOPIC_LEAD_INS, "").replace(/[：:，,。!？?\s]/g, "").slice(0, 8);
  const slot1 = content.slots.find((slot) => slot.slot === 1);
  if (slot1) {
    const head = objectHead(slot1.topic);
    repeatScan: for (let back = 1; back <= 7; back++) {
      const base = new Date(`${date}T00:00:00Z`);
      base.setUTCDate(base.getUTCDate() - back);
      const prevDate = base.toISOString().slice(0, 10);
      const prev = await loadDailyContent(prevDate, root);
      for (const prevSlot of prev?.slots ?? []) {
        const prevHead = objectHead(prevSlot.topic);
        for (let i = 0; i + 3 <= prevHead.length; i++) {
          const gram = prevHead.slice(i, i + 3);
          if (/^[一-鿿]{3}$/.test(gram) && head.includes(gram)) {
            blockSlot(1, `slot 1 主題與 ${prevDate} 重複(共用「${gram}」),七天內不得重複物件`);
            break repeatScan;
          }
        }
      }
    }
  }

  // The caption comes from the calendar; the images were generated for some
  // other topic. When the two disagree the post is caption-over-wrong-photos,
  // which is worse than not posting.
  //
  // This is checked twice against two different witnesses, because the first
  // witness turned out to be able to change its story. The image-prompts
  // manifest is rebuilt by `generate-image-manifest`, so on 2026-08-14 a manifest
  // rebuild alone flipped this gate from red to green while the files on disk
  // were still pictures of a different pair of shoes. A file cannot be
  // vouched for by a document written after it.
  {
    const manifest = await loadImagePromptManifest(root, date);
    const sourceRecords = await loadImageSources(date, root);
    if (!manifest) {
      // Fail closed: a missing or unreadable manifest means consistency is
      // UNPROVEN, and unproven must not publish (luna, high). The old
      // "absence is not proof of mismatch" stance let a malformed manifest
      // waive the strongest gate.
      for (const slot of content.slots) {
        if (imageAssetsForSlot(slot).length > 0) {
          blockSlot(slot.slot, `slot ${slot.slot} 圖片 manifest 缺失或無法解析,圖文一致性未證明`);
        }
      }
    } else {
      for (const slot of content.slots) {
        for (const asset of imageAssetsForSlot(slot)) {
          const path = asset.local_image_path;
          const say = (why: string) => blockSlot(slot.slot, `slot ${slot.slot} ${path} ${why}`);

          const manifestEntry = manifestEntryFor(manifest, path);
          if (!manifestEntry) {
            say("在圖片 manifest 中沒有對應條目,圖文一致性未證明");
            continue;
          }
          if (manifestEntry.topic !== slot.topic) {
            say(
              `文不配圖:manifest 記為「${String(manifestEntry.topic).slice(0, 16)}」,文案是「${slot.topic.slice(0, 16)}」`
            );
            continue;
          }

          // Matched on slot AND path. The downstream source gate matches on
          // path alone, so a record filed under the wrong slot satisfies it
          // while proving nothing here -- which is why this refuses instead of
          // deferring to it.
          const record = sourceRecords.find(
            (entry) => entry.slot === slot.slot && entry.image_path === path
          );
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

          // The bytes must be the bytes that were stamped. Without this the
          // topic is just a label anyone can move onto any file.
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
      }
    }

  }

  const sources = await loadImageSources(date, root);
  for (const slot of content.slots) {
    for (const asset of imageAssetsForSlot(slot)) {
      const fullPath = join(root, ...asset.local_image_path.split("/"));
      let assetExists = false;
      try {
        assetExists = (await stat(fullPath)).size > 0;
      } catch {
        assetExists = false;
      }
      if (!assetExists) {
        blockSlot(slot.slot, `missing image ${asset.local_image_path}`);
        continue;
      }
      // Any non-empty file used to pass; a text file or corrupt download at
      // the right path could be approved and published (luna, high). All
      // pipeline images are PNG, so the signature is the cheapest real proof.
      if (asset.local_image_path.endsWith(".png")) {
        try {
          const { open } = await import("node:fs/promises");
          const handle = await open(fullPath, "r");
          const header = Buffer.alloc(8);
          await handle.read(header, 0, 8, 0);
          await handle.close();
          if (!header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
            blockSlot(slot.slot, `not a real PNG: ${asset.local_image_path}`);
            continue;
          }
        } catch {
          blockSlot(slot.slot, `unreadable image ${asset.local_image_path}`);
          continue;
        }
      }
      // A publishable image must also be a real generated asset, not a
      // placeholder that happens to sit at the right path.
      if (!sources.some((entry) => entry.image_path === asset.local_image_path && entry.source)) {
        blockSlot(slot.slot, `no source record for ${asset.local_image_path}`);
      }
    }
    if (!slotBlockers.has(slot.slot)) record(`slot_${slot.slot}`, true);
  }

  // Conversion-field soft gate (luna fatal 1層/01): every caption should carry
  // a price cue, the free-pickup line and the LINE ID -- posts without them
  // reach people but give a ready buyer nothing to act on. Soft for one week
  // (warnings in checks, never blocks); hardens 2026-08-18 if the false-alarm
  // rate stays low.
  for (const slot of content.slots) {
    const caption = slot.instagram_caption ?? "";
    const missing: string[] = [];
    if (!/參考價|\$\d|LINE 傳照片|報價/.test(caption)) missing.push("價格線索");
    if (!/收送|到府/.test(caption)) missing.push("收送句");
    if (!caption.includes("0968327653")) missing.push("LINE ID");
    if (missing.length > 0) {
      checks.push({
        name: `conversion_fields_slot_${slot.slot}`,
        ok: true,
        detail: `soft warning: 缺 ${missing.join("/")}`
      });
    }
  }

  const approvals = await loadApprovalLog(date, root);
  const pending = content.slots.filter((slot) =>
    PLATFORMS.some((platform) => !hasApprovedPost(approvals, slot.slot, platform))
  );
  if (pending.length === 0) {
    return {
      date,
      approved: false,
      already_approved: true,
      approved_slots: [],
      blockers: [...blockers, ...[...slotBlockers.values()].flat()],
      checks,
      ai_provenance: aiProvenance
    };
  }

  // Day-level blockers (policy, calendar) refuse everything.
  if (blockers.length > 0) {
    return {
      date,
      approved: false,
      already_approved: false,
      approved_slots: [],
      blockers: [...blockers, ...[...slotBlockers.values()].flat()],
      checks,
      ai_provenance: aiProvenance
    };
  }

  // Approval is a judgment about specific content: the fingerprint sidecar
  // records the sha256 of each approved slot so publishing can refuse a
  // package rewritten after its approval (luna, high — the already_approved
  // short-circuit used to let any post-approval rewrite ride the old grant).
  const { createHash } = await import("node:crypto");
  const fingerprintPath = join(root, "data", "approved-log", `${date}.fingerprints.json`);
  const fingerprints: Record<string, string> = JSON.parse(
    await readFile(fingerprintPath, "utf8").catch(() => "{}")
  );

  const approvedSlots: number[] = [];
  for (const slot of pending) {
    if (slotBlockers.has(slot.slot)) continue;
    // A dry run evaluates every gate but must leave no trace: on 2026-08-07 a
    // gate test invoked with a then-nonexistent --dry-run flag silently wrote
    // real approvals for the next day.
    if (options.dryRun) {
      approvedSlots.push(slot.slot);
      continue;
    }
    await approvePost({
      date,
      slot: slot.slot,
      platforms: PLATFORMS,
      approvedBy: options.approvedBy ?? "auto-approve",
      note: "Unattended approval: publishing policy, content, publishable images and image sources all verified.",
      root
    });
    fingerprints[String(slot.slot)] = createHash("sha256").update(JSON.stringify(slot)).digest("hex");
    approvedSlots.push(slot.slot);
  }
  // A dry run must leave nothing behind. It already skips the approval log, but
  // it was still writing the fingerprint sidecar -- and because a dry run never
  // fills the map, what landed on disk was `{}`. The publish check reads
  // `fingerprints[slot]`, gets undefined, and short-circuits: an empty sidecar
  // does not fail the check, it disables it. 2026-08-12 already had one of
  // these sitting on disk from a dry run the evening before.
  if (!options.dryRun && approvedSlots.length > 0) {
    const { writeFile: writeFp } = await import("node:fs/promises");
    await writeFp(fingerprintPath, JSON.stringify(fingerprints, null, 2), "utf8");
  }

  const remainingBlockers = [...slotBlockers.values()].flat();
  return {
    date,
    approved: approvedSlots.length > 0,
    already_approved: false,
    approved_slots: approvedSlots,
    blockers: remainingBlockers,
    checks,
    ai_provenance: aiProvenance
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = projectRoot(getOption(args, "root"));
  const dryRun = getFlag(args, "dry-run");
  const result = await autoApprove({
    date: getOption(args, "date"),
    root,
    approvedBy: getOption(args, "approved-by"),
    dryRun
  });

  console.log(JSON.stringify(dryRun ? { ...result, dry_run: true } : result, null, 2));
  if (dryRun) return;
  // The scheduled wrapper reads this file instead of scraping stdout: any npm
  // warning containing a brace shifted the substring parse, and a "successful"
  // parse into an object with a null .approved silently skipped the day.
  const { mkdir, writeFile } = await import("node:fs/promises");
  const reportDir = join(root, "output", "operations");
  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, `auto-approve-${result.date}.json`), JSON.stringify(result, null, 2), "utf8");
  // Non-zero lets the scheduled task raise a notification when nothing was approved.
  if (!result.approved && !result.already_approved && !getFlag(args, "no-fail")) process.exitCode = 1;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
