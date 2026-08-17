import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { utmCampaign, utmTagged } from "../src/utm";

const AS_OF = "2026-08-16";
const OLD_DATE = "2026-08-10";
const NEW_DATE = "2026-08-16";

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
