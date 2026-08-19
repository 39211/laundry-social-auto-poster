import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDailyContent, writeApprovalLog, writeDailyContent } from "../src/logging";
import { imageAssetsForSlot } from "../src/mediaAssets";
import { inspectCanonicalPublicPublicationApproval } from "../src/publicPublicationApproval";
import type { DailySlot } from "../src/types";

const DATE = "2026-09-21";
const roots: string[] = [];

function baseSlot(overrides: Partial<DailySlot> = {}): DailySlot {
  return {
    slot: 1,
    time: "11:30",
    category: "知識文",
    topic: "白鞋鞋邊泛灰的安全清潔",
    format: "image-post",
    media_type: "image",
    instagram_caption: "caption",
    facebook_caption: "caption",
    image_prompt: "clean white shoe beside a neutral laundry counter",
    local_image_path: `docs/assets/${DATE}/slot-01.png`,
    public_image_url: `https://example.test/assets/${DATE}/slot-01.png`,
    visual_route: "macro-detail",
    traffic_route: "object-proof",
    status: "pending",
    ...overrides
  };
}

function conceptReadyCandidate(): NonNullable<DailySlot["video_candidate"]> {
  return {
    status: "concept_ready",
    memory_hook: "先看鞋邊再決定清潔方式",
    conflict: "過度刷洗可能讓泛黃更明顯",
    single_action: "用棉布輕拭鞋邊",
    payoff: "保留材質並降低後續泛黃",
    cta: "帶到店內由師傅檢查",
    duration_seconds: 12,
    aspect_ratio: "9:16",
    first_frame_direction: "white shoe edge fills the frame",
    grok_motion_prompt: "one shoe edge inspection motion only",
    fallback_media_type: "image"
  };
}

function unpublishedCompanionPackage(): NonNullable<DailySlot["media_package"]> {
  return {
    status: "planned_unpublished",
    effective_date: "2026-07-29",
    image_count: 4,
    image_aspect_ratio: "4:5",
    companion_video_required: true,
    video_master_aspect_ratio: "9:16",
    instagram_delivery: "mixed-carousel-candidate",
    facebook_delivery: "paired-video-candidate",
    platform_preflight_required: true,
    publish_authorized: false,
    included_in_kpi: false
  };
}

function carouselItems() {
  return [1, 2].map((slide) => ({
    slide,
    image_prompt: `carousel image ${slide}`,
    local_image_path:
      slide === 1 ? `docs/assets/${DATE}/slot-01.png` : `docs/assets/${DATE}/slot-01-slide-02.png`,
    public_image_url:
      slide === 1
        ? `https://example.test/assets/${DATE}/slot-01.png`
        : `https://example.test/assets/${DATE}/slot-01-slide-02.png`
  }));
}

