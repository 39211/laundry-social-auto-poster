import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { autoApprove } from "../src/autoApprove";
import { generateDailyContent } from "../src/generateDailyContent";
import * as generateVideo from "../src/generateVideo";
import * as imageProvenance from "../src/imageProvenance";
import * as imageStamp from "../src/imageStamp";
import { loadDailyContent } from "../src/logging";
import * as mediaAssets from "../src/mediaAssets";
import * as ownerRules from "../src/ownerContentRules";
import {
  OWNER_CONTENT_RULES,
  checkSlotAgainstOwnerRules,
  parseOwnerRulesMode,
  type OwnerRuleViolation
} from "../src/ownerContentRules";

const caption = (text: string, extra: Record<string, unknown> = {}) => ({
  slot: 1,
  media_type: "image",
  facebook_caption: text,
  ...extra
});
const check = (slot: object, opts?: Parameters<typeof checkSlotAgainstOwnerRules>[1]) =>
  checkSlotAgainstOwnerRules(slot, opts);
const rulesOf = (violations: OwnerRuleViolation[]) => violations.map((v) => v.rule);

describe("owner rules table", () => {
  it("lists all seven owner rules", () => {
    expect(Object.keys(OWNER_CONTENT_RULES).sort()).toEqual(
      ["ai_label", "fabrication", "placeholder", "price", "reel_length", "slim_master", "turnaround"].sort()
    );
  });
});

describe("rule 1: ai_label", () => {
  it("flags AI labels in captions, first comment and carousel text", () => {
    expect(rulesOf(check(caption("這張是 AI 生成的示意圖")))).toEqual(["ai_label"]);
    expect(rulesOf(check(caption("ＡＩ繪圖")))).toEqual(["ai_label"]);
    expect(rulesOf(check(caption("人工智慧生成")))).toEqual(["ai_label"]);
    const comment = check({ slot: 1, first_comment: "本圖由 AI 製作" });
    expect(comment).toHaveLength(1);
    expect(comment[0]?.field).toBe("first_comment");
    const carousel = check({ slot: 1, carousel_items: [{ slide: 1, caption: "AI 情境演示" }] });
    expect(carousel[0]?.rule).toBe("ai_label");
    expect(carousel[0]?.field).toBe("carousel_items[0].caption");
  });

  it("passes plain text and does not scan prompts for labels", () => {
    expect(check(caption("我們用燈光和放大鏡先看材質"))).toEqual([]);
    expect(check({ slot: 1, image_prompt: "no AI generated look, documentary phone photo" })).toEqual([]);
  });
});

describe("rule 2: fabrication", () => {
  it("flags quotes, ratings and invented numbers", () => {
    expect(rulesOf(check(caption("客人說洗完像新的")))).toEqual(["fabrication"]);
    expect(rulesOf(check(caption("九成的人都不知道")))).toEqual(["fabrication"]);
    expect(rulesOf(check(caption("回購率超高")))).toContain("fabrication");
    expect(rulesOf(check(caption("80% 的污漬都能改善")))).toEqual(["fabrication"]);
    expect(rulesOf(check(caption("已經服務上百位客人")))).toContain("fabrication");
    expect(rulesOf(check(caption("師傅有十年經驗")))).toEqual(["fabrication"]);
    expect(rulesOf(check(caption("這是真實案例")))).toEqual(["fabrication"]);
  });

  it("passes neutral text and URLs with percent-encoding", () => {
    expect(check(caption("不確定這件能不能處理？拍一張私訊，我們先看材質再說。"))).toEqual([]);
    expect(check(caption("一成不變的收納方式最容易悶出味道"))).toEqual([]);
    expect(check(caption("看這裡 https://example.com/%E5%8F%B0%E4%B8%AD"))).toEqual([]);
  });
});

