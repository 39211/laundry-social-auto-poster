import { createHash } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexingPush } from "../src/indexingPush";
import { writeDailyContent } from "../src/logging";
import type { DailySlot } from "../src/types";

const DATE = "2026-05-15";
const BASE = "https://indexing.example";
const priorBase = process.env.PUBLIC_SITE_BASE_URL;

afterEach(() => {
  if (priorBase === undefined) delete process.env.PUBLIC_SITE_BASE_URL;
  else process.env.PUBLIC_SITE_BASE_URL = priorBase;
});

function approvedSlot(slot: number): DailySlot {
  return {
    slot,
    time: slot === 1 ? "11:30" : "20:30",
    category: "知識文",
    topic: `索引核准測試 ${slot}`,
    media_type: "image",
    instagram_caption: `instagram ${slot}`,
    facebook_caption: `facebook ${slot}`,
    image_prompt: `image ${slot}`,
    local_image_path: `docs/assets/${DATE}/slot-${String(slot).padStart(2, "0")}.png`,
    public_image_url: `${BASE}/assets/${DATE}/slot-${String(slot).padStart(2, "0")}.png`,
    visual_route: "shop-inspection",
    traffic_route: "object-proof",
    status: "pending"
  };
}

async function seedCanonicalPublicApproval(root: string): Promise<DailySlot[]> {
  const slots = [approvedSlot(1), approvedSlot(2)];
  const digests: Record<string, Record<string, string>> = {};
  for (const slot of slots) {
    const imagePath = join(root, ...slot.local_image_path.split("/"));
    const bytes = Buffer.from(`approved-indexing-image-${slot.slot}`, "utf8");
    await mkdir(join(imagePath, ".."), { recursive: true });
    await writeFile(imagePath, bytes);
    digests[String(slot.slot)] = {
      [slot.local_image_path]: createHash("sha256").update(bytes).digest("hex")
    };
  }
  await writeDailyContent(
    { date: DATE, timezone: "Asia/Taipei", generated_at: "2026-05-15T00:00:00.000Z", slots },
    root
  );
  const approvalDir = join(root, "data", "approved-log");
  await mkdir(approvalDir, { recursive: true });
  await writeFile(
    join(approvalDir, `${DATE}.json`),
    `${JSON.stringify(
      slots.flatMap((slot) =>
        (["facebook", "instagram"] as const).map((platform) => ({
          date: DATE,
          slot: slot.slot,
          platform,
          status: "approved",
          approved_by: "reviewer",
          created_at: "2026-05-15T01:00:00.000Z"
        }))
      )
    )}\n`,
    "utf8"
  );
  const fingerprints = Object.fromEntries(
    slots.map((slot) => [String(slot.slot), createHash("sha256").update(JSON.stringify(slot)).digest("hex")])
  );
  await writeFile(join(approvalDir, `${DATE}.fingerprints.json`), `${JSON.stringify(fingerprints)}\n`, "utf8");
  await writeFile(join(approvalDir, `${DATE}.image-digests.json`), `${JSON.stringify(digests)}\n`, "utf8");
  return slots;
}

function fetchFixture(calls: Array<{ url: string; init?: RequestInit }>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (init?.method === "POST") return new Response("", { status: 200 });
    if (url.endsWith("/sitemap.xml")) {
      return new Response(
        [
          "<urlset>",
          `<url><loc>${BASE}/</loc></url>`,
          `<url><loc>${BASE}/guides/white-shoe-cleaning.html</loc></url>`,
          `<url><loc>${BASE}/posts/${DATE}-slot-01.html</loc></url>`,
          "</urlset>"
        ].join(""),
        { status: 200 }
      );
    }
    return new Response(`<html><body>${"meaningful laundry page ".repeat(40)}<a href="/guides/x">x</a></body></html>`, {
      status: 200
    });
  }) as typeof fetch;
}

describe("indexingPush public-release gate", () => {
  it("rejects a default IndexNow-capable run without approval before every fetch or report write", async () => {
    process.env.PUBLIC_SITE_BASE_URL = BASE;
    const root = mkdtempSync(join(tmpdir(), "laundry-indexing-unapproved-"));
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    await expect(indexingPush({ root, date: DATE, fetchImpl: fetchFixture(calls) })).rejects.toThrow(
      /Canonical public approval is required/
    );
    expect(calls).toEqual([]);
    expect(existsSync(join(root, "output", "operations", `indexing-push-${DATE}.json`))).toBe(false);
  });

  it("allows only the explicit --no-submit read-only audit without public approval", async () => {
    process.env.PUBLIC_SITE_BASE_URL = BASE;
    const root = mkdtempSync(join(tmpdir(), "laundry-indexing-read-only-"));
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    const report = await indexingPush({ root, date: DATE, skipSubmit: true, fetchImpl: fetchFixture(calls) });

    expect(report.indexnow_status).toBe("skipped");
    expect(calls.some((call) => call.init?.method === "POST")).toBe(false);
    expect(calls.length).toBeGreaterThan(0);
  });

  it("requires unmodified approval evidence before a default IndexNow POST", async () => {
    process.env.PUBLIC_SITE_BASE_URL = BASE;
    const root = mkdtempSync(join(tmpdir(), "laundry-indexing-approved-"));
    await seedCanonicalPublicApproval(root);
    const key = "a".repeat(32);
    await writeFile(join(root, "docs", `${key}.txt`), key, "utf8");
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    const report = await indexingPush({ root, date: DATE, fetchImpl: fetchFixture(calls) });

    expect(report.indexnow_status).toBe(200);
    expect(calls.filter((call) => call.init?.method === "POST")).toHaveLength(1);
    expect(calls.find((call) => call.init?.method === "POST")?.url).toContain("api.indexnow.org/indexnow");
  });

  it("blocks tampered and fingerprint-mismatched evidence before an IndexNow fetch", async () => {
    process.env.PUBLIC_SITE_BASE_URL = BASE;
    const root = mkdtempSync(join(tmpdir(), "laundry-indexing-corrupt-approval-"));
    await seedCanonicalPublicApproval(root);
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const calendarPath = join(root, "data", "content-calendar", `${DATE}.json`);
    const tampered = JSON.parse(await readFile(calendarPath, "utf8")) as { slots: Array<{ topic: string }> };
    tampered.slots[0]!.topic = "changed after approval";
    await writeFile(calendarPath, `${JSON.stringify(tampered)}\n`, "utf8");

    await expect(indexingPush({ root, date: DATE, fetchImpl: fetchFixture(calls) })).rejects.toThrow(
      /integrity\/tamper inspection/
    );
    expect(calls).toEqual([]);

    await seedCanonicalPublicApproval(root);
    const fingerprintsPath = join(root, "data", "approved-log", `${DATE}.fingerprints.json`);
    const fingerprints = JSON.parse(await readFile(fingerprintsPath, "utf8")) as Record<string, string>;
    fingerprints["1"] = "0".repeat(64);
    await writeFile(fingerprintsPath, `${JSON.stringify(fingerprints)}\n`, "utf8");
    await expect(indexingPush({ root, date: DATE, fetchImpl: fetchFixture(calls) })).rejects.toThrow(/fingerprint mismatch/);
    expect(calls).toEqual([]);
  });
});