async function seedCanonicalImageRelease(root: string, slot: DailySlot): Promise<void> {
  const filler = baseSlot({
    slot: 2,
    time: "20:30",
    topic: "皮革包邊角的日常保護",
    local_image_path: `docs/assets/${DATE}/slot-02.png`,
    public_image_url: `https://example.test/assets/${DATE}/slot-02.png`
  });
  await writeDailyContent(
    { date: DATE, timezone: "Asia/Taipei", generated_at: "2026-09-21T03:00:00.000Z", slots: [slot, filler] },
    root
  );
  const content = await loadDailyContent(DATE, root, { today: DATE });
  if (!content || content.tampered) throw new Error("canonical test calendar unavailable");
  const digests: Record<string, Record<string, string>> = {};
  for (const current of content.slots) {
    const slotDigests: Record<string, string> = {};
    for (const asset of imageAssetsForSlot(current)) {
      const imageBytes = Buffer.from(`approved image bytes ${current.slot}-${asset.slide}`, "utf8");
      const imagePath = join(root, ...asset.local_image_path.split("/"));
      await mkdir(dirname(imagePath), { recursive: true });
      await writeFile(imagePath, imageBytes);
      slotDigests[asset.local_image_path] = createHash("sha256").update(imageBytes).digest("hex");
    }
    digests[String(current.slot)] = slotDigests;
  }

  await writeApprovalLog(
    DATE,
    content.slots.flatMap((current) =>
      ["facebook", "instagram"].map((platform) => ({
        date: DATE,
        slot: current.slot,
        platform: platform as "facebook" | "instagram",
        status: "approved" as const,
        approved_by: "fixture-reviewer",
        created_at: "2026-09-21T03:05:00.000Z"
      }))
    ),
    root
  );
  const approvalDir = join(root, "data", "approved-log");
  await writeFile(
    join(approvalDir, `${DATE}.fingerprints.json`),
    `${JSON.stringify(
      Object.fromEntries(
        content.slots.map((current) => [
          String(current.slot),
          createHash("sha256").update(JSON.stringify(current)).digest("hex")
        ])
      )
    )}\n`,
    "utf8"
  );
  await writeFile(
    join(approvalDir, `${DATE}.image-digests.json`),
    `${JSON.stringify(digests)}\n`,
    "utf8"
  );
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("canonical public video intent", () => {
  it.each([
    [
      "a concept-ready image fallback",
      baseSlot({
        video_candidate: conceptReadyCandidate(),
        video_prompt: "candidate only; not approved for publication",
        local_video_path: `docs/assets/${DATE}/slot-01.mp4`,
        public_video_url: `https://example.test/assets/${DATE}/slot-01.mp4`
      })
    ],
    [
      "an explicitly unpublished companion package",
      baseSlot({
        media_type: "mixed-carousel",
        format: "mixed-carousel",
        carousel_items: carouselItems(),
        media_package: unpublishedCompanionPackage(),
        video_prompt: "companion candidate only; not approved for publication",
        local_video_path: `docs/assets/${DATE}/slot-01.mp4`,
        public_video_url: `https://example.test/assets/${DATE}/slot-01.mp4`
      })
    ]
  ])("does not demand a video review for %s", async (_label, slot) => {
    const root = await mkdtemp(join(tmpdir(), "canonical-video-candidate-"));
    roots.push(root);
    await seedCanonicalImageRelease(root, slot);

    await expect(inspectCanonicalPublicPublicationApproval(DATE, root)).resolves.toMatchObject({ ok: true, gaps: [] });
  });

  it.each(["reel", "mixed-carousel"] as const)("rejects an incomplete actual %s", async (mediaType) => {
    const root = await mkdtemp(join(tmpdir(), "canonical-video-incomplete-"));
    roots.push(root);
    await seedCanonicalImageRelease(
      root,
      baseSlot(
        mediaType === "mixed-carousel"
          ? { media_type: mediaType, format: "mixed-carousel", carousel_items: carouselItems() }
          : { media_type: mediaType }
      )
    );

    const verdict = await inspectCanonicalPublicPublicationApproval(DATE, root);
    expect(verdict.ok).toBe(false);
    expect(verdict.gaps).toContain("slot 1 public video is missing canonical local MP4 path or video prompt");
  });

  it("requires canonical source and review evidence for a complete actual Reel", async () => {
    const root = await mkdtemp(join(tmpdir(), "canonical-reel-source-"));
    roots.push(root);
    await seedCanonicalImageRelease(
      root,
      baseSlot({
        format: "reel",
        media_type: "reel",
        video_prompt: "actual Reel release",
        local_video_path: `docs/assets/${DATE}/slot-01.mp4`,
        public_video_url: `https://example.test/assets/${DATE}/slot-01.mp4`
      })
    );

    const verdict = await inspectCanonicalPublicPublicationApproval(DATE, root);
    expect(verdict.ok).toBe(false);
    expect(verdict.gaps).toContain("slot 1 public video requires exactly one canonical source record, found 0");
  });

  it("rejects a complete explicit image-slot video tuple without source or review evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "canonical-video-explicit-"));
    roots.push(root);
    await seedCanonicalImageRelease(
      root,
      baseSlot({
        video_prompt: "explicit video release",
        local_video_path: `docs/assets/${DATE}/slot-01.mp4`,
        public_video_url: `https://example.test/assets/${DATE}/slot-01.mp4`
      })
    );

    const verdict = await inspectCanonicalPublicPublicationApproval(DATE, root);
    expect(verdict.ok).toBe(false);
    expect(verdict.gaps).toContain("slot 1 public video requires exactly one canonical source record, found 0");
  });
});
