import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveAbTestPlan } from "../src/abTestPlan";
import { buildAbTestReport } from "../src/abTestReport";
import { writeDailyContent, writePostLog } from "../src/logging";
import type { DailySlot, PostLogEntry } from "../src/types";

const roots: string[] = [];
const DATE = "2026-08-18";
const VIDEO_SHA = "a".repeat(64);
const YOUTUBE_CHANNEL_ID = "UCcVDFN7Ve-cD9duxRdM5VXQ";
const WRONG_YOUTUBE_CHANNEL_ID = "UCdQzGsKV8R_aQrrpW2y5D_w";
const VERIFIED_VIDEO_BYTES = Buffer.from("ab-report-verified-video", "utf8");
const VERIFIED_VIDEO_SHA = createHash("sha256").update(VERIFIED_VIDEO_BYTES).digest("hex");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function reportFixture(
  youtubeLog: unknown,
  options: {
    posts?: PostLogEntry[];
    rawPosts?: unknown;
    livePosts?: boolean;
    insights?: boolean;
    prepareRoot?: (root: string) => Promise<void>;
  } = {}
): Promise<Awaited<ReturnType<typeof buildAbTestReport>>> {
  const root = await mkdtemp(join(tmpdir(), "ab-report-youtube-"));
  roots.push(root);
  await saveAbTestPlan(
    [
      {
        date: DATE,
        noon: { conceptId: "noon-concept", variant: "10s" },
        evening: { conceptId: "evening-concept", variant: "15s" }
      }
    ],
    root
  );
  if (options.rawPosts !== undefined) {
    await mkdir(join(root, "data", "posted-log"), { recursive: true });
    await writeFile(
      join(root, "data", "posted-log", `${DATE}.json`),
      JSON.stringify(options.rawPosts),
      "utf8"
    );
  } else {
    await writePostLog(
      DATE,
      options.posts ?? (options.livePosts === false ? [] : [...qualifiedPair(3, "10s"), ...qualifiedPair(2, "15s")]),
      root
    );
  }
  if (options.insights) {
    await mkdir(join(root, "data", "insights", "instagram"), { recursive: true });
    await writeFile(
      join(root, "data", "insights", "instagram", "daily.json"),
      JSON.stringify({
        rows: [
          { date: DATE, slot: 3, metrics: { reach: 10, views: 20, total_interactions: 3 } },
          { date: DATE, slot: 2, metrics: { reach: 11, views: 21, total_interactions: 4 } }
        ]
      }),
      "utf8"
    );
  }
  await mkdir(join(root, "data", "youtube-log"), { recursive: true });
  await writeFile(join(root, "data", "youtube-log", `${DATE}.json`), JSON.stringify(youtubeLog), "utf8");
  await options.prepareRoot?.(root);
  return buildAbTestReport({ root, asOf: DATE });
}

function imageSlot(slot: number): DailySlot {
  return {
    slot,
    time: slot === 1 ? "11:30" : slot === 2 ? "20:30" : "12:00",
    category: "知識文",
    topic: `A/B fixture slot ${slot}`,
    media_type: "image",
    instagram_caption: "caption",
    facebook_caption: "caption",
    image_prompt: "image prompt",
    local_image_path: `docs/assets/${DATE}/slot-${String(slot).padStart(2, "0")}.png`,
    public_image_url: `https://example.com/assets/${DATE}/slot-${String(slot).padStart(2, "0")}.png`,
    visual_route: "shop-inspection",
    traffic_route: "object-proof",
    status: "pending"
  };
}