describe("rule 3: turnaround", () => {
  it("passes the owner's spans", () => {
    expect(check(caption("鞋子大約 7 天可以取件"))).toEqual([]);
    expect(check(caption("一般衣物 5–7 天"))).toEqual([]);
    expect(check(caption("一般衣物需要 5-7 天，鞋 7 天，難乾大件 10~14 天，皮件／包 14 天"))).toEqual([]);
    expect(check(caption("棉被大約十四天可以取件"))).toEqual([]);
    expect(check(caption("大約一週可以取件"))).toEqual([]);
    expect(check(caption("大約７天可以取件"))).toEqual([]);
  });

  it("ignores day counts outside a turnaround context", () => {
    expect(check(caption("放了 3 天的汗味"))).toEqual([]);
    expect(check(caption("連續下雨兩天，衣服都悶出味道"))).toEqual([]);
  });

  it("flags other counts in a turnaround context", () => {
    expect(rulesOf(check(caption("大概 3 天就洗好")))).toEqual(["turnaround"]);
    const fullWidth = check(caption("大約３天可以取件"));
    expect(rulesOf(fullWidth)).toEqual(["turnaround"]);
    expect(fullWidth[0]?.excerpt).toContain("3天");
    expect(rulesOf(check(caption("需要 3 到 4 個工作天")))).toEqual(["turnaround"]);
    expect(rulesOf(check(caption("三四天就洗好")))).toEqual(["turnaround"]);
    expect(rulesOf(check(caption("大約 1-2 週可取件")))).toEqual(["turnaround"]);
  });
});

describe("rule 4: price", () => {
  it("flags money amounts", () => {
    expect(rulesOf(check(caption("NT$350")))).toEqual(["price"]);
    expect(rulesOf(check(caption("350 元")))).toEqual(["price"]);
    expect(rulesOf(check(caption("三百五十元起")))).toEqual(["price"]);
    expect(rulesOf(check(caption("參考價：背包清洗 $500")))).toEqual(["price"]);
  });

  it("allows 免費 and non-money 塊", () => {
    expect(check(caption("台中市免費到府收送"))).toEqual([]);
    expect(check(caption("鞋面有兩塊污漬"))).toEqual([]);
  });

  it("allows only the owner_supplied_prices strings", () => {
    expect(check(caption("這件 350 元", { owner_supplied_prices: ["350 元"] }))).toEqual([]);
    expect(rulesOf(check(caption("這件 500 元", { owner_supplied_prices: ["350 元"] })))).toEqual(["price"]);
    expect(rulesOf(check(caption("350 元，另一件 500 元", { owner_supplied_prices: ["350 元"] })))).toEqual([
      "price"
    ]);
  });
});

describe("rule 5: placeholder", () => {
  it("flags 待店主確認 in captions and carousel text", () => {
    expect(rulesOf(check(caption("交期待店主確認")))).toEqual(["placeholder"]);
    const carousel = check({ slot: 1, carousel_items: [{ slide: 1, text: "待店主確認" }] });
    expect(carousel[0]?.field).toBe("carousel_items[0].text");
  });

  it("passes the owner's wording", () => {
    expect(check(caption("交期看件後店裡跟您說"))).toEqual([]);
  });

  it("keeps excerpts at most 40 characters", () => {
    const long = check(caption(`${"很".repeat(100)}待店主確認${"很".repeat(100)}`));
    expect(long[0]?.excerpt.length).toBeLessThanOrEqual(40);
    expect(long[0]?.excerpt).toContain("待店主確認");
  });
});

describe("rule 6: slim_master", () => {
  it("flags a slimmed craftsman in prompts", () => {
    const hit = check({ slot: 1, image_prompt: "師傅身形纖細，正在刷洗白鞋" });
    expect(rulesOf(hit)).toEqual(["slim_master"]);
    expect(hit[0]?.field).toBe("image_prompt");
    const item = check({ slot: 1, carousel_items: [{ slide: 1, image_prompt: "The craftsman, slim build, scrubbing a sole." }] });
    expect(item[0]?.field).toBe("carousel_items[0].image_prompt");
  });

  it("passes neutral prompts, verbs and guardrails", () => {
    expect(check({ slot: 1, image_prompt: "師傅專注刷洗鞋面" })).toEqual([]);
    expect(check({ slot: 1, image_prompt: "a slender glass bottle on the shelf" })).toEqual([]);
    expect(check({ slot: 1, video_prompt: "The worker leans over to clean the sole." })).toEqual([]);
    expect(check({ slot: 1, image_prompt: "不要把師傅畫瘦" })).toEqual([]);
    expect(
      check({
        slot: 1,
        image_prompt:
          "STYLE: candid documentary phone photo taken by the shop worker mid-inspection. CAMERA: held from the worker's standing eye line; whites read white where clean."
      })
    ).toEqual([]);
  });
});

