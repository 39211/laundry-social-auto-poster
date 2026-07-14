import type { TrafficRoute, VisualRoute } from "./types";

export type GrowthFormat = "image-post" | "reel" | "carousel-guide" | "poster" | "real-shop-photo";

export interface GrowthPlaybookSlot {
  date: string;
  day: number;
  slot: number;
  time: string;
  phase: string;
  topic: string;
  format: GrowthFormat;
  visual_route: VisualRoute;
  traffic_route: TrafficRoute;
  views_target: number;
  follower_target: number;
  hook: string;
  follow_cta: string;
  caption: string;
  hashtags: string[];
  image_or_reel_direction: string;
  seo_sync_page: string;
  ten_day_review_metric: string;
}

export interface GrowthPlaybookDay {
  date: string;
  day: number;
  daily_views_target: number;
  daily_follower_target: number;
  phase: string;
  slots: GrowthPlaybookSlot[];
}

export interface GrowthPlaybook {
  brand: string;
  objective: string;
  start_date: string;
  end_date: string;
  timezone: string;
  cadence: string;
  source_method: string[];
  review_windows: ReviewWindow[];
  days: GrowthPlaybookDay[];
}

interface ReviewWindow {
  start_day: number;
  end_day: number;
  daily_views_target: number;
  daily_follower_target: number;
  review_metric: string;
}

interface TopicSeed {
  topic: string;
  service:
    | "white-shoe"
    | "shoe-bag"
    | "fabric-storage"
    | "local"
    | "photo-guide"
    | "shirt-suit"
    | "bedding-duvet"
    | "plush-doll"
    | "luxury-dry";
  visual: VisualRoute;
  traffic: TrafficRoute;
  tags: string[];
}

interface SpecialSlot {
  format: GrowthFormat;
  topic: string;
  service: TopicSeed["service"];
  visual: VisualRoute;
  traffic: TrafficRoute;
  tags: string[];
  direction: string;
}

const brand = "私享家洗衣店";
const timezone = "Asia/Taipei";

const reviewWindows: ReviewWindow[] = [
  {
    start_day: 1,
    end_day: 10,
    daily_views_target: 50,
    daily_follower_target: 1,
    review_metric: "建立基準：看 views、非粉觀看比例、IG/FB 來源占比、每日新增追蹤，先找出最不被滑掉且願意追蹤的物件主題。"
  },
  {
    start_day: 11,
    end_day: 20,
    daily_views_target: 100,
    daily_follower_target: 2,
    review_metric: "放大前 10 天高於中位數的 visual_route；低於 20 views 或無追蹤轉換的 topic 不再原樣重複。"
  },
  {
    start_day: 21,
    end_day: 30,
    daily_views_target: 180,
    daily_follower_target: 3,
    review_metric: "比較 image-post、carousel-guide、reel 的停留、分享與 follow conversion，決定第二階段短影音主軸。"
  },
  {
    start_day: 31,
    end_day: 40,
    daily_views_target: 300,
    daily_follower_target: 5,
    review_metric: "短影音週：每支 reel 看 3 秒觀看、完整觀看、非粉比例、追蹤轉換，淘汰太像硬廣的開頭。"
  },
  {
    start_day: 41,
    end_day: 50,
    daily_views_target: 450,
    daily_follower_target: 8,
    review_metric: "互動週：看留言、收藏、私訊題數、追蹤原因；把高保存率主題寫成 SEO guide 或 FAQ。"
  },
  {
    start_day: 51,
    end_day: 60,
    daily_views_target: 600,
    daily_follower_target: 12,
    review_metric: "在地週：比較台中西屯、青海路、通勤、開學關鍵詞帶來的觀看、追蹤與 LINE 詢問。"
  },
  {
    start_day: 61,
    end_day: 70,
    daily_views_target: 750,
    daily_follower_target: 18,
    review_metric: "轉換週：追蹤 profile visits、LINE click、Google Business actions、新增追蹤，確認觀看能變成關係與詢問。"
  },
  {
    start_day: 71,
    end_day: 80,
    daily_views_target: 900,
    daily_follower_target: 25,
    review_metric: "節慶週：比較中秋預告海報、真實門市照、短影音三種形式的非粉觀看與追蹤轉換。"
  },
  {
    start_day: 81,
    end_day: 90,
    daily_views_target: 1000,
    daily_follower_target: 35,
    review_metric: "收斂週：只保留前三名 topic family，每日檢查是否達到 1000+ views、穩定新增追蹤與詢問品質。"
  }
];