/** Writes only local evidence files; no OAuth, remote call, or upload occurs in this fixture. */
async function writeVerifiedYouTubeCompletion(
  root: string,
  input: {
    slot?: number;
    videoId?: string;
    profileChannelId?: string | null;
    claimChannelId?: string;
    evidenceChannelId?: string;
    writeClaim?: boolean;
    writeEvidence?: boolean;
    tamperCalendar?: boolean;
  } = {}
): Promise<void> {
  const slot = input.slot ?? 3;
  const videoId = input.videoId ?? "short-noon";
  const profileChannelId = input.profileChannelId === undefined ? YOUTUBE_CHANNEL_ID : input.profileChannelId;
  const claimChannelId = input.claimChannelId ?? YOUTUBE_CHANNEL_ID;
  const evidenceChannelId = input.evidenceChannelId ?? YOUTUBE_CHANNEL_ID;
  const localVideoPath = `docs/assets/${DATE}/slot-${String(slot).padStart(2, "0")}.mp4`;
  const claimId = `claim-${DATE}-slot-${slot}`;
  const localVideoFile = join(root, ...localVideoPath.split("/"));

  await mkdir(join(root, "docs", "assets", DATE), { recursive: true });
  await writeFile(localVideoFile, VERIFIED_VIDEO_BYTES);
  await writeDailyContent(
    {
      date: DATE,
      timezone: "Asia/Taipei",
      generated_at: "2026-08-18T06:00:00.000Z",
      slots: [1, 2, 3].map((candidate) =>
        candidate === slot
          ? {
              ...imageSlot(candidate),
              media_type: "reel",
              local_video_path: localVideoPath,
              public_video_url: `https://example.com/assets/${DATE}/slot-${String(slot).padStart(2, "0")}.mp4`,
              video_prompt: "one verified action"
            }
          : imageSlot(candidate)
      )
    },
    root
  );
  if (input.tamperCalendar) {
    const calendarPath = join(root, "data", "content-calendar", `${DATE}.json`);
    const calendar = JSON.parse(await readFile(calendarPath, "utf8")) as Record<string, unknown>;
    await writeFile(calendarPath, JSON.stringify({ ...calendar, written_by: "external-calendar-writer" }), "utf8");
  }
  if (profileChannelId) {
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(
      join(root, "data", "business-profile.json"),
      JSON.stringify({ youtube_url: `https://www.youtube.com/channel/${profileChannelId}` }),
      "utf8"
    );
  }
  if (input.writeClaim !== false) {
    const path = join(root, "data", "youtube-upload-claims", DATE, `slot-${String(slot).padStart(2, "0")}.json`);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        date: DATE,
        slot,
        claim_id: claimId,
        claimed_at: "2026-08-18T12:00:00.000Z",
        source: {
          local_video_path: localVideoPath,
          local_video_sha256: VERIFIED_VIDEO_SHA,
          instagram_video_sha256: VERIFIED_VIDEO_SHA,
          instagram_post_id: `instagram-${slot}`
        },
        channel: {
          expected_channel_id: claimChannelId,
          authorized_channel_id: claimChannelId
        }
      }),
      "utf8"
    );
  }
  if (input.writeEvidence !== false) {
    const path = join(root, "data", "youtube-upload-evidence", DATE, `slot-${String(slot).padStart(2, "0")}.json`);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        date: DATE,
        slot,
        claim_id: claimId,
        state: "completed",
        recorded_at: "2026-08-18T15:00:00.000Z",
        remote_video_id: videoId,
        read_back_verified: true,
        channel: {
          expected_channel_id: evidenceChannelId,
          authorized_channel_id: evidenceChannelId
        }
      }),
      "utf8"
    );
  }
}

function qualifiedReelPost(
  platform: "facebook" | "instagram",
  slot: number,
  variant: "10s" | "15s",
  overrides: Partial<PostLogEntry> = {}
): PostLogEntry {
  const postId = `${platform}-${slot}`;
  return {
    date: DATE,
    slot,
    platform,
    status: "success",
    dry_run: false,
    attempts: 1,
    published_media_type: "reel",
    video_status: "published",
    video_sha256: VIDEO_SHA,
    ab_variant: variant,
    post_id: postId,
    remote_reel_evidence: {
      remote_id: postId,
      permalink:
        platform === "facebook"
          ? `https://www.facebook.com/reel/${postId}`
          : `https://www.instagram.com/reel/${postId}/`,
      verified_at: "2026-08-18T12:00:00.000Z",
      remote_media_type: "REELS",
      caption_exact_match: true
    },
    created_at: "2026-08-18T12:00:00.000Z",
    ...overrides
  };
}

