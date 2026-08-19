import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildGbpPostCaption } from "../src/contentPlan";
import { GbpAuthError, refreshGbpAccessToken } from "../src/gbpAuth";
import {
  GBP_LINE_REDIRECT,
  GBP_SUMMARY_MAX,
  composeGbpSummary,
  composeWeeklyGbpPost,
  createLocalPost,
  extractGbpCtaUrl,
  isGbpDryRun,
  isPublicHttpsUrl,
  runGbpPostCli
} from "../src/gbpPost";
import { loadDailyContent, writeDailyContent } from "../src/logging";
import type { DailySlot } from "../src/types";
import { utmCampaign, utmTagged } from "../src/utm";

const AS_OF = "2026-08-16";
const OLD_DATE = "2026-08-10";
const NEW_DATE = "2026-08-16";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function hasUtmTrio(text: string, source: string, campaign: string): boolean {
  return (
    text.includes(`utm_source=${source}`) &&
    text.includes("utm_medium=social") &&
    text.includes(`utm_campaign=${campaign}`)
  );
}

function stripUtm(text: string): string {
  return text.replace(/[?&]utm_[^=]+=[^&\s)]+/g, "").replace(/\?&/, "?").replace(/\?$/, "");
}

function expectedCta(date: string, slot: number): string {
  return utmTagged(GBP_LINE_REDIRECT, { source: "gbp", campaign: utmCampaign(date, slot) });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function seedSlot(
  root: string,
  input: {
    date: string;
    slot: number;
    topic: string;
    caption: string;
    createdAt: string;
    mediaUrl?: string;
    extraSlots?: number[];
  }
): Promise<void> {
  const mediaUrl = input.mediaUrl ?? `https://39211.github.io/assets/${input.date}/slot-0${input.slot}.png`;
  const slots = [
    {
      slot: input.slot,
      time: "11:30",
      topic: input.topic,
      facebook_caption: input.caption,
      instagram_caption: input.caption,
      public_image_url: mediaUrl
    },
    ...(input.extraSlots ?? []).map((slot) => ({
      slot,
      time: "20:30",
      topic: `filler ${input.date} slot ${slot}`,
      facebook_caption: "filler",
      instagram_caption: "filler",
      public_image_url: `https://39211.github.io/assets/${input.date}/slot-0${slot}.png`
    }))
  ];
  await writeJson(join(root, "data", "content-calendar", `${input.date}.json`), {
    date: input.date,
    timezone: "Asia/Taipei",
    generated_at: input.createdAt,
    slots
  });
  await writeJson(join(root, "data", "posted-log", `${input.date}.json`), [
    {
      date: input.date,
      slot: input.slot,
      platform: "instagram",
      status: "success",
      dry_run: false,
      attempts: 1,
      published_media_type: "image",
      created_at: input.createdAt
    }
  ]);
}

function canonicalGbpSlot(date: string, slot: number): DailySlot {
  return {
    slot,
    time: slot === 1 ? "11:30" : "20:30",
    category: "知識文",
    topic: `GBP canonical fixture ${slot}`,
    media_type: "image",
    instagram_caption: `Instagram GBP fixture ${slot}`,
    facebook_caption: `Facebook GBP fixture ${slot}`,
    image_prompt: `GBP image ${slot}`,
    local_image_path: `docs/assets/${date}/slot-${String(slot).padStart(2, "0")}.png`,
    public_image_url: `https://39211.github.io/assets/${date}/slot-${String(slot).padStart(2, "0")}.png`,
    visual_route: "shop-inspection",
    traffic_route: "object-proof",
    status: "pending"
  };
}

async function writeCanonicalGbpFingerprints(root: string, date: string, slots: DailySlot[]): Promise<void> {
  await writeFile(
    join(root, "data", "approved-log", `${date}.fingerprints.json`),
    `${JSON.stringify(
      Object.fromEntries(
        slots.map((slot) => [String(slot.slot), createHash("sha256").update(JSON.stringify(slot)).digest("hex")])
      )
    )}\n`,
    "utf8"
  );
}

async function seedCanonicalGbpPublishFixture(root: string, date = NEW_DATE): Promise<void> {
  const slots = [canonicalGbpSlot(date, 1), canonicalGbpSlot(date, 2)];
  const digests: Record<string, Record<string, string>> = {};
  for (const slot of slots) {
    const imagePath = join(root, ...slot.local_image_path.split("/"));
    const bytes = Buffer.from(`gbp-approved-image-${date}-${slot.slot}`, "utf8");
    await mkdir(join(imagePath, ".."), { recursive: true });
    await writeFile(imagePath, bytes);
    digests[String(slot.slot)] = {
      [slot.local_image_path]: createHash("sha256").update(bytes).digest("hex")
    };
  }
  await writeDailyContent(
    { date, timezone: "Asia/Taipei", generated_at: "2026-08-16T03:00:00.000Z", slots },
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
          approved_by: "fixture-reviewer",
          created_at: "2026-08-16T03:05:00.000Z"
        }))
      )
    )}\n`,
    "utf8"
  );
  await writeCanonicalGbpFingerprints(root, date, slots);
  await writeFile(join(approvalDir, `${date}.image-digests.json`), `${JSON.stringify(digests)}\n`, "utf8");
  await writeJson(join(root, "data", "posted-log", `${date}.json`), [
    {
      date,
      slot: 1,
      platform: "facebook",
      status: "success",
      dry_run: false,
      post_id: "fb-gbp-fixture-1",
      attempts: 1,
      created_at: "2026-08-16T03:30:00.000Z"
    },
    {
      date,
      slot: 1,
      platform: "instagram",
      status: "success",
      dry_run: false,
      post_id: "ig-gbp-fixture-1",
      attempts: 1,
      created_at: "2026-08-16T03:30:00.000Z"
    }
  ]);
}

async function seedGbpOAuthFixture(root: string): Promise<void> {
  await mkdir(join(root, "secrets"), { recursive: true });
  await writeFile(
    join(root, "secrets", "gbp-oauth-client.json"),
    `${JSON.stringify({ installed: { client_id: "fixture-client", client_secret: "fixture-secret" } })}\n`,
    "utf8"
  );
}

function liveGbpEnv(): NodeJS.ProcessEnv {
  return {
    GBP_ACCOUNT_ID: "accounts/fixture-account",
    GBP_LOCATION_ID: "locations/fixture-location",
    GBP_REFRESH_TOKEN: "1//fixture-refresh-token"
  } as NodeJS.ProcessEnv;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

async function seedInsights(
  root: string,
  rows: Array<{ date: string; slot: number; total_interactions: number }>
): Promise<void> {
  await writeJson(join(root, "data", "insights", "instagram", `${OLD_DATE}_to_${NEW_DATE}.json`), {
    generated_at: "2026-08-16T12:00:00.000Z",
    rows: rows.map((row) => ({
      date: row.date,
      slot: row.slot,
      insights_ok: true,
      metrics: { total_interactions: row.total_interactions, likes: 0, comments: 0, shares: 0, saved: 0 }
    }))
  });
}

describe("GBP weekly post", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "gbp-post-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("組稿含 gbp utm 三件組、公開 https 媒體、summary 不超過 API 上限", async () => {
    await seedSlot(root, {
      date: NEW_DATE,
      slot: 1,
      topic: "白鞋鞋邊泛灰",
      caption: "開學前先看鞋邊。\n\n直接點這裡問:https://39211.github.io/go/line.html?source=post\n\n#私享家洗衣店",
      createdAt: "2026-08-16T03:00:00.000Z"
    });

    const composed = await composeWeeklyGbpPost({ date: AS_OF, root });
    const campaign = utmCampaign(NEW_DATE, 1);
    const cta = expectedCta(NEW_DATE, 1);

    expect(composed.ctaUrl).toBe(cta);
    expect(composed.summary).toContain(cta);
    expect(hasUtmTrio(composed.summary, "gbp", campaign)).toBe(true);
    expect(composed.summary).toContain("source=gbp");
    expect(composed.summary.length).toBeLessThanOrEqual(GBP_SUMMARY_MAX);
    expect(isPublicHttpsUrl(composed.mediaUrl)).toBe(true);
    expect(composed.mediaUrl.startsWith("https://")).toBe(true);
    expect(composed.apiPayload.callToAction.url).toBe(cta);
    expect(composed.apiPayload.media[0]?.sourceUrl).toBe(composed.mediaUrl);
    expect(composed.apiPayload.summary).toBe(composed.summary);
    expect(composed.source.selection).toBe("latest");
  });

  it("有 engagement 數據時選最高者，而不是最新一則", async () => {
    await seedSlot(root, {
      date: OLD_DATE,
      slot: 1,
      topic: "舊文高互動",
      caption: "舊文高互動本體",
      createdAt: "2026-08-10T01:00:00.000Z"
    });
    await seedSlot(root, {
      date: NEW_DATE,
      slot: 2,
      topic: "新文低互動",
      caption: "新文低互動本體",
      createdAt: "2026-08-16T12:00:00.000Z"
    });
    await seedInsights(root, [
      { date: OLD_DATE, slot: 1, total_interactions: 80 },
      { date: NEW_DATE, slot: 2, total_interactions: 2 }
    ]);

    const composed = await composeWeeklyGbpPost({ date: AS_OF, root });
    expect(composed.source.date).toBe(OLD_DATE);
    expect(composed.source.slot).toBe(1);
    expect(composed.source.selection).toBe("highest_engagement");
    expect(composed.source.engagement).toBe(80);
    expect(composed.summary).toContain("舊文高互動本體");
    expect(composed.summary).not.toContain("新文低互動本體");
  });

  it("無 engagement 數據時改取最新已發 slot", async () => {
    await seedSlot(root, {
      date: OLD_DATE,
      slot: 1,
      topic: "較早的圖文",
      caption: "較早的圖文本體",
      createdAt: "2026-08-10T01:00:00.000Z"
    });
    await seedSlot(root, {
      date: NEW_DATE,
      slot: 2,
      topic: "較晚的圖文",
      caption: "較晚的圖文本體",
      createdAt: "2026-08-16T12:00:00.000Z"
    });

    const composed = await composeWeeklyGbpPost({ date: AS_OF, root });
    expect(composed.source.date).toBe(NEW_DATE);
    expect(composed.source.slot).toBe(2);
    expect(composed.source.selection).toBe("latest");
    expect(composed.source.engagement).toBeUndefined();
    expect(composed.summary).toContain("較晚的圖文本體");
  });

  it("dry-run 寫出完整 payload + 預覽，且不呼叫 fetch", async () => {
    await seedSlot(root, {
      date: NEW_DATE,
      slot: 1,
      topic: "乾跑預覽題",
      caption: "乾跑預覽本體",
      createdAt: "2026-08-16T03:00:00.000Z"
    });
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await createLocalPost(true, {
      date: AS_OF,
      root,
      env: { GBP_LOCATION_ID: "locations/fixture-loc" } as NodeJS.ProcessEnv,
      fetchImpl
    });

    expect(result.dry_run).toBe(true);
    expect(result.draft_path).toBe(join(root, "output", "gbp-drafts", `${AS_OF}.json`));
    expect(fetchImpl).not.toHaveBeenCalled();

    const draft = JSON.parse(await readFile(result.draft_path!, "utf8")) as {
      dry_run: boolean;
      date: string;
      parent: string;
      missing: string[];
      preview: { summary: string; cta_url: string; media_url: string; summary_length: number };
      api_payload: {
        languageCode: string;
        summary: string;
        topicType: string;
        callToAction: { actionType: string; url: string };
        media: Array<{ mediaFormat: string; sourceUrl: string }>;
      };
      endpoint: string;
      source: { date: string; slot: number };
    };

    expect(draft.dry_run).toBe(true);
    expect(draft.date).toBe(AS_OF);
    expect(draft.missing).toContain("GBP_ACCOUNT_ID");
    expect(draft.parent).toContain("{GBP_ACCOUNT_ID}");
    expect(draft.parent).toContain("locations/fixture-loc");
    expect(draft.endpoint).toContain("mybusiness.googleapis.com/v4");
    expect(draft.endpoint).toContain("/localPosts");
    expect(draft.api_payload.languageCode).toBe("zh-TW");
    expect(draft.api_payload.topicType).toBe("STANDARD");
    expect(draft.api_payload.summary).toBe(draft.preview.summary);
    expect(draft.api_payload.callToAction.url).toBe(draft.preview.cta_url);
    expect(draft.api_payload.media[0]?.mediaFormat).toBe("PHOTO");
    expect(draft.api_payload.media[0]?.sourceUrl).toBe(draft.preview.media_url);
    expect(draft.preview.summary_length).toBe(draft.preview.summary.length);
    expect(draft.preview.summary.length).toBeLessThanOrEqual(GBP_SUMMARY_MAX);
    expect(isPublicHttpsUrl(draft.preview.media_url)).toBe(true);
    expect(hasUtmTrio(draft.preview.summary, "gbp", utmCampaign(NEW_DATE, 1))).toBe(true);
    expect(JSON.stringify(draft)).not.toMatch(/access_token|refresh_token|ya29\.|1\/\//i);
  });

  it("CLI 預設乾跑；--publish 才走實發", () => {
    expect(isGbpDryRun([])).toBe(true);
    expect(isGbpDryRun(["--dry-run"])).toBe(true);
    expect(isGbpDryRun(["--publish"])).toBe(false);
    expect(() => isGbpDryRun(["--dry-run", "--publish"])).toThrow(/only one/);
  });
});

describe("mutation 1: 拔 utm → 紅", () => {
  it("組稿 CTA 必須等於 utmTagged(source=gbp)；拔掉三件組後同一斷言為假", async () => {
    const date = NEW_DATE;
    const slot = 1;
    const { summary, ctaUrl } = composeGbpSummary({ date, body: "本週白鞋檢查", slot });
    const expected = expectedCta(date, slot);

    expect(ctaUrl).toBe(expected);
    expect(summary).toContain(expected);
    expect(hasUtmTrio(summary, "gbp", utmCampaign(date, slot))).toBe(true);
    expect(extractGbpCtaUrl(summary)).toBe(expected);

    const stripped = stripUtm(summary);
    expect(hasUtmTrio(stripped, "gbp", utmCampaign(date, slot))).toBe(false);
    expect(() => extractGbpCtaUrl(stripped)).toThrow(/utm_source=gbp/);
  });
});

describe("mutation 2: summary 超長不截 → 紅", () => {
  it("超過 1500 的正文必須截到上限並保住 CTA；不截的原文會超過上限", () => {
    const date = NEW_DATE;
    const slot = 1;
    const longBody = "甲".repeat(1800);
    const unclipped = buildGbpPostCaption({ date, body: longBody, slot });
    const { summary, ctaUrl } = composeGbpSummary({ date, body: longBody, slot });

    expect(unclipped.length).toBeGreaterThan(GBP_SUMMARY_MAX);
    expect(summary.length).toBeLessThanOrEqual(GBP_SUMMARY_MAX);
    expect(summary.length).toBeLessThan(unclipped.length);
    expect(summary).toContain(ctaUrl);
    expect(ctaUrl).toBe(expectedCta(date, slot));
    expect(hasUtmTrio(summary, "gbp", utmCampaign(date, slot))).toBe(true);
  });
});

describe("mutation 3: 缺 GBP_ACCOUNT_ID 時 --publish 不得默默成功", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "gbp-publish-"));
    await seedSlot(root, {
      date: NEW_DATE,
      slot: 1,
      topic: "發布缺帳號",
      caption: "發布缺帳號本體",
      createdAt: "2026-08-16T03:00:00.000Z"
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("--publish 缺 GBP_ACCOUNT_ID 必須丟錯，且不得打 API", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      runGbpPostCli(["--publish", `--date=${AS_OF}`], {
        root,
        env: { GBP_LOCATION_ID: "locations/fixture-loc" } as NodeJS.ProcessEnv,
        fetchImpl
      })
    ).rejects.toThrow(/GBP_ACCOUNT_ID/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("GBP --publish canonical public approval gate", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "gbp-canonical-publish-"));
    await seedCanonicalGbpPublishFixture(root);
    await seedGbpOAuthFixture(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it.each([
    [
      "a missing source calendar",
      async () => {
        await rm(join(root, "data", "content-calendar", `${NEW_DATE}.json`), { force: true });
      },
      /source package is unverified/
    ],
    [
      "a malformed source calendar",
      async () => {
        await writeFile(join(root, "data", "content-calendar", `${NEW_DATE}.json`), '{"slots":"broken"}\n', "utf8");
      },
      /source package is unverified/
    ],
    [
      "a tampered source calendar",
      async () => {
        const path = join(root, "data", "content-calendar", `${NEW_DATE}.json`);
        const calendar = JSON.parse(await readFile(path, "utf8")) as { slots: Array<{ topic: string }> };
        calendar.slots[0]!.topic = "unapproved GBP source rewrite";
        await writeFile(path, `${JSON.stringify(calendar)}\n`, "utf8");
      },
      /canonical public approval.*unverified.*integrity\/tamper inspection/
    ],
    [
      "a missing approval fingerprint",
      async () => {
        await rm(join(root, "data", "approved-log", `${NEW_DATE}.fingerprints.json`), { force: true });
      },
      /approval fingerprint sidecar is missing/
    ],
    [
      "a missing immutable image digest",
      async () => {
        await rm(join(root, "data", "approved-log", `${NEW_DATE}.image-digests.json`), { force: true });
      },
      /image-digest sidecar is missing/
    ],
    [
      "a duplicate approval tuple",
      async () => {
        const path = join(root, "data", "approved-log", `${NEW_DATE}.json`);
        const approvals = JSON.parse(await readFile(path, "utf8")) as Array<Record<string, unknown>>;
        await writeFile(path, `${JSON.stringify([...approvals, { ...approvals[0] }])}\n`, "utf8");
      },
      /requires exactly one approval tuple/
    ],
    [
      "a cross-date approval tuple",
      async () => {
        const path = join(root, "data", "approved-log", `${NEW_DATE}.json`);
        const approvals = JSON.parse(await readFile(path, "utf8")) as Array<Record<string, unknown>>;
        await writeFile(
          path,
          `${JSON.stringify(approvals.map((entry, index) => (index === 0 ? { ...entry, date: OLD_DATE } : entry)))}\n`,
          "utf8"
        );
      },
      /has wrong approval date/
    ],
    [
      "a declared video without a canonical source/review",
      async () => {
        const content = await loadDailyContent(NEW_DATE, root, { today: NEW_DATE });
        if (!content || content.tampered) throw new Error("canonical GBP fixture calendar unavailable");
        const slots = content.slots.map((slot) =>
          slot.slot === 1
            ? {
                ...slot,
                local_video_path: `docs/assets/${NEW_DATE}/slot-01.mp4`,
                public_video_url: `https://39211.github.io/assets/${NEW_DATE}/slot-01.mp4`,
                video_prompt: "canonical GBP video fixture"
              }
            : slot
        );
        await writeDailyContent(
          { date: content.date, timezone: content.timezone, generated_at: content.generated_at, slots },
          root
        );
        await writeCanonicalGbpFingerprints(root, NEW_DATE, slots);
      },
      /public video requires exactly one canonical source record/
    ]
  ])("blocks %s before GBP claim, OAuth fetch, or localPosts POST", async (_label, mutate, expectedGap) => {
    await mutate();
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      runGbpPostCli(["--publish", `--date=${AS_OF}`], {
        root,
        env: liveGbpEnv(),
        fetchImpl
      })
    ).rejects.toThrow(expectedGap);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await exists(join(root, "data", "gbp-post-claims", NEW_DATE, "slot-01.json"))).toBe(false);
  });

  it("allows a complete canonical source through mocked OAuth/localPosts readback once, then blocks retransmission", async () => {
    let request = 0;
    let localPostPayload: Record<string, unknown> | undefined;
    const localPostName = "accounts/fixture-account/locations/fixture-location/localPosts/fixture";
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      request += 1;
      if (request === 1) return jsonResponse({ access_token: "fixture-access-token", expires_in: 3600 });
      if (request === 2) {
        localPostPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({ name: localPostName });
      }
      return jsonResponse({ name: localPostName, ...localPostPayload });
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const result = await runGbpPostCli(["--publish", `--date=${AS_OF}`], {
      root,
      env: liveGbpEnv(),
      fetchImpl
    });

    expect(result).toMatchObject({ dry_run: false, name: expect.stringContaining("localPosts/fixture") });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const claimPath = join(root, "data", "gbp-post-claims", NEW_DATE, "slot-01.json");
    expect(await exists(claimPath)).toBe(true);
    const evidencePath = join(root, "data", "gbp-posts", NEW_DATE, "slot-01.json");
    expect(JSON.parse(await readFile(evidencePath, "utf8"))).toMatchObject({
      name: localPostName,
      source_date: NEW_DATE,
      source_slot: 1
    });

    await expect(
      runGbpPostCli(["--publish", `--date=${AS_OF}`], {
        root,
        env: liveGbpEnv(),
        fetchImpl
      })
    ).rejects.toThrow(/immutable publish claim already exists.*automatic retransmission is blocked/i);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects GBP token failure before writing the immutable publish claim", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "invalid_grant" }, 401));
    const fetchImpl = fetchMock as unknown as typeof fetch;

    await expect(
      runGbpPostCli(["--publish", `--date=${AS_OF}`], {
        root,
        env: liveGbpEnv(),
        fetchImpl
      })
    ).rejects.toThrow(/GBP token refresh failed/i);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await exists(join(root, "data", "gbp-post-claims", NEW_DATE, "slot-01.json"))).toBe(false);
    expect(await exists(join(root, "data", "gbp-posts", NEW_DATE, "slot-01.json"))).toBe(false);
  });

  for (const { label, readback } of [
    { label: "missing", readback: {} },
    {
      label: "mismatched",
      readback: {
        name: "accounts/fixture-account/locations/fixture-location/localPosts/fixture",
        summary: "unapproved replacement summary",
        callToAction: { actionType: "LEARN_MORE", url: "https://example.test/wrong" },
        media: [{ mediaFormat: "PHOTO", sourceUrl: "https://example.test/wrong.png" }]
      }
    }
  ]) {
    it(`keeps a successful localPosts.create uncertain when GET readback is ${label}`, async () => {
      let request = 0;
      const localPostName = "accounts/fixture-account/locations/fixture-location/localPosts/fixture";
      const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
        request += 1;
        if (request === 1) return jsonResponse({ access_token: "fixture-access-token", expires_in: 3600 });
        if (request === 2) return jsonResponse({ name: localPostName });
        return jsonResponse(readback);
      });
      const fetchImpl = fetchMock as unknown as typeof fetch;

      await expect(
        runGbpPostCli(["--publish", `--date=${AS_OF}`], {
          root,
          env: liveGbpEnv(),
          fetchImpl
        })
      ).rejects.toThrow(/remote readback could not verify.*Automatic retransmission is blocked/i);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(await exists(join(root, "data", "gbp-post-claims", NEW_DATE, "slot-01.json"))).toBe(true);
      expect(await exists(join(root, "data", "gbp-posts", NEW_DATE, "slot-01.json"))).toBe(false);

      await expect(
        runGbpPostCli(["--publish", `--date=${AS_OF}`], {
          root,
          env: liveGbpEnv(),
          fetchImpl
        })
      ).rejects.toThrow(/immutable publish claim already exists.*automatic retransmission is blocked/i);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(
        fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/localPosts") && init?.method === "POST")
      ).toHaveLength(1);
    });
  }
});