const knowledgeSeeds: TopicSeed[] = [
  { topic: "白鞋鞋邊泛灰前的檢查", service: "white-shoe", visual: "macro-detail", traffic: "object-proof", tags: ["#白鞋清潔", "#鞋子保養"] },
  { topic: "包包提把手汗與邊油痕", service: "shoe-bag", visual: "macro-detail", traffic: "object-proof", tags: ["#包包清潔", "#提把保養"] },
  { topic: "棉被收納前的濕氣與睡眠味", service: "fabric-storage", visual: "shop-inspection", traffic: "value-prop-lead", tags: ["#棉被清洗", "#布品收納"] },
  { topic: "深色衣服洗久變灰的判斷", service: "fabric-storage", visual: "shop-inspection", traffic: "dwell-detail", tags: ["#衣物保養", "#深色衣物"] },
  { topic: "外套領口袖口的日常油痕", service: "fabric-storage", visual: "macro-detail", traffic: "object-proof", tags: ["#外套清洗", "#領口袖口"] },
  { topic: "皮鞋雨痕與皺摺邊緣", service: "shoe-bag", visual: "customer-consultation", traffic: "trust-reset", tags: ["#皮鞋保養", "#雨天鞋子"] },
  { topic: "帆布鞋泥灰卡進織紋", service: "shoe-bag", visual: "macro-detail", traffic: "object-proof", tags: ["#帆布鞋清潔", "#鞋子清潔"] },
  { topic: "羽絨外套壓扁前的檢查", service: "fabric-storage", visual: "shop-inspection", traffic: "value-prop-lead", tags: ["#羽絨外套", "#換季收納"] },
  { topic: "抱枕飲料痕與布面味道", service: "fabric-storage", visual: "macro-detail", traffic: "dwell-detail", tags: ["#抱枕清洗", "#居家布品"] },
  { topic: "白襯衫領口與腋下泛黃", service: "fabric-storage", visual: "shop-inspection", traffic: "trust-reset", tags: ["#白襯衫", "#衣物清潔"] },
  { topic: "安全帽內襯和外套帽沿一起看", service: "fabric-storage", visual: "customer-consultation", traffic: "value-prop-lead", tags: ["#通勤外套", "#內襯清潔"] },
  { topic: "行李箱布面與輪子灰塵", service: "shoe-bag", visual: "shop-inspection", traffic: "share-worthy-care", tags: ["#旅行整理", "#行李箱清潔"] },
  { topic: "寵物毯毛絮與布面味道", service: "fabric-storage", visual: "macro-detail", traffic: "object-proof", tags: ["#寵物毯", "#布品清潔"] },
  { topic: "西裝外套肩線與袖口狀態", service: "fabric-storage", visual: "customer-consultation", traffic: "trust-reset", tags: ["#西裝清洗", "#外套保養"] },
  { topic: "鞋櫃收納前的乾燥判斷", service: "shoe-bag", visual: "macro-detail", traffic: "object-proof", tags: ["#鞋櫃收納", "#鞋子保養"] },
  { topic: "窗簾下緣灰塵與空氣味", service: "fabric-storage", visual: "macro-detail", traffic: "share-worthy-care", tags: ["#窗簾清洗", "#居家布品"] },
  { topic: "工作包內裡的粉痕與筆痕", service: "shoe-bag", visual: "shop-inspection", traffic: "dwell-detail", tags: ["#包包保養", "#內裡清潔"] },
  { topic: "夏季棉麻衣物的汗味殘留", service: "fabric-storage", visual: "shop-inspection", traffic: "value-prop-lead", tags: ["#夏季衣物", "#棉麻保養"] },
  { topic: "雨傘旁鞋包的濕氣轉移", service: "shoe-bag", visual: "customer-consultation", traffic: "trust-reset", tags: ["#雨天保養", "#鞋包照護"] },
  { topic: "童鞋內裡與鞋底邊緣", service: "white-shoe", visual: "macro-detail", traffic: "object-proof", tags: ["#童鞋清潔", "#白鞋保養"] },
  { topic: "牛仔褲膝蓋與口袋味道", service: "fabric-storage", visual: "shop-inspection", traffic: "dwell-detail", tags: ["#牛仔褲保養", "#衣物清洗"] },
  { topic: "針織外套起毛球前的狀態", service: "fabric-storage", visual: "macro-detail", traffic: "object-proof", tags: ["#針織外套", "#衣物保養"] },
  { topic: "枕頭套油痕與睡眠味", service: "fabric-storage", visual: "shop-inspection", traffic: "share-worthy-care", tags: ["#枕頭套", "#寢具清洗"] },
  { topic: "化妝包粉痕與拉鍊邊", service: "shoe-bag", visual: "macro-detail", traffic: "object-proof", tags: ["#化妝包清潔", "#包包保養"] },
  { topic: "真皮包邊角摩擦與油光", service: "shoe-bag", visual: "customer-consultation", traffic: "trust-reset", tags: ["#真皮包保養", "#包包清潔"] },
  { topic: "運動衣汗味與彈性纖維", service: "fabric-storage", visual: "shop-inspection", traffic: "value-prop-lead", tags: ["#運動衣", "#衣物保養"] },
  { topic: "旅行外套灰塵與行李味", service: "fabric-storage", visual: "customer-consultation", traffic: "share-worthy-care", tags: ["#旅行整理", "#外套清洗"] },
  { topic: "開學鞋襪的泥灰與汗味", service: "white-shoe", visual: "macro-detail", traffic: "object-proof", tags: ["#開學準備", "#童鞋清潔"] },
  { topic: "中秋烤肉後外套的煙味", service: "fabric-storage", visual: "shop-inspection", traffic: "share-worthy-care", tags: ["#中秋節", "#外套清洗"] },
  { topic: "國慶出遊鞋底與包角灰塵", service: "shoe-bag", visual: "customer-consultation", traffic: "value-prop-lead", tags: ["#國慶連假", "#鞋包照護"] },
  { topic: "襯衫領口與西裝內襯的送洗前判斷", service: "shirt-suit", visual: "shop-inspection", traffic: "object-proof", tags: ["#襯衫清洗", "#西裝乾洗"] },
  { topic: "床組與棉被填充受潮的送洗前判斷", service: "bedding-duvet", visual: "customer-consultation", traffic: "value-prop-lead", tags: ["#床組清洗", "#棉被清洗"] },
  { topic: "絨毛娃娃填充物與黏貼配件的檢查", service: "plush-doll", visual: "macro-detail", traffic: "object-proof", tags: ["#娃娃清洗", "#布偶清潔"] },
  { topic: "精品衣物洗標與飾件的送洗前判斷", service: "luxury-dry", visual: "customer-consultation", traffic: "trust-reset", tags: ["#精品乾洗", "#精緻乾洗"] }
];

