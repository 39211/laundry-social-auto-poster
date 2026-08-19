import { createHash } from "node:crypto";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "../src/config";
import { buildDailyContent, stampDailyContentWrite } from "../src/contentPlan";
import { generateDailyContent } from "../src/generateDailyContent";
import {
  loadApprovalLog,
  loadDailyContent,
  loadPostLog,
  loadVideoRepairQueue,
  markVideoRepairReady,
  reclassifyVideoRepairQueue,
  writeApprovalLog,
  writeDailyContent,
  writePostLog,
  writeVideoSources
} from "../src/logging";
import { imageAssetsForSlot } from "../src/mediaAssets";
import { videoRepairQueuePath } from "../src/paths";
import { classifyVideoFailure, isRetiredVideoAbsenceReason, postCurrentSlot } from "../src/postCurrentSlot";
import { approvePost } from "../src/approvePost";
import type { PostLogEntry, PostResult } from "../src/types";
import { probeVideo } from "../src/videoMedia";
import { hashVideoPrompt } from "../src/videoRunFreshness";

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function approveSlot(root: string, date: string, slot = 1): Promise<void> {
  await approvePost({
    date,
    slot,
    platforms: ["facebook", "instagram"],
    approvedBy: "Test",
    note: "Test approval",
    root,
    // These fixtures exercise publishing, not image provenance. Approval
    // refuses unproven images, so --force writes the digest snapshot; the
    // forced flag is then stripped so the grant is a clean publishable one.
    force: true
  });
  const entries = await loadApprovalLog(date, root);
  await writeApprovalLog(
    date,
    entries.map((entry) =>
      entry.slot === slot && entry.forced === true
        ? {
            date: entry.date,
            slot: entry.slot,
            platform: entry.platform,
            status: entry.status,
            approved_by: entry.approved_by,
            note: entry.note,
            created_at: entry.created_at
          }
        : entry
    ),
    root
  );
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

async function publicationCaptions(root: string, date: string, slotNumber = 1): Promise<{ facebook: string; instagram: string }> {
  const content = await loadDailyContent(date, root, { today: date });
  const slot = content?.slots.find((candidate) => candidate.slot === slotNumber);
  if (!slot) throw new Error(`test calendar is missing slot ${slotNumber}`);
  return { facebook: slot.facebook_caption, instagram: slot.instagram_caption };
}

function graphObjectId(endpoint: string): string | undefined {
  try {
    const pieces = new URL(endpoint).pathname.split("/").filter(Boolean);
    return pieces.at(-1);
  } catch {
    return undefined;
  }
}

function verifiedFacebookImageReadback(id: string, caption: string): Response {
  return jsonResponse({
    id,
    permalink_url: `https://www.facebook.com/123456789012345/posts/${id}`,
    message: caption,
    attachments: { data: [{ media_type: "photo", media: { image: { src: "https://cdn.example.test/photo.png" } } }] }
  });
}

function verifiedInstagramImageReadback(id: string, caption: string): Response {
  return jsonResponse({
    id,
    media_type: "IMAGE",
    media_product_type: "FEED",
    permalink: `https://www.instagram.com/p/${id}/`,
    caption
  });
}

function liveImageReadback(
  endpoint: string,
  init: RequestInit | undefined,
  captions: { facebook: string; instagram: string }
): Response | undefined {
  if (init?.method !== "GET") return undefined;
  const id = graphObjectId(endpoint);
  if (!id) return undefined;
  if (id.includes("container")) return jsonResponse({ id, status_code: "FINISHED" });
  if (id.startsWith("ig-")) return verifiedInstagramImageReadback(id, captions.instagram);
  if (id.startsWith("fb-")) return verifiedFacebookImageReadback(id, captions.facebook);
  return undefined;
}

async function seedCanonicalLiveImageApproval(root: string, date: string): Promise<void> {
  await generateDailyContent({ date, root, force: true });
  const content = await loadDailyContent(date, root, { today: date });
  if (!content || content.tampered) throw new Error(`Unable to seed canonical calendar for ${date}`);
  for (const slot of content.slots) {
    for (const image of imageAssetsForSlot(slot)) {
      const imagePath = join(root, ...image.local_image_path.split("/"));
      await mkdir(dirname(imagePath), { recursive: true });
      await writeFile(imagePath, `fake image for slot ${slot.slot}, slide ${image.slide}`);
    }
  }
  for (const slot of content.slots) await approveSlot(root, date, slot.slot);
  await writeCanonicalApprovalFingerprints(root, date, content.slots);
}

async function writeCanonicalApprovalFingerprints(
  root: string,
  date: string,
  slots: ReadonlyArray<{ slot: number }>
): Promise<void> {
  await mkdir(join(root, "data", "approved-log"), { recursive: true });
  await writeFile(
    join(root, "data", "approved-log", `${date}.fingerprints.json`),
    `${JSON.stringify(
      Object.fromEntries(
        slots.map((slot) => [
          String(slot.slot),
          createHash("sha256").update(JSON.stringify(slot)).digest("hex")
        ])
      ),
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function seedCanonicalLiveReelApproval(root: string, date: string): Promise<void> {
  await seedCanonicalLiveImageApproval(root, date);
  const content = await loadDailyContent(date, root, { today: date });
  if (!content || content.tampered) throw new Error("canonical image fixture is unavailable");
  const videoPath = `docs/assets/${date}/slot-01.mp4`;
  const reelSlots = content.slots.map((slot) =>
    slot.slot === 1
      ? {
          ...slot,
          media_type: "reel" as const,
          local_video_path: videoPath,
          public_video_url: `https://tester.github.io/laundry-social-auto-poster/assets/${date}/slot-01.mp4`,
          video_prompt: "canonical runtime refusal fixture"
        }
      : slot
  );
  const reel = reelSlots.find((slot) => slot.slot === 1);
  if (!reel?.video_prompt || !reel.local_video_path) throw new Error("reel fixture setup failed");
  const bytes = Buffer.from("approved reel bytes", "utf8");
  await mkdir(dirname(join(root, ...videoPath.split("/"))), { recursive: true });
  await writeFile(join(root, ...videoPath.split("/")), bytes);
  await writeDailyContent(
    { date: content.date, timezone: content.timezone, generated_at: content.generated_at, slots: reelSlots },
    root
  );
  await writeCanonicalApprovalFingerprints(root, date, reelSlots);
  await writeVideoSources(
    date,
    [
      {
        date,
        slot: 1,
        source: "grok-imagine-video",
        model: "fixture-grok-imagine-video",
        video_path: videoPath,
        request_id: "runtime-refusal-fixture",
        duration_seconds: 10,
        width: 1080,
        height: 1920,
        frame_rate: 30,
        video_codec: "h264",
        marked_at: "2026-05-15T01:00:00.000Z"
      }
    ],
    root
  );
  await mkdir(join(root, "data", "video-runs", date, "slot-01"), { recursive: true });
  await writeFile(
    join(root, "data", "video-runs", date, "slot-01", "run.json"),
    `${JSON.stringify({
      status: "complete",
      prompt_hash: hashVideoPrompt(reel.video_prompt),
      target_path: videoPath
    })}\n`,
    "utf8"
  );
  await mkdir(join(root, "data", "video-reviews"), { recursive: true });
  await writeFile(
    join(root, "data", "video-reviews", `${date}.json`),
    `${JSON.stringify([
      {
        date,
        slot: 1,
        video_path: videoPath,
        video_sha256: createHash("sha256").update(bytes).digest("hex"),
        prompt_hash: hashVideoPrompt(reel.video_prompt),
        review_round: 1,
        full_decode: "pass",
        all_frame_physics_review: "pass",
        grok_review: "pass",
        sol_review: "pass",
        separate_zh_tw_tts_review: "pass",
        generated_clip_audio_used: false,
        status: "approved",
        reviewed_at: "2026-05-15T01:00:00.000Z",
        reviewed_by: "codex-visual-qa"
      }
    ])}\n`,
    "utf8"
  );
}

function setLiveMetaEnv(): void {
  vi.stubEnv("DRY_RUN", "false");
  vi.stubEnv("META_ACCESS_TOKEN", "EAAabcdefghijklmnopqrstuvwxyz1234567890");
  vi.stubEnv("FB_PAGE_ID", "123456789012345");
  vi.stubEnv("IG_USER_ID", "12345678901234567");
}

