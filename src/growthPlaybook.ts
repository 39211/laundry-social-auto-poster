import type {
  CompanionMediaPackagePlan,
  ContentRole,
  TrafficRoute,
  VideoCandidatePlan,
  VisualRoute
} from "./types";
import {
  AI_VISIBILITY_REVIEW_28D,
  COMMUNITY_PRACTICE_SOURCES,
  SEARCH_INTENT_CLUSTERS,
  searchVisibilityForContent,
  type SearchEvidenceType,
  type SearchIntentCluster,
  type SearchIntentId
} from "./searchVisibilityStrategy";

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
  content_role: ContentRole;
  views_target: number;
  follower_target: number;
  hook: string;
  follow_cta: string;
  caption: string;
  hashtags: string[];
  image_or_reel_direction: string;
  seo_sync_page: string;
  search_intent: SearchIntentId;
  target_queries: string[];
  evidence_type: SearchEvidenceType;
  ten_day_review_metric: string;
  campaign?: "taichung-free-pickup-delivery";
  story?: string;
  service_message?: string;
  action_cta?: string;
  instagram_action_cta?: string;
  video_prompt?: string;
  video_candidate?: VideoCandidatePlan;
  media_package?: CompanionMediaPackagePlan;
  facebook_caption?: string;
  instagram_caption?: string;
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
  search_intent_clusters: SearchIntentCluster[];
  ai_visibility_review_28d: typeof AI_VISIBILITY_REVIEW_28D;
  community_practice_sources: typeof COMMUNITY_PRACTICE_SOURCES;
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
    | "luxury-dry"
    | "pickup-delivery";
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
  campaign?: "taichung-free-pickup-delivery";
  hook?: string;
  story?: string;
  service_message?: string;
  action_cta?: string;
  instagram_action_cta?: string;
  follow_cta?: string;
  video_prompt?: string;
  video_candidate?: VideoCandidatePlan;
  facebook_caption?: string;
  instagram_caption?: string;
}

const brand = "私享家洗衣店";
const timezone = "Asia/Taipei";
export const COMPANION_MEDIA_START_DATE = "2026-07-29";

function companionMediaPackage(date: string): CompanionMediaPackagePlan | undefined {
  if (date < COMPANION_MEDIA_START_DATE) return undefined;
  return {
    status: "planned_unpublished",
    effective_date: COMPANION_MEDIA_START_DATE,
    image_count: 4,
    image_aspect_ratio: "4:5",
    companion_video_required: true,
    video_master_aspect_ratio: "9:16",
    instagram_delivery: "mixed-carousel-candidate",
    facebook_delivery: "paired-video-candidate",
    platform_preflight_required: true,
    publish_authorized: false,
    included_in_kpi: false
  };
}

function topicObject(topic: string, service: TopicSeed["service"]): string {
  if (/床單|被套|棉被|床組|枕/.test(topic)) return "床單被套與床組";
  if (/童鞋/.test(topic)) return "童鞋";
  if (/鞋/.test(topic) && /包/.test(topic)) return "鞋子和包包";
  if (/鞋/.test(topic)) return "鞋子";
  if (/襯衫/.test(topic) && /西裝/.test(topic)) return "襯衫和西裝";
  if (/襯衫/.test(topic)) return "襯衫";
  if (/西裝/.test(topic)) return "西裝";
  if (/運動/.test(topic)) return "運動衣";
  if (/牛仔/.test(topic)) return "牛仔褲";
  if (/娃娃|玩偶/.test(topic)) return "娃娃";
  if (/包/.test(topic)) return "包包";
  if (/針織/.test(topic)) return "針織衣物";
  if (/棉麻/.test(topic)) return "棉麻衣物";
  if (service === "luxury-dry") return "精品衣物";
  if (service === "shirt-suit") return "襯衫和西裝";
  if (service === "fabric-storage") return "衣物";
  return "衣物";
}

function companionVideoCandidate(
  topic: string,
  service: TopicSeed["service"],
  slot: number
): VideoCandidatePlan {
  const object = topicObject(topic, service);
  const isPickup = slot === 2 || service === "pickup-delivery";
  const isShoe = /鞋/.test(object);
  const isBedding = /床|被|枕/.test(object);
  const isBag = /包包/.test(object) && !isShoe;
  const isDoll = /娃娃/.test(object);

  if (isPickup) {
    const pickupAction = isShoe
      ? {
          conflict: "一雙鞋已配對放好，但旁邊的藍色編織袋袋口仍未打開。",
          actionZh: "同一隻成人手只把藍色編織袋前側提把向前拉開，鞋子全程保持不動。",
          sceneEn:
            "exactly one paired set of unbranded sneakers on the floor mat in the foreground and one small low-profile blue woven polypropylene laundry bag on the bench in the midground",
          actionEn:
            "pull only the front bag handle forward until the bag opening is clearly visible; both shoes remain completely stationary",
          preserveEn:
            "Preserve exactly two shoes, complete laces and tongues, two bag handles with four attachment points"
        }
      : isBag
        ? {
            conflict: "包包已拍好狀態，但旁邊的藍色編織袋袋口仍未打開。",
            actionZh: "同一隻成人手只把藍色編織袋前側提把向前拉開，包包全程保持不動。",
            sceneEn:
              "one complete unbranded structured handbag in the foreground and one small low-profile blue woven polypropylene laundry bag on the bench in the midground",
            actionEn:
              "pull only the front bag handle forward until the bag opening is clearly visible; the structured handbag remains completely stationary",
            preserveEn:
              "Preserve exactly one structured handbag, its two handles and attachment points, and two complete blue-bag handles"
          }
        : {
            conflict: `${object}已折好放在長凳上，旁邊的藍色編織袋仍是空的。`,
            actionZh: `同一隻成人手只把一件完整折好的${isBedding ? "被套" : isDoll ? "娃娃" : "衣物"}放入藍色編織袋，袋子全程留在長凳上。`,
            sceneEn:
              `one complete ${isBedding ? "folded duvet cover" : isDoll ? "plush doll" : "folded garment"} in the foreground and one ${isBedding ? "large" : "small"} low-profile blue woven polypropylene laundry bag on the bench in the midground`,
            actionEn:
              `lift the single complete ${isBedding ? "folded duvet cover" : isDoll ? "plush doll" : "folded garment"} and place it fully into the open blue bag`,
            preserveEn:
              `Preserve exactly one ${isBedding ? "duvet cover" : isDoll ? "plush doll" : "garment"}, two complete bag handles with four attachment points`
          };
    return {
      status: "concept_ready",
      memory_hook: `${object}也可以送洗`,
      conflict: pickupAction.conflict,
      single_action: pickupAction.actionZh,
      payoff: "不用自己扛去門市，先拍照、分袋，再用 LINE 預約收送。",
      cta: "台中市全區免費收送；點個人檔案連結加 LINE 預約。",
      duration_seconds: 12,
      aspect_ratio: "9:16",
      first_frame_direction:
        `固定直式中近景；前景是完整${object}，中景是${isBedding ? "較寬但不過高" : "較矮小型"}藍色編織袋，背景保留暖色門燈與乾淨牆面形成景深；物件數量、袋體、提把與固定點完整，無人物頭部、無雨傘、無文字。`,
      grok_motion_prompt:
        `Create one continuous 6-second 9:16 photorealistic Taiwanese apartment-entryway shot about ${object}. Fixed medium-close camera with layered depth: ${pickupAction.sceneEn}, and a softly lit doorway in the background. One adult hand performs one dominant action only: ${pickupAction.actionEn}. The blue bag remains on the bench and deforms naturally. ${pickupAction.preserveEn}, five fingers, realistic contact shadows and material weight. No person head, no umbrella, no extra limbs, no duplicate object, no morphing, no floating, no wall or bag penetration, no text, no logo, no watermark. End on the completed action and hold for one second.`,
      fallback_media_type: "image"
    };
  }

  const inspectionAction = isShoe
    ? {
        conflict: "右腳鞋口仍朝側面，內裡與後跟位置第一眼看不完整。",
        actionZh: "同一隻成人手只把右腳鞋旋轉約三十度，讓鞋口與後跟內裡朝向鏡頭；左腳鞋全程不動。",
        sceneEn:
          "exactly one paired set of unbranded sneakers in the foreground, the right shoe opening angled away from camera",
        actionEn:
          "rotate only the right shoe about thirty degrees until its opening and heel lining face the camera; the left shoe remains stationary",
        preserveEn: "Preserve exactly two shoes with complete laces, tongues, soles and heel geometry"
      }
    : isBedding
      ? {
          conflict: "折好的床組洗標仍被布料邊緣蓋住，材質資訊看不完整。",
          actionZh: "同一隻成人手只掀起一個既有布角，露出縫在原位的洗標後停住。",
          sceneEn: "one complete folded duvet cover in the foreground with its sewn care label hidden under one existing corner",
          actionEn: "lift only that existing fabric corner to reveal the attached care label, then stop",
          preserveEn: "Preserve exactly one duvet cover, its seams, folds and attached care label"
        }
      : isBag
        ? {
            conflict: "包包底角仍背向鏡頭，磨擦位置第一眼看不完整。",
            actionZh: "同一隻成人手只把完整包包旋轉約二十度，讓底角與側邊朝向鏡頭後停住。",
            sceneEn: "one complete unbranded structured handbag in the foreground with one bottom corner angled away from camera",
            actionEn: "rotate the complete handbag about twenty degrees until the bottom corner and side edge face the camera, then stop",
            preserveEn: "Preserve exactly one handbag, two handles, four attachment points, seams and rigid geometry"
          }
        : isDoll
          ? {
              conflict: "娃娃側邊縫線仍背向鏡頭，接縫狀態第一眼看不完整。",
              actionZh: "同一隻成人手只把完整娃娃旋轉約二十度，讓側邊縫線朝向鏡頭後停住。",
              sceneEn: "one complete plush doll in the foreground with its side seam angled away from camera",
              actionEn: "rotate the complete plush doll about twenty degrees until its side seam faces the camera, then stop",
              preserveEn: "Preserve exactly one plush doll, all limbs, facial features, seams and stuffing volume"
            }
          : {
              conflict: `${object}的領口或布邊仍折在內側，接觸皮膚的位置第一眼看不完整。`,
              actionZh: `同一隻成人手只掀開${object}的一個既有領口或布邊，露出內側後停住。`,
              sceneEn: `one complete ${/西裝/.test(object) ? "jacket" : "garment"} in the foreground with one existing collar or hem folded inward`,
              actionEn: "lift only that existing collar or hem to reveal the inside surface, then stop",
              preserveEn: "Preserve exactly one garment, its sleeves, collar, seams and natural folds"
            };

  return {
    status: "concept_ready",
    memory_hook: `${object}也可以送洗`,
    conflict: inspectionAction.conflict,
    single_action: inspectionAction.actionZh,
    payoff: "先看材質、位置與原始狀態，再決定怎麼處理。",
    cta: "拍全貌、局部與洗標，點個人檔案連結加 LINE 先詢問。",
    duration_seconds: 12,
    aspect_ratio: "9:16",
    first_frame_direction:
      `固定直式微距中近景；完整${object}位於乾淨檢查台前景，檢查燈與收納托盤形成中後景層次；只有一隻手停在既有可動位置，物件數量、材質、縫線與接觸陰影清楚，無文字。`,
    grok_motion_prompt:
      `Create one continuous 6-second 9:16 photorealistic Taiwanese laundry inspection-counter shot about ${object}. Fixed close camera with layered depth: ${inspectionAction.sceneEn}, a clean inspection tray in the midground, and one softly glowing practical lamp in the background. One adult hand performs one dominant action only: ${inspectionAction.actionEn}. ${inspectionAction.preserveEn}, five fingers, realistic weight and contact shadows. No cleaning transformation, no extra hands, no duplicate object, no morphing, no penetration, no readable text, no logo, no watermark. End on the revealed detail and hold for one second.`,
    fallback_media_type: "image"
  };
}

