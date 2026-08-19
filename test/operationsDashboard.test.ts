import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildDailyContent } from "../src/contentPlan";
import { writeDailyContent } from "../src/logging";
import {
  buildOperationsDashboard,
  writeOperationsDashboardArtifact
} from "../src/operationsDashboard";
import type { AppConfig, ApprovalLogEntry, PostLogEntry } from "../src/types";

const roots: string[] = [];

const config: AppConfig = {
  dryRun: true,
  timezone: "Asia/Taipei",
  graphApiVersion: "v25.0",
  publicSiteBaseUrl: "https://example.com",
  publicImageBaseUrl: "https://example.com",
  publicRootPagesRepo: "",
  verifyPublicImageUrl: false,
  grokReelsEnabled: true
};

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createCompletedDay(root: string, date: string): Promise<void> {
  const content = buildDailyContent(date, config);
  await writeDailyContent(content, root);
  await writeJson(join(root, "docs", "content-calendar", `${date}.json`), content);

  const approvals: ApprovalLogEntry[] = content.slots.flatMap((slot) =>
    (["facebook", "instagram"] as const).map((platform) => ({
      date,
      slot: slot.slot,
      platform,
      status: "approved" as const,
      approved_by: "test",
      created_at: `${date}T02:20:00.000Z`
    }))
  );
  await writeJson(join(root, "data", "approved-log", `${date}.json`), approvals);

  const posts: PostLogEntry[] = content.slots.flatMap((slot) =>
    (["facebook", "instagram"] as const).map((platform) => ({
      date,
      slot: slot.slot,
      platform,
      status: "success" as const,
      dry_run: false,
      attempts: 1,
      post_id: `${platform}-${slot.slot}`,
      created_at: `${date}T12:00:00.000Z`,
      ...(slot.media_type === "reel"
        ? {
            published_media_type: "reel" as const,
            video_status: "published" as const,
            video_sha256: "a".repeat(64),
            remote_reel_evidence: {
              remote_id: `${platform}-${slot.slot}`,
              permalink:
                platform === "facebook"
                  ? `https://www.facebook.com/reel/${platform}-${slot.slot}`
                  : `https://www.instagram.com/reel/${platform}-${slot.slot}`,
              verified_at: `${date}T12:01:00.000Z`,
              remote_media_type: "REELS" as const,
              caption_exact_match: true as const
            }
          }
        : {})
    }))
  );
  await writeJson(join(root, "data", "posted-log", `${date}.json`), posts);

  const imageSources = content.slots.map((slot) => ({
    date,
    slot: slot.slot,
    source: "gpt-image-2",
    image_path: slot.local_image_path,
    marked_at: `${date}T01:00:00.000Z`
  }));
  await writeJson(join(root, "data", "image-sources", `${date}.json`), imageSources);

  for (const slot of content.slots) {
    const imagePath = join(root, "docs", "assets", date, `slot-${String(slot.slot).padStart(2, "0")}.png`);
    await mkdir(dirname(imagePath), { recursive: true });
    await writeFile(imagePath, "png", "utf8");
  }

  const reelSlots = content.slots.filter((slot) => slot.media_type === "reel");
  if (reelSlots.length > 0) {
    await writeJson(
      join(root, "data", "video-sources", `${date}.json`),
      reelSlots.map((slot) => ({
        date,
        slot: slot.slot,
        source: "grok-imagine-video",
        model: "grok-imagine-video",
        video_path: slot.local_video_path,
        request_id: "test-request",
        duration_seconds: 10,
        width: 1080,
        height: 1920,
        frame_rate: 30,
        video_codec: "h264",
        marked_at: `${date}T01:10:00.000Z`
      }))
    );
    for (const slot of reelSlots) {
      const videoPath = join(root, "docs", "assets", date, `slot-${String(slot.slot).padStart(2, "0")}.mp4`);
      await writeFile(videoPath, "mp4", "utf8");
    }
  }
}