const situationSeeds: TopicSeed[] = [
  { topic: "雨後通勤回家不要直接收鞋", service: "shoe-bag", visual: "customer-consultation", traffic: "value-prop-lead", tags: ["#雨天鞋子", "#通勤日常"] },
  { topic: "下班最常背的包先看提把", service: "shoe-bag", visual: "macro-detail", traffic: "object-proof", tags: ["#包包清潔", "#下班日常"] },
  { topic: "週末換季整理先分類布品", service: "fabric-storage", visual: "shop-inspection", traffic: "value-prop-lead", tags: ["#換季收納", "#布品清潔"] },
  { topic: "暑假旅行回來先處理外套", service: "fabric-storage", visual: "customer-consultation", traffic: "share-worthy-care", tags: ["#旅行整理", "#外套清洗"] },
  { topic: "孩子上學後鞋襪變悶", service: "white-shoe", visual: "macro-detail", traffic: "object-proof", tags: ["#開學準備", "#童鞋清潔"] },
  { topic: "梅雨季衣櫃味道先找來源", service: "fabric-storage", visual: "shop-inspection", traffic: "dwell-detail", tags: ["#雨季保養", "#衣櫃收納"] },
  { topic: "騎車族雨衣外套分開看", service: "fabric-storage", visual: "customer-consultation", traffic: "trust-reset", tags: ["#機車通勤", "#外套清洗"] },
  { topic: "健身房衣物不要悶在包裡", service: "fabric-storage", visual: "shop-inspection", traffic: "value-prop-lead", tags: ["#運動衣", "#汗味處理"] },
  { topic: "辦公室冷氣外套領口檢查", service: "fabric-storage", visual: "macro-detail", traffic: "object-proof", tags: ["#上班穿搭", "#外套保養"] },
  { topic: "搬家後棉被窗簾先除灰", service: "fabric-storage", visual: "shop-inspection", traffic: "share-worthy-care", tags: ["#搬家整理", "#寢具清洗"] },
  { topic: "聚餐後外套先聞再收", service: "fabric-storage", visual: "customer-consultation", traffic: "dwell-detail", tags: ["#聚餐後整理", "#外套清洗"] },
  { topic: "父親節襯衫皮鞋一起整理", service: "shoe-bag", visual: "shop-inspection", traffic: "share-worthy-care", tags: ["#父親節", "#皮鞋保養"] },
  { topic: "七夕約會後白鞋包包檢查", service: "shoe-bag", visual: "customer-consultation", traffic: "share-worthy-care", tags: ["#七夕", "#鞋包照護"] },
  { topic: "開學前制服外套和白鞋", service: "white-shoe", visual: "shop-inspection", traffic: "value-prop-lead", tags: ["#開學季", "#白鞋清潔"] },
  { topic: "颱風天後鞋包不要急著曬", service: "shoe-bag", visual: "customer-consultation", traffic: "trust-reset", tags: ["#颱風天", "#鞋包保養"] },
  { topic: "中秋烤肉後外套不要直接掛回去", service: "fabric-storage", visual: "macro-detail", traffic: "share-worthy-care", tags: ["#中秋節", "#外套清洗"] },
  { topic: "國慶連假行李鞋包整理", service: "shoe-bag", visual: "shop-inspection", traffic: "value-prop-lead", tags: ["#國慶連假", "#旅行整理"] },
  { topic: "客廳沙發毯用久會有生活味", service: "fabric-storage", visual: "macro-detail", traffic: "share-worthy-care", tags: ["#沙發毯", "#居家布品"] },
  { topic: "拜訪客戶前西裝先看袖口", service: "fabric-storage", visual: "customer-consultation", traffic: "trust-reset", tags: ["#西裝清洗", "#上班穿搭"] },
  { topic: "婚宴禮服回家先不要塞衣櫃", service: "fabric-storage", visual: "shop-inspection", traffic: "dwell-detail", tags: ["#禮服清潔", "#衣物保養"] },
  { topic: "雨傘滴水旁的包角容易先受影響", service: "shoe-bag", visual: "macro-detail", traffic: "object-proof", tags: ["#雨天保養", "#包包清潔"] },
  { topic: "夜市走一圈鞋底邊緣最誠實", service: "shoe-bag", visual: "macro-detail", traffic: "object-proof", tags: ["#鞋子清潔", "#台中生活"] },
  { topic: "青海路通勤回來先看鞋包", service: "local", visual: "customer-consultation", traffic: "value-prop-lead", tags: ["#青海路", "#台中西屯"] },
  { topic: "逢甲西屯人流多的鞋底灰", service: "local", visual: "macro-detail", traffic: "share-worthy-care", tags: ["#西屯生活", "#鞋子保養"] },
  { topic: "返家鞋櫃味道通常從一雙開始", service: "shoe-bag", visual: "shop-inspection", traffic: "dwell-detail", tags: ["#鞋櫃收納", "#鞋子清潔"] },
  { topic: "久放包包有霉味先不要硬擦", service: "shoe-bag", visual: "customer-consultation", traffic: "trust-reset", tags: ["#包包保養", "#霉味處理"] },
  { topic: "送洗前照片要拍哪些位置", service: "photo-guide", visual: "shop-inspection", traffic: "value-prop-lead", tags: ["#送洗前拍照", "#LINE詢問"] },
  { topic: "LINE傳照片時先補三個資訊", service: "photo-guide", visual: "customer-consultation", traffic: "value-prop-lead", tags: ["#LINE詢問", "#送洗前拍照"] },
  { topic: "每十天公開一次洗護觀察", service: "local", visual: "shop-inspection", traffic: "trust-reset", tags: ["#私享家觀察", "#台中西屯洗衣店"] },
  { topic: "客人最常忽略的是內裡和邊角", service: "shoe-bag", visual: "macro-detail", traffic: "object-proof", tags: ["#鞋包照護", "#洗護細節"] },
  { topic: "絨毛玩偶有汗味時先看五官和配件", service: "plush-doll", visual: "macro-detail", traffic: "object-proof", tags: ["#娃娃清洗", "#絨毛玩偶清潔"] },
  { topic: "精品衣物有舊污漬時先拍洗標", service: "luxury-dry", visual: "customer-consultation", traffic: "trust-reset", tags: ["#精品乾洗", "#名牌衣物清潔"] },
  { topic: "換季時西裝和襯衫不要一起悶收", service: "shirt-suit", visual: "customer-consultation", traffic: "share-worthy-care", tags: ["#西裝乾洗", "#襯衫清洗"] },
  { topic: "床組有潮味時先不要直接密封", service: "bedding-duvet", visual: "shop-inspection", traffic: "dwell-detail", tags: ["#床組清洗", "#寢具清洗"] }
];