describe("rule 7: reel_length", () => {
  it("warns when the duration is unknown and blocks outside 25-45 s", () => {
    const unknown = check({ slot: 2, media_type: "reel", video_candidate: { duration_seconds: 10 } });
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.severity).toBe("warn");
    expect(unknown[0]?.excerpt).toContain("10");
    const short = check({ slot: 2, media_type: "reel" }, { reelDurationSeconds: 10 });
    expect(short[0]?.severity).toBe("block");
    expect(check({ slot: 2, media_type: "reel" }, { reelDurationSeconds: 30 })).toEqual([]);
    expect(check({ slot: 1, media_type: "image" })).toEqual([]);
  });
});

describe("SXJ_OWNER_RULES parsing", () => {
  it("defaults to report and never silently turns off", () => {
    expect(parseOwnerRulesMode(undefined)).toEqual({ mode: "report" });
    expect(parseOwnerRulesMode("")).toEqual({ mode: "report" });
    expect(parseOwnerRulesMode("BLOCK").mode).toBe("block");
    expect(parseOwnerRulesMode(" off ").mode).toBe("off");
    expect(parseOwnerRulesMode("blokc")).toEqual({ mode: "report", unrecognized: "blokc" });
  });
});

// --- autoApprove wiring -------------------------------------------------------

const PLACEHOLDER_HIT: OwnerRuleViolation = {
  rule: "placeholder",
  severity: "block",
  field: "instagram_caption",
  excerpt: "交期待店主確認"
};
const REEL_WARN: OwnerRuleViolation = {
  rule: "reel_length",
  severity: "warn",
  field: "video",
  excerpt: "時長未知，須 25–45 秒"
};

// Builds a day in a temp root whose only open question is the owner-rules gate:
// the calendar comes from generateDailyContent, the policy covers it, and the
// image/video evidence gates are stubbed (no images or videos in a temp root).
async function prepareDay(date: string): Promise<{ root: string; slots: number[] }> {
  vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://tester.github.io/laundry-social-auto-poster");
  const root = await mkdtemp(join(tmpdir(), "laundry-owner-rules-"));
  await generateDailyContent({ date, root, force: true });
  const content = await loadDailyContent(date, root);
  if (!content) throw new Error("fixture calendar missing");
  const slots = content.slots.map((slot) => slot.slot);
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(
    join(root, "data", "publishing-policy.json"),
    JSON.stringify({
      status: "active",
      start_date: "2026-05-01",
      end_date: "2026-05-31",
      platforms: ["facebook", "instagram"],
      slots: slots.map((slot) => ({ slot }))
    }),
    "utf8"
  );
  vi.spyOn(mediaAssets, "imageAssetsForSlot").mockReturnValue([]);
  vi.spyOn(imageStamp, "imageEvidenceFailures").mockResolvedValue([]);
  vi.spyOn(imageProvenance, "inspectDailyImageProvenance").mockResolvedValue({
    with_manifest: 0,
    without_manifest: 0,
    consistent: true
  } as unknown as Awaited<ReturnType<typeof imageProvenance.inspectDailyImageProvenance>>);
  vi.spyOn(generateVideo, "validatePublishableReel").mockResolvedValue(undefined);
  return { root, slots };
}

