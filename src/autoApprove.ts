import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { approvePost } from "./approvePost";
import { getFlag, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { hasApprovedPost, loadApprovalLog, loadDailyContent, loadImageSources } from "./logging";
import { inspectDailyImageProvenance } from "./imageProvenance";
import {
  hashImageFile,
  imageDigestsPath,
  imageEvidenceFailures,
  loadApprovedImageDigests,
  type ApprovedImageDigests
} from "./imageStamp";
import { TOPIC_LABEL_PREFIX_RE } from "./contentPlan";
import { imageAssetsForSlot } from "./mediaAssets";
import { pauseMessage, readPause } from "./pause";
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

  // Checked before anything else: while the owner's brake is on, this function
  // must not grant consent by any path, including the catch-up chain that
  // re-runs it when a slot is unapproved.
  const paused = await readPause(root);
  if (paused) {
    return {
      date,
      approved: false,
      already_approved: false,
      approved_slots: [],
      blockers: [pauseMessage(paused)],
      checks: [{ name: "not_paused", ok: false, detail: pauseMessage(paused) }],
      ai_provenance: { with_manifest: 0, without_manifest: 0, consistent: true }
    };
  }
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
  // The label prefix comes off first, using the same list the captions use.
  // This gate kept its own shorter copy, which did not include 可收藏 -- and
  // from day 31 the playbook labels every knowledge post 可收藏. Two posts about
  // a white shoe and a duvet then shared the three characters this scan
  // compares, so 2026-08-16 onward would have blocked the morning post every
  // single day, with the catch-up chain re-judging it into the same wall.
  // A file label is not an object.
  const TOPIC_LEAD_INS = /怎麼判斷|怎麼辦|你可能|其實|今天|當天|門市檢查|最髒的|先看|再看/g;
  const objectHead = (topic: string): string =>
    topic
      .replace(TOPIC_LABEL_PREFIX_RE, "")
      .replace(/[（(].*?[)）]/g, "")
      .replace(TOPIC_LEAD_INS, "")
      .replace(/[：:，,。!？?\s]/g, "")
      .slice(0, 8);
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
    const sourceRecords = await loadImageSources(date, root);
    for (const slot of content.slots) {
      for (const failure of await imageEvidenceFailures(
        root,
        date,
        slot,
        imageAssetsForSlot(slot),
        sourceRecords
      )) {
        blockSlot(slot.slot, failure);
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
  // A slot also counts as pending when it is approved but its image-digest
  // snapshot is missing. Approval writes the log and the snapshot as two files,
  // so a crash between them (or a deleted sidecar) used to leave a slot that
  // publishing refuses and re-approval never revisits -- approved on paper,
  // unpublishable in practice, forever. Re-judging it runs every gate again and
  // rebuilds the snapshot from bytes that just passed those gates.
  const digestsOnDisk = (await loadApprovedImageDigests(root, date)) ?? {};
  const pending = content.slots.filter(
    (slot) =>
      PLATFORMS.some((platform) => !hasApprovedPost(approvals, slot.slot, platform)) ||
      (imageAssetsForSlot(slot).length > 0 && !digestsOnDisk[String(slot.slot)])
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
  const approvedDigests: ApprovedImageDigests =
    (await loadApprovedImageDigests(root, date)) ?? {};

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
    // What approval actually saw. The fingerprint above hashes the calendar
    // slot, which contains no image bytes, so without this the pictures were
    // the one part of a post nothing recorded at the moment of consent.
    const digests: Record<string, string> = {};
    for (const asset of imageAssetsForSlot(slot)) {
      const digest = await hashImageFile(root, asset.local_image_path);
      if (digest) digests[asset.local_image_path] = digest;
    }
    approvedDigests[String(slot.slot)] = digests;
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
    await writeFp(
      imageDigestsPath(root, date),
      JSON.stringify(approvedDigests, null, 2),
      "utf8"
    );
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