const reviewWindows: ReviewWindow[] = [
  {
    start_day: 1,
    end_day: 10,
    daily_views_target: 50,
    daily_follower_target: 1,
    review_metric:
      "建立真實基準：記錄非粉絲觸及、平均觀看、收藏、分享、搜尋曝光、LINE 點擊與預約；建立固定 AI 問題面板，缺失資料保留 null。"
  },
  {
    start_day: 11,
    end_day: 20,
    daily_views_target: 100,
    daily_follower_target: 2,
    review_metric:
      "每篇發布滿 72 小時後，比較非粉絲觸及、收藏、分享、LINE 點擊與預約；缺少資料時保留 null。每天固定一篇觸及內容、一篇證據或轉換內容。"
  },
  {
    start_day: 21,
    end_day: 30,
    daily_views_target: 180,
    daily_follower_target: 3,
    review_metric:
      "比較 image-post、carousel-guide、reel 的停留、分享、LINE 點擊與預約；同步檢查 GSC、Bing 與 AI 問題面板中的曝光、品牌提及和引用網址。"
  },
  {
    start_day: 31,
    end_day: 40,
    daily_views_target: 300,
    daily_follower_target: 5,
    review_metric:
      "短影音週：每支 Reel 看 3 秒觀看、平均觀看時間、完整觀看、分享、非粉比例與 LINE 點擊；淘汰太像硬廣且沒有後續行動的開頭。"
  },
  {
    start_day: 41,
    end_day: 50,
    daily_views_target: 450,
    daily_follower_target: 8,
    review_metric:
      "答案資產週：把高收藏、高分享與真實詢問題目寫成可索引答案頁；分開記錄搜尋 CTR、AI 品牌提及、引用率與被引用頁面。"
  },
  {
    start_day: 51,
    end_day: 60,
    daily_views_target: 600,
    daily_follower_target: 12,
    review_metric:
      "在地週：分開比較 Local Pack、自然搜尋與 AI 答案；檢查台中全區免費收送、西屯、青海路與洗鞋查詢帶來的 LINE 詢問與預約。"
  },
  {
    start_day: 61,
    end_day: 70,
    daily_views_target: 750,
    daily_follower_target: 18,
    review_metric:
      "轉換週：追蹤內容或查詢到個人檔案、LINE 點擊、詢問、預約與營收的完整漏斗；引用或觀看增加但沒有轉換時不得判定成功。"
  },
  {
    start_day: 71,
    end_day: 80,
    daily_views_target: 900,
    daily_follower_target: 25,
    review_metric:
      "節慶週：比較預告海報、真實門市照與短影音的非粉觸及、分享、LINE 點擊與預約，不用單純發文數或觀看目標代替成果。"
  },
  {
    start_day: 81,
    end_day: 90,
    daily_views_target: 1000,
    daily_follower_target: 35,
    review_metric:
      "收斂週：只保留能同時帶來有效觸及、搜尋或 AI 能見度及 LINE 預約的前三名題組；以滿 72 小時的實際資料決定下一輪。"
  }
];

const knowledgeSeeds: TopicSeed[] = [
  { topic: "白鞋鞋邊泛灰前的檢查", service: "white-shoe", visual: "macro-detail", traffic: "object-proof", tags: ["#白鞋清潔", "#鞋子保養"] },
  { topic: "包包提把手汗與邊油痕", service: "shoe-bag", visual: "customer-consultation", traffic: "object-proof", tags: ["#包包清潔", "#提把保養"] },
  { topic: "棉被收納前的濕氣與睡眠味", service: "fabric-storage", visual: "shop-inspection", traffic: "value-prop-lead", tags: ["#棉被清洗", "#布品收納"] },
  { topic: "深色衣服洗久變灰的判斷", service: "fabric-storage", visual: "shop-inspection", traffic: "dwell-detail", tags: ["#衣物保養", "#深色衣物"] },
  { topic: "外套領口袖口的日常油痕", service: "fabric-storage", visual: "shop-inspection", traffic: "object-proof", tags: ["#外套清洗", "#領口袖口"] },
  { topic: "皮鞋雨痕與皺摺邊緣", service: "shoe-bag", visual: "customer-consultation", traffic: "trust-reset", tags: ["#皮鞋保養", "#雨天鞋子"] },
  { topic: "帆布鞋泥灰卡進織紋", service: "shoe-bag", visual: "macro-detail", traffic: "object-proof", tags: ["#帆布鞋清潔", "#鞋子清潔"] },
  { topic: "羽絨外套壓扁前的檢查", service: "fabric-storage", visual: "shop-inspection", traffic: "value-prop-lead", tags: ["#羽絨外套", "#換季收納"] },
  { topic: "抱枕飲料痕與布面味道", service: "fabric-storage", visual: "shop-inspection", traffic: "dwell-detail", tags: ["#抱枕清洗", "#居家布品"] },
  { topic: "白襯衫領口與腋下泛黃", service: "fabric-storage", visual: "shop-inspection", traffic: "trust-reset", tags: ["#白襯衫", "#衣物清潔"] },
  { topic: "安全帽內襯和外套帽沿一起看", service: "fabric-storage", visual: "customer-consultation", traffic: "value-prop-lead", tags: ["#通勤外套", "#內襯清潔"] },
  { topic: "行李箱布面與輪子灰塵", service: "shoe-bag", visual: "shop-inspection", traffic: "share-worthy-care", tags: ["#旅行整理", "#行李箱清潔"] },
  { topic: "寵物毯毛絮與布面味道", service: "fabric-storage", visual: "customer-consultation", traffic: "object-proof", tags: ["#寵物毯", "#布品清潔"] },
  { topic: "西裝外套肩線與袖口狀態", service: "fabric-storage", visual: "customer-consultation", traffic: "trust-reset", tags: ["#西裝清洗", "#外套保養"] },
  { topic: "鞋櫃收納前的乾燥判斷", service: "shoe-bag", visual: "shop-inspection", traffic: "object-proof", tags: ["#鞋櫃收納", "#鞋子保養"] },
  { topic: "窗簾下緣灰塵與空氣味", service: "fabric-storage", visual: "shop-inspection", traffic: "share-worthy-care", tags: ["#窗簾清洗", "#居家布品"] },
  { topic: "工作包內裡的粉痕與筆痕", service: "shoe-bag", visual: "shop-inspection", traffic: "dwell-detail", tags: ["#包包保養", "#內裡清潔"] },
  { topic: "夏季棉麻衣物的汗味殘留", service: "fabric-storage", visual: "shop-inspection", traffic: "value-prop-lead", tags: ["#夏季衣物", "#棉麻保養"] },
  { topic: "雨傘旁鞋包的濕氣轉移", service: "shoe-bag", visual: "customer-consultation", traffic: "trust-reset", tags: ["#雨天保養", "#鞋包照護"] },
  { topic: "童鞋內裡與鞋底邊緣", service: "white-shoe", visual: "customer-consultation", traffic: "object-proof", tags: ["#童鞋清潔", "#白鞋保養"] },
  { topic: "牛仔褲膝蓋與口袋味道", service: "fabric-storage", visual: "shop-inspection", traffic: "dwell-detail", tags: ["#牛仔褲保養", "#衣物清洗"] },
  { topic: "針織外套起毛球前的狀態", service: "fabric-storage", visual: "macro-detail", traffic: "object-proof", tags: ["#針織外套", "#衣物保養"] },
  { topic: "枕頭套油痕與睡眠味", service: "fabric-storage", visual: "shop-inspection", traffic: "share-worthy-care", tags: ["#枕頭套", "#寢具清洗"] },
  { topic: "化妝包粉痕與拉鍊邊", service: "shoe-bag", visual: "customer-consultation", traffic: "object-proof", tags: ["#化妝包清潔", "#包包保養"] },
  { topic: "真皮包邊角摩擦與油光", service: "shoe-bag", visual: "customer-consultation", traffic: "trust-reset", tags: ["#真皮包保養", "#包包清潔"] },
  { topic: "運動衣汗味與彈性纖維", service: "fabric-storage", visual: "shop-inspection", traffic: "value-prop-lead", tags: ["#運動衣", "#衣物保養"] },
  { topic: "旅行外套灰塵與行李味", service: "fabric-storage", visual: "customer-consultation", traffic: "share-worthy-care", tags: ["#旅行整理", "#外套清洗"] },
  { topic: "開學鞋襪的泥灰與汗味", service: "white-shoe", visual: "customer-consultation", traffic: "object-proof", tags: ["#開學準備", "#童鞋清潔"] },
  { topic: "中秋烤肉後外套的煙味", service: "fabric-storage", visual: "shop-inspection", traffic: "share-worthy-care", tags: ["#中秋節", "#外套清洗"] },
  { topic: "國慶出遊鞋底與包角灰塵", service: "shoe-bag", visual: "customer-consultation", traffic: "value-prop-lead", tags: ["#國慶連假", "#鞋包照護"] },
  { topic: "襯衫領口與西裝內襯的送洗前判斷", service: "shirt-suit", visual: "shop-inspection", traffic: "object-proof", tags: ["#襯衫清洗", "#西裝乾洗"] },
  { topic: "床組與棉被填充受潮的送洗前判斷", service: "bedding-duvet", visual: "customer-consultation", traffic: "value-prop-lead", tags: ["#床組清洗", "#棉被清洗"] },
  { topic: "絨毛娃娃填充物與黏貼配件的檢查", service: "plush-doll", visual: "customer-consultation", traffic: "object-proof", tags: ["#娃娃清洗", "#布偶清潔"] },
  { topic: "精品衣物洗標與飾件的送洗前判斷", service: "luxury-dry", visual: "customer-consultation", traffic: "trust-reset", tags: ["#精品乾洗", "#精緻乾洗"] }
];