const specialSlots: Record<string, Record<number, SpecialSlot>> = {
  "2026-08-05": {
    2: {
      format: "poster",
      topic: "父親節前：襯衫、皮鞋、外套整理提醒",
      service: "shirt-suit",
      visual: "customer-consultation",
      traffic: "share-worthy-care",
      tags: ["#父親節", "#皮鞋保養", "#外套清洗"],
      direction: "高級海報；深色襯衫、皮鞋、外套細節分層，文字少，主視覺清楚，提醒父親節前整理。"
    }
  },
  "2026-08-08": {
    1: {
      format: "real-shop-photo",
      topic: "父親節當天：爸爸常穿襯衫與皮鞋的門市檢查",
      service: "shirt-suit",
      visual: "shop-inspection",
      traffic: "trust-reset",
      tags: ["#父親節", "#皮鞋保養", "#襯衫清洗"],
      direction: "真實門市照片；襯衫領口、皮鞋鞋面、外套袖口放在櫃台，像實際送洗前檢查。"
    }
  },
  "2026-08-16": {
    2: {
      format: "poster",
      topic: "七夕前：白鞋與約會包的乾淨感提醒",
      service: "shoe-bag",
      visual: "macro-detail",
      traffic: "share-worthy-care",
      tags: ["#七夕", "#白鞋清潔", "#包包保養"],
      direction: "高級海報；白鞋鞋邊與小包提把近景，粉白與深灰平衡，不做廉價促銷感。"
    }
  },
  "2026-08-19": {
    1: {
      format: "real-shop-photo",
      topic: "七夕當天：約會後白鞋鞋邊與包角檢查",
      service: "shoe-bag",
      visual: "macro-detail",
      traffic: "object-proof",
      tags: ["#七夕", "#白鞋清潔", "#鞋包照護"],
      direction: "真實門市照片；白鞋鞋邊、包包四角、提把放在清潔櫃台，重點是物件細節。"
    }
  },
  "2026-09-18": {
    2: {
      format: "poster",
      topic: "中秋前：烤肉煙味與連假衣物整理預告",
      service: "fabric-storage",
      visual: "customer-consultation",
      traffic: "share-worthy-care",
      tags: ["#中秋節", "#外套清洗", "#連假整理"],
      direction: "高級節日前海報；外套、薄毯、鞋包分區，暗示烤肉煙味與連假整理，不要放食物主體。"
    }
  },
  "2026-09-25": {
    1: {
      format: "real-shop-photo",
      topic: "中秋當天：烤肉後外套與布品的門市判斷",
      service: "fabric-storage",
      visual: "shop-inspection",
      traffic: "value-prop-lead",
      tags: ["#中秋節", "#外套清洗", "#布品清潔"],
      direction: "真實門市照片；外套、薄毯、靠枕在櫃台分類，呈現節日後送洗判斷。"
    }
  },
  "2026-10-07": {
    2: {
      format: "poster",
      topic: "國慶連假前：旅行鞋包與外套整理提醒",
      service: "shoe-bag",
      visual: "customer-consultation",
      traffic: "share-worthy-care",
      tags: ["#國慶連假", "#旅行整理", "#鞋包照護"],
      direction: "高級連假海報；行李、鞋底、外套袖口以乾淨層次呈現，提醒出遊前後照護。"
    }
  },
  "2026-10-08": {
    1: {
      format: "real-shop-photo",
      topic: "國慶連假前一日：鞋底、包角、外套袖口實拍檢查",
      service: "local",
      visual: "shop-inspection",
      traffic: "value-prop-lead",
      tags: ["#國慶連假", "#台中西屯", "#鞋包照護"],
      direction: "真實門市照片；鞋底、包角、外套袖口在櫃台排開，像連假前整理清單。"
    }
  }
};

