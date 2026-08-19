import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assessPlannedReelReadiness,
  inspectPlannedReelReadiness,
  inspectReelShortReconciliation,
  isQualifiedFacebookReel,
  isQualifiedInstagramReel,
  reconcileReelShorts,
  verifyQualifiedDualPlatformReelReplacement,
  type YouTubeLogEntry
} from "../src/publishingReconciliation";
import { buildShortMetadata, buildYouTubeConsentUrl, uploadShort } from "../src/postYouTube";
import {
  loadDailyContent,
  loadVideoRepairQueue,
  upsertVideoRepairQueue,
  withJsonFileLock,
  writeDailyContent,
  writeJsonAtomic
} from "../src/logging";
import { resolveVideoRepair } from "../src/resolveVideoRepair";
import type { DailySlot, PostLogEntry } from "../src/types";
import { hashVideoPrompt } from "../src/videoRunFreshness";

const roots: string[] = [];
const EXPECTED_YOUTUBE_CHANNEL_ID = "UCcVDFN7Ve-cD9duxRdM5VXQ";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function post(slot: number, overrides: Partial<PostLogEntry> = {}): PostLogEntry {
  const postId = `instagram-${slot}`;
  return {
    date: "2026-08-18",
    slot,
    platform: "instagram",
    status: "success",
    dry_run: false,
    attempts: 1,
    published_media_type: "reel",
    video_status: "published",
    video_sha256: "a".repeat(64),
    post_id: postId,
    remote_reel_evidence: {
      remote_id: postId,
      permalink: `https://www.instagram.com/reel/${postId}/`,
      verified_at: "2026-08-18T12:00:00.000Z",
      remote_media_type: "REELS",
      caption_exact_match: true
    },
    created_at: "2026-08-18T12:00:00.000Z",
    ...overrides
  };
}

function upload(slot: number, overrides: Partial<YouTubeLogEntry> = {}): YouTubeLogEntry {
  return {
    date: "2026-08-18",
    slot,
    video_id: `youtube-${slot}`,
    title: `slot ${slot}`,
    uploaded_at: "2026-08-18T15:00:00.000Z",
    ...overrides
  };
}

function reelSlot(slot = 3): DailySlot {
  return {
    slot,
    time: "12:00",
    category: "情境文",
    topic: "驗收中的 Reel",
    media_type: "reel",
    instagram_caption: "caption",
    facebook_caption: "caption",
    image_prompt: "cover",
    local_image_path: "docs/assets/cover.png",
    public_image_url: "https://example.com/cover.png",
    local_video_path: "docs/assets/reel.mp4",
    public_video_url: "https://example.com/assets/reel.mp4",
    video_prompt: "one action",
    visual_route: "shop-inspection",
    traffic_route: "object-proof",
    status: "pending"
  };
}

const REPAIR_SOURCE_DATE = "2026-08-18";
const REPAIR_REPLACEMENT_DATE = "2026-08-19";
const REPAIR_SLOT = 2;
const REPAIR_TOPIC = "同主題的雙平台 Reel 修復";

function repairSlot(date: string, slot: number, topic: string, mediaType: "image" | "reel" = "reel"): DailySlot {
  const suffix = String(slot).padStart(2, "0");
  return {
    ...reelSlot(slot),
    time: slot === 1 ? "11:30" : "20:30",
    topic,
    media_type: mediaType,
    local_image_path: `docs/assets/${date}/slot-${suffix}.png`,
    public_image_url: `https://example.com/${date}/slot-${suffix}.png`,
    ...(mediaType === "reel"
      ? {
          local_video_path: `docs/assets/${date}/slot-${suffix}.mp4`,
          public_video_url: `https://example.com/${date}/slot-${suffix}.mp4`
        }
      : { local_video_path: undefined, public_video_url: undefined })
  };
}

function qualifiedRepairPost(
  platform: "facebook" | "instagram",
  videoSha256: string,
  overrides: Partial<PostLogEntry> = {}
): PostLogEntry {
  const postId = `${platform}-repair-${REPAIR_SLOT}`;
  return {
    date: REPAIR_REPLACEMENT_DATE,
    slot: REPAIR_SLOT,
    platform,
    status: "success",
    dry_run: false,
    attempts: 1,
    published_media_type: "reel",
    video_status: "published",
    video_sha256: videoSha256,
    post_id: postId,
    remote_reel_evidence: {
      remote_id: postId,
      permalink:
        platform === "facebook"
          ? `https://www.facebook.com/reel/${postId}`
          : `https://www.instagram.com/reel/${postId}/`,
      verified_at: "2026-08-19T12:00:00.000Z",
      remote_media_type: "REELS",
      caption_exact_match: true
    },
    created_at: "2026-08-19T12:00:00.000Z",
    ...overrides
  };
}

async function dualReelRepairFixture(): Promise<{
  root: string;
  videoSha256: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "qualified-dual-reel-repair-"));
  roots.push(root);
  const video = Buffer.from("qualified dual platform replacement MP4", "utf8");
  const videoSha256 = createHash("sha256").update(video).digest("hex");
  await mkdir(join(root, "docs", "assets", REPAIR_REPLACEMENT_DATE), { recursive: true });
  await mkdir(join(root, "data", "posted-log"), { recursive: true });
  await writeFile(
    join(root, "docs", "assets", REPAIR_REPLACEMENT_DATE, `slot-${String(REPAIR_SLOT).padStart(2, "0")}.mp4`),
    video
  );
  await writeDailyContent(
    {
      date: REPAIR_SOURCE_DATE,
      timezone: "Asia/Taipei",
      generated_at: "2026-08-18T06:00:00.000Z",
      slots: [
        repairSlot(REPAIR_SOURCE_DATE, 1, "來源日的其他內容", "image"),
        repairSlot(REPAIR_SOURCE_DATE, REPAIR_SLOT, REPAIR_TOPIC)
      ]
    },
    root
  );
  await writeDailyContent(
    {
      date: REPAIR_REPLACEMENT_DATE,
      timezone: "Asia/Taipei",
      generated_at: "2026-08-19T06:00:00.000Z",
      slots: [
        repairSlot(REPAIR_REPLACEMENT_DATE, 1, "修復日的其他內容", "image"),
        repairSlot(REPAIR_REPLACEMENT_DATE, REPAIR_SLOT, REPAIR_TOPIC)
      ]
    },
    root
  );
  await writeFile(
    join(root, "data", "posted-log", `${REPAIR_REPLACEMENT_DATE}.json`),
    `${JSON.stringify([
      qualifiedRepairPost("facebook", videoSha256),
      qualifiedRepairPost("instagram", videoSha256)
    ], null, 2)}\n`,
    "utf8"
  );
  return { root, videoSha256 };
}

async function enqueueRepair(root: string): Promise<void> {
  await upsertVideoRepairQueue(
    {
      source_date: REPAIR_SOURCE_DATE,
      source_slot: REPAIR_SLOT,
      status: "VIDEO_DEFERRED",
      original_media_type: "reel",
      fallback_media_type: "image",
      defer_kind: "expected",
      failure_reason: "replacement waiting for qualified dual-platform Reel proof",
      detected_at: "2026-08-18T12:00:00.000Z",
      next_attempt: "next-production-cycle"
    },
    root
  );
}