function qualifiedPair(slot: number, variant: "10s" | "15s"): PostLogEntry[] {
  return [qualifiedReelPost("facebook", slot, variant), qualifiedReelPost("instagram", slot, variant)];
}

function expectNoVariantSamples(report: Awaited<ReturnType<typeof buildAbTestReport>>): void {
  for (const variant of ["10s", "15s", "unattributed"] as const) {
    expect(report.variants[variant].posts).toBe(0);
    expect(report.variants[variant].reach).toBeNull();
    expect(report.variants[variant].views).toBeNull();
    expect(report.variants[variant].interactions).toBeNull();
    expect(report.variants[variant].samples).toEqual({ reach: 0, views: 0, interactions: 0 });
  }
}

function expectInvalidPostedLogReport(report: Awaited<ReturnType<typeof buildAbTestReport>>): void {
  expectNoVariantSamples(report);
  expect(report.rows.map((row) => [row.reach, row.views, row.interactions])).toEqual([
    [null, null, null],
    [null, null, null]
  ]);
  expect(report.data_gaps.some((gap) => gap.includes(`${DATE}: posted-log is invalid`))).toBe(true);
  expect(report.data_gaps.filter((gap) => gap.includes("posted-log is invalid; this row is excluded"))).toHaveLength(2);
}