describe("autoApprove owner_rules gate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("report mode records the violation and writes the report, but approves", async () => {
    const date = "2026-05-21";
    const { root, slots } = await prepareDay(date);
    vi.stubEnv("SXJ_OWNER_RULES", "report");
    const spy = vi.spyOn(ownerRules, "checkSlotAgainstOwnerRules").mockImplementation(() => [PLACEHOLDER_HIT]);

    const result = await autoApprove({ date, root });

    expect(spy).toHaveBeenCalled();
    expect(result.approved).toBe(true);
    expect([...result.approved_slots].sort()).toEqual([...slots].sort());
    const gate = result.checks.find((c) => c.name === `owner_rules_slot${slots[0]}`);
    expect(gate?.ok).toBe(true);
    expect(gate?.detail).toContain("placeholder");
    expect(result.blockers.join("\n")).not.toContain("owner_rules");

    const report = JSON.parse(await readFile(join(root, "output", "owner-rules", `${date}.json`), "utf8")) as {
      mode: string;
      slots: Array<{ slot: number; violations: OwnerRuleViolation[] }>;
    };
    expect(report.mode).toBe("report");
    expect(report.slots[0]?.violations[0]?.rule).toBe("placeholder");
  });

  it("block mode refuses on a block violation", async () => {
    const date = "2026-05-22";
    const { root, slots } = await prepareDay(date);
    vi.stubEnv("SXJ_OWNER_RULES", "block");
    const first = slots[0];
    vi.spyOn(ownerRules, "checkSlotAgainstOwnerRules").mockImplementation((slot) =>
      (slot as { slot?: number }).slot === first ? [PLACEHOLDER_HIT] : []
    );

    const result = await autoApprove({ date, root, dryRun: true });

    expect(result.approved).toBe(false);
    expect(result.approved_slots).toEqual([]);
    expect(result.blockers.some((b) => b.startsWith(`owner_rules_slot${first}:`))).toBe(true);
    expect(result.checks.find((c) => c.name === `owner_rules_slot${first}`)?.ok).toBe(false);
  });

  it("block mode does not block on warnings", async () => {
    const date = "2026-05-23";
    const { root } = await prepareDay(date);
    vi.stubEnv("SXJ_OWNER_RULES", "block");
    vi.spyOn(ownerRules, "checkSlotAgainstOwnerRules").mockImplementation(() => [REEL_WARN]);

    const result = await autoApprove({ date, root, dryRun: true });

    expect(result.approved).toBe(true);
    expect(result.blockers.join("\n")).not.toContain("owner_rules");
  });

  it("off mode skips the gate", async () => {
    const date = "2026-05-24";
    const { root } = await prepareDay(date);
    vi.stubEnv("SXJ_OWNER_RULES", "off");
    const spy = vi.spyOn(ownerRules, "checkSlotAgainstOwnerRules").mockImplementation(() => [PLACEHOLDER_HIT]);

    const result = await autoApprove({ date, root, dryRun: true });

    expect(spy).not.toHaveBeenCalled();
    expect(result.checks.some((c) => c.name.startsWith("owner_rules"))).toBe(false);
    expect(result.approved).toBe(true);
  });
});

describe("price list amounts (owner's own price list)", () => {
  it("reports an on-list amount as a warning and an off-list amount as a block", () => {
    const onList = checkSlotAgainstOwnerRules({ slot: 1, facebook_caption: "參考價：背包清洗 $500（水洗價）" }, { priceListAmounts: [500] });
    expect(onList.map((v) => `${v.rule}/${v.severity}`)).toEqual(["price/warn"]);
    const offList = checkSlotAgainstOwnerRules({ slot: 1, facebook_caption: "參考價：背包清洗 $510（水洗價）" }, { priceListAmounts: [500] });
    expect(offList.map((v) => `${v.rule}/${v.severity}`)).toEqual(["price/block"]);
    const noList = checkSlotAgainstOwnerRules({ slot: 1, facebook_caption: "參考價：背包清洗 $500（水洗價）" });
    expect(noList.map((v) => `${v.rule}/${v.severity}`)).toEqual(["price/block"]);
  });
});