/** Writes the full, immutable public-release package that a real approval would leave behind. */
async function seedCanonicalYouTubePublicationApproval(root: string, date = "2026-08-18"): Promise<void> {
  const content = await loadDailyContent(date, root, { today: date });
  if (!content || content.tampered) throw new Error(`fixture calendar ${date} is unavailable for canonical approval`);

  const approvalDirectory = join(root, "data", "approved-log");
  const videoSourcesDirectory = join(root, "data", "video-sources");
  const videoReviewsDirectory = join(root, "data", "video-reviews");
  await Promise.all([
    mkdir(approvalDirectory, { recursive: true }),
    mkdir(videoSourcesDirectory, { recursive: true }),
    mkdir(videoReviewsDirectory, { recursive: true })
  ]);

  const digests: Record<string, Record<string, string>> = {};
  for (const slot of content.slots) {
    const imagePath = join(root, ...slot.local_image_path.split("/"));
    let bytes: Buffer;
    try {
      bytes = await readFile(imagePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      bytes = Buffer.from(`approved-cover-${date}-${slot.slot}`, "utf8");
      await mkdir(join(imagePath, ".."), { recursive: true });
      await writeFile(imagePath, bytes);
    }
    digests[String(slot.slot)] = {
      [slot.local_image_path]: createHash("sha256").update(bytes).digest("hex")
    };
  }

  await writeJsonAtomic(
    join(approvalDirectory, `${date}.json`),
    content.slots.flatMap((slot) =>
      (["facebook", "instagram"] as const).map((platform) => ({
        date,
        slot: slot.slot,
        platform,
        status: "approved",
        approved_by: "fixture-reviewer",
        created_at: "2026-08-18T08:00:00.000Z"
      }))
    )
  );
  await writeJsonAtomic(
    join(approvalDirectory, `${date}.fingerprints.json`),
    Object.fromEntries(
      content.slots.map((slot) => [String(slot.slot), createHash("sha256").update(JSON.stringify(slot)).digest("hex")])
    )
  );
  await writeJsonAtomic(join(approvalDirectory, `${date}.image-digests.json`), digests);

  const reelSlots = content.slots.filter(
    (slot): slot is DailySlot & { local_video_path: string; video_prompt: string } =>
      slot.media_type === "reel" && Boolean(slot.local_video_path) && Boolean(slot.video_prompt)
  );
  await writeJsonAtomic(
    join(videoSourcesDirectory, `${date}.json`),
    reelSlots.map((slot) => ({
      date,
      slot: slot.slot,
      source: "grok-imagine-video",
      model: "fixture-grok-imagine-video",
      video_path: slot.local_video_path,
      request_id: `fixture-request-${slot.slot}`,
      duration_seconds: 10,
      width: 1080,
      height: 1920,
      frame_rate: 30,
      video_codec: "h264",
      marked_at: "2026-08-18T08:00:00.000Z"
    }))
  );
  await writeJsonAtomic(
    join(videoReviewsDirectory, `${date}.json`),
    await Promise.all(
      reelSlots.map(async (slot) => ({
        date,
        slot: slot.slot,
        video_path: slot.local_video_path,
        video_sha256: createHash("sha256")
          .update(await readFile(join(root, ...slot.local_video_path.split("/"))))
          .digest("hex"),
        prompt_hash: hashVideoPrompt(slot.video_prompt),
        review_round: 1,
        full_decode: "pass",
        all_frame_physics_review: "pass",
        grok_review: "pass",
        sol_review: "pass",
        separate_zh_tw_tts_review: "pass",
        generated_clip_audio_used: false,
        status: "approved",
        reviewed_at: "2026-08-18T08:00:00.000Z",
        reviewed_by: "codex-visual-qa"
      }))
    )
  );
}

async function uploadableShortFixture(): Promise<{
  root: string;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  uploadCalls: () => number;
  fetchCalls: () => number;
  scopeProbeCalls: () => number;
  readBackCalls: () => number;
  scopeProbeRequest: () => { url: string; method?: string; authorization: string | null } | undefined;
  readBackRequest: () => { url: string; method?: string; authorization: string | null } | undefined;
}> {
  const root = await mkdtemp(join(tmpdir(), "youtube-commit-point-"));
  roots.push(root);
  await mkdir(join(root, "data", "posted-log"), { recursive: true });
  await mkdir(join(root, "data", "youtube-log"), { recursive: true });
  await mkdir(join(root, "docs", "assets"), { recursive: true });
  const video = Buffer.from("fixture-video", "utf8");
  const videoSha256 = createHash("sha256").update(video).digest("hex");
  await writeFile(
    join(root, "data", "posted-log", "2026-08-18.json"),
    JSON.stringify([post(2, { video_sha256: videoSha256.toUpperCase() })]),
    "utf8"
  );
  await writeFile(join(root, "data", "youtube-log", "2026-08-18.json"), JSON.stringify([]), "utf8");
  await writeFile(
    join(root, "data", "business-profile.json"),
    JSON.stringify({ youtube_url: `https://www.youtube.com/channel/${EXPECTED_YOUTUBE_CHANNEL_ID}` }),
    "utf8"
  );
  await writeFile(join(root, "docs", "assets", "reel.mp4"), video);
  await writeDailyContent(
    {
      date: "2026-08-18",
      timezone: "Asia/Taipei",
      generated_at: "2026-08-18T06:00:00.000Z",
      slots: [
        { ...reelSlot(1), media_type: "image", local_video_path: undefined, public_video_url: undefined },
        reelSlot(2)
      ]
    },
    root
  );
  await seedCanonicalYouTubePublicationApproval(root);
  let uploads = 0;
  let scopeProbes = 0;
  let readBacks = 0;
  let channelRequest: { url: string; method?: string; authorization: string | null } | undefined;
  let lookupRequest: { url: string; method?: string; authorization: string | null } | undefined;
  const metadata = buildShortMetadata({
    topic: "驗收中的 Reel",
    caption: "caption",
    date: "2026-08-18",
    slot: 2
  });
  let fetches = 0;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    fetches += 1;
    const target = String(url);
    if (target.includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "test-token" }), { status: 200 });
    }
    if (target.includes("/upload/youtube/v3/videos")) {
      uploads += 1;
      return new Response(JSON.stringify({ id: "remote-short-2" }), { status: 200 });
    }
    if (target.includes("/youtube/v3/channels")) {
      scopeProbes += 1;
      channelRequest = {
        url: target,
        method: init?.method,
        authorization: new Headers(init?.headers).get("Authorization")
      };
      return new Response(JSON.stringify({ items: [{ id: EXPECTED_YOUTUBE_CHANNEL_ID }] }), { status: 200 });
    }
    if (target.includes("/youtube/v3/videos")) {
      readBacks += 1;
      lookupRequest = {
        url: target,
        method: init?.method,
        authorization: new Headers(init?.headers).get("Authorization")
      };
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "remote-short-2",
              snippet: { ...metadata, channelId: EXPECTED_YOUTUBE_CHANNEL_ID },
              status: { privacyStatus: "public" }
            }
          ]
        }),
        { status: 200 }
      );
    }
    throw new Error(`Unexpected YouTube fixture request: ${target}`);
  }) as unknown as typeof fetch;
  return {
    root,
    env: { YT_CLIENT_ID: "client", YT_CLIENT_SECRET: "secret", YT_REFRESH_TOKEN: "refresh" },
    fetchImpl,
    uploadCalls: () => uploads,
    fetchCalls: () => fetches,
    scopeProbeCalls: () => scopeProbes,
    readBackCalls: () => readBacks,
    scopeProbeRequest: () => channelRequest,
    readBackRequest: () => lookupRequest
  };
}

async function tamperCalendar(root: string): Promise<void> {
  const path = join(root, "data", "content-calendar", "2026-08-18.json");
  const calendar = JSON.parse(await readFile(path, "utf8")) as { slots: Array<{ topic: string }> };
  const slot = calendar.slots.find((candidate) => candidate.topic === "驗收中的 Reel");
  if (!slot) throw new Error("fixture calendar slot is missing");
  slot.topic = "篡改過的 Reel 主題";
  await writeFile(path, `${JSON.stringify(calendar, null, 2)}\n`, "utf8");
}

function successfulOwnerChannelScopeProbe(target: string): Response | undefined {
  if (!target.includes("/youtube/v3/channels")) return undefined;
  return new Response(JSON.stringify({ items: [{ id: EXPECTED_YOUTUBE_CHANNEL_ID }] }), { status: 200 });
}

function remoteClaimPath(root: string, slot = 2): string {
  return join(root, "data", "youtube-upload-claims", "2026-08-18", `slot-${String(slot).padStart(2, "0")}.json`);
}

function uploadEvidencePath(root: string, slot = 2): string {
  return join(root, "data", "youtube-upload-evidence", "2026-08-18", `slot-${String(slot).padStart(2, "0")}.json`);
}

async function readRemoteClaim(root: string, slot = 2): Promise<{
  claim_id: string;
  source: { local_video_sha256: string; instagram_video_sha256: string; instagram_post_id: string };
  channel?: { expected_channel_id: string; authorized_channel_id: string };
}> {
  return JSON.parse(await readFile(remoteClaimPath(root, slot), "utf8")) as {
    claim_id: string;
    source: { local_video_sha256: string; instagram_video_sha256: string; instagram_post_id: string };
    channel?: { expected_channel_id: string; authorized_channel_id: string };
  };
}

async function readUploadEvidence(root: string, slot = 2): Promise<{
  claim_id: string;
  state: string;
  remote_video_id?: string;
  read_back_verified?: true;
  channel?: { expected_channel_id: string; authorized_channel_id: string };
  error?: string;
}> {
  return JSON.parse(await readFile(uploadEvidencePath(root, slot), "utf8")) as {
    claim_id: string;
    state: string;
    remote_video_id?: string;
    read_back_verified?: true;
    channel?: { expected_channel_id: string; authorized_channel_id: string };
    error?: string;
  };
}

async function appendDuplicateYouTubeLedgerEntry(root: string, slot = 2): Promise<void> {
  const path = join(root, "data", "youtube-log", "2026-08-18.json");
  const entries = JSON.parse(await readFile(path, "utf8")) as YouTubeLogEntry[];
  const entry = entries.find((candidate) => candidate.date === "2026-08-18" && candidate.slot === slot);
  if (!entry) throw new Error("fixture YouTube ledger entry is missing");
  await writeFile(path, `${JSON.stringify([...entries, { ...entry }], null, 2)}\n`, "utf8");
}