describe("A/B report YouTube evidence", () => {
  it("counts a schema-valid, verified dual-platform Reel as a delivery sample", async () => {
    const report = await reportFixture([], { posts: qualifiedPair(3, "10s"), insights: true });

    expect(report.variants["10s"]).toMatchObject({
      posts: 1,
      reach: 10,
      views: 20,
      interactions: 3,
      samples: { reach: 1, views: 1, interactions: 1 }
    });
  });

  it.each([
    [
      "one platform missing ab_variant",
      () => [
        qualifiedReelPost("facebook", 3, "10s"),
        qualifiedReelPost("instagram", 3, "10s", { ab_variant: undefined })
      ],
      "missing ab_variant"
    ],
    [
      "platforms with mixed ab_variant values",
      () => [qualifiedReelPost("facebook", 3, "10s"), qualifiedReelPost("instagram", 3, "15s")],
      "mixed ab_variant"
    ]
  ])("keeps %s out of 10s/15s comparison", async (_reason, posts, expectedGap) => {
    const report = await reportFixture([], { posts: posts(), insights: true });
    const noonRow = report.rows.find((row) => row.slot === 3);

    expect(noonRow?.variant).toBe("unattributed");
    expect(report.variants["10s"].posts).toBe(0);
    expect(report.variants["15s"].posts).toBe(0);
    expect(report.variants.unattributed.posts).toBe(1);
    expect(report.comparison.reach_ratio_15s_over_10s).toBeNull();
    expect(report.data_gaps.some((gap) => gap.includes(expectedGap) && gap.includes("unattributed"))).toBe(true);
  });

  it("counts only a fully verified same-date, same-slot YouTube completion", async () => {
    const report = await reportFixture([
      {
        date: DATE,
        slot: 3,
        video_id: "short-noon",
        title: "Noon Short",
        uploaded_at: "2026-08-18T04:05:00.000Z"
      }
    ], {
      posts: qualifiedPair(3, "10s").map((entry) => ({ ...entry, video_sha256: VERIFIED_VIDEO_SHA })),
      prepareRoot: (root) => writeVerifiedYouTubeCompletion(root)
    });

    expect(report.rows.find((row) => row.slot === 3)?.youtube_uploaded).toBe(true);
    expect(report.rows.find((row) => row.slot === 2)?.youtube_uploaded).toBe(false);
    expect(report.variants["10s"].posts).toBe(1);
  });

  it("rejects duplicate same-slot ledger rows rather than selecting a convenient video id", async () => {
    const report = await reportFixture(
      [
        {
          date: DATE,
          slot: 3,
          video_id: "short-noon",
          title: "Noon Short",
          uploaded_at: "2026-08-18T04:05:00.000Z"
        },
        {
          date: DATE,
          slot: 3,
          video_id: "duplicate-short",
          title: "Duplicate Short",
          uploaded_at: "2026-08-18T04:06:00.000Z"
        }
      ],
      {
        posts: qualifiedPair(3, "10s").map((entry) => ({ ...entry, video_sha256: VERIFIED_VIDEO_SHA })),
        prepareRoot: (root) => writeVerifiedYouTubeCompletion(root)
      }
    );

    expect(report.rows.find((row) => row.slot === 3)?.youtube_uploaded).toBe(false);
    expect(report.data_gaps.some((gap) => gap.includes("same-date YouTube ledger records make completion ambiguous"))).toBe(true);
  });

  it("rejects a legacy bare ledger row even with a locally bound source Reel", async () => {
    const report = await reportFixture(
      [
        {
          date: DATE,
          slot: 3,
          video_id: "short-noon",
          title: "Noon Short",
          uploaded_at: "2026-08-18T04:05:00.000Z"
        }
      ],
      {
        posts: qualifiedPair(3, "10s").map((entry) => ({ ...entry, video_sha256: VERIFIED_VIDEO_SHA })),
        prepareRoot: (root) => writeVerifiedYouTubeCompletion(root, { writeClaim: false, writeEvidence: false })
      }
    );

    expect(report.rows.find((row) => row.slot === 3)?.youtube_uploaded).toBe(false);
    expect(report.data_gaps.some((gap) => gap.includes("immutable claim is missing"))).toBe(true);
  });

  it("rejects a channel-less or wrong-channel completion proof", async () => {
    const ledger = [
      {
        date: DATE,
        slot: 3,
        video_id: "short-noon",
        title: "Noon Short",
        uploaded_at: "2026-08-18T04:05:00.000Z"
      }
    ];
    const posts = qualifiedPair(3, "10s").map((entry) => ({ ...entry, video_sha256: VERIFIED_VIDEO_SHA }));
    const channelLess = await reportFixture(ledger, {
      posts,
      prepareRoot: (root) => writeVerifiedYouTubeCompletion(root, { profileChannelId: null })
    });
    const wrongChannel = await reportFixture(ledger, {
      posts,
      prepareRoot: (root) =>
        writeVerifiedYouTubeCompletion(root, {
          claimChannelId: WRONG_YOUTUBE_CHANNEL_ID,
          evidenceChannelId: WRONG_YOUTUBE_CHANNEL_ID
        })
    });

    expect(channelLess.rows.find((row) => row.slot === 3)?.youtube_uploaded).toBe(false);
    expect(channelLess.data_gaps.some((gap) => gap.includes("canonical business profile"))).toBe(true);
    expect(wrongChannel.rows.find((row) => row.slot === 3)?.youtube_uploaded).toBe(false);
    expect(wrongChannel.data_gaps.some((gap) => gap.includes("not bound to the canonical business YouTube channel"))).toBe(true);
  });

  it("rejects a completion with source or read-back evidence missing", async () => {
    const ledger = [
      {
        date: DATE,
        slot: 3,
        video_id: "short-noon",
        title: "Noon Short",
        uploaded_at: "2026-08-18T04:05:00.000Z"
      }
    ];
    const posts = qualifiedPair(3, "10s").map((entry) => ({ ...entry, video_sha256: VERIFIED_VIDEO_SHA }));
    const missingSource = await reportFixture(ledger, { posts });
    const missingReadBack = await reportFixture(ledger, {
      posts,
      prepareRoot: (root) => writeVerifiedYouTubeCompletion(root, { writeEvidence: false })
    });

    expect(missingSource.rows.find((row) => row.slot === 3)?.youtube_uploaded).toBe(false);
    expect(missingSource.data_gaps.some((gap) => gap.includes("source binding is unavailable"))).toBe(true);
    expect(missingReadBack.rows.find((row) => row.slot === 3)?.youtube_uploaded).toBe(false);
    expect(missingReadBack.data_gaps.some((gap) => gap.includes("completed read-back evidence"))).toBe(true);
  });

  it("rejects a checksum-stamped calendar once its writer identity is tampered", async () => {
    const report = await reportFixture(
      [
        {
          date: DATE,
          slot: 3,
          video_id: "short-noon",
          title: "Noon Short",
          uploaded_at: "2026-08-18T04:05:00.000Z"
        }
      ],
      {
        posts: qualifiedPair(3, "10s").map((entry) => ({ ...entry, video_sha256: VERIFIED_VIDEO_SHA })),
        prepareRoot: (root) => writeVerifiedYouTubeCompletion(root, { tamperCalendar: true })
      }
    );

    expect(report.rows.find((row) => row.slot === 3)?.youtube_uploaded).toBe(false);
    expect(report.data_gaps.some((gap) => gap.includes("calendar integrity is marked tampered"))).toBe(true);
  });

  it("rejects a cross-date same-slot ledger row even beside otherwise valid completion proof", async () => {
    const report = await reportFixture([
      {
        date: DATE,
        slot: 3,
        video_id: "short-noon",
        title: "Noon Short",
        uploaded_at: "2026-08-18T04:05:00.000Z"
      },
      {
        date: "2026-08-17",
        slot: 3,
        video_id: "yesterday-short",
        title: "Yesterday Short",
        uploaded_at: "2026-08-17T04:05:00.000Z"
      }
    ], {
      posts: qualifiedPair(3, "10s").map((entry) => ({ ...entry, video_sha256: VERIFIED_VIDEO_SHA })),
      prepareRoot: (root) => writeVerifiedYouTubeCompletion(root)
    });

    expect(report.rows.find((row) => row.slot === 3)?.youtube_uploaded).toBe(false);
    expect(report.data_gaps).toContain(
      `${DATE}: youtube-log has 1 cross-date record(s); only exact date and slot matches are counted.`
    );
    expect(report.data_gaps.some((gap) => gap.includes("cross-date YouTube ledger record") && gap.includes("unverified"))).toBe(true);
  });

  it("suppresses every YouTube success claim when the ledger is malformed", async () => {
    const report = await reportFixture([
      {
        date: DATE,
        slot: 3,
        video_id: "",
        title: "Incomplete Short",
        uploaded_at: "2026-08-18T04:05:00.000Z"
      }
    ]);

    expect(report.rows.map((row) => row.youtube_uploaded)).toEqual([false, false]);
    expect(report.data_gaps.some((gap) => gap.includes(`${DATE}: youtube-log is invalid`))).toBe(true);
  });

  it("does not turn a planned but unposted half into an unattributed A/B sample", async () => {
    // Insight rows may arrive late or be stale. Without a live posted-log
    // delivery, neither their totals nor the plan itself may become evidence.
    const report = await reportFixture([], { livePosts: false, insights: true });

    expect(report.rows).toHaveLength(2);
    expect(report.rows.map((row) => row.reach)).toEqual([10, 11]);
    expectNoVariantSamples(report);
    expect(
      report.data_gaps.some((gap) => gap.includes("no live posted-log entry") && gap.includes(DATE))
    ).toBe(true);
  });

  it("rejects an image fallback with an A/B label and stale insights as a video sample", async () => {
    const report = await reportFixture([], {
      posts: [
        qualifiedReelPost("facebook", 3, "10s", {
          published_media_type: "image",
          video_status: "VIDEO_DEFERRED"
        }),
        qualifiedReelPost("instagram", 3, "10s", {
          published_media_type: "image",
          video_status: "VIDEO_DEFERRED"
        })
      ],
      insights: true
    });

    expect(report.rows.find((row) => row.slot === 3)?.platforms_posted).toEqual(["facebook", "instagram"]);
    expect(report.rows.find((row) => row.slot === 3)?.reach).toBe(10);
    expectNoVariantSamples(report);
    expect(report.data_gaps.some((gap) => gap.includes("no qualified dual-platform Reel delivery"))).toBe(true);
  });

  it("rejects a single-platform Reel despite a valid A/B label and insight rows", async () => {
    const report = await reportFixture([], {
      posts: [qualifiedReelPost("instagram", 3, "10s")],
      insights: true
    });

    expect(report.rows.find((row) => row.slot === 3)?.platforms_posted).toEqual(["instagram"]);
    expectNoVariantSamples(report);
    expect(report.data_gaps.some((gap) => gap.includes("no qualified dual-platform Reel delivery"))).toBe(true);
  });

  it("rejects a dual-platform Reel when remote read-back evidence is absent", async () => {
    const report = await reportFixture([], {
      posts: [
        qualifiedReelPost("facebook", 3, "10s"),
        qualifiedReelPost("instagram", 3, "10s", { remote_reel_evidence: undefined })
      ],
      insights: true
    });

    expect(report.rows.find((row) => row.slot === 3)?.youtube_uploaded).toBe(false);
    expectNoVariantSamples(report);
    expect(report.data_gaps.some((gap) => gap.includes("no qualified dual-platform Reel delivery"))).toBe(true);
  });

  it.each([
    [
      "a missing video SHA",
      () => [
        qualifiedReelPost("facebook", 3, "10s", { video_sha256: undefined }),
        qualifiedReelPost("instagram", 3, "10s")
      ]
    ],
    [
      "different video SHAs across Facebook and Instagram",
      () => [
        qualifiedReelPost("facebook", 3, "10s", { video_sha256: "b".repeat(64) }),
        qualifiedReelPost("instagram", 3, "10s")
      ]
    ],
    [
      "a cross-date source record",
      () => [
        qualifiedReelPost("facebook", 3, "10s", { date: "2026-08-17" }),
        qualifiedReelPost("instagram", 3, "10s", { date: "2026-08-17" })
      ]
    ]
  ])("rejects a dual-platform record with %s", async (_reason, posts) => {
    const report = await reportFixture([], { posts: posts(), insights: true });

    expectNoVariantSamples(report);
    expect(
      report.data_gaps.some(
        (gap) =>
          gap.includes("no qualified dual-platform Reel delivery") ||
          gap.includes("no live posted-log entry") ||
          gap.includes("posted-log is invalid")
      )
    ).toBe(true);
  });

  it.each([
    [
      "a missing dry_run field",
      () => {
        const { dry_run: _dryRun, ...missingDryRun } = qualifiedReelPost("facebook", 3, "10s");
        return [missingDryRun, qualifiedReelPost("instagram", 3, "10s")];
      }
    ],
    [
      "an unknown platform",
      () => [
        { ...qualifiedReelPost("facebook", 3, "10s"), platform: "other-platform" },
        qualifiedReelPost("instagram", 3, "10s")
      ]
    ],
    [
      "an unknown status",
      () => [
        { ...qualifiedReelPost("facebook", 3, "10s"), status: "other-status" },
        qualifiedReelPost("instagram", 3, "10s")
      ]
    ],
    [
      "a wrong record date",
      () => [
        { ...qualifiedReelPost("facebook", 3, "10s"), date: "2026-08-17" },
        qualifiedReelPost("instagram", 3, "10s")
      ]
    ]
  ])("suppresses every row when posted-log has %s", async (_reason, rawPosts) => {
    const report = await reportFixture([], { rawPosts: rawPosts(), insights: true });

    expectInvalidPostedLogReport(report);
  });
});