function addDays(date: string, offset: number): string {
  const start = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
}

function phaseForDay(day: number): string {
  if (day <= 30) return "Day 1-30 信任建立：懂物件、懂材質、懂判斷";
  if (day <= 60) return "Day 31-60 擴散互動：短影音、可收藏教學、在地情境";
  return "Day 61-90 放大轉換：有效主題系列化，導向 LINE 與 SEO";
}

function reviewForDay(day: number): ReviewWindow {
  const window = reviewWindows.find((item) => day >= item.start_day && day <= item.end_day);
  if (!window) throw new Error(`No review window for day ${day}`);
  return window;
}

function seoPageFor(service: TopicSeed["service"]): string {
  switch (service) {
    case "white-shoe":
      return "/services/white-shoe-cleaning.html";
    case "shoe-bag":
      return "/services/shoe-bag-care.html";
    case "fabric-storage":
      return "/services/fabric-storage.html";
    case "photo-guide":
      return "/guides/photo-before-laundry.html";
    case "local":
      return "/services/taichung-xitun-laundry.html";
    case "shirt-suit":
      return "/guides/shirt-suit-dry-cleaning.html";
    case "bedding-duvet":
      return "/guides/bedding-duvet-cleaning.html";
    case "plush-doll":
      return "/guides/plush-doll-cleaning.html";
    case "luxury-dry":
      return "/guides/luxury-dry-cleaning.html";
  }
}

