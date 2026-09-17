import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autoApprove } from "../src/autoApprove";
import { stampDailyContentWrite } from "../src/contentPlan";
import { getConfig } from "../src/config";
import { writeJsonAtomic } from "../src/logging";
import { markImageSource } from "../src/markImageSource";
import { postCurrentSlot } from "../src/postCurrentSlot";
import { scheduleAheadFacebook } from "../src/scheduleAhead";
import { enableSlotHolds, sampleHold } from "./helpers/slotHoldsFixture";

const DATE = "2026-10-01";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const roots: string[] = [];
beforeEach(() => {
  vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://sixiangjialaundry.com");
  vi.stubEnv("META_ACCESS_TOKEN", "test-token-value");
  vi.stubEnv("FB_PAGE_ID", "111000111");
  vi.stubEnv("IG_USER_ID", "222000222");
  vi.stubEnv("DRY_RUN", "false");
  vi.stubEnv("VERIFY_PUBLIC_IMAGE_URL", "false");
  vi.stubEnv("ALLOW_OFF_SCHEDULE_PUBLISH", "true");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 })));
});

async function seed(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rev-hold-"));
  roots.push(root);
  const slots = [1, 2].map((slot) => {
    const path = `docs/assets/${DATE}/slot-0${slot}.png`;
    return {
      slot,
      time: slot === 1 ? "11:30" : "20:30",
      category: slot === 1 ? "知識文" : "情境文",
      topic: slot === 1 ? "白鞋鞋邊泛灰前的檢查" : "精品包邊角磨損的三個階段",
      format: "image-post",
      media_type: "image",
      instagram_caption: `caption${slot} 參考價 $250 LINE 傳照片 收送到府 0968327653`,
      facebook_caption: `caption${slot}`,
      image_prompt: `photorealistic laundry shop photo for ${path}`,
      visual_route: "macro-detail",
      traffic_route: "object-proof",
      local_image_path: path,
      public_image_url: `https://sixiangjialaundry.com/assets/${DATE}/slot-0${slot}.png`,
      status: "pending"
    };
  });
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  await writeFile(
    join(root, "data", "content-calendar", `${DATE}.json`),
    JSON.stringify(
      stampDailyContentWrite(
        { date: DATE, timezone: "Asia/Taipei", generated_at: new Date().toISOString(), slots } as Parameters<
          typeof stampDailyContentWrite
        >[0],
        { root }
      )
    ),
    "utf8"
  );
  await writeFile(
    join(root, "data", "publishing-policy.json"),
    JSON.stringify({
      status: "active",
      start_date: "2026-08-01",
      end_date: "2026-12-31",
      platforms: ["facebook", "instagram"],
      slots: [{ slot: 1 }, { slot: 2 }]
    }),
    "utf8"
  );
  await mkdir(join(root, "data", "image-prompts"), { recursive: true });
  await writeFile(
    join(root, "data", "image-prompts", `${DATE}.json`),
    JSON.stringify(slots.map((s) => ({ slot: s.slot, target_path: s.local_image_path, topic: s.topic, prompt: s.image_prompt }))),
    "utf8"
  );
  await mkdir(join(root, "docs", "assets", DATE), { recursive: true });
  for (const s of slots) {
    await writeFile(join(root, ...s.local_image_path.split("/")), png);
    await markImageSource({ root, date: DATE, slot: s.slot, source: "gpt-image-2", imagePath: s.local_image_path });
  }
  return root;
}

function fetchStub(calls: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ id: "x-1", post_id: "fb-post-1" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
}

async function captureErr<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: unknown; err: string }> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  try {
    return { value: await fn(), err: lines.join("\n") };
  } catch (error) {
    return { error, err: lines.join("\n") };
  } finally {
    console.error = original;
  }
}

describe("hold ordering against real already-* states", () => {
  it("R1 fully approved day (log + digests + fingerprints) still lists the held slot", async () => {
    const root = await seed();
    await enableSlotHolds(root, []);
    const first = await autoApprove({ date: DATE, root });
    expect(first.approved_slots.sort()).toEqual([1, 2]);
    await enableSlotHolds(root, [sampleHold({ date: DATE, slot: 1 })]);
    const second = await autoApprove({ date: DATE, root });
    expect(second.already_approved).toBe(true);
    expect(second.blockers.join("\n")).toContain(`SLOT HELD ${DATE} slot 1`);
  });

  it("R2 scheduleAhead on a held slot already in the Meta queue reports the hold and HELD_BUT_QUEUED", async () => {
    const root = await seed();
    await enableSlotHolds(root, []);
    await autoApprove({ date: DATE, root });
    await mkdir(join(root, "data", "scheduled-log"), { recursive: true });
    await writeJsonAtomic(join(root, "data", "scheduled-log", `${DATE}.json`), [
      { date: DATE, slot: 1, platform: "facebook", scheduled_post_id: "fb-q-1", scheduled_publish_time: 1, published_media_type: "image", created_at: new Date().toISOString() }
    ]);
    await enableSlotHolds(root, [sampleHold({ date: DATE, slot: 1 })]);
    const calls: string[] = [];
    const config = getConfig({ ...process.env, DRY_RUN: "false" });
    const out = await captureErr(() =>
      scheduleAheadFacebook({ date: DATE, root, config, fetchImpl: fetchStub(calls), now: new Date("2026-09-28T21:00:00+08:00") })
    );
    const row = out.value?.find((r) => r.slot === 1);
    expect(row?.reason ?? "").toMatch(/^SLOT HELD/);
    expect(out.err).toContain(`HELD_BUT_QUEUED ${DATE} slot 1 facebook`);
  });

  it("R3 postCurrentSlot on a held, approved, Meta-queued slot (no posted-log) records nothing", async () => {
    const root = await seed();
    await enableSlotHolds(root, []);
    await autoApprove({ date: DATE, root });
    await mkdir(join(root, "data", "scheduled-log"), { recursive: true });
    await writeJsonAtomic(join(root, "data", "scheduled-log", `${DATE}.json`), [
      { date: DATE, slot: 1, platform: "facebook", scheduled_post_id: "fb-q-1", scheduled_publish_time: 1, published_media_type: "image", created_at: new Date().toISOString() }
    ]);
    await enableSlotHolds(root, [sampleHold({ date: DATE, slot: 1 })]);
    const calls: string[] = [];
    const out = await captureErr(() =>
      postCurrentSlot({ date: DATE, slot: 1, root, now: `${DATE}T11:35:00+08:00`, dryRun: false, verifyPublicImageUrl: false, fetchImpl: fetchStub(calls) })
    );
    expect(String(out.error)).toMatch(/SLOT HELD/);
    expect(calls).toEqual([]);
    const posted = await readFile(join(root, "data", "posted-log", `${DATE}.json`), "utf8").catch(() => "[]");
    expect(JSON.parse(posted)).toEqual([]);
  });
});
