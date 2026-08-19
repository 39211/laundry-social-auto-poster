import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeDailyContent } from "../src/logging";
import { submitIndexNow } from "../src/submitIndexNow";
import type { DailySlot } from "../src/types";

async function writeSitemap(root: string): Promise<void> {
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(
    join(root, "docs", "sitemap.xml"),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<urlset>",
      "<url><loc>https://39211.github.io/</loc></url>",
      "<url><loc>https://39211.github.io/services/white-shoe-cleaning.html</loc></url>",
      "<url><loc>https://39211.github.io/answers.json</loc></url>",
      "</urlset>"
    ].join("\n"),
    "utf8"
  );
}

function approvedSlot(date: string, slot: number): DailySlot {
  return {
    slot,
    time: slot === 1 ? "11:30" : "20:30",
    category: "知識文",
    topic: `IndexNow 核准測試 ${slot}`,
    media_type: "image",
    instagram_caption: `instagram ${slot}`,
    facebook_caption: `facebook ${slot}`,
    image_prompt: `image ${slot}`,
    local_image_path: `docs/assets/${date}/slot-${String(slot).padStart(2, "0")}.png`,
    public_image_url: `https://39211.github.io/assets/${date}/slot-${String(slot).padStart(2, "0")}.png`,
    visual_route: "shop-inspection",
    traffic_route: "object-proof",
    status: "pending"
  };
}

async function seedCanonicalPublicApproval(root: string, date: string): Promise<DailySlot[]> {
  const slots = [approvedSlot(date, 1), approvedSlot(date, 2)];
  const digests: Record<string, Record<string, string>> = {};
  for (const slot of slots) {
    const imagePath = join(root, ...slot.local_image_path.split("/"));
    const bytes = Buffer.from(`approved-indexnow-image-${date}-${slot.slot}`, "utf8");
    await mkdir(join(imagePath, ".."), { recursive: true });
    await writeFile(imagePath, bytes);
    digests[String(slot.slot)] = {
      [slot.local_image_path]: createHash("sha256").update(bytes).digest("hex")
    };
  }
  await writeDailyContent(
    { date, timezone: "Asia/Taipei", generated_at: "2026-05-15T00:00:00.000Z", slots },
    root
  );
  const approvalDir = join(root, "data", "approved-log");
  await mkdir(approvalDir, { recursive: true });
  await writeFile(
    join(approvalDir, `${date}.json`),
    `${JSON.stringify(
      slots.flatMap((slot) =>
        (["facebook", "instagram"] as const).map((platform) => ({
          date,
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
  await writeFile(join(approvalDir, `${date}.fingerprints.json`), `${JSON.stringify(fingerprints)}\n`, "utf8");
  await writeFile(join(approvalDir, `${date}.image-digests.json`), `${JSON.stringify(digests)}\n`, "utf8");
  return slots;
}

describe("submitIndexNow", () => {
  it("is dry-run by default and submits only canonical HTML URLs", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-indexnow-"));
    await writeSitemap(root);

    await expect(submitIndexNow({ root, key: "test-indexnow-key" })).resolves.toEqual({
      dryRun: true,
      urlCount: 2,
      host: "39211.github.io"
    });
  });

  it("requires an explicit key before any IndexNow action", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-indexnow-no-key-"));
    await writeSitemap(root);

    await expect(submitIndexNow({ root, key: "" })).rejects.toThrow("INDEXNOW_KEY is required");
  });

  it("rejects keys that don't match the IndexNow 8-128 character pattern", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-indexnow-bad-key-"));
    await writeSitemap(root);

    await expect(submitIndexNow({ root, key: "ab" })).rejects.toThrow("INDEXNOW_KEY must be 8-128");
    await expect(submitIndexNow({ root, key: "with spaces" })).rejects.toThrow("INDEXNOW_KEY must be 8-128");
  });

  it("expects the public key file to be named ${INDEXNOW_KEY}.txt and rejects stale locations", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-indexnow-named-key-"));
    const date = "2026-05-15";
    await writeSitemap(root);
    await seedCanonicalPublicApproval(root, date);
    await writeFile(join(root, "docs", "indexnow-key.txt"), "laundry-test-key-2026\n", "utf8");

    await expect(
      submitIndexNow({ root, date, key: "laundry-test-key-2026", live: true })
    ).rejects.toThrow(/laundry-test-key-2026\.txt does not match INDEXNOW_KEY/);
  });

  it("verifies the public key file before live submission and never needs to expose the key", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-indexnow-live-"));
    const date = "2026-05-15";
    await writeSitemap(root);
    await seedCanonicalPublicApproval(root, date);
    await writeFile(join(root, "docs", "test-indexnow-key.txt"), "test-indexnow-key\n", "utf8");
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(String(input).endsWith("test-indexnow-key.txt") ? "test-indexnow-key" : "", { status: 200 });
    }) as typeof fetch;

    await expect(
      submitIndexNow({ root, date, key: "test-indexnow-key", live: true, endpoint: "https://indexnow.example/submit", fetchImpl })
    ).resolves.toEqual({ dryRun: false, urlCount: 2, host: "39211.github.io" });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe("https://indexnow.example/submit");
    expect(calls[1]?.init?.body).toContain("white-shoe-cleaning.html");
    expect(calls[1]?.init?.body).not.toContain("answers.json");
  });

  it("blocks a live IndexNow request with no public approval before any fetch", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-indexnow-unapproved-live-"));
    const date = "2026-05-15";
    await writeSitemap(root);
    await writeFile(join(root, "docs", "test-indexnow-key.txt"), "test-indexnow-key\n", "utf8");
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("unexpected", { status: 200 });
    }) as typeof fetch;

    await expect(submitIndexNow({ root, date, key: "test-indexnow-key", live: true, fetchImpl })).rejects.toThrow(
      /Canonical public approval is required/
    );
    expect(calls).toEqual([]);
  });

  it("blocks tampered and fingerprint-mismatched approval evidence before live IndexNow fetch", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-indexnow-corrupt-approval-"));
    const date = "2026-05-15";
    await writeSitemap(root);
    await seedCanonicalPublicApproval(root, date);
    await writeFile(join(root, "docs", "test-indexnow-key.txt"), "test-indexnow-key\n", "utf8");
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("unexpected", { status: 200 });
    }) as typeof fetch;

    const calendarPath = join(root, "data", "content-calendar", `${date}.json`);
    const tampered = JSON.parse(await readFile(calendarPath, "utf8")) as { slots: Array<{ topic: string }> };
    tampered.slots[0]!.topic = "changed after approval";
    await writeFile(calendarPath, `${JSON.stringify(tampered)}\n`, "utf8");
    await expect(submitIndexNow({ root, date, key: "test-indexnow-key", live: true, fetchImpl })).rejects.toThrow(
      /integrity\/tamper inspection/
    );
    expect(calls).toEqual([]);

    await seedCanonicalPublicApproval(root, date);
    const fingerprintsPath = join(root, "data", "approved-log", `${date}.fingerprints.json`);
    const fingerprints = JSON.parse(await readFile(fingerprintsPath, "utf8")) as Record<string, string>;
    fingerprints["1"] = "0".repeat(64);
    await writeFile(fingerprintsPath, `${JSON.stringify(fingerprints)}\n`, "utf8");
    await expect(submitIndexNow({ root, date, key: "test-indexnow-key", live: true, fetchImpl })).rejects.toThrow(
      /fingerprint mismatch/
    );
    expect(calls).toEqual([]);
  });
});