function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

function baseFormat(date: string, slot: number, day: number): GrowthFormat {
  const dow = dayOfWeek(date);
  if (day % 10 === 0 && slot === 1) return "carousel-guide";
  if (slot === 2 && (dow === 2 || dow === 4 || dow === 6)) return "reel";
  if (slot === 1 && dow === 3 && day > 30) return "reel";
  return "image-post";
}

function topicForPhase(seed: TopicSeed, day: number, slot: number): string {
  if (day <= 30) return slot === 1 ? `先看懂：${seed.topic}` : `今天情境：${seed.topic}`;
  if (day <= 60) {
    return slot === 1 ? `可收藏：${seed.topic}，送洗前先看三個位置` : `細節拆解：${seed.topic}，先看容易忽略的位置`;
  }
  return slot === 1 ? `到店前判斷：${seed.topic}，照片要補哪些細節` : `送洗前先問：${seed.topic}，門市會先確認什麼`;
}

function hookFor(topic: string, format: GrowthFormat): string {
  if (format === "poster") return `${topic}，這篇先提醒你什麼時間點最該整理。`;
  if (format === "reel") return `${topic}，用 15 秒看懂材質與狀況判斷。`;
  if (format === "carousel-guide") return `${topic}，這篇可以先收藏，送洗前照著看。`;
  return `${topic}，重點不是急著洗，是先看材質、位置和狀態。`;
}

function followCtaFor(format: GrowthFormat, service: TopicSeed["service"]): string {
  if (format === "poster") return "追蹤私享家，節日前後的送洗提醒會先幫你排好。";
  if (format === "reel") return "想每週用短影音看懂衣物、鞋包和布品細節，可以先追蹤私享家。";
  if (format === "carousel-guide") return "這類送洗前檢查清單會持續整理，先追蹤起來比較不會臨時找不到。";
  if (service === "white-shoe" || service === "shoe-bag") {
    return "追蹤私享家，之後會持續整理鞋子、包包和白鞋的日常照護判斷。";
  }
  if (service === "fabric-storage") {
    return "追蹤私享家，之後會持續整理衣物、寢具和收納前的洗護判斷。";
  }
  if (service === "shirt-suit") {
    return "追蹤私享家，之後會持續整理襯衫、西裝與精緻衣物的送洗前判斷。";
  }
  if (service === "bedding-duvet") {
    return "追蹤私享家，之後會持續整理床組、棉被與寢具的清洗和收納判斷。";
  }
  if (service === "plush-doll") {
    return "追蹤私享家，之後會持續整理娃娃、布偶與絨毛玩偶的清潔判斷。";
  }
  if (service === "luxury-dry") {
    return "追蹤私享家，之後會持續整理精品衣物與精緻材質的送洗前判斷。";
  }
  return "追蹤私享家，之後會持續整理台中西屯在地送洗前的實用判斷。";
}

