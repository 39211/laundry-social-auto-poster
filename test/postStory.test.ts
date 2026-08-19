import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDailyContent, writeDailyContent } from "../src/logging";
import { shareLivePostsToStories } from "../src/postStory";
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

function storySlot(slot: number): DailySlot {
  return {
    slot,
    time: slot === 1 ? "11:30" : "20:30",
    category: "知識文",
    topic: `Story 測試 ${slot}`,
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

async function seedDay(root: string, posted: unknown[], slots: number[] = [1, 2]): Promise<void> {
  const calendarSlots = slots.map(storySlot);
  await writeDailyContent(
    {
      date: DATE,
      timezone: "Asia/Taipei",
      generated_at: "2026-08-19T03:00:00.000Z",
      slots: calendarSlots
    },
    root
  );
  await writeCanonicalApprovalEvidence(root, calendarSlots);
  const postedPath = join(root, "data", "posted-log", `${DATE}.json`);
  await mkdir(join(root, "data", "posted-log"), { recursive: true });
  await writeFile(postedPath, `${JSON.stringify(posted, null, 2)}\n`, "utf8");
}

async function writeCanonicalApprovalEvidence(root: string, slots: DailySlot[]): Promise<void> {
  const approvalDir = join(root, "data", "approved-log");
  const digests: Record<string, Record<string, string>> = {};
  for (const slot of slots) {
    const imagePath = join(root, ...slot.local_image_path.split("/"));
    const bytes = Buffer.from(`story-approved-image-${slot.slot}`, "utf8");
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
  await writeFingerprintEvidence(root, slots);
  await writeFile(join(approvalDir, `${DATE}.image-digests.json`), `${JSON.stringify(digests)}\n`, "utf8");
}

async function writeFingerprintEvidence(root: string, slots: DailySlot[]): Promise<void> {
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
  calendar.slots[0]!.topic = "未經核准的 Story 內容變更";
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

function storyFetch(): typeof fetch {
  let request = 0;
  return vi.fn(async () => {
    request += 1;
    if (request === 1) return jsonResponse({ id: "container-1" });
    if (request === 2) return jsonResponse({ id: "story-2" });
    return jsonResponse({
      id: "story-2",
      owner: { id: "ig-user" },
      media_product_type: "STORIES",
      media_type: "IMAGE",
      permalink: "https://www.instagram.com/stories/ig-user/story-2/",
      status_code: "PUBLISHED"
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.stubEnv("DRY_RUN", "false");
  vi.stubEnv("META_ACCESS_TOKEN", "test-access-token");
  vi.stubEnv("IG_USER_ID", "ig-user");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Story remote side-effect gate", () => {
  it("allows a clean stamped calendar to reach the Story POST path", async () => {
    const root = await mkdtemp(join(tmpdir(), "story-clean-calendar-"));
    roots.push(root);
    await seedDay(root, [liveInstagram(1)]);
    const fetchImpl = storyFetch();

    await expect(shareLivePostsToStories({ date: DATE, slot: 1, root, fetchImpl })).resolves.toEqual([
      { slot: 1, story_id: "story-2" }
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  for (const { label, token, owner, expected } of [
    { label: "missing token", token: "", owner: "ig-user", expected: /META_ACCESS_TOKEN/ },
    { label: "placeholder token", token: "example-token", owner: "ig-user", expected: /META_ACCESS_TOKEN/ },
    { label: "missing owner", token: "test-access-token", owner: "", expected: /IG_USER_ID/ }
  ]) {
    it(`blocks ${label} before public probing, a Story claim, or Graph`, async () => {
    vi.stubEnv("META_ACCESS_TOKEN", token);
    vi.stubEnv("IG_USER_ID", owner);
    const root = await mkdtemp(join(tmpdir(), "story-live-config-refusal-"));
    roots.push(root);
    await seedDay(root, [liveInstagram(1)]);
    const fetchImpl = storyFetch();

    const results = await shareLivePostsToStories({ date: DATE, slot: 1, root, fetchImpl });

    expect(results[0]?.skipped).toContain("live Meta config");
    expect(results[0]?.skipped).toMatch(expected);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await exists(join(root, "data", "story-claims", DATE, "slot-01-instagram.json"))).toBe(false);
    });
  }

  it("blocks a tampered calendar before creating a Story claim or calling Graph", async () => {
    const root = await mkdtemp(join(tmpdir(), "story-tampered-calendar-"));
    roots.push(root);
    await seedDay(root, [liveInstagram(1)]);
    await tamperCalendar(root);
    const fetchImpl = storyFetch();

    const results = await shareLivePostsToStories({ date: DATE, slot: 1, root, fetchImpl });

    expect(results).toEqual([
      { slot: 1, skipped: "calendar for 2026-08-19 is tampered; automatic Story publish is blocked" }
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await exists(join(root, "data", "story-claims", DATE, "slot-01-instagram.json"))).toBe(false);
  });

  it("keeps the existing dry-run result when a calendar is tampered", async () => {
    vi.stubEnv("DRY_RUN", "true");
    const root = await mkdtemp(join(tmpdir(), "story-tampered-dry-run-"));
    roots.push(root);
    await seedDay(root, [liveInstagram(1)]);
    await tamperCalendar(root);
    const fetchImpl = storyFetch();

    await expect(shareLivePostsToStories({ date: DATE, slot: 1, root, fetchImpl })).resolves.toEqual([
      { slot: 1, skipped: "dry run" }
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await exists(join(root, "data", "story-claims", DATE, "slot-01-instagram.json"))).toBe(false);
  });

  it("rechecks approval after a public-media probe before creating a Story claim", async () => {
    const root = await mkdtemp(join(tmpdir(), "story-probe-recheck-"));
    roots.push(root);
    await seedDay(root, [liveInstagram(1)]);
    const content = await loadDailyContent(DATE, root, { today: DATE });
    if (!content || content.tampered) throw new Error("canonical fixture calendar unavailable");
    const slots = content.slots.map((slot) =>
      slot.slot === 1
        ? { ...slot, public_video_url: `https://example.test/${DATE}/slot-01.mp4` }
        : slot
    );
    await writeDailyContent(
      { date: content.date, timezone: content.timezone, generated_at: content.generated_at, slots },
      root
    );

    let probeCompleted = false;
    const assertApproval = vi.fn(async () => {
      if (probeCompleted) throw new Error("calendar changed during public-media probe");
    });
    const verifyPublicAssetUrl = vi.fn(async () => {
      probeCompleted = true;
    });
    vi.resetModules();
    vi.doMock("../src/publicPublicationApproval", () => ({
      assertCanonicalPublicPublicationApproval: assertApproval
    }));
    vi.doMock("../src/githubPages", () => ({ verifyPublicAssetUrl }));

    try {
      const { shareLivePostsToStories: isolatedShareLivePostsToStories } = await import("../src/postStory");
      const fetchImpl = storyFetch();
      const results = await isolatedShareLivePostsToStories({ date: DATE, slot: 1, root, fetchImpl });

      expect(results[0]?.skipped).toContain("canonical public approval");
      expect(results[0]?.skipped).toContain("calendar changed during public-media probe");
      expect(assertApproval).toHaveBeenCalledTimes(2);
      expect(verifyPublicAssetUrl).toHaveBeenCalledTimes(1);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(await exists(join(root, "data", "story-claims", DATE, "slot-01-instagram.json"))).toBe(false);
    } finally {
      vi.doUnmock("../src/publicPublicationApproval");
      vi.doUnmock("../src/githubPages");
      vi.resetModules();
    }
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
      /Invalid daily content/
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
        await writeFingerprintEvidence(root, slots);
      },
      /public video requires exactly one canonical source record/
    ]
  ])("blocks %s before Story claim, public-media probe, or Graph", async (_label, mutate, expectedGap) => {
    const root = await mkdtemp(join(tmpdir(), "story-canonical-refusal-"));
    roots.push(root);
    await seedDay(root, [liveInstagram(1)]);
    await mutate(root);
    const fetchImpl = storyFetch();

    const results = await shareLivePostsToStories({ date: DATE, slot: 1, root, fetchImpl });

    expect(results[0]?.skipped).toContain("canonical public approval");
    expect(results[0]?.skipped).toMatch(expectedGap);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await exists(join(root, "data", "story-claims", DATE, "slot-01-instagram.json"))).toBe(false);
  });

  it.each([
    ["cross-day row", liveInstagram(1, { date: "2026-08-18" })],
    ["missing dry_run", (() => {
      const row = liveInstagram(1);
      Reflect.deleteProperty(row, "dry_run");
      return row;
    })()],
    ["blank post_id", liveInstagram(1, { post_id: " " })],
    ["untrimmed post_id", liveInstagram(1, { post_id: " ig-media-1 " })]
  ])("does not POST for %s", async (_label, row) => {
    const root = await mkdtemp(join(tmpdir(), "story-strict-"));
    roots.push(root);
    await seedDay(root, [row]);
    const fetchImpl = storyFetch();

    const results = await shareLivePostsToStories({ date: DATE, slot: 1, root, fetchImpl });

    expect(results).toEqual([{ slot: 1, skipped: "not an unambiguous live Instagram transport" }]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await exists(join(root, "data", "story-claims", DATE, "slot-01-instagram.json"))).toBe(false);
  });

  it("keeps the immutable claim when a remote Story succeeds but its log write fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "story-commit-point-"));
    roots.push(root);
    await seedDay(root, [liveInstagram(1)]);
    const fetchImpl = storyFetch();

    await expect(
      shareLivePostsToStories({
        date: DATE,
        slot: 1,
        root,
        fetchImpl,
        writeJsonAtomicImpl: async () => {
          throw new Error("simulated disk write failure");
        }
      })
    ).rejects.toThrow(/Story .* may be live.*Automatic retry is blocked/i);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    const claimPath = join(root, "data", "story-claims", DATE, "slot-01-instagram.json");
    expect(await exists(claimPath)).toBe(true);
    expect(JSON.parse(await readFile(claimPath, "utf8"))).toMatchObject({
      date: DATE,
      slot: 1,
      platform: "instagram",
      media_id: "ig-media-1"
    });

    const restart = await shareLivePostsToStories({ date: DATE, slot: 1, root, fetchImpl });
    expect(restart[0]?.skipped).toContain("remote Story claim already exists");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  for (const { label, readback } of [
    { label: "missing", readback: {} },
    {
      label: "mismatched",
      readback: {
        id: "different-story",
        owner: { id: "ig-user" },
        media_product_type: "STORIES",
        media_type: "IMAGE",
        permalink: "https://www.instagram.com/stories/ig-user/different-story/",
        status_code: "PUBLISHED"
      }
    }
  ]) {
    it(`keeps an uncertain claim and no success ledger when remote Story readback is ${label}`, async () => {
      const root = await mkdtemp(join(tmpdir(), "story-remote-readback-refusal-"));
      roots.push(root);
      await seedDay(root, [liveInstagram(1)]);
      let request = 0;
      const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
        request += 1;
        if (request === 1) return jsonResponse({ id: "container-1" });
        if (request === 2) return jsonResponse({ id: "story-2" });
        return jsonResponse(readback);
      });
      const fetchImpl = fetchMock as unknown as typeof fetch;

      await expect(shareLivePostsToStories({ date: DATE, slot: 1, root, fetchImpl })).rejects.toThrow(
        /Story remote readback/
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(await exists(join(root, "data", "stories", `${DATE}.json`))).toBe(false);
      expect(await exists(join(root, "data", "story-claims", DATE, "slot-01-instagram.json"))).toBe(true);

      const restart = await shareLivePostsToStories({ date: DATE, slot: 1, root, fetchImpl });
      expect(restart[0]?.skipped).toContain("remote Story claim already exists");
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).includes("/media_publish"))
      ).toHaveLength(1);
    });
  }

  it("keeps an IN_PROGRESS video container uncertain and never calls media_publish", async () => {
    const root = await mkdtemp(join(tmpdir(), "story-in-progress-timeout-"));
    roots.push(root);
    await seedDay(root, [liveInstagram(1)]);
    const content = await loadDailyContent(DATE, root, { today: DATE });
    if (!content || content.tampered) throw new Error("canonical fixture calendar unavailable");
    const slots = content.slots.map((slot) =>
      slot.slot === 1
        ? { ...slot, public_video_url: `https://example.test/${DATE}/slot-01.mp4` }
        : slot
    );
    await writeDailyContent(
      { date: content.date, timezone: content.timezone, generated_at: content.generated_at, slots },
      root
    );
    await writeFingerprintEvidence(root, slots);

    vi.resetModules();
    vi.doMock("../src/publicPublicationApproval", () => ({
      assertCanonicalPublicPublicationApproval: async () => undefined
    }));
    vi.doMock("../src/githubPages", () => ({ verifyPublicAssetUrl: async () => undefined }));
    try {
      const { shareLivePostsToStories: isolatedShareLivePostsToStories } = await import("../src/postStory");
      let request = 0;
      const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
        request += 1;
        return request === 1
          ? jsonResponse({ id: "video-container" })
          : jsonResponse({ status_code: "IN_PROGRESS" });
      });
      const fetchImpl = fetchMock as unknown as typeof fetch;

      await expect(
        isolatedShareLivePostsToStories({
          date: DATE,
          slot: 1,
          root,
          fetchImpl,
          sleepImpl: async () => undefined
        })
      ).rejects.toThrow(/remained IN_PROGRESS.*media_publish was not attempted/i);
      expect(fetchMock).toHaveBeenCalledTimes(11);
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/media_publish"))).toBe(false);
      expect(await exists(join(root, "data", "stories", `${DATE}.json`))).toBe(false);
      expect(await exists(join(root, "data", "story-claims", DATE, "slot-01-instagram.json"))).toBe(true);
    } finally {
      vi.doUnmock("../src/publicPublicationApproval");
      vi.doUnmock("../src/githubPages");
      vi.resetModules();
    }
  });

  it("does not let an unrelated tuple claim block a qualified slot", async () => {
    const root = await mkdtemp(join(tmpdir(), "story-independent-tuples-"));
    roots.push(root);
    await seedDay(root, [liveInstagram(1), liveInstagram(2)], [1, 2]);
    const slotOneClaim = join(root, "data", "story-claims", DATE, "slot-01-instagram.json");
    await mkdir(join(root, "data", "story-claims", DATE), { recursive: true });
    await writeFile(
      slotOneClaim,
      JSON.stringify({ schema_version: 1, date: DATE, slot: 1, platform: "instagram", media_id: "ig-media-1" }),
      "utf8"
    );
    const fetchImpl = storyFetch();

    const results = await shareLivePostsToStories({ date: DATE, root, fetchImpl });

    expect(results[0]?.skipped).toContain("remote Story claim already exists");
    expect(results[1]).toEqual({ slot: 2, story_id: "story-2" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
