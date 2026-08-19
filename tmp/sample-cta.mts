import { getConfig } from "../src/config.ts";
import { buildDailyContent, linePostRedirectUrl } from "../src/contentPlan.ts";
import { captionsFor } from "../src/scheduleReel.ts";

const config = getConfig();
const date = "2026-08-18";
const content = buildDailyContent(date, config);
const slot = content.slots.find((s) => s.slot === 1)!;
const blocks = slot.facebook_caption.split("\n\n");
const hashIdx = blocks.findIndex((b) => b.startsWith("#"));
const cta = hashIdx === -1 ? blocks.slice(-3) : blocks.slice(Math.max(0, hashIdx - 3), hashIdx + 1);
console.log("LINE_POST=" + linePostRedirectUrl());
console.log("SLOT1_FB_CTA_BEGIN");
console.log(cta.join("\n\n"));
console.log("SLOT1_FB_CTA_END");
console.log("SLOT1_IG_HAS_URL=" + String(slot.instagram_caption.includes(linePostRedirectUrl())));

const reel = captionsFor(
  {
    id: "sample",
    object_type: "shoes",
    hook: "白鞋泛黃，不是刷得不夠用力",
    close: "x",
    narration: "黃在鞋邊是膠氧化。",
    before_subject: "a",
    after_subject: "b"
  },
  0,
  date
);
const rblocks = reel.facebook.split("\n\n");
const rhash = rblocks.findIndex((b) => b.startsWith("#"));
const rcta = rhash === -1 ? rblocks.slice(-3) : rblocks.slice(Math.max(0, rhash - 3), rhash + 1);
console.log("REEL_FB_CTA_BEGIN");
console.log(rcta.join("\n\n"));
console.log("REEL_FB_CTA_END");
