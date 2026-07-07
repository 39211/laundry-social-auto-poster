import { buildGitHubPagesImageUrl } from "./githubPages";
import { relativeAssetPath } from "./paths";
import { DAILY_SCHEDULE } from "./scheduler";
import type { AppConfig, Category, DailyContent, DailySlot, TrafficRoute, VisualRoute } from "./types";

interface SlotTemplate {
  topic: string;
  caption: string;
  imagePrompt: string;
  visualRoute: VisualRoute;
  trafficRoute: TrafficRoute;
}

const brandLine = "私享家洗衣店";

const templates: Record<Category, SlotTemplate> = {
  知識文: {
    topic: "白鞋鞋邊與內裡的濕悶痕跡",
    caption: [
      "白鞋鞋邊如果開始泛灰，內裡又有一點濕悶味，先不要急著用漂白水或硬刷把表面刷白。",
      brandLine,
      "這類鞋子常見的問題不是單一髒污，而是鞋面材質、膠邊、縫線和鞋墊吸附狀態不一樣。處理前如果沒有分開看，容易讓鞋邊變毛、膠痕更明顯，或把內裡味道留住。",
      "我們會先看鞋面是皮革、布面還是合成材質，再檢查鞋邊磨耗、內裡濕氣、鞋墊能不能拆，以及髒污是表面灰塵還是已經滲進纖維。",
      "不確定能不能整理，先拍鞋面、鞋邊和內裡給我們看，我們再幫你判斷適合怎麼處理。",
      "#私享家洗衣店 #白鞋清潔 #鞋子保養"
    ].join("\n\n"),
    imagePrompt:
      "Realistic square shop photo inside a premium Taiwanese laundry and shoe-care counter: a pair of used white sneakers on a clean inspection table, visible grey edge marks and shoe lining, staff hands with neutral gloves gently checking the shoe edge, soft daylight, practical documentary style, no logo, no readable text, no poster design, no fake phone number, no watermark.",
    visualRoute: "shop-inspection",
    trafficRoute: "object-proof"
  },
  情境文: {
    topic: "雨季通勤後的包角與鞋底檢查",
    caption: [
      "雨季通勤後，包包四角和鞋底邊緣常常比外觀看起來更早累積水痕、泥灰和摩擦痕。",
      brandLine,
      "如果回家後直接收進鞋櫃或衣櫃，濕氣會悶在鞋內、包角或提把裡，下一次拿出來才發現味道變重，邊角也比較暗。",
      "我們會先看包包材質是皮革、尼龍還是帆布，再判斷包角是否只是表面灰、是否有水痕滲入；鞋子則會看鞋底邊緣、內裡濕氣和鞋墊狀態，避免用錯方式讓材質變硬或褪色。",
      "你可以先拍包角、提把、鞋底邊緣和鞋內照片傳來，我們幫你看狀態，再決定值不值得整理。",
      "#私享家洗衣店 #雨季保養 #鞋包清潔"
    ].join("\n\n"),
    imagePrompt:
      "Realistic square shop photo at a Taiwanese laundry care counter after a rainy commute: a damp everyday shoulder bag and a pair of commuter shoes placed on a clean inspection table, visible bag corners and shoe sole edges, absorbent towel nearby, staff hand pointing at material condition, warm natural light, documentary shop-photo look, no poster, no logo, no readable text, no fake address, no watermark.",
    visualRoute: "customer-consultation",
    trafficRoute: "value-prop-lead"
  }
};

export function buildDailyContent(date: string, config: AppConfig): DailyContent {
  const slots: DailySlot[] = DAILY_SCHEDULE.map((schedule) => {
    const template = templates[schedule.category];
    return {
      slot: schedule.slot,
      time: schedule.time,
      category: schedule.category,
      topic: template.topic,
      instagram_caption: template.caption,
      facebook_caption: template.caption,
      image_prompt: template.imagePrompt,
      visual_route: template.visualRoute,
      traffic_route: template.trafficRoute,
      local_image_path: relativeAssetPath(date, schedule.slot),
      public_image_url: config.publicImageBaseUrl
        ? buildGitHubPagesImageUrl(config.publicImageBaseUrl, date, schedule.slot)
        : "",
      status: "pending"
    };
  });

  return {
    date,
    timezone: config.timezone,
    generated_at: new Date().toISOString(),
    slots
  };
}