function captionFor(topic: string, service: TopicSeed["service"], format: GrowthFormat, followCta: string): string {
  const serviceLine =
    service === "shoe-bag" || service === "white-shoe"
      ? "鞋子、包包的邊角、內裡和提把，常常比外觀看起來更早留下濕氣、摩擦或灰塵。"
      : service === "fabric-storage"
        ? "衣物、寢具和布品在收納前，最怕把濕氣、味道和細小髒污一起封進櫃子。"
        : service === "shirt-suit"
          ? "襯衫領口袖口與西裝內襯、飾件，要分別看材質、洗標和既有痕跡。"
          : service === "bedding-duvet"
            ? "床組、棉被和寢具要一起看表布、填充、尺寸與受潮狀況。"
            : service === "plush-doll"
              ? "娃娃與絨毛玩偶要先看填充物、五官、刺繡和黏貼配件。"
              : service === "luxury-dry"
                ? "精品與精緻材質要先看洗標、面料、五金、飾件和既有磨損。"
        : "來店前先拍清楚位置，私享家比較能依物件狀態給你初步判斷。";
  const formatLine =
    format === "reel"
      ? "近看邊角、內裡與材質，通常比只看整體外觀更容易找到問題。"
      : format === "poster"
        ? "節日前先把需要整理的物件分開檢查，比到最後一天才一次處理更從容。"
        : format === "carousel-guide"
          ? "送洗前依序看完整外觀、局部、內裡與洗標，判斷會更清楚。"
          : "先看材質、髒污位置與既有磨損，再決定下一步會比較穩。";

  return `${topic}。\n\n${brand}\n\n${serviceLine}\n\n${formatLine}\n\n如果你也遇到類似狀況，可以先拍下正面、邊角、內裡或髒污位置，再傳 LINE 讓我們初步看材質與處理方向。\n\n${followCta}`;
}

function directionFor(topic: string, format: GrowthFormat, visual: VisualRoute): string {
  if (format === "reel") {
    return `9:16 短影音：開頭 2 秒直接近拍「${topic}」，第二鏡手指指出邊角/內裡/布面，第三鏡回到門市櫃台判斷；不加浮誇字幕。`;
  }
  if (format === "carousel-guide") {
    return `輪播 4 張：1 主物件近拍、2 要看哪個位置、3 不建議自己硬刷/悶收、4 傳 LINE 前拍照清單；風格乾淨高級。`;
  }
  if (format === "poster") {
    return `高級海報：${topic}；背景用物件透視層次，文字少且清楚，類 Apple 產品頁留白，不要像促銷傳單。`;
  }
  return `真實門市照片：${visual} 路線，物件放在乾淨櫃台，手部檢查材質或邊角，光線明亮，不放假品牌、不做誇張對比。`;
}

function hashtagsFor(seed: TopicSeed, extra: string[] = []): string[] {
  const hashtags = Array.from(new Set(["#私享家洗衣店", "#台中西屯洗衣店", ...seed.tags, ...extra]));
  for (const fallback of ["#洗護日常", "#送洗前檢查", "#衣物照護"]) {
    if (hashtags.length >= 4) break;
    hashtags.push(fallback);
  }
  return hashtags.slice(0, 4);
}

function slotTarget(dailyTarget: number, slot: number): number {
  return Math.round(dailyTarget * (slot === 1 ? 0.45 : 0.55));
}

function followerTarget(dailyTarget: number, slot: number): number {
  return Math.max(1, Math.round(dailyTarget * (slot === 1 ? 0.45 : 0.55)));
}

function buildSituationSeedOrder(): TopicSeed[] {
  const matchedKnowledgeBySituation = Array<number>(situationSeeds.length).fill(-1);

  function assign(knowledgeIndex: number, seen: Set<number>): boolean {
    const knowledgeSeed = knowledgeSeeds[knowledgeIndex];
    if (!knowledgeSeed) return false;

    for (let situationIndex = 0; situationIndex < situationSeeds.length; situationIndex += 1) {
      const candidate = situationSeeds[situationIndex];
      if (!candidate || seen.has(situationIndex) || candidate.service === knowledgeSeed.service) continue;
      seen.add(situationIndex);

      const previousKnowledge = matchedKnowledgeBySituation[situationIndex] ?? -1;
      if (previousKnowledge === -1 || assign(previousKnowledge, seen)) {
        matchedKnowledgeBySituation[situationIndex] = knowledgeIndex;
        return true;
      }
    }
    return false;
  }

  for (let knowledgeIndex = 0; knowledgeIndex < knowledgeSeeds.length; knowledgeIndex += 1) {
    if (!assign(knowledgeIndex, new Set())) {
      throw new Error(`Unable to diversify situation seed for knowledge index ${knowledgeIndex}`);
    }
  }

  const ordered = Array<TopicSeed | undefined>(knowledgeSeeds.length);
  for (let situationIndex = 0; situationIndex < matchedKnowledgeBySituation.length; situationIndex += 1) {
    const knowledgeIndex = matchedKnowledgeBySituation[situationIndex] ?? -1;
    const situationSeed = situationSeeds[situationIndex];
    if (knowledgeIndex >= 0 && situationSeed) ordered[knowledgeIndex] = situationSeed;
  }
  if (ordered.some((seed) => !seed)) throw new Error("Incomplete diversified situation seed order");
  return ordered as TopicSeed[];
}