async function writeIncompleteMetaClaim(
  root: string,
  date: string,
  platform: "facebook" | "instagram"
): Promise<string> {
  const claimDir = join(root, "data", "meta-publish-claims");
  const hex = (letter: string) => letter.repeat(64);
  const path = join(claimDir, `${date}-slot1-${platform}.json`);
  await mkdir(claimDir, { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify({
      schema_version: 1,
      claim_id: `${platform}-incomplete-claim`,
      date,
      slot: 1,
      platform,
      created_at: "2026-05-15T03:30:00.000Z",
      source: {
        slot_sha256: hex("a"),
        source_binding_sha256: hex("b"),
        media_type: "image",
        caption_sha256: hex("c"),
        image_sha256: [hex("d")],
        image_url: `https://tester.github.io/laundry-social-auto-poster/assets/${date}/slot-01.png`
      }
    }, null, 2)}\n`,
    "utf8"
  );
  return path;
}

describe("postCurrentSlot dry-run integration", () => {
  beforeEach(() => {
    vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://tester.github.io/laundry-social-auto-poster");
    vi.stubEnv("DRY_RUN", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("writes dry-run logs and remains idempotent", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-social-"));
    await generateDailyContent({ date: "2026-05-15", root, force: true });
    await approveSlot(root, "2026-05-15");
    await mkdir(join(root, "docs", "assets", "2026-05-15"), { recursive: true });
    await writeFile(join(root, "docs", "assets", "2026-05-15", "slot-01.png"), "fake image");

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const first = await postCurrentSlot({
      root,
      now: "2026-05-15T11:30:00+08:00",
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl
    });
    const second = await postCurrentSlot({
      root,
      now: "2026-05-15T11:30:00+08:00",
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl
    });

    expect(first.map((entry) => entry.status)).toEqual(["success", "success"]);
    expect(second.map((entry) => entry.status)).toEqual(["skipped", "skipped"]);
    expect(fetchImpl).not.toHaveBeenCalled();

    const log = await loadPostLog("2026-05-15", root);
    expect(log).toHaveLength(2);
  });

  it("refuses to publish a tampered calendar without throwing", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-tampered-post-"));
    const date = "2026-05-15";
    await generateDailyContent({ date, root, force: true });
    await approveSlot(root, date);
    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    await writeFile(join(root, "docs", "assets", date, "slot-01.png"), "fake image");

    const calendarPath = join(root, "data", "content-calendar", `${date}.json`);
    const raw = JSON.parse(await readFile(calendarPath, "utf8")) as { generated_at: string };
    raw.generated_at = "2099-01-01T00:00:00.000Z";
    await writeFile(calendarPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const results = await postCurrentSlot({
      root,
      now: `${date}T11:30:00+08:00`,
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl: vi.fn() as unknown as typeof fetch
    });
    const warned = warn.mock.calls.some((call) => String(call[0]).includes("CALENDAR_TAMPERED"));
    warn.mockRestore();

    expect(results).toEqual([]);
    expect(await loadPostLog(date, root)).toHaveLength(0);
    expect(warned).toBe(true);
  });

  it("refuses a tampered live calendar without launching PowerShell or Graph", async () => {
    setLiveMetaEnv();
    // The historical implementation only launched PowerShell outside Vitest;
    // clear that marker so this regression would catch a future raw spawn.
    vi.stubEnv("VITEST", "");
    const spawnSpy = vi.fn();
    vi.resetModules();
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return { ...actual, spawn: spawnSpy };
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const { postCurrentSlot: isolatedPostCurrentSlot } = await import("../src/postCurrentSlot");
      const root = await mkdtemp(join(tmpdir(), "laundry-tampered-live-no-spawn-"));
      const date = "2026-05-15";
      await generateDailyContent({ date, root, force: true });
      const calendarPath = join(root, "data", "content-calendar", `${date}.json`);
      const raw = JSON.parse(await readFile(calendarPath, "utf8")) as { generated_at: string };
      raw.generated_at = "2099-01-01T00:00:00.000Z";
      await writeFile(calendarPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

      const fetchImpl = vi.fn() as unknown as typeof fetch;
      await expect(
        isolatedPostCurrentSlot({
          root,
          date,
          now: `${date}T11:30:00+08:00`,
          dryRun: false,
          verifyPublicImageUrl: true,
          fetchImpl
        })
      ).resolves.toEqual([]);

      expect(spawnSpy).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });

  it("publishes the four-image carousel and marks VIDEO_DEFERRED when a planned mixed video is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-video-fallback-"));
    const date = "2026-07-29";
    await generateDailyContent({ date, root, force: true });
    await approveSlot(root, date);
    const content = await loadDailyContent(date, root);
    const slot = content?.slots.find((item) => item.slot === 1);
    expect(slot?.media_type).toBe("mixed-carousel");
    expect(slot?.carousel_items).toHaveLength(4);

    for (const item of slot?.carousel_items ?? []) {
      const filePath = join(root, ...item.local_image_path.split("/"));
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, `fake image ${item.slide}`);
    }

    const results = await postCurrentSlot({
      root,
      date,
      slot: 1,
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    expect(results).toHaveLength(2);
    expect(results.every((entry) => entry.status === "success")).toBe(true);
    expect(results.every((entry) => entry.published_media_type === "carousel")).toBe(true);
    expect(results.every((entry) => entry.video_status === "VIDEO_DEFERRED")).toBe(true);

    // A video that has not cleared its review gate is a pending gate, not a fault.
    expect(results.every((entry) => entry.video_defer_kind === "expected")).toBe(true);

    const repairs = await loadVideoRepairQueue(root);
    expect(repairs).toEqual([
      expect.objectContaining({
        source_date: date,
        source_slot: 1,
        status: "VIDEO_DEFERRED",
        original_media_type: "mixed-carousel",
        fallback_media_type: "carousel",
        defer_kind: "expected",
        dry_run: true,
        next_attempt: "next-production-cycle"
      })
    ]);

    await markVideoRepairReady(date, 1, "2026-07-30", 2, root);
    await expect(loadVideoRepairQueue(root)).resolves.toEqual([
      expect.objectContaining({
        source_date: date,
        source_slot: 1,
        status: "VIDEO_DEFERRED",
        replacement_candidate_date: "2026-07-30",
        replacement_candidate_slot: 2
      })
    ]);

  });

  it("reports a deferred video from a preflight without recording it in the repair queue", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-video-preflight-"));
    const date = "2026-07-29";
    await generateDailyContent({ date, root, force: true });
    await approveSlot(root, date);
    const content = await loadDailyContent(date, root);
    const slot = content?.slots.find((item) => item.slot === 1);

    for (const item of slot?.carousel_items ?? []) {
      const filePath = join(root, ...item.local_image_path.split("/"));
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, `fake image ${item.slide}`);
    }

    const results = await postCurrentSlot({
      root,
      date,
      slot: 1,
      dryRun: true,
      preflightOnly: true,
      verifyPublicImageUrl: false,
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    expect(results.every((entry) => entry.video_status === "VIDEO_DEFERRED")).toBe(true);
    expect(results.every((entry) => entry.video_defer_kind === "expected")).toBe(true);
    await expect(loadVideoRepairQueue(root)).resolves.toEqual([]);
  });

  it("separates a pending video gate from a fault so a broken check cannot look like waiting", () => {
    expect(classifyVideoFailure(new Error("Dual video review is missing for slot 1."))).toBe("expected");
    expect(classifyVideoFailure(Object.assign(new Error("no such file"), { code: "ENOENT" }))).toBe("expected");

    expect(classifyVideoFailure(new TypeError("probeVideo is not a function"))).toBe("unexpected");
    expect(classifyVideoFailure(new RangeError("Maximum call stack size exceeded"))).toBe("unexpected");
    expect(classifyVideoFailure(Object.assign(new Error("permission denied"), { code: "EACCES" }))).toBe("unexpected");
    expect(classifyVideoFailure("boom")).toBe("unexpected");
  });

  // The companion-video line was retired on 2026-08-17 (13:20 absorption
  // ruling), so an absence-of-video reason is the slot's normal state and must
  // classify as expected no matter which wrapper carried it — while a
  // generation that really ran and failed keeps escalating as a fault.
  it("classifies a retired companion-video absence as expected regardless of the error wrapper", () => {
    expect(classifyVideoFailure(new Error("No accepted slot 1 replacement exists."))).toBe("expected");
    expect(classifyVideoFailure(new TypeError("No accepted slot 2 companion video exists."))).toBe("expected");
    expect(
      classifyVideoFailure(
        Object.assign(new Error("No current slot 1 video was submitted or generated."), { code: "EACCES" })
      )
    ).toBe("expected");
    expect(classifyVideoFailure(new RangeError("No current slot 2 repair video was submitted or generated."))).toBe(
      "expected"
    );
    expect(classifyVideoFailure("No current slot 1 video was submitted or generated.")).toBe("expected");

    expect(
      classifyVideoFailure(
        new TypeError("Generation sixiangjia_20260817_s01_canvas_pair_v01 was submitted exactly once and failed.")
      )
    ).toBe("unexpected");
  });

  it("matches only retired absence reasons, never real generation failures", () => {
    expect(isRetiredVideoAbsenceReason("No accepted slot 1 replacement exists. Repair generation x failed QC.")).toBe(
      true
    );
    expect(isRetiredVideoAbsenceReason("No accepted slot 2 companion video exists.")).toBe(true);
    expect(isRetiredVideoAbsenceReason("No current slot 1 video was submitted or generated.")).toBe(true);
    expect(isRetiredVideoAbsenceReason("No current slot 2 repair video was submitted or generated.")).toBe(true);

    expect(
      isRetiredVideoAbsenceReason(
        "Generation sixiangjia_20260815_s02_makeup_pouch_seam_hold_v02 was submitted exactly once through Hermes xAI OAuth."
      )
    ).toBe(false);
    expect(
      isRetiredVideoAbsenceReason("A formal slot 3 video review now exists and its prompt hash matches the calendar.")
    ).toBe(false);
    expect(isRetiredVideoAbsenceReason("Video file is missing for slot 1: docs/assets/2026-08-17/slot-01.mp4.")).toBe(
      false
    );
    expect(isRetiredVideoAbsenceReason("Dual video review is missing for slot 1.")).toBe(false);
  });

  it("does not enqueue any repair item when an image-only slot publishes without video", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-image-only-"));
    await generateDailyContent({ date: "2026-05-15", root, force: true });
    await approveSlot(root, "2026-05-15");
    await mkdir(join(root, "docs", "assets", "2026-05-15"), { recursive: true });
    await writeFile(join(root, "docs", "assets", "2026-05-15", "slot-01.png"), "fake image");

    const results = await postCurrentSlot({
      root,
      now: "2026-05-15T11:30:00+08:00",
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    expect(results.every((entry) => entry.status === "success")).toBe(true);
    expect(results.every((entry) => entry.video_status === "not_planned")).toBe(true);
    await expect(loadVideoRepairQueue(root)).resolves.toEqual([]);
  });

  it("reclassifies only retired absence defers and stamps reclassified_at", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-reclassify-"));
    const queuePath = videoRepairQueuePath(root);
    await mkdir(dirname(queuePath), { recursive: true });
    const seed = [
      {
        source_date: "2026-08-14",
        source_slot: 1,
        status: "VIDEO_DEFERRED",
        original_media_type: "mixed-carousel",
        fallback_media_type: "carousel",
        defer_kind: "unexpected",
        failure_reason: "No accepted slot 1 replacement exists. The repair cycle changed only card-and-rail geometry.",
        detected_at: "2026-08-14T09:50:33.889Z",
        next_attempt: "next-production-cycle",
        last_repair_status: "first_frame_fail"
      },
      {
        source_date: "2026-08-15",
        source_slot: 2,
        status: "VIDEO_DEFERRED",
        original_media_type: "mixed-carousel",
        fallback_media_type: "carousel",
        defer_kind: "unexpected",
        failure_reason:
          "Generation sixiangjia_20260815_s02_makeup_pouch_seam_hold_v02 was submitted exactly once and failed native QC.",
        detected_at: "2026-08-15T06:58:39.670Z",
        next_attempt: "next-production-cycle"
      },
      {
        source_date: "2026-08-15",
        source_slot: 3,
        status: "VIDEO_DEFERRED",
        original_media_type: "reel",
        fallback_media_type: "image",
        defer_kind: "unexpected",
        failure_reason: "A formal slot 3 video review now exists but the retained MP4 is 720x1280.",
        detected_at: "2026-08-15T05:50:13.364Z",
        next_attempt: "next-production-cycle"
      },
      {
        source_date: "2026-08-17",
        source_slot: 1,
        status: "VIDEO_DEFERRED",
        original_media_type: "mixed-carousel",
        fallback_media_type: "carousel",
        defer_kind: "expected",
        failure_reason: "Video file is missing for slot 1: docs/assets/2026-08-17/slot-01.mp4.",
        detected_at: "2026-08-17T05:56:59.486Z",
        next_attempt: "next-production-cycle"
      }
    ];
    await writeFile(queuePath, JSON.stringify(seed, null, 2));

    const changed = await reclassifyVideoRepairQueue(
      (entry) => isRetiredVideoAbsenceReason(entry.failure_reason),
      "2026-08-17T12:00:00.000Z",
      root
    );

    expect(changed.map((entry) => [entry.source_date, entry.source_slot])).toEqual([["2026-08-14", 1]]);

    const after = await loadVideoRepairQueue(root);
    const flipped = after.find((entry) => entry.source_date === "2026-08-14");
    // last_repair_status is a field the declared type does not know about; it
    // must survive the rewrite untouched.
    expect(flipped).toMatchObject({
      defer_kind: "expected",
      reclassified_at: "2026-08-17T12:00:00.000Z",
      failure_reason: seed[0]!.failure_reason,
      detected_at: seed[0]!.detected_at,
      last_repair_status: "first_frame_fail"
    });

    const generation = after.find((entry) => entry.source_date === "2026-08-15" && entry.source_slot === 2);
    expect(generation?.defer_kind).toBe("unexpected");
    expect(generation).not.toHaveProperty("reclassified_at");

    const reel = after.find((entry) => entry.source_slot === 3);
    expect(reel?.defer_kind).toBe("unexpected");
    expect(reel).not.toHaveProperty("reclassified_at");

    const alreadyExpected = after.find((entry) => entry.source_date === "2026-08-17");
    expect(alreadyExpected?.defer_kind).toBe("expected");
    expect(alreadyExpected).not.toHaveProperty("reclassified_at");
  });

  it("prefers docs/content-calendar without requiring data/content-calendar", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-social-docs-"));
    const date = "2026-05-15";
    const content = buildDailyContent(
      date,
      getConfig({
        ...process.env,
        DRY_RUN: "true",
        PUBLIC_IMAGE_BASE_URL: "https://tester.github.io/laundry-social-auto-poster"
      })
    );

    await mkdir(join(root, "docs", "content-calendar"), { recursive: true });
    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    await writeFile(
      join(root, "docs", "content-calendar", `${date}.json`),
      `${JSON.stringify(stampDailyContentWrite(content, { root }), null, 2)}\n`
    );
    await approveSlot(root, date);
    await writeFile(join(root, "docs", "assets", date, "slot-01.png"), "fake image");

    expect(await exists(join(root, "data", "content-calendar", `${date}.json`))).toBe(false);

    const results = await postCurrentSlot({
      root,
      now: "2026-05-15T11:30:00+08:00",
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    expect(results.map((entry) => entry.status)).toEqual(["success", "success"]);
    expect(await exists(join(root, "data", "content-calendar", `${date}.json`))).toBe(false);
  });

  it("uses the private data calendar when the public calendar only contains approved public slots", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-social-private-calendar-"));
    const date = "2026-05-15";
    const content = buildDailyContent(
      date,
      getConfig({
        ...process.env,
        DRY_RUN: "true",
        PUBLIC_IMAGE_BASE_URL: "https://tester.github.io/laundry-social-auto-poster"
      })
    );

    await mkdir(join(root, "data", "content-calendar"), { recursive: true });
    await mkdir(join(root, "docs", "content-calendar"), { recursive: true });
    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    await writeFile(
      join(root, "data", "content-calendar", `${date}.json`),
      `${JSON.stringify(stampDailyContentWrite(content, { root }), null, 2)}\n`
    );
    await writeFile(
      join(root, "docs", "content-calendar", `${date}.json`),
      `${JSON.stringify(stampDailyContentWrite({ ...content, slots: [content.slots[0]!] }, { root }), null, 2)}\n`
    );
    await approveSlot(root, date, 2);
    await writeFile(join(root, "docs", "assets", date, "slot-02.png"), "fake image");

    const results = await postCurrentSlot({
      root,
      now: "2026-05-15T20:30:00+08:00",
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    expect(results.map((entry) => entry.status)).toEqual(["success", "success"]);
  });

  it("builds the public image URL at publish time when the calendar URL is empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-social-empty-url-"));
    const date = "2026-05-15";
    const content = buildDailyContent(
      date,
      getConfig({
        ...process.env,
        DRY_RUN: "true",
        PUBLIC_IMAGE_BASE_URL: ""
      })
    );

    await mkdir(join(root, "docs", "content-calendar"), { recursive: true });
    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    await writeFile(
      join(root, "docs", "content-calendar", `${date}.json`),
      `${JSON.stringify(stampDailyContentWrite(content, { root }), null, 2)}\n`
    );
    await approveSlot(root, date);
    await writeFile(join(root, "docs", "assets", date, "slot-01.png"), "fake image");

    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
    const results = await postCurrentSlot({
      root,
      now: "2026-05-15T11:30:00+08:00",
      dryRun: true,
      verifyPublicImageUrl: true,
      fetchImpl
    });

    expect(results.map((entry) => entry.status)).toEqual(["success", "success"]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://tester.github.io/laundry-social-auto-poster/assets/2026-05-15/slot-01.png",
      { method: "HEAD" }
    );
  });

  it("fails before posting when PUBLIC_IMAGE_BASE_URL is missing", async () => {
    vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "");

    const root = await mkdtemp(join(tmpdir(), "laundry-social-missing-base-"));
    await mkdir(join(root, "docs", "assets", "2026-05-15"), { recursive: true });
    await writeFile(join(root, "docs", "assets", "2026-05-15", "slot-01.png"), "fake image");

    await expect(
      postCurrentSlot({
        root,
        now: "2026-05-15T11:30:00+08:00",
        dryRun: true,
        verifyPublicImageUrl: false,
        fetchImpl: vi.fn() as unknown as typeof fetch
      })
    ).rejects.toThrow("PUBLIC_IMAGE_BASE_URL is required");

    expect(await exists(join(root, "data", "posted-log", "2026-05-15.json"))).toBe(false);
  });

  it("fails before writing a post log when live Meta env vars are missing", async () => {
    vi.stubEnv("META_ACCESS_TOKEN", "");
    vi.stubEnv("FB_PAGE_ID", "");
    vi.stubEnv("IG_USER_ID", "");

    const root = await mkdtemp(join(tmpdir(), "laundry-social-missing-meta-"));
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      postCurrentSlot({
        root,
        now: "2026-05-15T11:30:00+08:00",
        dryRun: false,
        verifyPublicImageUrl: false,
        fetchImpl
      })
    ).rejects.toThrow("Live posting is missing env vars: META_ACCESS_TOKEN, FB_PAGE_ID, IG_USER_ID");

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await exists(join(root, "data", "posted-log", "2026-05-15.json"))).toBe(false);
  });

  it("treats masked Meta env placeholders as missing in live mode", async () => {
    vi.stubEnv("META_ACCESS_TOKEN", "[REDACTED]");
    vi.stubEnv("FB_PAGE_ID", "present");
    vi.stubEnv("IG_USER_ID", "your_ig_user_id");

    const root = await mkdtemp(join(tmpdir(), "laundry-social-placeholder-meta-"));

    await expect(
      postCurrentSlot({
        root,
        now: "2026-05-15T11:30:00+08:00",
        dryRun: false,
        verifyPublicImageUrl: false,
        fetchImpl: vi.fn() as unknown as typeof fetch
      })
    ).rejects.toThrow("Live posting is missing env vars: META_ACCESS_TOKEN, FB_PAGE_ID, IG_USER_ID");

    expect(await exists(join(root, "data", "posted-log", "2026-05-15.json"))).toBe(false);
  });

  it("runs live preflight without calling Meta APIs or writing posted logs", async () => {
    vi.stubEnv("DRY_RUN", "false");
    vi.stubEnv("META_ACCESS_TOKEN", "EAAabcdefghijklmnopqrstuvwxyz1234567890");
    vi.stubEnv("FB_PAGE_ID", "123456789012345");
    vi.stubEnv("IG_USER_ID", "12345678901234567");

    const root = await mkdtemp(join(tmpdir(), "laundry-social-live-preflight-"));
    await generateDailyContent({ date: "2026-05-15", root, force: true });
    await approveSlot(root, "2026-05-15");
    await mkdir(join(root, "docs", "assets", "2026-05-15"), { recursive: true });
    await writeFile(join(root, "docs", "assets", "2026-05-15", "slot-01.png"), "fake image");

    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
    const results = await postCurrentSlot({
      root,
      now: "2026-05-15T11:30:00+08:00",
      dryRun: false,
      verifyPublicImageUrl: true,
      preflightOnly: true,
      fetchImpl
    });

    expect(results.map((entry) => entry.status)).toEqual(["pending", "pending"]);
    expect(results.every((entry) => entry.dry_run === false && entry.attempts === 0)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://tester.github.io/laundry-social-auto-poster/assets/2026-05-15/slot-01.png",
      { method: "HEAD" }
    );
    expect(await loadPostLog("2026-05-15", root)).toEqual([]);
    expect(await exists(join(root, "data", "posted-log", "2026-05-15.json"))).toBe(false);
  });

  it("does not write success when the public image URL is unreadable", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-social-unreadable-url-"));
    await generateDailyContent({ date: "2026-05-15", root, force: true });
    await approveSlot(root, "2026-05-15");
    await mkdir(join(root, "docs", "assets", "2026-05-15"), { recursive: true });
    await writeFile(join(root, "docs", "assets", "2026-05-15", "slot-01.png"), "fake image");

    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    await expect(
      postCurrentSlot({
        root,
        now: "2026-05-15T11:30:00+08:00",
        dryRun: true,
        verifyPublicImageUrl: true,
        fetchImpl
      })
    ).rejects.toThrow("Public image URL is not reachable");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await exists(join(root, "data", "posted-log", "2026-05-15.json"))).toBe(false);
  });

  it("keeps dry-run logs as success without calling Meta APIs", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-social-log-format-"));
    await generateDailyContent({ date: "2026-05-15", root, force: true });
    await approveSlot(root, "2026-05-15");
    await mkdir(join(root, "docs", "assets", "2026-05-15"), { recursive: true });
    await writeFile(join(root, "docs", "assets", "2026-05-15", "slot-01.png"), "fake image");

    await postCurrentSlot({
      root,
      now: "2026-05-15T11:30:00+08:00",
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    const raw = await readFile(join(root, "data", "posted-log", "2026-05-15.json"), "utf8");
    expect(raw).toContain('"status": "success"');
    expect(raw).toContain('"dry_run": true');
  });

  it("treats missed live records as terminal and skips later publish attempts", async () => {
    vi.stubEnv("DRY_RUN", "false");
    vi.stubEnv("META_ACCESS_TOKEN", "EAAabcdefghijklmnopqrstuvwxyz1234567890");
    vi.stubEnv("FB_PAGE_ID", "123456789012345");
    vi.stubEnv("IG_USER_ID", "12345678901234567");
    // The suite runs at arbitrary wall-clock times; without this the
    // off-schedule publish guard (rightly) refuses a simulated live post.
    vi.stubEnv("ALLOW_OFF_SCHEDULE_PUBLISH", "true");

    const root = await mkdtemp(join(tmpdir(), "laundry-social-missed-"));
    const date = "2026-05-15";
    await seedCanonicalLiveImageApproval(root, date);
    await writePostLog(
      date,
      [
        {
          date,
          slot: 1,
          platform: "facebook",
          status: "missed",
          dry_run: false,
          attempts: 0,
          error: "Past scheduled window; do not back-post.",
          created_at: "2026-05-15T12:30:00.000Z"
        },
        {
          date,
          slot: 1,
          platform: "instagram",
          status: "missed",
          dry_run: false,
          attempts: 0,
          error: "Past scheduled window; do not back-post.",
          created_at: "2026-05-15T12:30:00.000Z"
        }
      ],
      root
    );

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const results = await postCurrentSlot({
      root,
      now: "2026-05-15T11:30:00+08:00",
      dryRun: false,
      verifyPublicImageUrl: false,
      fetchImpl
    });

    expect(results.map((entry) => entry.status)).toEqual(["skipped", "skipped"]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await loadPostLog(date, root)).toHaveLength(2);
  });

  it("fails closed before Meta when a posted-log row has a valid JSON shape but no platform", async () => {
    vi.stubEnv("DRY_RUN", "false");
    vi.stubEnv("META_ACCESS_TOKEN", "EAAabcdefghijklmnopqrstuvwxyz1234567890");
    vi.stubEnv("FB_PAGE_ID", "123456789012345");
    vi.stubEnv("IG_USER_ID", "12345678901234567");

    const root = await mkdtemp(join(tmpdir(), "laundry-social-malformed-post-log-"));
    const date = "2026-05-15";
    await generateDailyContent({ date, root, force: true });
    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    await writeFile(join(root, "docs", "assets", date, "slot-01.png"), "fake image");
    await approveSlot(root, date);
    await mkdir(join(root, "data", "posted-log"), { recursive: true });
    await writeFile(
      join(root, "data", "posted-log", `${date}.json`),
      JSON.stringify([{ date, slot: 1, status: "success", dry_run: false, attempts: 1 }]),
      "utf8"
    );

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      postCurrentSlot({
        root,
        date,
        slot: 1,
        now: "2026-05-15T11:30:00+08:00",
        dryRun: false,
        verifyPublicImageUrl: false,
        fetchImpl
      })
    ).rejects.toThrow(/posted-log for 2026-05-15 is malformed or ambiguous/);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await exists(join(root, "data", "publish-locks", `${date}-slot1.lock`))).toBe(false);
  });

  it("fails closed before Meta when a live success has no trimmed remote post_id", async () => {
    vi.stubEnv("DRY_RUN", "false");
    vi.stubEnv("META_ACCESS_TOKEN", "EAAabcdefghijklmnopqrstuvwxyz1234567890");
    vi.stubEnv("FB_PAGE_ID", "123456789012345");
    vi.stubEnv("IG_USER_ID", "12345678901234567");

    const root = await mkdtemp(join(tmpdir(), "laundry-social-missing-post-id-log-"));
    const date = "2026-05-15";
    await generateDailyContent({ date, root, force: true });
    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    await writeFile(join(root, "docs", "assets", date, "slot-01.png"), "fake image");
    await approveSlot(root, date);
    await mkdir(join(root, "data", "posted-log"), { recursive: true });
    await writeFile(
      join(root, "data", "posted-log", `${date}.json`),
      JSON.stringify([
        {
          date,
          slot: 1,
          platform: "facebook",
          status: "success",
          dry_run: false,
          attempts: 1,
          created_at: "2026-05-15T03:30:00.000Z"
        }
      ]),
      "utf8"
    );

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      postCurrentSlot({
        root,
        date,
        slot: 1,
        now: "2026-05-15T11:30:00+08:00",
        dryRun: false,
        verifyPublicImageUrl: false,
        fetchImpl
      })
    ).rejects.toThrow(/posted-log for 2026-05-15 is malformed or ambiguous/);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed on an old live publish lock without any Meta request and preserves it for manual recovery", async () => {
    vi.stubEnv("DRY_RUN", "false");
    vi.stubEnv("META_ACCESS_TOKEN", "EAAabcdefghijklmnopqrstuvwxyz1234567890");
    vi.stubEnv("FB_PAGE_ID", "123456789012345");
    vi.stubEnv("IG_USER_ID", "12345678901234567");

    const root = await mkdtemp(join(tmpdir(), "laundry-social-old-lock-"));
    const date = "2026-05-15";
    const lockFile = join(root, "data", "publish-locks", `${date}-slot1.lock`);
    const priorLock = "owner=previous-publisher\npid=999\nacquired_at=2026-05-15T00:00:00.000Z\n";
    await generateDailyContent({ date, root, force: true });
    await mkdir(join(root, "data", "publish-locks"), { recursive: true });
    await writeFile(lockFile, priorLock, "utf8");
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      postCurrentSlot({
        root,
        date,
        slot: 1,
        now: "2026-05-15T11:30:00+08:00",
        dryRun: false,
        verifyPublicImageUrl: false,
        fetchImpl
      })
    ).rejects.toThrow(/legacy publish lock exists[\s\S]*Manual recovery required/);

    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(readFile(lockFile, "utf8")).resolves.toBe(priorLock);
    expect(await exists(join(root, "data", "posted-log", `${date}.json`))).toBe(false);
  });

  it("keeps a matching legacy tuple blocked while Instagram publishes independently", async () => {
    setLiveMetaEnv();
    const root = await mkdtemp(join(tmpdir(), "laundry-social-legacy-meta-intent-"));
    const date = "2026-05-15";
    const legacyPath = join(root, "data", "meta-publish-intents", `${date}.json`);
    await seedCanonicalLiveImageApproval(root, date);
    const captions = await publicationCaptions(root, date);
    await mkdir(join(root, "data", "meta-publish-intents"), { recursive: true });
    const legacy = [
      {
        date,
        slot: 1,
        platform: "facebook",
        state: "pending_remote_commit",
        created_at: "2026-05-15T03:30:00.000Z"
      }
    ];
    await writeFile(legacyPath, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const endpoint = String(url);
      if (endpoint.endsWith("/photos")) throw new Error("Facebook must not be posted with a legacy intent");
      const readback = liveImageReadback(endpoint, init, captions);
      if (readback) return readback;
      if (endpoint.endsWith("/media_publish")) return jsonResponse({ id: "ig-photo-1" });
      return jsonResponse({ id: "ig-container-1" });
    }) as unknown as typeof fetch;
    await expect(
      postCurrentSlot({
        root,
        date,
        slot: 1,
        now: "2026-05-15T11:30:00+08:00",
        dryRun: false,
        verifyPublicImageUrl: false,
        fetchImpl
      })
    ).rejects.toThrow(/Legacy Meta publish intent.*automatic retry is blocked/);

    expect(vi.mocked(fetchImpl).mock.calls.filter(([url]) => String(url).endsWith("/photos"))).toHaveLength(0);
    expect(vi.mocked(fetchImpl).mock.calls.filter(([url]) => String(url).endsWith("/media_publish"))).toHaveLength(1);
    await expect(loadPostLog(date, root)).resolves.toEqual([
      expect.objectContaining({ platform: "instagram", status: "success", post_id: "ig-photo-1" })
    ]);
    await expect(readFile(legacyPath, "utf8")).resolves.toContain("pending_remote_commit");
  });

  it("keeps an incomplete Facebook claim blocked while Instagram publishes independently", async () => {
    setLiveMetaEnv();
    const root = await mkdtemp(join(tmpdir(), "laundry-social-incomplete-facebook-claim-"));
    const date = "2026-05-15";
    await seedCanonicalLiveImageApproval(root, date);
    const captions = await publicationCaptions(root, date);
    const claimPath = await writeIncompleteMetaClaim(root, date, "facebook");
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const endpoint = String(url);
      if (endpoint.endsWith("/photos")) throw new Error("Facebook must not be posted with an incomplete claim");
      const readback = liveImageReadback(endpoint, init, captions);
      if (readback) return readback;
      if (endpoint.endsWith("/media_publish")) return jsonResponse({ id: "ig-photo-1" });
      return jsonResponse({ id: "ig-container-1" });
    }) as unknown as typeof fetch;

    await expect(
      postCurrentSlot({
        root,
        date,
        slot: 1,
        now: "2026-05-15T11:30:00+08:00",
        dryRun: false,
        verifyPublicImageUrl: false,
        fetchImpl
      })
    ).rejects.toThrow(/Meta remote POST claim .*facebook.*automatic retry is blocked/);

    expect(vi.mocked(fetchImpl).mock.calls.filter(([url]) => String(url).endsWith("/photos"))).toHaveLength(0);
    expect(vi.mocked(fetchImpl).mock.calls.filter(([url]) => String(url).endsWith("/media_publish"))).toHaveLength(1);
    await expect(loadPostLog(date, root)).resolves.toEqual([
      expect.objectContaining({ platform: "instagram", status: "success", post_id: "ig-photo-1" })
    ]);
    await expect(readFile(claimPath, "utf8")).resolves.toContain("facebook-incomplete-claim");
  });

  it("keeps both incomplete platform claims fail-closed without any Meta request", async () => {
    setLiveMetaEnv();
    const root = await mkdtemp(join(tmpdir(), "laundry-social-incomplete-both-claims-"));
    const date = "2026-05-15";
    await seedCanonicalLiveImageApproval(root, date);
    const [facebookClaim, instagramClaim] = await Promise.all([
      writeIncompleteMetaClaim(root, date, "facebook"),
      writeIncompleteMetaClaim(root, date, "instagram")
    ]);
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      postCurrentSlot({
        root,
        date,
        slot: 1,
        now: "2026-05-15T11:30:00+08:00",
        dryRun: false,
        verifyPublicImageUrl: false,
        fetchImpl
      })
    ).rejects.toThrow(/Meta remote POST claim .*facebook.*automatic retry is blocked/);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await exists(join(root, "data", "posted-log", `${date}.json`))).toBe(false);
    await expect(readFile(facebookClaim, "utf8")).resolves.toContain("facebook-incomplete-claim");
    await expect(readFile(instagramClaim, "utf8")).resolves.toContain("instagram-incomplete-claim");
  });

  it("treats a non-dry success without verified remote evidence as uncertain before receipt and ledger success", async () => {
    setLiveMetaEnv();
    const root = await mkdtemp(join(tmpdir(), "laundry-social-missing-remote-id-"));
    const date = "2026-05-15";
    await seedCanonicalLiveImageApproval(root, date);
    const captions = await publicationCaptions(root, date);
    vi.resetModules();
    vi.doMock("../src/postFacebook", () => ({
      // This is the provider-drift seam: a future provider change can return
      // a syntactically successful PostResult with only a transport id.
      postFacebookPhoto: async (): Promise<PostResult> => ({
        platform: "facebook",
        status: "success",
        dry_run: false,
        attempts: 1,
        post_id: "provider-id-without-readback"
      }),
      postFacebookCarousel: vi.fn(),
      postFacebookReel: vi.fn()
    }));
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const endpoint = String(url);
      const readback = liveImageReadback(endpoint, init, captions);
      if (readback) return readback;
      if (endpoint.endsWith("/media_publish")) return jsonResponse({ id: "ig-photo-1" });
      return jsonResponse({ id: "ig-container-1" });
    }) as unknown as typeof fetch;
    const options = {
      root,
      date,
      slot: 1,
      now: "2026-05-15T11:30:00+08:00",
      dryRun: false,
      verifyPublicImageUrl: false,
      fetchImpl
    };

    try {
      const { postCurrentSlot: postCurrentSlotWithMissingIdProvider } = await import("../src/postCurrentSlot");
      await expect(postCurrentSlotWithMissingIdProvider(options)).rejects.toThrow(/non-dry success without verified remote read-back evidence/);
      const log = await loadPostLog(date, root);
      const facebook = log.find((entry) => entry.platform === "facebook");
      expect(facebook).toMatchObject({ status: "uncertain", dry_run: false });
      expect(facebook?.post_id).toBeUndefined();
      const receipt = JSON.parse(
        await readFile(join(root, "data", "meta-publish-claims", `${date}-slot1-facebook.json.receipt.json`), "utf8")
      ) as { state: string; remote_entry?: PostLogEntry };
      expect(receipt).toMatchObject({ state: "remote_outcome_unknown", remote_entry: { status: "uncertain" } });
      expect(receipt.remote_entry?.post_id).toBeUndefined();

      const fetchCalls = vi.mocked(fetchImpl).mock.calls.length;
      await expect(postCurrentSlotWithMissingIdProvider(options)).resolves.toMatchObject([
        { platform: "facebook", status: "skipped" },
        { platform: "instagram", status: "skipped" }
      ]);
      expect(fetchImpl).toHaveBeenCalledTimes(fetchCalls);
    } finally {
      vi.doUnmock("../src/postFacebook");
      vi.resetModules();
    }
  });

  it("uses one immutable Facebook claim for concurrent callers and safe-skips its completed ledger", async () => {
    setLiveMetaEnv();
    const root = await mkdtemp(join(tmpdir(), "laundry-social-meta-claim-race-"));
    const date = "2026-05-15";
    await seedCanonicalLiveImageApproval(root, date);
    const captions = await publicationCaptions(root, date);

    let releaseFacebook: (() => void) | undefined;
    let signalFacebookStarted: (() => void) | undefined;
    const facebookStarted = new Promise<void>((resolve) => {
      signalFacebookStarted = resolve;
    });
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const endpoint = String(url);
      if (endpoint.endsWith("/photos")) {
        signalFacebookStarted?.();
        await new Promise<void>((resolve) => {
          releaseFacebook = resolve;
        });
        return jsonResponse({ id: "fb-photo-1" });
      }
      const readback = liveImageReadback(endpoint, init, captions);
      if (readback) return readback;
      if (endpoint.endsWith("/media_publish")) return jsonResponse({ id: "ig-photo-1" });
      return jsonResponse({ id: "ig-container-1" });
    }) as unknown as typeof fetch;
    const options = {
      root,
      date,
      slot: 1,
      now: "2026-05-15T11:30:00+08:00",
      dryRun: false,
      verifyPublicImageUrl: false,
      fetchImpl
    };

    const first = postCurrentSlot(options);
    await facebookStarted;
    await expect(postCurrentSlot(options)).rejects.toThrow(/Meta remote POST claim .*already exists.*facebook/);
    releaseFacebook?.();
    await expect(first).resolves.toMatchObject([{ platform: "facebook" }, { platform: "instagram" }]);

    const facebookPosts = vi.mocked(fetchImpl).mock.calls.filter(([url]) => String(url).endsWith("/photos"));
    expect(facebookPosts).toHaveLength(1);
    const facebookClaim = JSON.parse(
      await readFile(join(root, "data", "meta-publish-claims", `${date}-slot1-facebook.json`), "utf8")
    ) as { claim_id: string; source: { media_type: string; caption_sha256: string; source_binding_sha256: string; image_sha256: string[] } };
    expect(facebookClaim).toMatchObject({
      claim_id: expect.any(String),
      source: {
        media_type: "image",
        caption_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        source_binding_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        image_sha256: [expect.stringMatching(/^[a-f0-9]{64}$/)]
      }
    });

    const beforeSafeSkip = vi.mocked(fetchImpl).mock.calls.length;
    await expect(postCurrentSlot(options)).resolves.toMatchObject([
      { platform: "facebook", status: "skipped" },
      { platform: "instagram", status: "skipped" }
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(beforeSafeSkip);
  });

  it("lets Instagram continue when a completed Facebook claim remains after a crash", async () => {
    setLiveMetaEnv();
    const root = await mkdtemp(join(tmpdir(), "laundry-social-meta-claim-platform-resume-"));
    const date = "2026-05-15";
    await seedCanonicalLiveImageApproval(root, date);
    const captions = await publicationCaptions(root, date);
    const claimDir = join(root, "data", "meta-publish-claims");
    await mkdir(claimDir, { recursive: true });
    const hex = (letter: string) => letter.repeat(64);
    const facebookClaim = {
      schema_version: 1,
      claim_id: "facebook-claim-after-crash",
      date,
      slot: 1,
      platform: "facebook",
      created_at: "2026-05-15T03:30:00.000Z",
      source: {
        slot_sha256: hex("a"),
        source_binding_sha256: hex("b"),
        media_type: "image",
        caption_sha256: hex("c"),
        image_sha256: [hex("d")],
        image_url: "https://tester.github.io/laundry-social-auto-poster/assets/2026-05-15/slot-01.png"
      }
    };
    await writeFile(
      join(claimDir, `${date}-slot1-facebook.json`),
      `${JSON.stringify(facebookClaim, null, 2)}\n`,
      "utf8"
    );
    await writePostLog(
      date,
      [
        {
          date,
          slot: 1,
          platform: "facebook",
          status: "success",
          dry_run: false,
          attempts: 1,
          post_id: "fb-photo-1",
          created_at: "2026-05-15T03:31:00.000Z"
        }
      ],
      root
    );

    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const endpoint = String(url);
      if (endpoint.endsWith("/photos")) throw new Error("Facebook must not be posted again");
      const readback = liveImageReadback(endpoint, init, captions);
      if (readback) return readback;
      if (endpoint.endsWith("/media_publish")) return jsonResponse({ id: "ig-photo-1" });
      return jsonResponse({ id: "ig-container-1" });
    }) as unknown as typeof fetch;

    const results = await postCurrentSlot({
      root,
      date,
      slot: 1,
      now: "2026-05-15T11:30:00+08:00",
      dryRun: false,
      verifyPublicImageUrl: false,
      fetchImpl
    });

    expect(results.map((entry) => [entry.platform, entry.status])).toEqual([
      ["facebook", "skipped"],
      ["instagram", "success"]
    ]);
    expect(vi.mocked(fetchImpl).mock.calls.some(([url]) => String(url).endsWith("/photos"))).toBe(false);
    expect(await exists(join(claimDir, `${date}-slot1-instagram.json`))).toBe(true);
  });

  it("allows independent immutable claims for different slots", async () => {
    setLiveMetaEnv();
    const root = await mkdtemp(join(tmpdir(), "laundry-social-meta-claim-slots-"));
    const date = "2026-05-15";
    await seedCanonicalLiveImageApproval(root, date);
    let facebookId = 0;
    let instagramId = 0;
    let instagramContainerId = 0;
    const facebookCaptions = new Map<string, string>();
    const instagramContainerCaptions = new Map<string, string>();
    const instagramPublishedCaptions = new Map<string, string>();
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const endpoint = String(url);
      if (endpoint.endsWith("/photos")) {
        const id = `fb-${++facebookId}`;
        const body = init?.body as URLSearchParams;
        facebookCaptions.set(id, body.get("caption") ?? "");
        return jsonResponse({ id });
      }
      if (init?.method === "GET") {
        const id = graphObjectId(endpoint);
        if (!id) throw new Error("missing Graph object id");
        if (id.startsWith("fb-")) return verifiedFacebookImageReadback(id, facebookCaptions.get(id) ?? "");
        if (id.startsWith("ig-container-")) return jsonResponse({ id, status_code: "FINISHED" });
        if (id.startsWith("ig-")) return verifiedInstagramImageReadback(id, instagramPublishedCaptions.get(id) ?? "");
        throw new Error(`unexpected Graph GET ${id}`);
      }
      if (endpoint.endsWith("/media_publish")) {
        const body = init?.body as URLSearchParams;
        const creationId = body.get("creation_id") ?? "";
        const id = `ig-${++instagramId}`;
        instagramPublishedCaptions.set(id, instagramContainerCaptions.get(creationId) ?? "");
        return jsonResponse({ id });
      }
      const id = `ig-container-${++instagramContainerId}`;
      const body = init?.body as URLSearchParams;
      instagramContainerCaptions.set(id, body.get("caption") ?? "");
      return jsonResponse({ id });
    }) as unknown as typeof fetch;

    const [slotOne, slotTwo] = await Promise.all([
      postCurrentSlot({
        root,
        date,
        slot: 1,
        now: "2026-05-15T11:30:00+08:00",
        dryRun: false,
        verifyPublicImageUrl: false,
        fetchImpl
      }),
      postCurrentSlot({
        root,
        date,
        slot: 2,
        now: "2026-05-15T20:30:00+08:00",
        dryRun: false,
        verifyPublicImageUrl: false,
        fetchImpl
      })
    ]);

    expect(slotOne.every((entry) => entry.status === "success")).toBe(true);
    expect(slotTwo.every((entry) => entry.status === "success")).toBe(true);
    for (const name of [
      `${date}-slot1-facebook.json`,
      `${date}-slot1-instagram.json`,
      `${date}-slot2-facebook.json`,
      `${date}-slot2-instagram.json`
    ]) {
      expect(await exists(join(root, "data", "meta-publish-claims", name))).toBe(true);
    }
    expect(vi.mocked(fetchImpl).mock.calls.filter(([url]) => String(url).endsWith("/photos"))).toHaveLength(2);
  });

  it("refuses a live publish when the only approval is forced", async () => {
    vi.stubEnv("DRY_RUN", "false");
    vi.stubEnv("META_ACCESS_TOKEN", "EAAabcdefghijklmnopqrstuvwxyz1234567890");
    vi.stubEnv("FB_PAGE_ID", "123456789012345");
    vi.stubEnv("IG_USER_ID", "12345678901234567");
    vi.stubEnv("ALLOW_OFF_SCHEDULE_PUBLISH", "true");

    const root = await mkdtemp(join(tmpdir(), "laundry-social-forced-live-"));
    const date = "2026-05-15";
    await generateDailyContent({ date, root, force: true });
    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    await writeFile(join(root, "docs", "assets", date, "slot-01.png"), "fake image");
    await approvePost({
      date,
      slot: 1,
      platforms: ["facebook", "instagram"],
      approvedBy: "Owner",
      root,
      force: true
    });

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      postCurrentSlot({
        root,
        now: "2026-05-15T11:30:00+08:00",
        dryRun: false,
        verifyPublicImageUrl: false,
        fetchImpl
      })
    ).rejects.toThrow(/forced/);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a missing platform approval",
      async (root: string, date: string) => {
        const approvals = await loadApprovalLog(date, root);
        await writeApprovalLog(
          date,
          approvals.filter((entry) => !(entry.slot === 1 && entry.platform === "facebook")),
          root
        );
      },
      /slot 1 facebook requires exactly one approval tuple/
    ],
    [
      "a duplicate platform approval",
      async (root: string, date: string) => {
        const approvals = await loadApprovalLog(date, root);
        const duplicate = approvals.find((entry) => entry.slot === 1 && entry.platform === "facebook");
        if (!duplicate) throw new Error("canonical fixture is missing Facebook approval");
        await writeApprovalLog(date, [...approvals, { ...duplicate }], root);
      },
      /slot 1 facebook requires exactly one approval tuple/
    ],
    [
      "a cross-date platform approval",
      async (root: string, date: string) => {
        const approvals = await loadApprovalLog(date, root);
        await writeApprovalLog(
          date,
          approvals.map((entry) =>
            entry.slot === 1 && entry.platform === "facebook" ? { ...entry, date: "2026-05-14" } : entry
          ),
          root
        );
      },
      /slot 1 facebook has wrong approval date/
    ],
    [
      "a missing approval fingerprint",
      async (root: string, date: string) => {
        await rm(join(root, "data", "approved-log", `${date}.fingerprints.json`), { force: true });
      },
      /approval fingerprint sidecar is missing/
    ],
    [
      "a missing immutable image digest",
      async (root: string, date: string) => {
        await rm(join(root, "data", "approved-log", `${date}.image-digests.json`), { force: true });
      },
      /image-digest sidecar is missing/
    ],
    [
      "an unbound declared public video",
      async (root: string, date: string) => {
        const content = await loadDailyContent(date, root, { today: date });
        if (!content || content.tampered) throw new Error("canonical fixture calendar is unavailable");
        const slots = content.slots.map((slot) =>
          slot.slot === 1
            ? {
                ...slot,
                local_video_path: `docs/assets/${date}/slot-01.mp4`,
                public_video_url: `https://tester.github.io/laundry-social-auto-poster/assets/${date}/slot-01.mp4`,
                video_prompt: "canonical video proof fixture"
              }
            : slot
        );
        await writeDailyContent(
          { date: content.date, timezone: content.timezone, generated_at: content.generated_at, slots },
          root
        );
        await writeCanonicalApprovalFingerprints(root, date, slots);
      },
      /slot 1 public video requires exactly one canonical source record/
    ]
  ])("blocks %s before public URL or Meta fetch", async (_label, mutate, expectedGap) => {
    setLiveMetaEnv();
    const root = await mkdtemp(join(tmpdir(), "laundry-social-canonical-live-refusal-"));
    const date = "2026-05-15";
    await seedCanonicalLiveImageApproval(root, date);
    await mutate(root, date);

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      postCurrentSlot({
        root,
        date,
        slot: 1,
        now: "2026-05-15T11:30:00+08:00",
        dryRun: false,
        verifyPublicImageUrl: true,
        fetchImpl
      })
    ).rejects.toThrow(expectedGap);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks a tampered calendar before public URL or Meta fetch", async () => {
    setLiveMetaEnv();
    const root = await mkdtemp(join(tmpdir(), "laundry-social-canonical-tampered-live-"));
    const date = "2026-05-15";
    await seedCanonicalLiveImageApproval(root, date);
    const calendarPath = join(root, "data", "content-calendar", `${date}.json`);
    const calendar = JSON.parse(await readFile(calendarPath, "utf8")) as { slots: Array<{ topic: string }> };
    calendar.slots[0]!.topic = "changed after approval";
    await writeFile(calendarPath, `${JSON.stringify(calendar)}\n`, "utf8");

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      postCurrentSlot({
        root,
        date,
        slot: 1,
        now: "2026-05-15T11:30:00+08:00",
        dryRun: false,
        verifyPublicImageUrl: true,
        fetchImpl
      })
    ).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stops before Graph when a PATH-shadow ffprobe is refused by the immutable runtime gate", async () => {
    setLiveMetaEnv();
    const root = await mkdtemp(join(tmpdir(), "laundry-social-runtime-shadow-"));
    const date = "2026-05-15";
    await seedCanonicalLiveReelApproval(root, date);
    const shadow = join(root, "path-shadow", "ffprobe.exe");
    await mkdir(dirname(shadow), { recursive: true });
    await writeFile(shadow, "PATH shadow must not run", "utf8");
    vi.stubEnv("PATH", `${dirname(shadow)};${process.env.PATH ?? ""}`);

    const native = vi.fn();
    let runtimeFailure: unknown;
    try {
      await probeVideo(join(root, "docs", "assets", date, "slot-01.mp4"), {
        root,
        execFile: native as never
      });
    } catch (error) {
      runtimeFailure = error;
    }
    expect(runtimeFailure).toMatchObject({ code: "TRUSTED_PRODUCTION_RUNTIME_UNAVAILABLE" });
    expect(native).not.toHaveBeenCalled();

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      postCurrentSlot({
        root,
        date,
        slot: 1,
        now: "2026-05-15T11:30:00+08:00",
        dryRun: false,
        verifyPublicImageUrl: false,
        fetchImpl
      })
    ).rejects.toMatchObject({ code: "TRUSTED_PRODUCTION_RUNTIME_UNAVAILABLE" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("allows a complete canonical approval package to reach only mocked Graph posts", async () => {
    setLiveMetaEnv();
    const root = await mkdtemp(join(tmpdir(), "laundry-social-canonical-live-green-"));
    const date = "2026-05-15";
    await seedCanonicalLiveImageApproval(root, date);
    const captions = await publicationCaptions(root, date);
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const endpoint = String(url);
      if (endpoint.endsWith("/photos")) return jsonResponse({ id: "fb-canonical-photo-1" });
      const readback = liveImageReadback(endpoint, init, captions);
      if (readback) return readback;
      if (endpoint.endsWith("/media_publish")) return jsonResponse({ id: "ig-canonical-photo-1" });
      return jsonResponse({ id: "ig-canonical-container-1" });
    }) as unknown as typeof fetch;

    const results = await postCurrentSlot({
      root,
      date,
      slot: 1,
      now: "2026-05-15T11:30:00+08:00",
      dryRun: false,
      verifyPublicImageUrl: false,
      fetchImpl
    });

    expect(results.map((entry) => [entry.platform, entry.status, entry.post_id])).toEqual([
      ["facebook", "success", "fb-canonical-photo-1"],
      ["instagram", "success", "ig-canonical-photo-1"]
    ]);
    expect(results.map((entry) => entry.remote_publication_evidence?.remote_media_type)).toEqual(["IMAGE", "IMAGE"]);
    const receipts = await Promise.all(
      ["facebook", "instagram"].map(async (platform) =>
        JSON.parse(
          await readFile(join(root, "data", "meta-publish-claims", `${date}-slot1-${platform}.json.receipt.json`), "utf8")
        ) as { state: string; remote_entry?: PostLogEntry }
      )
    );
    expect(receipts).toEqual([
      expect.objectContaining({
        state: "remote_accepted",
        remote_entry: expect.objectContaining({ remote_publication_evidence: expect.objectContaining({ remote_media_type: "IMAGE" }) })
      }),
      expect.objectContaining({
        state: "remote_accepted",
        remote_entry: expect.objectContaining({ remote_publication_evidence: expect.objectContaining({ remote_media_type: "IMAGE" }) })
      })
    ]);
    expect(vi.mocked(fetchImpl).mock.calls.some(([url]) => String(url).endsWith("/photos"))).toBe(true);
    expect(vi.mocked(fetchImpl).mock.calls.some(([url]) => String(url).endsWith("/media_publish"))).toBe(true);
  });

  it("records a committed photo with failed readback as uncertain and never repeats the Facebook POST", async () => {
    setLiveMetaEnv();
    const root = await mkdtemp(join(tmpdir(), "laundry-social-photo-readback-uncertain-"));
    const date = "2026-05-15";
    await seedCanonicalLiveImageApproval(root, date);
    const captions = await publicationCaptions(root, date);
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const endpoint = String(url);
      if (endpoint.endsWith("/photos")) return jsonResponse({ id: "fb-unverified-photo-1" });
      if (init?.method === "GET") {
        const id = graphObjectId(endpoint);
        if (id === "fb-unverified-photo-1") {
          return jsonResponse({
            id,
            permalink_url: "https://www.facebook.com/123456789012345/posts/fb-unverified-photo-1",
            message: captions.facebook,
            attachments: { data: [] }
          });
        }
        const readback = liveImageReadback(endpoint, init, captions);
        if (readback) return readback;
      }
      if (endpoint.endsWith("/media_publish")) return jsonResponse({ id: "ig-photo-1" });
      return jsonResponse({ id: "ig-container-1" });
    }) as unknown as typeof fetch;

    await expect(
      postCurrentSlot({
        root,
        date,
        slot: 1,
        now: "2026-05-15T11:30:00+08:00",
        dryRun: false,
        verifyPublicImageUrl: false,
        fetchImpl
      })
    ).rejects.toThrow(/Facebook photo may already be live, but remote verification failed/);

    const entries = await loadPostLog(date, root);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ platform: "facebook", status: "uncertain" });
    expect(entries[0]?.post_id).toBeUndefined();
    expect(entries[0]?.remote_publication_evidence).toBeUndefined();
    expect(entries[1]).toMatchObject({
      platform: "instagram",
      status: "success",
      remote_publication_evidence: expect.objectContaining({ remote_media_type: "IMAGE", caption_exact_match: true })
    });
    const facebookReceipt = JSON.parse(
      await readFile(join(root, "data", "meta-publish-claims", `${date}-slot1-facebook.json.receipt.json`), "utf8")
    ) as { state: string; remote_entry?: PostLogEntry };
    expect(facebookReceipt).toMatchObject({ state: "remote_outcome_unknown", remote_entry: { status: "uncertain" } });
    expect(facebookReceipt.remote_entry?.remote_publication_evidence).toBeUndefined();
    expect(vi.mocked(fetchImpl).mock.calls.filter(([url]) => String(url).endsWith("/photos"))).toHaveLength(1);
  });

  it("refuses a live post without canonical approval records before any fetch", async () => {
    setLiveMetaEnv();
    const root = await mkdtemp(join(tmpdir(), "laundry-social-no-approval-"));
    await generateDailyContent({ date: "2026-05-15", root, force: true });
    await mkdir(join(root, "docs", "assets", "2026-05-15"), { recursive: true });
    await writeFile(join(root, "docs", "assets", "2026-05-15", "slot-01.png"), "fake image");

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      postCurrentSlot({
        root,
        now: "2026-05-15T11:30:00+08:00",
        dryRun: false,
        verifyPublicImageUrl: true,
        fetchImpl
      })
    ).rejects.toThrow(/Canonical public approval is required/);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await exists(join(root, "data", "posted-log", "2026-05-15.json"))).toBe(false);
  });
});