describe("gbpAuth 429/401 分類", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "gbp-auth-"));
    await mkdir(join(root, "secrets"), { recursive: true });
    await writeFile(
      join(root, "secrets", "gbp-oauth-client.json"),
      `${JSON.stringify({ installed: { client_id: "test-client-id", client_secret: "test-client-secret" } })}\n`,
      "utf8"
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("429 → rate_limited；401 → unauthorized；回包裡的 token 不得進錯誤字串", async () => {
    const leak = "ya29.LEAKED-ACCESS-TOKEN-VALUE";
    const env = { GBP_REFRESH_TOKEN: "1//FIXTURE-REFRESH" } as NodeJS.ProcessEnv;

    const err429 = await refreshGbpAccessToken({
      root,
      env,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: "rate_limit_exceeded", access_token: leak }), {
          status: 429
        })) as unknown as typeof fetch
    }).catch((error: unknown) => error);

    expect(err429).toBeInstanceOf(GbpAuthError);
    expect((err429 as GbpAuthError).kind).toBe("rate_limited");
    expect((err429 as GbpAuthError).status).toBe(429);
    expect(String(err429)).not.toContain(leak);
    expect(String(err429)).not.toContain("test-client-secret");
    expect(String(err429)).not.toContain("1//FIXTURE-REFRESH");

    const err401 = await refreshGbpAccessToken({
      root,
      env,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: "unauthorized_client", access_token: leak }), {
          status: 401
        })) as unknown as typeof fetch
    }).catch((error: unknown) => error);

    expect(err401).toBeInstanceOf(GbpAuthError);
    expect((err401 as GbpAuthError).kind).toBe("unauthorized");
    expect((err401 as GbpAuthError).status).toBe(401);
    expect(String(err401)).not.toContain(leak);
  });

  it("缺 refresh token 明確報缺，不打 token endpoint", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(refreshGbpAccessToken({ root, env: {} as NodeJS.ProcessEnv, fetchImpl })).rejects.toThrow(
      /GBP_REFRESH_TOKEN/
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