const situationSeeds: TopicSeed[] = [
  { topic: "雨後通勤回家不要直接收鞋", service: "shoe-bag", visual: "customer-consultation", traffic: "value-prop-lead", tags: ["#雨天鞋子", "#通勤日常"] },
  { topic: "下班最常背的包先看提把", service: "shoe-bag", visual: "customer-consultation", traffic: "object-proof", tags: ["#包包清潔", "#下班日常"] },
  { topic: "週末換季整理先分類布品", service: "fabric-storage", visual: "shop-inspection", traffic: "value-prop-lead", tags: ["#換季收納", "#布品清潔"] },
  { topic: "暑假旅行回來先處理外套", service: "fabric-storage", visual: "customer-consultation", traffic: "share-worthy-care", tags: ["#旅行整理", "#外套清洗"] },
  { topic: "孩子上學後鞋襪變悶", service: "white-shoe", visual: "customer-consultation", traffic: "object-proof", tags: ["#開學準備", "#童鞋清潔"] },
  { topic: "梅雨季衣櫃味道先找來源", service: "fabric-storage", visual: "shop-inspection", traffic: "dwell-detail", tags: ["#雨季保養", "#衣櫃收納"] },
  { topic: "騎車族雨衣外套分開看", service: "fabric-storage", visual: "customer-consultation", traffic: "trust-reset", tags: ["#機車通勤", "#外套清洗"] },
  { topic: "健身房衣物不要悶在包裡", service: "fabric-storage", visual: "shop-inspection", traffic: "value-prop-lead", tags: ["#運動衣", "#汗味處理"] },
  { topic: "辦公室冷氣外套領口檢查", service: "fabric-storage", visual: "shop-inspection", traffic: "object-proof", tags: ["#上班穿搭", "#外套保養"] },
  { topic: "搬家後棉被窗簾先除灰", service: "fabric-storage", visual: "shop-inspection", traffic: "share-worthy-care", tags: ["#搬家整理", "#寢具清洗"] },
  { topic: "聚餐後外套先聞再收", service: "fabric-storage", visual: "customer-consultation", traffic: "dwell-detail", tags: ["#聚餐後整理", "#外套清洗"] },
  { topic: "父親節襯衫皮鞋一起整理", service: "shoe-bag", visual: "shop-inspection", traffic: "share-worthy-care", tags: ["#父親節", "#皮鞋保養"] },
  { topic: "七夕約會後白鞋包包檢查", service: "shoe-bag", visual: "customer-consultation", traffic: "share-worthy-care", tags: ["#七夕", "#鞋包照護"] },
  { topic: "開學前制服外套和白鞋", service: "white-shoe", visual: "shop-inspection", traffic: "value-prop-lead", tags: ["#開學季", "#白鞋清潔"] },
  { topic: "颱風天後鞋包不要急著曬", service: "shoe-bag", visual: "customer-consultation", traffic: "trust-reset", tags: ["#颱風天", "#鞋包保養"] },
  { topic: "中秋烤肉後外套不要直接掛回去", service: "fabric-storage", visual: "customer-consultation", traffic: "share-worthy-care", tags: ["#中秋節", "#外套清洗"] },
  { topic: "國慶連假行李鞋包整理", service: "shoe-bag", visual: "shop-inspection", traffic: "value-prop-lead", tags: ["#國慶連假", "#旅行整理"] },
  { topic: "客廳沙發毯用久會有生活味", service: "fabric-storage", visual: "shop-inspection", traffic: "share-worthy-care", tags: ["#沙發毯", "#居家布品"] },
  { topic: "拜訪客戶前西裝先看袖口", service: "fabric-storage", visual: "customer-consultation", traffic: "trust-reset", tags: ["#西裝清洗", "#上班穿搭"] },
  { topic: "婚宴禮服回家先不要塞衣櫃", service: "fabric-storage", visual: "shop-inspection", traffic: "dwell-detail", tags: ["#禮服清潔", "#衣物保養"] },
  { topic: "雨傘滴水旁的包角容易先受影響", service: "shoe-bag", visual: "macro-detail", traffic: "object-proof", tags: ["#雨天保養", "#包包清潔"] },
  { topic: "夜市走一圈鞋底邊緣最誠實", service: "shoe-bag", visual: "macro-detail", traffic: "object-proof", tags: ["#鞋子清潔", "#台中生活"] },
  { topic: "青海路通勤回來先看鞋包", service: "local", visual: "customer-consultation", traffic: "value-prop-lead", tags: ["#青海路", "#台中西屯"] },
  { topic: "逢甲西屯人流多的鞋底灰", service: "local", visual: "shop-inspection", traffic: "share-worthy-care", tags: ["#西屯生活", "#鞋子保養"] },
  { topic: "返家鞋櫃味道通常從一雙開始", service: "shoe-bag", visual: "shop-inspection", traffic: "dwell-detail", tags: ["#鞋櫃收納", "#鞋子清潔"] },
  { topic: "久放包包有霉味先不要硬擦", service: "shoe-bag", visual: "customer-consultation", traffic: "trust-reset", tags: ["#包包保養", "#霉味處理"] },
  { topic: "送洗前照片要拍哪些位置", service: "photo-guide", visual: "shop-inspection", traffic: "value-prop-lead", tags: ["#送洗前拍照", "#LINE詢問"] },
  { topic: "LINE傳照片時先補三個資訊", service: "photo-guide", visual: "customer-consultation", traffic: "value-prop-lead", tags: ["#LINE詢問", "#送洗前拍照"] },
  { topic: "每十天公開一次洗護觀察", service: "local", visual: "shop-inspection", traffic: "trust-reset", tags: ["#私享家觀察", "#台中西屯洗衣店"] },
  { topic: "客人最常忽略的是內裡和邊角", service: "shoe-bag", visual: "macro-detail", traffic: "object-proof", tags: ["#鞋包照護", "#洗護細節"] },
  { topic: "絨毛玩偶有汗味時先看五官和配件", service: "plush-doll", visual: "customer-consultation", traffic: "object-proof", tags: ["#娃娃清洗", "#絨毛玩偶清潔"] },
  { topic: "精品衣物有舊污漬時先拍洗標", service: "luxury-dry", visual: "customer-consultation", traffic: "trust-reset", tags: ["#精品乾洗", "#名牌衣物清潔"] },
  { topic: "換季時西裝和襯衫不要一起悶收", service: "shirt-suit", visual: "customer-consultation", traffic: "share-worthy-care", tags: ["#西裝乾洗", "#襯衫清洗"] },
  { topic: "床組有潮味時先不要直接密封", service: "bedding-duvet", visual: "shop-inspection", traffic: "dwell-detail", tags: ["#床組清洗", "#寢具清洗"] }
];

interface ConcreteReachSpecialInput {
  topic: string;
  service: TopicSeed["service"];
  tags: [string, string];
  hookDetail: string;
  observation: string;
  caution: string;
  facebookAction: string;
  instagramAction: string;
  followFocus: string;
  direction: string;
}

interface ConcretePickupSpecialInput {
  topic: string;
  tags: [string, string];
  hookDetail: string;
  situation: string;
  preparation: string;
  facebookAction: string;
  instagramAction: string;
  followFocus: string;
  direction: string;
  videoCandidate?: VideoCandidatePlan;
}

function captionTags(tags: [string, string]): string {
  return ["#私享家洗衣店", "#台中西屯洗衣店", ...tags].join(" ");
}

function concreteReachSpecial(input: ConcreteReachSpecialInput): SpecialSlot {
  const hook = `${input.topic}。${input.hookDetail}`;
  const followCta = `追蹤私享家，之後會持續整理${input.followFocus}的送洗前判斷。`;
  const tags = captionTags(input.tags);
  return {
    format: "real-shop-photo",
    topic: input.topic,
    service: input.service,
    visual: "macro-detail",
    traffic: "dwell-detail",
    tags: input.tags,
    hook,
    follow_cta: followCta,
    direction: input.direction,
    facebook_caption: [hook, brand, input.observation, input.caution, input.facebookAction, followCta, tags].join("\n\n"),
    instagram_caption: [hook, brand, input.observation, input.caution, input.instagramAction, followCta, tags].join("\n\n")
  };
}

function concretePickupSpecial(input: ConcretePickupSpecialInput): SpecialSlot {
  const hook = `${input.topic}。${input.hookDetail}`;
  const serviceMessage = "私享家提供台中市全區免費收送，主要透過 LINE 預約。";
  const followCta = `追蹤私享家，之後會持續整理台中免費收送與${input.followFocus}的實用方法。`;
  const tags = captionTags(input.tags);
  return {
    format: "real-shop-photo",
    topic: input.topic,
    service: "pickup-delivery",
    visual: "shop-inspection",
    traffic: "value-prop-lead",
    tags: input.tags,
    hook,
    follow_cta: followCta,
    direction: input.direction,
    video_candidate: input.videoCandidate,
    facebook_caption: [
      hook,
      brand,
      input.situation,
      `${serviceMessage}${input.preparation}`,
      input.facebookAction,
      followCta,
      tags
    ].join("\n\n"),
    instagram_caption: [
      hook,
      brand,
      input.situation,
      `${serviceMessage}${input.preparation}`,
      input.instagramAction,
      followCta,
      tags
    ].join("\n\n")
  };
}

