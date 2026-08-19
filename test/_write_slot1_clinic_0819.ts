/**
 * Surgical slot-1 rewrite for 2026-08-19.
 * Uses writeDailyContent (no raw calendar write). Leaves slot 2 and 3 byte-identical.
 * Captions go through withSharedCaptionRules — the public half of captionFromPlaybook
 * (source=post LINE, price line, hashtag ladder). captionFromPlaybook itself is not exported.
 */
import { getConfig } from "../src/config";
import {
  buildCarouselImagePrompts,
  withSharedCaptionRules
} from "../src/contentPlan";
import { loadDailyContent, writeDailyContent } from "../src/logging";
import type { DailySlot } from "../src/types";

const DATE = "2026-08-19";
const TOPIC = "診所制服每週收送";
const FOLLOW = "追蹤私享家，之後會持續整理診所制服和團體送洗的判斷。";
const HASHTAGS = ["#私享家洗衣店", "#台中西屯洗衣店", "#診所制服", "#制服清洗"];

function baseCaption(platform: "instagram" | "facebook"): string {
  const channel = platform === "instagram" ? "私訊" : "傳 LINE";
  return [
    "診所制服每週收送，先看領口和袖口。",
    "醫師服一週穿下來，領口那圈和袖口內側最先出狀況。看起來還能穿，其實已經開始了。",
    "我會先看領口那圈油汗和袖口內側。那兩個地方天天貼皮膚，比整體髒不髒更說明這週要不要送。",
    `台中市區固定每週到府收送，拍一張${channel}說一聲就好。`,
    "你們診所現在是同仁自己帶回家洗，還是有固定收送？",
    FOLLOW,
    HASHTAGS.join(" ")
  ].join("\n\n");
}

async function main(): Promise<void> {
  const config = getConfig();
  const existing = await loadDailyContent(DATE);
  if (!existing) throw new Error(`missing calendar ${DATE}`);
  const slot2 = existing.slots.find((slot) => slot.slot === 2);
  const slot3 = existing.slots.find((slot) => slot.slot === 3);
  const previous = existing.slots.find((slot) => slot.slot === 1);
  if (!slot2 || !slot3 || !previous) throw new Error("expected three slots");

  const slot2Before = JSON.stringify(slot2);
  const slot3Before = JSON.stringify(slot3);

  const instagram = withSharedCaptionRules(baseCaption("instagram"), TOPIC, {
    source: "instagram",
    campaign: `${DATE}-slot1`,
    siteBaseUrl: config.publicSiteBaseUrl
  });
  const facebook = withSharedCaptionRules(baseCaption("facebook"), TOPIC, {
    source: "facebook",
    campaign: `${DATE}-slot1`,
    siteBaseUrl: config.publicSiteBaseUrl
  });

  const prompts = buildCarouselImagePrompts({
    date: DATE,
    slot: 1,
    topic: TOPIC,
    caption: facebook,
    seo_sync_page: "/services/shirt-suit-dry-cleaning.html"
  });

  const nextSlot1: DailySlot = {
    ...previous,
    topic: TOPIC,
    format: "image-post",
    media_type: "mixed-carousel",
    instagram_caption: instagram,
    facebook_caption: facebook,
    image_prompt: prompts[0] ?? previous.image_prompt,
    carousel_items: prompts.map((prompt, index) => ({
      slide: index + 1,
      image_prompt: prompt,
      local_image_path:
        index === 0
          ? `docs/assets/${DATE}/slot-01.png`
          : `docs/assets/${DATE}/slot-01-slide-0${index + 1}.png`,
      public_image_url:
        index === 0
          ? `https://sixiangjialaundry.com/assets/${DATE}/slot-01.png`
          : `https://sixiangjialaundry.com/assets/${DATE}/slot-01-slide-0${index + 1}.png`
    })),
    visual_route: "shop-inspection",
    traffic_route: "value-prop-lead",
    content_role: "reach-answer",
    follow_cta: FOLLOW,
    seo_sync_page: "/services/shirt-suit-dry-cleaning.html",
    search_intent: "problem-diagnosis",
    target_queries: ["台中制服清洗", "診所制服送洗", "台中到府收送洗衣"],
    evidence_type: "first-party-inspection",
    content_plan_source: "growth-playbook",
    local_image_path: `docs/assets/${DATE}/slot-01.png`,
    public_image_url: `https://sixiangjialaundry.com/assets/${DATE}/slot-01.png`,
    status: "pending"
  };

  // Stale shoe-and-bag video copy must not ride the new uniform topic.
  delete nextSlot1.video_candidate;
  nextSlot1.video_prompt = undefined;

  await writeDailyContent({
    date: existing.date,
    timezone: existing.timezone,
    generated_at: new Date().toISOString(),
    slots: [nextSlot1, slot2, slot3]
  });

  const written = await loadDailyContent(DATE);
  if (!written) throw new Error("reload failed");
  const written2 = written.slots.find((slot) => slot.slot === 2);
  const written3 = written.slots.find((slot) => slot.slot === 3);
  const written1 = written.slots.find((slot) => slot.slot === 1);
  if (JSON.stringify(written2) !== slot2Before) throw new Error("slot 2 mutated");
  if (JSON.stringify(written3) !== slot3Before) throw new Error("slot 3 mutated");
  if (written1?.topic !== TOPIC) throw new Error("slot 1 topic not written");
  if (!written1.instagram_caption.includes("/go/line.html?source=post")) {
    throw new Error("missing source=post");
  }
  if (written.written_by !== "contentPlan.writeDailyContent") {
    throw new Error(`bad writer ${written.written_by}`);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        written_by: written.written_by,
        checksum: written.content_checksum,
        topic: written1.topic,
        passport: written1.image_prompt.slice(0, 180),
        slides: written1.carousel_items?.map((item) => item.local_image_path),
        ig_has_source_post: written1.instagram_caption.includes("source=post"),
        fb_has_source_post: written1.facebook_caption.includes("source=post"),
        slot2_unchanged: true,
        slot3_unchanged: true
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