describe("Reel-to-YouTube reconciliation", () => {
  it("requests upload plus the minimum videos.list read scope in the reauthorization URL", () => {
    const consent = buildYouTubeConsentUrl({ clientId: "client-id", port: 43123 });
    const scopes = new Set((consent.searchParams.get("scope") ?? "").split(" ").filter(Boolean));

    expect(consent.origin).toBe("https://accounts.google.com");
    expect(consent.pathname).toBe("/o/oauth2/v2/auth");
    expect(scopes).toEqual(
      new Set([
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly"
      ])
    );
    expect(consent.searchParams.get("access_type")).toBe("offline");
    expect(consent.searchParams.get("prompt")).toBe("consent");
  });

  it("does not infer a Reel from an image fallback in slot 2", () => {
    const fallback = post(2, {
      published_media_type: "image",
      video_status: "VIDEO_DEFERRED"
    });

    expect(isQualifiedInstagramReel(fallback)).toBe(false);
    expect(reconcileReelShorts("2026-08-18", [fallback], [])).toEqual({
      expected_reel_slots: [],
      uploaded_reel_slots: [],
      missing_reel_slots: [],
      unexpected_youtube_slots: [],
      unverified_youtube_slots: []
    });
  });

  it("requires one exact Facebook and Instagram Reel row bound to the replacement MP4 before resolving a video defer", async () => {
    const fixture = await dualReelRepairFixture();

    await expect(
      verifyQualifiedDualPlatformReelReplacement({
        sourceDate: REPAIR_SOURCE_DATE,
        sourceSlot: REPAIR_SLOT,
        replacementDate: REPAIR_REPLACEMENT_DATE,
        replacementSlot: REPAIR_SLOT,
        root: fixture.root
      })
    ).resolves.toEqual({ qualified: true, video_sha256: fixture.videoSha256 });
    expect(isQualifiedFacebookReel(qualifiedRepairPost("facebook", fixture.videoSha256))).toBe(true);
  });

  it("rejects an image fallback even when the other platform has a verified Reel", async () => {
    const fixture = await dualReelRepairFixture();
    await writeFile(
      join(fixture.root, "data", "posted-log", `${REPAIR_REPLACEMENT_DATE}.json`),
      `${JSON.stringify([
        qualifiedRepairPost("facebook", fixture.videoSha256),
        qualifiedRepairPost("instagram", fixture.videoSha256, {
          published_media_type: "image",
          video_status: "VIDEO_DEFERRED"
        })
      ], null, 2)}\n`,
      "utf8"
    );

    await expect(
      verifyQualifiedDualPlatformReelReplacement({
        sourceDate: REPAIR_SOURCE_DATE,
        sourceSlot: REPAIR_SLOT,
        replacementDate: REPAIR_REPLACEMENT_DATE,
        replacementSlot: REPAIR_SLOT,
        root: fixture.root
      })
    ).resolves.toMatchObject({ qualified: false, reason: expect.stringContaining("qualified Facebook Reel") });
  });

  it("rejects duplicate or cross-date replacement rows instead of selecting a convenient pair", async () => {
    const fixture = await dualReelRepairFixture();
    const logPath = join(fixture.root, "data", "posted-log", `${REPAIR_REPLACEMENT_DATE}.json`);
    await writeFile(
      logPath,
      `${JSON.stringify([
        qualifiedRepairPost("facebook", fixture.videoSha256),
        qualifiedRepairPost("instagram", fixture.videoSha256),
        qualifiedRepairPost("facebook", fixture.videoSha256, { post_id: "facebook-repair-duplicate" })
      ], null, 2)}\n`,
      "utf8"
    );

    await expect(
      verifyQualifiedDualPlatformReelReplacement({
        sourceDate: REPAIR_SOURCE_DATE,
        sourceSlot: REPAIR_SLOT,
        replacementDate: REPAIR_REPLACEMENT_DATE,
        replacementSlot: REPAIR_SLOT,
        root: fixture.root
      })
    ).resolves.toMatchObject({ qualified: false, reason: expect.stringContaining("exactly two") });

    await writeFile(
      logPath,
      `${JSON.stringify([
        qualifiedRepairPost("facebook", fixture.videoSha256),
        qualifiedRepairPost("instagram", fixture.videoSha256, { date: REPAIR_SOURCE_DATE })
      ], null, 2)}\n`,
      "utf8"
    );
    await expect(
      verifyQualifiedDualPlatformReelReplacement({
        sourceDate: REPAIR_SOURCE_DATE,
        sourceSlot: REPAIR_SLOT,
        replacementDate: REPAIR_REPLACEMENT_DATE,
        replacementSlot: REPAIR_SLOT,
        root: fixture.root
      })
    ).resolves.toMatchObject({ qualified: false, reason: expect.stringContaining("cross-date ambiguous") });
  });

  it("rejects missing remote proof, an MP4 hash gap, topic drift, and tampered content", async () => {
    const fixture = await dualReelRepairFixture();
    const logPath = join(fixture.root, "data", "posted-log", `${REPAIR_REPLACEMENT_DATE}.json`);
    await writeFile(
      logPath,
      `${JSON.stringify([
        qualifiedRepairPost("facebook", fixture.videoSha256),
        qualifiedRepairPost("instagram", fixture.videoSha256, { remote_reel_evidence: undefined })
      ], null, 2)}\n`,
      "utf8"
    );
    await expect(
      verifyQualifiedDualPlatformReelReplacement({
        sourceDate: REPAIR_SOURCE_DATE,
        sourceSlot: REPAIR_SLOT,
        replacementDate: REPAIR_REPLACEMENT_DATE,
        replacementSlot: REPAIR_SLOT,
        root: fixture.root
      })
    ).resolves.toMatchObject({ qualified: false, reason: expect.stringContaining("qualified Facebook Reel") });

    await writeFile(
      logPath,
      `${JSON.stringify([
        qualifiedRepairPost("facebook", "a".repeat(64)),
        qualifiedRepairPost("instagram", "a".repeat(64))
      ], null, 2)}\n`,
      "utf8"
    );
    await expect(
      verifyQualifiedDualPlatformReelReplacement({
        sourceDate: REPAIR_SOURCE_DATE,
        sourceSlot: REPAIR_SLOT,
        replacementDate: REPAIR_REPLACEMENT_DATE,
        replacementSlot: REPAIR_SLOT,
        root: fixture.root
      })
    ).resolves.toMatchObject({ qualified: false, reason: expect.stringContaining("one valid SHA-256") });

    await writeDailyContent(
      {
        date: REPAIR_REPLACEMENT_DATE,
        timezone: "Asia/Taipei",
        generated_at: "2026-08-19T06:00:00.000Z",
        slots: [
          repairSlot(REPAIR_REPLACEMENT_DATE, 1, "修復日的其他內容", "image"),
          repairSlot(REPAIR_REPLACEMENT_DATE, REPAIR_SLOT, "不同主題的替代影片")
        ]
      },
      fixture.root
    );
    await expect(
      verifyQualifiedDualPlatformReelReplacement({
        sourceDate: REPAIR_SOURCE_DATE,
        sourceSlot: REPAIR_SLOT,
        replacementDate: REPAIR_REPLACEMENT_DATE,
        replacementSlot: REPAIR_SLOT,
        root: fixture.root
      })
    ).resolves.toMatchObject({ qualified: false, reason: expect.stringContaining("topics do not exactly match") });

    const calendarPath = join(fixture.root, "data", "content-calendar", `${REPAIR_SOURCE_DATE}.json`);
    const calendar = JSON.parse(await readFile(calendarPath, "utf8")) as { generated_at: string };
    calendar.generated_at = "2099-01-01T00:00:00.000Z";
    await writeFile(calendarPath, `${JSON.stringify(calendar, null, 2)}\n`, "utf8");
    await expect(
      verifyQualifiedDualPlatformReelReplacement({
        sourceDate: REPAIR_SOURCE_DATE,
        sourceSlot: REPAIR_SLOT,
        replacementDate: REPAIR_REPLACEMENT_DATE,
        replacementSlot: REPAIR_SLOT,
        root: fixture.root
      })
    ).resolves.toMatchObject({ qualified: false, reason: expect.stringContaining("integrity is marked tampered") });
  });

  it("keeps --ready non-resolving and makes the direct resolver require the same dual-platform proof", async () => {
    const fixture = await dualReelRepairFixture();
    await enqueueRepair(fixture.root);

    await expect(
      resolveVideoRepair({
        sourceDate: REPAIR_SOURCE_DATE,
        sourceSlot: REPAIR_SLOT,
        replacementDate: REPAIR_REPLACEMENT_DATE,
        replacementSlot: REPAIR_SLOT,
        root: fixture.root
      })
    ).rejects.toThrow(/no matching ready replacement candidate/);

    await resolveVideoRepair({
      sourceDate: REPAIR_SOURCE_DATE,
      sourceSlot: REPAIR_SLOT,
      replacementDate: REPAIR_REPLACEMENT_DATE,
      replacementSlot: REPAIR_SLOT,
      readyOnly: true,
      root: fixture.root
    });
    await expect(loadVideoRepairQueue(fixture.root)).resolves.toEqual([
      expect.objectContaining({
        status: "VIDEO_DEFERRED",
        replacement_candidate_date: REPAIR_REPLACEMENT_DATE,
        replacement_candidate_slot: REPAIR_SLOT
      })
    ]);

    await resolveVideoRepair({
      sourceDate: REPAIR_SOURCE_DATE,
      sourceSlot: REPAIR_SLOT,
      replacementDate: REPAIR_REPLACEMENT_DATE,
      replacementSlot: REPAIR_SLOT,
      root: fixture.root
    });
    await expect(loadVideoRepairQueue(fixture.root)).resolves.toEqual([
      expect.objectContaining({
        status: "RESOLVED",
        replacement_date: REPAIR_REPLACEMENT_DATE,
        replacement_slot: REPAIR_SLOT
      })
    ]);

    await expect(
      resolveVideoRepair({
        sourceDate: REPAIR_SOURCE_DATE,
        sourceSlot: REPAIR_SLOT,
        replacementDate: REPAIR_REPLACEMENT_DATE,
        replacementSlot: REPAIR_SLOT,
        readyOnly: true,
        root: fixture.root
      })
    ).rejects.toThrow(/not eligible to mark ready/);
    await expect(loadVideoRepairQueue(fixture.root)).resolves.toEqual([
      expect.objectContaining({ status: "RESOLVED" })
    ]);
  });

  it("leaves a direct repair deferred when the replacement lacks strict evidence", async () => {
    const fixture = await dualReelRepairFixture();
    await enqueueRepair(fixture.root);
    await writeFile(
      join(fixture.root, "data", "posted-log", `${REPAIR_REPLACEMENT_DATE}.json`),
      `${JSON.stringify([
        qualifiedRepairPost("facebook", fixture.videoSha256),
        qualifiedRepairPost("instagram", fixture.videoSha256, { remote_reel_evidence: undefined })
      ], null, 2)}\n`,
      "utf8"
    );

    await expect(
      resolveVideoRepair({
        sourceDate: REPAIR_SOURCE_DATE,
        sourceSlot: REPAIR_SLOT,
        replacementDate: REPAIR_REPLACEMENT_DATE,
        replacementSlot: REPAIR_SLOT,
        root: fixture.root
      })
    ).rejects.toThrow(/Video repair remains VIDEO_DEFERRED/);
    await expect(loadVideoRepairQueue(fixture.root)).resolves.toEqual([
      expect.objectContaining({ status: "VIDEO_DEFERRED" })
    ]);
  });

  it("does not let the generic defer queue writer synthesize RESOLVED without proof", async () => {
    const fixture = await dualReelRepairFixture();
    const forgedResolution = {
      source_date: REPAIR_SOURCE_DATE,
      source_slot: REPAIR_SLOT,
      status: "RESOLVED" as const,
      original_media_type: "reel" as const,
      fallback_media_type: "image" as const,
      defer_kind: "expected" as const,
      failure_reason: "forged state transition",
      detected_at: "2026-08-18T12:00:00.000Z",
      next_attempt: "next-production-cycle" as const
    };

    await expect(
      upsertVideoRepairQueue(
        forgedResolution as unknown as Parameters<typeof upsertVideoRepairQueue>[0],
        fixture.root
      )
    ).rejects.toThrow(/only record VIDEO_DEFERRED/);
    await expect(loadVideoRepairQueue(fixture.root)).resolves.toEqual([]);
  });

  it("rejects old or incomplete local Reel rows instead of opening the YouTube gate", () => {
    const noRemoteEvidence = post(2, { remote_reel_evidence: undefined });
    const noApprovedVideoBinding = post(3, { video_sha256: "not-a-sha" });
    const mismatchedRemoteId = post(4, {
      remote_reel_evidence: {
        remote_id: "another-post",
        permalink: "https://www.instagram.com/reel/another-post/",
        verified_at: "2026-08-18T12:00:00.000Z",
        remote_media_type: "REELS",
        caption_exact_match: true
      }
    });
    const nonInstagramPermalink = post(5, {
      remote_reel_evidence: {
        remote_id: "instagram-5",
        permalink: "https://example.com/reel/instagram-5/",
        verified_at: "2026-08-18T12:00:00.000Z",
        remote_media_type: "REELS",
        caption_exact_match: true
      }
    });

    expect(isQualifiedInstagramReel(noRemoteEvidence)).toBe(false);
    expect(isQualifiedInstagramReel(noApprovedVideoBinding)).toBe(false);
    expect(isQualifiedInstagramReel(mismatchedRemoteId)).toBe(false);
    expect(isQualifiedInstagramReel(nonInstagramPermalink)).toBe(false);
    expect(reconcileReelShorts("2026-08-18", [noRemoteEvidence, noApprovedVideoBinding, mismatchedRemoteId, nonInstagramPermalink], [])).toEqual({
      expected_reel_slots: [],
      uploaded_reel_slots: [],
      missing_reel_slots: [],
      unexpected_youtube_slots: [],
      unverified_youtube_slots: []
    });
  });

  it("matches uploaded Shorts to the same Reel slots instead of comparing totals", () => {
    const verifiedUpload = upload(2);
    const reconciliation = reconcileReelShorts(
      "2026-08-18",
      [post(2), post(3), post(1, { published_media_type: "image" })],
      [verifiedUpload, upload(1)],
      [verifiedUpload]
    );

    expect(reconciliation).toEqual({
      expected_reel_slots: [2, 3],
      uploaded_reel_slots: [2],
      missing_reel_slots: [3],
      unexpected_youtube_slots: [1],
      unverified_youtube_slots: [1]
    });
  });

  it("does not deduplicate duplicate same-date same-slot YouTube ledger rows into a green completion", () => {
    const completed = upload(2);

    expect(reconcileReelShorts("2026-08-18", [post(2)], [completed, { ...completed }], [completed, { ...completed }])).toEqual({
      expected_reel_slots: [2],
      uploaded_reel_slots: [],
      missing_reel_slots: [2],
      unexpected_youtube_slots: [],
      unverified_youtube_slots: [2]
    });
  });

  it("rejects dry runs, failed posts, and non-Reel media", () => {
    const reconciliation = reconcileReelShorts(
      "2026-08-18",
      [
        post(2, { dry_run: true }),
        post(3, { status: "failed" }),
        post(4, { published_media_type: "carousel" })
      ],
      []
    );

    expect(reconciliation.expected_reel_slots).toEqual([]);
  });

  it("reads the on-disk logs without treating a completed image fallback as a Reel", async () => {
    const root = await mkdtemp(join(tmpdir(), "publishing-reconciliation-"));
    roots.push(root);
    await mkdir(join(root, "data", "posted-log"), { recursive: true });
    await mkdir(join(root, "data", "youtube-log"), { recursive: true });
    await writeFile(
      join(root, "data", "posted-log", "2026-08-18.json"),
      JSON.stringify([post(2, { published_media_type: "image", video_status: "VIDEO_DEFERRED" })]),
      "utf8"
    );
    await writeFile(join(root, "data", "youtube-log", "2026-08-18.json"), JSON.stringify([upload(2)]), "utf8");

    await expect(inspectReelShortReconciliation({ date: "2026-08-18", root })).rejects.toThrow(
      "Unverified YouTube ledger entry for 2026-08-18 slot 2"
    );
  });

  it("does not let a different-date YouTube record fulfil today's same-slot Reel", () => {
    const reconciliation = reconcileReelShorts("2026-08-18", [post(2)], [upload(2, { date: "2026-08-17" })]);

    expect(reconciliation).toEqual({
      expected_reel_slots: [2],
      uploaded_reel_slots: [],
      missing_reel_slots: [2],
      unexpected_youtube_slots: [2],
      unverified_youtube_slots: []
    });
  });

  it("rejects an IG Reel copied from another date instead of opening today's YouTube gate", () => {
    expect(() => reconcileReelShorts("2026-08-18", [post(2, { date: "2026-08-17" })], [])).toThrow(
      "posted-log date mismatch"
    );
  });

  it("rejects a non-array or schema-invalid YouTube ledger instead of treating it as no upload", async () => {
    const root = await mkdtemp(join(tmpdir(), "youtube-ledger-schema-"));
    roots.push(root);
    await mkdir(join(root, "data", "posted-log"), { recursive: true });
    await mkdir(join(root, "data", "youtube-log"), { recursive: true });
    await writeFile(join(root, "data", "posted-log", "2026-08-18.json"), JSON.stringify([post(2)]), "utf8");
    await writeFile(join(root, "data", "youtube-log", "2026-08-18.json"), JSON.stringify({ stale: true }), "utf8");

    await expect(inspectReelShortReconciliation({ date: "2026-08-18", root })).rejects.toThrow(
      "youtube-log must be a JSON array"
    );

    await writeFile(
      join(root, "data", "youtube-log", "2026-08-18.json"),
      JSON.stringify([upload(2, { title: "" })]),
      "utf8"
    );
    await expect(inspectReelShortReconciliation({ date: "2026-08-18", root })).rejects.toThrow(
      "Invalid youtube-log entry"
    );

    await writeFile(
      join(root, "data", "youtube-log", "2026-08-18.json"),
      JSON.stringify([upload(2, { uploaded_at: "" })]),
      "utf8"
    );
    await expect(inspectReelShortReconciliation({ date: "2026-08-18", root })).rejects.toThrow(
      "Invalid youtube-log entry"
    );
  });

  it("rejects a corrupt same-file YouTube entry whose date differs from the requested upload", async () => {
    const root = await mkdtemp(join(tmpdir(), "youtube-date-mismatch-"));
    roots.push(root);
    await mkdir(join(root, "data", "youtube-log"), { recursive: true });
    await writeFile(
      join(root, "data", "youtube-log", "2026-08-18.json"),
      JSON.stringify([upload(2, { date: "2026-08-17" })]),
      "utf8"
    );

    await expect(uploadShort({ date: "2026-08-18", slot: 2, root })).rejects.toThrow(
      "YouTube log date mismatch for slot 2"
    );
  });

  it("rejects a source Reel whose log date disagrees with the requested upload", async () => {
    const root = await mkdtemp(join(tmpdir(), "youtube-source-date-mismatch-"));
    roots.push(root);
    await mkdir(join(root, "data", "youtube-log"), { recursive: true });
    await mkdir(join(root, "data", "posted-log"), { recursive: true });
    await writeFile(join(root, "data", "youtube-log", "2026-08-18.json"), JSON.stringify([]), "utf8");
    await writeFile(
      join(root, "data", "posted-log", "2026-08-18.json"),
      JSON.stringify([post(2, { date: "2026-08-17" })]),
      "utf8"
    );

    await expect(uploadShort({ date: "2026-08-18", slot: 2, root })).rejects.toThrow("posted-log date mismatch");
  });

  it("rejects a same-date empty-video stub instead of skipping it as completed", async () => {
    const root = await mkdtemp(join(tmpdir(), "youtube-empty-stub-"));
    roots.push(root);
    await mkdir(join(root, "data", "youtube-log"), { recursive: true });
    await mkdir(join(root, "data", "posted-log"), { recursive: true });
    await writeFile(
      join(root, "data", "youtube-log", "2026-08-18.json"),
      JSON.stringify([upload(2, { video_id: "" })]),
      "utf8"
    );
    await writeFile(join(root, "data", "posted-log", "2026-08-18.json"), JSON.stringify([post(2)]), "utf8");

    await expect(uploadShort({ date: "2026-08-18", slot: 2, root })).rejects.toThrow("Invalid youtube-log entry");
  });

  it("never re-POSTs a Short after remote success when the local ledger commit fails", async () => {
    const fixture = await uploadableShortFixture();
    const logPath = join(fixture.root, "data", "youtube-log", "2026-08-18.json");
    const writer: typeof writeJsonAtomic = async (path, value) => {
      if (path === logPath) throw new Error("simulated local ledger failure");
      await writeJsonAtomic(path, value);
    };

    await expect(
      uploadShort({
        date: "2026-08-18",
        slot: 2,
        root: fixture.root,
        env: fixture.env,
        fetchImpl: fixture.fetchImpl,
        now: new Date("2026-08-18T15:00:00.000Z"),
        writeJson: writer
      })
    ).rejects.toThrow("post-acceptance verification or local ledger commit failed");
    expect(fixture.uploadCalls()).toBe(1);

    const claim = await readRemoteClaim(fixture.root);
    const evidence = await readUploadEvidence(fixture.root);
    expect(claim.claim_id).toBe(evidence.claim_id);
    expect(evidence).toMatchObject({ state: "remote_accepted_log_failed", remote_video_id: "remote-short-2" });

    await expect(
      uploadShort({
        date: "2026-08-18",
        slot: 2,
        root: fixture.root,
        env: fixture.env,
        fetchImpl: fixture.fetchImpl
      })
    ).rejects.toThrow("automatic retry is blocked pending recovery");
    expect(fixture.uploadCalls()).toBe(1);
  });

  it("fails closed before any YouTube POST when the qualified IG video hash differs from the local MP4", async () => {
    const fixture = await uploadableShortFixture();
    await writeFile(
      join(fixture.root, "data", "posted-log", "2026-08-18.json"),
      JSON.stringify([post(2, { video_sha256: "b".repeat(64) })]),
      "utf8"
    );

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: fixture.fetchImpl })
    ).rejects.toThrow("IG video_sha256 does not match calendar local MP4");
    expect(fixture.uploadCalls()).toBe(0);
    expect(fixture.readBackCalls()).toBe(0);
    await expect(
      readFile(join(fixture.root, "data", "youtube-log", "2026-08-18.json"), "utf8")
    ).resolves.toBe("[]");
  });

  it("does not call any YouTube POST when no qualified IG Reel has a usable video hash", async () => {
    const fixture = await uploadableShortFixture();
    await writeFile(
      join(fixture.root, "data", "posted-log", "2026-08-18.json"),
      JSON.stringify([post(2, { video_sha256: undefined })]),
      "utf8"
    );

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: fixture.fetchImpl })
    ).resolves.toEqual({
      skipped: "no qualified IG Reel with verified video_sha256 for 2026-08-18 slot 2; YouTube waits for Instagram"
    });
    expect(fixture.uploadCalls()).toBe(0);
    expect(fixture.readBackCalls()).toBe(0);
  });

  it("keeps an intact checksum-stamped calendar eligible after a case-normalized IG MP4 hash match", async () => {
    const fixture = await uploadableShortFixture();

    await expect(
      uploadShort({
        date: "2026-08-18",
        slot: 2,
        root: fixture.root,
        env: fixture.env,
        fetchImpl: fixture.fetchImpl,
        now: new Date("2026-08-18T15:00:00.000Z")
      })
    ).resolves.toMatchObject({ video_id: "remote-short-2" });

    expect(fixture.uploadCalls()).toBe(1);
    expect(fixture.fetchCalls()).toBe(4);
    expect(fixture.scopeProbeCalls()).toBe(1);
    const scopeProbeRequest = fixture.scopeProbeRequest();
    expect(scopeProbeRequest).toMatchObject({ method: "GET", authorization: "Bearer test-token" });
    const scopeProbeUrl = new URL(scopeProbeRequest?.url ?? "https://invalid.example");
    expect(scopeProbeUrl.pathname).toBe("/youtube/v3/channels");
    expect(scopeProbeUrl.searchParams.get("part")).toBe("id");
    expect(scopeProbeUrl.searchParams.get("mine")).toBe("true");
    expect(scopeProbeUrl.searchParams.get("maxResults")).toBe("1");
    expect(fixture.readBackCalls()).toBe(1);
    const readBackRequest = fixture.readBackRequest();
    expect(readBackRequest).toMatchObject({ method: "GET", authorization: "Bearer test-token" });
    const readBackUrl = new URL(readBackRequest?.url ?? "https://invalid.example");
    expect(readBackUrl.pathname).toBe("/youtube/v3/videos");
    expect(readBackUrl.searchParams.get("part")).toBe("snippet,status");
    expect(readBackUrl.searchParams.get("id")).toBe("remote-short-2");
    await expect(
      readFile(join(fixture.root, "data", "youtube-log", "2026-08-18.json"), "utf8")
    ).resolves.toContain('"video_id": "remote-short-2"');
    const claim = await readRemoteClaim(fixture.root);
    const evidence = await readUploadEvidence(fixture.root);
    expect(claim.source.instagram_post_id).toBe("instagram-2");
    expect(claim.channel).toEqual({
      expected_channel_id: EXPECTED_YOUTUBE_CHANNEL_ID,
      authorized_channel_id: EXPECTED_YOUTUBE_CHANNEL_ID
    });
    expect(evidence).toMatchObject({
      claim_id: claim.claim_id,
      state: "completed",
      remote_video_id: "remote-short-2",
      read_back_verified: true,
      channel: {
        expected_channel_id: EXPECTED_YOUTUBE_CHANNEL_ID,
        authorized_channel_id: EXPECTED_YOUTUBE_CHANNEL_ID
      }
    });
  });

  it("fails closed on an absent canonical two-platform approval before OAuth, claim, or upload", async () => {
    const fixture = await uploadableShortFixture();
    await writeFile(join(fixture.root, "data", "approved-log", "2026-08-18.json"), "[]\n", "utf8");

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: fixture.fetchImpl })
    ).rejects.toThrow("slot 1 facebook requires exactly one approval tuple, found 0");

    expect(fixture.fetchCalls()).toBe(0);
    expect(fixture.uploadCalls()).toBe(0);
    await expect(readFile(remoteClaimPath(fixture.root), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed on a duplicate canonical approval tuple before OAuth, claim, or upload", async () => {
    const fixture = await uploadableShortFixture();
    const path = join(fixture.root, "data", "approved-log", "2026-08-18.json");
    const approvals = JSON.parse(await readFile(path, "utf8")) as Array<Record<string, unknown>>;
    approvals.push({ ...approvals[0] });
    await writeFile(path, `${JSON.stringify(approvals, null, 2)}\n`, "utf8");

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: fixture.fetchImpl })
    ).rejects.toThrow("slot 1 facebook requires exactly one approval tuple, found 2");

    expect(fixture.fetchCalls()).toBe(0);
    expect(fixture.uploadCalls()).toBe(0);
    await expect(readFile(remoteClaimPath(fixture.root), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed on a cross-date canonical approval tuple before OAuth, claim, or upload", async () => {
    const fixture = await uploadableShortFixture();
    const path = join(fixture.root, "data", "approved-log", "2026-08-18.json");
    const approvals = JSON.parse(await readFile(path, "utf8")) as Array<Record<string, unknown>>;
    approvals[0]!.date = "2026-08-17";
    await writeFile(path, `${JSON.stringify(approvals, null, 2)}\n`, "utf8");

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: fixture.fetchImpl })
    ).rejects.toThrow("slot 1 facebook has wrong approval date");

    expect(fixture.fetchCalls()).toBe(0);
    expect(fixture.uploadCalls()).toBe(0);
    await expect(readFile(remoteClaimPath(fixture.root), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed when the current Reel bytes no longer match the canonical review", async () => {
    const fixture = await uploadableShortFixture();
    await writeFile(join(fixture.root, "docs", "assets", "reel.mp4"), Buffer.from("swapped after review", "utf8"));

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: fixture.fetchImpl })
    ).rejects.toThrow("review/source binding failed: Reviewed video file changed after approval for slot 2");

    expect(fixture.fetchCalls()).toBe(0);
    expect(fixture.uploadCalls()).toBe(0);
    await expect(readFile(remoteClaimPath(fixture.root), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rereads canonical approval after the preclaim boundary before OAuth, claim, or upload", async () => {
    const fixture = await uploadableShortFixture();
    const fingerprintsPath = join(fixture.root, "data", "approved-log", "2026-08-18.fingerprints.json");

    await expect(
      uploadShort({
        date: "2026-08-18",
        slot: 2,
        root: fixture.root,
        env: fixture.env,
        fetchImpl: fixture.fetchImpl,
        beforeClaim: async () => {
          const fingerprints = JSON.parse(await readFile(fingerprintsPath, "utf8")) as Record<string, string>;
          fingerprints["2"] = "0".repeat(64);
          await writeFile(fingerprintsPath, `${JSON.stringify(fingerprints, null, 2)}\n`, "utf8");
        }
      })
    ).rejects.toThrow("slot 2 content changed after approval (fingerprint mismatch)");

    expect(fixture.fetchCalls()).toBe(0);
    expect(fixture.uploadCalls()).toBe(0);
    await expect(readFile(remoteClaimPath(fixture.root), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses verify-only as a local evidence reread that cannot mint a claim or upload", async () => {
    const fixture = await uploadableShortFixture();

    await expect(
      uploadShort({
        date: "2026-08-18",
        slot: 2,
        root: fixture.root,
        env: fixture.env,
        fetchImpl: fixture.fetchImpl,
        verifyOnly: true
      })
    ).rejects.toThrow("No immutable completed YouTube ledger entry exists");
    expect(fixture.fetchCalls()).toBe(0);
    await expect(readFile(remoteClaimPath(fixture.root), "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: fixture.fetchImpl })
    ).resolves.toMatchObject({ video_id: "remote-short-2" });
    const callsAfterUpload = fixture.fetchCalls();
    const noNetwork = vi.fn(async () => {
      throw new Error("verify-only must not call fetch");
    }) as unknown as typeof fetch;

    await expect(
      uploadShort({
        date: "2026-08-18",
        slot: 2,
        root: fixture.root,
        env: {},
        fetchImpl: noNetwork,
        verifyOnly: true
      })
    ).resolves.toEqual({ skipped: "verified completed YouTube Short for 2026-08-18 slot 2" });
    expect(noNetwork).not.toHaveBeenCalled();
    expect(fixture.fetchCalls()).toBe(callsAfterUpload);
    expect(fixture.uploadCalls()).toBe(1);
  });

  it("fails a freshly tampered calendar before OAuth refresh, immutable claim, or any YouTube request", async () => {
    const fixture = await uploadableShortFixture();
    await tamperCalendar(fixture.root);

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: fixture.fetchImpl })
    ).rejects.toThrow("current calendar failed canonical integrity/tamper inspection");

    expect(fixture.fetchCalls()).toBe(0);
    expect(fixture.uploadCalls()).toBe(0);
    expect(fixture.scopeProbeCalls()).toBe(0);
    expect(fixture.readBackCalls()).toBe(0);
    await expect(readFile(remoteClaimPath(fixture.root), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(uploadEvidencePath(fixture.root), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("treats a completed same-tuple ledger, claim, and evidence as an explicit data gap after calendar tampering", async () => {
    const fixture = await uploadableShortFixture();
    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: fixture.fetchImpl })
    ).resolves.toMatchObject({ video_id: "remote-short-2" });
    const fetchesBeforeTamperedRetry = fixture.fetchCalls();
    const uploadsBeforeTamperedRetry = fixture.uploadCalls();
    const claimBeforeTamperedRetry = await readRemoteClaim(fixture.root);
    const evidenceBeforeTamperedRetry = await readUploadEvidence(fixture.root);
    await tamperCalendar(fixture.root);

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: fixture.fetchImpl })
    ).rejects.toThrow("current calendar failed canonical integrity/tamper inspection");
    await expect(inspectReelShortReconciliation({ date: "2026-08-18", root: fixture.root })).rejects.toThrow(
      "calendar integrity is marked tampered; current local MP4 and metadata binding are unavailable"
    );

    expect(fixture.fetchCalls()).toBe(fetchesBeforeTamperedRetry);
    expect(fixture.uploadCalls()).toBe(uploadsBeforeTamperedRetry);
    expect(await readRemoteClaim(fixture.root)).toEqual(claimBeforeTamperedRetry);
    expect(await readUploadEvidence(fixture.root)).toEqual(evidenceBeforeTamperedRetry);
  });

  it("fails a duplicate same-tuple completed ledger before OAuth or reupload, and reconciliation reports a data gap", async () => {
    const fixture = await uploadableShortFixture();
    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: fixture.fetchImpl })
    ).resolves.toMatchObject({ video_id: "remote-short-2" });
    const fetchesBeforeDuplicateCheck = fixture.fetchCalls();
    const uploadsBeforeDuplicateCheck = fixture.uploadCalls();
    const claimBeforeDuplicateCheck = await readRemoteClaim(fixture.root);
    const evidenceBeforeDuplicateCheck = await readUploadEvidence(fixture.root);
    await appendDuplicateYouTubeLedgerEntry(fixture.root);

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: fixture.fetchImpl })
    ).rejects.toThrow("duplicate same-date same-slot ledger entries");
    await expect(inspectReelShortReconciliation({ date: "2026-08-18", root: fixture.root })).rejects.toThrow(
      "Unverified YouTube ledger entries for 2026-08-18 slots 2: duplicate same-date same-slot ledger entries; it is a data gap"
    );

    expect(fixture.fetchCalls()).toBe(fetchesBeforeDuplicateCheck);
    expect(fixture.uploadCalls()).toBe(uploadsBeforeDuplicateCheck);
    expect(await readRemoteClaim(fixture.root)).toEqual(claimBeforeDuplicateCheck);
    expect(await readUploadEvidence(fixture.root)).toEqual(evidenceBeforeDuplicateCheck);
  });

  it("rejects a duplicate ledger that appears after the initial empty read before OAuth, claim, or upload", async () => {
    const fixture = await uploadableShortFixture();

    await expect(
      uploadShort({
        date: "2026-08-18",
        slot: 2,
        root: fixture.root,
        env: fixture.env,
        fetchImpl: fixture.fetchImpl,
        beforeClaim: async () => {
          await writeFile(
            join(fixture.root, "data", "youtube-log", "2026-08-18.json"),
            JSON.stringify([upload(2), upload(2)]),
            "utf8"
          );
        }
      })
    ).rejects.toThrow("duplicate same-date same-slot ledger entries");

    expect(fixture.fetchCalls()).toBe(0);
    expect(fixture.uploadCalls()).toBe(0);
    expect(fixture.scopeProbeCalls()).toBe(0);
    expect(fixture.readBackCalls()).toBe(0);
    await expect(readFile(remoteClaimPath(fixture.root), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails an old ledger closed as a data gap and never treats it as already uploaded or re-POSTs", async () => {
    const fixture = await uploadableShortFixture();
    await writeFile(
      join(fixture.root, "data", "youtube-log", "2026-08-18.json"),
      JSON.stringify([upload(2, { video_id: "legacy-short-2" })]),
      "utf8"
    );

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: fixture.fetchImpl })
    ).rejects.toThrow("lacks immutable verified completion proof");
    expect(fixture.uploadCalls()).toBe(0);
    expect(fixture.scopeProbeCalls()).toBe(0);
    await expect(inspectReelShortReconciliation({ date: "2026-08-18", root: fixture.root })).rejects.toThrow(
      "it is a data gap, not an uploaded Short"
    );
  });

  it("accepts a current completed immutable claim and read-back evidence bound to the canonical channel", async () => {
    const fixture = await uploadableShortFixture();

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: fixture.fetchImpl })
    ).resolves.toMatchObject({ video_id: "remote-short-2" });

    await expect(inspectReelShortReconciliation({ date: "2026-08-18", root: fixture.root })).resolves.toEqual({
      expected_reel_slots: [2],
      uploaded_reel_slots: [2],
      missing_reel_slots: [],
      unexpected_youtube_slots: [],
      unverified_youtube_slots: []
    });
  });

  it.each([
    ["channel-less immutable claim", "claim", undefined, "immutable claim is not bound to the canonical business YouTube channel"],
    [
      "wrong immutable claim channel",
      "claim",
      { expected_channel_id: "UCwrong-owner-channel-0000", authorized_channel_id: "UCwrong-owner-channel-0000" },
      "immutable claim is not bound to the canonical business YouTube channel"
    ],
    [
      "channel-less completion evidence",
      "evidence",
      undefined,
      "completed read-back evidence is missing or does not bind this ledger video id and canonical business channel"
    ],
    [
      "wrong completion evidence channel",
      "evidence",
      { expected_channel_id: "UCwrong-owner-channel-0000", authorized_channel_id: "UCwrong-owner-channel-0000" },
      "completed read-back evidence is missing or does not bind this ledger video id and canonical business channel"
    ],
    [
      "whitespace-padded completion evidence channel",
      "evidence",
      {
        expected_channel_id: ` ${EXPECTED_YOUTUBE_CHANNEL_ID}`,
        authorized_channel_id: EXPECTED_YOUTUBE_CHANNEL_ID
      },
      "completed read-back evidence is missing or does not bind this ledger video id and canonical business channel"
    ]
  ])("red-flags a %s instead of counting the ledger as uploaded", async (_kind, target, channel, reason) => {
    const fixture = await uploadableShortFixture();
    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: fixture.fetchImpl })
    ).resolves.toMatchObject({ video_id: "remote-short-2" });

    const path = target === "claim" ? remoteClaimPath(fixture.root) : uploadEvidencePath(fixture.root);
    const proof = JSON.parse(await readFile(path, "utf8")) as { channel?: unknown };
    if (channel === undefined) {
      Reflect.deleteProperty(proof, "channel");
    } else {
      proof.channel = channel;
    }
    await writeFile(path, `${JSON.stringify(proof, null, 2)}\n`, "utf8");

    await expect(inspectReelShortReconciliation({ date: "2026-08-18", root: fixture.root })).rejects.toThrow(reason);
    expect(fixture.uploadCalls()).toBe(1);
  });

  it("fails upload-only read scope before creating a claim or sending the upload POST", async () => {
    const fixture = await uploadableShortFixture();
    let scopeProbes = 0;
    const uploadOnly = (async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("/youtube/v3/channels")) {
        scopeProbes += 1;
        return new Response(JSON.stringify({ error: { message: "insufficientPermissions" } }), { status: 403 });
      }
      return fixture.fetchImpl(url, init);
    }) as unknown as typeof fetch;

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: uploadOnly })
    ).rejects.toThrow("YouTube read-scope preflight response (403)");
    expect(scopeProbes).toBe(1);
    expect(fixture.uploadCalls()).toBe(0);
    await expect(readFile(remoteClaimPath(fixture.root), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(uploadEvidencePath(fixture.root), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails a wrong authorized YouTube channel before creating a claim or sending the upload POST", async () => {
    const fixture = await uploadableShortFixture();
    let scopeProbes = 0;
    const wrongChannel = (async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("/youtube/v3/channels")) {
        scopeProbes += 1;
        return new Response(JSON.stringify({ items: [{ id: "UCwrong-owner-channel-0000" }] }), { status: 200 });
      }
      return fixture.fetchImpl(url, init);
    }) as unknown as typeof fetch;

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: wrongChannel })
    ).rejects.toThrow(`did not include canonical business channel ${EXPECTED_YOUTUBE_CHANNEL_ID}`);
    expect(scopeProbes).toBe(1);
    expect(fixture.uploadCalls()).toBe(0);
    await expect(readFile(remoteClaimPath(fixture.root), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(uploadEvidencePath(fixture.root), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not burn a date-slot claim when preclaim evidence persistence fails", async () => {
    const fixture = await uploadableShortFixture();
    const writer: typeof writeJsonAtomic = async (path, value) => {
      if (path.includes("youtube-upload-preflights")) throw new Error("simulated preclaim evidence failure");
      await writeJsonAtomic(path, value);
    };

    await expect(
      uploadShort({
        date: "2026-08-18",
        slot: 2,
        root: fixture.root,
        env: fixture.env,
        fetchImpl: fixture.fetchImpl,
        writeJson: writer
      })
    ).rejects.toThrow("simulated preclaim evidence failure");
    expect(fixture.scopeProbeCalls()).toBe(1);
    expect(fixture.uploadCalls()).toBe(0);
    await expect(readFile(remoteClaimPath(fixture.root), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retains the intent when a successful YouTube response has no usable video id", async () => {
    const fixture = await uploadableShortFixture();
    let remoteCalls = 0;
    const incompleteSuccess = (async (url: string | URL) => {
      const target = String(url);
      if (target.includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "test-token" }), { status: 200 });
      }
      const scopeProbe = successfulOwnerChannelScopeProbe(target);
      if (scopeProbe) return scopeProbe;
      remoteCalls += 1;
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: incompleteSuccess })
    ).rejects.toThrow("success without a video id");
    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: incompleteSuccess })
    ).rejects.toThrow("automatic retry is blocked pending recovery");
    expect(remoteCalls).toBe(1);
  });

  it.each([
    ["numeric", 123],
    ["object", { value: "remote-short-2" }],
    ["blank whitespace", "   "]
  ])("retains the intent and writes no ledger for a %s upload id", async (_kind, id) => {
    const fixture = await uploadableShortFixture();
    let remoteCalls = 0;
    const malformedId = (async (url: string | URL) => {
      const target = String(url);
      if (target.includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "test-token" }), { status: 200 });
      }
      const scopeProbe = successfulOwnerChannelScopeProbe(target);
      if (scopeProbe) return scopeProbe;
      remoteCalls += 1;
      return new Response(JSON.stringify({ id }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: malformedId })
    ).rejects.toThrow("success without a video id");
    await expect(
      readFile(join(fixture.root, "data", "youtube-log", "2026-08-18.json"), "utf8")
    ).resolves.toBe("[]");
    const claim = await readRemoteClaim(fixture.root);
    const evidence = await readUploadEvidence(fixture.root);
    expect(claim.claim_id).toBe(evidence.claim_id);
    expect(evidence).toMatchObject({ state: "remote_response_uncertain" });
    expect(evidence).not.toHaveProperty("remote_video_id");

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: malformedId })
    ).rejects.toThrow("automatic retry is blocked pending recovery");
    expect(remoteCalls).toBe(1);
  });

  it("trims a non-empty upload id before binding it to the read-back and ledger", async () => {
    const fixture = await uploadableShortFixture();
    const metadata = buildShortMetadata({
      topic: "驗收中的 Reel",
      caption: "caption",
      date: "2026-08-18",
      slot: 2
    });
    let uploadCalls = 0;
    let readBackCalls = 0;
    const paddedId = (async (url: string | URL) => {
      const target = String(url);
      if (target.includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "test-token" }), { status: 200 });
      }
      const scopeProbe = successfulOwnerChannelScopeProbe(target);
      if (scopeProbe) return scopeProbe;
      if (target.includes("/upload/youtube/v3/videos")) {
        uploadCalls += 1;
        return new Response(JSON.stringify({ id: "  remote-short-2  " }), { status: 200 });
      }
      readBackCalls += 1;
      return new Response(
        JSON.stringify({
          items: [{
            id: "remote-short-2",
            snippet: { ...metadata, channelId: EXPECTED_YOUTUBE_CHANNEL_ID },
            status: { privacyStatus: "public" }
          }]
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: paddedId })
    ).resolves.toMatchObject({ video_id: "remote-short-2" });
    expect(uploadCalls).toBe(1);
    expect(readBackCalls).toBe(1);
  });

  it("retains uncertain evidence and writes no completed ledger when read-back video belongs to another channel", async () => {
    const fixture = await uploadableShortFixture();
    const metadata = buildShortMetadata({
      topic: "驗收中的 Reel",
      caption: "caption",
      date: "2026-08-18",
      slot: 2
    });
    let uploadCalls = 0;
    let readBackCalls = 0;
    const wrongVideoChannel = (async (url: string | URL) => {
      const target = String(url);
      if (target.includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "test-token" }), { status: 200 });
      }
      const scopeProbe = successfulOwnerChannelScopeProbe(target);
      if (scopeProbe) return scopeProbe;
      if (target.includes("/upload/youtube/v3/videos")) {
        uploadCalls += 1;
        return new Response(JSON.stringify({ id: "remote-short-2" }), { status: 200 });
      }
      readBackCalls += 1;
      return new Response(
        JSON.stringify({
          items: [{
            id: "remote-short-2",
            snippet: { ...metadata, channelId: "UCwrong-owner-channel-0000" },
            status: { privacyStatus: "public" }
          }]
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: wrongVideoChannel })
    ).rejects.toThrow("YouTube read-back channel does not match canonical business channel");
    expect(uploadCalls).toBe(1);
    expect(readBackCalls).toBe(1);
    await expect(
      readFile(join(fixture.root, "data", "youtube-log", "2026-08-18.json"), "utf8")
    ).resolves.toBe("[]");
    const claim = await readRemoteClaim(fixture.root);
    const evidence = await readUploadEvidence(fixture.root);
    expect(evidence).toMatchObject({
      claim_id: claim.claim_id,
      state: "remote_accepted_log_failed",
      remote_video_id: "remote-short-2"
    });
  });

  it.each([
    ["absent", { items: [] }, "did not return uploaded video"],
    [
      "metadata-mismatched",
      {
        items: [
          {
            id: "remote-short-2",
            snippet: { title: "wrong title", description: "caption" },
            status: { privacyStatus: "public" }
          }
        ]
      },
      "metadata or public visibility does not match"
    ],
    [
      "not-public",
      {
        items: [
          {
            id: "remote-short-2",
            snippet: buildShortMetadata({
              topic: "驗收中的 Reel",
              caption: "caption",
              date: "2026-08-18",
              slot: 2
            }),
            status: { privacyStatus: "private" }
          }
        ]
      },
      "metadata or public visibility does not match"
    ]
  ])("retains the remote id and no ledger when read-back is %s", async (_kind, readBackPayload, message) => {
    const fixture = await uploadableShortFixture();
    let uploadCalls = 0;
    let readBackCalls = 0;
    const readBackFailure = (async (url: string | URL) => {
      const target = String(url);
      if (target.includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "test-token" }), { status: 200 });
      }
      const scopeProbe = successfulOwnerChannelScopeProbe(target);
      if (scopeProbe) return scopeProbe;
      if (target.includes("/upload/youtube/v3/videos")) {
        uploadCalls += 1;
        return new Response(JSON.stringify({ id: "remote-short-2" }), { status: 200 });
      }
      readBackCalls += 1;
      return new Response(JSON.stringify(readBackPayload), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: readBackFailure })
    ).rejects.toThrow(message);
    expect(uploadCalls).toBe(1);
    expect(readBackCalls).toBe(1);
    await expect(
      readFile(join(fixture.root, "data", "youtube-log", "2026-08-18.json"), "utf8")
    ).resolves.toBe("[]");
    const claim = await readRemoteClaim(fixture.root);
    const evidence = await readUploadEvidence(fixture.root);
    expect(evidence).toMatchObject({
      claim_id: claim.claim_id,
      state: "remote_accepted_log_failed",
      remote_video_id: "remote-short-2"
    });

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: readBackFailure })
    ).rejects.toThrow("automatic retry is blocked pending recovery");
    expect(uploadCalls).toBe(1);
  });

  it("records the remote id when the A/B plan lookup fails after upload", async () => {
    const fixture = await uploadableShortFixture();
    const failedAbPlan = async () => {
      throw new Error("simulated A/B plan lookup failure");
    };

    await expect(
      uploadShort({
        date: "2026-08-18",
        slot: 2,
        root: fixture.root,
        env: fixture.env,
        fetchImpl: fixture.fetchImpl,
        loadAbTestPlan: failedAbPlan
      })
    ).rejects.toThrow("post-acceptance verification or local ledger commit failed");
    expect(fixture.uploadCalls()).toBe(1);
    expect(fixture.readBackCalls()).toBe(0);
    const claim = await readRemoteClaim(fixture.root);
    const evidence = await readUploadEvidence(fixture.root);
    expect(evidence).toMatchObject({
      claim_id: claim.claim_id,
      state: "remote_accepted_log_failed",
      remote_video_id: "remote-short-2",
      error: "simulated A/B plan lookup failure"
    });
    await expect(
      uploadShort({
        date: "2026-08-18",
        slot: 2,
        root: fixture.root,
        env: fixture.env,
        fetchImpl: fixture.fetchImpl,
        loadAbTestPlan: failedAbPlan
      })
    ).rejects.toThrow("automatic retry is blocked pending recovery");
    expect(fixture.uploadCalls()).toBe(1);
  });

  it("retains the intent for every non-2xx response, including a 400", async () => {
    const fixture = await uploadableShortFixture();
    let remoteCalls = 0;
    const rejected = (async (url: string | URL) => {
      const target = String(url);
      if (target.includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "test-token" }), { status: 200 });
      }
      const scopeProbe = successfulOwnerChannelScopeProbe(target);
      if (scopeProbe) return scopeProbe;
      remoteCalls += 1;
      return new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 });
    }) as unknown as typeof fetch;

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: rejected })
    ).rejects.toThrow("YouTube upload response (400: bad request) is uncertain");
    const claim = await readRemoteClaim(fixture.root);
    const evidence = await readUploadEvidence(fixture.root);
    expect(evidence).toMatchObject({ claim_id: claim.claim_id, state: "remote_response_uncertain" });
    expect(evidence).not.toHaveProperty("remote_video_id");

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: rejected })
    ).rejects.toThrow("automatic retry is blocked pending recovery");
    expect(remoteCalls).toBe(1);
  });

  it("rechecks the ledger after claiming an intent and closes the stale-read race without a second POST", async () => {
    const fixture = await uploadableShortFixture();
    let releaseSecond!: () => void;
    let secondReachedClaim!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const secondAtClaim = new Promise<void>((resolve) => {
      secondReachedClaim = resolve;
    });

    const second = uploadShort({
      date: "2026-08-18",
      slot: 2,
      root: fixture.root,
      env: fixture.env,
      fetchImpl: fixture.fetchImpl,
      beforeClaim: async () => {
        secondReachedClaim();
        await secondGate;
      }
    });
    await secondAtClaim;
    await expect(
      uploadShort({
        date: "2026-08-18",
        slot: 2,
        root: fixture.root,
        env: fixture.env,
        fetchImpl: fixture.fetchImpl
      })
    ).resolves.toMatchObject({ video_id: "remote-short-2" });
    releaseSecond();
    await expect(second).resolves.toEqual({ skipped: "already uploaded for 2026-08-18 slot 2" });
    expect(fixture.uploadCalls()).toBe(1);
  });

  it("fails closed when an intent file contains a different date", async () => {
    const fixture = await uploadableShortFixture();
    await mkdir(join(fixture.root, "data", "youtube-upload-intents"), { recursive: true });
    await writeFile(
      join(fixture.root, "data", "youtube-upload-intents", "2026-08-18.json"),
      JSON.stringify([
        {
          date: "2026-08-17",
          slot: 2,
          state: "pending_remote_commit",
          created_at: "2026-08-18T15:00:00.000Z"
        }
      ]),
      "utf8"
    );

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: fixture.fetchImpl })
    ).rejects.toThrow("Legacy date-scoped youtube-upload-intents for 2026-08-18 is malformed");
    expect(fixture.uploadCalls()).toBe(0);
  });

  it("fails closed on a matching legacy date-array intent without creating a per-slot remote claim", async () => {
    const fixture = await uploadableShortFixture();
    const intentDir = join(fixture.root, "data", "youtube-upload-intents");
    await mkdir(intentDir, { recursive: true });
    await writeFile(
      join(intentDir, "2026-08-18.json"),
      JSON.stringify([
        {
          date: "2026-08-18",
          slot: 2,
          state: "pending_remote_commit",
          created_at: "2026-08-18T15:00:00.000Z"
        }
      ]),
      "utf8"
    );

    await expect(
      uploadShort({
        date: "2026-08-18",
        slot: 2,
        root: fixture.root,
        env: fixture.env,
        fetchImpl: fixture.fetchImpl
      })
    ).rejects.toThrow("Legacy date-scoped YouTube intent exists");

    expect(fixture.uploadCalls()).toBe(0);
    await expect(readFile(remoteClaimPath(fixture.root), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses one immutable same-slot claim across concurrent and restarted callers", async () => {
    const fixture = await uploadableShortFixture();
    const attempts = await Promise.allSettled([
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: fixture.fetchImpl }),
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: fixture.fetchImpl })
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect(fixture.uploadCalls()).toBe(1);
    const claim = await readRemoteClaim(fixture.root);
    expect(claim.source).toMatchObject({ instagram_post_id: "instagram-2" });
    expect((await readUploadEvidence(fixture.root)).state).toBe("completed");

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: fixture.fetchImpl })
    ).resolves.toEqual({ skipped: "already uploaded for 2026-08-18 slot 2" });
    expect(fixture.uploadCalls()).toBe(1);
  });

  it("allows different slots on the same date to claim and attempt independently", async () => {
    const fixture = await uploadableShortFixture();
    const video = await readFile(join(fixture.root, "docs", "assets", "reel.mp4"));
    const videoSha256 = createHash("sha256").update(video).digest("hex");
    await writeFile(
      join(fixture.root, "data", "posted-log", "2026-08-18.json"),
      JSON.stringify([
        post(2, { video_sha256: videoSha256 }),
        post(3, { video_sha256: videoSha256 })
      ]),
      "utf8"
    );
    await writeDailyContent(
      {
        date: "2026-08-18",
        timezone: "Asia/Taipei",
        generated_at: "2026-08-18T06:00:00.000Z",
        slots: [
          { ...reelSlot(1), media_type: "image", local_video_path: undefined, public_video_url: undefined },
          reelSlot(2),
          reelSlot(3)
        ]
      },
      fixture.root
    );
    await seedCanonicalYouTubePublicationApproval(fixture.root);
    let remotePosts = 0;
    const rejected = (async (url: string | URL) => {
      const target = String(url);
      if (target.includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "test-token" }), { status: 200 });
      }
      const scopeProbe = successfulOwnerChannelScopeProbe(target);
      if (scopeProbe) return scopeProbe;
      remotePosts += 1;
      return new Response(JSON.stringify({ error: { message: "test rejection" } }), { status: 400 });
    }) as unknown as typeof fetch;

    await expect(
      uploadShort({ date: "2026-08-18", slot: 2, root: fixture.root, env: fixture.env, fetchImpl: rejected })
    ).rejects.toThrow("YouTube upload response (400: test rejection) is uncertain");
    await expect(
      uploadShort({ date: "2026-08-18", slot: 3, root: fixture.root, env: fixture.env, fetchImpl: rejected })
    ).rejects.toThrow("YouTube upload response (400: test rejection) is uncertain");
    expect(remotePosts).toBe(2);
    await expect(readRemoteClaim(fixture.root, 2)).resolves.toMatchObject({ slot: 2 });
    await expect(readRemoteClaim(fixture.root, 3)).resolves.toMatchObject({ slot: 3 });
  });

  it("preserves legacy stale-lock reclamation for non-YouTube JSON callers", async () => {
    const root = await mkdtemp(join(tmpdir(), "legacy-json-lock-"));
    roots.push(root);
    const path = join(root, "data", "legacy.json");
    const lockPath = `${path}.lock`;
    await mkdir(join(root, "data"), { recursive: true });
    const exited = spawn(process.execPath, ["-e", "process.exit(0)"]);
    const exitedPid = exited.pid;
    if (!exitedPid) throw new Error("fixture child did not receive a PID");
    await once(exited, "exit");
    await writeFile(lockPath, `${exitedPid} 2026-08-19T00:00:00.000Z\n`, "utf8");
    const old = new Date(Date.now() - 2_000);
    await utimes(lockPath, old, old);

    let entered = false;
    await withJsonFileLock(
      path,
      async () => {
        entered = true;
      },
      { staleMs: 1, timeoutMs: 25 }
    );

    expect(entered).toBe(true);
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("marks a future Reel blocked unless the actual publish gate passes", async () => {
    const validateReel = vi.fn(async () => {
      throw new Error("Dual video review is missing for slot 3.");
    });

    const readiness = await assessPlannedReelReadiness({
      date: "2026-08-19",
      root: "C:/isolated-fixture",
      slots: [reelSlot()],
      validateReel
    });

    expect(readiness).toEqual({
      status: "blocked",
      required_reel_slots: [3],
      ready_reel_slots: [],
      blocked_reels: [{ slot: 3, reason: "Dual video review is missing for slot 3." }]
    });
    expect(validateReel).toHaveBeenCalledTimes(1);
  });

  it("does not call a planned Reel ready when visual QA is warning-only or failed", async () => {
    const validateReel = vi.fn(async () => undefined);
    const inspectVisualQa = vi.fn(async () => ({
      ok: false,
      mode: "warn" as const,
      reason: "missing visual-qa sidecar for slot 3",
      sidecar_path: "C:/isolated-fixture/docs/assets/reel.mp4.visual-qa.json"
    }));

    const readiness = await assessPlannedReelReadiness({
      date: "2026-08-19",
      root: "C:/isolated-fixture",
      slots: [reelSlot()],
      validateReel,
      inspectVisualQa
    });

    expect(readiness).toEqual({
      status: "blocked",
      required_reel_slots: [3],
      ready_reel_slots: [],
      blocked_reels: [
        { slot: 3, reason: "Visual QA gate is not passed for slot 3: missing visual-qa sidecar for slot 3" }
      ]
    });
    expect(inspectVisualQa).toHaveBeenCalledWith({
      date: "2026-08-19",
      slot: 3,
      videoPath: "docs/assets/reel.mp4",
      root: "C:/isolated-fixture"
    });
  });

  it("blocks planned Reel readiness before media or visual QA when its calendar is tampered", async () => {
    const fixture = await uploadableShortFixture();
    await tamperCalendar(fixture.root);

    await expect(inspectPlannedReelReadiness({ date: "2026-08-18", root: fixture.root })).resolves.toEqual({
      status: "blocked",
      required_reel_slots: [2],
      ready_reel_slots: [],
      blocked_reels: [
        {
          slot: 2,
          reason: "calendar integrity is marked tampered; planned Reel readiness is blocked before media and visual QA"
        }
      ]
    });
    expect(fixture.fetchCalls()).toBe(0);
  });
});
