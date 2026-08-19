import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commentTextFor, postFirstComment } from "../src/firstComment";
import { loadDailyContent, writeDailyContent } from "../src/logging";
import type { DailySlot } from "../src/types";

const DATE = "2026-08-19";
const roots: string[] = [];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function seedPostedLog(root: string, entries: unknown[]): Promise<void> {
  const path = join(root, "data", "posted-log", `${DATE}.json`);
  await mkdir(join(root, "data", "posted-log"), { recursive: true });
  await writeFile(path, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

function calendarSlot(slot: number): DailySlot {
  return {
    slot,
    time: slot === 1 ? "11:30" : "20:30",
    category: "知識文",
    topic: `頭香測試 ${slot}`,
    media_type: "image",
    instagram_caption: "caption",
    facebook_caption: "caption",
    image_prompt: "image",
    local_image_path: `docs/assets/${DATE}/slot-${String(slot).padStart(2, "0")}.png`,
    public_image_url: `https://example.test/${DATE}/slot-${slot}.png`,
    visual_route: "shop-inspection",
    traffic_route: "object-proof",
    status: "pending"
  };
}

async function writeCanonicalApprovalEvidence(root: string, slots: DailySlot[]): Promise<void> {
  const approvalDir = join(root, "data", "approved-log");
  const digests: Record<string, Record<string, string>> = {};
  for (const slot of slots) {
    const imagePath = join(root, ...slot.local_image_path.split("/"));
    const bytes = Buffer.from(`first-comment-approved-image-${slot.slot}`, "utf8");
    await mkdir(join(imagePath, ".."), { recursive: true });
    await writeFile(imagePath, bytes);
    digests[String(slot.slot)] = {
      [slot.local_image_path]: createHash("sha256").update(bytes).digest("hex")
    };
  }
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
          approved_by: "fixture-reviewer",
          created_at: "2026-08-19T03:05:00.000Z"
        }))
      )
    )}\n`,
    "utf8"
  );
  await writeFile(
    join(approvalDir, `${DATE}.fingerprints.json`),
    `${JSON.stringify(
      Object.fromEntries(
        slots.map((slot) => [String(slot.slot), createHash("sha256").update(JSON.stringify(slot)).digest("hex")])
      )
    )}\n`,
    "utf8"
  );
  await writeFile(join(approvalDir, `${DATE}.image-digests.json`), `${JSON.stringify(digests)}\n`, "utf8");
}

async function seedCanonicalCalendar(root: string, slotNumbers: number[] = [1, 2]): Promise<void> {
  const slots = slotNumbers.map(calendarSlot);
  await writeDailyContent(
    {
      date: DATE,
      timezone: "Asia/Taipei",
      generated_at: "2026-08-19T03:00:00.000Z",
      slots
    },
    root
  );
  await writeCanonicalApprovalEvidence(root, slots);
}

async function rewriteFingerprintEvidence(root: string, slots: DailySlot[]): Promise<void> {
  await writeFile(
    join(root, "data", "approved-log", `${DATE}.fingerprints.json`),
    `${JSON.stringify(
      Object.fromEntries(
        slots.map((slot) => [String(slot.slot), createHash("sha256").update(JSON.stringify(slot)).digest("hex")])
      )
    )}\n`,
    "utf8"
  );
}

async function tamperCalendar(root: string): Promise<void> {
  const path = join(root, "data", "content-calendar", `${DATE}.json`);
  const calendar = JSON.parse(await readFile(path, "utf8")) as { slots: Array<{ topic: string }> };
  calendar.slots[0]!.topic = "未經核准的內容變更";
  await writeFile(path, `${JSON.stringify(calendar, null, 2)}\n`, "utf8");
}

function liveInstagram(slot: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    date: DATE,
    slot,
    platform: "instagram",
    status: "success",
    dry_run: false,
    post_id: `ig-media-${slot}`,
    attempts: 1,
    created_at: "2026-08-19T03:30:00.000Z",
    ...overrides
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

beforeEach(() => {
  vi.stubEnv("DRY_RUN", "false");
  vi.stubEnv("META_ACCESS_TOKEN", "test-access-token");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function hasUtmTrio(text: string, source: string, campaign: string): boolean {
  return (
    text.includes(`utm_source=${source}`) &&
    text.includes("utm_medium=social") &&
    text.includes(`utm_campaign=${campaign}`)
  );
}

describe("commentTextFor utm wiring", () => {
  it("輸出含 utm 三件組;拔注入 → 紅", () => {
    const date = "2026-08-17";
    const slot = 2;
    const campaign = `${date}-slot${slot}`;
    const text = commentTextFor("鞋子發黃該怎麼辦", date, slot);

    expect(hasUtmTrio(text, "instagram", campaign)).toBe(true);
    expect(text).toContain("source=ig-comment");

    const stripped = text.replace(/[?&]utm_[^=]+=[^&\s)]+/g, "");
    expect(hasUtmTrio(stripped, "instagram", campaign)).toBe(false);
    expect(stripped).toContain("source=ig-comment");
  });
});

describe("firstComment LINE source stays ig-comment", () => {
  it("頭香維持 /go/line.html?source=ig-comment,不得改成 source=post", () => {
    const text = commentTextFor("白鞋泛黃", "2026-08-18", 1);
    expect(text).toContain("/go/line.html?source=ig-comment");
    expect(text).not.toMatch(/\/go\/line\.html\?source=post(?:&|\)|$)/);
  });
});

describe("first comment remote side-effect gate", () => {
  it("allows a clean stamped calendar to reach the first-comment POST path", async () => {
    const root = await mkdtemp(join(tmpdir(), "first-comment-clean-calendar-"));
    roots.push(root);
    await seedCanonicalCalendar(root);
    await seedPostedLog(root, [liveInstagram(1)]);
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "comment-clean" })) as unknown as typeof fetch;

    await expect(postFirstComment({ date: DATE, slot: 1, root, fetchImpl })).resolves.toEqual({ posted: "comment-clean" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  for (const { label, token } of [
    { label: "missing", token: "" },
    { label: "placeholder", token: "example-token" }
  ]) {
    it(`blocks ${label} live Meta token before creating a claim or calling Graph`, async () => {
      vi.stubEnv("META_ACCESS_TOKEN", token);
      const root = await mkdtemp(join(tmpdir(), "first-comment-live-config-refusal-"));
      roots.push(root);
      await seedCanonicalCalendar(root);
      await seedPostedLog(root, [liveInstagram(1)]);
      const fetchImpl = vi.fn(async () => jsonResponse({ id: "comment-should-not-post" })) as unknown as typeof fetch;

      const result = await postFirstComment({ date: DATE, slot: 1, root, fetchImpl });

      expect(result.skipped).toContain("live Meta config");
      expect(result.skipped).toContain("META_ACCESS_TOKEN");
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(await exists(join(root, "data", "first-comment-claims", DATE, "slot-01-instagram.json"))).toBe(false);
    });
  }

  it("blocks a tampered calendar before creating a claim or calling Graph", async () => {
    const root = await mkdtemp(join(tmpdir(), "first-comment-tampered-calendar-"));
    roots.push(root);
    await seedCanonicalCalendar(root);
    await tamperCalendar(root);
    await seedPostedLog(root, [liveInstagram(1)]);
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "comment-should-not-post" })) as unknown as typeof fetch;

    const result = await postFirstComment({ date: DATE, slot: 1, root, fetchImpl });

    expect(result.skipped).toContain("canonical public approval for 2026-08-19 is unverified");
    expect(result.skipped).toContain("integrity/tamper inspection");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await exists(join(root, "data", "first-comment-claims", DATE, "slot-01-instagram.json"))).toBe(false);
  });

  it.each([
    [
      "a missing calendar",
      async (root: string) => {
        await rm(join(root, "data", "content-calendar", `${DATE}.json`), { force: true });
      },
      /current calendar is missing/
    ],
    [
      "a malformed calendar",
      async (root: string) => {
        await writeFile(join(root, "data", "content-calendar", `${DATE}.json`), '{"slots":"broken"}\n', "utf8");
      },
      /canonical public-approval inspection failed/
    ],
    [
      "a missing approval fingerprint",
      async (root: string) => {
        await rm(join(root, "data", "approved-log", `${DATE}.fingerprints.json`), { force: true });
      },
      /approval fingerprint sidecar is missing/
    ],
    [
      "a missing immutable image digest",
      async (root: string) => {
        await rm(join(root, "data", "approved-log", `${DATE}.image-digests.json`), { force: true });
      },
      /image-digest sidecar is missing/
    ],
    [
      "a duplicate approval tuple",
      async (root: string) => {
        const path = join(root, "data", "approved-log", `${DATE}.json`);
        const approvals = JSON.parse(await readFile(path, "utf8")) as Array<Record<string, unknown>>;
        await writeFile(path, `${JSON.stringify([...approvals, { ...approvals[0] }])}\n`, "utf8");
      },
      /requires exactly one approval tuple/
    ],
    [
      "a cross-date approval tuple",
      async (root: string) => {
        const path = join(root, "data", "approved-log", `${DATE}.json`);
        const approvals = JSON.parse(await readFile(path, "utf8")) as Array<Record<string, unknown>>;
        await writeFile(
          path,
          `${JSON.stringify(approvals.map((entry, index) => (index === 0 ? { ...entry, date: "2026-08-18" } : entry)))}\n`,
          "utf8"
        );
      },
      /has wrong approval date/
    ],
    [
      "a declared video without a canonical source/review",
      async (root: string) => {
        const content = await loadDailyContent(DATE, root, { today: DATE });
        if (!content || content.tampered) throw new Error("canonical fixture calendar unavailable");
        const slots = content.slots.map((slot) =>
          slot.slot === 1
            ? {
                ...slot,
                local_video_path: `docs/assets/${DATE}/slot-01.mp4`,
                public_video_url: `https://example.test/assets/${DATE}/slot-01.mp4`,
                video_prompt: "canonical proof fixture"
              }
            : slot
        );
        await writeDailyContent(
          { date: content.date, timezone: content.timezone, generated_at: content.generated_at, slots },
          root
        );
        await rewriteFingerprintEvidence(root, slots);
      },
      /public video requires exactly one canonical source record/
    ]
  ])("blocks %s before first-comment claim or Graph", async (_label, mutate, expectedGap) => {
    const root = await mkdtemp(join(tmpdir(), "first-comment-canonical-refusal-"));
    roots.push(root);
    await seedCanonicalCalendar(root);
    await seedPostedLog(root, [liveInstagram(1)]);
    await mutate(root);
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await postFirstComment({ date: DATE, slot: 1, root, fetchImpl });

    expect(result.skipped).toContain("canonical public approval");
    expect(result.skipped).toMatch(expectedGap);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await exists(join(root, "data", "first-comment-claims", DATE, "slot-01-instagram.json"))).toBe(false);
  });

  it.each([
    ["cross-day row", liveInstagram(1, { date: "2026-08-18" })],
    ["missing dry_run", (() => {
      const row = liveInstagram(1);
      Reflect.deleteProperty(row, "dry_run");
      return row;
    })()],
    ["blank post_id", liveInstagram(1, { post_id: "   " })],
    ["untrimmed post_id", liveInstagram(1, { post_id: " ig-media-1 " })]
  ])("does not POST for %s", async (_label, row) => {
    const root = await mkdtemp(join(tmpdir(), "first-comment-strict-"));
    roots.push(root);
    await seedPostedLog(root, [row]);
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "comment-1" })) as unknown as typeof fetch;

    const result = await postFirstComment({ date: DATE, slot: 1, root, fetchImpl });

    expect(result.skipped).toContain("unambiguous live Instagram transport");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await exists(join(root, "data", "first-comment-claims", DATE, "slot-01-instagram.json"))).toBe(false);
  });

  it("records an immutable claim before POST and refuses a restart after local log failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "first-comment-commit-point-"));
    roots.push(root);
    await seedCanonicalCalendar(root);
    await seedPostedLog(root, [liveInstagram(1)]);
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "comment-1" })) as unknown as typeof fetch;

    await expect(
      postFirstComment({
        date: DATE,
        slot: 1,
        root,
        fetchImpl,
        writeJsonAtomicImpl: async () => {
          throw new Error("simulated disk write failure");
        }
      })
    ).rejects.toThrow(/local log commit failed.*Automatic retry is blocked/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const claimPath = join(root, "data", "first-comment-claims", DATE, "slot-01-instagram.json");
    expect(await exists(claimPath)).toBe(true);
    expect(JSON.parse(await readFile(claimPath, "utf8"))).toMatchObject({
      date: DATE,
      slot: 1,
      platform: "instagram",
      media_id: "ig-media-1"
    });

    const restart = await postFirstComment({ date: DATE, slot: 1, root, fetchImpl });
    expect(restart.skipped).toContain("remote first-comment claim already exists");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not let a blocked slot claim suppress a separately qualified slot", async () => {
    const root = await mkdtemp(join(tmpdir(), "first-comment-independent-tuples-"));
    roots.push(root);
    await seedCanonicalCalendar(root);
    await seedPostedLog(root, [liveInstagram(1), liveInstagram(2)]);
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "comment-2" })) as unknown as typeof fetch;

    await expect(
      postFirstComment({
        date: DATE,
        slot: 1,
        root,
        fetchImpl,
        writeJsonAtomicImpl: async () => {
          throw new Error("slot one log failure");
        }
      })
    ).rejects.toThrow(/Automatic retry is blocked/i);
    const slotTwo = await postFirstComment({ date: DATE, slot: 2, root, fetchImpl });

    expect(slotTwo).toEqual({ posted: "comment-2" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