const situationSeedOrder = buildSituationSeedOrder();

function seedForSlot(day: number, slot: number): TopicSeed | undefined {
  const knowledgeSeed = knowledgeSeeds[(day - 1) % knowledgeSeeds.length];
  if (slot === 1) return knowledgeSeed;
  if (day <= 4) return situationSeeds[(day - 1) % situationSeeds.length];
  return situationSeedOrder[(day - 1) % situationSeedOrder.length];
}

function buildSlot(date: string, day: number, slot: number): GrowthPlaybookSlot {
  const time = slot === 1 ? "11:30" : "19:30";
  const special = specialSlots[date]?.[slot];
  const seed = seedForSlot(day, slot);
  if (!seed) throw new Error(`Missing seed for day ${day} slot ${slot}`);
  const review = reviewForDay(day);

  const topic = special?.topic ?? topicForPhase(seed, day, slot);
  const format = special?.format ?? baseFormat(date, slot, day);
  const visual = special?.visual ?? seed.visual;
  const traffic = special?.traffic ?? seed.traffic;
  const service = special?.service ?? seed.service;
  const tags = special ? hashtagsFor({ ...seed, tags: special.tags }) : hashtagsFor(seed);
  const followCta = followCtaFor(format, service);

  return {
    date,
    day,
    slot,
    time,
    phase: phaseForDay(day),
    topic,
    format,
    visual_route: visual,
    traffic_route: traffic,
    views_target: slotTarget(review.daily_views_target, slot),
    follower_target: followerTarget(review.daily_follower_target, slot),
    hook: hookFor(topic, format),
    follow_cta: followCta,
    caption: captionFor(topic, service, format, followCta),
    hashtags: tags,
    image_or_reel_direction: special?.direction ?? directionFor(topic, format, visual),
    seo_sync_page: seoPageFor(service),
    ten_day_review_metric: review.review_metric
  };
}

export function buildGrowthPlaybook(startDate = "2026-07-11", totalDays = 90): GrowthPlaybook {
  const days: GrowthPlaybookDay[] = Array.from({ length: totalDays }, (_, index) => {
    const day = index + 1;
    const date = addDays(startDate, index);
    const review = reviewForDay(day);
    return {
      date,
      day,
      daily_views_target: review.daily_views_target,
      daily_follower_target: review.daily_follower_target,
      phase: phaseForDay(day),
      slots: [buildSlot(date, day, 1), buildSlot(date, day, 2)]
    };
  });

  const lastDay = days.at(-1);
  if (!lastDay) throw new Error("Growth playbook needs at least one day");

  return {
    brand,
    objective: "90 天內把私享家 FB/IG/SEO 內容從低基準推進到每日 1000+ 觀看，同時建立穩定新增追蹤，並同步觀察 LINE/私訊詢問品質。",
    start_date: startDate,
    end_date: lastDay.date,
    timezone,
    cadence: "每天 2 則：11:30 知識/判斷型，19:30 情境/擴散型；重大節日與合格活動用海報，其餘以真實門市照片或短影音為主。",
    source_method: [
      "參考 90 天日更 playbook 的北極星指標、三階段主題弧線、內容支柱、CTA、Hashtag、圖片方向與 10 日複盤方式。",
      "改寫為私享家適用的觀看數與漲粉模型：views、非粉觀看、follower growth、visual_route、traffic_route、hashtags、LINE/私訊詢問。",
      "節日節點採節日前預告海報，節日當天或連假後用真實門市照片補一篇。"
    ],
    review_windows: reviewWindows,
    days
  };
}

export function flattenGrowthPlaybook(playbook: GrowthPlaybook): GrowthPlaybookSlot[] {
  return playbook.days.flatMap((day) => day.slots);
}