const specialSlots: Record<string, Record<number, SpecialSlot>> = {
  "2026-07-16": {
    2: {
      format: "reel",
      topic: "忙到沒手再搬洗衣籃的家庭日常",
      service: "pickup-delivery",
      visual: "customer-consultation",
      traffic: "value-prop-lead",
      tags: ["#台中洗衣收送", "#免費到府收送"],
      campaign: "taichung-free-pickup-delivery",
      hook: "忙到沒手再搬洗衣籃的家庭日常，接送與晚餐之間不該再塞進一趟送洗。",
      story:
        "家裡有小孩或長輩要照顧時，洗衣籃常常不是只有一件外套，而是球衣、校服、毛巾和大人衣服一起堆起來。真正卡住的不是願不願意洗，而是沒有多餘的手去搬、去停車、再搬回來。",
      service_message:
        "私享家提供台中市全區免費到府收送。家庭日常衣物可先分袋拍照，用 LINE 傳收件地址與方便聯絡的時段，再由我們確認收送安排。",
      action_cta: "今天家裡堆著待洗物，直接在 LINE 傳收件地址、品項照片和方便聯絡的時間，我們再和你確認。",
      instagram_action_cta: "家庭衣物先分袋拍一張，LINE 傳地址與方便時間，我們再確認收送。",
      follow_cta: "追蹤私享家，之後會持續整理忙碌家庭也能輕鬆安排的送洗方式。",
      direction:
        "10 秒直式短影音；忙碌家庭玄關同時有球衣袋、校服與毛巾籃，家長一邊顧小孩一邊把袋子放到門口，收送人員穩定接手後，家人回到餐桌吃晚餐；寫實溫暖、不出現文字。",
      video_prompt:
        "Photorealistic premium 10-second vertical commercial in a busy Taiwanese family entryway at dinner time. Start with a parent juggling school bags, kids' sportswear laundry bags, and towels near the door while a child waits nearby. A clean professional pickup worker calmly receives the sealed family laundry bags at the doorway. End with the family settling at a warm dining table as the doorway closes softly. One smooth camera move, natural evening light, believable hands fabric and bag physics, quiet service confidence, no text, no logos, no watermark, no exaggerated acting."
    }
  },
  "2026-07-17": {
    2: {
      format: "real-shop-photo",
      topic: "下班後洗衣籃不該再跟你一起加班",
      service: "pickup-delivery",
      visual: "shop-inspection",
      traffic: "object-proof",
      tags: ["#台中洗衣收送", "#免費到府收送"],
      campaign: "taichung-free-pickup-delivery",
      hook: "下班後洗衣籃不該再跟你一起加班，襯衫和外套可以先排進收送。",
      story:
        "辦公室通勤的人常常把襯衫、西裝外套和冷氣房薄外套一路拖到晚上。真正耗掉的不是清洗本身，而是找停車位、搬袋、再把乾淨衣物扛回家的那段時間。",
      service_message:
        "私享家提供台中市全區免費到府收送。上班衣物可先分件拍照，用 LINE 傳品項與收件地址，再由門市確認收送內容。",
      action_cta: "把要整理的上班衣物排開拍一張，LINE 傳照片、收件地址與聯絡方式即可開始確認。",
      instagram_action_cta: "襯衫、西裝和外套分開拍照，LINE 傳地址與品項，我們再確認收送。",
      follow_cta: "追蹤私享家，之後會繼續整理襯衫、西裝與通勤衣物的送洗判斷。",
      direction:
        "真實生活感照片；下班回家的玄關放著裝好的洗衣袋與掛妥的襯衫外套，客人和收送人員自然交接，商務感安靜俐落、不像物流廣告。"
    }
  },
  "2026-07-18": {
    2: {
      format: "reel",
      topic: "整套床組不必再自己扛下樓",
      service: "pickup-delivery",
      visual: "customer-consultation",
      traffic: "share-worthy-care",
      tags: ["#台中洗衣收送", "#免費到府收送"],
      campaign: "taichung-free-pickup-delivery",
      hook: "整套床組不必再自己扛下樓，大件布品最難的通常是搬運而不是清洗。",
      story:
        "棉被、床包、保潔墊和枕頭套一起整理時，裝進袋子後體積會突然變得很有存在感。很多人不是不想洗大件，而是一想到下樓、塞車廂和再搬回家就先擱著。",
      service_message:
        "私享家提供台中市全區免費到府收送。大件床組可以先拍整體、洗標與在意的位置，再用 LINE 傳收件地址，讓門市先確認品項。",
      action_cta: "不用先把大件布品搬到店裡，LINE 傳照片、收件地址和聯絡方式，我們再和你確認收送。",
      instagram_action_cta: "大件床組先拍整體和洗標，LINE 傳照片與收件地址，我們再和你確認收送。",
      follow_cta: "追蹤私享家，之後會持續整理床組、棉被與大件布品的送洗方式。",
      direction:
        "10 秒直式短影音；公寓門口堆著厚實床組袋與棉被袋，客人試著搬動後放下，收送人員穩妥接手並放入乾淨收送箱，最後切到門市檢查台展開床組；寫實高級、不出現文字。",
      video_prompt:
        "Photorealistic premium 10-second vertical commercial about large bedding pickup in a Taiwanese apartment doorway. Start with oversized sealed bedding bags and a thick duvet bag that are clearly heavy and bulky. A homeowner tries to lift one bag, then sets it down. A clean professional pickup worker calmly secures the bedding bags into a padded crate. End at a premium laundry-care counter where the same bedding set is laid out for inspection. One smooth camera move, natural daylight, believable fabric bulk and weight, no readable signs, no logos, no text, no watermark."
    }
  },
  "2026-07-19": {
    2: {
      format: "image-post",
      topic: "精品衣物最怕的不是送洗，是路上顛簸",
      service: "pickup-delivery",
      visual: "customer-consultation",
      traffic: "value-prop-lead",
      tags: ["#台中洗衣收送", "#免費到府收送"],
      campaign: "taichung-free-pickup-delivery",
      hook: "精品衣物最怕的不是送洗，是路上顛簸；自己塞進後車廂那一段最傷。",
      story:
        "禮服、西裝外套、絲質上衣或有飾件的精緻衣物，最需要被穩妥放置與分件確認。自己搬運時最容易發生的，往往是壓摺、磨到五金，或和重物擠在同一袋。",
      service_message:
        "私享家提供台中市全區免費到府收送。精品與精緻衣物可先拍洗標、面料與飾件細節，用 LINE 傳收件地址，再由門市確認收送方式。",
      action_cta: "精緻衣物想少一次搬運風險，直接在 LINE 傳照片、收件地址和聯絡方式。",
      instagram_action_cta: "先拍洗標、飾件和整體，LINE 傳地址與照片，我們再確認收送。",
      follow_cta: "追蹤私享家，之後會持續整理精品衣物與精緻材質的送洗前判斷。",
      direction:
        "真實高級居家照片；禮服袋、西裝外套與絲質上衣分件掛妥並準備交接，收送人員雙手穩接衣物袋，畫面乾淨克制，不做促銷海報。"
    }
  },
  "2026-07-20": {
    1: {
      format: "carousel-guide",
      topic: "先看懂：白襯衫領口與腋下泛黃",
      service: "fabric-storage",
      visual: "shop-inspection",
      traffic: "trust-reset",
      tags: ["#白襯衫", "#衣物清潔"],
      direction:
        "輪播 4 張：1 白襯衫主物件近拍、2 領口與腋下泛黃範圍、3 不建議硬刷或帶濕氣悶收、4 傳 LINE 前拍全貌局部洗標；風格乾淨高級。",
      follow_cta: "這類送洗前檢查清單會持續整理，先追蹤起來比較不會臨時找不到。",
      facebook_caption: [
        "白襯衫領口與腋下開始泛黃時，先看範圍與深淺，不要急著整片硬刷。",
        brand,
        "領口常累積皮脂、汗與保養品，腋下則會受汗液、止汗產品和穿著時間影響；同樣看起來是泛黃，材質與痕跡形成原因可能不同。",
        "送洗前先把襯衫攤平，看泛黃是集中在縫線、領口折線或腋下局部，還是已向外擴散，再一起確認布料、洗標與既有磨損。",
        "先別用硬刷反覆摩擦，也不要在還有濕氣時直接悶進洗衣袋；錯誤摩擦可能讓纖維起毛，濕氣也會讓味道留得更久。",
        "可以先拍整件全貌、領口、左右腋下與洗標，再傳 LINE，讓我們先依材質與泛黃位置看處理方向。",
        "這類送洗前檢查清單會持續整理，先追蹤起來比較不會臨時找不到。",
        "#私享家洗衣店 #台中西屯洗衣店 #白襯衫 #衣物清潔"
      ].join("\n\n"),
      instagram_caption: [
        "白襯衫領口與腋下開始泛黃時，先看範圍與深淺，不要急著整片硬刷。",
        brand,
        "領口常累積皮脂、汗與保養品，腋下則會受汗液、止汗產品和穿著時間影響；同樣看起來是泛黃，材質與痕跡形成原因可能不同。",
        "先把襯衫攤平，看泛黃是集中在縫線、領口折線或腋下局部，還是已向外擴散，再一起拍下布料、洗標與既有磨損。",
        "先別用硬刷反覆摩擦，也不要帶著濕氣悶收；錯誤摩擦可能讓纖維起毛，濕氣也會讓味道留得更久。",
        "拍好整件全貌、領口、左右腋下與洗標後，點個人檔案連結加 LINE，讓我們先看材質與泛黃位置。",
        "這類送洗前檢查清單會持續整理，先追蹤起來比較不會臨時找不到。",
        "#私享家洗衣店 #台中西屯洗衣店 #白襯衫 #衣物清潔"
      ].join("\n\n")
    },
    2: {
      format: "real-shop-photo",
      topic: "鞋包不用再塞進機車踏板出門",
      service: "pickup-delivery",
      visual: "macro-detail",
      traffic: "object-proof",
      tags: ["#台中洗衣收送", "#免費到府收送"],
      campaign: "taichung-free-pickup-delivery",
      hook: "鞋包不用再塞進機車踏板出門，材質與邊角值得被穩妥收送。",
      story:
        "白鞋、皮鞋、日常包和托特包最怕在運送途中互相摩擦。自己載出門時，鞋面、提把和包角常常比清洗前先多出一道刮痕或壓痕。",
      service_message:
        "私享家提供台中市全區免費到府收送。鞋子先拍鞋面、鞋底與內裡，包包拍提把、包角與整體，再用 LINE 傳地址與照片。",
      action_cta: "鞋包不用自己載出門，LINE 傳完整照片、收件地址與聯絡方式，我們再和你確認。",
      instagram_action_cta: "鞋面、鞋底、包角和提把先拍好，點個人檔案連結加 LINE，傳地址與照片，我們再確認收送。",
      follow_cta: "追蹤私享家，之後會持續整理鞋包照護與台中免費收送的實用資訊。",
      direction:
        "真實生活感照片；玄關整齊放著白鞋、皮鞋與一只日常包，收送箱內有分隔保護，交接動作清楚，物件材質細節可見。"
    }
  },
  "2026-07-21": {
    2: {
      format: "reel",
      topic: "下雨天最不想做的事，就是抱著待洗衣物出門",
      service: "pickup-delivery",
      visual: "macro-detail",
      traffic: "share-worthy-care",
      tags: ["#台中洗衣收送", "#免費到府收送"],
      campaign: "taichung-free-pickup-delivery",
      hook: "下雨天最不想做的事，就是抱著待洗衣物出門；濕鞋和外套不必再冒雨跑一趟。",
      story:
        "台中一降雨，外套、傘旁滴水的鞋包和本來就想送洗的衣物會一起卡住。與其冒雨搬運、找車位又把濕氣帶上車，不如讓收送在門口完成。",
      service_message:
        "私享家提供台中市全區免費到府收送。雨天衣物與鞋包可先拍照說明濕氣或泥水位置，用 LINE 傳收件地址，再由我們確認安排。",
      action_cta: "今天下雨又不想抱袋出門，直接在 LINE 傳照片、收件地址和方便聯絡時間。",
      instagram_action_cta: "雨天衣物先拍濕氣與髒污位置，LINE 傳地址與照片，我們再確認收送。",
      follow_cta: "追蹤私享家，之後會持續分享雨天衣物鞋包與免費收送的實用判斷。",
      direction:
        "10 秒直式短影音；雨天公寓門口，濕潤路面與窗上雨痕，客人把防潮袋裝好的衣物與鞋盒放到門口，收送人員撐傘穩定接手；寫實克制、不出現文字。",
      video_prompt:
        "Photorealistic premium 10-second vertical commercial on a rainy Taiwanese apartment doorway. Start with rain on the street and window glass, a customer sealing laundry bags and a shoe box inside the dry entryway. A clean professional pickup worker arrives with an umbrella and calmly receives the protected bags at the doorway. End with the doorway closing as rain continues outside and the home interior stays dry and calm. One smooth camera move, believable rain atmosphere and fabric physics, quiet service confidence, no readable signs, no logos, no text, no watermark."
    }
  },
  "2026-07-22": {
    2: {
      format: "image-post",
      topic: "店家與公司的大量衣物也能一次收",
      service: "pickup-delivery",
      visual: "customer-consultation",
      traffic: "value-prop-lead",
      tags: ["#台中洗衣收送", "#免費到府收送"],
      campaign: "taichung-free-pickup-delivery",
      hook: "店家與公司的大量衣物也能一次收，制服、桌布和備品不必分好幾趟搬。",
      story:
        "餐飲制服、公司襯衫、門市桌布或活動用布品一次累積起來，最麻煩的是數量與分類，而不是單一污漬。自己分批搬運，往往比清洗本身更花人力。",
      service_message:
        "私享家提供台中市全區免費到府收送。店家或公司批量衣物可先分類拍照、註明件數與材質，用 LINE 傳收件地址，再由門市確認收送安排。",
      action_cta: "批量衣物先分類拍照並註明件數，LINE 傳收件地址與聯絡人，我們再和你確認。",
      instagram_action_cta: "制服、桌布或備品先分類拍，LINE 傳件數與地址，我們再確認收送。",
      follow_cta: "追蹤私享家，之後會持續整理店家與公司批量送洗的收送方式。",
      direction:
        "真實商業空間照片；店家後場或小型辦公室角落整齊堆放標好分類的制服袋與桌布袋，收送人員清點袋數後接手，畫面清楚專業、不做廉價促銷感。"
    }
  },
  "2026-07-25": {
    1: {
      format: "real-shop-photo",
      topic: "冷氣房外套聞起來沒事，也要翻開領口內側看",
      service: "fabric-storage",
      visual: "macro-detail",
      traffic: "share-worthy-care",
      tags: ["#外套清洗", "#領口清潔"],
      hook: "冷氣房外套聞起來沒事，也要翻開領口內側看；聞不到，不代表沒有汗與皮脂。",
      follow_cta: "追蹤私享家，之後會持續整理上班外套與日常衣物的實用判斷。",
      direction:
        "寫實方形門市照片；乾淨檢查櫃台上一件深灰色薄外套，完整領口、袖口與淺色內裡同時可見，一雙自然手勢只翻開領口內側檢查細微汗漬與布料紋理；近距離 50mm 紀實攝影、明亮自然光、真實纖維與使用痕跡，不加文字、不放清潔劑、不做前後對比、不出現品牌與浮水印。",
      facebook_caption: [
        "冷氣房外套聞起來沒事，不代表領口內側沒有汗與皮脂；先翻開再決定要不要洗。",
        brand,
        "辦公室薄外套每天接觸脖子、頭髮和通勤汗氣，最早留下痕跡的通常是領口內側、袖口與腋下內裡，不一定會先出現明顯味道。",
        "先在自然光下翻開領口，看有沒有顏色變深、油感或局部泛黃，再一起確認袖口、內裡和洗標。不要先噴香水蓋味，也不要只在同一處反覆搓揉。",
        "把外套正面、領口內側、袖口和洗標各拍一張，再傳 LINE，我們可以先依材質與痕跡位置看處理方向。",
        "追蹤私享家，之後會持續整理上班外套與日常衣物的實用判斷。",
        "#私享家洗衣店 #台中西屯洗衣店 #外套清洗 #領口清潔"
      ].join("\n\n"),
      instagram_caption: [
        "冷氣房外套聞起來沒事，不代表領口內側沒有汗與皮脂；先翻開再決定要不要洗。",
        brand,
        "辦公室薄外套每天接觸脖子、頭髮和通勤汗氣，最早留下痕跡的通常是領口內側、袖口與腋下內裡，不一定會先出現明顯味道。",
        "先在自然光下翻開領口，看有沒有顏色變深、油感或局部泛黃，再一起確認袖口、內裡和洗標。不要先噴香水蓋味，也不要只在同一處反覆搓揉。",
        "拍好外套正面、領口內側、袖口和洗標後，點個人檔案連結加 LINE，讓我們先看材質與痕跡位置。",
        "追蹤私享家，之後會持續整理上班外套與日常衣物的實用判斷。",
        "#私享家洗衣店 #台中西屯洗衣店 #外套清洗 #領口清潔"
      ].join("\n\n")
    },
    2: {
      format: "real-shop-photo",
      topic: "下班不用再繞去洗衣店，台中免費收送從門口開始",
      service: "pickup-delivery",
      visual: "customer-consultation",
      traffic: "value-prop-lead",
      tags: ["#台中洗衣收送", "#免費到府收送"],
      campaign: "taichung-free-pickup-delivery",
      hook:
        "下班不用再繞去洗衣店，台中免費收送從門口開始；台中市全區免費到府收送，待洗衣物可以從家門口完成交接。",
      story:
        "通勤回家後再搬一大袋衣物出門，真正花時間的是繞路、停車與搬上搬下。把待洗物先分袋拍照，收送人員抵達後在門口完成交接，就能少跑一趟。",
      service_message:
        "私享家提供台中市全區免費到府收送。衣物可先裝入大型藍色收納袋，用 LINE 傳品項照片、收件地址與方便聯絡的時間，再由我們確認安排。",
      action_cta: "現在就把待洗物拍一張，LINE 傳收件地址、品項照片和方便聯絡的時間，我們再和你確認收送。",
      instagram_action_cta:
        "把待洗物裝袋拍一張，點個人檔案連結加 LINE，傳地址、品項與方便時間，我們再確認收送。",
      follow_cta: "追蹤私享家，之後會持續整理台中免費收送與各類物件的送洗方式。",
      direction:
        "寫實方形台灣公寓門口交接照片；攝影機固定在室外並拉近到雙方上半身和袋子，客人雙腳完整留在室內，只有大型藍色編織聚丙烯購物袋的前角跨在門檻上，袋子有黃色提把但沒有任何品牌或文字；收送人員完整頭部保留在畫面內，雙腳與身體都在室外，雙手自然接住袋子。沒有雨、沒有雨傘，人物不穿牆、不穿門、不穿模，袋子重量與手部受力合理，門框透視與人體比例真實，不加文字、標誌或浮水印。"
    }
  },
  "2026-07-27": {
    1: {
      format: "real-shop-photo",
      topic: "工作包外面乾淨，內裡的粉痕與筆痕怎麼看？",
      service: "shoe-bag",
      visual: "macro-detail",
      traffic: "dwell-detail",
      tags: ["#包包保養", "#內裡清潔"],
      hook: "工作包外面乾淨，內裡的粉痕與筆痕怎麼看？先看材質、位置與範圍，再決定處理方式。",
      follow_cta: "追蹤私享家，之後會持續整理包包內裡、提把與包角的送洗前判斷。",
      direction:
        "寫實方形門市檢查照片；乾淨淺灰櫃台上只有一個無品牌深藍色結構包，包口完整打開並平放，淺色內裡、內袋縫線、少量白色粉痕與一小段藍色筆痕清楚可見；兩條提把各自固定在四個明確縫合點並自然落在桌面，沒有斷裂或懸空帶子。無人物、無手、無手機、無清潔劑、無文字、無標誌、無浮水印；50mm 近距離紀實攝影，自然窗光，真實纖維、縫線與使用痕跡。",
      facebook_caption: [
        "工作包外面看起來乾淨，內裡的白色粉痕和筆痕，反而最容易拖到最後才處理。",
        brand,
        "先把包內物品全部取出，在自然光下看內裡材質。粉痕要先分辨是鬆散粉末，還是已被摩擦進纖維；筆痕則看範圍、顏色，以及有沒有靠近縫線或黏合處。",
        "不要直接把清潔劑倒進包內，也不要為了一小塊痕跡把整片內裡泡濕。先拍包包全貌、內裡、污點近照與材質標示，保留原本狀態再判斷。",
        "把四張照片傳 LINE，我們可以先依材質、痕跡位置與範圍看下一步。",
        "追蹤私享家，之後會持續整理包包內裡、提把與包角的送洗前判斷。",
        "#私享家洗衣店 #台中西屯洗衣店 #包包保養 #內裡清潔"
      ].join("\n\n"),
      instagram_caption: [
        "工作包外面看起來乾淨，內裡的白色粉痕和筆痕，反而最容易拖到最後才處理。",
        brand,
        "先把包內物品全部取出，在自然光下看內裡材質。粉痕要先分辨是鬆散粉末，還是已被摩擦進纖維；筆痕則看範圍、顏色，以及有沒有靠近縫線或黏合處。",
        "不要直接把清潔劑倒進包內，也不要為了一小塊痕跡把整片內裡泡濕。先拍包包全貌、內裡、污點近照與材質標示，保留原本狀態再判斷。",
        "拍好四張照片後，點個人檔案連結加 LINE，讓我們先看材質、位置與範圍。",
        "追蹤私享家，之後會持續整理包包內裡、提把與包角的送洗前判斷。",
        "#私享家洗衣店 #台中西屯洗衣店 #包包保養 #內裡清潔"
      ].join("\n\n")
    },
    2: {
      format: "real-shop-photo",
      topic: "健身結束先把濕衣物拿出來，再決定怎麼送洗",
      service: "pickup-delivery",
      visual: "shop-inspection",
      traffic: "value-prop-lead",
      tags: ["#台中免費收送", "#運動衣清洗"],
      hook: "健身結束先把濕衣物拿出來，再決定怎麼送洗；拉鍊先別急著拉上。",
      follow_cta: "追蹤私享家，之後會持續整理運動衣物與台中免費收送的實用方法。",
      direction:
        "寫實方形居家玄關整理照片；淺色長椅左側只有一個無品牌深灰色健身包，拉鍊完全打開，包體結構和兩條提把連接點完整合理；右側一件灰色短袖運動上衣已從包內取出並平整攤開，深色運動毛巾分開放置，旁邊只有一個無標籤透明水瓶。無人物、無手、無鞋、無雨、無清潔劑、無文字、無標誌、無浮水印；自然晚間室內光，真實布料濕氣與重量，不做髒污誇張或前後對比。",
      facebook_caption: [
        "健身結束最先要做的，不是把拉鍊拉起來；是把濕衣物從包裡拿出來。",
        brand,
        "汗濕運動衣、毛巾和乾淨物品一起悶在密閉包袋裡，濕氣與味道會停留在衣物內層、縫線和包內。回家後先分開取出，攤開通風，再確認洗標與汗濕範圍。",
        "不要先噴香氛蓋味，也不要把濕毛巾繼續壓在衣物上。要安排送洗時，私享家提供台中市全區免費收送，主要透過 LINE 預約。",
        "先傳衣物數量、洗標、汗濕位置、所在區域與可配合時段，我們再確認收送安排。",
        "追蹤私享家，之後會持續整理運動衣物與台中免費收送的實用方法。",
        "#私享家洗衣店 #台中西屯洗衣店 #台中免費收送 #運動衣清洗"
      ].join("\n\n"),
      instagram_caption: [
        "健身結束最先要做的，不是把拉鍊拉起來；是把濕衣物從包裡拿出來。",
        brand,
        "汗濕運動衣、毛巾和乾淨物品一起悶在密閉包袋裡，濕氣與味道會停留在衣物內層、縫線和包內。回家後先分開取出，攤開通風，再確認洗標與汗濕範圍。",
        "不要先噴香氛蓋味，也不要把濕毛巾繼續壓在衣物上。要安排送洗時，私享家提供台中市全區免費收送，主要透過 LINE 預約。",
        "準備好衣物數量、洗標、汗濕位置、所在區域與可配合時段後，點個人檔案連結加 LINE，我們再確認收送安排。",
        "追蹤私享家，之後會持續整理運動衣物與台中免費收送的實用方法。",
        "#私享家洗衣店 #台中西屯洗衣店 #台中免費收送 #運動衣清洗"
      ].join("\n\n")
    }
  },
  "2026-07-28": {
    1: concreteReachSpecial({
      topic: "夏季棉麻衣物的汗味，先看腋下與側縫",
      service: "fabric-storage",
      tags: ["#棉麻衣物", "#汗味處理"],
      hookDetail: "表面乾了，不代表縫線和重疊布料裡沒有濕氣。",
      observation:
        "把衣物翻到內側，在自然光下看腋下、側縫、領口與袖口。這些位置布料重疊、接觸皮膚多，顏色與觸感通常比衣身更早改變。",
      caution:
        "不要先用香氛把味道蓋掉，也不要還帶著濕氣就塞進洗衣籃；先確認洗標、汗濕範圍與既有褪色，再決定如何整理。",
      facebookAction: "拍整件全貌、腋下內側、側縫與洗標傳 LINE，我們可以先依材質與位置看方向。",
      instagramAction:
        "拍好整件全貌、腋下內側、側縫與洗標後，點個人檔案連結加 LINE，讓我們先看材質與位置。",
      followFocus: "棉麻、夏季衣物與汗濕位置",
      direction:
        "寫實方形門市檢查照片；淺灰櫃台上一件無品牌米色棉麻短袖上衣翻到內側，腋下、側縫、領口與洗標同時可辨識，布料有輕微真實汗濕深淺但不誇張；無人物、無手、無清潔劑、無文字、無標誌、無浮水印，自然窗光與真實纖維。"
    }),
    2: concretePickupSpecial({
      topic: "下班前用 LINE 約好，運動衣不用再繞路送",
      tags: ["#台中免費收送", "#運動衣清洗"],
      hookDetail: "先把乾濕衣物分開，回家後就能直接交接。",
      situation:
        "健身後的上衣、毛巾與乾淨換洗衣物如果全部塞在同一袋，回家前就容易把濕氣壓在布料內層。先分開，收送時也更容易確認品項。",
      preparation: "預約前先準備衣物數量、洗標照片、所在區域與可配合時段。",
      facebookAction: "把分袋後的衣物與洗標拍好傳 LINE，我們再確認收送安排。",
      instagramAction: "分袋拍好後，點個人檔案連結加 LINE，傳衣物數量、區域與可配合時段。",
      followFocus: "下班族運動衣物",
      videoCandidate: {
        status: "concept_ready",
        memory_hook: "拉鍊先別拉上",
        conflict: "拉鍊即將關上，手在碰到拉鍊頭的瞬間停住。",
        single_action: "同一隻手把灰色運動上衣從打開的健身包內完整取出，平放到包包右側。",
        payoff: "濕衣物先拿出、分開、通風，再安排收送。",
        cta: "台中市全區免費收送；點個人檔案連結加 LINE 預約。",
        duration_seconds: 12,
        aspect_ratio: "9:16",
        first_frame_direction:
          "固定直式近景；打開的深灰健身包位於左下，兩條提把與固定點完整，右側留有能平放上衣的空間；只出現一隻手停在拉鍊頭上。",
        grok_motion_prompt:
          "Create one continuous 12-second 9:16 photorealistic Taiwanese home-entryway shot. Fixed close camera. Start with one adult hand touching the zipper pull of a fully open unbranded dark-gray gym bag, then stop before closing. The same hand performs one dominant action only: remove one gray athletic shirt completely from the bag and lay it flat in the empty space on the right. The bag stays on the bench; both handles and all attachment points remain intact; the dark towel stays inside and does not move. Natural fabric weight, five fingers, correct zipper geometry, no extra limbs, no morphing, no wall or bag penetration, no text, no logo, no watermark. End with the open bag on the left and shirt flat on the right, then hold for two seconds.",
        fallback_media_type: "image"
      },
      direction:
        "寫實方形居家玄關照片；淺木長椅左側一個無品牌深灰健身包完全打開，兩條提把固定點完整，灰色運動上衣與深色毛巾分開攤放，右側一個乾淨布袋已整理好；無人物、無手、無鞋、無文字、無標誌、無浮水印，晚間暖中性光與合理布料重量。"
    })
  },
  "2026-07-29": {
    1: concreteReachSpecial({
      topic: "鞋子放回鞋櫃前，先看鞋口內裡與鞋墊邊",
      service: "white-shoe",
      tags: ["#鞋子清潔", "#鞋櫃收納"],
      hookDetail: "鞋面看起來乾，不代表鞋內接觸腳部的位置已經乾燥。",
      observation:
        "先看鞋口布邊、後跟內裡與鞋墊周圍有沒有顏色變深、濕感或細屑；左右腳一起比較，會比只聞味道更容易找到差異。",
      caution:
        "不要把仍有濕氣的鞋直接放進密閉鞋盒，也不要為了局部痕跡反覆硬刷鞋口；先確認材質與黏合處狀態。",
      facebookAction: "拍鞋面、鞋口內裡、後跟與鞋底邊傳 LINE，我們可以先看材質與位置。",
      instagramAction:
        "拍好鞋面、鞋口內裡、後跟與鞋底邊後，點個人檔案連結加 LINE，讓我們先看材質與位置。",
      followFocus: "鞋內濕氣、鞋口與鞋底邊",
      direction:
        "寫實方形門市檢查照片；乾淨淺灰鞋盤上一雙無品牌白色休閒鞋，一隻保持側面、一隻鞋口朝鏡頭，鞋口內裡、後跟與鞋底邊清楚可見；鞋帶、鞋舌與鞋底結構完整，無人物、無手、無清潔劑、無文字、無標誌、無浮水印。"
    }),
    2: concretePickupSpecial({
      topic: "床單被套一次多袋，不用自己再扛下樓",
      tags: ["#台中免費收送", "#床組清洗"],
      hookDetail: "大件床組最花力氣的常是裝袋後的搬運。",
      situation:
        "床單、被套、保潔墊一起更換時，袋子會因布料體積變得又大又重。先按品項分袋，比全部硬塞進同一袋更容易確認。",
      preparation: "預約前先拍每袋全貌、品項數量、洗標與所在區域。",
      facebookAction: "把每袋照片、件數與可配合時段傳 LINE，我們再確認收送。",
      instagramAction: "分袋拍好後，點個人檔案連結加 LINE，傳件數、區域與可配合時段。",
      followFocus: "床單、被套與大件布品",
      direction:
        "寫實方形公寓玄關照片；地面上只有一個無品牌亮藍色大型編織聚丙烯袋，兩條黃色承重提把各自固定在四個清楚縫合點，袋內是整齊折好的床單與被套，袋體有真實重量下墜；無人物、無手、無雨傘、無文字、無標誌、無浮水印。"
    })
  },
  "2026-07-30": {
    1: concreteReachSpecial({
      topic: "童鞋送洗前，鞋口內裡與鞋底邊要一起拍",
      service: "white-shoe",
      tags: ["#童鞋清潔", "#鞋子保養"],
      hookDetail: "孩子每天活動量大，最早累積痕跡的未必是鞋面。",
      observation:
        "左右鞋並排看鞋口、鞋舌、後跟內裡與鞋底邊，確認磨損是否對稱、黏合處有沒有翹起，以及污痕集中在哪一側。",
      caution:
        "不要只為了鞋底邊發黑就大力刷同一處，也不要自行拉扯已經翹起的黏合邊；保留原狀比較容易判斷。",
      facebookAction: "拍左右鞋全貌、鞋口內裡、鞋底邊與尺寸標示傳 LINE，讓我們先看狀態。",
      instagramAction:
        "拍好左右鞋全貌、鞋口內裡、鞋底邊與尺寸標示後，點個人檔案連結加 LINE，讓我們先看狀態。",
      followFocus: "童鞋內裡、磨損與黏合處",
      direction:
        "寫實方形門市檢查照片；淺灰櫃台上一雙無品牌兒童休閒鞋，左右鞋完整，一隻呈鞋口視角、一隻呈鞋底邊側視角，鞋帶與鞋舌數量正常；無兒童、無人物、無手、無文字、無標誌、無浮水印，明亮自然光。"
    }),
    2: concretePickupSpecial({
      topic: "孩子的鞋一次整理，家長不用再多跑一趟",
      tags: ["#台中免費收送", "#童鞋清潔"],
      hookDetail: "先分雙拍照，收送時比較不會混在一起。",
      situation:
        "運動鞋、上學鞋與備用鞋同時要整理時，最容易漏掉的是左右鞋配對、尺寸與各自的在意位置。先分雙排好，比直接堆袋更清楚。",
      preparation: "預約前先拍每一雙全貌、鞋底、內裡與所在區域。",
      facebookAction: "把每雙照片、雙數與方便時段傳 LINE，我們再確認收送。",
      instagramAction: "每雙拍好後，點個人檔案連結加 LINE，傳雙數、區域與方便時段。",
      followFocus: "家庭鞋類一次整理",
      videoCandidate: {
        status: "concept_ready",
        memory_hook: "先配對，再裝袋",
        conflict: "一隻童鞋正要被放進袋子，另一隻還單獨留在地墊上。",
        single_action: "同一隻成人手把手上的童鞋移回地墊，放到另一隻鞋旁完成左右配對。",
        payoff: "每雙先配對拍照，收送時不漏鞋、不混雙。",
        cta: "台中市全區免費收送；點個人檔案連結加 LINE 預約。",
        duration_seconds: 12,
        aspect_ratio: "9:16",
        first_frame_direction:
          "固定直式玄關近景；地墊上只有一隻童鞋，另一隻由單一成人手拿在打開的灰色收納袋上方；鞋帶、鞋舌與提把固定點完整。",
        grok_motion_prompt:
          "Create one continuous 12-second 9:16 photorealistic Taiwanese apartment-entryway shot. Fixed close camera. A single adult hand holds one unbranded child sneaker above an open gray storage bag while its matching shoe remains alone on the floor mat. The hand performs one dominant action only: move the held shoe away from the bag and place it beside the matching shoe, toes aligned, completing the pair. The bag stays open and stationary. Preserve exactly two shoes, complete laces and tongues, five fingers, realistic weight and contact shadows. No child, no extra hands, no duplicated shoes, no morphing, no text, no logo, no watermark. End on the paired shoes and hold for two seconds.",
        fallback_media_type: "image"
      },
      direction:
        "寫實方形居家玄關照片；乾淨鞋墊上整齊放兩雙不同尺寸的無品牌兒童休閒鞋，每雙左右配對且鞋帶完整，旁邊一個打開的無品牌灰色收納袋，提把固定點清楚；無人物、無手、無文字、無標誌、無浮水印。"
    })
  },
  "2026-07-31": {
    1: concreteReachSpecial({
      topic: "牛仔褲送洗前，先清空口袋再看膝蓋色差",
      service: "fabric-storage",
      tags: ["#牛仔褲清洗", "#衣物檢查"],
      hookDetail: "口袋內容物與局部摩擦，都可能比整件髒污更需要先確認。",
      observation:
        "把前後口袋逐一清空，再把褲子平放，比較左右膝、口袋邊與褲腳的顏色、磨白與既有破損；同時查看洗標。",
      caution:
        "不要把紙巾、金屬物或收據留在口袋裡，也不要只對磨白處反覆搓揉；牛仔布原有色落要和新污痕分開看。",
      facebookAction: "拍正反面、口袋、左右膝、褲腳與洗標傳 LINE，我們可以先看範圍。",
      instagramAction:
        "拍好正反面、口袋、左右膝、褲腳與洗標後，點個人檔案連結加 LINE，讓我們先看範圍。",
      followFocus: "牛仔布色落、口袋與磨損",
      direction:
        "寫實方形門市檢查照片；一條無品牌深藍牛仔褲平整放在淺灰櫃台，兩個前口袋翻開且完全清空，左右膝、褲腳與洗標位置可辨識，保留真實自然色落；無人物、無手、無文字、無標誌、無浮水印。"
    }),
    2: concretePickupSpecial({
      topic: "週五下班後，把襯衫與西裝排進 LINE 收送",
      tags: ["#台中免費收送", "#襯衫清洗"],
      hookDetail: "不用先繞去門市，先把品項與洗標拍清楚。",
      situation:
        "一週累積的襯衫、薄外套與西裝如果混在同一袋，領口、袖口和飾件容易被忽略。先分件平放或掛好，再確認各件洗標。",
      preparation: "預約前先準備件數、洗標、在意位置、所在區域與可配合時段。",
      facebookAction: "把分件照片與件數傳 LINE，我們再確認收送安排。",
      instagramAction: "分件拍好後，點個人檔案連結加 LINE，傳件數、區域與可配合時段。",
      followFocus: "襯衫、西裝與通勤衣物",
      direction:
        "寫實方形居家玄關照片；淺木長椅上兩件無品牌白色與淺藍襯衫分開折好，旁邊一件深灰西裝外套放在完整無文字防塵袋內，拉鍊與提把結構合理；無人物、無手、無衣架穿模、無文字、無標誌、無浮水印。"
    })
  },
  "2026-08-01": {
    1: concreteReachSpecial({
      topic: "針織外套起毛球前，先看袖口與側腰摩擦區",
      service: "fabric-storage",
      tags: ["#針織外套", "#毛球照護"],
      hookDetail: "毛球通常不是平均出現，而是先集中在反覆摩擦的位置。",
      observation:
        "把外套平放，在斜光下比較袖口、腋下、側腰與背包接觸處的纖維是否開始蓬起，再一起確認織法、洗標與既有勾紗。",
      caution:
        "不要直接用刀片削，也不要拉扯單顆凸起纖維；先分辨是表面毛羽、毛球還是已經勾紗。",
      facebookAction: "拍整件、袖口、側腰、勾紗近照與洗標傳 LINE，我們可以先看材質。",
      instagramAction:
        "拍好整件、袖口、側腰、勾紗近照與洗標後，點個人檔案連結加 LINE，讓我們先看材質。",
      followFocus: "針織纖維、毛球與勾紗",
      direction:
        "寫實方形門市檢查照片；一件無品牌深灰針織外套平放在乾淨櫃台，袖口、腋下與側腰有輕微真實毛羽但不誇張，洗標局部可見且不可讀；無人物、無手、無除毛器、無文字、無標誌、無浮水印。"
    }),
    2: concretePickupSpecial({
      topic: "鞋包先拍四個角度，再約台中免費收送",
      tags: ["#台中免費收送", "#鞋包照護"],
      hookDetail: "全貌、內裡、邊角與洗標先拍齊，門口交接會更清楚。",
      situation:
        "鞋子與日常包一起送洗時，最容易漏拍的是鞋內、鞋底、包角與提把固定點。先分物件拍攝，不要把所有東西疊在同一張照片。",
      preparation: "預約前先準備各物件四個角度、件數、所在區域與可配合時段。",
      facebookAction: "把照片、件數與時段傳 LINE，我們再確認收送。",
      instagramAction: "四個角度拍好後，點個人檔案連結加 LINE，傳件數、區域與可配合時段。",
      followFocus: "鞋子與包包送洗前拍照",
      videoCandidate: {
        status: "concept_ready",
        memory_hook: "鞋包先別疊在一起",
        conflict: "包包壓住鞋子的一角，照片看不到包角與鞋底邊。",
        single_action: "同一隻手只把深藍包包向右移開，白鞋保持完全不動。",
        payoff: "鞋與包分開拍，全貌、內裡、邊角與洗標才看得清楚。",
        cta: "台中市全區免費收送；點個人檔案連結加 LINE 預約。",
        duration_seconds: 12,
        aspect_ratio: "9:16",
        first_frame_direction:
          "固定直式玄關近景；無品牌深藍包包左下角輕壓一雙配對白鞋的鞋底邊，只出現一隻手扶住包包側面，右側保留移動空間。",
        grok_motion_prompt:
          "Create one continuous 12-second 9:16 photorealistic Taiwanese home-entryway shot. Fixed close camera. An unbranded dark-navy structured bag slightly overlaps the outsole edge of one complete paired set of white sneakers. One adult hand performs one dominant action only: slide the bag to the right until the bag and shoes are fully separated and each object is clearly visible. The sneakers do not move. Preserve exactly one bag, two handles with four attachment points, exactly two shoes with complete laces, and five fingers. Realistic friction, weight and contact shadows; no floating, no geometry changes, no extra objects, no text, no logo, no watermark. End with a clear gap between bag and shoes and hold for two seconds.",
        fallback_media_type: "image"
      },
      direction:
        "寫實方形居家玄關照片；淺木長椅上一個無品牌深藍結構包完整打開，旁邊一雙無品牌白色休閒鞋左右配對，包包兩條提把與鞋帶結構完整，物件互不堆疊；無人物、無手、無手機、無文字、無標誌、無浮水印。"
    })
  },
  "2026-08-02": {
    1: concreteReachSpecial({
      topic: "枕頭套有油痕時，枕套與枕芯要分開看",
      service: "bedding-duvet",
      tags: ["#床組清洗", "#枕頭套清洗"],
      hookDetail: "表面痕跡在枕套，濕氣或味道也可能已經留在枕芯接觸面。",
      observation:
        "拆床組時先取下枕套，在自然光下看正反面、拉鍊或開口、縫線與洗標；枕芯則單獨確認表布、填充均勻度與是否有潮感。",
      caution:
        "不要把枕套和枕芯當成同一種材質一起處理，也不要還有濕氣就重新套回去；兩者洗標與結構可能不同。",
      facebookAction: "拍枕套正反面、局部、洗標與枕芯全貌傳 LINE，我們可以先看方向。",
      instagramAction:
        "拍好枕套正反面、局部、洗標與枕芯全貌後，點個人檔案連結加 LINE，讓我們先看方向。",
      followFocus: "枕套、枕芯與寢具材質",
      direction:
        "寫實方形門市檢查照片；淺灰櫃台上一個白色枕套已與白色枕芯分開放置，枕套開口、縫線、局部淡淡油痕與洗標位置清楚，枕芯保持完整蓬鬆；無人物、無手、無文字、無標誌、無浮水印。"
    }),
    2: concretePickupSpecial({
      topic: "一家人的床組換洗，一次約台中免費收送",
      tags: ["#台中免費收送", "#寢具清洗"],
      hookDetail: "先按房間或品項分袋，件數與洗標比較不會混在一起。",
      situation:
        "雙人床單、兒童床套、枕頭套與保潔墊同時更換時，全部塞在一起很難確認件數。分袋並拍一張全貌，收送前就能先對品項。",
      preparation: "預約前先準備每袋品項、件數、洗標、所在區域與可配合時段。",
      facebookAction: "把每袋照片與件數傳 LINE，我們再確認收送。",
      instagramAction: "分袋拍好後，點個人檔案連結加 LINE，傳件數、區域與可配合時段。",
      followFocus: "家庭床組與大件布品",
      direction:
        "寫實方形居家玄關照片；地面上兩個不同尺寸的無品牌亮藍色編織聚丙烯袋分開裝折好的床單、枕套與保潔墊，每袋兩條黃色提把完整固定且受力合理；無人物、無手、無文字、無標誌、無浮水印。"
    })
  },
  "2026-08-03": {
    1: concreteReachSpecial({
      topic: "化妝包的粉痕，拉鍊邊與內袋縫線要一起看",
      service: "shoe-bag",
      tags: ["#化妝包清潔", "#包包內裡"],
      hookDetail: "鬆散粉末和已被摩擦進纖維的痕跡，處理方向不一樣。",
      observation:
        "先把內容物全部取出，在自然光下看內裡底部、內袋縫線、拉鍊布邊與包角；確認粉痕是浮在表面，還是已集中在織紋與縫隙。",
      caution:
        "不要直接把清潔液倒進包內，也不要為了拉鍊邊一小塊痕跡把整個內裡泡濕；先保留原狀拍照。",
      facebookAction: "拍全貌、內裡底部、拉鍊邊與材質標示傳 LINE，我們可以先看範圍。",
      instagramAction:
        "拍好全貌、內裡底部、拉鍊邊與材質標示後，點個人檔案連結加 LINE，讓我們先看範圍。",
      followFocus: "化妝包內裡、粉痕與拉鍊邊",
      direction:
        "寫實方形門市檢查照片；乾淨淺灰櫃台上一個無品牌米灰化妝包完全打開，內裡底部、內袋縫線、拉鍊布邊與少量粉痕清楚可見，拉鍊頭與提帶結構完整；無人物、無手、無化妝品、無文字、無標誌、無浮水印。"
    }),
    2: concretePickupSpecial({
      topic: "騎車通勤外套先攤開，再約台中免費收送",
      tags: ["#台中免費收送", "#外套清洗"],
      hookDetail: "領口、袖口與背部先通風，別直接塞回置物箱。",
      situation:
        "通勤外套接觸汗氣、灰塵與安全帽內襯後，領口、袖口和背部最容易留住濕氣。回家先攤開，再確認洗標與在意位置。",
      preparation: "預約前先準備外套全貌、領口、袖口、洗標、所在區域與可配合時段。",
      facebookAction: "把外套照片與時段傳 LINE，我們再確認收送。",
      instagramAction: "外套拍好後，點個人檔案連結加 LINE，傳區域與可配合時段。",
      followFocus: "騎車通勤外套",
      direction:
        "寫實方形居家玄關照片；淺木長椅上一件無品牌深灰通勤外套完整攤開，領口、袖口、內裡與洗標位置可辨識，旁邊只有一個無標誌消光深色安全帽；無人物、無手、無雨傘、無文字、無標誌、無浮水印。"
    })
  },
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
    case "pickup-delivery":
      return "/services/taichung-citywide-laundry-pickup.html";
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
  if (service === "pickup-delivery") {
    return "追蹤私享家，之後會持續整理台中免費收送與各類物件的送洗判斷。";
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
                : service === "pickup-delivery"
                  ? "台中市全區提供免費到府收送，衣物、鞋包、床組與娃娃都能先用 LINE 傳照片與地址確認。"
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

function captionForSpecialCampaign(special: SpecialSlot, hook: string, followCta: string): string {
  if (!special.story || !special.service_message || !special.action_cta) {
    throw new Error(`Campaign ${special.campaign ?? "unknown"} is missing customer-facing copy.`);
  }
  return [hook, brand, special.story, special.service_message, special.action_cta, followCta].join("\n\n");
}

// Direction is written for a phone in a working shop, not for a campaign.
// Polished framing is what makes generated material read as an advert, and an
// advert is what viewers scroll past.
function directionFor(topic: string, format: GrowthFormat, visual: VisualRoute): string {
  if (format === "reel") {
    return `9:16 手機直拍:開頭 2 秒直接近拍「${topic}」,第二鏡手指指出邊角/內裡/布面,第三鏡回到門市櫃台判斷;手持、略有晃動,不加浮誇字幕。`;
  }
  if (format === "carousel-guide") {
    return `輪播 4 張:1 主物件近拍、2 要看哪個位置、3 不建議自己硬刷/悶收、4 送洗前拍照清單;像店員用手機隨手拍,不要修得太乾淨。`;
  }
  if (format === "poster") {
    return `單張說明照:${topic};物件放在工作中的檯面,背景是真實店內環境,文字少且清楚,不要像促銷傳單也不要像產品型錄。`;
  }
  return `門市隨手拍:${visual} 路線,物件放在使用中的櫃台,手部檢查材質或邊角,日光燈加窗光,不放假品牌、不做誇張對比。`;
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
  const followCta = special?.follow_cta ?? followCtaFor(format, service);
  const hook = special?.hook ?? hookFor(topic, format);
  const mediaPackage = companionMediaPackage(date);
  const videoCandidate =
    special?.video_candidate ??
    (mediaPackage ? companionVideoCandidate(topic, service, slot) : undefined);
  const caption = special?.campaign
    ? captionForSpecialCampaign(special, hook, followCta)
    : special?.facebook_caption ?? captionFor(topic, service, format, followCta);
  const searchVisibility = searchVisibilityForContent(service, slot, topic);

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
    content_role: slot === 1 ? "reach-answer" : "evidence-conversion",
    views_target: slotTarget(review.daily_views_target, slot),
    follower_target: followerTarget(review.daily_follower_target, slot),
    hook,
    follow_cta: followCta,
    caption,
    hashtags: tags,
    image_or_reel_direction: special?.direction ?? directionFor(topic, format, visual),
    seo_sync_page: seoPageFor(service),
    ...searchVisibility,
    ten_day_review_metric: review.review_metric,
    campaign: special?.campaign,
    story: special?.story,
    service_message: special?.service_message,
    action_cta: special?.action_cta,
    instagram_action_cta: special?.instagram_action_cta,
    video_prompt: special?.video_prompt,
    video_candidate: videoCandidate,
    media_package: mediaPackage,
    facebook_caption: special?.facebook_caption,
    instagram_caption: special?.instagram_caption
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
    objective:
      "90 天內建立可驗證的搜尋與社群轉換循環：原創內容帶來非粉絲觸及，答案與服務頁取得搜尋或 AI 引用，再以 LINE 點擊、詢問、預約與營收判斷是否有效。",
    start_date: startDate,
    end_date: lastDay.date,
    timezone,
    cadence:
      "每天 2 則：11:30 觸及或可收藏的知識內容，19:30 證據或轉換內容；每篇滿 72 小時才比較非粉觸及、收藏、分享、LINE 點擊與預約。",
    source_method: [
      "參考 90 天日更 playbook 的北極星指標、三階段主題弧線、內容支柱、CTA、Hashtag、圖片方向與 10 日複盤方式。",
      "新版以搜尋查詢、原創內容、可引用答案、品牌提及、LINE 點擊、詢問與預約組成同一條可量測漏斗；引用與品牌提及分開記錄。",
      "依客戶搜尋目的分成在地找店、問題判斷、服務選擇、信任證據、免費收送與雨季收納六個題組；每篇指定自然查詢與第一手證據，不建立只換地名的薄頁。",
      "28 天複盤固定比較 Google、ChatGPT Search、Perplexity、Copilot、Gemini 與 Grok；分開記錄品牌提及、可點擊引用、被引用頁、答案正確性與 LINE 轉換。",
      "改寫為私享家適用的成效模型：非粉觀看、平均觀看時間、收藏、分享、搜尋曝光、CTR、AI 引用、LINE 點擊與實際預約。",
      "節日節點採節日前預告海報，節日當天或連假後用真實門市照片補一篇。"
    ],
    search_intent_clusters: SEARCH_INTENT_CLUSTERS,
    ai_visibility_review_28d: AI_VISIBILITY_REVIEW_28D,
    community_practice_sources: COMMUNITY_PRACTICE_SOURCES,
    review_windows: reviewWindows,
    days
  };
}

export function flattenGrowthPlaybook(playbook: GrowthPlaybook): GrowthPlaybookSlot[] {
  return playbook.days.flatMap((day) => day.slots);
}