async function createInsights(root: string, date: string): Promise<void> {
  const instagramPath = join(root, "data", "insights", "instagram", `${date}.json`);
  await writeJson(instagramPath, {
    generated_at: `${date}T23:00:00.000Z`,
    rows: [
      { date, slot: 1, post_id: "ig-1", insights_ok: true, metrics: { views: 10 } },
      { date, slot: 2, post_id: "ig-2", insights_ok: true, metrics: { views: 20 } }
    ]
  });
  await writeFile(instagramPath, `\uFEFF${await readFile(instagramPath, "utf8")}`, "utf8");
  await writeJson(join(root, "data", "insights", "facebook", `${date}.json`), {
    generated_at: `${date}T23:00:00.000Z`,
    rows: [
      { date, slot: 1, post_id: "fb-1", insights_ok: true, insights: { views: 5 } },
      { date, slot: 2, post_id: "fb-2", insights_ok: true, insights: { views: 8 } }
    ]
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("90-day operations dashboard", () => {
  it("reconciles due slots across media, approval, public sync, publishing and KPI sources", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-ops-dashboard-"));
    roots.push(root);
    await createCompletedDay(root, "2026-07-11");
    await createInsights(root, "2026-07-11");

    const result = await buildOperationsDashboard({
      root,
      startDate: "2026-07-11",
      totalDays: 2,
      asOf: new Date("2026-07-12T12:00:00+08:00")
    });

    expect(result.summary).toMatchObject({
      current_day: 2,
      total_days: 2,
      due_slots: 3,
      generated_due_slots: 2,
      approved_due_slots: 2,
      seo_due_slots: 2,
      published_due_slots: 2,
      published_platform_posts: 4,
      platform_view_rows: 4,
      kpi_coverage: 1
    });
    expect(result.summary.publish_rate).toBeCloseTo(2 / 3);

    const completed = result.slots.find((row) => row.date === "2026-07-11" && row.slot === 1);
    expect(completed).toMatchObject({
      media_state: "就緒",
      facebook_approval: "已核准",
      instagram_approval: "已核准",
      facebook_publish: "已發佈",
      instagram_publish: "已發佈",
      seo_aeo_geo: "已同步",
      actual_views: 15,
      kpi_state: "完整",
      overall_state: "已發佈"
    });

    const overdue = result.slots.find((row) => row.date === "2026-07-12" && row.slot === 1);
    expect(overdue).toMatchObject({
      content_state: "未產生",
      overall_state: "未產生",
      next_action: "產生內容",
      due: true
    });

    expect(result.artifact.snapshot.status).toBe("partial");
    expect(result.artifact.snapshot.accessIssues).toHaveLength(1);
    expect(result.artifact.manifest).toMatchObject({
      title: "私享家 90 天發佈與 KPI",
      surface: "dashboard"
    });
  });

  it("writes the canonical artifact as a reproducible private output", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-ops-dashboard-write-"));
    roots.push(root);
    const outputPath = join(root, "output", "operations", "dashboard.artifact.json");

    const written = await writeOperationsDashboardArtifact({
      root,
      startDate: "2026-07-11",
      totalDays: 1,
      asOf: new Date("2026-07-10T12:00:00+08:00"),
      outputPath
    });

    expect(written.path).toBe(outputPath);
    const payload = JSON.parse(await readFile(outputPath, "utf8")) as {
      surface: string;
      manifest: {
        blocks: unknown[];
        tables: Array<{ defaultSort?: unknown; columns?: Array<{ field: string; sizing?: string }> }>;
      };
      snapshot: { datasets: { slot_status: unknown[] } };
    };
    expect(payload.surface).toBe("dashboard");
    expect(payload.manifest.blocks.length).toBeGreaterThan(0);
    expect(payload.manifest.tables[0]?.defaultSort).toEqual({ field: "date", direction: "asc" });
    expect(payload.manifest.tables[0]?.columns?.find((column) => column.field === "platform_publish")?.sizing).toBe(
      "content"
    );
    expect(payload.snapshot.datasets.slot_status).toHaveLength(2);
  });

  it("names only the platform that still needs publishing", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-ops-dashboard-partial-publish-"));
    roots.push(root);
    await createCompletedDay(root, "2026-07-11");

    const logPath = join(root, "data", "posted-log", "2026-07-11.json");
    const posts = JSON.parse(await readFile(logPath, "utf8")) as PostLogEntry[];
    const failedInstagram = posts.find((row) => row.slot === 1 && row.platform === "instagram");
    if (!failedInstagram) throw new Error("Expected the Instagram slot 1 fixture.");
    failedInstagram.status = "failed";
    failedInstagram.error = "fixture failure";
    await writeJson(logPath, posts);

    const result = await buildOperationsDashboard({
      root,
      startDate: "2026-07-11",
      totalDays: 1,
      asOf: new Date("2026-07-11T12:00:00+08:00")
    });
    const row = result.slots.find((slot) => slot.slot === 1);

    expect(row).toMatchObject({
      facebook_publish: "已發佈",
      instagram_publish: "失敗",
      next_action: "執行 IG 發佈"
    });
  });

  it("does not count an ambiguous transport claim or VIDEO_DEFERRED fallback as published", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-ops-dashboard-proof-gap-"));
    roots.push(root);
    const date = "2026-07-11";
    await createCompletedDay(root, date);

    const logPath = join(root, "data", "posted-log", `${date}.json`);
    const posts = JSON.parse(await readFile(logPath, "utf8")) as PostLogEntry[];
    const facebookImage = posts.find((row) => row.slot === 1 && row.platform === "facebook");
    if (!facebookImage) throw new Error("Expected the Facebook image fixture.");
    posts.push({ ...facebookImage, post_id: "facebook-slot-1-duplicate" });
    for (const row of posts) {
      if (row.slot !== 2) continue;
      row.published_media_type = "image";
      row.video_status = "VIDEO_DEFERRED";
    }
    await writeJson(logPath, posts);

    const result = await buildOperationsDashboard({
      root,
      startDate: date,
      totalDays: 1,
      asOf: new Date("2026-07-12T12:00:00+08:00")
    });
    const imageRow = result.slots.find((row) => row.slot === 1);
    const reelRow = result.slots.find((row) => row.slot === 2);

    expect(imageRow).toMatchObject({
      facebook_publish: "資料缺口",
      instagram_publish: "已發佈",
      overall_state: "發佈證據缺口",
      next_action: "核對 FB/IG 發佈證據；不得自動重發"
    });
    expect(reelRow).toMatchObject({
      facebook_publish: "Reel 證據缺口",
      instagram_publish: "Reel 證據缺口"
    });
    expect(reelRow?.overall_state).not.toBe("已發佈");
    expect(result.summary).toMatchObject({
      published_due_slots: 0,
      published_platform_posts: 1
    });
    expect(result.artifact.snapshot.accessIssues).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "publication_evidence_gaps" })])
    );
  });

  it("marks Reel slots with stale prompt hash as not ready and asks to regenerate", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-ops-dashboard-stale-reel-"));
    roots.push(root);
    await createCompletedDay(root, "2026-07-16");

    // Unpublished so overall_state is driven by media readiness, not publish history.
    await writeJson(join(root, "data", "posted-log", "2026-07-16.json"), []);

    const calendarPath = join(root, "data", "content-calendar", "2026-07-16.json");
    const content = JSON.parse(await readFile(calendarPath, "utf8")) as {
      slots: Array<{
        slot: number;
        media_type?: string;
        video_prompt?: string;
        local_video_path?: string;
      }>;
    };
    const reel = content.slots.find((slot) => slot.slot === 2);
    if (!reel || reel.media_type !== "reel" || !reel.video_prompt || !reel.local_video_path) {
      throw new Error("Expected 2026-07-16 slot 2 to be a Grok Reel fixture.");
    }

    // Keep MP4 + video-sources present, but write a complete run for a different creative.
    await writeJson(join(root, "data", "video-runs", "2026-07-16", "slot-02", "run.json"), {
      status: "complete",
      prompt_hash: "45cfd03fd490af31fe163239866d01436c0e01c01b598937e939f31e3372b1fd",
      target_path: reel.local_video_path,
      completed_at: "2026-07-15T15:59:24.050Z"
    });

    const result = await buildOperationsDashboard({
      root,
      startDate: "2026-07-16",
      totalDays: 1,
      asOf: new Date("2026-07-16T12:00:00+08:00")
    });
    const row = result.slots.find((slot) => slot.slot === 2);

    expect(row).toMatchObject({
      format: "reel",
      media_state: "Reel 創意已過期",
      overall_state: "素材缺件",
      next_action: "重新生成 Reel"
    });
    expect(["已就緒", "待審核", "待發佈", "已發佈"]).not.toContain(row?.overall_state);

    // Snapshot keeps full audit fields even when the visible table omits some columns.
    expect(row).toMatchObject({
      approval_state: expect.any(String),
      platform_publish: expect.any(String),
      seo_aeo_geo: expect.any(String),
      views_plan_actual: expect.any(String)
    });

    const table = (
      result.artifact.manifest as {
        tables: Array<{
          id: string;
          density?: string;
          columns: Array<{ field: string; label: string }>;
        }>;
      }
    ).tables.find((item) => item.id === "slot_status_table");
    expect(table?.density).toBe("spacious");
    const fields = table?.columns.map((column) => column.field) ?? [];
    expect(fields).toEqual([
      "date",
      "slot_time",
      "topic",
      "media_state",
      "approval_state",
      "platform_publish",
      "seo_aeo_geo",
      "views_plan_actual",
      "next_action"
    ]);
    // These remain on snapshot rows but must not reappear as wide visible columns.
    expect(fields).not.toContain("format");
    expect(fields).not.toContain("overall_state");
    expect(fields).toHaveLength(9);
  });
});
