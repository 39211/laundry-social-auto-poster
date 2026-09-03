import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { getOption, isMain } from "./cli";
import { getConfig, hasUsablePublicImageBaseUrl } from "./config";
import { hasApprovedPost, loadApprovalLog, readJsonFile, writeJsonAtomic } from "./logging";
import {
  contentCalendarPath,
  docsContentCalendarPath,
  projectRoot,
  publicAssetPath,
  publicCarouselAssetPath,
  publicVideoAssetPath
} from "./paths";
import { imageAssetsForSlot } from "./mediaAssets";
import {
  AI_VISIBILITY_REVIEW_28D,
  COMMUNITY_PRACTICE_SOURCES,
  SEARCH_INTENT_CLUSTERS
} from "./searchVisibilityStrategy";
import { getZonedDateParts } from "./scheduler";
import type { ApprovalLogEntry, CarouselItem, DailyContent, DailySlot, Platform } from "./types";
import {
  INDEX_GROWTH_CATALOG,
  INDEX_GROWTH_HUB_ORDER,
  hubGroupFor,
  resolveAcceptedIndexGrowthPages
} from "./indexGrowthPages";
import {
  KNOWN_SERVICE_SLUGS,
  assertProductionPublicSiteBaseUrl,
  type SupportPageDefinition
} from "./publicSiteTypes";
import {
  SEARCH_CONTENT_ANALYTICS_PATH,
  assertSearchContentAnalyticsScript,
  buildSearchContentAnalyticsScript
} from "./searchContentAnalytics";

interface GeneratePublicSiteOptions {
  root?: string;
  baseUrl?: string;
  siteBaseUrl?: string;
  imageBaseUrl?: string;
  now?: string | Date;
  statPublicAsset?: (filePath: string) => { isFile(): boolean };
  /** Fail closed unless the resolved public base URL is the production canonical host. */
  deployment?: boolean;
}

interface PublicPost {
  id: string;
  date: string;
  date_published: string;
  slot: number;
  time: string;
  category: string;
  title: string;
  topic: string;
  visual_route: string;
  traffic_route: string;
  content_role: "reach-answer" | "evidence-conversion";
  search_intent: string;
  target_queries: string[];
  evidence_type: string;
  hashtags: string[];
  platforms: string[];
  in_language: string;
  image_path: string;
  image_url: string;
  image_paths: string[];
  image_urls: string[];
  carousel_items: CarouselItem[];
  media_type: "image" | "carousel" | "reel";
  video_path: string;
  video_url: string;
  calendar_path: string;
  calendar_url: string;
  article_path: string;
  article_url: string;
  url: string;
  facebook_caption: string;
  instagram_caption: string;
}

interface PublicPostIndex {
  generated_at: string;
  site_name: string;
  description: string;
  timezone: string;
  ga4_measurement_id: string;
  base_url: string;
  base_url_configured: boolean;
  image_base_url: string;
  image_base_url_configured: boolean;
  canonical_url: string;
  latest_date: string;
  open_graph: {
    title: string;
    description: string;
    type: string;
    url: string;
    site_name: string;
    image: string;
    image_alt: string;
    locale: string;
  };
  entrypoints: {
    index: string;
    llms: string;
    llms_lite: string;
    llms_full: string;
    well_known_llms: string;
    well_known_ai: string;
    robots: string;
    sitemap: string;
    ai_sitemap: string;
    latest: string;
    social_posts: string;
    business_profile: string;
    services: string;
    answers: string;
    geo_targets: string;
    search_visibility: string;
    llms_jsonl: string;
    service_pages: Record<string, string>;
    support_pages: Record<string, string>;
    feed: string;
    rss: string;
    knowledge_graph: string;
    ai_discovery: string;
  };
  business_profile: BusinessProfile;
  posts: PublicPost[];
  article_posts: PublicPost[];
}

interface ServiceFaq {
  question: string;
  answer: string;
}

interface ServicePageDefinition {
  slug: string;
  name: string;
  local_query_name?: string;
  title: string;
  description: string;
  h1: string;
  summary: string;
  keywords: string[];
  image_hint: string;
  image_alt: string;
  image_note: string;
  allow_image_fallback?: boolean;
  static_image_path?: string;
  static_image_topic?: string;
  static_image_source?: string;
  /** Stable YYYY-MM-DD used for sitemap lastmod when content last intentionally changed. */
  content_lastmod?: string;
  /** Explicit areaServed name for schema (default: 台中西屯). */
  area_served_name?: string;
  answer_summary: string;
  case_story: {
    label: string;
    situation: string;
    inspection: string;
    recommendation: string;
  };
  case_studies: Array<{
    label: string;
    object: string;
    material: string;
    concern: string;
    inspection: string;
    boundary: string;
  }>;
  sections: Array<{ heading: string; body: string }>;
  inspection_table?: Array<{ item: string; focus: string; risk: string }>;
  /** R2: optional two-column reference-price tables rendered as real <table>s. */
  price_tables?: Array<{ heading: string; rows: Array<{ item: string; price: string }> }>;
  faqs: ServiceFaq[];
}

export type { SupportPageDefinition } from "./publicSiteTypes";

interface PublicImageReference {
  id: string;
  topic: string;
  image_path: string;
  image_url: string;
  source_type: "social-post" | "generated-illustration" | "generated-product-image";
  source_post_id?: string;
}

interface HomeDiscoveryItem {
  label: string;
  description: string;
  serviceSlug?: string;
  supportSlug?: string;
  href?: string;
}

interface HomeDiscoveryGroup {
  heading: string;
  intro: string;
  items: HomeDiscoveryItem[];
}

interface HomeTrustItem {
  heading: string;
  body: string;
}

interface BusinessAddress {
  "@type": "PostalAddress";
  postalCode: string;
  addressRegion: string;
  addressLocality: string;
  streetAddress: string;
  addressCountry: string;
}

interface OpeningHoursSpecification {
  "@type": "OpeningHoursSpecification";
  dayOfWeek?: string | string[];
  opens?: string;
  closes?: string;
  validFrom?: string;
  validThrough?: string;
}

interface HolidayHoursOverride {
  date: string;
  name: string;
  closed?: boolean;
  opens?: string;
  closes?: string;
  note?: string;
  verified_by_owner: boolean;
  announced_url?: string;
}

interface HolidayHoursRule {
  default_rule: string;
  social_content_rule: string;
  schema_rule: string;
  major_holidays: string[];
  overrides: HolidayHoursOverride[];
}

interface BusinessProfile {
  name: string;
  google_business_profile_name: string;
  alternate_names: string[];
  address: BusinessAddress;
  address_text: string;
  landmark: string;
  map_url: string;
  google_maps_feature_id: string;
  google_maps_cid: string;
  google_place_id: string | null;
  facebook_url: string;
  facebook_share_url: string;
  instagram_url: string;
  youtube_url?: string;
  line_url: string;
  line_id: string;
  telephone: string;
  telephone_local: string;
  mobile_or_line: string;
  mobile_or_line_local: string;
  opening_hours_text: string;
  opening_hours_schema: string[];
  opening_hours_specification: OpeningHoursSpecification[];
  holiday_hours_rule: HolidayHoursRule;
  service_topics: string[];
  source_notes: string[];
  verification_status: Record<string, string>;
}

const SITE_NAME = "私享家洗衣店";
const SITE_TITLE = "私享家洗衣店｜台中免費收送・逢甲洗鞋・西屯洗鞋";
const SITE_DESCRIPTION =
  "找台中免費收送、逢甲洗鞋或西屯洗鞋？私享家洗衣店提供台中市全區免費收送，門市在西屯青海路二段365號，可先用 LINE 傳照片預約。";
const KNOWLEDGE_HUB_PATH = "knowledge/";
const KNOWLEDGE_HUB_FILE = "knowledge/index.html";
const KNOWLEDGE_HUB_TITLE = "洗鞋洗包與衣物收送知識庫｜私享家洗衣店";
const KNOWLEDGE_HUB_DESCRIPTION =
  "從鞋子異味、白鞋泛黃、包包發霉到衣物床被收送，依問題找到私享家洗衣店的直接答案、處理界線與對應服務。";
const KNOWLEDGE_HUB_TEMPLATE_LASTMOD = "2026-09-03";
/**
 * Last intentional change of the homepage's static sections (YYYY-MM-DD). Not rewritten on
 * every build; the published homepage lastmod also advances with the newest approved post
 * (see homepageContentLastmod). Their rename, our date: 2026-08-08 is the later
 * real content change, made after this constant's line diverged.
 */
const HOMEPAGE_STATIC_CONTENT_LASTMOD = "2026-09-04";
const AI_DESCRIPTION =
  "AI-readable source of record for 私享家洗衣店 daily social captions, care topics, image assets, hashtags, business profile, and content routes.";
const SITE_LOCALE = "zh_TW";
const AI_CRAWLERS = [
  "OAI-SearchBot",
  "GPTBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "PerplexityBot",
  "Google-Extended",
  "Applebot-Extended",
  "Amazonbot"
];
const PLATFORM_NAMES: Platform[] = ["facebook", "instagram"];
const ANSWER_CONFIDENCE = "business-owned-source";
const ANSWER_CITATION_GUIDANCE = "Use the answer as short factual context and cite source_url.";
/** R2/R6: required caveat on every price-list block. Reference prices, not fixed quotes. */
const PRICE_LIST_DISCLAIMER =
  "水洗價，乾洗柔洗另計；發霉、特殊污漬與特殊材質另行報價，以實際檢視為準";
const PRICE_LIST_SLUG = "taichung-laundry-price-list";
const AI_DO_NOT_INFER_RULES = [
  "Do not infer pricing.",
  "Do not guarantee that white shoes can be fully whitened.",
  "Do not claim that stains, odor, mold, yellowing, or dark marks can always be fully removed.",
  "Do not infer Google review count or rating unless verified from a live Google source.",
  "Do not infer holiday hours or temporary closures.",
  "Use business-profile.json and the service pages as the source of record for business facts."
] as const;
const HOME_EXPANDED_RECENT_DAYS = 7;
const LOCAL_SEARCH_QUERY_TARGETS = [
  "洗衣店",
  "台中洗衣店",
  "西屯洗衣店",
  "台中西屯洗衣店",
  "青海路洗衣店",
  "台中洗衣收送",
  "台中免費收送",
  "台中西屯洗鞋",
  "台中西屯洗包",
  "台中西屯白鞋清潔",
  "台中西屯布品收納"
] as const;
const SERVICE_PAGE_DEFINITIONS: ServicePageDefinition[] = [
  {
    slug: "shoe-bag-care",
    name: "鞋包清潔",
    title: "逢甲洗鞋・西屯洗鞋｜鞋包清潔先看材質｜私享家洗衣店",
    description:
      "找逢甲洗鞋或西屯洗鞋？私享家洗衣店在青海路二段365號，先看鞋面、鞋底、內裡與材質再判斷清潔方式，台中市可免費收送。",
    h1: "逢甲洗鞋・西屯洗鞋",
    summary:
      "鞋子和包包常見問題不只表面髒，還包括包角水痕、鞋底泥灰、提把油痕、內裡濕氣與材質摩擦痕。私享家會先看材質、位置與痕跡深度，再決定是清潔、局部整理、通風觀察，還是需要先提醒客人可改善的限度。",
    keywords: ["逢甲洗鞋", "西屯洗鞋", "台中西屯洗鞋", "鞋包清潔", "洗包", "包包清潔", "青海路洗鞋"],
    image_hint: "鞋包",
    image_alt: "鞋包清潔前的包角、鞋面與皮革檢查主圖",
    image_note: "AI 生成的高擬真產品風格主圖，用於呈現鞋包清潔前的包角、鞋面、皮革水痕與邊緣檢查情境；不是實際客戶物件照片。",
    static_image_path: "assets/services/shoe-bag-care-hero-product.png",
    static_image_topic: "鞋包清潔前的包角、鞋面與皮革檢查主圖",
    static_image_source: "ai-generated premium product hero image",
    content_lastmod: "2026-08-17",
    answer_summary:
      "逢甲與西屯需要洗鞋，可先把鞋面、鞋底、鞋內與材質照片傳 LINE；私享家門市在青海路二段365號，會先說明清潔方式與可改善範圍，台中市可免費收送。",
    case_story: {
      label: "雨季通勤後的鞋包狀況",
      situation:
        "客人常在雨天通勤、逛街或活動後才發現包包四角變暗、鞋底邊緣卡泥灰，鞋內有一點悶味，但表面看起來又不算嚴重。",
      inspection:
        "門市會先分開看包包材質、包角水痕、提把油痕、鞋底邊緣、縫線卡灰與鞋內濕氣，判斷是表面灰塵、雨水滲入、油脂吸附，還是材質本身已經磨耗。",
      recommendation:
        "如果照片中看到包角濕痕、提把發暗、鞋內悶味或鞋底邊緣泛灰，建議先不要直接收進鞋櫃或防塵袋，拍照詢問後再決定是否送洗或局部處理。"
    },
    case_studies: [
      { label: "情境 01", object: "通勤帆布鞋", material: "網布鞋面與橡膠鞋邊", concern: "雨後鞋邊卡泥灰、鞋內有濕悶感", inspection: "先看鞋面是否吸水、鞋底邊緣與縫線是否卡灰，再確認鞋墊可否拆出通風。", boundary: "不以硬刷或漂白處理；膠邊氧化與材質磨耗不承諾回到全新。" },
      { label: "情境 02", object: "日常肩背包", material: "尼龍或帆布包身、皮革感提把", concern: "包角雨水痕與提把發暗", inspection: "分開看包角摩擦、提把油脂吸附和內裡是否受潮，不把水痕與掉色混為同一種問題。", boundary: "已掉色或磨損的位置先說明，清潔不等同補色修復。" },
      { label: "情境 03", object: "久放鞋包", material: "混合材質鞋面與防塵袋收納", concern: "外觀不髒但鞋內與包內有悶味", inspection: "確認味道來源、收納環境與可拆部件，再判斷是否先通風、局部整理或送洗。", boundary: "不以香味覆蓋悶味，也不建議在未乾燥前重新密封。" }
    ],
    sections: [
      {
        heading: "適合整理的狀況",
        body:
          "雨季通勤後的鞋底邊緣、包包四角、提把、鞋內濕氣與白色鞋邊泛灰，通常需要先檢查材質再處理。皮革、帆布、麂皮、合成皮與織物對水分和刷洗的反應不同，不能只用同一種方式清潔。"
      },
      {
        heading: "送洗前可以先拍哪裡",
        body:
          "建議拍包角近照、提把、鞋底邊緣、鞋面材質、鞋內、鞋舌與整體照片。照片越能看出材質與髒污位置，門市越能先判斷是表面灰塵、水痕滲入、油脂吸附，還是材質磨耗。"
      },
      {
        heading: "洗鞋與洗包不保證變全新",
        body:
          "清潔可以改善灰塵、泥痕、部分水痕與味道，但氧化、破皮、掉色、長期磨耗或已經滲入材質的痕跡，處理前需要先說清楚。私享家會把可改善和不適合硬處理的地方分開講，避免客人期待落差。"
      },
      {
        heading: "洗鞋費用怎麼判斷？本頁不列固定價目",
        body:
          "本頁不提供洗鞋或洗包的固定金額、價目表、折扣碼或市場行情價。可以先確定的是：台中市內收送本身免費、且沒有最低消費門檻；清潔與洗護費用則要看過物件之後才說明。會影響費用的因素包含材質（皮革、麂皮、帆布、網布、合成皮反應不同）、髒污深度與是否已滲入、膠邊是否氧化或老化、是否需要局部處理、可拆部件多寡，以及件數。取得屬於你這雙鞋的說明只要三步：先拍鞋面、鞋邊、鞋內與整體四張照片，用 LINE 傳給門市，門市會先回覆適合清潔、局部整理還是不建議硬處理，方向確認後再談費用。若搜尋結果出現「某某元起」而不是本店官方頁面，請以 LINE 回覆為準。"
      },
      {
        heading: "LINE 詢問怎麼描述",
        body:
          "可以直接傳照片並補一句：下雨後、放很久、常背常穿、或剛弄髒。這些時間線會影響判斷，因為剛沾到的泥灰、已乾掉的水痕、長時間吸附的味道，處理方式會不一樣。"
      }
    ],
    inspection_table: [
      {
        item: "鞋底與鞋邊",
        focus: "泥灰是否卡在邊緣、縫線或膠邊",
        risk: "硬刷可能讓鞋邊變毛，氧化膠邊也不一定能完全刷白。"
      },
      {
        item: "包角與底部",
        focus: "水痕、摩擦發暗、邊角是否磨損",
        risk: "包角若已磨耗或掉色，清潔只能改善髒污，不能當作補色修復。"
      },
      {
        item: "提把與肩背帶",
        focus: "手汗、油脂、雨水痕跡與材質觸感",
        risk: "油脂滲入後需要先判斷材質，不能用強力清潔硬處理。"
      },
      {
        item: "鞋內與包內裡",
        focus: "濕氣、悶味、灰塵和可拆部件",
        risk: "悶味若已吸附在內裡，需要通風和清潔判斷，不適合直接密封收納。"
      }
    ],
    faqs: [
      {
        question: "鞋子和包包可以一起詢問清潔嗎？",
        answer: "可以。建議同時拍鞋面、鞋底、包角與提把照片，門市會分別看材質與髒污狀態。"
      },
      {
        question: "雨季後一定要馬上送洗嗎？",
        answer: "如果有濕悶味、水痕或泥灰卡在邊角，建議先通風並拍照詢問，避免直接收進櫃內讓味道變重。"
      },
      {
        question: "洗包可以處理提把油痕嗎？",
        answer: "要看材質和油痕吸附程度。表面髒污通常比較好判斷，已經滲入或摩擦變色的位置，門市會先說明可改善範圍。"
      },
      {
        question: "鞋子或包包送洗前需要先自己刷嗎？",
        answer: "不建議先硬刷。可以先把乾的表面灰塵輕拍掉，再拍照詢問；若材質不明，硬刷或泡水可能讓痕跡更明顯。"
      },
      {
        question: "洗鞋多少錢？為什麼這裡查不到價目表？",
        answer:
          "本頁不列固定價目。同樣一雙鞋，材質、髒污深度、膠邊是否氧化、要不要局部處理，處理方式與費用差很多，先報數字容易造成期待落差。可以先確定的是收送本身免費、沒有最低消費門檻；拍鞋面、鞋邊、鞋內與整體四張照片傳 LINE，門市會先說明適合怎麼處理，再談費用。"
      },
      {
        question: "想找便宜的洗鞋，你們適合嗎？",
        answer:
          "如果你要的是最低價，本店不是以價格競爭為主。我們的做法是先看材質與痕跡、把可改善與不建議硬處理的部分分開講；不確定材質就硬刷或漂白，短期便宜但可能讓鞋子更難救。先傳照片問，方向不合也可以不送洗。"
      }
    ]
  },
  {
    slug: "white-shoe-cleaning",
    name: "白鞋清潔",
    title: "白鞋清潔｜台中西屯白鞋泛黃、鞋邊與內裡整理｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號），專門判斷白鞋泛黃、鞋邊泛灰、縫線卡灰與內裡濕悶問題，台中市全區免費到府收送。",
    h1: "白鞋清潔",
    summary:
      "白鞋泛灰、泛黃或有悶味，不一定適合硬刷或漂白。鞋面、膠邊、縫線、鞋墊與內裡吸附狀態不同，處理前要先分開檢查，尤其是膠邊氧化和材質磨耗，要先說清楚可改善的限度。",
    keywords: ["白鞋清潔", "白鞋保養", "白鞋泛黃", "鞋邊泛灰", "台中西屯白鞋清潔", "青海路洗鞋"],
    image_hint: "白鞋",
    image_alt: "白鞋清潔前的鞋邊、縫線與內裡檢查主圖",
    image_note: "AI 生成的高擬真產品風格主圖，用於呈現白鞋清潔前的鞋邊、縫線、皮革鞋面與內裡檢查情境；不是實際客戶物件照片。",
    static_image_path: "assets/services/white-shoe-cleaning-hero-product.png",
    content_lastmod: "2026-08-23",
    static_image_topic: "白鞋清潔前的鞋邊、縫線與內裡檢查主圖",
    static_image_source: "ai-generated premium product hero image",
    answer_summary:
      "台中西屯白鞋清潔不建議直接漂白或硬刷，應先看鞋面材質、膠邊氧化、縫線卡灰、鞋墊與內裡味道，再判斷可清潔程度。",
    case_story: {
      label: "白鞋鞋邊泛灰與內裡濕悶",
      situation:
        "客人通常是在白鞋鞋邊泛灰、鞋面看起來不亮、內裡有悶味時才想清潔，但這類狀況不一定只靠刷白就能解決。",
      inspection:
        "門市會先確認鞋面材質、膠邊磨耗與氧化、縫線卡灰、鞋墊是否可拆，以及味道是表層濕氣、長時間穿著吸附，還是收納後悶出來的味道。",
      recommendation:
        "如果鞋邊已經變毛、膠邊有氧化、縫線卡灰或內裡有味道，建議先拍鞋邊、鞋面和鞋內給門市看，再判斷可整理程度。"
    },
    case_studies: [
      { label: "情境 01", object: "白色運動鞋鞋邊", material: "橡膠膠邊", concern: "鞋邊泛灰、局部泛黃", inspection: "先區分灰塵、摩擦、氧化與膠邊老化的位置，避免把所有黃痕都當成可洗掉的髒污。", boundary: "氧化造成的變色只能評估可改善範圍，不保證全白。" },
      { label: "情境 02", object: "白色帆布鞋縫線", material: "帆布鞋面與縫線", concern: "鞋頭折痕和縫線卡灰", inspection: "看灰塵是否集中在縫線、折痕與鞋舌邊，再確認鞋面纖維是否已起毛。", boundary: "不先自行硬刷；過度摩擦可能讓毛邊與色差更明顯。" },
      { label: "情境 03", object: "久放白鞋內裡", material: "布料內裡與可拆鞋墊", concern: "內裡悶味、鞋墊潮感", inspection: "確認鞋墊可拆性、內裡磨耗與味道是否來自長期潮氣或收納。", boundary: "不以香味掩蓋，必須先判斷乾燥與處理方式。" }
    ],
    sections: [
      {
        heading: "白鞋常見問題",
        body:
          "鞋邊泛灰、膠邊泛黃、內裡濕悶、縫線卡灰、鞋墊味道和鞋面材質變暗，是白鞋清潔前需要分開看的重點。不同位置看起來都像髒，但原因可能是灰塵、汗氣、氧化或材質磨耗。"
      },
      {
        heading: "不建議自行硬刷",
        body:
          "如果沒有先確認材質，硬刷、泡水或漂白可能讓鞋邊變毛、膠痕更明顯，或讓內裡味道留住。白鞋要先判斷可清潔的是表面灰塵，還是已經氧化或吸附的痕跡。"
      },
      {
        heading: "白鞋泛黃要先分原因",
        body:
          "白鞋泛黃可能來自膠邊氧化、洗後乾燥不完全、汗氣殘留、久放收納或材質本身老化。私享家會先看泛黃位置，如果是膠邊氧化或材質變色，會先提醒不能用全新效果期待。"
      },
      {
        heading: "適合先傳的照片",
        body:
          "建議拍鞋頭、鞋側、膠邊、鞋跟、鞋舌、鞋內、鞋墊和整雙鞋的自然光照片。不要只拍最髒的位置，因為整體材質狀態會影響處理方式。"
      }
    ],
    inspection_table: [
      {
        item: "鞋面",
        focus: "皮革、帆布、網布或合成材質是否變色",
        risk: "材質變色不等於表面髒污，過度清潔可能讓色差更明顯。"
      },
      {
        item: "膠邊",
        focus: "泛灰、泛黃、氧化或磨耗位置",
        risk: "氧化膠邊無法保證恢復全白，需先確認可改善程度。"
      },
      {
        item: "縫線",
        focus: "灰塵是否卡在縫線、鞋頭折痕或鞋舌邊",
        risk: "縫線周圍硬刷可能傷到表面或讓毛邊更明顯。"
      },
      {
        item: "鞋內與鞋墊",
        focus: "汗味、濕氣、可拆性與內裡磨耗",
        risk: "味道若長期吸附，需要先判斷來源，不適合只靠香味掩蓋。"
      }
    ],
    faqs: [
      {
        question: "白鞋泛黃可以完全變回全新嗎？",
        answer: "要看材質、氧化程度與膠邊狀態。建議先拍鞋面、鞋邊與內裡，門市會先判斷可整理程度。"
      },
      {
        question: "白鞋可以用漂白水嗎？",
        answer: "不建議直接使用。不同鞋面與膠邊反應不同，使用錯誤可能讓材質變脆、變黃或留下痕跡。"
      },
      {
        question: "白鞋清潔前需要先拆鞋帶嗎？",
        answer: "可以先拍原本狀態，不一定要先拆。門市會看鞋帶、鞋舌、鞋孔和鞋面材質，再判斷是否需要分開處理。"
      },
      {
        question: "白鞋有味道可以只處理內裡嗎？",
        answer: "要看味道來源。若鞋墊可拆、內裡潮濕或久放悶味，會先判斷是否適合局部整理與通風處理。"
      }
    ]
  },
  {
    slug: "fabric-storage",
    name: "布品收納",
    title: "布品收納｜台中西屯換季衣物、外套與寢具整理｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）提供台中西屯布品收納與換季整理建議，協助檢查衣物、外套、寢具、被套與厚棉布品在收納前的濕氣、味道與髒污。",
    h1: "布品收納",
    summary:
      "布品收納不是把東西折好放進櫃子就結束。收納前要先確認濕氣、汗味、灰塵、黃斑、寢具接觸皮膚的位置與清潔狀態，避免下次拿出來才發現霉味或局部痕跡變深。",
    keywords: ["布品收納", "換季收納", "衣物收納", "寢具清潔", "外套清潔", "台中西屯布品整理"],
    image_hint: "布品",
    image_alt: "外套、寢具與布品收納前檢查主圖",
    image_note: "AI 生成的高擬真產品風格主圖，用於呈現外套、寢具與布品收納前檢查情境；不是實際客戶物件照片。",
    static_image_path: "assets/services/fabric-storage-hero-product.png",
    content_lastmod: "2026-08-23",
    static_image_topic: "外套、寢具與布品收納前產品級檢查主圖",
    static_image_source: "ai-generated premium product hero image",
    answer_summary:
      "台中西屯布品收納建議先確認衣物、外套、寢具、被套與厚棉布品是否乾燥，有無汗味、悶味、黃痕或局部髒污，再決定是否清潔後收納。",
    case_story: {
      label: "換季前的布品與衣物檢查",
      situation:
        "客人常在換季時把外套、寢具、被套或厚棉布品直接收進櫃子，幾個月後才發現悶味、黃斑、摺痕處變暗或布料觸感變差。",
      inspection:
        "門市建議先看領口、袖口、腋下、寢具接觸皮膚的位置、被套內側、收納袋內是否有潮味，以及布品摺痕和邊角是否有灰塵殘留。",
      recommendation:
        "如果布品有汗味、潮氣、局部髒污或收納袋內有悶味，不建議直接密封收納；可以先拍照詢問，再決定是否需要清潔整理。"
    },
    case_studies: [
      { label: "情境 01", object: "換季外套", material: "棉質或混紡外套", concern: "領口袖口暗沉、穿過後直接收納", inspection: "先看接觸皮膚的位置、材質標籤與是否還有汗味或潮氣。", boundary: "有味道或局部髒污時不直接壓縮收納，先評估是否適合清潔。" },
      { label: "情境 02", object: "寢具與被套", material: "棉質布品與填充寢具", concern: "表面乾淨但收納袋有悶味", inspection: "確認被套內側、枕套接觸皮膚處與收納袋本身是否有潮味。", boundary: "環境異味會重新附著，未乾燥的布品不適合密封。" },
      { label: "情境 03", object: "厚棉布品", material: "厚棉或有填充結構布品", concern: "摺痕邊角灰塵與局部黃痕", inspection: "看折痕、邊角、填充狀態與黃痕形成時間，避免只處理表面。", boundary: "不將久放黃痕承諾為可完全消除，先說明可能的改善範圍。" }
    ],
    sections: [
      {
        heading: "收納前先檢查",
        body:
          "外套、寢具、被套、厚棉布品與久放衣物在長時間收納前，建議先確認是否乾燥、是否有悶味、汗味、灰塵或局部髒污。台中雨季與濕度高時，布品更容易在密封後留下味道。"
      },
      {
        heading: "適合詢問的品項",
        body:
          "換季外套、寢具、被套、枕套、厚棉布品、久放衣物與需要重新整理的收納物件，都可以先拍照讓門市判斷。照片建議包含整體、局部污漬、標籤材質和收納前的狀態。"
      },
      {
        heading: "收納不是越密封越好",
        body:
          "如果衣物或布品還有潮氣、汗味或灰塵，直接放進真空袋、防塵袋或櫃子，味道可能被悶住，黃斑也可能變得更明顯。私享家會先判斷是否適合清潔後再收。"
      },
      {
        heading: "節日前後也適合整理",
        body:
          "過年、中秋、端午、母親節或父親節前後，家裡常會整理衣櫃、寢具和外套。節日前可以先安排收納前檢查，連假後則適合把穿過、用過或悶放的布品重新整理。"
      }
    ],
    inspection_table: [
      {
        item: "外套領口袖口",
        focus: "汗味、油脂、灰塵與局部暗沉",
        risk: "未處理就收納，下一季拿出來時黃痕和味道可能更明顯。"
      },
      {
        item: "寢具接觸皮膚處",
        focus: "被套、枕套、床包的汗氣與濕氣",
        risk: "潮氣被密封後容易悶出味道，不適合直接壓縮收納。"
      },
      {
        item: "厚棉布品與摺痕",
        focus: "摺痕處灰塵、邊角髒污與布料觸感",
        risk: "局部髒污久放後更難判斷，清潔前要先看材質和填充狀態。"
      },
      {
        item: "收納袋與櫃內味道",
        focus: "袋內是否有悶味、潮味或久放灰塵",
        risk: "收納環境有味道時，乾淨布品也可能重新吸附異味。"
      }
    ],
    faqs: [
      {
        question: "布品收納前一定要清洗嗎？",
        answer: "不一定，但如果有汗味、濕氣、灰塵或局部髒污，建議先處理再收，避免長時間悶放後更難整理。"
      },
      {
        question: "換季衣物要怎麼判斷需不需要整理？",
        answer: "可以先看領口、袖口、腋下、收納袋內味道與布料觸感。如果有悶味或黃痕，建議先詢問。"
      },
      {
        question: "寢具和外套可以一起詢問嗎？",
        answer: "可以。建議分別拍整體、局部痕跡和材質標籤，門市會依品項判斷清潔與收納前處理方式。"
      },
      {
        question: "布品可以直接放真空袋嗎？",
        answer: "如果還有潮氣、汗味或局部髒污，不建議直接密封。先確認狀態再收，會比下次拿出來才處理更好。"
      }
    ]
  },
  {
    slug: "taichung-xitun-laundry",
    name: "台中西屯洗衣店",
    local_query_name: "洗衣店",
    title: "台中西屯洗衣店｜青海路衣物、洗鞋洗包與布品收納｜私享家洗衣店",
    description:
      "私享家洗衣店位於台中市西屯區青海路二段365號，提供衣物洗護、洗鞋、洗包、白鞋清潔與布品收納前檢查，可用 LINE 先傳照片詢問。",
    h1: "台中西屯洗衣店",
    summary:
      "如果你正在找台中西屯或青海路附近的洗衣店，私享家洗衣店把衣物、鞋子、包包、白鞋與布品收納分開判斷。不是只問要不要洗，而是先看物件狀態、材質、痕跡位置和使用情境，再建議適合的整理方式。",
    keywords: [
      "台中西屯洗衣店",
      "青海路洗衣店",
      "西屯洗衣",
      "西屯洗鞋",
      "逢甲洗鞋",
      "逢甲洗衣店",
      "台中洗鞋",
      "台中洗包",
      "台中到府收送洗衣",
      "私享家洗衣店"
    ],
    image_hint: "私享家",
    image_alt: "私享家洗衣店門市人員檢查外套與布品的服務情境主圖",
    image_note: "AI 生成的門市檢查情境示意圖，呈現送洗前先看材質與狀態的服務方式；不是實際客戶物件照片。",
    allow_image_fallback: false,
    static_image_path: "assets/services/fabric-storage-inspection.png",
    static_image_topic: "門市人員檢查外套與布品的服務情境主圖",
    static_image_source: "ai-generated in-store inspection scene",
    content_lastmod: "2026-08-25",
    answer_summary:
      "私享家洗衣店位於台中市西屯區青海路二段365號（至善國中對面），提供衣物洗護、鞋包清潔、白鞋清潔與布品收納前檢查，台中市全區免費到府收送，可先用 LINE 傳照片詢問。",
    case_story: {
      label: "第一次詢問私享家時怎麼開始",
      situation:
        "很多客人不是一開始就確定要洗衣、洗鞋、洗包或整理布品，而是手上有一件外套、一雙白鞋、一個包包或一袋換季寢具，不知道該不該送洗。",
      inspection:
        "門市會先看照片中的材質、痕跡位置、是否有濕氣或味道，再確認是日常灰塵、雨季水痕、久放收納、汗氣殘留，還是材質磨耗。",
      recommendation:
        "建議先用 LINE 傳整體照片、局部近照和材質標籤，再補充大概什麼時候弄髒、放多久、是否淋雨或有味道，門市會先協助判斷。"
    },
    case_studies: [
      { label: "情境 01", object: "通勤外套", material: "依洗標與布料判斷", concern: "領口袖口使用痕跡、換季前想收納", inspection: "先看材質標籤、髒污位置與是否有汗味或潮氣。", boundary: "沒有看過物件前不報固定價格，也不承諾所有黃痕可消除。" },
      { label: "情境 02", object: "雨後鞋子", material: "鞋面、膠邊與內裡分開判斷", concern: "鞋邊泥灰與鞋內濕悶", inspection: "需看鞋面材質、鞋底邊緣、鞋墊與內裡是否可拆。", boundary: "不建議自行漂白或高溫烘乾，避免材質變形或色差。" },
      { label: "情境 03", object: "家用布品", material: "寢具、被套或厚棉布品", concern: "收納前猶豫是否需要整理", inspection: "先確認是否乾燥、是否有局部髒污、悶味或久放黃痕。", boundary: "不以密封收納掩蓋濕氣；處理方式需依材質與狀態決定。" }
    ],
    sections: [
      {
        heading: "服務範圍",
        body:
          "私享家洗衣店提供衣物洗護、鞋包清潔、白鞋清潔、布品收納前檢查與雨季保養建議。適合西屯、青海路、逢甲周邊與台中市區需要先詢問物件狀態的客人。"
      },
      {
        heading: "在地位置與怎麼到店",
        body:
          "店址在台中市西屯區青海路二段365號，就在至善國中對面，沿青海路二段找學校正門即可看到門市。從逢甲商圈、福星路一帶騎車或開車走青海路過來只要幾分鐘；西屯路、河南路與台灣大道生活圈也都在常見的順路範圍。附近生活圈常見需求包含通勤鞋雨後清潔、上班包包提把和包角整理、換季外套與寢具收納前檢查。"
      },
      {
        heading: "逢甲、西屯學生與通勤族的洗鞋需求",
        body:
          "逢甲商圈與西屯一帶的鞋子走得多：夜市人潮、下雨積水與機車通勤，讓鞋邊灰痕、鞋底泥沙和鞋內濕悶特別常見。白鞋、帆布鞋、麂皮鞋與皮鞋的清潔方式各不相同，建議先拍鞋面、鞋邊與鞋內照片傳 LINE，門市會依材質判斷適合的處理方式，不會一律硬刷或漂白。"
      },
      {
        heading: "到府收送範圍與方式",
        body:
          "台中市全區提供免費到府收送，沒有最低消費門檻，清潔費用依實際物件另計。不方便到店的話，可以先用 LINE 傳照片說明狀況，門市判斷後約時間到府收件，處理完成再送回府上；西屯、逢甲、水湳、南屯或市區都在收送範圍內。"
      },
      {
        heading: "詢問流程",
        body:
          "可以先用 LINE 傳照片，不需要一開始就決定服務項目。門市會先看物件狀態，再回覆建議方向、可改善範圍和是否適合送洗。"
      },
      {
        heading: "社群內容也會同步成搜尋資料",
        body:
          "審核通過的 Facebook 與 Instagram 貼文會同步進公開 SEO / AEO / GEO feed，讓日常門市案例、雨季提醒、節日海報和服務頁互相連回官方內容來源。"
      }
    ],
    inspection_table: [
      {
        item: "衣物外套",
        focus: "領口、袖口、腋下、汗味與收納前狀態",
        risk: "久放後黃痕和味道可能更明顯，建議收納前先判斷。"
      },
      {
        item: "鞋子白鞋",
        focus: "鞋邊、鞋底、縫線、鞋內濕氣與膠邊氧化",
        risk: "硬刷或漂白可能傷材質，白鞋泛黃也不一定能完全復原。"
      },
      {
        item: "包包提把包角",
        focus: "水痕、摩擦、油脂吸附與材質磨耗",
        risk: "已磨耗或掉色的位置不能當成一般髒污處理。"
      },
      {
        item: "寢具布品",
        focus: "潮氣、悶味、灰塵和密封收納前狀態",
        risk: "未乾或有味道就密封，可能讓下次使用時更難整理。"
      }
    ],
    faqs: [
      {
        question: "私享家洗衣店在哪裡？",
        answer: "私享家洗衣店位於台中市西屯區青海路二段365號，可透過 Google Maps 導航，也可以先用 LINE 傳照片詢問。"
      },
      {
        question: "可以先傳照片問，不一定馬上送洗嗎？",
        answer: "可以。建議先傳整體照、局部近照和材質標籤，門市會先看狀態，再建議是否需要送洗或如何處理。"
      },
      {
        question: "洗衣、洗鞋、洗包和布品收納可以一起問嗎？",
        answer: "可以，但最好把不同物件分開拍照。衣物、鞋子、包包和布品的材質與風險不同，會分開判斷。"
      },
      {
        question: "社群貼文內容會和服務頁連在一起嗎？",
        answer: "會。排程產生且審核通過的 FB / IG 貼文會同步成公開 SEO / AEO / GEO 資料，讓服務頁和日常案例互相補強。"
      },
      {
        question: "逢甲附近有推薦的洗鞋店嗎？",
        answer:
          "私享家洗衣店就在西屯青海路二段365號、至善國中對面，從逢甲商圈過來只要幾分鐘。白鞋、帆布鞋、麂皮鞋與皮鞋會依材質分開判斷，建議先用 LINE 傳鞋面與鞋邊照片詢問。"
      },
      {
        question: "住比較遠可以到府收送嗎？",
        answer:
          "可以。台中市全區免費到府收送、沒有最低消費，清潔費用依實際物件另計。先用 LINE 傳照片說明狀況，門市判斷後會約時間收件，完成後送回。"
      }
    ]
  },
  {
    slug: "business-bulk-laundry",
    name: "店家與公司大量衣物送洗",
    local_query_name: "公司大量衣物送洗",
    title: "台中店家・公司大量衣物送洗｜全市免費收送｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）承接台中店家、公司或工作室的大量衣物、制服與布品送洗，可先用 LINE 整理品項與照片，台中市全區免費收送。",
    h1: "台中店家・公司大量衣物送洗",
    summary:
      "店家、公司、工作室或團隊一次有多件制服、工作衣、毛巾、床組或其他布品需要整理時，重點不是先承諾固定價格或天數，而是先確認品項、數量、材質、髒污與交接方式。私享家可在台中市全區安排免費收送，主要透過 LINE 傳照片與清單詢問；清潔與洗護費用另依實際物件判斷。",
    keywords: [
      "台中公司衣物送洗",
      "台中店家大量送洗",
      "台中制服送洗",
      "台中布品送洗",
      "大量衣物收送",
      "公司洗衣收送",
      "LINE 預約送洗"
    ],
    image_hint: "店家與公司的大量衣物",
    image_alt: "台中店家與公司大量衣物送洗前的分類與交接說明",
    image_note: "AI 生成的洗衣空間示意圖，呈現大量衣物與布品分批處理的情境；不是實際客戶物件照片。",
    allow_image_fallback: false,
    static_image_path: "assets/backgrounds/premium-laundry-depth.png",
    static_image_topic: "大量衣物與布品分批洗護的空間示意圖",
    static_image_source: "ai-generated laundry scene background",
    content_lastmod: "2026-08-23",
    area_served_name: "台中市",
    answer_summary:
      "台中店家、公司或工作室有大量制服、工作衣、毛巾、床組或布品需要送洗，可先用 LINE 提供品項、數量與照片；私享家可安排台中市全區免費收送，洗護費與處理方式另依實際物件判斷。",
    case_story: {
      label: "一次有多件衣物或布品，需要先分類再安排收送",
      situation:
        "店家或公司可能累積一批制服、工作衣、毛巾、床組或活動後布品，不方便逐件帶到門市，也擔心不同材質混在一起後無法說清楚。",
      inspection:
        "門市會先看品項清單、件數、材質標籤、主要髒污、是否潮濕，以及是否有需要分開交接的特殊物件；這些資訊會影響後續洗護判斷與收送安排。",
      recommendation:
        "先用 LINE 傳一張整批照片，再補充各類品項與大約件數；有特殊污漬、深淺色、填充物或不能混洗的物件，請另外拍近照與標籤。"
    },
    case_studies: [
      {
        label: "情境 01",
        object: "公司制服與工作衣",
        material: "棉、聚酯纖維或混紡",
        concern: "件數多、領口袖口與工作環境髒污不同",
        inspection: "先分品項、顏色、洗標與主要髒污，再確認是否有需要個別標記的衣物。",
        boundary: "未看品項前不承諾固定報價、固定完成天數或所有污漬都能去除。"
      },
      {
        label: "情境 02",
        object: "店家毛巾與日常布品",
        material: "棉質、混紡或不同厚度布料",
        concern: "汗氣、油脂、濕氣與使用頻率不同",
        inspection: "先確認是否潮濕、是否混有特殊污漬，以及需要分開處理的布品。",
        boundary: "不把不同材質與不同用途物件視為同一種清洗條件。"
      },
      {
        label: "情境 03",
        object: "活動後床組或大量衣物",
        material: "床包、被套、衣物與其他布品",
        concern: "體積大、不方便自行搬運",
        inspection: "先列出品項與數量，拍整批和特殊物件照片，再確認台中市內收送安排。",
        boundary: "收送本身免費不代表洗護免費；品項與處理方式需另行確認。"
      }
    ],
    sections: [
      {
        heading: "先回答：店家或公司大量衣物可以安排收送嗎？",
        body:
          "可以先詢問。私享家提供台中市全區免費收送，店家、公司、工作室或團隊可先透過 LINE 提供品項、數量與照片。門市會先確認是否適合承接與如何分類，再安排後續；收送免費不代表清潔與洗護免費。"
      },
      {
        heading: "LINE 詢問需要準備什麼？",
        body:
          "建議準備整批照片、品項清單、大約件數、材質或洗標、最在意的污漬，以及所在區域。若有深淺色、特殊材質、填充物、油污、潮濕或需要個別標記的物件，請分開拍照說明。"
      },
      {
        heading: "為什麼不先寫固定報價與完成天數？",
        body:
          "大量送洗的品項、材質、件數與狀況差異很大。沒有看過物件前直接承諾固定價格、最低消費、完成時間或清潔效果，容易造成期待落差；本頁只公開已確認的服務範圍、收送方式與詢問流程。"
      },
      {
        heading: "台中市全區免費收送的邊界",
        body:
          "收送範圍為台中市，收送本身免費；清潔、洗護與其他整理費用另計。台中市以外、固定交接時段、急件或其他特殊安排，需由門市在 LINE 對話中另行確認。"
      }
    ],
    inspection_table: [
      {
        item: "品項與件數",
        focus: "制服、工作衣、毛巾、床組或其他布品分開列出",
        risk: "只說一大袋無法判斷材質、數量與處理差異。"
      },
      {
        item: "材質與洗標",
        focus: "棉、混紡、填充物與特殊材質是否混在一起",
        risk: "不同材質不能直接假設使用相同洗護方式。"
      },
      {
        item: "髒污與濕氣",
        focus: "油脂、汗氣、泥灰、潮濕或特殊污漬",
        risk: "潮濕物件若長時間密封，味道與痕跡可能加重。"
      },
      {
        item: "交接資訊",
        focus: "所在區域、聯絡方式與需要個別標記的物件",
        risk: "未確認前不承諾固定收送時段或完成時間。"
      }
    ],
    faqs: [
      {
        question: "台中店家或公司有大量衣物可以送洗嗎？",
        answer: "可以先用 LINE 提供品項、件數與照片詢問；門市確認物件狀態與承接方式後，再安排台中市內免費收送。"
      },
      {
        question: "大量衣物收送要付收送費嗎？",
        answer: "台中市內收送本身免費；清潔、洗護與其他整理費用另依品項與實際狀態判斷。"
      },
      {
        question: "公司制服、毛巾和床組可以放在同一批詢問嗎？",
        answer: "可以一起詢問，但請分開列出品項與件數，並拍材質標籤或特殊污漬；不同材質與用途會分開判斷。"
      },
      {
        question: "大量送洗有固定價格或固定完成天數嗎？",
        answer: "本頁不承諾固定價格、最低消費或完成天數。需要先看品項、件數、材質與狀態，再由門市回覆。"
      }
    ]
  },
  {
    slug: "taichung-citywide-laundry-pickup",
    name: "台中全市免費洗衣收送",
    local_query_name: "台中洗衣收送",
    title: "台中免費收送洗衣｜全市到府、LINE 預約｜私享家洗衣店",
    description:
      "台中免費收送洗衣服務涵蓋全市，收送沒有最低消費門檻，不需單次洗滌滿額。門市在西屯青海路二段365號，先用 LINE 傳照片預約。",
    h1: "台中免費收送洗衣",
    summary:
      "私享家洗衣店提供台中全市免費收送服務。收送本身免費，且不以單次洗滌滿額作為收送條件——收送沒有最低消費門檻。門市位置仍在台中市西屯區青海路二段365號；收送範圍涵蓋台中市，不以西屯為限。預約與詢問以 LINE 為主，先傳照片說明衣物、鞋子、包包或布品狀況，再安排後續。",
    keywords: ["台中洗衣收送", "台中免費收送", "台中全市收送", "洗衣店收送", "私享家洗衣店", "LINE 預約洗衣"],
    image_hint: "收送",
    image_alt: "台中全市免費洗衣收送服務說明｜私享家洗衣店",
    image_note: "AI 生成的門市與街景示意圖，呈現收送服務以西屯門市為起點；不是實際客戶物件照片。",
    allow_image_fallback: false,
    static_image_path: "assets/backgrounds/local-store-depth.png",
    static_image_topic: "門市與街景收送情境示意圖",
    static_image_source: "ai-generated storefront scene background",
    content_lastmod: "2026-07-22",
    area_served_name: "台中市",
    answer_summary:
      "私享家洗衣店提供台中全市免費洗衣收送，且收送沒有最低消費門檻——不因件數少或單次金額未達標準而不收。門市在西屯區青海路二段365號，收送範圍為台中市，主要透過 LINE 預約與傳照片詢問；清潔與洗護費用仍依物件狀態另計。",
    case_story: {
      label: "住在台中其他行政區，也能先用 LINE 問收送",
      situation:
        "客人可能住在台中市內、不在西屯門市旁邊，手上有衣物、鞋子、包包或布品需要整理，想先確認能不能收送、要怎麼開始。",
      inspection:
        "門市會先依照片看物件類型與狀態，再說明收送範圍是台中市、收送本身免費，以及後續是否適合整理；清潔費用與處理方式需另依物件判斷，不以收送免費代表清潔免費。",
      recommendation:
        "建議先加 LINE 傳整體照與局部近照，並說明大致所在區域與想整理的品項；確認方向後再約定收送，門市地址仍以西屯青海路為實體店面。"
    },
    case_studies: [
      {
        label: "情境 01",
        object: "台中市內住家衣物",
        material: "依洗標與布料判斷",
        concern: "不方便到店，想先確認收送",
        inspection: "先確認收送範圍為台中市、收送免費、且收送沒有最低消費門檻，再依照片看衣物狀態。",
        boundary: "收送免費不等於清潔免費：無門檻只指收送條件，清潔與洗護費用仍依物件另計，處理天數需看實際物件。"
      },
      {
        label: "情境 02",
        object: "鞋包與白鞋",
        material: "鞋面、膠邊、包角分開判斷",
        concern: "想先問能不能收、要拍什麼",
        inspection: "先傳鞋面、鞋邊、包角與整體照片，門市再回覆是否適合整理與收送安排。",
        boundary: "不以保證變全新為前提；材質與痕跡需先看再判斷。"
      },
      {
        label: "情境 03",
        object: "換季布品",
        material: "外套、寢具或厚棉布品",
        concern: "量大、想約收送",
        inspection: "先確認品項、是否乾燥與有無悶味，再談收送與整理方向。",
        boundary: "不承諾固定取件時段或保證所有黃痕可消除。"
      }
    ],
    sections: [
      {
        heading: "先回答：台中全市可以免費收送嗎？",
        body:
          "可以。私享家洗衣店的收送範圍是台中市全市，收送本身免費。實體門市在台中市西屯區青海路二段365號；收送服務不限於西屯住戶。清潔、洗護或其他整理項目的費用需另依物件狀態判斷，收送免費不代表清潔免費。"
      },
      {
        heading: "收送沒有最低消費門檻",
        body:
          "收送本身免費，且不以單次洗滌滿額作為收送條件。所謂「無門檻」是指：不因件數少、不因單次金額未達某個標準而拒絕收送。一件衣服、一雙鞋也可以先用 LINE 傳照片詢問。需要說清楚的邊界是：無門檻只適用於收送條件，清潔與洗護費用仍依物件材質與狀態另計，也不代表任何處理效果的保證。"
      },
      {
        heading: "怎麼預約？",
        body:
          "預約與詢問以 LINE 為主。請先傳照片（整體、局部、材質標籤或最在意的痕跡），並簡單說明所在區域與想整理的品項。門市會先回覆方向，再與您約定收送。LINE：https://line.me/ti/p/4m-rA6hxf6"
      },
      {
        heading: "誠實邊界",
        body:
          "本頁只說明已確認事實：台中全市可收送、收送免費、收送沒有最低消費門檻、以 LINE 為主要預約管道、門市在西屯。處理天數、清潔報價、固定取件時段與效果保證則需看實際物件與當下門市回覆，本頁不先行承諾。"
      },
      {
        heading: "門市與收送的關係",
        body:
          "實體店面與現場諮詢仍以西屯青海路門市為準；收送是把台中市內的衣物、鞋包與布品接到門市處理流程的方式。不方便到店的客人，可先用 LINE 完成詢問與收送安排。"
      }
    ],
    inspection_table: [
      {
        item: "收送範圍",
        focus: "台中市全市",
        risk: "台中市以外區域不在本頁確認範圍內，需另詢問。"
      },
      {
        item: "收送費用",
        focus: "收送本身免費",
        risk: "清潔與洗護費用另計，不以 price=0 或「全免費」誤解為清潔免錢。"
      },
      {
        item: "收送門檻",
        focus: "沒有最低消費門檻，不需單次洗滌滿額",
        risk: "無門檻只指收送條件；清潔費用仍依物件判斷，也不是效果保證。"
      },
      {
        item: "預約管道",
        focus: "主要透過 LINE 傳照片詢問與預約",
        risk: "未看過照片前不承諾處理方式或報價細節。"
      },
      {
        item: "實體門市",
        focus: "台中市西屯區青海路二段365號",
        risk: "門市地址與收送範圍不同：地址在西屯，收送涵蓋台中市。"
      }
    ],
    faqs: [
      {
        question: "私享家洗衣店收送範圍到哪裡？",
        answer: "收送範圍為台中市全市，西屯、逢甲、至善國中一帶當天可約。門市在台中市西屯區青海路二段365號（至善國中對面）。"
      },
      {
        question: "收送要錢嗎？有最低件數嗎？",
        answer: "收送本身免費、不限最低件數；清潔費另依價目計算（例：一般運動鞋 $250、雙人棉被 $500、襯衫 $70，水洗價）。一雙鞋也收，順路一起收更划算。"
      },
      {
        question: "收送流程是什麼？多久會來收？",
        answer: "四步：① LINE 傳照片與大致地址 ② 門市回覆報價與可收時段（營業時間 10:00–20:00 內約定）③ 到府收件 ④ 完成後送回並付款。市區通常隔日內可安排收件，急件先說。"
      },
      {
        question: "免費收送有最低消費門檻嗎？",
        answer:
          "收送沒有最低消費門檻。台中市內收送本身免費，不需要單次洗滌滿額才能收；清潔費用依實際物件判斷，與是否收送無關。"
      },
      {
        question: "只有一件衣服或一雙鞋也可以收嗎？",
        answer:
          "可以，先用 LINE 傳照片詢問即可。不因件數少而不收；是否適合整理與清潔費用，會在看過物件狀態後說明。"
      },
      {
        question: "怎麼預約收送？",
        answer: "LINE 傳照片最快：加 0968327653，附整體與局部照片、說明區域與品項，門市直接回報價與收件時段。儲值會員另享滿 1000 送 100 起的儲值優惠。"
      },
      {
        question: "一定要到西屯門市嗎？",
        answer: "不一定。台中市內可約免費收送；若方便到店，門市在西屯區青海路二段365號（至善國中對面），營業時間 10:00–20:00、週日公休。"
      }
    ]
  },
  // R1: dedicated 價目表 service page for "多少錢" queries. Prices copied from
  // src/contentPlan.ts PRICE_LINES (1446-1456); do not invent items or change digits.
  {
    slug: PRICE_LIST_SLUG,
    name: "台中洗衣價目表",
    local_query_name: "洗衣價目表",
    title: "台中洗衣價目表｜台中洗鞋價格・洗包包多少錢｜西屯洗衣店價格｜私享家洗衣店",
    description:
      "台中洗衣價目表：洗鞋、洗包、洗衣與寢具水洗參考價一次列清。門市在西屯青海路二段365號，台中市全區免費到府收送，LINE 0968327653。",
    h1: "台中洗衣價目表",
    summary:
      "台中洗衣洗鞋洗包參考價約 $70 到 $2500：襯衫 $70、一般運動鞋 $250、名牌包 $1500 起；皆為水洗參考價，不是固定價。",
    keywords: [
      "台中洗衣價目表",
      "台中洗鞋價格",
      "洗包包多少錢",
      "西屯洗衣店價格",
      "台中洗衣多少錢",
      "台中洗鞋多少錢"
    ],
    image_hint: "價目表",
    image_alt: "台中洗衣洗鞋洗包參考價目說明",
    image_note: "本頁以文字價目表為主，不使用與價格無關的客戶物件照片。",
    allow_image_fallback: false,
    content_lastmod: "2026-08-26",
    area_served_name: "台中市",
    answer_summary:
      "台中洗衣洗鞋洗包參考價約 $70 到 $2500：襯衫 $70、一般運動鞋 $250、名牌包 $1500 起；皆為水洗參考價，不是固定價。",
    case_story: {
      label: "先對照參考價，再依實際檢視",
      situation:
        "客人常先問台中洗衣、洗鞋、洗包多少錢，需要一頁把參考價一次列清楚，再決定要不要傳照片詢問。",
      inspection:
        "門市會先對照品項參考價，再看材質、污損程度，以及是否需要乾洗或柔洗。",
      recommendation:
        "先看本頁參考價，再用 LINE 傳照片確認；數字是參考價，以實際檢視為準。"
    },
    case_studies: [
      {
        label: "情境 01",
        object: "一般運動鞋",
        material: "網布或皮革感鞋面",
        concern: "想先知道台中洗鞋大概多少錢",
        inspection: "先對照鞋類參考價：一般運動鞋 $250、皮類運動鞋 $300（水洗價）。",
        boundary: PRICE_LIST_DISCLAIMER
      },
      {
        label: "情境 02",
        object: "名牌包",
        material: "依包身與配件判斷",
        concern: "名牌包清洗多少錢",
        inspection: "先對照包類參考價：名牌包 $1500 起、特殊類名牌包 $2500（水洗價）。",
        boundary: PRICE_LIST_DISCLAIMER
      },
      {
        label: "情境 03",
        object: "襯衫與寢具",
        material: "依洗標判斷",
        concern: "洗衣與棉被參考價",
        inspection: "先對照衣物寢具參考價：襯衫 $70、棉被單人 $350 / 雙人 $500（水洗價）。",
        boundary: PRICE_LIST_DISCLAIMER
      }
    ],
    sections: [
      {
        heading: "價格怎麼決定",
        body:
          "本頁列出的是水洗參考價，不是固定價。乾洗、柔洗會另計，同一品項若材質不同、污損較深，或已經發霉，處理工序就不一樣。鞋面、包身、衣物填充與髒污深度都會影響報價，所以要看過物件後才能定案。水洗價，乾洗柔洗另計；發霉、特殊污漬與特殊材質另行報價，以實際檢視為準。"
      },
      {
        heading: "儲值優惠",
        body: "儲值優惠：滿 1000 送 100、儲 3000 送 400、儲 6000 送 1000。"
      },
      {
        heading: "免費收送範圍與怎麼預約",
        body:
          "台中市全區免費到府收送。先用 LINE 0968327653 傳整體與局部照片、說明所在區域與品項，門市回覆參考價與可收時段後再約定收件。收送本身不另外收費；清潔仍依參考價與實際檢視計算。"
      },
      {
        heading: "門市地址與 LINE",
        body:
          "門市在台中市西屯區青海路二段365號（至善國中對面）。LINE 0968327653。也可到店詢問，或先傳照片再約台中市全區免費到府收送。"
      }
    ],
    // R2②: three category tables. Item names and price strings copied verbatim.
    price_tables: [
      {
        heading: "鞋類",
        rows: [
          { item: "一般運動鞋", price: "$250(水洗價)" },
          { item: "皮類運動鞋", price: "$300(水洗價)" },
          { item: "休閒鞋", price: "$350(水洗價)" },
          { item: "麂皮鞋", price: "$400(水洗價)" },
          { item: "皮鞋", price: "$400(水洗價)" },
          { item: "低靴", price: "$350(水洗價)" },
          { item: "高靴", price: "$550(水洗價)" }
        ]
      },
      {
        heading: "包類",
        rows: [
          { item: "背包清洗", price: "$500(水洗價)" },
          { item: "一般包", price: "$600(水洗價)" },
          { item: "皮包", price: "$1000(水洗價)" },
          { item: "名牌包", price: "$1500 起(水洗價)" },
          { item: "特殊類名牌包", price: "$2500(水洗價)" }
        ]
      },
      {
        heading: "衣物寢具",
        rows: [
          { item: "襯衫", price: "$70(水洗價)" },
          { item: "整燙", price: "$50" },
          { item: "長褲", price: "$70 / 短褲 $60(水洗價)" },
          { item: "西裝背心", price: "$80(水洗價)" },
          { item: "長大衣", price: "$300(水洗價，乾洗另計)" },
          { item: "羽絨外套", price: "$280(水洗價)" },
          { item: "皮衣", price: "$1200 / 特殊皮衣 $2000(發霉另計)" },
          { item: "棉被單人", price: "$350 / 雙人 $500(水洗價)" },
          { item: "床組四件套", price: "$300(水洗價)" },
          { item: "羽絨羊毛被", price: "$800(水洗價)" },
          { item: "窗簾、地毯", price: "依尺寸報價，LINE 傳照片先估" },
          { item: "絨毛娃娃", price: "依大小報價，LINE 傳照片先估" }
        ]
      }
    ],
    faqs: [
      {
        question: "台中洗鞋大概多少錢?",
        answer:
          "台中洗鞋參考價：一般運動鞋 $250、皮類運動鞋 $300、休閒鞋 $350、麂皮鞋與皮鞋 $400、低靴 $350、高靴 $550（水洗價）。水洗價，乾洗柔洗另計；發霉、特殊污漬與特殊材質另行報價，以實際檢視為準。"
      },
      {
        question: "名牌包清洗多少錢?",
        answer:
          "名牌包清洗參考價 $1500 起、特殊類名牌包 $2500（水洗價）；一般包 $600、皮包 $1000、背包清洗 $500。水洗價，乾洗柔洗另計；發霉、特殊污漬與特殊材質另行報價，以實際檢視為準。"
      },
      {
        question: "洗衣有到府收送嗎?要多少錢?",
        answer:
          "台中市全區免費到府收送。收送本身不另外收費；清潔仍依參考價與實際檢視計算。請用 LINE 0968327653 傳照片預約。"
      },
      {
        question: "乾洗跟水洗價格差在哪?",
        answer:
          "本頁列出的是水洗參考價；乾洗、柔洗另計，不會用同一組數字。材質、污損程度與是否發霉都會影響報價，以實際檢視為準。"
      }
    ]
  }
];

/** Citation-ready first-paragraph answers. Same strings feed llms.txt and answers.json. */
const AEO_PHOTO_BEFORE_LAUNDRY = "送洗前拍整體、局部、材質與最在意痕跡，照片比只問價錢更能判斷。";
const AEO_WHITE_SHOE_GRAY_VS_YELLOW = "白鞋灰多半是髒、可清；黃在膠邊是氧化，只能淡化，不保證回白。";
const AEO_RAINY_SHOE = "雨天鞋子進水後先通風、取出鞋墊；不要高溫烘或悶進鞋櫃。";
const AEO_LUGGAGE_WHEELS = "行李箱收進櫃子前先看輪子；輪子與底板灰收進去，下次打開就是味道。";
const AEO_CURTAIN = "窗簾先看布料與軌道；尺寸不同價不同，拍照比先問固定價準。";
const AEO_CARPET = "地毯先看材質與潮濕；沒乾就捲起來，下次打開就是味道。";
const AEO_FENGJIA_LAUNDRY = "逢甲洗衣可先LINE傳照片；宿舍與租屋都可約台中免費收送。";
const AEO_ZHONGKE_LAUNDRY = "中科園區襯衫可約收送；先列件數與材質，清潔另計、收送免費。";
const AEO_DONGHAI_LAUNDRY = "東海生活圈可約免費收送；厚被、窗簾與日常衣物先傳照片再收。";
const AEO_BEDDING_STORAGE = "寢具收納前先聞潮味；摸起來乾、中間層不一定乾，帶濕氣封存會悶出味道。";
const AEO_BEDDING_DUVET = "棉被送洗先看填充、潮氣與異味；沒乾透就收納，下一季打開就是味道。";
const AEO_PLUSH_DOLL_BOUNDARY = "娃娃可以洗，但不能亂洗；怕的是脫水結塊與五官脫落，要先固定再手洗。";
const AEO_LUXURY_DRY = "精品送洗先看材質與飾件，不因品牌保證全新；邊角磨損只能維持。";
const AEO_CLOTHING_ALTERATION = "送洗時若同時需要修改，可以一起收送，但先分清楚是小修還是版型調整。";

const LEGACY_SUPPORT_PAGE_DEFINITIONS: SupportPageDefinition[] = [
  {
    slug: "photo-before-laundry",
    path: "guides/photo-before-laundry.html",
    category: "guide",
    title: "送洗前怎麼拍照片詢問？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）建議送洗前先拍整體、局部、材質與最在意的痕跡，才能更準確判斷衣物、鞋子、包包或布品是否適合整理。",
    h1: "送洗前怎麼拍照片詢問？",
    summary: AEO_PHOTO_BEFORE_LAUNDRY,
    citation_answer: AEO_PHOTO_BEFORE_LAUNDRY,
    keywords: ["送洗前拍照", "LINE 詢問洗衣店", "台中西屯洗衣店", "青海路洗衣店"],
    service_slug: "taichung-xitun-laundry",
    local_intent: "台中西屯 送洗前 LINE 詢問",
    content_lastmod: "2026-08-23",
    steps: [
      { name: "拍整體", text: "先拍完整正面或整體外觀，讓門市知道物件類型、大小與主要材質。" },
      { name: "拍局部", text: "再拍污漬、泛黃、水痕、包角、鞋邊或領口袖口等局部近照。" },
      { name: "拍使用位置", text: "鞋子拍鞋內與鞋底，包包拍提把和四角，外套寢具拍標籤和容易悶住的位置。" },
      { name: "說明期待", text: "告訴我們最在意的是味道、痕跡、泛黃、收納前整理，還是材質保護。" }
    ],
    sections: [
      {
        heading: "門市怎麼用照片判斷",
        body:
          "私享家會依材質、髒污來源、濕氣與磨耗狀態先做初步判斷，不是先報一個固定數字。整體照說明物件類型與大小；局部照說明痕跡在哪、有沒有滲入；材質或洗標照決定能不能水洗、該不該乾洗。鞋子還要看鞋內與鞋底，包包要看提把和四角，外套與寢具要看領口袖口、邊角和容易悶住的位置。只問價錢、不附照片，門市只能回「要看物件」，因為同樣一雙運動鞋或同一件棉被，膠邊氧化、填充受潮或飾件鬆動都會讓處理方向不同。把最在意的位置單獨拍一張，整體照看不出局部問題。台中西屯洗衣店這一步就是把狀態說清楚，再決定要不要約收送。"
      },
      {
        heading: "什麼救得回、什麼只能維持",
        body:
          "照片能先判斷方向，但實際處理方式仍要看現場材質、髒污滲入程度和物件狀態。表面灰塵、剛沾上的泥灰、還沒上油的雨痕、還沒封存的潮味，通常還有處理空間；膠邊氧化、邊油磨穿、填充結塊、五官脫落、已經自行漂白或硬刷過的痕跡，只能維持或淡化，不保證變全新。門市不會在沒看過照片前承諾洗白、去味或恢復新品。不確定就先保留原狀，不要自行強洗或用未知藥劑，處理過的痕跡會讓後續判斷變難。"
      },
      {
        heading: "傳 LINE 前對應哪一頁服務",
        body:
          "拍完四類照片後，用 LINE（0968327653）傳給門市，並補一句最在意的是味道、痕跡、泛黃還是收納前整理。台中市全區可約免費到府收送，清潔費另依物件判斷、沒有最低消費門檻。白鞋對應白鞋清潔頁，其他鞋包對應鞋包清潔頁，寢具與厚棉布品對應布品收納頁；本頁只回答怎麼拍、拍哪裡，不另開薄頁。"
      }
    ],
    faqs: [
      {
        question: "送洗前只傳一張照片可以嗎？",
        answer: "可以先傳一張，但如果要判斷比較準，建議補整體、局部和材質標籤照片。"
      },
      {
        question: "照片可以直接估價嗎？",
        answer: "照片能先判斷方向，但實際處理方式仍要看現場材質、髒污滲入程度和物件狀態。"
      }
    ]
  },
  {
    slug: "white-shoe-yellowing",
    path: "guides/white-shoe-yellowing.html",
    category: "guide",
    title: "白鞋泛黃怎麼判斷？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）處理白鞋泛黃：不一定只是髒污，可能和材質、膠邊、氧化、濕氣與清潔方式有關，整理前先判斷鞋面、鞋邊與內裡狀態。",
    h1: "白鞋泛黃怎麼判斷？",
    summary: AEO_WHITE_SHOE_GRAY_VS_YELLOW,
    citation_answer: AEO_WHITE_SHOE_GRAY_VS_YELLOW,
    keywords: ["白鞋泛黃", "白鞋清潔", "台中西屯白鞋清潔", "鞋子保養"],
    service_slug: "white-shoe-cleaning",
    local_intent: "台中西屯 白鞋泛黃 白鞋清潔",
    content_lastmod: "2026-08-23",
    steps: [
      { name: "看鞋面", text: "確認鞋面是皮革、布面、網布還是合成材質。" },
      { name: "看鞋邊", text: "檢查膠邊是否泛黃、磨耗或有清潔後留下的刷痕。" },
      { name: "看內裡", text: "檢查鞋內濕氣、鞋墊能否拆卸，以及是否有悶味。" },
      { name: "決定方式", text: "依材質選擇清潔和整理方式，不先用漂白水或硬刷處理。" }
    ],
    sections: [
      {
        heading: "門市怎麼分灰和黃",
        body:
          "白鞋泛黃，不是刷得不夠用力。門市先看三個位置：鞋邊那圈膠條、布面靠鞋頭、鞋帶孔周圍。膠條上的灰多半是附著的髒，擦得掉；已經轉成黃，是膠本身氧化，刷不掉，只能淡化。布面兩道洗不掉的灰帶，通常是刷過頭把纖維刷起毛，越刷越舊。鞋帶孔金屬圈旁邊一圈深色是汗漬，滲進去久了會連布一起染。黃在布面、來自洗劑殘留，多半洗得回來；黃在鞋邊膠條，不是髒。縫線卡灰、鞋墊潮感和內裡悶味也要分開看，不要把所有黃痕都當成可洗掉的髒污。對應服務是白鞋清潔頁，不是把所有白鞋都當一般鞋包處理。"
      },
      {
        heading: "什麼救得回、什麼只能維持",
        body:
          "三個位置都是灰的，多半還有清潔空間；鞋邊已經轉黃，就先講清楚只能淡化，不保證回白，也不保證變全新。膠邊氧化、材質本身變色、已經被硬刷起毛或漂白過的痕跡，整理目標是降低痕跡和保護材質。不確定材質時，不要先用漂白水或硬刷，避免褪色、起毛或膠痕更明顯。過度摩擦可能讓毛邊與色差更明顯。公開水洗價：一般運動鞋 250、皮類運動鞋 300；乾洗柔洗另計，以實際報價為主。"
      },
      {
        heading: "送洗前怎麼問白鞋清潔",
        body:
          "拍鞋面、鞋邊、鞋內與整體四張，用 LINE（0968327653）傳給門市，說明是鞋邊灰還是布面灰。台中市全區可約免費到府收送，清潔費另計、沒有最低消費門檻。雨後濕氣另看雨天鞋子指南；本頁只回答灰與黃怎麼分。"
      }
    ],
    faqs: [
      {
        question: "白鞋泛黃一定能變回全白嗎？",
        answer: "不一定。若是表面髒污機會較高；若是膠邊氧化或材質變色，整理目標會以降低痕跡和保護材質為主。"
      },
      {
        question: "白鞋可以自己先刷再送洗嗎？",
        answer: "如果不確定材質，不建議先用強力清潔劑或硬刷，避免造成褪色、起毛或膠邊痕跡。"
      }
    ]
  },
  {
    slug: "school-uniform-care",
    path: "guides/school-uniform-care.html",
    category: "guide",
    title: "開學前制服怎麼整理?領口黃、袖口髒的處理順序｜台中送洗",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）處理開學前制服領口發黃、袖口油污，先處理再整燙才不會把黃痕定型，台中市全區可免費收送。",
    h1: "開學前的制服整理:順序錯了會把黃痕定死",
    summary: "每年開學前一週,制服是送洗量最大的一項。家長最常做錯的一件事:先燙再說。高溫會把領口的皮脂氧化痕定型,之後再洗就洗不掉了。正確順序是先處理舊痕,再整燙。",
    keywords: ["制服送洗", "制服領口發黃", "開學 制服 整理", "台中制服清洗", "學生制服 送洗", "制服整燙"],
    service_slug: "taichung-xitun-laundry",
    local_intent: "台中 制服送洗 開學 領口發黃",
    content_lastmod: "2026-08-23",
    steps: [
      { name: "先看領口內側", text: "翻開領子看內側那一圈:淺黃是新的皮脂,深黃帶硬感是已經氧化過的舊痕,兩者處理力道不同。" },
      { name: "袖口與腋下一起看", text: "袖口是手接觸最多的地方,腋下是止汗劑與汗鹽,兩處常被忽略,只洗表面等於沒洗。" },
      { name: "先處理再整燙", text: "順序不能反。有舊痕先局部處理,確認淡化後才進整燙,否則高溫會把痕跡定型。" },
      { name: "名條與繡字避開", text: "有繡字或熨燙名條的位置要避開高溫直壓,否則會反光發亮。" },
      { name: "收納掛法", text: "洗好用寬肩衣架掛,不要摺壓在抽屜,開學那天拿出來才不用重燙。" }
    ],
    faqs: [
      {
        question: "制服領口的黃可以完全洗掉嗎?",
        answer: "新的皮脂黃多半能明顯改善;已經被高溫燙過定型的舊痕,以淡化為目標,不保證回到全白。送洗前先講清楚是哪一種。"
      },
      {
        question: "開學前送洗來得及嗎?",
        answer: "一般清潔加整燙數日內可完成,開學前一週是尖峰,建議提早。急件先在 LINE 說明,我們會盡量安排。"
      },
      {
        question: "制服送洗多少錢?",
        answer: "參考價:襯衫 $70、整燙 $50、長褲 $70、短褲 $60(水洗價,乾洗柔洗另計,以實際報價為主)。"
      },
      {
        question: "可以順便洗書包和鞋子嗎?",
        answer: "可以,一起收最省事。書包 $500、一般運動鞋 $250、童鞋 $150。台中市全區免費到府收送。"
      }
    ]
  },
  {
    slug: "birkenstock-care",
    path: "guides/birkenstock-care.html",
    category: "guide",
    title: "勃肯鞋鞋床發黑、有味道怎麼處理?台中洗鞋｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）處理勃肯鞋：軟木鞋床吸汗會發黑發臭，麂皮面又不能泡水，先傳照片判斷軟木與麂皮各自的處理方式。",
    h1: "勃肯鞋鞋床發黑、有味道,還救得回來嗎?",
    summary: "勃肯這類軟木鞋床的鞋,問題幾乎都在同一個地方:腳掌接觸的那層軟木被汗浸久了,顏色變深、味道跑出來。麂皮鞋面怕水、軟木怕泡,所以整雙丟水裡刷是最傷的做法。分開處理才對。",
    keywords: ["勃肯鞋清潔", "勃肯鞋發黑", "軟木鞋床 清洗", "台中洗勃肯", "麂皮鞋清潔", "勃肯鞋除臭"],
    service_slug: "white-shoe-cleaning",
    local_intent: "台中 勃肯鞋清潔 軟木鞋床 除臭",
    content_lastmod: "2026-08-23",
    steps: [
      { name: "先分三層", text: "麂皮鞋面、軟木鞋床、橡膠大底,三種材質三種做法。整雙泡水會讓軟木鬆散、麂皮硬掉。" },
      { name: "看鞋床顏色", text: "腳掌位置深黑=汗垢滲入軟木層;只有表面灰=角質與塵土,後者好處理很多。" },
      { name: "聞味道來源", text: "味道多半來自鞋床而不是鞋面。鞋面噴除臭劑沒用,要處理軟木。" },
      { name: "麂皮不下水", text: "麂皮用專用刷順毛乾清,染色或深漬另外評估,不與軟木同時濕作業。" },
      { name: "乾燥要慢", text: "軟木快乾會裂。陰乾、避免日曬和烘乾機,這步急不得。" }
    ],
    faqs: [
      {
        question: "勃肯鞋可以整雙丟洗衣機嗎?",
        answer: "不建議。軟木鞋床泡水後會鬆散變形、麂皮會硬掉,洗完可能比洗前更糟。分材質處理才是正確做法。"
      },
      {
        question: "鞋床黑掉能洗回原色嗎?",
        answer: "表層角質與塵土多半能明顯改善;汗垢已滲入軟木深層的,以去味與淡化為目標,不保證回到原色。處理前會先講清楚界線。"
      },
      {
        question: "台中洗勃肯鞋多少錢?",
        answer: "參考價:休閒鞋 $350、麂皮鞋 $400(水洗價,乾洗柔洗另計,以實際報價為主)。LINE 傳鞋床與鞋面照片(0968327653)可先確認。"
      },
      {
        question: "多久洗一次比較好?",
        answer: "天天穿的建議每季一次,不要等到味道明顯才處理——汗垢滲得越深越難救。台中市全區免費收送。"
      }
    ]
  },
  {
    slug: "luxury-bag-mold",
    path: "guides/luxury-bag-mold.html",
    category: "guide",
    title: "精品包發霉了怎麼辦?先別擦!台中精品包清潔｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）處理精品包發霉：先不要用濕布擦，判斷是表面白霉還是滲入皮層，處理方式與可救程度完全不同，台中市可免費收送。",
    h1: "精品包發霉:先別擦,先看這三件事",
    summary: "台灣的梅雨與夏季濕氣,讓收在櫃子裡的包最常出事。發現白白一層時,最傷的動作是拿濕布用力擦——那會把霉推進皮革毛孔,還可能造成色斑。先判斷,再動手。",
    keywords: ["精品包發霉", "包包發霉處理", "皮包 發霉", "台中精品包清潔", "名牌包保養", "包包除霉"],
    service_slug: "shoe-bag-care",
    local_intent: "台中 精品包發霉 名牌包清潔 除霉",
    content_lastmod: "2026-08-23",
    steps: [
      { name: "先不要擦", text: "濕擦會把霉絲推入皮革毛孔並擴散。先把包移到通風處,不要密封回防塵袋。" },
      { name: "看霉的形態", text: "浮在表面像粉的白霉,多半能處理;已經有色差或斑點邊界的,是霉根進到皮層,只能淡化。" },
      { name: "檢查內裡", text: "內裡布面常比外皮嚴重。內裡的霉味不處理,外面再乾淨也會再犯。" },
      { name: "五金與縫線", text: "金屬扣件氧化、縫線發黑要同時評估,清潔劑選錯會讓五金失去鍍層。" },
      { name: "收納才是關鍵", text: "處理完用透氣布袋、不要塑膠密封,櫃內放除濕,才不會三個月後又長。" }
    ],
    faqs: [
      {
        question: "精品包發霉自己用酒精擦可以嗎?",
        answer: "不建議。酒精會帶走皮革油脂造成乾裂與色差,尤其是植鞣皮與麂皮。先拍照詢問,不要自行試藥劑。"
      },
      {
        question: "發霉的包可以完全恢復嗎?",
        answer: "表面白霉大多能明顯改善;霉斑已造成色差或滲入皮層的,以淡化與抑制擴散為目標,不保證完全復原。評估時會誠實說明。"
      },
      {
        question: "台中精品包清潔多少錢?",
        answer: "參考價:一般包 $600、皮包 $1000、名牌包 $1500、特殊類名牌包 $2500(水洗價;發霉特污另計,包角皮革另有補色/修補)。"
      },
      {
        question: "怎麼送洗?",
        answer: "LINE 傳整體照、發霉位置特寫與內裡照(0968327653),先評估再決定。台中市全區免費到府收送,門市在西屯青海路二段365號(至善國中對面)。"
      }
    ]
  },
  {
    slug: "down-jacket-cleaning",
    path: "guides/down-jacket-cleaning.html",
    category: "guide",
    title: "羽絨外套、羽絨被可以水洗嗎？台中送洗前先看這篇｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）處理羽絨外套與羽絨被：能不能水洗、洗完會不會不蓬，要先看洗標、塗層與走線，台中市可免費收送。",
    h1: "羽絨外套、羽絨被怎麼洗才不會毀掉？",
    summary: "羽絨最怕兩件事：洗錯方式讓羽絨結塊，和沒乾透就收納悶出味道。大部分羽絨其實適合專業水洗加低溫烘乾，反而不一定適合乾洗；但外層有塗層或貼合工藝的要另外判斷。台中換季前送洗可約免費收送。",
    keywords: ["羽絨外套清洗", "羽絨被送洗", "羽絨外套可以水洗嗎", "台中洗羽絨被", "台中羽絨外套送洗", "羽絨被清洗"],
    service_slug: "fabric-storage",
    local_intent: "台中 羽絨外套清洗 羽絨被送洗 換季",
    content_lastmod: "2026-08-23",
    steps: [
      { name: "先看洗標", text: "羽絨製品的洗標決定方向：可水洗、限乾洗或手洗各有不同風險，看不懂符號就直接拍洗標照片來問。" },
      { name: "檢查走線與破口", text: "車線鬆脫或小破口在清洗時會讓羽絨跑出來，送洗前先檢查領口、袖口與絎縫線。" },
      { name: "標記局部污漬", text: "領口油光、袖口灰痕、下擺泥點成因不同，先拍照標記位置，處理方式會分開判斷。" },
      { name: "清洗與烘乾方式", text: "多數羽絨適合專業水洗加低溫慢烘讓羽絨恢復蓬鬆；外層有防水塗層或皮革拼接的要先評估。" },
      { name: "收納前確認全乾", text: "羽絨沒乾透就壓縮收納，會悶出味道也會失去蓬鬆度。收納前確認內部完全乾燥。" }
    ],
    faqs: [
      {
        question: "羽絨外套可以自己丟洗衣機嗎？",
        answer: "有風險。家用洗衣機的轉速與烘乾溫度容易讓羽絨結塊或跑絨，尤其是有塗層或貼合工藝的外套。不確定時先拍洗標和外觀照片來問。"
      },
      {
        question: "羽絨外套洗完不蓬了怎麼辦？",
        answer: "多半是羽絨受潮結塊或烘乾不足。專業低溫慢烘通常能改善蓬鬆度，但若羽絨已流失或纖維受損，只能恢復到有限程度，會先告知界線。"
      },
      {
        question: "羽絨被多久洗一次？",
        answer: "一般建議每年換季收納前清洗一次；平時用被套保護可以拉長間隔。有汗味、潮味或黃斑時就不要再等。"
      },
      {
        question: "台中洗羽絨被可以收送嗎？",
        answer: "可以，台中市全區免費收送。羽絨被體積大不好帶，約好時間到府收件即可，LINE：0968327653。"
      }
    ]
  },
  {
    slug: "leather-jacket-care",
    path: "guides/leather-jacket-care.html",
    category: "guide",
    title: "皮衣可以洗嗎？發霉、變硬怎麼救｜台中皮衣保養 私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）處理皮衣清潔保養：發霉、變硬、色差要依真皮、合成皮或麂皮分別判斷，不能用一般方式洗。",
    h1: "皮衣清潔保養：發霉、變硬、色差怎麼判斷？",
    summary: "皮衣最常見的三個狀況：收納環境潮濕悶出霉點、久放缺油變硬、局部摩擦造成色差。真皮、合成皮和麂皮的處理方式完全不同，用錯方式會讓皮面褪色或硬化。送保養前先拍全身照與問題位置特寫。",
    keywords: ["皮衣保養", "皮衣清潔", "台中皮衣保養", "皮衣發霉", "皮衣可以洗嗎", "皮衣送洗"],
    service_slug: "shoe-bag-care",
    local_intent: "台中 皮衣保養 皮衣清潔 皮衣發霉",
    content_lastmod: "2026-08-23",
    steps: [
      { name: "先分材質", text: "真皮、合成皮（PU/PVC）和麂皮的清潔方式完全不同。看洗標或內裡標籤，不確定就拍照來問。" },
      { name: "看霉點範圍", text: "表面白霉多半能處理；霉根吃進皮層或內裡的，能改善的程度要先評估，處理前會先講界線。" },
      { name: "檢查五金與內裡", text: "拉鍊、鉚釘氧化與內裡汗味是連帶問題，保養時一起判斷才不會洗完外面、裡面還有味道。" },
      { name: "保養方式判斷", text: "皮衣以專業清潔加補油護理為主，不是水洗也不是一般乾洗。變硬缺油的皮面經護理多能恢復柔軟度。" },
      { name: "收納環境", text: "保養後用寬肩衣架掛放、避免塑膠套密封，潮濕季節加除濕，霉才不會回來。" }
    ],
    faqs: [
      {
        question: "皮衣發霉還有救嗎？",
        answer: "表面霉點大多能明顯改善；霉斑已滲入皮層或造成色差的，以淡化和抑制擴散為目標，不保證完全復原，評估時會先講清楚。"
      },
      {
        question: "皮衣可以送一般乾洗嗎？",
        answer: "一般乾洗溶劑會帶走皮革油脂，讓皮面變硬龜裂。皮衣要走皮革專屬的清潔與補油流程，送洗前請先確認店家有皮革護理能力。"
      },
      {
        question: "皮衣多久保養一次？",
        answer: "常穿的一年一次；收納過潮濕季節後建議檢查一次。摸起來變硬、顏色變濁或有霉味就是該保養的訊號。"
      },
      {
        question: "台中皮衣保養怎麼送？",
        answer: "拍全身照加問題位置特寫，LINE 傳給門市先評估（0968327653）；台中市全區可約免費收送。"
      }
    ]
  },
  {
    slug: "dry-cleaning-guide",
    path: "guides/dry-cleaning-guide.html",
    category: "guide",
    title: "乾洗、水洗差在哪？哪些衣物一定要乾洗｜台中乾洗 私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）判斷乾洗還是水洗：西裝、大衣、絲質、羊毛先看洗標和材質，台中市乾洗送洗可免費收送。",
    h1: "乾洗還是水洗？送洗前搞懂這一篇",
    summary: "乾洗用溶劑帶走油性髒污、保護不耐水的纖維與版型；水洗對汗味和水性髒污比較有效。西裝、大衣、絲質上衣通常走乾洗，襯衫和棉質日常衣物多半水洗加整燙。判斷不了就拍洗標，一張照片比猜十次準。",
    keywords: ["乾洗 水洗 差別", "台中乾洗", "乾洗店 台中", "西裝乾洗", "大衣乾洗", "襯衫送洗", "台中西屯乾洗"],
    service_slug: "taichung-xitun-laundry",
    local_intent: "台中 乾洗 西裝乾洗 大衣乾洗 襯衫送洗",
    content_lastmod: "2026-08-23",
    steps: [
      { name: "先看洗標符號", text: "圓圈是乾洗、水盆是水洗、打叉是禁止。圓圈裡的字母代表溶劑類型，看不懂拍照來問最快。" },
      { name: "分辨髒污類型", text: "汗味、飲料漬偏水性適合水洗；油光、皮脂、妝痕偏油性乾洗較有效。混合狀況會先局部處理再整件清洗。" },
      { name: "看材質與結構", text: "羊毛、絲質、有襯裡有墊肩的西裝外套與大衣，水洗容易縮皺變形，通常走乾洗保護版型。" },
      { name: "送洗前檢查", text: "口袋清空、配件拆下、破損處先告知；有特別在意的痕跡拍特寫標記。" },
      { name: "取件後通風", text: "乾洗後先在通風處掛半天再收，不要立刻套塑膠套密封收納。" }
    ],
    faqs: [
      {
        question: "乾洗和水洗到底差在哪？",
        answer: "乾洗用溶劑不用水，擅長油性髒污並保護怕水縮皺的材質與版型；水洗對汗和水性髒污較徹底。依材質和髒污類型選，不是乾洗就一定比較高級。"
      },
      {
        question: "哪些衣物一定要乾洗？",
        answer: "洗標只有乾洗符號的、羊毛大衣、有墊肩襯裡的西裝外套、絲質與部分嫘縈製品。錯用水洗可能縮水變形，無法完全復原。"
      },
      {
        question: "西裝多久乾洗一次？",
        answer: "常穿的每季一到兩次即可，穿一次洗一次反而傷纖維；平時掛通風處、局部除味就好，有明顯髒污或異味再送。"
      },
      {
        question: "台中乾洗怎麼估價？",
        answer: "公開價目（水洗價）：襯衫 $70、西裝背心 $80、毛衣 $150、薄外套 $150、厚外套 $180、長大衣 $300、禮服 $450、羽絨外套 $280、G-T 外套 $250。乾洗柔洗另計，以實際報價為主；LINE 傳照片（0968327653）可先確認，台中市全區免費收送。"
      }
    ]
  },
  {
    slug: "rainy-shoe-care",
    path: "guides/rainy-shoe-care.html",
    category: "guide",
    title: "雨天鞋子進水後怎麼辦？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）處理雨天鞋子：通勤後鞋內濕氣、鞋底泥灰和鞋邊水痕容易被忽略，先通風、不要悶放，再判斷是否需要專業清潔。",
    h1: "雨天鞋子進水後怎麼辦？",
    summary: AEO_RAINY_SHOE,
    citation_answer: AEO_RAINY_SHOE,
    keywords: ["雨天鞋子保養", "鞋子進水", "雨季保養", "台中洗鞋"],
    service_slug: "shoe-bag-care",
    local_intent: "台中西屯 雨天鞋子清潔",
    content_lastmod: "2026-08-23",
    steps: [
      { name: "先通風", text: "回家後先放在通風處，不要直接塞進密閉鞋櫃。" },
      { name: "取出鞋墊", text: "能拆的鞋墊先取出，讓內部濕氣散出。" },
      { name: "拍鞋邊", text: "拍鞋底邊緣、鞋面水痕和鞋內照片給門市判斷。" },
      { name: "避免高溫", text: "不要用高溫烘或曬到變形，材質可能變硬或變色。" }
    ],
    sections: [
      {
        heading: "門市怎麼看淋雨後的鞋",
        body:
          "鞋子淋雨後看起來只是鞋面有點灰，真正容易留下味道的地方常常是鞋舌、鞋墊下面和縫線附近。門市會先確認鞋墊能不能拆、內裡是汗味還是雨水味，再看鞋面材質和膠邊狀態，判斷要做表面清潔、內裡處理，還是分段整理。皮鞋淋雨那天擦乾了，水痕常過幾天才浮出來；這時候上油等於把水痕鎖進皮裡，之後就要補色。帆布鞋沾泥，濕的時候越刷越糟：泥會被推進織紋，布面起毛、越刷越舊。等乾了整塊剝掉反而好救，沾到泥先別動。對應服務是鞋包清潔頁。"
      },
      {
        heading: "什麼救得回、什麼只能維持",
        body:
          "還沒上油的雨痕、剛沾上還能整塊剝掉的泥、鞋內還沒悶死的濕氣，通常還有處理空間。已經上油鎖進皮面的水痕、膠邊氧化、麂皮泡水變硬、被高溫吹到變形的膠或皮革，只能淡化或先停手，不保證變全新。不要用高溫直吹或悶進鞋櫃，也不要先硬刷；可以先把乾的表面灰塵輕拍掉再拍照。公開水洗價：一般運動鞋 250、皮鞋 400、麂皮鞋 400；乾洗柔洗另計，以實際報價為主。"
      },
      {
        heading: "雨後要不要送鞋包清潔",
        body:
          "有濕悶味、水痕或泥灰卡在邊角，建議先通風並拍照詢問，避免直接收進櫃內讓味道變重。拍鞋面、水痕、鞋底邊與鞋內，LINE（0968327653）先看方向。台中市全區免費到府收送，清潔費另計、沒有最低消費門檻。白鞋灰與黃另看白鞋泛黃指南；皮鞋與帆布的材質風險不同，不要混成同一種刷法。"
      }
    ],
    faqs: [
      {
        question: "鞋子淋雨後可以用吹風機吹乾嗎？",
        answer: "不建議用高溫直吹。高溫可能讓膠、皮革或合成材質變形，先通風和吸濕比較安全。"
      },
      {
        question: "雨季鞋子有味道要怎麼處理？",
        answer: "要先看鞋內濕氣、鞋墊和內裡材質，味道通常不只是在表面，需要依鞋況判斷。"
      }
    ]
  },
  {
    slug: "bag-handle-cleaning",
    path: "guides/bag-handle-cleaning.html",
    category: "guide",
    title: "包包提把、包角與行李箱輪子怎麼判斷？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）處理包包提把、包角和行李箱輪子：這些位置常累積手汗、水痕、摩擦和地面灰塵，整理前要先看材質與痕跡是否已滲入。",
    h1: "包包提把、包角與行李箱輪子怎麼判斷？",
    summary: AEO_LUGGAGE_WHEELS,
    citation_answer: AEO_LUGGAGE_WHEELS,
    keywords: ["包包清潔", "包包提把清潔", "包角清潔", "台中西屯洗包", "行李箱清潔", "行李箱輪子"],
    service_slug: "shoe-bag-care",
    local_intent: "台中西屯 包包清潔 行李箱輪子",
    content_lastmod: "2026-08-23",
    steps: [
      { name: "看材質", text: "先分辨皮革、尼龍、帆布、麂皮或合成材質。" },
      { name: "看提把", text: "提把容易累積手汗和摩擦，拍近照才能判斷深淺。" },
      { name: "看包角", text: "包角如果已磨損或退色，處理目標會和單純表面髒污不同。" },
      { name: "看內裡", text: "內裡味道、粉塵和水痕也會影響整理方式。" },
      { name: "看行李箱輪子", text: "旅行回來先看輪子、底板與把手，不要帶著地面灰直接推進櫃子。" }
    ],
    sections: [
      {
        heading: "門市怎麼看提把與包角",
        body:
          "包包最先變舊的地方，常是提把。提把發黏不是灰塵，是手汗一天天堆起來的；滲進皮層就只能淡化，還沒變色的現在處理較省。門市會先分辨提把是皮革、合成皮還是布面，再看邊油、縫線和轉角磨耗。精品包最怕的不是髒，是邊角：邊油磨掉就補不回來，只能重新上，能單純清潔的時間比想像中短。內裡粉塵、筆痕和味道也要分開看，外觀乾淨不代表內袋乾淨。對應服務是鞋包清潔頁。"
      },
      {
        heading: "行李箱輪子：收進櫃子前先看這裡",
        body:
          "行李箱回來後，布面、把手和輪邊常常比衣服更早累積灰塵和地面髒污。輪子和底板整趟旅程都在地上磨，那些灰收進櫃子，下次打開就是那個味道。門市會先看行李箱材質、布面髒污深度、輪邊泥灰和把手接觸痕，再判斷適合局部清潔或外觀整理。不用整咖搬來，台中市可約免費到府收送。價目沒有單獨列行李箱固定金額，LINE 傳布面、把手和輪邊照片先估；不另開行李箱薄頁，本段就是這題的接頁。"
      },
      {
        heading: "什麼救得回、什麼只能維持",
        body:
          "表面髒、浮在提把上的手汗、輪邊還沒悶進布面的灰，通常還有清潔空間。邊油磨穿、包角掉色、皮革色差、已經滲入皮層的油痕，清潔只能處理表面髒和部分水痕，磨耗本身要另評估，不保證變全新。公開水洗價：一般包 600、皮包 1000、名牌包 1500 起，發霉特污與補色另計。"
      },
      {
        heading: "送洗前怎麼問鞋包清潔",
        body:
          "包包拍整包、提把近照、四個角與內裡；行李箱拍布面、把手和輪邊。LINE（0968327653）先看材質與範圍。台中市全區免費到府收送，清潔費另計。"
      }
    ],
    faqs: [
      {
        question: "包包提把髒了可以只清提把嗎？",
        answer: "要看材質與髒污範圍。有些狀況可以局部處理，有些則需要搭配整體清潔，避免色差太明顯。"
      },
      {
        question: "包角磨損能洗掉嗎？",
        answer: "磨損不是髒污，清潔只能處理表面髒和部分水痕，磨耗本身需另外評估。"
      },
      {
        question: "行李箱輪子髒了可以送洗嗎？",
        answer: "可以先傳輪子、底板與把手照片詢問。門市會看材質與灰塵深度，再說明適合局部清潔還是外觀整理；沒看過物件前不報固定價。"
      }
    ]
  },
  {
    slug: "bedding-storage-check",
    path: "guides/bedding-storage-check.html",
    category: "guide",
    title: "寢具外套收納前要檢查什麼？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）提醒寢具、外套與厚棉布品收納前，先檢查領口袖口、腋下、棉被邊角、濕氣和悶味，避免收起來後味道變重。",
    h1: "寢具外套收納前要檢查什麼？",
    summary: AEO_BEDDING_STORAGE,
    citation_answer: AEO_BEDDING_STORAGE,
    keywords: ["布品收納", "寢具收納", "外套收納", "換季清潔"],
    service_slug: "fabric-storage",
    local_intent: "台中西屯 布品收納 寢具清潔",
    content_lastmod: "2026-08-23",
    steps: [
      { name: "看高接觸處", text: "外套先看領口、袖口、腋下和口袋邊。" },
      { name: "看厚棉邊角", text: "棉被、毯子和厚布品先看邊角、折線和收納袋內側。" },
      { name: "聞悶味", text: "有悶味代表可能有濕氣或使用痕跡，不建議直接封存。" },
      { name: "再收納", text: "整理後再收進透氣或乾燥的收納方式，降低下一季異味。"}
    ],
    sections: [
      {
        heading: "門市怎麼判斷能不能收",
        body:
          "棉被要收進櫃子前，不能只看表面乾不乾。摸起來乾，中間那層不一定乾；帶著身體味和濕氣直接收納，下一季打開就是那個味道。門市會看厚度、表布材質、縫線和填充狀態，再判斷能不能水洗、需不需要分區處理，以及收納前要不要加強乾燥。外套則先看領口、袖口、腋下和口袋邊，這些位置最容易留下使用痕跡。被套內側、枕套接觸皮膚處與收納袋本身有沒有潮味，也要一起聞。對應服務是布品收納頁。"
      },
      {
        heading: "什麼救得回、什麼只能維持",
        body:
          "還有潮氣、汗味或局部髒污時，不建議直接密封；先確認狀態再收，會比下次拿出來才處理更好。表面灰塵和還沒封死的潮味，通常還有整理空間。久放黃痕、已經悶進填充層的味道、環境異味重新附著，不以單次處理保證長期狀態，也不保證變全新。有味道或局部髒污時不直接壓縮收納。公開水洗價：棉被單人 350、雙人 500、羽絨羊毛被 800；乾洗柔洗另計，以實際報價為主。"
      },
      {
        heading: "收納前怎麼問布品收納",
        body:
          "有汗味、濕氣、局部痕跡或長時間使用，建議先整理再收。拍整件、洗標和有味道的位置，LINE（0968327653）先看方向。台中市全區免費到府收送，清潔費另計、沒有最低消費門檻，體積大的棉被不用自己搬。整理後再收進透氣或乾燥的方式，不要用塑膠袋把潮氣封死。真正要送洗的床組與棉被，另看床組棉被清洗指南。"
      }
    ],
    faqs: [
      {
        question: "寢具收納前一定要洗嗎？",
        answer: "不一定，但如果有汗味、濕氣、局部痕跡或長時間使用，建議先整理再收。"
      },
      {
        question: "外套收起來前要看哪裡？",
        answer: "先看領口、袖口、腋下和口袋邊，這些位置最容易留下使用痕跡。"
      }
    ]
  },
  {
    slug: "shirt-suit-dry-cleaning",
    path: "guides/shirt-suit-dry-cleaning.html",
    category: "guide",
    service_slug: "taichung-xitun-laundry",
    title: "台中西屯襯衫清洗與西裝乾洗｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）提供襯衫、西裝、外套送洗前判斷：先確認材質、領口袖口髒污、內襯與裝飾細節，台中市西屯洗衣與精緻乾洗。",
    h1: "襯衫清洗與西裝乾洗",
    summary:
      "襯衫的領口袖口、西裝的面料、內襯與配件，不適合用同一種方式處理。先傳清楚照片，讓門市依材質與狀況判斷送洗方向。",
    keywords: [
      "台中西屯襯衫清洗",
      "台中西屯西裝乾洗",
      "西屯乾洗店",
      "襯衫領口清洗",
      "西裝送洗",
      "精緻乾洗"
    ],
    local_intent: "台中西屯 襯衫清洗 西裝乾洗 精緻乾洗",
    content_lastmod: "2026-08-23",
    steps: [
      { name: "拍下材質與洗標", text: "先拍外層材質、洗標、領口袖口與明顯髒污的位置。" },
      { name: "標出在意細節", text: "內襯、鈕扣、拉鍊、燙痕或舊污漬，都應在送洗前一起說明。" },
      { name: "門市判斷方式", text: "依材質、污漬時間、結構與配件狀態確認可行處理方向。" },
      { name: "確認處理界線", text: "不以保證去除或保證恢復為前提，實際狀況仍以收件檢查為準。" }
    ],
    faqs: [
      {
        question: "西裝和襯衫可以一起送洗嗎？",
        answer: "可以先一起詢問，但門市會依每件衣物的材質、洗標、內襯與污漬位置分別判斷。"
      },
      {
        question: "襯衫領口泛黃可以直接漂白嗎？",
        answer: "不建議先自行強力漂白或硬刷，先保留目前狀態並傳照片，避免材質與顏色風險增加。"
      }
    ]
  },
  {
    slug: "bedding-duvet-cleaning",
    path: "guides/bedding-duvet-cleaning.html",
    category: "guide",
    service_slug: "fabric-storage",
    title: "台中西屯床組與棉被清洗｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）提供床組、棉被、被套與寢具送洗前判斷：先確認填充物、尺寸、污漬與是否受潮，台中市西屯寢具清洗與收納前檢查。",
    h1: "床組、棉被與寢具清洗",
    summary: AEO_BEDDING_DUVET,
    citation_answer: AEO_BEDDING_DUVET,
    keywords: [
      "台中西屯床組清洗",
      "台中棉被清洗",
      "西屯寢具清洗",
      "被套清洗",
      "床單清洗",
      "換季寢具收納"
    ],
    local_intent: "台中西屯 床組清洗 棉被清洗 寢具送洗",
    content_lastmod: "2026-08-23",
    steps: [
      { name: "拍完整尺寸", text: "先拍床組、棉被或被套的完整外觀、尺寸標示與洗標。" },
      { name: "說明受潮與異味", text: "若有受潮、異味、局部污漬或長期收納狀況，送洗前一併說明。" },
      { name: "確認填充與材質", text: "填充物、表布與車縫狀態會影響可行的處理與收納建議。" },
      { name: "收納前再檢查", text: "處理後仍應確認乾燥與保存環境，不以單次處理保證長期狀態。" }
    ],
    sections: [
      {
        heading: "門市怎麼看棉被與床組",
        body:
          "床組不是只看表面乾不乾淨。填充物、潮氣、異味與收納前狀態都會影響後續判斷。門市會看厚度、表布、車縫與填充分布，再判斷能不能水洗、需不需要分區處理。黃斑多半是汗漬或濕氣長期作用，越早處理越容易淡化。體積大的布品要先確認車線與破口，清洗時破口會擴大。被套內側、枕套接觸皮膚處與收納袋本身有沒有潮味，也要一起說明。對應服務是布品收納頁；羽絨被的蓬度與塗層另看羽絨清洗指南。"
      },
      {
        heading: "什麼救得回、什麼只能維持",
        body:
          "一般建議每年換季收納前清洗一次；有汗味、潮味或黃斑時就不要再等。表面髒與還沒封進填充層的潮味，通常還有清潔空間。沒乾透就壓縮收納，會悶出味道也會失去蓬鬆度；久放黃痕不以單次處理保證回到全新。公開水洗價：棉被單人 350、雙人 500、床組四件套 300、羽絨羊毛被 800；乾洗柔洗另計，以實際報價為主。"
      },
      {
        heading: "體積太大怎麼送到布品收納",
        body:
          "台中市全區可預約免費收送，到府收件即可，不用自己搬。拍整件、洗標、尺寸與有味道或污漬的位置，LINE（0968327653）先確認。收送本身免費、沒有最低消費門檻，清潔費另計。收納前檢查另看寢具外套收納指南，兩頁分開：一頁講洗，一頁講收。"
      }
    ],
    faqs: [
      {
        question: "棉被和床單可以一起送洗嗎？",
        answer: "可以先一起詢問，但填充物、尺寸與材質不同，門市會分別確認處理方式。"
      },
      {
        question: "收納前發現寢具有潮味怎麼辦？",
        answer: "先不要急著密封收進櫃子，拍下整體與局部狀態，讓門市先判斷材質與受潮情況。"
      }
    ]
  },
  {
    slug: "plush-doll-cleaning",
    path: "guides/plush-doll-cleaning.html",
    category: "guide",
    service_slug: "taichung-xitun-laundry",
    title: "台中西屯娃娃與絨毛玩偶清潔｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）提供娃娃、絨毛玩偶與布偶送洗前判斷：先確認填充物、黏貼配件、五官與局部污漬，台中市西屯布偶清潔。",
    h1: "娃娃與絨毛玩偶清潔",
    summary: AEO_PLUSH_DOLL_BOUNDARY,
    citation_answer: AEO_PLUSH_DOLL_BOUNDARY,
    keywords: [
      "台中西屯娃娃清洗",
      "台中布偶清潔",
      "絨毛玩偶清洗",
      "娃娃送洗",
      "玩偶清潔",
      "西屯洗衣店"
    ],
    local_intent: "台中西屯 娃娃清洗 絨毛玩偶清潔",
    content_lastmod: "2026-08-23",
    steps: [
      { name: "拍正反面與配件", text: "正反面、五官、刺繡、吊牌、黏貼物與破損位置都先拍清楚。" },
      { name: "確認填充物狀態", text: "若有硬塊、潮味、掉毛或填充不均，先一併說明。" },
      { name: "避免自行浸泡", text: "黏貼配件與不同材質可能受水或摩擦影響，先不要自行強洗。" },
      { name: "以收件檢查為準", text: "門市會依材質、結構與既有損耗確認處理可行性，不保證完全恢復。" }
    ],
    sections: [
      {
        heading: "門市怎麼判斷娃娃能不能洗",
        body:
          "娃娃不是不能洗，是不能亂洗。怕的不是水，是脫水那一段：填充會結塊，五官會掉，掉了買不回來。門市做法是手洗、低溫烘，五官先固定。還要先確認填充材質、有沒有電子零件或音樂盒要取出，以及縫線、眼鼻配件是否鬆動。絨毛、刺繡、黏貼配件和五官材質都可能不同，不能整顆丟進洗衣機當一般衣物。毛料清洗後需要梳理才會回復蓬鬆，不梳會結塊。對應服務是台中西屯洗衣店頁。"
      },
      {
        heading: "什麼救得回、什麼只能維持",
        body:
          "表面灰、絨毛倒伏、還沒結死的潮味，通常還有清潔空間。填充已經結塊、五官脫落、黏貼配件受水變形、電子零件進水，只能維持或先停手，不保證完全恢復，也不保證變全新。棉花與 PP 棉的耐受度不同，處理前會說明可能的蓬鬆度變化。價目沒有按公分列出固定金額，依大小報價，LINE 傳照片先估。"
      },
      {
        heading: "送洗前怎麼問台中西屯洗衣店",
        body:
          "拍正反面、五官、洗標與最在意的污漬或掉毛位置，並說明異味、受潮與存放情況。LINE（0968327653）先確認材質與處理方向。台中市全區可約免費到府收送，清潔費另計、沒有最低消費門檻。小孩每天抱的娃娃可以洗，而且建議定期清潔；取回前會確認完全乾燥。"
      }
    ],
    faqs: [
      {
        question: "娃娃可以直接丟洗衣機嗎？",
        answer: "不建議在未確認填充物、五官與黏貼配件前直接機洗，先拍照詢問較安全。"
      },
      {
        question: "絨毛玩偶有異味可以送洗嗎？",
        answer: "可以先傳照片並說明異味、受潮與存放情況，門市會先確認材質與處理方向。"
      }
    ]
  },
  {
    slug: "luxury-dry-cleaning",
    path: "guides/luxury-dry-cleaning.html",
    category: "guide",
    service_slug: "taichung-xitun-laundry",
    title: "台中西屯精品名牌與精緻乾洗｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）提供精品名牌服飾、配件與精緻材質送洗前判斷：先確認材質、洗標、五金、飾件與污漬位置，台中市西屯精緻乾洗。",
    h1: "精品名牌與精緻乾洗",
    summary: AEO_LUXURY_DRY,
    citation_answer: AEO_LUXURY_DRY,
    keywords: [
      "台中西屯精品乾洗",
      "台中名牌乾洗",
      "精品服飾清潔",
      "精緻乾洗",
      "名牌衣服送洗",
      "精品清潔"
    ],
    local_intent: "台中西屯 精品乾洗 名牌衣服清潔 精緻乾洗",
    content_lastmod: "2026-08-23",
    steps: [
      { name: "拍洗標與細節", text: "洗標、材質、五金、飾件、內襯與污漬位置都應清楚拍下。" },
      { name: "說明既有痕跡", text: "舊污漬、磨損、褪色、變形或曾自行處理的地方都先告知。" },
      { name: "先做材質判斷", text: "處理方向依材質與結構決定，不用品牌名稱取代實際檢查。" },
      { name: "確認可行界線", text: "不承諾洗白、去除全部污漬或恢復新品狀態，實際以收件檢查為準。" }
    ],
    sections: [
      {
        heading: "門市怎麼看精品與名牌件",
        body:
          "精品或名牌物件不以品牌名稱直接判斷，而是先看材質、結構、飾件與既有使用痕跡。衣服看洗標、內襯與飾件；包包看提把、四個角與邊油。精品包最怕的不是髒，是邊角：邊油磨掉就補不回來，只能重新上。五金氧化與縫線鬆脫要在清潔前確認，清洗過程可能讓既有損傷擴大。真皮、合成皮與麂皮的清潔和補色方式不同。對應服務是台中西屯洗衣店頁；包包提把與包角的部位判斷另看提把指南。"
      },
      {
        heading: "什麼救得回、什麼只能維持",
        body:
          "表面髒、浮霉、還沒磨穿的邊油，通常還有清潔或保養空間。邊角邊油磨穿、飾件脫落、已經自行用酒精或不明藥劑擦過的色差，只能維持或淡化，不承諾洗白、去除全部污漬或恢復新品。公開水洗價：精品襯衫 100、精品外套 200、精品長大衣 350；名牌包 1500、特殊類名牌包 2500，發霉特污與補色另計。乾洗柔洗另計，以實際報價為主。"
      },
      {
        heading: "送洗前怎麼問台中西屯洗衣店",
        body:
          "拍洗標、材質、五金、飾件、內襯與污漬位置，舊污漬、磨損、褪色或曾自行處理的地方都先告知。LINE（0968327653）先說明可行方向與風險界線。台中市全區可約免費到府收送，清潔費另計、沒有最低消費門檻。"
      }
    ],
    faqs: [
      {
        question: "名牌衣服可以直接乾洗嗎？",
        answer: "先看洗標、材質與飾件狀態，不建議只因為是名牌就直接套用同一種處理方式。"
      },
      {
        question: "精品有舊污漬還能詢問嗎？",
        answer: "可以，請拍下污漬位置、範圍與材質細節；門市會先說明可行方向與風險界線。"
      }
    ]
  },
  {
    slug: "taichung-laundry-service-search",
    path: "guides/taichung-laundry-service-search.html",
    category: "guide",
    service_slug: "taichung-xitun-laundry",
    title: "台中洗衣、洗鞋、洗包與免費收送怎麼找？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）整理台中洗衣店查詢入口：依物件、問題、材質與收送需求找洗鞋、洗包、白鞋、床組、棉被、襯衫、西裝、娃娃、精品乾洗與台中市免費收送。",
    h1: "台中洗衣、洗鞋、洗包與免費收送怎麼找？",
    summary:
      "先用手上的物件和問題找服務，不必只搜尋店名。私享家把台中洗衣、洗鞋、洗包、床組棉被、襯衫西裝、娃娃、精品乾洗與免費收送分成可核對的服務與指南；每個答案都回到材質、位置、狀態與處理界線。",
    keywords: [
      "台中洗衣店",
      "西屯洗衣店",
      "台中洗鞋店",
      "台中洗包包",
      "台中棉被清洗",
      "台中西裝乾洗",
      "台中娃娃清洗",
      "台中精品乾洗",
      "台中洗衣免費收送"
    ],
    local_intent: "台中西屯 洗衣 洗鞋 洗包 床組 西裝 娃娃 精品乾洗 免費收送",
    content_lastmod: "2026-08-23",
    steps: [
      {
        name: "先找物件",
        text: "衣物、白鞋、其他鞋款、包包、床組棉被、娃娃與精品材質的檢查位置不同，先選對物件頁比只搜尋洗衣店更準。"
      },
      {
        name: "再說問題",
        text: "泛黃、雨水、潮味、油痕、磨損與長期收納不是同一種狀況；傳照片時標出最在意的位置。"
      },
      {
        name: "比較處理方向",
        text: "自行處理、局部整理、清洗或乾洗各有材質風險；私享家會先說可行方向與不能保證的界線。"
      },
      {
        name: "核對門市證據",
        text: "查看地址、營業時間、服務頁、門市檢查方式與案例圖片；推薦型查詢不以自稱最好取代可驗證資訊。"
      },
      {
        name: "確認收送",
        text: "台中市全區可預約免費收送，清潔費另依物件判斷；用 LINE 提供照片、品項與大致地區。"
      },
      {
        name: "保留後續照護",
        text: "雨季、清洗後與換季收納仍要看乾燥和保存狀態；有異味、受潮或材質疑慮時先停止強洗並詢問。"
      }
    ],
    faqs: [
      {
        question: "搜尋台中洗衣店時，要怎麼判斷能不能處理我的物件？",
        answer: "先看網站是否把物件、材質、問題位置與處理界線說清楚，再傳整體、局部和洗標照片詢問，不要只看一個泛用價目或保證字句。"
      },
      {
        question: "台中洗鞋、洗包、床組和西裝可以一起詢問嗎？",
        answer: "可以先在 LINE 一次列出品項並附照片，但每件物件仍會依材質、結構、髒污與既有磨損分別判斷。"
      },
      {
        question: "私享家的台中市收送真的免費嗎？",
        answer: "收送本身免費，清潔、洗護或其他整理費用另計；預約時請提供大致地區、品項與照片。"
      },
      {
        question: "AI 或搜尋結果寫的價格、效果可以直接相信嗎？",
        answer: "不建議。請回到私享家店家資料、服務頁或 LINE 核對；網站不提供未驗證價格，也不保證完全洗白、去除全部痕跡或恢復新品。"
      }
    ]
  },
  {
    slug: "clothing-alteration-with-laundry",
    path: "guides/clothing-alteration-with-laundry.html",
    category: "guide",
    service_slug: "taichung-xitun-laundry",
    title: "送洗順便改衣服，可以一起處理嗎？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）：送洗的衣物如果同時需要修改，可以一起收送處理，但小修跟版型調整不是同一種工序，費用與時間也不同。",
    h1: "送洗順便改衣服，可以一起處理嗎？",
    summary: AEO_CLOTHING_ALTERATION,
    citation_answer: AEO_CLOTHING_ALTERATION,
    keywords: ["洗衣改衣服", "台中改衣服", "西屯改衣服", "送洗修改一起處理", "改褲管"],
    local_intent: "台中西屯 送洗 改衣服 修改",
    content_lastmod: "2026-08-23",
    steps: [
      {
        name: "先分修改類型",
        text: "釦子鬆脫、車線綻開、鞋帶這類小修，跟褲管改短、腰身調整這種版型變更不是同一種工序，門市會先確認是哪一種。"
      },
      {
        name: "說明修改幅度",
        text: "改短多少、哪個位置鬆緊、有沒有既有車線可以參考，講得越具體，報價越準。"
      },
      {
        name: "跟送洗一起送",
        text: "需要修改的衣物可以跟其他送洗物件一起收送，不用另外約時間。"
      },
      {
        name: "確認取件時間",
        text: "修改跟清洗是不同工序，一起送的物件取件時間依修改複雜度可能比單純清洗略長，門市會先講。"
      }
    ],
    sections: [
      {
        heading: "門市怎麼分小修跟改版型",
        body:
          "私享家的修改服務從 60 元起，但這個價錢對應的是釦子、鬆脫車線、鞋帶更換這類小修——不是版型變更。改褲管長度、調整腰身或袖長這類會動到版型的修改，需要先看衣物材質、剪裁方式跟既有車線，才能報實際費用，不是固定價錢。同一件衣物如果同時要送洗又要修改，門市會先看送洗會不會影響修改的位置（例如已經車過的接縫遇水縮率不同），兩件事會一起評估，不會拆開兩次收送。"
      },
      {
        heading: "什麼可以順手改，什麼建議先問過再送",
        body:
          "簡單的鬆脫車線、釦子、鞋帶這類，通常可以在送洗取件時間內一起處理完，不用另外跑一趟。但涉及版型的改動——例如大幅改短褲管、改變剪裁結構，或材質特殊（皮革、精品、有內裡結構的外套）——門市會先看實物或照片判斷工序複雜度，取件時間可能拉長，費用也會依實際狀況另外報價，不會用小修的價錢處理版型異動。"
      },
      {
        heading: "送洗前怎麼一起問修改",
        body:
          "傳照片時，除了物件整體、局部污漬，再拍一張需要修改的位置（鬆脫車線、釦子掉落處，或要改短的褲管長度），用 LINE（0968327653）一次說清楚。台中市全區可約免費到府收送，清潔費與修改費分開計算，修改費依實際款式報價，沒有最低消費門檻。"
      }
    ],
    faqs: [
      {
        question: "送洗的時候可以順便改衣服嗎？",
        answer: "可以，兩件事會一起收送。但修改費另計，小修從 60 元起，版型變更依款式另外報價。"
      },
      {
        question: "改衣服要多久？",
        answer: "簡單的鬆脫車線、釦子、鞋帶通常跟著送洗一起完成；版型變更或材質特殊的修改，時間會依複雜度另外抓，門市會先講清楚。"
      }
    ]
  },
  {
    slug: "luggage-wheel-cleaning",
    path: "guides/luggage-wheel-cleaning.html",
    category: "guide",
    title: "行李箱輪子、底板怎麼清？｜台中洗行李箱 私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）判斷行李箱輪子、底板與布面：旅行回來先看輪邊泥灰，不要帶著地面髒污直接推進櫃子。台中市可免費收送。",
    h1: "行李箱輪子與底板：收進櫃子前先看這裡",
    summary: AEO_LUGGAGE_WHEELS,
    citation_answer: AEO_LUGGAGE_WHEELS,
    keywords: ["台中洗行李箱", "行李箱清潔", "行李箱輪子", "洗行李箱", "行李袋清洗"],
    service_slug: "shoe-bag-care",
    local_intent: "台中西屯 行李箱清潔 輪子 底板",
    content_lastmod: "2026-08-29",
    steps: [
      { name: "拍輪子與底板", text: "輪邊、輪軸縫與底板近照各一張，才看得出是浮灰、泥塊還是已經悶進布面。" },
      { name: "拍布面與把手", text: "箱體布面、伸縮把手與側把分開拍；外觀乾淨不代表輪子乾淨。" },
      { name: "先通風再收", text: "剛回來先打開、直立通風，不要立刻套防塵套或推進密閉櫃子。" },
      { name: "說明旅程", text: "告訴門市是雨天拖行、機場石材地、還是放很久沒開；時間線會改變味道來源的判斷。" }
    ],
    sections: [
      {
        heading: "門市怎麼看行李箱",
        body:
          "行李箱回來後，布面、把手和輪邊常常比衣服更早累積灰塵和地面髒污。輪子和底板整趟旅程都在地上磨，那些灰收進櫃子，下次打開就是那個味道。門市會先看箱體材質（硬殼、布面、混合）、布面髒污深度、輪邊泥灰、輪軸縫卡灰，以及把手接觸痕，再判斷適合局部清潔或外觀整理。提把油痕與包角邊油是另一種問題，寫在包包提把指南，不要和輪子泥灰混成同一種刷法。不用整咖搬來門市，台中市可約免費到府收送。"
      },
      {
        heading: "什麼救得回、什麼只能維持",
        body:
          "輪邊還沒悶進布面的浮灰、底板乾泥、剛沾上的雨水痕，通常還有清潔空間。硬殼刮傷、輪子變形、布面已經滲色或發霉到內襯，清潔只能處理表面髒和部分味道，不保證變全新。價目沒有單獨列行李箱固定金額，LINE 傳布面、把手、輪邊與底板照片先估；發霉、特殊污漬與特殊材質另行說明。不要先用漂白或硬刷輪布，容易起毛或留下色差。"
      },
      {
        heading: "收進櫃子前先做這步",
        body:
          "旅行箱最常見的失誤是回家直接推進櫃子。輪子還濕、底板還有泥，密封之後味道會回到衣服層。先把可拆的套件拿下來通風，箱體直立打開，確認中間層摸起來也乾，再收。若已經有悶味，先拍照問，不要噴香水掩蓋。對應服務是鞋包清潔；台中市全區免費收送，清潔費另計、沒有最低消費門檻。"
      },
      {
        heading: "送洗前怎麼問",
        body:
          "拍布面整體、伸縮把手、兩側輪子特寫與底板。用 LINE（0968327653）補一句：剛旅行回來、放很久沒開，或雨天拖過。門市先回適不適合整理，再約收件。"
      }
    ],
    faqs: [
      {
        question: "台中洗行李箱要多少錢？",
        answer: "沒有單獨列固定金額。尺寸、材質、輪子髒污深度與是否發霉差很多，先傳照片估；收送本身免費。"
      },
      {
        question: "只清輪子、不清箱面可以嗎？",
        answer: "可以先問局部整理。門市會看輪布與箱面是否同色系，避免只清一處造成色差。"
      },
      {
        question: "行李箱有味道是不是發霉？",
        answer: "不一定。輪子泥灰、底板濕氣和內襯久放都可能悶出味道。先拍內襯與輪邊，不要先噴香或密封。"
      },
      {
        question: "硬殼刮傷洗得掉嗎？",
        answer: "刮傷不是髒污。清潔處理的是灰塵與部分水痕，殼面刮傷只能維持，不保證消失。"
      }
    ]
  },
  {
    slug: "curtain-cleaning",
    path: "guides/curtain-cleaning.html",
    category: "guide",
    title: "台中洗窗簾怎麼判斷？｜窗簾送洗前先看布料 私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）處理窗簾清洗：先看布料、內襯、軌道與尺寸，再決定能不能水洗。台中市可免費收送，費用依尺寸報價。",
    h1: "台中洗窗簾：先看布料與軌道，再決定怎麼送",
    summary: AEO_CURTAIN,
    citation_answer: AEO_CURTAIN,
    keywords: ["台中洗窗簾", "窗簾清洗", "西屯洗窗簾", "窗簾送洗", "落地窗簾清洗"],
    service_slug: "fabric-storage",
    local_intent: "台中西屯 窗簾清洗 落地窗 軌道",
    content_lastmod: "2026-08-29",
    steps: [
      { name: "拍整幅與布邊", text: "拉開後的整幅、布邊內襯與最靠近窗台的下擺，尺寸差會直接影響報價。" },
      { name: "拍軌道與配件", text: "軌道、鉤子、綁帶是否可拆，拆不下來的配件要先講，避免強拆。" },
      { name: "看陽光面", text: "長期日曬那一面常先變脆或褪色，這不是髒，清潔前要先說清楚。" },
      { name: "說明安裝位置", text: "落地窗、浴室、廚房油煙區的髒法不同；傳 LINE 時寫房間用途。" }
    ],
    sections: [
      {
        heading: "門市怎麼看窗簾",
        body:
          "窗簾不是拿去跟衣服同一槽洗。門市先分布料（棉、麻、遮光塗層、絨、紗）、有沒有內襯、下擺是否加重，再看軌道配件能不能安全拆。陽光直射面發脆、塗層龜裂，看起來像髒，其實是材質老化，硬刷或高溫會讓裂痕更明顯。廚房窗簾常見油膜，浴室附近常見潮味；這兩種都不能先當普通灰處理。價目表寫窗簾依尺寸報價，所以照片裡的高度與摺數比先問一個固定數字準。對應服務是布品收納頁。"
      },
      {
        heading: "什麼可以洗、什麼先停手",
        body:
          "一般布簾的浮塵、下擺灰塵、還沒封進塗層的潮味，通常還有處理空間。遮光塗層剝落、日曬脆化、繡片或珠飾鬆動，清潔只能維持，不保證回復垂墜與色澤。自己先丟洗衣機最常見的後果是縮水、軌道鉤變形、塗層黏在一起。不確定就保持吊掛或平放，先拍照。台中市全區可約免費到府收送，落地窗簾不用自己塞進後車箱；清潔費另計，沒有最低消費門檻。"
      },
      {
        heading: "換季或中秋前為什麼有人問窗簾",
        body:
          "開窗變少、冷氣長開的房間，窗簾內側會積一層灰；秋天收納薄紗、換上厚簾時，舊簾若帶潮就封進櫃子，下一季打開就是味道。這和棉被收納是同一條邏輯：摸起來乾、中間層不一定乾。窗簾先看、棉被另看寢具指南，不要混成一件事。"
      },
      {
        heading: "LINE 怎麼問才估得準",
        body:
          "拍整幅拉開、下擺近照、軌道特寫，並寫幾幅、大概高度。用 LINE（0968327653）傳。門市先回適不適合拆洗，再約收件。不要先自行噴漂白或陽光曝曬想「消毒」，日曬面已經偏脆的布更容易裂。"
      }
    ],
    faqs: [
      {
        question: "台中洗窗簾多少錢？",
        answer: "依尺寸報價，沒有單一固定價。先傳整幅與下擺照片，門市再說明範圍；收送本身免費。"
      },
      {
        question: "落地窗簾可以到府收嗎？",
        answer: "可以。台中市全區免費收送，落地窗簾建議先約，不要自己硬折進袋裡壓出折痕。"
      },
      {
        question: "遮光窗簾可以水洗嗎？",
        answer: "要先看塗層。塗層完好才評估水洗；已經龜裂或剝落的，門市會先講只能維持的界線。"
      },
      {
        question: "窗簾和地毯可以一起送嗎？",
        answer: "可以一次收。但布料、潮濕來源與尺寸算法不同，會分開判斷，不會用同一組數字。"
      }
    ]
  },
  {
    slug: "carpet-cleaning",
    path: "guides/carpet-cleaning.html",
    category: "guide",
    title: "台中洗地毯怎麼判斷？｜地毯潮味與材質 私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）處理地毯清洗：先看材質、潮濕、邊條與尺寸，沒乾就捲起來下次打開就是味道。台中市可免費收送，費用依尺寸報價。",
    h1: "台中洗地毯：先看材質與潮濕，再決定要不要捲",
    summary: AEO_CARPET,
    citation_answer: AEO_CARPET,
    keywords: ["台中洗地毯", "地毯清洗", "西屯洗地毯", "地毯潮味", "地墊送洗"],
    service_slug: "fabric-storage",
    local_intent: "台中西屯 地毯清洗 潮味 地墊",
    content_lastmod: "2026-08-29",
    steps: [
      { name: "拍整張與角落", text: "整張鋪開、四個角與最常踩的走道，才看得出是表面灰還是底層受潮。" },
      { name: "摸中間層", text: "表面乾、底層不一定乾。若中間有潮或酸味，先不要捲緊收納。" },
      { name: "看邊條與背面", text: "橡膠底、防滑點、縫邊脫線會影響能不能水洗，要拍背面。" },
      { name: "說明來源", text: "寵物、飲料、雨天鞋子，或只是久沒吸塵，處理方向不同。" }
    ],
    sections: [
      {
        heading: "門市怎麼看地毯",
        body:
          "地毯跟窗簾一樣依尺寸報價，但判斷點完全不同。門市先看纖維（羊毛、尼龍、混紡、短毛地墊）、背面是布底還是橡膠底，再聞潮味是在表面還是已經進到中間層。走道壓平的位置看起來像髒，有時是纖維倒伏，不是色素；硬刷只會讓倒伏更明顯。飲料漬、寵物尿味與普通灰塵不能用同一種方式。對應服務是布品收納；窗簾另有專頁，不要把兩種尺寸算法混在一句話裡問。"
      },
      {
        heading: "什麼可以洗、什麼先停手",
        body:
          "浮塵、乾泥、還沒滲到底層的飲料邊，通常還有處理空間。橡膠底龜裂、羊毛氈化、霉斑已經穿過背面，清潔只能改善表面與部分味道，不保證回彈或全無味。自己先用蒸氣機或漂白，最常見的是底膠溶掉、顏色不均。不確定就平放通風，先拍照。台中市可約免費到府收送，大張地毯不用自己塞車；清潔費另計。"
      },
      {
        heading: "沒乾就捲起來會怎樣",
        body:
          "地毯最容易在換季或搬家時被捲起來塞進倉庫。摸起來乾、中間層不一定乾，帶濕氣封存會悶出味道，下一季打開連旁邊的被子都會沾到。這和棉被收納是同一條界線。若已經有味道，先拍角落與背面，不要噴芳香劑再捲。"
      },
      {
        heading: "LINE 怎麼問",
        body:
          "拍整張、四角、背面與最在意的漬。寫大概長寬。用 LINE（0968327653）傳。門市先回適不適合收，再約時間。沒看過物件前不報固定價。"
      }
    ],
    faqs: [
      {
        question: "台中洗地毯多少錢？",
        answer: "依尺寸報價。先傳整張與背面照片，門市再說明範圍；收送本身免費，清潔另計。"
      },
      {
        question: "地毯有寵物味洗得掉嗎？",
        answer: "多數可明顯改善。味道若已進中間層或背面，要先看材質，不保證完全無味，也不用香味覆蓋。"
      },
      {
        question: "小塊地墊和大張地毯一樣算嗎？",
        answer: "都是依尺寸與材質看，不是同一組數字。小塊也可以先問，沒有最低消費門檻。"
      },
      {
        question: "可以只洗走道那一塊嗎？",
        answer: "可以先問局部。門市會看顏色是否連成一片，避免只處理一區出現色差。"
      }
    ]
  },
  {
    slug: "fengjia-laundry-pickup",
    path: "local/fengjia-laundry-pickup.html",
    category: "local",
    title: "逢甲洗衣收送｜宿舍與租屋怎麼約｜私享家洗衣店",
    description:
      "逢甲夜市、福星路與文華路生活圈要洗衣？私享家門市在西屯青海路二段365號，宿舍與租屋可先 LINE 傳照片，再約台中市免費到府收送。洗鞋另看逢甲洗鞋頁。",
    h1: "逢甲洗衣收送：宿舍與租屋怎麼約",
    summary: AEO_FENGJIA_LAUNDRY,
    citation_answer: AEO_FENGJIA_LAUNDRY,
    keywords: ["逢甲洗衣", "逢甲洗衣店", "逢甲洗衣收送", "逢甲宿舍洗衣", "文華路洗衣"],
    service_slug: "taichung-xitun-laundry",
    local_intent: "逢甲 洗衣收送 宿舍 租屋",
    content_lastmod: "2026-08-29",
    steps: [
      { name: "先分洗衣還是洗鞋", text: "衣服、床包、薄外套走本頁；球鞋、白鞋走逢甲洗鞋頁，不要混成一袋再問價錢。" },
      { name: "拍品項與最在意位置", text: "每件拍整體加局部。宿舍常見的是領口、袖口、床包邊與汗味，不是只問幾件多少。" },
      { name: "寫收件地點類型", text: "宿舍櫃台、套房或巷內租屋，門市只需要知道怎麼交接，不必先報沒核對過的車程。" },
      { name: "對營業時間", text: "門市週一至週五 10:00-20:00、週六 12:00-18:00、週日公休；夜市收攤後不一定還收得進當日件。" }
    ],
    sections: [
      {
        heading: "逢甲生活圈怎麼接到青海路門市",
        body:
          "逢甲夜市、文華路、福星路與附近租屋都在西屯區，和門市同一行政區。門市地址是 407 臺中市西屯區至善里青海路二段365號，地標至善國中對面。本頁不寫沒有來源的公里數或分鐘數。想自己到店，對上面營業時間；不想跑，用 LINE（0968327653）傳照片後約台中市免費到府收送。免費收送範圍是台中市全市，不是只有逢甲巷口。"
      },
      {
        heading: "宿舍與租屋常見的是哪些件",
        body:
          "逢甲學生與租屋族送來的，通常是薄外套、襯衫、床包、毛巾，以及週末才想起的一袋混洗。門市會先把淺色深色、外套與床包分開看，不把整袋當同一種洗法。床包若有潮味，先對照寢具指南，不要和一件 T 恤報成同一組期待。洗鞋、白鞋泛黃請走逢甲洗鞋專頁；本頁只處理衣物與布品收送。"
      },
      {
        heading: "收送邊界與費用界線",
        body:
          "台中市全市收送本身免費，沒有最低消費門檻，一袋宿舍衣服也可以先問。收送免費不代表清潔免費；公開水洗價在價目表，乾洗柔洗與發霉另計，以實際檢視為準。處理天數不在本頁承諾。夜市週邊停車不便時，用收送通常比自己載更單純。"
      },
      {
        heading: "LINE 怎麼一次講清楚",
        body:
          "列出大概件數、有沒有床包或外套，並附最髒那幾件的照片。寫「逢甲宿舍」或「逢甲附近租屋」即可。門市先回適不適合收、可約時段，再上門。洗鞋請另傳鞋面鞋邊鞋內，不要塞在同一則只寫「都洗」。"
      }
    ],
    faqs: [
      {
        question: "逢甲宿舍可以約收送嗎？",
        answer: "可以。台中市全市免費收送，宿舍櫃台或租屋交接都可以先在 LINE 講清楚。"
      },
      {
        question: "逢甲洗衣和逢甲洗鞋是同一頁嗎？",
        answer: "不是。本頁是衣物與床包收送；球鞋、白鞋看逢甲洗鞋頁，判斷方式不同。"
      },
      {
        question: "晚上夜市收攤後還收得到嗎？",
        answer: "以門市營業時間為準：平日最晚 20:00、週六 18:00、週日公休。當日能不能收，LINE 問當下時段。"
      },
      {
        question: "只有幾件薄衣服也收嗎？",
        answer: "可以先問。沒有最低消費門檻；清潔仍依物件計算，收送本身不另外收費。"
      }
    ]
  },
  {
    slug: "zhongke-office-laundry",
    path: "local/zhongke-office-laundry.html",
    category: "local",
    title: "中科園區洗衣收送｜襯衫與公司件怎麼約｜私享家洗衣店",
    description:
      "台中中科園區、西屯工業區上班要送襯衫或公司衣物？私享家在青海路二段365號，可先 LINE 列件數與材質，再約台中市免費收送。清潔另計。",
    h1: "中科園區洗衣：襯衫與公司件怎麼約收送",
    summary: AEO_ZHONGKE_LAUNDRY,
    citation_answer: AEO_ZHONGKE_LAUNDRY,
    keywords: ["中科洗衣", "中科園區洗衣", "台中公司洗衣", "西屯襯衫送洗", "工業區洗衣收送"],
    service_slug: "business-bulk-laundry",
    local_intent: "中科園區 襯衫 公司衣物 收送",
    content_lastmod: "2026-08-29",
    steps: [
      { name: "先列件數與類型", text: "襯衫、褲、外套、制服分開寫件數；整袋混裝只能回「要看物件」。" },
      { name: "拍領口袖口", text: "辦公室最常見的是領口油光與袖口，這和油性髒有關，不是只看表面皺不皺。" },
      { name: "標特殊件", text: "西裝、大衣、會徽繡字或名牌材質要單獨拍，不能跟普通襯衫同一組期待。" },
      { name: "約定交接", text: "公司櫃台或住家都可以約。門市營業平日 10:00-20:00，週六 12:00-18:00，週日公休。" }
    ],
    sections: [
      {
        heading: "中科與西屯工業區怎麼接到門市",
        body:
          "中科園區與周邊工業區都在台中市西屯生活圈，門市在青海路二段365號、至善國中對面。本頁不寫沒有來源的車程。上班族最常問的是：中午或下班後能不能收。以營業時間為準，當日件請用 LINE 問當下時段，不要假設固定每天同一鐘點上門。台中市全市可免費收送，清潔另計。"
      },
      {
        heading: "公司件跟家庭件差在哪",
        body:
          "公司件通常件數多、款式重複，領口袖口油光比家庭件更集中。門市會先看洗標：有墊肩或襯裡的外套不能跟薄襯衫同一槽想像。大量送洗另有店家與公司專頁，本頁補的是中科生活圈怎麼約、要拍什麼。不要在沒有照片的情況下要一個「公司價」；公開價目在價目表，特殊繡字、徽章與西裝另計。"
      },
      {
        heading: "襯衫領口黃了怎麼辦",
        body:
          "長期皮脂氧化的領口，多數能明顯改善，不保證回到新衣。自己先用漂白或硬刷，黃斑有時會定死。先拍領口內側與袖口，再決定水洗、整燙或乾洗。西裝肩線另看西裝指南。處理天數依件數與材質回覆，本頁不承諾隔夜全部完成。"
      },
      {
        heading: "LINE 怎麼讓報價快",
        body:
          "用表格或條列：襯衫幾件、褲幾件、有無西裝。附領口照片。寫「中科」或公司所在行政區即可。LINE（0968327653）。門市先回適不適合一次收、可約時段。"
      }
    ],
    faqs: [
      {
        question: "中科公司衣服可以到府收嗎？",
        answer: "可以。台中市全市免費收送，公司櫃台或住家交接都可以先約。"
      },
      {
        question: "襯衫送洗大概多少錢？",
        answer: "公開水洗價襯衫 70、整燙 50；乾洗柔洗另計，以實際檢視為準。"
      },
      {
        question: "可以固定每週收一次嗎？",
        answer: "可以先在 LINE 問週期。本頁不先寫死每週幾點；以當下可收時段為準。"
      },
      {
        question: "西裝和襯衫可以同一袋嗎？",
        answer: "收送可以一起。判斷與工序仍分開，西裝肩線與領片要另看，不要當薄襯衫洗。"
      }
    ]
  },
  {
    slug: "donghai-laundry-pickup",
    path: "local/donghai-laundry-pickup.html",
    category: "local",
    title: "東海洗衣收送｜別墅區厚被與日常衣物｜私享家洗衣店",
    description:
      "東海大學、東海商圈與別墅區要洗衣？私享家在西屯青海路二段365號，厚被、窗簾與日常衣物可先 LINE 傳照片，再約台中市免費收送。",
    h1: "東海洗衣收送：厚被、窗簾與日常衣物怎麼約",
    summary: AEO_DONGHAI_LAUNDRY,
    citation_answer: AEO_DONGHAI_LAUNDRY,
    keywords: ["東海洗衣", "東海洗衣店", "東海大學洗衣", "台中東海收送", "別墅區洗衣"],
    service_slug: "taichung-xitun-laundry",
    local_intent: "東海 洗衣收送 厚被 窗簾",
    content_lastmod: "2026-08-29",
    steps: [
      { name: "先分物件", text: "日常衣物、厚被床組、窗簾、地毯分開列。東海別墅區常見後三項，和逢甲宿舍薄衣不是同一袋。" },
      { name: "厚被先聞潮味", text: "換季收納前摸起來乾、中間層不一定乾。有潮味先拍邊角，不要先壓縮袋。" },
      { name: "窗簾拍整幅", text: "落地簾寫大概高度。窗簾依尺寸報價，照片比先問固定價準。" },
      { name: "約定收件", text: "社區管理室或住家門口都可以先講。門市平日 10:00-20:00、週六 12:00-18:00、週日公休。" }
    ],
    sections: [
      {
        heading: "東海生活圈與門市的關係",
        body:
          "東海大學、東海商圈與周邊別墅住宅都在台中市，收送範圍覆蓋全市。門市在西屯區青海路二段365號、至善國中對面。本頁不寫沒有來源的距離。東海這一側比較常出現的是家庭厚件：冬被、窗簾、地毯，而不是逢甲夜市生活圈那種薄外套加球鞋。洗鞋若需要，另看逢甲洗鞋頁；本頁專注衣物與大型布品怎麼約。"
      },
      {
        heading: "別墅區厚件為什麼要先拍照",
        body:
          "羽絨被、羊毛被與窗簾的體積大，自己載車不一定放得下，這正是免費收送的用途。門市要先看填充、潮氣、車線與窗簾塗層，才能說適不適合收。公開水洗價：棉被單人 350、雙人 500、羽絨羊毛被 800；窗簾與地毯依尺寸。乾洗柔洗與發霉另計。沒看過照片不承諾「一定當天取」。"
      },
      {
        heading: "學生件與家庭件可以同一趟嗎？",
        body:
          "可以同一趟收。東海也有學生租屋，薄衣與家庭厚被仍會分開判斷。床組潮味走寢具指南，窗簾走窗簾指南，不要在一則訊息裡只寫「東海全部洗」卻不附照片。"
      },
      {
        heading: "LINE 怎麼約",
        body:
          "列衣物、被、簾各幾件，附最重的那幾張照片。寫「東海」或社區名稱即可。LINE（0968327653）。收送免費、清潔另計、沒有最低消費門檻。"
      }
    ],
    faqs: [
      {
        question: "東海別墅區可以約收棉被嗎？",
        answer: "可以。台中市全市免費收送；先傳邊角與潮味位置，再約上門。"
      },
      {
        question: "東海洗窗簾也收嗎？",
        answer: "收。窗簾依尺寸報價，先傳整幅與下擺；詳細判斷看窗簾指南。"
      },
      {
        question: "東海大學生的衣服也收嗎？",
        answer: "收。和家庭厚件可以同一趟，但仍依材質分開看。"
      },
      {
        question: "要自己送到青海路嗎？",
        answer: "不必。方便到店再來至善國中對面；多數厚件用 LINE 約收送即可。"
      }
    ]
  },
  {
    slug: "qinghai-road-shoe-cleaning",
    path: "local/qinghai-road-shoe-cleaning.html",
    category: "local",
    service_slug: "shoe-bag-care",
    title: "逢甲洗鞋・西屯洗鞋推薦怎麼挑｜青海路私享家洗衣店",
    description: "逢甲、西屯找洗鞋店？先看這篇怎麼挑：看案例照片、問處理界線、確認收送方式。私享家在青海路二段365號，台中市免費收送，LINE 傳照片先判斷再決定。",
    h1: "逢甲洗鞋・西屯洗鞋：怎麼挑、怎麼問、怎麼送",
    summary:
      "逢甲、西屯找洗鞋，最常見的是白鞋泛黃、雨天泥灰和鞋內悶味。私享家門市在西屯區青海路二段365號、至善國中對面；台中市全市可預約免費到府收送。挑洗鞋店先比三件事：敢不敢先講哪些救不回來、收送範圍清不清楚、有沒有講處理界線。",
    keywords: ["逢甲洗鞋", "逢甲洗鞋推薦", "西屯洗鞋", "台中西屯洗鞋", "青海路洗鞋", "逢甲洗包包", "西屯洗包"],
    local_intent: "逢甲洗鞋 逢甲洗鞋推薦 西屯洗鞋 青海路洗鞋 逢甲大學 洗鞋收送",
    content_lastmod: "2026-08-18",
    steps: [
      {
        name: "第一步：拍四張照片",
        text: "鞋面、鞋邊、鞋底、鞋內各一張。白鞋泛黃、雨天泥灰、鞋內悶味，照片裡都看得出來，不用先跑一趟門市。"
      },
      {
        name: "第二步：LINE 先問可不可以救",
        text: "傳照片後門市會先講判斷：能處理到什麼程度、哪些痕跡可能留下來。先聽界線再決定送不送。"
      },
      {
        name: "第三步：選到店或收送",
        text: "門市在青海路二段365號、至善國中對面，與逢甲、西屯同在西屯區。不想跑的話，台中市全市可約免費到府收送。"
      },
      {
        name: "第四步：對照處理界線",
        text: "先分救得回與只能維持現狀：布面洗劑黃、乾燥帆布泥多半能改善；膠邊氧化、麂皮泡水變硬、已上油的雨痕，只能淡化或先停手。"
      },
      {
        name: "怎麼比較各家洗鞋店",
        text: "一看有沒有標示地址與營業時間的實體門市；二看是否先講風險與不保證事項；三看收送範圍是不是寫清楚。價格最低不等於划算。"
      }
    ],
    sections: [
      {
        heading: "從逢甲過來",
        body:
          "從逢甲過來找洗鞋，門市在西屯區至善里青海路二段365號，地標是至善國中對面。完整地址是 407 臺中市西屯區至善里青海路二段365號。逢甲生活圈與門市同在西屯區；本頁只用路名、門牌與地標說明方位，不寫沒有來源的公里數或車程分鐘。想自己到店，營業時間是週一至週五 10:00-20:00、週六 12:00-18:00、週日公休。不想跑門市，先用 LINE（0968327653）傳鞋面、鞋邊、鞋底與鞋內照片，再約台中市免費到府收送。免費收送範圍見下一段，不要把「門市在青海路」理解成「只有青海路附近才收」。"
      },
      {
        heading: "收送邊界：哪些區免費收送",
        body:
          "商家資料確認的門市行政區是臺中市西屯區。免費收送範圍依既有全市收送頁與在地資料：台中市全市，收送本身免費，且沒有最低消費門檻。一雙球鞋也可以先問。商家資料沒有再列出北屯、南屯或其他行政區的個別名單，本頁也不編造區界。台中市以外不在本頁確認範圍。收送免費不代表清潔免費；清潔與洗護費用另依物件判斷。預約以 LINE 為主：傳整體與局部照片，並說明所在區域與品項，門市先回覆適不適合整理與可收時段，再約定到府收件。不一定要到西屯門市；方便到店再來青海路二段365號、至善國中對面。處理天數、固定取件時段與效果保證，要看實際物件與當下回覆，本頁不先行承諾。"
      },
      {
        heading: "洗鞋案例界線：哪些救得回，哪些只能維持",
        body:
          "對齊鞋包清潔頁的界線：洗鞋不保證變全新。白鞋泛黃，不是刷得不夠用力。黃在布面、來自洗劑殘留，多半洗得回來；黃在鞋邊膠條，是膠氧化，刷不掉，只能淡化。先看是哪一種，再決定要不要送。逢甲學生常問的球鞋、運動鞋，公開水洗價 250 起。皮鞋淋雨，當天擦乾也不代表沒事；水痕常過幾天才浮出來，這時候上油等於把水痕鎖進皮裡，之後就要補色。還沒上油的現在處理較穩。皮鞋水洗價 400 起。帆布鞋沾泥，濕的時候越刷越糟：泥會被推進織紋，布面起毛、越刷越舊。等乾了整塊剝掉反而好救，沾到泥先別動。帆布鞋水洗價 250 起。麂皮鞋摸起來變硬，常是絨毛倒了發亮，那不是髒；用濕布擦只會把它壓得更平，洗完得把整片絨面重新刷順才回得來。整雙泡水也會讓麂皮變硬。麂皮鞋 400 起，不確定材質先拍照。雨後不要用高溫直吹或悶進鞋櫃，能拆的鞋墊先取出通風；白鞋不確定材質時，不要先用漂白水或硬刷，避免起毛或膠邊痕跡更明顯。灰塵、泥痕、部分水痕與味道通常有機會改善；膠邊氧化、破皮、掉色、長期磨耗，清潔前會先說清楚，不承諾回到全新。"
      }
    ],
    faqs: [
      {
        question: "逢甲宿舍的球鞋可以洗嗎？",
        answer:
          "可以。運動鞋水洗價250起，先傳照片。\n公開水洗價還包括皮類運動鞋 300、混合運動鞋 350。乾洗柔洗另計，以實際報價為主。台中市全市可免費收送，宿舍與租屋處都能約。"
      },
      {
        question: "白鞋泛黃救得回來嗎？",
        answer:
          "布面洗劑殘留多半能改善，膠邊氧化只能淡化。\n先看黃在布面還是鞋邊，不要先硬刷或漂白。門市會先講能處理到什麼程度，不保證完全洗白，也不保證變全新。"
      },
      {
        question: "麂皮或帆布鞋可以自己先刷嗎？",
        answer:
          "先別動。濕刷帆布會起毛，麂皮泡水會變硬。\n帆布泥乾了再處理較穩；麂皮用乾刷順毛，染色或深漬另評估。先拍鞋面、鞋邊、鞋底、鞋內傳 LINE。"
      },
      {
        question: "洗一雙鞋要多久？",
        answer:
          "沒有固定完成天數，要看物件後回覆。\n本頁不承諾當天或隔日完成。請用 LINE 傳照片，門市依材質與狀態說明可收時段與後續安排。"
      },
      {
        question: "逢甲附近洗鞋大概多少錢？",
        answer:
          "運動鞋250起、麂皮鞋400起，以實際報價為主。\n公開水洗價還包括皮類運動鞋 300、休閒鞋 350、皮鞋 400、高跟鞋 400、名牌鞋 600、童鞋 150。乾洗柔洗另計，發霉特污另計；LINE 傳照片可先確認。"
      }
    ]
  }
];

function servicePagesAsDiagnostic() {
  return SERVICE_PAGE_DEFINITIONS.map((service) => ({
    slug: service.slug,
    path: `services/${service.slug}.html`,
    title: service.title,
    h1: service.h1,
    description: service.description,
    summary: service.summary,
    keywords: service.keywords,
    local_intent: service.keywords.join(" "),
    citation_answer: service.answer_summary,
    steps: [] as Array<{ name: string; text: string }>,
    sections: service.sections,
    faqs: service.faqs
  }));
}

const INDEX_GROWTH_ACCEPTED_PROJECTION = resolveAcceptedIndexGrowthPages(INDEX_GROWTH_CATALOG, {
  existingPages: [...LEGACY_SUPPORT_PAGE_DEFINITIONS, ...servicePagesAsDiagnostic()],
  knownServiceSlugs: KNOWN_SERVICE_SLUGS,
  today: getZonedDateParts(new Date(), "Asia/Taipei").date
});

const INDEX_GROWTH_SLUGS = new Set(INDEX_GROWTH_ACCEPTED_PROJECTION.map((page) => page.slug));

const SUPPORT_PAGE_DEFINITIONS: SupportPageDefinition[] = [
  ...LEGACY_SUPPORT_PAGE_DEFINITIONS,
  ...INDEX_GROWTH_ACCEPTED_PROJECTION
];

if (SERVICE_PAGE_DEFINITIONS.map((service) => service.slug).join("\0") !== KNOWN_SERVICE_SLUGS.join("\0")) {
  throw new Error("SERVICE_PAGE_DEFINITIONS slugs drifted from KNOWN_SERVICE_SLUGS");
}

export function publicSupportPages(): SupportPageDefinition[] {
  return SUPPORT_PAGE_DEFINITIONS;
}

export function publicSourceBaselineUrlCount(): number {
  return 1 + SERVICE_PAGE_DEFINITIONS.length + LEGACY_SUPPORT_PAGE_DEFINITIONS.length;
}

export function publicAcceptedIndexGrowthCount(): number {
  return INDEX_GROWTH_ACCEPTED_PROJECTION.length;
}

const HOME_DISCOVERY_GROUPS: HomeDiscoveryGroup[] = [
  {
    heading: "依物件找服務",
    intro: "參考電商品類導覽的做法，把客人手上的物件先分清楚，讓搜尋與 AI 都能理解私享家處理的是哪一類洗護問題。",
    items: [
      {
        label: "白鞋、球鞋、通勤鞋",
        description: "適合鞋邊泛灰、鞋內濕悶、雨後鞋底泥灰與鞋面材質檢查。",
        serviceSlug: "white-shoe-cleaning"
      },
      {
        label: "包包、提把、包角",
        description: "適合雨季水痕、提把油痕、包角摩擦與材質清潔判斷。",
        serviceSlug: "shoe-bag-care"
      },
      {
        label: "外套、寢具、厚棉布品",
        description: "適合換季前確認汗味、潮氣、黃斑與收納前是否需要整理。",
        serviceSlug: "fabric-storage"
      },
      {
        label: "窗簾、地毯",
        description: "先看布料、尺寸與潮濕，再決定能不能拆洗或收送。",
        supportSlug: "curtain-cleaning"
      },
      {
        label: "行李箱輪子與底板",
        description: "旅行回來先看輪邊與底板，不要帶著地面灰推進櫃子。",
        supportSlug: "luggage-wheel-cleaning"
      }
    ]
  },
  {
    heading: "依情境找服務",
    intro: "把搜尋意圖拆成雨季、換季、通勤、節日前後，讓首頁不只列服務名稱，也回答客人真正會遇到的狀況。",
    items: [
      {
        label: "雨季通勤後",
        description: "先看鞋底、包角、鞋內濕氣與是否已經出現悶味。",
        serviceSlug: "shoe-bag-care"
      },
      {
        label: "換季收納前",
        description: "先確認外套、寢具與布品是否乾燥、有無汗味、潮氣或局部髒污。",
        serviceSlug: "fabric-storage"
      },
      {
        label: "白鞋要重新整理",
        description: "先判斷是表面灰塵、膠邊氧化、縫線卡灰或內裡味道。",
        serviceSlug: "white-shoe-cleaning"
      },
      {
        label: "店家與公司大量送洗",
        description: "先整理品項、件數、材質與特殊污漬，再用 LINE 詢問台中市收送安排。",
        serviceSlug: "business-bulk-laundry"
      }
    ]
  },
  {
    heading: "依地區找服務",
    intro: "把店家位置、台中全市收送和生活圈寫成可讀內容，讓搜尋引擎與 AI 清楚知道門市在西屯，收送涵蓋台中市。",
    items: [
      {
        label: "台中全市免費收送",
        description: "台中市可預約免費洗衣收送；以 LINE 傳照片詢問與預約為主。",
        serviceSlug: "taichung-citywide-laundry-pickup"
      },
      {
        label: "台中西屯洗衣店",
        description: "適合第一次想了解私享家位置、服務範圍、LINE 詢問流程與送洗前準備。",
        serviceSlug: "taichung-xitun-laundry"
      },
      {
        label: "青海路二段附近",
        description: "適合青海路、至善里與西屯生活圈客人查找衣物、鞋包與布品整理資訊。",
        serviceSlug: "taichung-xitun-laundry"
      },
      {
        label: "逢甲洗鞋・西屯洗鞋",
        description: "青海路門市與逢甲、西屯同區；先看洗鞋界線、收送範圍與 LINE 詢問方式。",
        supportSlug: "qinghai-road-shoe-cleaning"
      },
      {
        label: "逢甲洗衣收送",
        description: "宿舍與租屋的衣物、床包先傳照片，再約台中市免費收送。",
        supportSlug: "fengjia-laundry-pickup"
      },
      {
        label: "中科園區襯衫與公司件",
        description: "先列件數與領口狀況，再約公司櫃台或住家收送。",
        supportSlug: "zhongke-office-laundry"
      },
      {
        label: "東海洗衣收送",
        description: "厚被、窗簾與日常衣物可同一趟收，仍依材質分開判斷。",
        supportSlug: "donghai-laundry-pickup"
      }
    ]
  },
  {
    heading: "依決策前問題找答案",
    intro: "對應 AI 摘要與搜尋結果常抓的問答格式，讓客人先知道送洗前要拍什麼、問什麼、避免什麼。",
    items: [
      {
        label: "送洗前要拍哪裡？",
        description: "拍髒污近照、整體照片、材質位置與最在意的痕跡，門市會先看可整理程度。",
        href: "#how-it-works"
      },
      {
        label: "可以直接收納嗎？",
        description: "有汗味、濕氣、泥灰或水痕時不建議密封收納，先通風並詢問。",
        serviceSlug: "fabric-storage"
      },
      {
        label: "可以自己硬刷或漂白嗎？",
        description: "白鞋與包包材質差異大，先判斷材質再處理，避免變毛、變黃或留下痕跡。",
        serviceSlug: "white-shoe-cleaning"
      },
      {
        label: "窗簾或地毯怎麼估？",
        description: "都依尺寸看，先傳整幅或整張照片；沒乾不要先捲起來收納。",
        supportSlug: "carpet-cleaning"
      }
    ]
  }
];

const HOME_TRUST_ITEMS: HomeTrustItem[] = [
  {
    heading: "先判斷材質，再談清潔",
    body: "鞋面、包角、外套、寢具和白鞋膠邊的狀況不同，私享家會先看材質與痕跡位置，不用同一套方式處理所有物件。"
  },
  {
    heading: "真實門市照片做內容基礎",
    body: "公開站與社群內容優先使用門市洗護照片，讓客人看到實際檢查場景，也讓搜尋與 AI 有一致的圖片來源。"
  },
  {
    heading: "在地資料清楚",
    body: "地址、電話、營業時間、Google Maps、LINE、Facebook、Instagram 都從商家資料檔輸出，避免搜尋結果抓到不一致資訊。"
  },
  {
    heading: "不捏造保證與評論",
    body: "目前沒有 owner-approved 評論資料時，不在首頁寫假評價；改用流程、物件判斷與案例情境建立信任。"
  }
];

const HOME_PROCESS_STEPS: HomeTrustItem[] = [
  {
    heading: "拍照詢問",
    body: "先拍整體、近照、材質位置與最在意的痕跡，尤其是鞋邊、包角、提把、領口、袖口與寢具接觸皮膚的位置。"
  },
  {
    heading: "傳 LINE 或到店",
    body: "把照片、件數與材質傳 LINE，或直接帶到西屯青海路二段365號門市，門市會先看可整理程度。"
  },
  {
    heading: "門市判斷",
    body: "門市先看是表面灰塵、潮氣、油痕、氧化、材質磨耗或長時間收納造成的味道，再決定是否適合整理。"
  },
  {
    heading: "約收送或交件",
    body: "台中市全區可約免費收送，收送不收費、沒有最低消費；清潔與洗護費依物件狀態另計，能整理到什麼程度先說清楚。"
  },
  {
    heading: "洗好送回",
    body: "完成後送回或到店取件；收納前先確認乾透、沒有殘味，避免帶著濕氣封存。"
  }
];

function normalizeBaseUrl(value: string | undefined): string | undefined {
  if (!hasUsablePublicImageBaseUrl(value)) return undefined;
  return value?.replace(/\/+$/, "");
}

function publicUrl(path: string, baseUrl: string | undefined): string {
  const cleanPath = path.replace(/^\/+/, "");
  return baseUrl ? `${baseUrl}/${cleanPath}` : cleanPath;
}

function knowledgeHubUrl(index: PublicPostIndex): string {
  return publicUrl(KNOWLEDGE_HUB_PATH, index.base_url_configured ? index.base_url : undefined);
}

function knowledgeHubHref(index: PublicPostIndex, fromNestedPage = false): string {
  if (index.base_url_configured) return knowledgeHubUrl(index);
  return fromNestedPage ? `../${KNOWLEDGE_HUB_PATH}` : KNOWLEDGE_HUB_PATH;
}

function fromKnowledgeHubHref(href: string, index: PublicPostIndex): string {
  if (index.base_url_configured || /^(?:[a-z]+:|\/|#)/iu.test(href)) return href;
  return `../${href.replace(/^\.\//u, "")}`;
}

function buildSearchContentAnalyticsTag(index: PublicPostIndex, fromNestedPage = false): string {
  const src = index.base_url_configured
    ? publicUrl(SEARCH_CONTENT_ANALYTICS_PATH, index.base_url)
    : `${fromNestedPage ? "../" : ""}${SEARCH_CONTENT_ANALYTICS_PATH}`;
  return `<script defer src="${escapeHtml(src)}"></script>`;
}

function searchAnalyticsBodyAttributes(
  pageType: "home" | "knowledge_hub" | "answer" | "service" | "article" | "article_hub",
  contentId: string
): string {
  return `data-analytics-page-type="${escapeHtml(pageType)}" data-analytics-content-id="${escapeHtml(contentId)}"`;
}

function canonicalUrl(baseUrl: string | undefined): string {
  return baseUrl ? `${baseUrl}/` : "index.html";
}

export type LinePageSection = "home" | "services" | "guide" | "local" | "posts";
export type LinePlacement = "nav" | "cta" | "inline" | "pickup" | "footer";

export interface LineSourceInput {
  section: LinePageSection;
  slug?: string;
  date?: string;
  slot?: number;
  placement: LinePlacement;
}

export interface LineTouchpoint {
  page: string;
  placement: LinePlacement;
  slug: string;
}

function slugToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Join page + placement. Homepage footer is the bare `footer` slug. */
export function lineSourceSlug(input: LineSourceInput): string {
  const placement = slugToken(input.placement);
  if (input.section === "home") {
    return input.placement === "footer" ? "footer" : ["home", placement].filter(Boolean).join("-");
  }
  const tokens: string[] = [input.section];
  if (input.slug) tokens.push(slugToken(input.slug));
  if (input.date) tokens.push(slugToken(input.date));
  if (typeof input.slot === "number") tokens.push(`slot-${String(input.slot).padStart(2, "0")}`);
  tokens.push(placement);
  return tokens.filter(Boolean).join("-") || "unknown";
}

export function listLineTouchpoints(posts: Array<{ date: string; slot: number }> = []): LineTouchpoint[] {
  const homePlacements: LinePlacement[] = ["nav", "cta", "inline", "pickup", "footer"];
  const servicePlacements: LinePlacement[] = ["cta", "footer"];
  const supportPlacements: LinePlacement[] = ["nav", "cta", "inline"];
  const postPlacements: LinePlacement[] = ["nav", "cta", "footer"];
  const rows: LineTouchpoint[] = homePlacements.map((placement) => ({
    page: "index.html",
    placement,
    slug: lineSourceSlug({ section: "home", placement })
  }));
  for (const service of SERVICE_PAGE_DEFINITIONS) {
    for (const placement of servicePlacements) {
      rows.push({
        page: `services/${service.slug}.html`,
        placement,
        slug: lineSourceSlug({ section: "services", slug: service.slug, placement })
      });
    }
  }
  for (const page of SUPPORT_PAGE_DEFINITIONS) {
    const section: LinePageSection = page.category === "local" ? "local" : "guide";
    for (const placement of supportPlacements) {
      rows.push({
        page: page.path,
        placement,
        slug: lineSourceSlug({ section, slug: page.slug, placement })
      });
    }
  }
  rows.push({
    page: KNOWLEDGE_HUB_FILE,
    placement: "cta",
    slug: lineSourceSlug({ section: "guide", slug: "knowledge-hub", placement: "cta" })
  });
  if (posts.length > 0) {
    for (const placement of postPlacements) {
      rows.push({
        page: "posts/index.html",
        placement,
        slug: lineSourceSlug({ section: "posts", slug: "hub", placement })
      });
    }
  }
  for (const post of posts) {
    rows.push(
      ...postPlacements.map((placement) => ({
        page: `posts/${post.date}-slot-${String(post.slot).padStart(2, "0")}.html`,
        placement,
        slug: lineSourceSlug({ section: "posts", date: post.date, slot: post.slot, placement })
      }))
    );
  }
  return rows;
}

function trackedLineUrl(index: PublicPostIndex, input: LineSourceInput): string {
  const root = index.base_url_configured ? index.base_url : "";
  return `${root}/go/line.html?source=${encodeURIComponent(lineSourceSlug(input))}`;
}

// Without site-wide pageviews there is no way to tell whether the SEO/AEO/GEO
// pages bring anyone in. Emits nothing when PUBLIC_GA4_MEASUREMENT_ID is unset.
// The LINE redirect page suppresses the pageview because it sends its own event.
function buildAnalyticsTag(measurementId: string, sendPageView = true): string {
  const verification = getConfig().googleSiteVerification
    ? `<meta name="google-site-verification" content="${escapeHtml(getConfig().googleSiteVerification ?? "")}">\n    `
    : "";
  // Missing measurement ID used to degrade silently to "no analytics" -- a
  // fail-open for measurement. One env regression and every page ships
  // without gtag, line_click stops firing, and nothing says so; an audit
  // then reads the resulting zero as "no demand". The live site must refuse
  // to build untracked instead.
  if (!measurementId) {
    if (!getConfig().dryRun) {
      throw new Error(
        "PUBLIC_GA4_MEASUREMENT_ID is not set; refusing to build the live site without analytics. Set it or build with DRY_RUN=true."
      );
    }
    return verification.trim();
  }
  const options = sendPageView ? "" : ",{send_page_view:false}";
  return `${verification}<script async src="https://www.googletagmanager.com/gtag/js?id=${escapeHtml(measurementId)}"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config',${JSON.stringify(measurementId)}${options});</script>`;
}

/**
 * GitHub Pages project path that serves byte-identical copies of this same docs/ tree.
 * Google indexed it as a separate result even though every canonical points at the root.
 */
const LEGACY_PROJECT_PATH_PREFIX = "/laundry-social-auto-poster/";
/** GitHub Pages default host. Any custom domain supersedes it as the canonical origin. */
const GITHUB_PAGES_HOST_SUFFIX = ".github.io";

/**
 * Host to write into docs/CNAME, or undefined while the site still lives on github.io.
 * A CNAME file containing a github.io host would make GitHub reject the Pages build.
 */
function customDomainHost(siteBaseUrl: string | undefined): string | undefined {
  if (!siteBaseUrl) return undefined;
  try {
    const { hostname } = new URL(siteBaseUrl);
    return hostname.endsWith(GITHUB_PAGES_HOST_SUFFIX) ? undefined : hostname;
  } catch {
    return undefined;
  }
}

/**
 * The same docs/ bytes are served from more than one address, so the duplicates cannot be
 * told apart at build time and GitHub Pages cannot issue a real 301. This fires only when the
 * page is actually being served from a superseded address — the github.io project path, or
 * the whole github.io host once a custom domain is canonical — and sends the visitor to the
 * same document on the canonical origin. `replace` keeps the duplicate out of history.
 */
function buildLegacyPathRedirectScript(index: PublicPostIndex): string {
  if (!index.base_url_configured) return "";
  const canonicalUrl = new URL(index.canonical_url);
  const canonicalOrigin = canonicalUrl.origin;
  // Only treat the github.io host as superseded once we have actually moved off it.
  const supersededHost = canonicalUrl.hostname.endsWith(GITHUB_PAGES_HOST_SUFFIX)
    ? ""
    : `${GITHUB_PAGES_HOST_SUFFIX.slice(1)}`;
  return `<script>(function(){var p=${JSON.stringify(LEGACY_PROJECT_PATH_PREFIX)},o=${JSON.stringify(canonicalOrigin)},h=${JSON.stringify(supersededHost)},d=location.pathname;if(d.indexOf(p)===0){d="/"+d.slice(p.length);}else if(!(h&&location.hostname.indexOf(h)!==-1)){return;}location.replace(o+d+location.search+location.hash);})();</script>`;
}

export function buildLineRedirectHtml(input: { lineUrl: string; measurementId?: string }): string {
  const destination = input.lineUrl;
  const analytics = buildAnalyticsTag(input.measurementId ?? "", false);
  return `<!doctype html>
<html lang="zh-Hant-TW">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>前往私享家 LINE</title>
    ${analytics}
  </head>
  <body>
    <main><p>正在前往私享家 LINE；若沒有自動開啟，請<a href="${escapeHtml(destination)}">點這裡</a>。</p></main>
    <noscript>
      <meta http-equiv="refresh" content="0;url=${escapeHtml(destination)}" />
      <p><a href="${escapeHtml(destination)}">前往私享家 LINE</a></p>
    </noscript>
    <script>
      (() => {
        const destination = ${JSON.stringify(destination)};
        const params = new URLSearchParams(location.search);
        // A click whose source cannot be named is a click we cannot learn from.
        // On 2026-08-26 GA4 held three line_clicks with an empty source, which
        // this page cannot produce -- almost certainly older cached copies of
        // it -- so the value is now derived from the referrer when the query
        // string does not carry one, and it is never allowed to be empty.
        const referrerHost = (function () {
          try { return document.referrer ? new URL(document.referrer).hostname : ''; }
          catch (err) { return ''; }
        })();
        const fromReferrer = function (host) {
          if (!host) return '';
          if (host.indexOf('instagram') !== -1) return 'referrer-instagram';
          if (host.indexOf('facebook') !== -1 || host.indexOf('fb.') === 0) return 'referrer-facebook';
          if (host.indexOf('youtube') !== -1 || host.indexOf('youtu.be') !== -1) return 'referrer-youtube';
          if (host.indexOf('google') !== -1) return 'referrer-google';
          if (host.indexOf('sixiangjialaundry') !== -1 || host.indexOf('39211.github.io') !== -1) return 'referrer-site';
          return 'referrer-' + host;
        };
        const source = params.get('source') || fromReferrer(referrerHost) || 'unknown';
        let redirected = false;
        const redirect = function () {
          if (!redirected) { redirected = true; location.replace(destination); }
        };
        try {
          if (typeof window.gtag === 'function') {
            window.gtag('event', 'line_click', {
              // Both names on purpose: the property's custom dimension is
              // registered against one of them, and a rename on the GA4 side
              // must not silently empty the breakdown again.
              source: source,
              link_source: source,
              page_referrer: document.referrer || '',
              transport_type: 'beacon',
              event_callback: redirect,
              event_timeout: 1200
            });
            setTimeout(redirect, 1500);
          } else {
            redirect();
          }
        } catch (err) {
          redirect();
        }
      })();
    </script>
  </body>
</html>
`;
}

function slotDateTime(date: string, time: string): string {
  return `${date}T${time}:00+08:00`;
}

function postId(date: string, slot: number, baseUrl: string | undefined): string {
  const fragment = `post-${date}-slot-${String(slot).padStart(2, "0")}`;
  return baseUrl ? `${baseUrl}/content-calendar/${date}.json#${fragment}` : `urn:sixiangjia:${date}:slot:${slot}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeXml(value: string): string {
  return escapeHtml(value).replaceAll("'", "&apos;");
}

function escapeJsonLd(value: object): string {
  return JSON.stringify(value).replace(/<\//g, "<\\/");
}

function extractHashtags(...values: string[]): string[] {
  const matches = values.flatMap((value) => value.match(/#[^\s#]+/gu) ?? []);
  return Array.from(
    new Set(matches.map((item) => item.replace(/[，。！？、,.;:!?]+$/u, "")).filter((item) => item.length > 1))
  );
}

function entrypointLines(index: PublicPostIndex): string[] {
  return Object.entries(index.entrypoints).flatMap(([name, value]) => {
    if (typeof value === "string") return [`- ${name}: ${value}`];
    return Object.entries(value).map(([childName, childUrl]) => `- ${name}.${childName}: ${childUrl}`);
  });
}

async function loadBusinessProfile(root: string): Promise<BusinessProfile> {
  const profilePath = join(root, "data", "business-profile.json");
  const profile = await readJsonFile<BusinessProfile | undefined>(profilePath, undefined);
  if (!profile) {
    throw new Error(`Missing business profile: ${profilePath}`);
  }
  if (!profile.name || !profile.address_text || !profile.map_url || !profile.telephone) {
    throw new Error(`Invalid business profile: expected name, address_text, map_url, and telephone.`);
  }
  if (!Array.isArray(profile.opening_hours_schema) || !Array.isArray(profile.opening_hours_specification)) {
    throw new Error(`Invalid business profile: expected opening_hours_schema and opening_hours_specification arrays.`);
  }
  if (!profile.holiday_hours_rule || !Array.isArray(profile.holiday_hours_rule.overrides)) {
    throw new Error(`Invalid business profile: expected holiday_hours_rule.overrides array.`);
  }
  return profile;
}

function verifiedHolidayOverrides(profile: BusinessProfile): OpeningHoursSpecification[] {
  return profile.holiday_hours_rule.overrides
    .filter((override) => override.verified_by_owner && (override.closed || (override.opens && override.closes)))
    .map((override) => ({
      "@type": "OpeningHoursSpecification",
      validFrom: override.date,
      validThrough: override.date,
      ...(override.closed ? { opens: "00:00", closes: "00:00" } : { opens: override.opens, closes: override.closes })
    }));
}

function buildOpenGraph(index: PublicPostIndex): PublicPostIndex["open_graph"] {
  const image = primaryHomeImage(index);
  return {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    type: "website",
    url: index.canonical_url,
    site_name: index.business_profile.name,
    image: image?.image_url.startsWith("https://") ? image.image_url : "",
    image_alt: image ? `${image.topic}｜${index.business_profile.name}` : `${index.business_profile.name} 門市與洗護內容照片`,
    locale: SITE_LOCALE
  };
}

function buildBusinessSchema(index: PublicPostIndex): object | undefined {
  if (!index.base_url_configured) return undefined;
  const profile = index.business_profile;

  const images = Array.from(
    new Set(
      [...index.posts.map((post) => post.image_url), ...allServiceImages(index).map((image) => image.image_url)].filter((url) =>
        url.startsWith("https://")
      )
    )
  );
  const identifiers = [
    {
      "@type": "PropertyValue",
      propertyID: "Google Maps CID",
      value: profile.google_maps_cid
    },
    profile.google_place_id
      ? {
          "@type": "PropertyValue",
          propertyID: "Google Place ID",
          value: profile.google_place_id
        }
      : undefined
  ].filter(Boolean);
  const specialOpeningHoursSpecification = verifiedHolidayOverrides(profile);

  const schema = {
    "@context": "https://schema.org",
    "@type": "DryCleaningOrLaundry",
    "@id": `${index.canonical_url}#business`,
    name: profile.name,
    alternateName: [profile.google_business_profile_name, ...profile.alternate_names],
    url: index.canonical_url,
    description: SITE_DESCRIPTION,
    inLanguage: "zh-Hant",
    address: profile.address,
    telephone: profile.telephone,
    // The floor price the site itself publishes (襯衫 70 on the service pages
    // and daily captions). Kept to the short form Google renders in local
    // results; per-item quotes stay on the pages, consistent with the site's
    // no-unverified-prices rule.
    priceRange: "NT$70 起",
    identifier: identifiers,
    contactPoint: [
      {
        "@type": "ContactPoint",
        telephone: profile.telephone,
        contactType: "customer service",
        areaServed: {
          "@type": "AdministrativeArea",
          name: "台中市"
        },
        availableLanguage: ["zh-Hant"]
      },
      {
        "@type": "ContactPoint",
        telephone: profile.mobile_or_line,
        url: profile.line_url,
        contactType: "LINE / mobile estimates",
        areaServed: {
          "@type": "AdministrativeArea",
          name: "台中市"
        },
        availableLanguage: ["zh-Hant"]
      }
    ],
    openingHours: profile.opening_hours_schema,
    openingHoursSpecification: profile.opening_hours_specification,
    ...(specialOpeningHoursSpecification.length > 0 ? { specialOpeningHoursSpecification } : {}),
    // Owner-verified pin, long-pressed on the shop's own Maps listing
    // (2026-08-21). Never derive these from a Maps short-link page — the
    // viewport centre that page serves sat 10km from the shop and would have
    // poisoned local relevance where a missing geo merely defers to the
    // address.
    geo: {
      "@type": "GeoCoordinates",
      latitude: 24.1780524,
      longitude: 120.6420289
    },
    hasMap: profile.map_url,
    // Every profile the shop actually owns belongs here: sameAs is how search
    // engines and LLMs decide that the site, the Maps listing, the YouTube
    // channel and the social accounts are one entity rather than four unrelated
    // results. It listed only Facebook and Instagram while the shop had been
    // publishing to YouTube daily and had a live Maps listing.
    sameAs: [profile.facebook_url, profile.instagram_url, profile.youtube_url, profile.map_url].filter(
      (url): url is string => Boolean(url)
    ),
    image: images,
    areaServed: [
      {
        "@type": "AdministrativeArea",
        name: "台中市"
      },
      {
        "@type": "AdministrativeArea",
        name: "台中市西屯區"
      },
      {
        "@type": "Place",
        name: "青海路二段"
      }
    ],
    knowsAbout: Array.from(new Set([...profile.service_topics, ...LOCAL_SEARCH_QUERY_TARGETS])),
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "私享家洗衣店服務目錄",
      itemListElement: SERVICE_PAGE_DEFINITIONS.map((service) => ({
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: service.name,
          serviceType: service.name,
          description: service.answer_summary,
          areaServed: serviceAreaServedSchema(service),
          url: servicePageUrl(service, index)
        },
        // Free pickup/delivery only — never encode cleaning as price 0.
        ...(service.slug === "taichung-citywide-laundry-pickup"
          ? {
              name: "台中全市免費洗衣收送",
              description:
                "台中市全市免費收送；清潔與洗護費用另計。預約以 LINE 為主。"
            }
          : {})
      }))
    }
  };
  return schema;
}

/**
 * Business node without @context, for inlining into a page-level @graph. JSON-LD @id
 * references resolve per document, so every page that points at #business must carry the
 * full node itself.
 */
function buildBusinessSchemaNode(index: PublicPostIndex): Record<string, unknown> | undefined {
  const business = buildBusinessSchema(index);
  if (!business) return undefined;
  const businessNode = { ...(business as Record<string, unknown>) };
  delete businessNode["@context"];
  // The node is inlined into every page, so carry a stable curated image set instead of
  // every post image — the full list stays in knowledge-graph.json and ai-discovery.json.
  const curatedImages = allServiceImages(index)
    .map((image) => image.image_url)
    .filter((url) => url.startsWith("https://"));
  if (curatedImages.length > 0) businessNode.image = Array.from(new Set(curatedImages));
  return businessNode;
}

/** WebSite node for inlining into a page-level @graph (same per-document rule as #business). */
function buildWebsiteSchemaNode(index: PublicPostIndex): object {
  return {
    "@type": "WebSite",
    "@id": `${index.canonical_url}#website`,
    name: index.business_profile.name,
    alternateName: SITE_TITLE,
    url: index.canonical_url,
    inLanguage: "zh-Hant-TW",
    description: SITE_DESCRIPTION,
    publisher: { "@id": `${index.canonical_url}#business` }
  };
}

/** Service node for inlining into any page's @graph that references `<service page>#service`. */
function buildServiceSchemaNode(service: ServicePageDefinition, index: PublicPostIndex): Record<string, unknown> {
  const canonical = servicePageUrl(service, index);
  const image = findServiceImage(service, index);
  return {
    "@type": "Service",
    "@id": `${canonical}#service`,
    url: canonical,
    // Plain URL rather than an @id reference: guide pages embed this node without carrying
    // the service page's #webpage node, and a bare @id would dangle there. Keeping the value
    // identical everywhere is what stops the same @id describing two different entities.
    mainEntityOfPage: canonical,
    name: service.name,
    description: service.summary,
    serviceType: service.name,
    provider: { "@id": `${index.canonical_url}#business` },
    areaServed: serviceAreaServedSchema(service),
    ...(image?.image_url ? { image: image.image_url } : {}),
    keywords: service.keywords
  };
}

function buildHomePageSchema(index: PublicPostIndex): object | undefined {
  const businessNode = buildBusinessSchemaNode(index);
  if (!businessNode) return undefined;
  const faqs = homeFaqs(index.business_profile);

  return {
    "@context": "https://schema.org",
    "@graph": [
      businessNode,
      buildWebsiteSchemaNode(index),
      {
        "@type": "WebPage",
        "@id": `${index.canonical_url}#webpage`,
        url: index.canonical_url,
        name: SITE_TITLE,
        description: SITE_DESCRIPTION,
        inLanguage: "zh-Hant-TW",
        isPartOf: { "@id": `${index.canonical_url}#website` },
        about: { "@id": `${index.canonical_url}#business` },
        mainEntity: { "@id": `${index.canonical_url}#business` },
        breadcrumb: { "@id": `${index.canonical_url}#breadcrumb` },
        hasPart: [
          { "@id": `${index.canonical_url}#homepage-faq` },
          { "@id": `${index.canonical_url}#service-discovery` }
        ],
        ...(index.open_graph.image
          ? {
              primaryImageOfPage: {
                "@type": "ImageObject",
                contentUrl: index.open_graph.image,
                caption: index.open_graph.image_alt
              }
            }
          : {}),
        ...optionalSchemaDateModified(homepageContentLastmod(index))
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${index.canonical_url}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: index.business_profile.name,
            item: index.canonical_url
          }
        ]
      },
      {
        "@type": "ItemList",
        "@id": `${index.canonical_url}#service-discovery`,
        name: "私享家洗衣店服務導覽",
        itemListElement: HOME_DISCOVERY_GROUPS.flatMap((group, groupIndex) =>
          group.items.map((item, itemIndex) => ({
            "@type": "ListItem",
            position: groupIndex * 10 + itemIndex + 1,
            name: item.label,
            description: item.description,
            url: homeDiscoveryItemUrl(item, index)
          }))
        )
      },
      {
        "@type": "FAQPage",
        "@id": `${index.canonical_url}#homepage-faq`,
        url: `${index.canonical_url}#homepage-faq`,
        isPartOf: { "@id": `${index.canonical_url}#webpage` },
        about: { "@id": `${index.canonical_url}#business` },
        mainEntity: faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: faq.answer
          }
        }))
      }
    ]
  };
}

function servicePagePath(service: ServicePageDefinition): string {
  return `services/${service.slug}.html`;
}

function servicePageUrl(service: ServicePageDefinition, index: PublicPostIndex): string {
  return index.entrypoints.service_pages[service.slug] ?? servicePagePath(service);
}

function supportPageUrl(page: SupportPageDefinition, index: PublicPostIndex): string {
  return index.entrypoints.support_pages[page.slug] ?? page.path;
}

function serviceAreaServedName(service: ServicePageDefinition): string {
  return service.area_served_name ?? "台中西屯";
}

function serviceAreaServedSchema(service: ServicePageDefinition): {
  "@type": "AdministrativeArea";
  name: string;
} {
  return {
    "@type": "AdministrativeArea",
    name: serviceAreaServedName(service)
  };
}

function homeFaqs(profile: BusinessProfile): ServiceFaq[] {
  return [
    {
      question: "私享家洗衣店在哪裡？",
      answer: `私享家洗衣店位於${profile.address_text}，可用 Google Maps 導航；也可以先透過 LINE 傳照片詢問。`
    },
    {
      question: "台中市哪些地方可以預約洗衣收送？",
      answer: "收送範圍為台中市全區，收送本身免費；清潔、洗護與其他整理費用另依實際物件狀態判斷。"
    },
    {
      question: "免費收送有最低消費門檻嗎？",
      answer:
        "收送沒有最低消費門檻。台中市內收送本身免費，不需要單次洗滌滿額才能收送；清潔與洗護費用依實際物件狀態判斷，與是否收送無關。"
    },
    {
      question: "怎麼預約台中洗衣收送？",
      answer: "主要透過 LINE 預約。請先傳物件整體照、局部近照、材質標籤，並說明所在區域與品項，門市確認方向後再約定收送。"
    },
    {
      question: "收送免費等於清潔免費嗎？",
      answer: "不等於。免費的是台中市內的收送服務，清潔與洗護費用仍需依材質、髒污與物件狀態另行判斷。"
    }
  ];
}

/** Prefer YYYY-MM-DD from ISO-ish timestamps; return undefined when not defensible. */
function toSitemapLastmodDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/u);
  return match?.[1];
}

/**
 * Schema.org dateModified only when a defensible content date exists.
 * Prefer full ISO timestamps; fall back to YYYY-MM-DD. Never use build generated_at.
 */
function optionalSchemaDateModified(value: string | undefined): { dateModified: string } | Record<string, never> {
  if (!value) return {};
  const trimmed = value.trim();
  if (!trimmed) return {};
  // Keep full ISO-ish timestamps when provided (e.g. post.date_published).
  if (/^\d{4}-\d{2}-\d{2}T/u.test(trimmed)) {
    return { dateModified: trimmed };
  }
  const day = toSitemapLastmodDate(trimmed);
  return day ? { dateModified: day } : {};
}

/** Explicit content_lastmod only — do not invent defaults for static service pages. */
function serviceContentLastmod(service: ServicePageDefinition): string | undefined {
  return toSitemapLastmodDate(service.content_lastmod);
}

/** Explicit content_lastmod only — do not invent defaults for static support pages. */
function supportContentLastmod(page: SupportPageDefinition): string | undefined {
  return toSitemapLastmodDate(page.content_lastmod);
}

/** The hub changes only when one of its visible accepted/support pages changes. */
function knowledgeHubContentLastmod(): string | undefined {
  return [
    KNOWLEDGE_HUB_TEMPLATE_LASTMOD,
    ...SERVICE_PAGE_DEFINITIONS.map((service) => serviceContentLastmod(service)),
    ...SUPPORT_PAGE_DEFINITIONS.map((page) => supportContentLastmod(page))
  ]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
}

/**
 * Bump this when the post page template's visible content materially changes.
 * A post's lastmod is the later of its own date and this, because a template
 * change rewrites every post page: on 2026-08-08 all 57 post pages gained
 * inspection points, FAQs and related links, but their lastmod still claimed
 * their original publish date, so crawlers had no reason to come back and see
 * any of it. It is deliberately a hand-set constant -- claiming "everything
 * changed today" on every build is how a sitemap's lastmod stops being trusted.
 */
const POST_TEMPLATE_CONTENT_LASTMOD = "2026-09-04";

function postContentLastmod(post: PublicPost): string | undefined {
  const own = toSitemapLastmodDate(post.date_published) ?? toSitemapLastmodDate(post.date);
  const template = toSitemapLastmodDate(POST_TEMPLATE_CONTENT_LASTMOD);
  if (!own) return template;
  if (!template) return own;
  return own > template ? own : template;
}

/**
 * Homepage content changes whenever a new approved post is published, so its lastmod is the
 * newest approved post date, floored at the static-section baseline. Stable across rebuilds.
 */
function homepageContentLastmod(index: PublicPostIndex): string {
  const baseline = toSitemapLastmodDate(HOMEPAGE_STATIC_CONTENT_LASTMOD) ?? HOMEPAGE_STATIC_CONTENT_LASTMOD;
  const newestPostDate = index.posts
    .map((post) => postContentLastmod(post))
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  return newestPostDate && newestPostDate > baseline ? newestPostDate : baseline;
}

function sitemapLastmodForUrl(url: string, index: PublicPostIndex): string | undefined {
  if (url === index.canonical_url) {
    return homepageContentLastmod(index);
  }

  if (url === knowledgeHubUrl(index) || url.endsWith(`/${KNOWLEDGE_HUB_PATH}`)) {
    return knowledgeHubContentLastmod();
  }

  for (const service of SERVICE_PAGE_DEFINITIONS) {
    if (url === servicePageUrl(service, index) || url.endsWith(`/services/${service.slug}.html`)) {
      return serviceContentLastmod(service);
    }
  }

  for (const page of SUPPORT_PAGE_DEFINITIONS) {
    if (url === supportPageUrl(page, index) || url.endsWith(`/${page.path}`) || url.endsWith(page.path)) {
      return supportContentLastmod(page);
    }
  }

  for (const post of index.article_posts) {
    if (url === post.article_url || url.endsWith(`/posts/${post.date}-slot-${String(post.slot).padStart(2, "0")}.html`)) {
      return postContentLastmod(post);
    }
  }

  if (url === postsHubUrl(index) || url.endsWith(`/${POSTS_HUB_PATH}`)) {
    return postsHubContentLastmod(index);
  }

  // Omit lastmod when no stable modification date is known.
  return undefined;
}

function sitemapUrlEntry(url: string, index: PublicPostIndex): string {
  const lastmod = sitemapLastmodForUrl(url, index);
  const lastmodXml = lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : "";
  return `  <url><loc>${escapeXml(url)}</loc>${lastmodXml}</url>`;
}

function postArticlePath(date: string, slot: number): string {
  return `posts/${date}-slot-${String(slot).padStart(2, "0")}.html`;
}

function postArticleUrl(post: Pick<PublicPost, "date" | "slot">, siteBaseUrl: string | undefined): string {
  return publicUrl(postArticlePath(post.date, post.slot), siteBaseUrl);
}

function normalizedCaptionForArticle(post: PublicPost): string {
  return post.facebook_caption.replace(/\s+/gu, " ").trim().toLocaleLowerCase("zh-Hant-TW");
}

function uniqueArticlePosts(posts: PublicPost[]): PublicPost[] {
  const seenCaptions = new Set<string>();
  return posts.filter((post) => {
    const normalizedCaption = normalizedCaptionForArticle(post);
    if (!normalizedCaption || seenCaptions.has(normalizedCaption)) return false;
    seenCaptions.add(normalizedCaption);
    return true;
  });
}

function hasArticlePage(post: PublicPost, index: PublicPostIndex): boolean {
  return index.article_posts.some((item) => item.id === post.id);
}

/**
 * A post whose caption duplicates an earlier one gets no article page of its own. Its reader
 * still deserves the article rather than the raw calendar JSON, so fall back to the post that
 * does own that caption. Only a post with no article anywhere falls through to the JSON.
 */
function canonicalArticleFor(post: PublicPost, index: PublicPostIndex): PublicPost | undefined {
  const own = index.article_posts.find((item) => item.id === post.id);
  if (own) return own;
  const caption = normalizedCaptionForArticle(post);
  if (!caption) return undefined;
  return index.article_posts.find((item) => normalizedCaptionForArticle(item) === caption);
}

function postHumanUrl(post: PublicPost, index: PublicPostIndex): string {
  return canonicalArticleFor(post, index)?.article_url ?? post.calendar_url;
}

function indexNowKeyFileName(key: string): string {
  if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) {
    throw new Error("INDEXNOW_KEY must be 8-128 letters, numbers, or hyphens.");
  }
  return `${key}.txt`;
}

function configuredIndexNowKey(root: string): string | undefined {
  const direct = process.env.INDEXNOW_KEY?.trim();
  if (direct) return direct;
  return loadDotenv({ path: join(root, ".env"), processEnv: {} }).parsed?.INDEXNOW_KEY?.trim();
}

function findServiceBySlug(slug: string): ServicePageDefinition | undefined {
  return SERVICE_PAGE_DEFINITIONS.find((service) => service.slug === slug);
}

function linkedSupportService(page: SupportPageDefinition): ServicePageDefinition | undefined {
  return page.service_slug ? findServiceBySlug(page.service_slug) : undefined;
}

function requireLinkedSupportService(page: SupportPageDefinition): ServicePageDefinition {
  const service = linkedSupportService(page);
  if (!service) {
    throw new Error(
      `support page ${page.slug} is missing a known service_slug parent; homepage fallback is not permitted`
    );
  }
  return service;
}

function homeDiscoveryItemUrl(item: HomeDiscoveryItem, index: PublicPostIndex): string {
  if (item.serviceSlug) {
    const service = findServiceBySlug(item.serviceSlug);
    if (!service) {
      throw new Error(`home discovery serviceSlug ${item.serviceSlug} is not a known service`);
    }
    return servicePageUrl(service, index);
  }
  if (item.supportSlug) {
    const page = SUPPORT_PAGE_DEFINITIONS.find((entry) => entry.slug === item.supportSlug);
    if (!page) {
      throw new Error(`home discovery supportSlug ${item.supportSlug} is not an accepted public page`);
    }
    return supportPageUrl(page, index);
  }
  if (item.href) return item.href;
  throw new Error("home discovery item is missing serviceSlug, supportSlug, or href");
}

function staticServiceImageReference(service: ServicePageDefinition, index: PublicPostIndex): PublicImageReference | undefined {
  if (!service.static_image_path) return undefined;
  return {
    id: `${servicePageUrl(service, index)}#primary-image`,
    topic: service.static_image_topic ?? service.name,
    image_path: service.static_image_path,
    image_url: publicUrl(service.static_image_path, index.image_base_url || index.base_url || undefined),
    source_type: "generated-product-image"
  };
}

function postImageReference(post: PublicPost): PublicImageReference {
  return {
    id: `${post.id}:image`,
    topic: post.topic,
    image_path: post.image_path,
    image_url: post.image_url,
    source_type: "social-post",
    source_post_id: post.id
  };
}

function findServiceImage(service: ServicePageDefinition, index: PublicPostIndex): PublicImageReference | undefined {
  const staticImage = staticServiceImageReference(service, index);
  if (staticImage) return staticImage;
  if (service.allow_image_fallback === false) return undefined;

  const candidates = [...index.posts].reverse();
  const matchedPost = candidates.find((post) => {
    const text = `${post.topic}\n${post.facebook_caption}\n${post.instagram_caption}`;
    return [service.image_hint, ...service.keywords].some((keyword) => text.includes(keyword));
  });
  if (matchedPost) return postImageReference(matchedPost);

  return candidates[0] ? postImageReference(candidates[0]) : undefined;
}

function allServiceImages(index: PublicPostIndex): PublicImageReference[] {
  return SERVICE_PAGE_DEFINITIONS.flatMap((service) => {
    const image = findServiceImage(service, index);
    return image ? [image] : [];
  });
}

function visibleImageSrc(image: PublicImageReference | PublicPost, index: PublicPostIndex, servicePage = false): string {
  if (index.image_base_url_configured && image.image_url) return image.image_url;
  if ("image_path" in image) return servicePage ? `../${image.image_path}` : image.image_path;
  return "";
}

interface ImagePixelSize {
  width: number;
  height: number;
}

/** Approved post images are generated at 1080x1350; used when the source file is unavailable. */
const POST_IMAGE_FALLBACK_SIZE: ImagePixelSize = { width: 1080, height: 1350 };
/** Static service hero assets are 1672x941; used when the source file is unavailable. */
const SERVICE_IMAGE_FALLBACK_SIZE: ImagePixelSize = { width: 1672, height: 941 };
/** Maximum pixel width for generated .webp derivatives. */
const WEBP_MAX_WIDTH = 1200;

/** docs/ root of the current generation run; set once per generatePublicSite call. */
let activeDocsRoot = "";
const pngSizeCache = new Map<string, ImagePixelSize | undefined>();

function setActiveDocsRoot(docsRoot: string): void {
  activeDocsRoot = docsRoot;
  pngSizeCache.clear();
}

/** Read the intrinsic pixel size from a PNG IHDR chunk without decoding the image. */
function readPngPixelSize(filePath: string): ImagePixelSize | undefined {
  try {
    const header = Buffer.alloc(24);
    const fd = openSync(filePath, "r");
    try {
      if (readSync(fd, header, 0, 24, 0) !== 24) return undefined;
    } finally {
      closeSync(fd);
    }
    if (header.readUInt32BE(12) !== 0x49484452) return undefined; // "IHDR"
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } catch {
    return undefined;
  }
}

function imagePixelSize(imagePath: string, fallback: ImagePixelSize): ImagePixelSize {
  if (!pngSizeCache.has(imagePath)) {
    pngSizeCache.set(imagePath, activeDocsRoot ? readPngPixelSize(join(activeDocsRoot, imagePath)) : undefined);
  }
  return pngSizeCache.get(imagePath) ?? fallback;
}

function webpDocsPath(imagePath: string): string | undefined {
  return /\.png$/iu.test(imagePath) ? imagePath.replace(/\.png$/iu, ".webp") : undefined;
}

/**
 * Real duration from the mp4's mvhd atom, as an ISO 8601 string for schema.org. Read from the
 * file because the calendar never carries it — inventing a number would be worse than leaving
 * the field out, so an unreadable file yields undefined and the property is omitted.
 */
function readMp4Duration(videoPath: string): string | undefined {
  if (!activeDocsRoot || !videoPath) return undefined;
  const filePath = join(activeDocsRoot, videoPath);
  if (!existsSync(filePath)) return undefined;

  const fd = openSync(filePath, "r");
  try {
    const fileSize = statSync(filePath).size;
    const header = Buffer.alloc(16);
    // Walk top-level boxes by their declared size rather than scanning bytes: these files are
    // not faststart, so moov sits after a multi-megabyte mdat at the end of the file.
    for (let offset = 0; offset + 8 <= fileSize; ) {
      if (readSync(fd, header, 0, 16, offset) < 8) return undefined;
      const declared = header.readUInt32BE(0);
      const type = header.toString("latin1", 4, 8);
      const boxSize = declared === 1 ? Number(header.readBigUInt64BE(8)) : declared === 0 ? fileSize - offset : declared;
      if (!Number.isFinite(boxSize) || boxSize < 8) return undefined;
      if (type !== "moov") {
        offset += boxSize;
        continue;
      }
      const moov = Buffer.alloc(Math.min(boxSize, 1024 * 1024));
      readSync(fd, moov, 0, moov.length, offset);
      const mvhd = moov.indexOf("mvhd");
      if (mvhd < 0) return undefined;
      // mvhd payload: version(1) flags(3), then creation/modification/timescale/duration.
      const version = moov.readUInt8(mvhd + 4);
      const base = mvhd + 8;
      const [timescale, duration] =
        version === 1
          ? [moov.readUInt32BE(base + 16), Number(moov.readBigUInt64BE(base + 20))]
          : [moov.readUInt32BE(base + 8), moov.readUInt32BE(base + 12)];
      if (!timescale || !duration) return undefined;
      const seconds = Math.round(duration / timescale);
      if (seconds <= 0) return undefined;
      const minutes = Math.floor(seconds / 60);
      return minutes > 0 ? `PT${minutes}M${seconds % 60}S` : `PT${seconds}S`;
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

/** webp URL/relative src matching `src`, only when the derivative exists in docs/. */
function webpSrcFor(imagePath: string, src: string): string | undefined {
  const webpPath = webpDocsPath(imagePath);
  if (!webpPath || !activeDocsRoot || !existsSync(join(activeDocsRoot, webpPath))) return undefined;
  return src.replace(/\.png$/iu, ".webp");
}

function responsiveImageHtml(options: {
  imagePath: string;
  src: string;
  alt: string;
  fallbackSize: ImagePixelSize;
  className?: string;
  loading?: "lazy" | "eager";
  fetchpriority?: "high";
}): string {
  const { width, height } = imagePixelSize(options.imagePath, options.fallbackSize);
  const webpSrc = webpSrcFor(options.imagePath, options.src);
  const attributes = [
    options.className ? `class="${options.className}"` : "",
    `src="${escapeHtml(options.src)}"`,
    `alt="${escapeHtml(options.alt)}"`,
    `width="${width}"`,
    `height="${height}"`,
    options.loading ? `loading="${options.loading}"` : "",
    options.fetchpriority ? `fetchpriority="${options.fetchpriority}"` : ""
  ]
    .filter(Boolean)
    .join(" ");
  const img = `<img ${attributes} />`;
  if (!webpSrc) return img;
  return `<picture><source type="image/webp" srcset="${escapeHtml(webpSrc)}" />${img}</picture>`;
}

/**
 * Generate .webp derivatives (≤${WEBP_MAX_WIDTH}px wide) next to every PNG the HTML pages
 * reference. PNGs stay as the src/og:image fallback; webp is offered via <picture>.
 */
async function generateWebpDerivatives(index: PublicPostIndex, docsRoot: string): Promise<void> {
  const imagePaths = new Set<string>();
  for (const post of index.posts) {
    if (post.image_path) imagePaths.add(post.image_path);
  }
  for (const image of allServiceImages(index)) {
    imagePaths.add(image.image_path);
  }
  const targets = [...imagePaths].filter(
    (imagePath) => webpDocsPath(imagePath) !== undefined && existsSync(join(docsRoot, imagePath))
  );
  if (targets.length === 0) return;

  let sharp: (typeof import("sharp"))["default"];
  try {
    sharp = (await import("sharp")).default;
  } catch (error) {
    console.warn(`webp derivatives skipped (sharp unavailable): ${error instanceof Error ? error.message : error}`);
    return;
  }
  for (const imagePath of targets) {
    const source = join(docsRoot, imagePath);
    const target = join(docsRoot, webpDocsPath(imagePath)!);
    if (existsSync(target) && statSync(target).mtimeMs >= statSync(source).mtimeMs) continue;
    await sharp(source)
      .resize({ width: WEBP_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(target);
  }
}

function primaryHomeImage(index: PublicPostIndex): PublicImageReference | undefined {
  const fabricService = findServiceBySlug("fabric-storage");
  if (fabricService) {
    const fabricImage = findServiceImage(fabricService, index);
    if (fabricImage) return fabricImage;
  }
  return index.posts[0] ? postImageReference(index.posts[0]) : undefined;
}

/**
 * Support pages reuse the linked service's hero image. Several guides can share one service,
 * so prefer an approved post image whose topic actually matches the guide before falling back
 * to the service hero — otherwise every fabric-storage guide shares one preview image.
 */
function supportPageImage(page: SupportPageDefinition, index: PublicPostIndex): PublicImageReference | undefined {
  const matchedPost = [...index.posts]
    .reverse()
    .find((post) => page.keywords.some((keyword) => post.topic.includes(keyword)));
  if (matchedPost) return postImageReference(matchedPost);

  const service = linkedSupportService(page);
  return (service ? findServiceImage(service, index) : undefined) ?? primaryHomeImage(index);
}

function supportPageImageAlt(page: SupportPageDefinition, image: PublicImageReference): string {
  return `${image.topic}｜${page.h1}`;
}

function buildServicePageSchema(service: ServicePageDefinition, index: PublicPostIndex): object | undefined {
  const businessNode = buildBusinessSchemaNode(index);
  if (!businessNode) return undefined;
  // Every page embeds the same #business node. Stripping hasOfferCatalog from
  // one page would publish two contradictory property sets under one @id, which
  // is worse for a consumer merging the graph than the markup it removes — and
  // a service catalogue is the one thing a price page should carry. What must
  // never appear is Product or AggregateRating: we sell a service, and we have
  // no ratings data of our own to state.
  const schemaBusinessNode = { ...businessNode };

  const canonical = servicePageUrl(service, index);
  const image = findServiceImage(service, index);

  return {
    "@context": "https://schema.org",
    "@graph": [
      schemaBusinessNode,
      buildWebsiteSchemaNode(index),
      {
        "@type": "WebPage",
        "@id": `${canonical}#webpage`,
        url: canonical,
        name: service.title,
        description: service.description,
        inLanguage: "zh-Hant-TW",
        isPartOf: { "@id": `${index.canonical_url}#website` },
        about: { "@id": `${canonical}#service` },
        mainEntity: { "@id": `${canonical}#service` },
        breadcrumb: { "@id": `${canonical}#breadcrumb` },
        hasPart: { "@id": `${canonical}#faq` },
        ...(image?.image_url
          ? {
              primaryImageOfPage: {
                "@type": "ImageObject",
                contentUrl: image.image_url,
                caption: service.image_alt
              }
            }
          : {}),
        ...optionalSchemaDateModified(service.content_lastmod)
      },
      buildServiceSchemaNode(service, index),
      {
        "@type": "FAQPage",
        "@id": `${canonical}#faq`,
        url: `${canonical}#faq`,
        isPartOf: { "@id": `${canonical}#webpage` },
        about: { "@id": `${canonical}#service` },
        mainEntity: service.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: faq.answer
          }
        }))
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${canonical}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: index.business_profile.name,
            item: index.canonical_url
          },
          {
            "@type": "ListItem",
            position: 2,
            name: service.name,
            item: canonical
          }
        ]
      }
    ]
  };
}

function buildKnowledgeHubSchema(index: PublicPostIndex): object | undefined {
  const businessNode = buildBusinessSchemaNode(index);
  if (!businessNode) return undefined;
  const canonical = knowledgeHubUrl(index);

  return {
    "@context": "https://schema.org",
    "@graph": [
      businessNode,
      buildWebsiteSchemaNode(index),
      {
        "@type": "CollectionPage",
        "@id": `${canonical}#webpage`,
        url: canonical,
        name: KNOWLEDGE_HUB_TITLE,
        description: KNOWLEDGE_HUB_DESCRIPTION,
        inLanguage: "zh-Hant-TW",
        isPartOf: { "@id": `${index.canonical_url}#website` },
        about: { "@id": `${index.canonical_url}#business` },
        mainEntity: { "@id": `${canonical}#answers` },
        breadcrumb: { "@id": `${canonical}#breadcrumb` },
        ...optionalSchemaDateModified(knowledgeHubContentLastmod())
      },
      {
        "@type": "ItemList",
        "@id": `${canonical}#answers`,
        numberOfItems: SUPPORT_PAGE_DEFINITIONS.length,
        itemListElement: SUPPORT_PAGE_DEFINITIONS.map((page, position) => ({
          "@type": "ListItem",
          position: position + 1,
          name: page.h1,
          url: supportPageUrl(page, index)
        }))
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${canonical}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: index.business_profile.name,
            item: index.canonical_url
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "洗護知識庫",
            item: canonical
          }
        ]
      }
    ]
  };
}

function buildSupportPageSchema(page: SupportPageDefinition, index: PublicPostIndex): object | undefined {
  const businessNode = buildBusinessSchemaNode(index);
  if (!businessNode) return undefined;

  const canonical = supportPageUrl(page, index);
  const service = linkedSupportService(page);
  const serviceUrl = service ? servicePageUrl(service, index) : undefined;
  const image = supportPageImage(page, index);

  return {
    "@context": "https://schema.org",
    "@graph": [
      businessNode,
      buildWebsiteSchemaNode(index),
      ...(service ? [buildServiceSchemaNode(service, index)] : []),
      {
        "@type": "WebPage",
        "@id": `${canonical}#webpage`,
        url: canonical,
        name: page.title,
        description: page.description,
        inLanguage: "zh-Hant-TW",
        isPartOf: { "@id": `${index.canonical_url}#website` },
        about: serviceUrl ? { "@id": `${serviceUrl}#service` } : { "@id": `${index.canonical_url}#business` },
        mainEntity: { "@id": `${canonical}#howto` },
        breadcrumb: { "@id": `${canonical}#breadcrumb` },
        hasPart: { "@id": `${canonical}#faq` },
        ...(image?.image_url
          ? {
              primaryImageOfPage: {
                "@type": "ImageObject",
                contentUrl: image.image_url,
                caption: supportPageImageAlt(page, image)
              }
            }
          : {}),
        ...optionalSchemaDateModified(page.content_lastmod)
      },
      {
        "@type": "HowTo",
        "@id": `${canonical}#howto`,
        url: canonical,
        mainEntityOfPage: { "@id": `${canonical}#webpage` },
        name: page.h1,
        description: page.summary,
        inLanguage: "zh-Hant-TW",
        // Roughly one minute of checking per step rather than a single hardcoded value.
        totalTime: `PT${Math.max(3, page.steps.length * 2)}M`,
        ...(image?.image_url ? { image: { "@type": "ImageObject", contentUrl: image.image_url } } : {}),
        supply: [
          {
            "@type": "HowToSupply",
            name: "手機照片"
          },
          {
            "@type": "HowToSupply",
            name: "需要判斷的衣物、鞋子、包包或布品"
          }
        ],
        step: page.steps.map((step, index) => ({
          "@type": "HowToStep",
          position: index + 1,
          name: step.name,
          text: step.text
        }))
      },
      {
        "@type": "FAQPage",
        "@id": `${canonical}#faq`,
        url: `${canonical}#faq`,
        isPartOf: { "@id": `${canonical}#webpage` },
        mainEntity: page.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: faq.answer
          }
        }))
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${canonical}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: index.business_profile.name,
            item: index.canonical_url
          },
          {
            "@type": "ListItem",
            position: 2,
            name: page.h1,
            item: canonical
          }
        ]
      }
    ]
  };
}

async function listCalendarDates(root: string, directory: string): Promise<string[]> {
  const dir = join(root, directory);
  try {
    const entries = await readdir(dir);
    return entries
      .filter((entry) => /^\d{4}-\d{2}-\d{2}\.json$/.test(entry))
      .map((entry) => entry.replace(/\.json$/, ""))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function listContentDates(root: string): Promise<string[]> {
  const [privateDates, publicDates] = await Promise.all([
    listCalendarDates(root, "data/content-calendar"),
    listCalendarDates(root, "docs/content-calendar")
  ]);
  return Array.from(new Set([...privateDates, ...publicDates])).sort();
}

function isSlotFullyApproved(approvals: ApprovalLogEntry[], slot: number): boolean {
  return PLATFORM_NAMES.every((platform) => hasApprovedPost(approvals, slot, platform));
}

async function readPrivateDailyContent(date: string, root: string): Promise<DailyContent | undefined> {
  return (
    (await readJsonFile<DailyContent | undefined>(contentCalendarPath(date, root), undefined)) ??
    (await readJsonFile<DailyContent | undefined>(docsContentCalendarPath(date, root), undefined))
  );
}

async function removePublicContentCalendar(date: string, root: string): Promise<void> {
  try {
    await unlink(docsContentCalendarPath(date, root));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

function publicAssetIsFile(
  filePath: string,
  statPublicAsset: (filePath: string) => { isFile(): boolean }
): boolean {
  try {
    const assetStat = statPublicAsset(filePath);
    if (assetStat.isFile()) return true;
    throw new Error(`Public asset path is not a file: ${filePath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function slotWithAvailablePublicMedia(
  date: string,
  slot: DailySlot,
  root: string,
  statPublicAsset: (filePath: string) => { isFile(): boolean }
): DailySlot {
  if (slot.media_type !== "reel") {
    const nonVideoSlot: DailySlot = { ...slot };
    delete nonVideoSlot.local_video_path;
    delete nonVideoSlot.public_video_url;
    return nonVideoSlot;
  }

  const videoPath = join(root, "docs", publicVideoAssetPath(date, slot.slot));
  if (publicAssetIsFile(videoPath, statPublicAsset)) return slot;

  const imagePath = join(root, "docs", publicAssetPath(date, slot.slot));
  if (!publicAssetIsFile(imagePath, statPublicAsset)) {
    throw new Error(`Cannot expose approved reel ${date} slot ${slot.slot}: both video and fallback image are missing.`);
  }

  // A planned Reel is not public video content until its expected MP4 exists on disk.
  const imageSlot: DailySlot = { ...slot, format: "image-post", media_type: "image" };
  delete imageSlot.local_video_path;
  delete imageSlot.public_video_url;
  return imageSlot;
}

async function writeApprovedPublicContentCalendar(
  calendar: DailyContent,
  approvedSlots: DailySlot[],
  root: string
): Promise<void> {
  if (approvedSlots.length === 0) {
    await removePublicContentCalendar(calendar.date, root);
    return;
  }

  await writeJsonAtomic(docsContentCalendarPath(calendar.date, root), {
    ...calendar,
    slots: approvedSlots
  });
}

async function writePostArticlePages(posts: PublicPost[], index: PublicPostIndex, postsRoot: string): Promise<string[]> {
  await mkdir(postsRoot, { recursive: true });
  const expected = new Set([...posts.map((post) => post.article_path.split("/").at(-1)!), "index.html"]);
  const existing = await readdir(postsRoot);
  await Promise.all(
    existing
      .filter((name) => name.endsWith(".html") && !expected.has(name))
      .map((name) => unlink(join(postsRoot, name)))
  );

  const paths = posts.map((post) => join(postsRoot, post.article_path.split("/").at(-1)!));
  await Promise.all(paths.map((path, indexPosition) => writeFile(path, buildPostPageHtml(posts[indexPosition]!, index), "utf8")));
  if (posts.length > 0) {
    const hubPath = join(postsRoot, "index.html");
    await writeFile(hubPath, buildPostsHubHtml(index), "utf8");
    paths.push(hubPath);
  }
  return paths;
}

function slotToPublicPost(
  date: string,
  slot: DailySlot,
  siteBaseUrl: string | undefined,
  imageBaseUrl: string | undefined
): PublicPost {
  const slotImages = imageAssetsForSlot(slot);
  const imagePaths = slotImages.map((asset) => publicCarouselAssetPath(date, slot.slot, asset.slide));
  const imageUrls = imagePaths.map((path) => publicUrl(path, imageBaseUrl ?? siteBaseUrl));
  const carouselItems =
    slot.media_type === "carousel"
      ? slotImages.map((asset, index) => ({
          ...asset,
          public_image_url: imageUrls[index]!
        }))
      : [];
  const imagePath = imagePaths[0] ?? publicAssetPath(date, slot.slot);
  const videoPath = slot.media_type === "reel" ? publicVideoAssetPath(date, slot.slot) : "";
  const calendarPath = `content-calendar/${date}.json`;
  const articlePath = postArticlePath(date, slot.slot);
  const id = postId(date, slot.slot, siteBaseUrl);

  return {
    id,
    date,
    date_published: slotDateTime(date, slot.time),
    slot: slot.slot,
    time: slot.time,
    category: slot.category,
    title: `${date} ${slot.time} ${slot.topic}`,
    topic: slot.topic,
    visual_route: slot.visual_route ?? "",
    traffic_route: slot.traffic_route ?? "",
    content_role: slot.content_role ?? (slot.slot === 1 ? "reach-answer" : "evidence-conversion"),
    search_intent: slot.search_intent ?? "",
    target_queries: slot.target_queries ?? [],
    evidence_type: slot.evidence_type ?? "",
    hashtags: extractHashtags(slot.facebook_caption, slot.instagram_caption),
    platforms: PLATFORM_NAMES,
    in_language: "zh-Hant",
    image_path: imagePath,
    image_url: imageUrls[0] ?? publicUrl(imagePath, imageBaseUrl ?? siteBaseUrl),
    image_paths: imagePaths,
    image_urls: imageUrls,
    carousel_items: carouselItems,
    media_type: slot.media_type === "reel" ? "reel" : slot.media_type === "carousel" ? "carousel" : "image",
    video_path: videoPath,
    video_url: videoPath ? publicUrl(videoPath, imageBaseUrl ?? siteBaseUrl) : "",
    calendar_path: calendarPath,
    calendar_url: publicUrl(calendarPath, siteBaseUrl),
    article_path: articlePath,
    article_url: postArticleUrl({ date, slot: slot.slot }, siteBaseUrl),
    url: id,
    facebook_caption: slot.facebook_caption,
    instagram_caption: slot.instagram_caption
  };
}

function citationReadySummary(index: PublicPostIndex): string {
  const profile = index.business_profile;
  return `${profile.name}位於${profile.address_text}，主要服務台中西屯與青海路二段附近客人，內容涵蓋衣物洗護、鞋包清潔、白鞋清潔與布品收納。客人可先透過 LINE 傳照片，由門市依材質、髒污位置、濕氣與保存狀態做初步判斷；網站不提供未驗證價格、不保證完全洗白或完全去除所有痕跡。${AEO_PLUSH_DOLL_BOUNDARY}${AEO_WHITE_SHOE_GRAY_VS_YELLOW}${AEO_LUGGAGE_WHEELS}${AEO_CURTAIN}${AEO_CARPET}`;
}

function bestSourcePages(index: PublicPostIndex): Array<{ label: string; url: string }> {
  const shoeBagCare = findServiceBySlug("shoe-bag-care");
  const whiteShoeCleaning = findServiceBySlug("white-shoe-cleaning");
  const fabricStorage = findServiceBySlug("fabric-storage");
  const taichungXitunLaundry = findServiceBySlug("taichung-xitun-laundry");
  const priceList = findServiceBySlug(PRICE_LIST_SLUG);
  const photoBeforeLaundry = SUPPORT_PAGE_DEFINITIONS.find((page) => page.slug === "photo-before-laundry");
  const serviceSearchGuide = SUPPORT_PAGE_DEFINITIONS.find((page) => page.slug === "taichung-laundry-service-search");
  const plushDollGuide = SUPPORT_PAGE_DEFINITIONS.find((page) => page.slug === "plush-doll-cleaning");
  const whiteShoeYellowing = SUPPORT_PAGE_DEFINITIONS.find((page) => page.slug === "white-shoe-yellowing");
  const bagHandleGuide = SUPPORT_PAGE_DEFINITIONS.find((page) => page.slug === "bag-handle-cleaning");
  const luggageGuide = SUPPORT_PAGE_DEFINITIONS.find((page) => page.slug === "luggage-wheel-cleaning");
  const curtainGuide = SUPPORT_PAGE_DEFINITIONS.find((page) => page.slug === "curtain-cleaning");
  return [
    { label: "Business profile", url: index.entrypoints.business_profile },
    ...(taichungXitunLaundry ? [{ label: "Local laundry service", url: servicePageUrl(taichungXitunLaundry, index) }] : []),
    ...(priceList ? [{ label: "Taichung laundry price list", url: servicePageUrl(priceList, index) }] : []),
    ...(shoeBagCare ? [{ label: "Shoe and bag care", url: servicePageUrl(shoeBagCare, index) }] : []),
    ...(whiteShoeCleaning ? [{ label: "White shoe cleaning", url: servicePageUrl(whiteShoeCleaning, index) }] : []),
    ...(fabricStorage ? [{ label: "Fabric storage", url: servicePageUrl(fabricStorage, index) }] : []),
    ...(photoBeforeLaundry ? [{ label: "Photo-before-laundry guide", url: supportPageUrl(photoBeforeLaundry, index) }] : []),
    ...(plushDollGuide ? [{ label: "Plush doll wash boundary", url: supportPageUrl(plushDollGuide, index) }] : []),
    ...(whiteShoeYellowing ? [{ label: "White shoe grey vs yellow", url: supportPageUrl(whiteShoeYellowing, index) }] : []),
    ...(bagHandleGuide ? [{ label: "Luggage wheel and bag handle", url: supportPageUrl(bagHandleGuide, index) }] : []),
    ...(luggageGuide ? [{ label: "Luggage wheels", url: supportPageUrl(luggageGuide, index) }] : []),
    ...(curtainGuide ? [{ label: "Curtain cleaning", url: supportPageUrl(curtainGuide, index) }] : []),
    ...(serviceSearchGuide ? [{ label: "Taichung laundry service search guide", url: supportPageUrl(serviceSearchGuide, index) }] : []),
    { label: "Answers", url: index.entrypoints.answers },
    { label: "Search visibility", url: index.entrypoints.search_visibility },
    { label: "AI discovery", url: index.entrypoints.ai_discovery }
  ];
}

function addAnswerSafety<T extends Record<string, unknown>>(answer: T, profile: BusinessProfile): T {
  return {
    ...answer,
    area: typeof answer.area === "string" ? answer.area : profile.address.addressLocality,
    confidence: typeof answer.confidence === "string" ? answer.confidence : ANSWER_CONFIDENCE,
    citation_guidance:
      typeof answer.citation_guidance === "string" ? answer.citation_guidance : ANSWER_CITATION_GUIDANCE,
    do_not_infer: Array.isArray(answer.do_not_infer) ? answer.do_not_infer : [...AI_DO_NOT_INFER_RULES]
  };
}

function buildLlmsText(index: PublicPostIndex): string {
  const profile = index.business_profile;
  const publishedPosts = [...index.posts].reverse();
  const lines = [
    `# ${SITE_NAME}`,
    "",
    `> ${AI_DESCRIPTION}`,
    "",
    "This is the curated AI entry point. Read this file first, then choose the smallest endpoint that fits the task.",
    "",
    "## Citation-ready summary",
    citationReadySummary(index),
    "",
    "## Best source pages",
    ...bestSourcePages(index).map((source) => `- ${source.label}: ${source.url}`),
    "",
    "## Do not infer",
    ...AI_DO_NOT_INFER_RULES.map((rule) => `- ${rule}`),
    "",
    "## Primary Entry Points",
    `- [Latest daily package](${index.entrypoints.latest}): two publishable social slots for the newest content date.`,
    `- [Full structured post feed](${index.entrypoints.social_posts}): all generated post records with captions, images, routes, and hashtags.`,
    `- [Business profile](${index.entrypoints.business_profile}): official NAP, social links, map identifiers, service topics, and verification status.`,
    `- [Services JSON](${index.entrypoints.services}): service-page records with answer summaries, case stories, images, FAQ, and LocalBusiness links.`,
    `- [Answers JSON](${index.entrypoints.answers}): concise AEO/GEO answers for service and local-intent queries.`,
    `- [Geo targets JSON](${index.entrypoints.geo_targets}): local service areas, address anchors, and query-intent map for 台中西屯 searches.`,
    `- [Search visibility JSON](${index.entrypoints.search_visibility}): query clusters, fixed cross-engine prompt panel, mention-versus-citation fields, and 28-day review rules.`,
    `- [LLMS JSONL](${index.entrypoints.llms_jsonl}): line-delimited business, service, answer, and post records for AI ingestion.`,
    ...SERVICE_PAGE_DEFINITIONS.map(
      (service) => `- [${service.name}](${servicePageUrl(service, index)}): service SEO page with NAP, image, FAQ, and structured data.`
    ),
    ...SUPPORT_PAGE_DEFINITIONS.map(
      (page) => `- [${page.h1}](${supportPageUrl(page, index)}): ${page.category} page for answer-engine and local-intent searches.`
    ),
    `- [JSON Feed](${index.entrypoints.feed}): chronological update feed for readers and AI ingestion.`,
    `- [Knowledge graph](${index.entrypoints.knowledge_graph}): Schema.org JSON-LD business, dataset, post, and image entities.`,
    `- [AI discovery index](${index.entrypoints.ai_discovery}): machine-readable map of every AI/SEO endpoint.`,
    `- [Full context](${index.entrypoints.llms_full}): expanded Markdown context with all current posts.`,
    "",
    "## Business Context",
    `- Business: ${profile.name}`,
    `- Google Business Profile name: ${profile.google_business_profile_name}`,
    "- Type: DryCleaningOrLaundry",
    `- Address: ${profile.address_text}`,
    `- Landmark: ${profile.landmark}`,
    `- Google Maps: ${profile.map_url}`,
    `- Google Maps CID: ${profile.google_maps_cid}`,
    `- Google Place ID: ${profile.google_place_id ?? "(not verified)"}`,
    `- Facebook: ${profile.facebook_url}`,
    `- Instagram: ${profile.instagram_url}`,
    `- LINE: ${profile.line_url}`,
    `- Phone: ${profile.telephone_local}`,
    `- LINE / mobile estimates: ${profile.mobile_or_line_local}`,
    `- Opening hours: ${profile.opening_hours_text}`,
    `- Holiday hours rule: ${profile.holiday_hours_rule.default_rule}`,
    `- Canonical URL: ${index.canonical_url}`,
    `- Topics: ${profile.service_topics.join(", ")}`,
    "",
    "## Data Contract",
    "- Cadence: two daily social slots, 11:30 and 20:30 Asia/Taipei.",
    "- Each post includes: date, slot, time, title, topic, content_role, visual_route, traffic_route, search_intent, target_queries, evidence_type, hashtags, media_type, image_url, video_url when applicable, calendar_url, facebook_caption, instagram_caption.",
    "- Use the business profile and structured data as the source of record for phone, hours, map, and social links.",
    "- Do not treat Google Maps CID as Google Place ID. Use google_place_id only when it is non-null.",
    "- Emit concrete holiday opening hours only from owner-verified holiday_hours_rule.overrides.",
    "- Use content_role, visual_route, traffic_route, search_intent, target_queries, evidence_type, and hashtags as observable labels for later performance analysis.",
    "",
    "## Business Data Sources",
    ...profile.source_notes.map((note) => `- ${note}`),
    "",
    "## Published Posts",
    ...(publishedPosts.length > 0 ? publishedPosts : []).flatMap((post) => [
      `- [${post.title}](${postHumanUrl(post, index)})`,
      `  platform targets: ${post.platforms.join(", ")}`,
      `  routes: content_role=${post.content_role}; visual_route=${post.visual_route}; traffic_route=${post.traffic_route}; search_intent=${post.search_intent || "(legacy-unassigned)"}`,
      `  target_queries: ${post.target_queries.length > 0 ? post.target_queries.join(" | ") : "(legacy-unassigned)"}`,
      `  evidence_type: ${post.evidence_type || "(legacy-unassigned)"}`,
      `  hashtags: ${post.hashtags.join(" ") || "(none)"}`,
      `  image: ${post.image_url}`,
      ...(post.video_url ? [`  video: ${post.video_url}`] : []),
      `  calendar: ${post.calendar_url}`
    ]),
    ...(publishedPosts.length > 0 ? [] : ["- (none yet)"]),
    "",
    "## Optional",
    `- [Lite context](${index.entrypoints.llms_lite}): smallest context file for quick checks.`,
    `- [AI sitemap](${index.entrypoints.ai_sitemap}): AI-oriented XML endpoint map.`,
    `- [Robots](${index.entrypoints.robots}): crawler access directives.`,
    ""
  ];

  return `${lines.join("\n")}`;
}

function buildLlmsLiteText(index: PublicPostIndex): string {
  return [
    `# ${SITE_NAME}`,
    "",
    `> ${AI_DESCRIPTION}`,
    "",
    `Canonical: ${index.canonical_url}`,
    `Latest date: ${index.latest_date || "none"}`,
    `Read first: ${index.entrypoints.latest}`,
    `Citation summary: ${citationReadySummary(index)}`,
    "Do not infer: pricing, guaranteed whitening, guaranteed stain or odor removal, review count, rating, or holiday hours.",
    `Full feed: ${index.entrypoints.social_posts}`,
    `Business profile: ${index.entrypoints.business_profile}`,
    `Services: ${index.entrypoints.services}`,
    `Answers: ${index.entrypoints.answers}`,
    `Geo targets: ${index.entrypoints.geo_targets}`,
    `Search visibility: ${index.entrypoints.search_visibility}`,
    `LLMS JSONL: ${index.entrypoints.llms_jsonl}`,
    ...SERVICE_PAGE_DEFINITIONS.map((service) => `${service.name}: ${servicePageUrl(service, index)}`),
    ...SUPPORT_PAGE_DEFINITIONS.map((page) => `${page.h1}: ${supportPageUrl(page, index)}`),
    `Knowledge graph: ${index.entrypoints.knowledge_graph}`,
    `Full context: ${index.entrypoints.llms_full}`,
    ""
  ].join("\n");
}

function buildLlmsFullText(index: PublicPostIndex): string {
  const profile = index.business_profile;
  const businessSchema = buildBusinessSchema(index);
  const lines = [
    `# ${SITE_NAME} - Full Context`,
    "",
    `> ${AI_DESCRIPTION}`,
    "",
    "## Source Of Record",
    `- Canonical URL: ${index.canonical_url}`,
    `- Generated at: ${index.generated_at}`,
    `- Timezone: ${index.timezone}`,
    `- Base URL configured: ${index.base_url_configured ? "yes" : "no"}`,
    "",
    "## Endpoint Map",
    ...entrypointLines(index),
    "",
    "## Business Entity",
    "```json",
    JSON.stringify(businessSchema ?? { note: "Structured data is emitted after PUBLIC_IMAGE_BASE_URL is configured." }, null, 2),
    "```",
    "",
    "## Content Contract",
    "- Posts are generated as operational social content for Facebook and Instagram.",
    "- Captions are Traditional Chinese unless explicitly marked otherwise.",
    "- Image URLs point to static publishable PNG assets.",
    "- Performance labels are preserved as visual_route, traffic_route, search_intent, target_queries, evidence_type, and hashtags.",
    "- Business phone, hours, map, Facebook, and Instagram are emitted from the centralized business profile.",
    "- Business profile data is loaded from data/business-profile.json.",
    "- Google Maps CID is not the same thing as Google Place ID; Google Place ID remains null until verified.",
    "- Concrete holiday hours are emitted only from owner-verified holiday_hours_rule.overrides.",
    "",
    "## Holiday Hours Rule",
    `- ${profile.holiday_hours_rule.default_rule}`,
    `- ${profile.holiday_hours_rule.social_content_rule}`,
    `- ${profile.holiday_hours_rule.schema_rule}`,
    `- Major holidays: ${profile.holiday_hours_rule.major_holidays.join(", ")}`,
    "",
    "## Business Data Sources",
    ...profile.source_notes.map((note) => `- ${note}`),
    "",
    "## Posts",
    ...index.posts.flatMap((post) => [
      `### ${post.title}`,
      "",
      `- id: ${post.id}`,
      `- published local time: ${post.date_published}`,
      `- category: ${post.category}`,
      `- platforms: ${post.platforms.join(", ")}`,
      `- visual_route: ${post.visual_route}`,
      `- traffic_route: ${post.traffic_route}`,
      `- search_intent: ${post.search_intent || "(legacy-unassigned)"}`,
      `- target_queries: ${post.target_queries.join(" | ") || "(legacy-unassigned)"}`,
      `- evidence_type: ${post.evidence_type || "(legacy-unassigned)"}`,
      `- hashtags: ${post.hashtags.join(" ") || "(none)"}`,
      `- image: ${post.image_url}`,
      `- calendar: ${post.calendar_url}`,
      "",
      "Facebook caption:",
      "",
      post.facebook_caption,
      "",
      "Instagram caption:",
      "",
      post.instagram_caption,
      ""
    ]),
    ""
  ];

  return lines.join("\n");
}

function buildRobotsText(index: PublicPostIndex): string {
  const lines = [
    "User-agent: *",
    "Allow: /",
    "",
    "# AI-readable entry points",
    `# llms.txt: ${index.entrypoints.llms}`,
    `# llms-full.txt: ${index.entrypoints.llms_full}`,
    `# ai-discovery.json: ${index.entrypoints.ai_discovery}`,
    ""
  ];
  // `Allow: /` already permits every path under it, so the per-file Allow list was ~120
  // redundant lines that read as posturing rather than configuration. The named agents stay
  // because an explicit group is what opts them out of any future stricter default.
  for (const crawler of AI_CRAWLERS) {
    lines.push(`User-agent: ${crawler}`);
  }
  lines.push("Allow: /", "");
  if (index.base_url_configured) lines.push(`Sitemap: ${index.entrypoints.sitemap}`);
  else lines.push("# Sitemap URL will be absolute after PUBLIC_IMAGE_BASE_URL is configured.");
  return `${lines.join("\n")}\n`;
}

/**
 * Daily social captions run ~235 unique characters against a fixed template, so the post
 * pages are thin near-duplicates of each other. Advertising 38 of them made them ~68% of the
 * sitemap and buried the service and guide pages that actually answer local queries.
 * They stay published and linked for readers, but out of the indexable surface.
 */
function buildSitemapXml(index: PublicPostIndex): string {
  const urls = index.base_url_configured
    ? [
        index.canonical_url,
        knowledgeHubUrl(index),
        ...Object.values(index.entrypoints.service_pages),
        ...Object.values(index.entrypoints.support_pages),
        ...(indexablePostArticles(index).length > 0
          ? [postsHubUrl(index), ...indexablePostArticles(index).map((post) => post.article_url)]
          : [])
      ]
    : [];
  const uniqueUrls = Array.from(new Set(urls));
  const items = uniqueUrls.map((url) => sitemapUrlEntry(url, index)).join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    items,
    "</urlset>",
    ""
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function buildAiSitemapXml(index: PublicPostIndex): string {
  const urls = index.base_url_configured
    ? [
        { loc: index.entrypoints.llms, purpose: "curated-context" },
        { loc: index.entrypoints.llms_lite, purpose: "minimal-context" },
        { loc: index.entrypoints.llms_full, purpose: "full-context" },
        { loc: index.entrypoints.ai_discovery, purpose: "meta-index" },
        { loc: index.entrypoints.knowledge_graph, purpose: "entity-graph" },
        { loc: index.entrypoints.business_profile, purpose: "business-profile" },
        { loc: index.entrypoints.services, purpose: "service-records" },
        { loc: index.entrypoints.answers, purpose: "answer-engine-records" },
        { loc: knowledgeHubUrl(index), purpose: "knowledge-hub" },
        { loc: index.entrypoints.geo_targets, purpose: "geo-target-records" },
        { loc: index.entrypoints.search_visibility, purpose: "search-intent-and-ai-visibility-review" },
        { loc: index.entrypoints.llms_jsonl, purpose: "line-delimited-ai-records" },
        ...SERVICE_PAGE_DEFINITIONS.map((service) => ({
          loc: servicePageUrl(service, index),
          purpose: `service-page-${service.slug}`
        })),
        ...SUPPORT_PAGE_DEFINITIONS.map((page) => ({
          loc: supportPageUrl(page, index),
          purpose: `${page.category}-page-${page.slug}`
        })),
        { loc: index.entrypoints.feed, purpose: "updates-feed" },
        { loc: index.entrypoints.social_posts, purpose: "post-records" },
        { loc: index.entrypoints.latest, purpose: "latest-package" },
        // Only articles that cleared the thickness gate carry index robots; the
        // rest stay out of every sitemap so the two surfaces never contradict.
        ...(indexablePostArticles(index).length > 0
          ? [
              { loc: postsHubUrl(index), purpose: "daily-article-hub" },
              { loc: index.entrypoints.rss, purpose: "rss-feed" },
              ...indexablePostArticles(index).map((post) => ({ loc: post.article_url, purpose: `daily-article-${post.id}` }))
            ]
          : []),
        ...allServiceImages(index).map((image) => ({ loc: image.image_url, purpose: `service-image-${image.source_type}` })),
        ...index.posts.map((post) => ({ loc: post.calendar_url, purpose: `calendar-slot-${post.slot}` })),
        ...index.posts.map((post) => ({ loc: post.image_url, purpose: `image-slot-${post.slot}` }))
      ]
    : [];

  const seen = new Set<string>();
  const items = urls
    .filter((item) => {
      if (seen.has(item.loc)) return false;
      seen.add(item.loc);
      return true;
    })
    .map((item) => {
      // Human sitemap URLs keep truthful lastmod; machine/AI-only assets omit lastmod unless known.
      const lastmod = sitemapLastmodForUrl(item.loc, index);
      const lastmodXml = lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : "";
      return `  <url><loc>${escapeXml(item.loc)}</loc>${lastmodXml}<changefreq>daily</changefreq><!-- ${escapeXml(item.purpose)} --></url>`;
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    items,
    "</urlset>",
    ""
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function buildJsonFeed(index: PublicPostIndex): object {
  return {
    version: "https://jsonfeed.org/version/1.1",
    title: SITE_TITLE,
    home_page_url: index.canonical_url,
    feed_url: index.entrypoints.feed,
    description: SITE_DESCRIPTION,
    language: "zh-Hant",
    authors: [{ name: index.business_profile.name, url: index.canonical_url }],
    items: index.posts.map((post) => ({
      id: post.id,
      url: postHumanUrl(post, index),
      title: post.title,
      date_published: post.date_published,
      content_text: post.facebook_caption,
      summary: post.topic,
      image: post.image_url,
      tags: post.hashtags.map((tag) => tag.replace(/^#/, "")),
      _sixiangjia: {
        slot: post.slot,
        category: post.category,
        visual_route: post.visual_route,
        traffic_route: post.traffic_route,
        content_role: post.content_role,
        search_intent: post.search_intent,
        target_queries: post.target_queries,
        evidence_type: post.evidence_type,
        platforms: post.platforms,
        calendar_url: post.calendar_url
      }
    }))
  };
}

function serviceToPublicRecord(service: ServicePageDefinition, index: PublicPostIndex): object {
  const profile = index.business_profile;
  const image = findServiceImage(service, index);
  return {
    slug: service.slug,
    name: service.name,
    title: service.title,
    description: service.description,
    url: servicePageUrl(service, index),
    canonical_url: servicePageUrl(service, index),
    in_language: "zh-Hant-TW",
    keywords: service.keywords,
    answer_summary: service.answer_summary,
    image_url: image?.image_url ?? "",
    image_path: image?.image_path ?? "",
    image_alt: service.image_alt,
    image_note: service.image_note,
    image_source_type: image?.source_type ?? "",
    image_source_note: service.static_image_source ?? "",
    source_post_id: image?.source_post_id ?? "",
    source_post_topic: image?.topic ?? "",
    case_story: service.case_story,
    case_studies: service.case_studies,
    sections: service.sections,
    ...(service.price_tables ? { price_tables: service.price_tables } : {}),
    faqs: service.faqs,
    related_support_pages: SUPPORT_PAGE_DEFINITIONS.filter((page) => page.service_slug === service.slug).map((page) => ({
      slug: page.slug,
      title: page.title,
      url: supportPageUrl(page, index),
      local_intent: page.local_intent
    })),
    local_business: {
      name: profile.name,
      address_text: profile.address_text,
      telephone: profile.telephone_local,
      line_url: profile.line_url,
      map_url: profile.map_url,
      opening_hours_text: profile.opening_hours_text
    },
    schema_ids: {
      webpage: `${servicePageUrl(service, index)}#webpage`,
      service: `${servicePageUrl(service, index)}#service`,
      faq: `${servicePageUrl(service, index)}#faq`,
      business: `${index.canonical_url}#business`
    }
  };
}

function buildServicesJson(index: PublicPostIndex): object {
  const profile = index.business_profile;
  return {
    schema_version: "2026-07-02",
    generated_at: index.generated_at,
    name: `${profile.name} service pages`,
    description: "Service-level SEO, AEO, and GEO source records for 私享家洗衣店.",
    canonical_url: index.canonical_url,
    business_profile_url: index.entrypoints.business_profile,
    services: SERVICE_PAGE_DEFINITIONS.map((service) => serviceToPublicRecord(service, index))
  };
}

function serviceLocalQueryName(service: ServicePageDefinition): string {
  return service.local_query_name ?? service.name;
}

function serviceAnswerQuestion(service: ServicePageDefinition): string {
  if (service.slug === "taichung-citywide-laundry-pickup") {
    return "台中市全區免費洗衣收送怎麼預約？";
  }
  if (service.slug === "business-bulk-laundry") {
    return "台中店家或公司有大量衣物可以預約收送嗎？";
  }
  if (service.slug === PRICE_LIST_SLUG) {
    return "台中洗衣洗鞋洗包多少錢？";
  }
  return `台中西屯${serviceLocalQueryName(service)}要怎麼判斷？`;
}

function serviceLocalIntent(service: ServicePageDefinition): string {
  if (service.slug === "taichung-citywide-laundry-pickup") {
    return "台中市 洗衣免費收送 LINE 預約";
  }
  if (service.slug === "business-bulk-laundry") {
    return "台中市 店家 公司 大量衣物 送洗 收送";
  }
  if (service.slug === PRICE_LIST_SLUG) {
    return "台中 洗衣 洗鞋 洗包 價格 多少錢";
  }
  return `台中西屯 ${serviceLocalQueryName(service)}`;
}

function buildAnswersJson(index: PublicPostIndex): object {
  const profile = index.business_profile;
  const coreHomeAnswers = homeFaqs(profile).map((faq, faqIndex) => ({
    id: `homepage-core-faq-${String(faqIndex + 1).padStart(2, "0")}`,
    type: "homepage_faq",
    question: faq.question,
    answer: faq.answer,
    source_url: `${index.canonical_url}#homepage-faq`,
    local_intent: faqIndex === 0 ? "台中西屯 私享家洗衣店" : "台中市 洗衣免費收送 LINE 預約"
  }));
  const homeAnswers = [
    {
      id: "homepage-local-laundry-search",
      type: "local_search_answer",
      question: "搜尋台中西屯洗衣店時，私享家洗衣店提供哪些服務？",
      answer: `私享家洗衣店位於${profile.address_text}，提供衣物洗護、鞋包清潔、白鞋清潔、布品收納，以及店家與公司大量衣物送洗諮詢；台中全市可預約免費收送，主要透過 LINE 傳照片與品項清單詢問，再由門市依材質、件數、髒污、濕氣與收納狀態判斷。收送免費不代表清潔免費。`,
      source_url: index.canonical_url,
      local_intent: LOCAL_SEARCH_QUERY_TARGETS.join(", ")
    },
    {
      id: "homepage-object-routing",
      type: "homepage_answer",
      question: "私享家洗衣店可以處理哪些物件？",
      answer: "私享家洗衣店公開站把服務依物件分成白鞋與球鞋、包包與提把包角、外套寢具與厚棉布品，客人可以先依物件選擇對應服務頁。",
      source_url: index.canonical_url,
      local_intent: "台中西屯 洗衣 鞋包 布品收納"
    },
    {
      id: "homepage-situation-routing",
      type: "homepage_answer",
      question: "雨季或換季前要先看什麼？",
      answer: "雨季後先看鞋底、包角與鞋內濕氣；換季前先看外套、寢具、領口、袖口、腋下與收納袋內是否有悶味或潮氣。",
      source_url: index.canonical_url,
      local_intent: "台中西屯 雨季保養 換季收納"
    },
    {
      id: "homepage-how-to-start",
      type: "homepage_answer",
      question: "送洗前要怎麼詢問比較準？",
      answer: "建議先拍整體照片、局部近照、材質位置與最在意的痕跡，再由門市判斷材質、髒污來源與可整理程度。",
      source_url: `${index.canonical_url}#how-it-works`,
      local_intent: "台中西屯 送洗前 詢問"
    }
  ];
  const serviceAnswers = SERVICE_PAGE_DEFINITIONS.flatMap((service) => {
    const url = servicePageUrl(service, index);
    return [
      {
        id: `${service.slug}-summary`,
        type: "service_summary",
        question: serviceAnswerQuestion(service),
        answer: service.answer_summary,
        service: service.name,
        source_url: url,
        local_intent: serviceLocalIntent(service),
        image_url: findServiceImage(service, index)?.image_url ?? ""
      },
      ...service.faqs.map((faq, faqIndex) => ({
        id: `${service.slug}-faq-${String(faqIndex + 1).padStart(2, "0")}`,
        type: "faq",
        question: faq.question,
        answer: faq.answer,
        service: service.name,
        source_url: `${url}#faq`,
        local_intent: serviceLocalIntent(service)
      }))
    ];
  });
  const supportAnswers = SUPPORT_PAGE_DEFINITIONS.flatMap((page) => {
    const url = supportPageUrl(page, index);
    const service = linkedSupportService(page);
    return [
      {
        id: `${page.slug}-summary`,
        type: `${page.category}_summary`,
        question: page.h1,
        answer: page.summary,
        service: service?.name ?? profile.name,
        source_url: url,
        local_intent: page.local_intent,
        keywords: page.keywords
      },
      ...page.faqs.map((faq, faqIndex) => ({
        id: `${page.slug}-faq-${String(faqIndex + 1).padStart(2, "0")}`,
        type: `${page.category}_faq`,
        question: faq.question,
        answer: faq.answer,
        service: service?.name ?? profile.name,
        source_url: `${url}#faq`,
        local_intent: page.local_intent,
        keywords: page.keywords
      }))
    ];
  });

  return {
    schema_version: "2026-07-02",
    generated_at: index.generated_at,
    language: "zh-Hant-TW",
    business: {
      name: profile.name,
      address_text: profile.address_text,
      telephone: profile.telephone_local,
      line_url: profile.line_url,
      map_url: profile.map_url
    },
    answer_engine_optimization: {
      format: "question_answer_records",
      preferred_use: "Use answer as short factual context, then cite source_url.",
      citation_ready_summary: citationReadySummary(index),
      best_source_pages: bestSourcePages(index),
      do_not_infer_rules: [...AI_DO_NOT_INFER_RULES],
      omitted_until_verified: ["google_place_id", "holiday_hours_overrides"]
    },
    answers: [...coreHomeAnswers, ...homeAnswers, ...serviceAnswers, ...supportAnswers].map((answer) =>
      addAnswerSafety(answer, profile)
    )
  };
}

function buildGeoTargetsJson(index: PublicPostIndex): object {
  const profile = index.business_profile;
  const serviceAreas = [
    {
      label: "台中市",
      type: "municipality",
      country: "TW",
      region: profile.address.addressRegion,
      locality: "",
      street: "",
      note: "Confirmed pickup and delivery service area; pickup and delivery are free, while cleaning is billed separately."
    },
    {
      label: "台中西屯",
      type: "district",
      country: "TW",
      region: profile.address.addressRegion,
      locality: profile.address.addressLocality,
      street: "",
      note: "Primary local search area."
    },
    {
      label: "青海路二段",
      type: "street-corridor",
      country: "TW",
      region: profile.address.addressRegion,
      locality: profile.address.addressLocality,
      street: "青海路二段",
      note: "Street-level anchor from business address."
    },
    {
      label: "至善里",
      type: "neighborhood",
      country: "TW",
      region: profile.address.addressRegion,
      locality: profile.address.addressLocality,
      street: profile.address.streetAddress,
      note: "Neighborhood anchor from business address."
    }
  ];
  const localStoreAreas = serviceAreas.filter((area) => area.type !== "municipality");

  return {
    schema_version: "2026-07-02",
    generated_at: index.generated_at,
    business: {
      name: profile.name,
      google_business_profile_name: profile.google_business_profile_name,
      address: profile.address,
      address_text: profile.address_text,
      landmark: profile.landmark,
      map_url: profile.map_url,
      google_maps_cid: profile.google_maps_cid,
      google_place_id: profile.google_place_id,
      telephone: profile.telephone_local,
      line_url: profile.line_url,
      opening_hours_text: profile.opening_hours_text
    },
    service_areas: serviceAreas,
    coverage_boundaries: {
      physical_store: {
        area: profile.address.addressLocality,
        address_text: profile.address_text,
        note: "The physical storefront is in Xitun District."
      },
      pickup_delivery: {
        area: "台中市",
        pickup_delivery_fee: "free",
        cleaning_fee: "quoted separately after item review",
        booking_channel: "LINE",
        note: "Citywide pickup and delivery does not mean cleaning is free."
      }
    },
    coordinates: {
      latitude: 24.1780524,
      longitude: 120.6420289,
      status: "owner-verified-2026-08-21"
    },
    primary_local_queries: LOCAL_SEARCH_QUERY_TARGETS.map((query) => ({
      query,
      business: profile.name,
      area: profile.address.addressLocality,
      url: index.canonical_url,
      answer_summary: SITE_DESCRIPTION
    })),
    local_intents: [
      ...LOCAL_SEARCH_QUERY_TARGETS.map((query) => ({
        query,
        service: "衣物洗護、鞋包清潔、白鞋清潔、布品收納",
        area: profile.address.addressLocality,
        url: index.canonical_url,
        answer_summary: SITE_DESCRIPTION
      })),
      ...SERVICE_PAGE_DEFINITIONS.flatMap((service) =>
        (service.area_served_name === "台中市"
          ? serviceAreas.filter((area) => area.type === "municipality")
          : localStoreAreas
        ).map((area) => ({
          query:
            service.slug === "taichung-citywide-laundry-pickup"
              ? "台中市 洗衣免費收送"
              : service.area_served_name === "台中市"
                ? `台中市 ${serviceLocalQueryName(service)}`
                : `${area.label} ${serviceLocalQueryName(service)}`,
          service: service.name,
          area: area.label,
          url: servicePageUrl(service, index),
          answer_summary: service.answer_summary
        }))
      ),
      ...SUPPORT_PAGE_DEFINITIONS.flatMap((page) =>
        localStoreAreas.map((area) => ({
          query:
            area.label === "台中西屯"
              ? page.local_intent
              : `${area.label} ${page.local_intent.replace(/^台中西屯\s+/u, "")}`,
          service: linkedSupportService(page)?.name ?? page.h1,
          area: area.label,
          url: supportPageUrl(page, index),
          answer_summary: page.summary,
          keywords: page.keywords
        }))
      )
    ],
    discovery_groups: HOME_DISCOVERY_GROUPS.map((group) => ({
      heading: group.heading,
      intro: group.intro,
      items: group.items.map((item) => ({
        label: item.label,
        description: item.description,
        url: homeDiscoveryItemUrl(item, index)
      }))
    }))
  };
}

function buildSearchVisibilityJson(index: PublicPostIndex): object {
  const resolveRoute = (route: string): string => publicUrl(route, index.base_url_configured ? index.base_url : undefined);
  const discoveryPrompts = SEARCH_INTENT_CLUSTERS.flatMap((cluster) =>
    cluster.query_examples.slice(0, 3).map((query, queryIndex) => ({
      id: `${cluster.id}-${String(queryIndex + 1).padStart(2, "0")}`,
      prompt_type: "unbranded-customer-query",
      search_intent: cluster.id,
      prompt: query,
      expected_source_pages: cluster.primary_routes.map(resolveRoute)
    }))
  );

  return {
    schema_version: "2026-07-28",
    generated_at: index.generated_at,
    name: "私享家 SEO / AIO / GEO 搜尋意圖與 28 天能見度規格",
    status: "strategy-and-measurement-contract",
    canonical_url: index.canonical_url,
    strategy_note:
      "這份資料把客戶查詢、可直接回答的內容、第一手證據與轉換量測接在一起；llms.txt、schema 或爬蟲紀錄只代表可讀性，不代表已獲得排名、推薦或引用。",
    content_principles: [
      "同一份內容同時服務人類與搜尋或 AI，不另外製造隱藏文字或 AI 專用薄頁。",
      "先直接回答客戶問題，再提供物件、材質、問題位置、門市判斷、處理界線與可核對來源。",
      "在地頁必須有真實地址、服務範圍、收送方式或門市情境，不用大量地名替換頁。",
      "案例只使用可證明的門市觀察；AI 生成圖要標示來源，不冒充真實客戶成果。",
      "推薦型問題提供選店條件與證據，不自稱最好，也不捏造評論、價格或保證效果。"
    ],
    query_clusters: SEARCH_INTENT_CLUSTERS.map((cluster) => ({
      ...cluster,
      primary_routes: cluster.primary_routes.map(resolveRoute)
    })),
    prompt_panel: {
      rules: AI_VISIBILITY_REVIEW_28D.prompt_rules,
      unbranded_customer_queries: discoveryPrompts,
      brand_verification_queries: [
        {
          id: "brand-facts-01",
          prompt_type: "brand-fact-check",
          prompt: "私享家洗衣店位於哪裡、營業時間是什麼？",
          expected_source_pages: [index.entrypoints.business_profile, index.canonical_url]
        },
        {
          id: "brand-facts-02",
          prompt_type: "brand-fact-check",
          prompt: "私享家洗衣店是否提供台中市全區免費收送？免費包含哪些範圍？",
          expected_source_pages: [
            index.entrypoints.service_pages["taichung-citywide-laundry-pickup"] ?? index.canonical_url,
            index.entrypoints.business_profile
          ]
        },
        {
          id: "brand-facts-03",
          prompt_type: "brand-fact-check",
          prompt: "私享家洗衣店可以處理哪些衣物、鞋包、寢具、娃娃與精品材質？",
          expected_source_pages: [index.entrypoints.services, index.entrypoints.answers]
        }
      ]
    },
    review_28_days: AI_VISIBILITY_REVIEW_28D,
    result_record_template: {
      checked_at: null,
      engine: null,
      prompt_id: null,
      query: null,
      search_intent: null,
      brand_mentioned: null,
      linked_citation: null,
      cited_url: null,
      recommendation_position: null,
      answer_accuracy: null,
      competitor_sources: [],
      ai_referral: null,
      line_click: null,
      qualified_inquiry: null,
      booking_or_revenue: null,
      evidence_url_or_screenshot: null,
      notes: null
    },
    community_practice_sources: COMMUNITY_PRACTICE_SOURCES
  };
}

function buildLlmsJsonl(index: PublicPostIndex): string {
  const profile = index.business_profile;
  const records = [
    {
      type: "business",
      id: `${index.canonical_url}#business`,
      name: profile.name,
      description: SITE_DESCRIPTION,
      url: index.canonical_url,
      address_text: profile.address_text,
      telephone: profile.telephone_local,
      line_url: profile.line_url,
      map_url: profile.map_url,
      opening_hours_text: profile.opening_hours_text
    },
    ...SERVICE_PAGE_DEFINITIONS.map((service) => ({
      type: "service",
      id: `${servicePageUrl(service, index)}#service`,
      ...serviceToPublicRecord(service, index)
    })),
    ...SERVICE_PAGE_DEFINITIONS.flatMap((service) =>
      service.faqs.map((faq, faqIndex) => ({
        type: "answer",
        id: `${servicePageUrl(service, index)}#faq-${faqIndex + 1}`,
        service: service.name,
        question: faq.question,
        answer: faq.answer,
        source_url: servicePageUrl(service, index),
        confidence: ANSWER_CONFIDENCE,
        citation_guidance: ANSWER_CITATION_GUIDANCE,
        do_not_infer: [...AI_DO_NOT_INFER_RULES]
      }))
    ),
    ...SUPPORT_PAGE_DEFINITIONS.map((page) => ({
      type: "support_page",
      id: `${supportPageUrl(page, index)}#webpage`,
      category: page.category,
      title: page.title,
      h1: page.h1,
      summary: page.summary,
      keywords: page.keywords,
      local_intent: page.local_intent,
      source_url: supportPageUrl(page, index)
    })),
    ...SUPPORT_PAGE_DEFINITIONS.flatMap((page) =>
      page.faqs.map((faq, faqIndex) => ({
        type: "support_answer",
        id: `${supportPageUrl(page, index)}#faq-${faqIndex + 1}`,
        category: page.category,
        question: faq.question,
        answer: faq.answer,
        source_url: supportPageUrl(page, index),
        confidence: ANSWER_CONFIDENCE,
        citation_guidance: ANSWER_CITATION_GUIDANCE,
        do_not_infer: [...AI_DO_NOT_INFER_RULES]
      }))
    ),
    ...index.posts.map((post) => ({
      type: "social_post",
      id: post.id,
      title: post.title,
      date_published: post.date_published,
      topic: post.topic,
      visual_route: post.visual_route,
      traffic_route: post.traffic_route,
      content_role: post.content_role,
      search_intent: post.search_intent,
      target_queries: post.target_queries,
      evidence_type: post.evidence_type,
      hashtags: post.hashtags,
      image_url: post.image_url,
      image_urls: post.image_urls,
      carousel_items: post.carousel_items,
      media_type: post.media_type,
      video_url: post.video_url,
      calendar_url: post.calendar_url
    }))
  ];

  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function buildKnowledgeGraph(index: PublicPostIndex): object {
  const business = buildBusinessSchema(index);
  const profile = index.business_profile;
  const businessNode = business ? { ...(business as Record<string, unknown>) } : undefined;
  if (businessNode) delete businessNode["@context"];
  const homepageFaqs = homeFaqs(profile);
  return {
    "@context": "https://schema.org",
    "@graph": [
      businessNode,
      // Same @id as the node inlined on every page — keep them byte-identical.
      buildWebsiteSchemaNode(index),
      {
        "@type": "WebPage",
        "@id": `${index.canonical_url}#webpage`,
        name: SITE_TITLE,
        url: index.canonical_url,
        description: SITE_DESCRIPTION,
        inLanguage: "zh-Hant-TW",
        isPartOf: { "@id": `${index.canonical_url}#website` },
        mainEntity: business ? { "@id": `${index.canonical_url}#business` } : undefined,
        hasPart: { "@id": `${index.canonical_url}#homepage-faq` },
        ...optionalSchemaDateModified(homepageContentLastmod(index))
      },
      {
        "@type": "FAQPage",
        "@id": `${index.canonical_url}#homepage-faq`,
        url: `${index.canonical_url}#homepage-faq`,
        isPartOf: { "@id": `${index.canonical_url}#webpage` },
        about: business ? { "@id": `${index.canonical_url}#business` } : undefined,
        mainEntity: homepageFaqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: faq.answer
          }
        }))
      },
      {
        "@type": "Dataset",
        "@id": `${index.canonical_url}#social-post-dataset`,
        name: `${profile.name} social post dataset`,
        description: SITE_DESCRIPTION,
        url: index.entrypoints.social_posts,
        ...optionalSchemaDateModified(index.latest_date),
        inLanguage: "zh-Hant",
        isPartOf: { "@id": `${index.canonical_url}#website` },
        about: business ? { "@id": `${index.canonical_url}#business` } : undefined
      },
      ...SERVICE_PAGE_DEFINITIONS.flatMap((service) => {
        const canonical = servicePageUrl(service, index);
        const image = findServiceImage(service, index);
        return [
          {
            "@type": "WebPage",
            "@id": `${canonical}#webpage`,
            name: service.title,
            url: canonical,
            description: service.description,
            inLanguage: "zh-Hant-TW",
            isPartOf: { "@id": `${index.canonical_url}#website` },
            about: { "@id": `${canonical}#service` },
            mainEntity: { "@id": `${canonical}#service` },
            hasPart: { "@id": `${canonical}#faq` },
            ...optionalSchemaDateModified(service.content_lastmod),
            ...(image?.image_url
              ? {
                  primaryImageOfPage: {
                    "@type": "ImageObject",
                    contentUrl: image.image_url,
                    caption: service.image_alt
                  }
                }
              : {})
          },
          // Same @id as the service page's node, so it must be emitted identically —
          // differing content under one @id is a cross-document entity conflict.
          buildServiceSchemaNode(service, index),
          {
            "@type": "FAQPage",
            "@id": `${canonical}#faq`,
            url: `${canonical}#faq`,
            isPartOf: { "@id": `${canonical}#webpage` },
            about: { "@id": `${canonical}#service` },
            mainEntity: service.faqs.map((faq) => ({
              "@type": "Question",
              name: faq.question,
              acceptedAnswer: {
                "@type": "Answer",
                text: faq.answer
              }
            }))
          }
        ];
      }),
      ...SUPPORT_PAGE_DEFINITIONS.flatMap((page) => {
        const canonical = supportPageUrl(page, index);
        const service = linkedSupportService(page);
        const serviceUrl = service ? servicePageUrl(service, index) : undefined;
        return [
          {
            "@type": "WebPage",
            "@id": `${canonical}#webpage`,
            name: page.title,
            url: canonical,
            description: page.description,
            inLanguage: "zh-Hant-TW",
            isPartOf: { "@id": `${index.canonical_url}#website` },
            about: serviceUrl ? { "@id": `${serviceUrl}#service` } : { "@id": `${index.canonical_url}#business` },
            mainEntity: { "@id": `${canonical}#howto` },
            hasPart: { "@id": `${canonical}#faq` },
            ...optionalSchemaDateModified(page.content_lastmod),
            keywords: page.keywords
          },
          {
            "@type": "HowTo",
            "@id": `${canonical}#howto`,
            url: canonical,
            mainEntityOfPage: { "@id": `${canonical}#webpage` },
            name: page.h1,
            description: page.summary,
            inLanguage: "zh-Hant-TW",
            step: page.steps.map((step, index) => ({
              "@type": "HowToStep",
              position: index + 1,
              name: step.name,
              text: step.text
            }))
          },
          {
            "@type": "FAQPage",
            "@id": `${canonical}#faq`,
            url: `${canonical}#faq`,
            isPartOf: { "@id": `${canonical}#webpage` },
            mainEntity: page.faqs.map((faq) => ({
              "@type": "Question",
              name: faq.question,
              acceptedAnswer: {
                "@type": "Answer",
                text: faq.answer
              }
            }))
          }
        ];
      }),
      ...index.posts.flatMap((post) => [
        {
          "@type": "SocialMediaPosting",
          "@id": post.id,
          headline: post.title,
          text: post.facebook_caption,
          datePublished: post.date_published,
          inLanguage: post.in_language,
          keywords: post.hashtags,
          image: { "@id": `${post.id}:image` },
          isPartOf: { "@id": `${index.canonical_url}#social-post-dataset` },
          about: business ? { "@id": `${index.canonical_url}#business` } : undefined,
          url: post.url
        },
        {
          "@type": "ImageObject",
          "@id": `${post.id}:image`,
          contentUrl: post.image_url,
          url: post.image_url,
          caption: post.topic,
          inLanguage: post.in_language
        }
      ])
    ].filter(Boolean)
  };
}

function buildPublicSiteCss(): string {
  return `
    :root {
      color-scheme: light;
      --color-ink: #172033;
      --color-muted: #5c6575;
      --color-subtle: #eef2f6;
      --color-line: #d7dee8;
      --color-bg: #f7f8fb;
      --color-surface: #fff;
      --color-brand: #f5c400;
      --color-brand-ink: #2d2600;
      --color-blue: #1f6feb;
      --color-green: #1c7c54;
      --color-red: #b42318;
      --shadow-panel: 0 14px 38px #17203314;
      --radius-card: 8px;
      --radius-control: 6px;
      --max-page: 1180px;
      --font-body: "Microsoft JhengHei UI", "Microsoft JhengHei", "PingFang TC", Arial, sans-serif;
    }
    * { box-sizing: border-box; }
    html { background: var(--color-bg); color: var(--color-ink); font-family: var(--font-body); scroll-behavior: smooth; overflow-x: clip; }
    body { min-width: 320px; margin: 0; overflow-x: clip; }
    body, button, input, textarea { font-family: var(--font-body); }
    img { max-width: 100%; height: auto; display: block; }
    a { color: inherit; }
    main { background: var(--color-bg); }
    address { font-style: normal; }
    .page-shell { max-width: var(--max-page); margin: 0 auto; padding: 0 20px; }
    .section { padding: 56px 0; }
    .section.tight { padding: 34px 0; }
    .section.surface { background: #ffffff; border-top: 1px solid var(--color-line); border-bottom: 1px solid var(--color-line); }
    .section-header { gap: 10px; max-width: 760px; margin-bottom: 24px; display: grid; }
    .section-header p, .section-header .section-copy { margin: 0; }
    .eyebrow { color: var(--color-blue); letter-spacing: 0; font-size: .85rem; font-weight: 800; margin: 0; }
    h1, h2, h3, p { margin-top: 0; }
    h1 { letter-spacing: 0; margin-bottom: 18px; font-size: clamp(2.25rem, 6vw, 4.6rem); line-height: 1.04; }
    h2 { letter-spacing: 0; margin-bottom: 12px; font-size: clamp(1.65rem, 3vw, 2.45rem); line-height: 1.16; }
    h3 { letter-spacing: 0; margin-bottom: 8px; font-size: 1.15rem; line-height: 1.3; }
    h3 a { text-decoration: none; }
    p, li { color: var(--color-muted); line-height: 1.75; }
    .lead { color: #344154; font-size: 1.1rem; line-height: 1.8; }
    .last-updated { color: var(--color-muted); font-size: .88rem; margin: 6px 0 0; }
    .button-row { flex-wrap: wrap; align-items: center; gap: 12px; display: flex; }
    .button {
      background: var(--color-ink);
      border: 1px solid var(--color-ink);
      border-radius: var(--radius-control);
      color: #fff;
      justify-content: center;
      align-items: center;
      min-height: 44px;
      padding: 10px 16px;
      font-weight: 800;
      text-decoration: none;
      display: inline-flex;
    }
    .button.secondary { color: var(--color-ink); background: #fff; }
    .button.brand { background: var(--color-brand); color: var(--color-brand-ink); border-color: #d8ad00; }
    .card-reel-link { width: 100%; margin: 12px 0; display: flex; }
    .grid { gap: 18px; display: grid; }
    .grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .grid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .grid.five { grid-template-columns: repeat(5, minmax(0, 1fr)); }
    .card {
      background: var(--color-surface);
      border: 1px solid var(--color-line);
      border-radius: var(--radius-card);
      box-shadow: var(--shadow-panel);
      padding: 20px;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .card h2 { font-size: 1.35rem; }
    .card p:last-child { margin-bottom: 0; }
    .card ul { margin: 0; padding-left: 18px; }
    .card + .card { margin-top: 14px; }
    .muted { color: var(--color-muted); }
    .site-header { border-bottom: 1px solid var(--color-line); z-index: 30; background: #fffffff5; position: sticky; top: 0; }
    .site-header__inner {
      max-width: var(--max-page);
      justify-content: space-between;
      align-items: center;
      gap: 18px;
      min-height: 76px;
      margin: 0 auto;
      padding: 0 20px;
      display: flex;
    }
    .brand-link { letter-spacing: 0; align-items: center; gap: 10px; font-weight: 900; text-decoration: none; display: inline-flex; white-space: nowrap; flex: none; }
    .brand-mark {
      background: var(--color-brand);
      border: 2px solid var(--color-ink);
      color: var(--color-ink);
      border-radius: 6px;
      justify-content: center;
      align-items: center;
      width: 36px;
      height: 36px;
      font-weight: 900;
      display: inline-flex;
    }
    .site-header .nav { flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 6px; display: flex; }
    .site-header .nav a { border-radius: var(--radius-control); color: #293446; padding: 8px 10px; font-size: .9rem; font-weight: 700; text-decoration: none; }
    .site-header .nav a:hover { background: var(--color-subtle); }
    .home-hero { border-bottom: 1px solid var(--color-line); background: #fff; overflow: hidden; }
    .home-hero__grid { grid-template-columns: minmax(0, .92fr) minmax(480px, 1.08fr); align-items: stretch; min-height: 540px; display: grid; }
    .home-hero__content { align-self: center; max-width: 560px; padding: 64px 38px 64px 0; }
    .home-hero__content h1 { color: #101a2b; margin-bottom: 16px; font-size: clamp(2.7rem, 5vw, 4.45rem); }
    .home-hero__actions { flex-wrap: wrap; gap: 14px; margin-top: 26px; display: flex; }
    .home-hero__actions .button { min-width: 178px; }
    .home-hero__photo-action { color: var(--color-brand-ink); background: #fff; border-color: #d8ad00; }
    .home-hero__photo-action:hover, .home-hero__photo-action:focus-visible { background: #fff7cf; }
    .home-hero__note { border-left: 3px solid var(--color-brand); margin: 24px 0 0; padding-left: 12px; font-size: .94rem; }
    .home-hero__note a { color: var(--color-blue); font-weight: 700; text-decoration: none; }
    .home-hero__visual { min-height: 540px; position: relative; }
    .home-hero__visual > picture:first-child, .home-hero__visual > picture:first-child img, .home-hero__visual > img:first-child {
      object-fit: cover;
      object-position: 62% center;
      width: 100%;
      height: 100%;
    }
    .home-hero__visual > picture:first-child { display: block; position: absolute; inset: 0; }
    .home-hero__app, .home-hero__app img {
      box-shadow: var(--shadow-panel);
      background: #fff;
      border: 1px solid #dce5f0;
      max-width: 270px;
      height: auto;
    }
    .home-hero__app { position: absolute; bottom: 28px; left: -54px; }
    .home-hero__app img { box-shadow: none; border: 0; }
    .home-flow { background: #eef5ff; border-bottom: 1px solid #d9e5f4; padding: 26px 0 18px; }
    .home-flow__list { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; margin: 0; padding: 0; list-style: none; display: grid; }
    .home-flow__list li { border-right: 1px solid #cbd9ea; grid-template-columns: auto 1fr; align-items: center; gap: 2px 10px; padding-right: 18px; display: grid; }
    .home-flow__list li:last-child { border-right: 0; }
    .home-flow__list span {
      background: var(--color-blue);
      color: #fff;
      border-radius: 50%;
      grid-row: span 2;
      justify-content: center;
      align-items: center;
      width: 28px;
      height: 28px;
      font-size: .84rem;
      font-weight: 900;
      display: inline-flex;
    }
    .home-flow__list strong { color: var(--color-ink); font-size: 1rem; }
    .home-flow__list small { color: var(--color-muted); font-size: .84rem; }
    .home-office-callout {
      border-radius: var(--radius-card);
      background: #fff;
      border: 1px solid #d5e0ee;
      justify-content: center;
      align-items: center;
      gap: 10px 16px;
      max-width: 680px;
      margin: 20px auto 0;
      padding: 13px 18px;
      text-decoration: none;
      display: flex;
    }
    .home-office-callout strong { color: #174a94; }
    .home-office-callout span { color: var(--color-muted); font-size: .9rem; }
    .breadcrumb { color: var(--color-muted); flex-wrap: wrap; gap: 8px; padding: 18px 0 0; font-size: .92rem; display: flex; max-width: var(--max-page); margin: 0 auto; padding-left: 20px; padding-right: 20px; }
    .breadcrumb ol { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .breadcrumb li + li::before { content: "/"; margin-right: 8px; color: var(--color-line); }
    .breadcrumb a { color: var(--color-blue); text-decoration: none; }
    .product-card, .solution-card, .article-card, .post-tile { gap: 12px; display: grid; align-content: start; }
    .product-card__meta, .article-meta { color: var(--color-muted); font-size: .9rem; }
    .card-link { color: var(--color-blue); font-weight: 800; text-decoration: none; }
    .link-row { display: flex; flex-wrap: wrap; gap: 8px 16px; }
    .link-row a { color: var(--color-blue); font-weight: 800; text-decoration: none; }
    .service-card-image, .article-card img, .post-tile picture img, .post-tile > a > img {
      width: 100%;
      aspect-ratio: 16 / 10;
      object-fit: cover;
      border-radius: var(--radius-control);
      border: 1px solid var(--color-line);
    }
    .post-tile picture, .post-tile > a { display: block; }
    .post-tile > a { text-decoration: none; }
    .post-caption { white-space: pre-line; }
    .caption-details summary { cursor: pointer; color: var(--color-blue); font-weight: 800; }
    .caption-details p { margin: 10px 0 0; font-size: .94rem; }
    .post-archive { margin-top: 24px; border-top: 1px solid var(--color-line); padding-top: 18px; }
    .post-archive summary { cursor: pointer; font-weight: 800; color: var(--color-ink); }
    .post-archive .grid { margin-top: 18px; }
    .answer-block, .answer-box { border-radius: var(--radius-card); background: #f0f7ff; border: 1px solid #b9d8ff; padding: 18px; }
    .answer-block strong, .answer-box strong, .answer-box .eyebrow { color: var(--color-blue); margin-bottom: 6px; display: block; }
    .hero-visual > .eyebrow { margin-bottom: -8px; }
    .hero-visual > .muted { font-size: .9rem; margin: 0; }
    .answer-block p:last-child, .answer-box p:last-child { margin-bottom: 0; }
    .answer-box ul { margin: 0; padding-left: 18px; }
    .answer-box + .answer-box { margin-top: 14px; }
    .answer-box h3 { font-size: 1.02rem; margin: 12px 0 4px; }
    .hero-visual picture, .hero-visual img, .service-photo picture, .service-photo img, .service-photo video {
      width: 100%;
      border-radius: var(--radius-card);
      border: 1px solid var(--color-line);
      box-shadow: var(--shadow-panel);
      object-fit: cover;
    }
    .service-photo video { width: min(100%, 430px); aspect-ratio: 9 / 16; margin: 0 auto; background: #000; }
    .service-photo figcaption, .hero-visual figcaption { color: var(--color-muted); font-size: .9rem; margin-top: 10px; }
    figure { margin: 0; }
    .chip-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 0; }
    .chip {
      display: inline-flex;
      align-items: center;
      min-height: 30px;
      padding: 4px 10px;
      border: 1px solid var(--color-line);
      border-radius: 999px;
      background: #fff;
      color: var(--color-muted);
      font-size: .86rem;
      font-weight: 700;
      text-decoration: none;
    }
    .page-hero { background: #fff; border-bottom: 1px solid var(--color-line); }
    .page-hero .grid.two { align-items: start; }
    .hero-copy .button-row { margin-top: 18px; }
    .hero-visual { display: grid; gap: 18px; align-content: start; }
    .cta-band { background: var(--color-ink); color: #fff; padding: 38px 0; }
    .cta-band h2 { color: #fff; }
    .cta-band p { color: #d7dee8; }
    .site-footer { color: #fff; background: #111827; padding: 40px 0; }
    .site-footer h2, .site-footer h3 { color: #fff; }
    .site-footer p, .site-footer a { color: #d1d5db; }
    .site-footer__grid { grid-template-columns: 1.1fr .9fr; gap: 24px; display: grid; }
    .footer-links { flex-wrap: wrap; gap: 10px 18px; display: flex; }
    .footer-links a { text-decoration: none; }
    .mobile-sticky-cta {
      border-top: 1px solid var(--color-line);
      z-index: 25;
      background: #fff;
      gap: 8px;
      padding: 10px;
      display: none;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
    }
    .mobile-sticky-cta .button { flex: 1; min-height: 42px; }
    .price-table-card, .table-wrap { overflow-x: auto; }
    .price-table, .comparison-table { border-collapse: collapse; width: 100%; margin-top: 12px; background: #fff; }
    .price-table th, .price-table td, .comparison-table th, .comparison-table td { border-bottom: 1px solid var(--color-line); text-align: left; padding: 10px 12px; vertical-align: top; }
    .price-table thead th, .comparison-table thead th { color: var(--color-muted); letter-spacing: .02em; font-size: .85rem; }
    .price-table tbody tr:last-child td, .comparison-table tbody tr:last-child td { border-bottom: none; }
    .comparison-table caption { text-align: left; font-weight: 800; padding: 0 0 8px; color: var(--color-ink); }
    .article-body { background: var(--color-surface); border-top: 1px solid var(--color-line); padding: 36px 0; }
    .article-body .content { max-width: 780px; margin: 0 auto; padding: 0 20px; }
    .article-body .content a { overflow-wrap: anywhere; word-break: break-word; }
    .article-body .content h2 { border-top: 1px solid var(--color-line); margin-top: 30px; padding-top: 26px; }
    .article-body .content blockquote { border-left: 4px solid var(--color-brand); background: #fff8d8; margin: 24px 0; padding: 18px; }
    .article-faq { margin-top: 34px; }
    .article-faq__list { gap: 12px; display: grid; }
    .article-faq__item { border-top: 1px solid var(--color-line); padding-top: 14px; }
    .article-faq__item h3 { color: var(--color-ink); margin-bottom: 6px; font-size: 1.02rem; }
    .article-faq__item p { margin-bottom: 0; }
    .machine-details { border-top: 1px solid var(--color-line); border-bottom: 1px solid var(--color-line); padding: 18px 0; }
    .machine-details summary { cursor: pointer; font-weight: 800; color: var(--color-ink); }
    .machine-details p { margin: 12px 0; }
    .machine-details nav { display: flex; flex-wrap: wrap; gap: 6px 16px; }
    .machine-details nav a { color: var(--color-blue); font-size: .9rem; text-decoration: none; }
    @media (max-width: 1300px) and (min-width: 901px) {
      .site-header__inner { flex-direction: column; align-items: flex-start; gap: 4px; padding-top: 10px; padding-bottom: 10px; }
      .site-header .nav { justify-content: flex-start; width: 100%; }
      .site-header .nav a { padding: 6px 8px; font-size: .88rem; }
    }
    @media (max-width: 900px) {
      .site-header__inner { flex-direction: column; align-items: flex-start; padding: 12px 20px; }
      .site-header .nav { justify-content: flex-start; flex-wrap: nowrap; width: 100%; max-width: 100%; padding-bottom: 2px; overflow-x: auto; }
      .site-header .nav a { flex: none; }
      .site-footer__grid, .home-hero__grid { grid-template-columns: 1fr; }
      .home-hero__content { padding: 44px 0 28px; }
      .home-hero__actions .button { width: 100%; }
      .home-hero__visual { min-height: 280px; }
      .home-hero__visual > picture:first-child { position: relative; }
      .home-hero__app { max-width: 160px; bottom: 12px; left: 12px; }
      .home-hero__app img { max-width: 100%; }
      .home-flow__list { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .home-flow__list li:nth-child(2) { border-right: 0; }
      .home-flow__list li:nth-child(-n+2) { border-bottom: 1px solid #cbd9ea; padding-bottom: 12px; }
      .home-office-callout { flex-direction: column; align-items: flex-start; }
      .mobile-sticky-cta { width: 100dvw; max-width: 100dvw; display: flex; right: auto; }
      body { padding-bottom: 64px; }
      .grid.two, .grid.three, .grid.four, .grid.five { grid-template-columns: 1fr; }
      .section { padding: 40px 0; }
      h1, h2, h3, p, li { overflow-wrap: anywhere; }
    }
  `;
}

function homepagePostGroups(posts: PublicPost[]): {
  recentPosts: PublicPost[];
  archivePosts: PublicPost[];
  recentDateCount: number;
  archiveDateCount: number;
} {
  const dates = Array.from(new Set(posts.map((post) => post.date)));
  const recentDates = new Set(dates.slice(-HOME_EXPANDED_RECENT_DAYS));
  const newestFirst = [...posts].reverse();
  const recentPosts = newestFirst.filter((post) => recentDates.has(post.date));
  const archivePosts = newestFirst.filter((post) => !recentDates.has(post.date));

  return {
    recentPosts,
    archivePosts,
    recentDateCount: recentDates.size,
    archiveDateCount: new Set(archivePosts.map((post) => post.date)).size
  };
}

/** Real pixel size for a post's ImageObject, so schema matches the rendered <img>. */
function postImageSchemaSize(post: PublicPost): { width: number; height: number } | Record<string, never> {
  if (!post.image_path) return {};
  const { width, height } = imagePixelSize(post.image_path, POST_IMAGE_FALLBACK_SIZE);
  return { width, height };
}

function captionPreview(caption: string): string {
  return caption
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find(Boolean) ?? caption.trim();
}

function buildPostPageSchema(post: PublicPost, index: PublicPostIndex): object | undefined {
  if (!index.base_url_configured) return undefined;
  const businessNode = buildBusinessSchemaNode(index);
  if (!businessNode) return undefined;
  const profile = index.business_profile;
  const description = captionPreview(post.facebook_caption).slice(0, 180);
  const graph: object[] = [
    businessNode,
    buildWebsiteSchemaNode(index),
    {
      "@type": "BlogPosting",
      "@id": `${post.article_url}#article`,
      url: post.article_url,
      mainEntityOfPage: { "@id": `${post.article_url}#webpage` },
      headline: post.topic,
      description,
      datePublished: post.date_published,
      ...optionalSchemaDateModified(post.date_published ?? post.date),
      inLanguage: "zh-Hant-TW",
      author: { "@id": `${index.canonical_url}#business` },
      publisher: { "@id": `${index.canonical_url}#business` },
      isPartOf: { "@id": `${index.canonical_url}#website` },
      image: { "@id": `${post.article_url}#image` },
      ...(post.video_url ? { video: { "@id": `${post.article_url}#video` } } : {}),
      about: { "@id": `${index.canonical_url}#business` },
      keywords: Array.from(
        new Set([...post.target_queries, ...post.hashtags.map((tag) => tag.replace(/^#/, ""))])
      ),
      articleSection: careContextFor(post.topic).family,
      wordCount: renderPostArticle(post, index).visibleChars
    },
    {
      "@type": "FAQPage",
      "@id": `${post.article_url}#faq`,
      isPartOf: { "@id": `${post.article_url}#webpage` },
      mainEntity: postArticleFaqs(post).map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer }
      }))
    },
    {
      "@type": "WebPage",
      "@id": `${post.article_url}#webpage`,
      url: post.article_url,
      name: post.topic,
      description,
      inLanguage: "zh-Hant-TW",
      isPartOf: { "@id": `${index.canonical_url}#website` },
      about: { "@id": `${index.canonical_url}#business` },
      mainEntity: { "@id": `${post.article_url}#article` },
      breadcrumb: { "@id": `${post.article_url}#breadcrumb` },
      primaryImageOfPage: { "@id": `${post.article_url}#image` }
    },
    {
      "@type": "ImageObject",
      "@id": `${post.article_url}#image`,
      contentUrl: post.image_url,
      ...postImageSchemaSize(post),
      caption: `${post.topic} - ${profile.name}`
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${post.article_url}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: profile.name, item: index.canonical_url },
        { "@type": "ListItem", position: 2, name: "每日洗護紀錄", item: postsHubUrl(index) },
        { "@type": "ListItem", position: 3, name: post.topic, item: post.article_url }
      ]
    }
  ];
  if (post.video_url) {
    graph.push({
      "@type": "VideoObject",
      "@id": `${post.article_url}#video`,
      name: post.topic,
      description,
      thumbnailUrl: post.image_url,
      contentUrl: post.video_url,
      uploadDate: post.date_published,
      ...(readMp4Duration(post.video_path) ? { duration: readMp4Duration(post.video_path) } : {}),
      inLanguage: "zh-Hant-TW"
    });
  }

  return {
    "@context": "https://schema.org",
    "@graph": graph
  };
}

// Post pages carried only the caption -- about 470 characters of text -- and
// every one of them linked to the same generic service page. 57 of the site's
// 78 URLs are post pages, so that thinness was the site's dominant quality
// signal and the most likely reason Google reports "crawled, currently not
// indexed". Each post now carries the inspection points for its own object
// family plus links to the matching service and guide, which both deepens the
// page and gives crawlers real paths between related pages.
interface CareContext {
  family: string;
  serviceSlug: string;
  guideSlugs: string[];
  checkpoints: string[];
  faqs: Array<{ question: string; answer: string }>;
}

const CARE_CONTEXTS: Array<{ match: RegExp; context: CareContext }> = [
  {
    match: /白鞋|球鞋|帆布鞋|運動鞋/,
    context: {
      family: "白鞋與球鞋",
      serviceSlug: "white-shoe-cleaning",
      guideSlugs: ["white-shoe-yellowing", "rainy-shoe-care"],
      checkpoints: [
        "鞋面材質先分清楚:皮革、布面、網布或合成材質,能用的清潔方式完全不同。",
        "膠邊看是髒污還是氧化。氧化泛黃不是刷得掉的髒,硬刷只會讓膠面起毛。",
        "鞋內與鞋墊的濕氣常被忽略,悶味多半來自這裡,不是鞋面。"
      ],
      faqs: [
        {
          question: "鞋子可以自己先刷再送洗嗎?",
          answer: "不確定材質時不建議。強力清潔劑和硬刷會造成褪色、起毛或留下刷痕,反而讓後續處理變難。"
        },
        {
          question: "泛黃一定能洗回全白嗎?",
          answer: "表面髒污機會較高;膠邊氧化或材質變色只能降低痕跡,門市會先說明能處理到什麼程度。"
        }
      ]
    }
  },
  {
    match: /包|背包|提把|包角|化妝包|行李箱|行李/,
    context: {
      family: "包款與提把",
      serviceSlug: "shoe-bag-care",
      guideSlugs: ["luggage-wheel-cleaning", "bag-handle-cleaning"],
      checkpoints: [
        "提把與包角是最先磨損的兩個位置,油痕和磨白的處理方向不一樣。",
        "內裡常有粉塵、筆漬或食物殘留,外觀乾淨不代表內袋乾淨。",
        "五金氧化與縫線鬆脫要在清潔前確認,清洗過程可能讓既有損傷擴大。"
      ],
      faqs: [
        {
          question: "包包清潔會不會讓皮面變色?",
          answer: "會先依材質判斷。真皮、合成皮與麂皮的清潔和補色方式不同,無法保證完全均勻時會先告知。"
        },
        {
          question: "內裡的味道洗得掉嗎?",
          answer: "多數可明顯改善。味道來源是濕氣或殘留物,要先找出來源才處理,單純噴香只會蓋住。"
        }
      ]
    }
  },
  {
    match: /西裝|襯衫|外套|大衣|領口|肩線/,
    context: {
      family: "襯衫與西裝",
      serviceSlug: "taichung-xitun-laundry",
      guideSlugs: ["shirt-suit-dry-cleaning", "dry-cleaning-guide"],
      checkpoints: [
        "肩線與領片有沒有塌,比表面髒不髒更決定衣服還能不能穿出門。",
        "領口與袖口的油光屬於油性髒污,和汗味的處理方式不同。",
        "洗標決定乾洗或水洗;有墊肩襯裡的外套水洗容易縮皺變形。"
      ],
      faqs: [
        {
          question: "西裝多久乾洗一次?",
          answer: "常穿的每季一到兩次即可。穿一次洗一次反而傷纖維,平時掛通風處、局部除味就好。"
        },
        {
          question: "襯衫領口的黃漬洗得掉嗎?",
          answer: "多數能明顯改善。長期累積的皮脂氧化較難完全還原,處理前會先說明界線。"
        }
      ]
    }
  },
  {
    match: /羽絨|棉被|寢具|床組|被單|枕|窗簾|地毯|沙發|布品|收納/,
    context: {
      family: "寢具與布品",
      serviceSlug: "fabric-storage",
      guideSlugs: ["bedding-duvet-cleaning", "curtain-cleaning", "carpet-cleaning"],
      checkpoints: [
        "收納前一定要完全乾燥,沒乾透就壓縮會悶出味道也會失去蓬鬆度。",
        "黃斑多半是汗漬或濕氣長期作用,越早處理越容易淡化。",
        "體積大的布品要先確認車線與破口,清洗時破口會擴大。"
      ],
      faqs: [
        {
          question: "棉被多久洗一次?",
          answer: "一般建議每年換季收納前清洗一次;有汗味、潮味或黃斑時就不要再等。"
        },
        {
          question: "體積太大不好帶怎麼辦?",
          answer: "台中市全區可預約免費收送,到府收件即可,不用自己搬。"
        }
      ]
    }
  },
  {
    match: /娃娃|絨毛|玩偶/,
    context: {
      family: "絨毛娃娃",
      serviceSlug: "taichung-xitun-laundry",
      guideSlugs: ["plush-doll-cleaning", "photo-before-laundry"],
      checkpoints: [
        "先確認填充材質與是否含電子零件,音樂盒與發聲器要先取出。",
        "縫線與眼鼻配件鬆動時,清洗過程可能脫落,清潔前要先固定。",
        "毛料清洗後需要梳理才會回復蓬鬆,不梳會結塊。"
      ],
      faqs: [
        {
          question: "娃娃洗完會不會變形?",
          answer: "會先依填充材質選擇方式。棉花與PP棉的耐受度不同,處理前會說明可能的蓬鬆度變化。"
        },
        {
          question: "小孩每天抱的娃娃可以洗嗎?",
          answer: "可以,而且建議定期清潔。清洗會處理塵蟎與汗漬,取回前會確認完全乾燥。"
        }
      ]
    }
  }
];

const DEFAULT_CARE_CONTEXT: CareContext = {
  family: "日常衣物",
  serviceSlug: "taichung-xitun-laundry",
  guideSlugs: ["photo-before-laundry", "taichung-laundry-service-search"],
  checkpoints: [
    "先看洗標,材質決定能用的方式,看不懂符號就拍照詢問。",
    "把最在意的位置單獨拍一張,整體照看不出局部問題。",
    "不要先自行強洗或用未知藥劑,處理過的痕跡會讓後續判斷變難。"
  ],
  faqs: [
    {
      question: "送洗前需要先自己清嗎?",
      answer: "不需要,也不建議。保留原始狀態門市才判斷得準,先處理過反而可能定色或留下痕跡。"
    },
    {
      question: "怎麼估價?",
      answer: "價目是公開的：例如一般運動鞋 $250、襯衫 $70、雙人棉被 $500、名牌包 $1500 起；乾洗柔洗與特殊狀況另計，以實際報價為主。LINE 傳照片（0968327653）可先確認，台中市全區免費收送。"
    }
  ]
};

function careContextFor(topic: string): CareContext {
  return CARE_CONTEXTS.find((entry) => entry.match.test(topic))?.context ?? DEFAULT_CARE_CONTEXT;
}

// Post pages used to carry only the caption and were kept out of the indexable
// surface as thin near-duplicates. The iprinter daily pages that do get indexed
// are ~2,100 visible characters with summary, checklist, table, next step, FAQ
// and related links. Each approved post is now rendered as that kind of article
// and is only advertised (index robots, sitemap, RSS, hub) when it clears a
// fail-closed thickness gate measured on the rendered HTML itself.
const POST_ARTICLE_MIN_VISIBLE_CHARS = 1200;
const POST_ARTICLE_MIN_CAPTION_CHARS = 80;
const POSTS_HUB_PATH = "posts/";
const POSTS_HUB_TEMPLATE_LASTMOD = "2026-09-04";
const POSTS_HUB_TITLE = "每日洗護紀錄總覽｜私享家洗衣店";
const POSTS_HUB_DESCRIPTION =
  "私享家洗衣店每天一則門市洗護紀錄：鞋包、白鞋、衣物寢具的檢查重點、處理界線與台中免費收送下一步，依日期排列。";
const POST_ARTICLE_PICKUP_FAQ = {
  question: "這類物件可以約台中免費收送嗎？",
  answer:
    "可以。台中市全區可預約免費收送，收送本身免費、沒有最低消費；清潔與洗護費依物件狀態另計。先用 LINE 傳整體與近照，門市會先說能整理到什麼程度，再約收送或到店。"
};

interface PostArticleRender {
  mainHtml: string;
  visibleChars: number;
  indexable: boolean;
  reasons: string[];
  faqs: Array<{ question: string; answer: string }>;
  articleNumber: number;
}

const postArticleRenderCache = new WeakMap<PublicPostIndex, Map<string, PostArticleRender>>();

function visibleTextLength(html: string): number {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/gu, "").length;
}

function postsHubUrl(index: PublicPostIndex): string {
  return index.base_url_configured ? `${index.base_url}/${POSTS_HUB_PATH}` : `${POSTS_HUB_PATH}index.html`;
}

function postsHubHref(index: PublicPostIndex, fromNestedPage = false): string {
  if (index.base_url_configured) return postsHubUrl(index);
  return fromNestedPage ? `../${POSTS_HUB_PATH}index.html` : `${POSTS_HUB_PATH}index.html`;
}

function sortedArticlePosts(index: PublicPostIndex): PublicPost[] {
  return [...index.article_posts].sort((a, b) => `${a.date}-${a.slot}`.localeCompare(`${b.date}-${b.slot}`));
}

function articleNumberFor(post: PublicPost, index: PublicPostIndex): number {
  return sortedArticlePosts(index).findIndex((item) => item.id === post.id) + 1;
}

function postArticleFaqs(post: PublicPost): Array<{ question: string; answer: string }> {
  const care = careContextFor(post.topic);
  return [...care.faqs, POST_ARTICLE_PICKUP_FAQ];
}

function postRobotsContent(indexable: boolean): string {
  return indexable ? "index, follow, max-image-preview:large" : "noindex, follow, max-image-preview:large";
}

function renderPostArticle(post: PublicPost, index: PublicPostIndex): PostArticleRender {
  let cache = postArticleRenderCache.get(index);
  if (!cache) {
    cache = new Map();
    postArticleRenderCache.set(index, cache);
  }
  const cached = cache.get(post.id);
  if (cached) return cached;

  const profile = index.business_profile;
  const postSource = { section: "posts" as const, date: post.date, slot: post.slot };
  const lineCta = trackedLineUrl(index, { ...postSource, placement: "cta" });
  const lineFooter = trackedLineUrl(index, { ...postSource, placement: "footer" });
  const care = careContextFor(post.topic);
  const service = findServiceBySlug(care.serviceSlug) ?? SERVICE_PAGE_DEFINITIONS[0];
  const serviceHref = service ? servicePageUrl(service, index) : index.canonical_url;
  const pickupService = findServiceBySlug("taichung-citywide-laundry-pickup");
  const homeHref = index.base_url_configured ? index.canonical_url : "../index.html";
  const hubHref = postsHubHref(index, true);
  const articleNumber = articleNumberFor(post, index);
  const faqs = postArticleFaqs(post);
  const relatedPosts = sortedArticlePosts(index)
    .filter((item) => item.id !== post.id && careContextFor(item.topic).family === care.family)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 3);
  const relatedGuides = care.guideSlugs
    .map((slug) => SUPPORT_PAGE_DEFINITIONS.find((page) => page.slug === slug))
    .filter((page): page is SupportPageDefinition => Boolean(page));
  const imageSrc = visibleImageSrc(post, index);
  const description = captionPreview(post.facebook_caption).slice(0, 180);
  const captionParagraphs = post.facebook_caption
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0 && !/^#/u.test(paragraph));
  const leadParagraph = captionParagraphs[0] ?? description;
  const hashtags = post.hashtags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("\n");
  const targetQueries = post.target_queries.map((query) => `<span class="chip">${escapeHtml(query)}</span>`).join("\n");
  const caseRows = (service?.case_studies ?? [])
    .slice(0, 3)
    .map(
      (study) => `<tr>
                <td>${escapeHtml(study.object)}</td>
                <td>${escapeHtml(study.material)}</td>
                <td>${escapeHtml(study.inspection)}</td>
                <td>${escapeHtml(study.boundary)}</td>
              </tr>`
    )
    .join("\n");
  const summaryItems = [
    `這則紀錄的物件族：${care.family}。門市先看材質與痕跡位置，再說能整理到什麼程度。`,
    post.search_intent ? `這篇在回答的問題類型：${post.search_intent}。` : "",
    post.target_queries.length > 0 ? `常見搜尋：${post.target_queries.join("、")}。` : "",
    service ? `對應服務：${service.name}。${service.answer_summary}` : "",
    "下一步：拍整體、近照與最在意的痕跡傳 LINE，或約台中市免費收送。"
  ].filter(Boolean);

  const mainHtml = `<main>
      <nav class="breadcrumb" aria-label="麵包屑">
        <ol>
          <li><a href="${escapeHtml(homeHref)}">${escapeHtml(profile.name)}</a></li>
          <li><a href="${escapeHtml(hubHref)}">每日洗護紀錄</a></li>
          <li aria-current="page">${escapeHtml(post.topic)}</li>
        </ol>
      </nav>
      <section class="section page-hero">
        <div class="page-shell grid two">
        <div class="hero-copy">
          <span class="eyebrow">每日洗護紀錄｜Day ${articleNumber}｜${escapeHtml(post.date)} ${escapeHtml(post.time)}</span>
          <h1>${escapeHtml(post.topic)}</h1>
          <p class="lead">${escapeHtml(description)}</p>
          <p class="last-updated">發布日期：<time datetime="${escapeHtml(post.date)}">${escapeHtml(post.date)}</time>｜作者：${escapeHtml(profile.name)}</p>
          <div class="button-row">
            <a class="button brand" href="${escapeHtml(lineCta)}">LINE 傳照片詢問</a>
            <a class="button secondary" href="${escapeHtml(serviceHref)}">${escapeHtml(service?.name ?? "服務說明")}</a>
          </div>
        </div>
        <div class="hero-visual">
          <span class="eyebrow">先講重點</span>
          <div class="answer-box">
            <p>${escapeHtml(leadParagraph)}</p>
          </div>
          <figure class="service-photo">
          ${
            post.video_url
              ? `<video src="${escapeHtml(post.video_url)}" poster="${escapeHtml(webpSrcFor(post.image_path, imageSrc) ?? imageSrc)}" controls playsinline preload="metadata" aria-label="${escapeHtml(`${post.topic} - ${profile.name}`)}"></video>`
              : responsiveImageHtml({
                  imagePath: post.image_path,
                  src: imageSrc,
                  alt: `${post.topic} - ${profile.name}`,
                  fallbackSize: POST_IMAGE_FALLBACK_SIZE,
                  loading: "eager",
                  fetchpriority: "high"
                })
          }
            <figcaption>${escapeHtml(post.topic)}｜${escapeHtml(profile.name)}門市紀錄</figcaption>
          </figure>
        </div>
        </div>
      </section>
      <section class="article-body">
        <div class="content">
          <h2 id="summary">重點摘要</h2>
          <ul>
            ${summaryItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n            ")}
          </ul>
          <h2 id="store-note">門市筆記</h2>
          <p class="post-caption">${escapeHtml(post.facebook_caption)}</p>
          <h2 id="checkpoints">${escapeHtml(care.family)}的檢查重點</h2>
          <ol>
            ${care.checkpoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("\n            ")}
          </ol>
          ${
            caseRows
              ? `<h2 id="boundaries">材質與處理界線</h2>
          <p>以下是${escapeHtml(service?.name ?? "門市")}常見的送件情境與處理界線，用來協助送洗前判斷；不是特定客戶成果，也不代表效果保證。</p>
          <div class="table-wrap">
            <table class="comparison-table">
              <thead>
                <tr>
                  <th>物件</th>
                  <th>材質</th>
                  <th>門市先看</th>
                  <th>處理界線</th>
                </tr>
              </thead>
              <tbody>
                ${caseRows}
              </tbody>
            </table>
          </div>`
              : ""
          }
          <h2 id="next-step">下一步</h2>
          <p>拍整體、近照、材質位置與最在意的痕跡，傳 LINE 或帶到${escapeHtml(profile.address_text)}門市；台中市全區可約免費收送，收送不收費、清潔與洗護費依物件狀態另計。</p>
          <div class="button-row">
            <a class="button brand" href="${escapeHtml(lineCta)}">LINE 傳照片詢問</a>
            <a class="button secondary" href="${escapeHtml(serviceHref)}">看${escapeHtml(service?.name ?? "服務")}說明</a>
            ${
              pickupService && pickupService.slug !== service?.slug
                ? `<a class="button secondary" href="${escapeHtml(servicePageUrl(pickupService, index))}">${escapeHtml(pickupService.name)}</a>`
                : ""
            }
          </div>
          <section class="article-faq" aria-labelledby="faq-${escapeHtml(post.id)}">
            <h2 id="faq-${escapeHtml(post.id)}">常見問題</h2>
            <div class="article-faq__list">
              ${faqs
                .map(
                  (faq) => `<article class="article-faq__item">
                <h3>${escapeHtml(faq.question)}</h3>
                <p>${escapeHtml(faq.answer)}</p>
              </article>`
                )
                .join("\n              ")}
            </div>
          </section>
          <section class="article-related" aria-labelledby="related-${escapeHtml(post.id)}">
            <h2 id="related-${escapeHtml(post.id)}" class="article-related__title">延伸閱讀</h2>
            <ul class="article-related__list">
              ${relatedPosts
                .map(
                  (item) =>
                    `<li class="article-related__item"><a class="article-related__link" href="${escapeHtml(item.article_url)}">${escapeHtml(item.topic)}</a>（${escapeHtml(item.date)}）</li>`
                )
                .join("\n              ")}
              ${relatedGuides
                .map(
                  (page) =>
                    `<li class="article-related__item"><a class="article-related__link" href="${escapeHtml(supportPageUrl(page, index))}">${escapeHtml(page.h1)}</a></li>`
                )
                .join("\n              ")}
              <li class="article-related__item"><a class="article-related__link" href="${escapeHtml(hubHref)}">每日洗護紀錄總覽</a></li>
            </ul>
          </section>
          ${targetQueries ? `<div class="chip-row local-query-row" aria-label="客人常用查詢">${targetQueries}</div>` : ""}
          <div class="chip-row local-query-row" aria-label="主題標籤">${hashtags}</div>
        </div>
      </section>
      <section class="section">
        <div class="page-shell">
          <div class="section-header">
            <span class="eyebrow">下一步</span>
            <h2>這則紀錄對應的私享家服務</h2>
          </div>
          <div class="grid three">
            ${service ? renderServiceProductCard(service, index, serviceHref) : ""}
            ${pickupService && pickupService.slug !== service?.slug ? renderServiceProductCard(pickupService, index, servicePageUrl(pickupService, index)) : ""}
            <article class="card">
              <h3>${escapeHtml(profile.name)}</h3>
              <p>${escapeHtml(profile.address_text)}（${escapeHtml(profile.landmark)}）</p>
              <p>${escapeHtml(profile.opening_hours_text)}</p>
              <div class="link-row">
                <a href="${escapeHtml(lineFooter)}">LINE</a>
                <a href="${escapeHtml(profile.map_url)}">Google Maps</a>
                <a href="${escapeHtml(profile.facebook_url)}">Facebook</a>
                <a href="${escapeHtml(profile.instagram_url)}">Instagram</a>
              </div>
            </article>
          </div>
        </div>
      </section>
      <section class="section tight">
        <div class="page-shell">
          <div class="card follow-cta">
            <h2>追蹤私享家，看更多洗護紀錄</h2>
            <p>每天一則門市紀錄，先看材質、再談清潔；Facebook 與 Instagram 同步發布。</p>
            <div class="button-row">
              <a class="button brand" href="${escapeHtml(profile.facebook_url)}" target="_blank" rel="noopener">Facebook 私享家洗衣店</a>
              <a class="button secondary" href="${escapeHtml(profile.instagram_url)}" target="_blank" rel="noopener">Instagram @si_xiang_jia</a>
              ${profile.youtube_url ? `<a class="button secondary" href="${escapeHtml(profile.youtube_url)}" target="_blank" rel="noopener">YouTube</a>` : ""}
            </div>
          </div>
        </div>
      </section>
    </main>`;

  const visibleChars = visibleTextLength(mainHtml);
  const captionChars = post.facebook_caption.replace(/\s+/gu, "").length;
  const reasons: string[] = [];
  if (!index.base_url_configured) reasons.push("public base URL not configured");
  if (captionChars < POST_ARTICLE_MIN_CAPTION_CHARS) reasons.push(`caption ${captionChars} < ${POST_ARTICLE_MIN_CAPTION_CHARS} chars`);
  if (visibleChars < POST_ARTICLE_MIN_VISIBLE_CHARS) reasons.push(`visible ${visibleChars} < ${POST_ARTICLE_MIN_VISIBLE_CHARS} chars`);
  if (!hasArticlePage(post, index)) reasons.push("duplicate caption without its own article");
  const render: PostArticleRender = {
    mainHtml,
    visibleChars,
    indexable: reasons.length === 0,
    reasons,
    faqs,
    articleNumber
  };
  cache.set(post.id, render);
  return render;
}

function indexablePostArticles(index: PublicPostIndex): PublicPost[] {
  return sortedArticlePosts(index).filter((post) => renderPostArticle(post, index).indexable);
}

function postsHubContentLastmod(index: PublicPostIndex): string | undefined {
  const newest = indexablePostArticles(index)
    .map((post) => post.date)
    .sort()
    .at(-1);
  return [newest, toSitemapLastmodDate(POSTS_HUB_TEMPLATE_LASTMOD)].filter(Boolean).sort().at(-1);
}

function buildPostsHubSchema(index: PublicPostIndex): object | undefined {
  if (!index.base_url_configured) return undefined;
  const businessNode = buildBusinessSchemaNode(index);
  if (!businessNode) return undefined;
  const hubUrl = postsHubUrl(index);
  const articles = indexablePostArticles(index).sort((a, b) => (a.date < b.date ? 1 : -1));
  return {
    "@context": "https://schema.org",
    "@graph": [
      businessNode,
      buildWebsiteSchemaNode(index),
      {
        "@type": "CollectionPage",
        "@id": `${hubUrl}#webpage`,
        url: hubUrl,
        name: POSTS_HUB_TITLE,
        description: POSTS_HUB_DESCRIPTION,
        inLanguage: "zh-Hant-TW",
        isPartOf: { "@id": `${index.canonical_url}#website` },
        about: { "@id": `${index.canonical_url}#business` },
        breadcrumb: { "@id": `${hubUrl}#breadcrumb` },
        mainEntity: { "@id": `${hubUrl}#list` }
      },
      {
        "@type": "ItemList",
        "@id": `${hubUrl}#list`,
        itemListOrder: "https://schema.org/ItemListOrderDescending",
        numberOfItems: articles.length,
        itemListElement: articles.map((post, position) => ({
          "@type": "ListItem",
          position: position + 1,
          name: post.topic,
          url: post.article_url
        }))
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${hubUrl}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: index.business_profile.name, item: index.canonical_url },
          { "@type": "ListItem", position: 2, name: "每日洗護紀錄", item: hubUrl }
        ]
      }
    ]
  };
}

function buildPostsHubHtml(index: PublicPostIndex): string {
  const profile = index.business_profile;
  const canonical = postsHubUrl(index);
  const homeHref = index.base_url_configured ? index.canonical_url : "../index.html";
  const lineNav = trackedLineUrl(index, { section: "posts", slug: "hub", placement: "nav" });
  const lineCta = trackedLineUrl(index, { section: "posts", slug: "hub", placement: "cta" });
  const lineFooter = trackedLineUrl(index, { section: "posts", slug: "hub", placement: "footer" });
  const indexable = new Set(indexablePostArticles(index).map((post) => post.id));
  const articles = sortedArticlePosts(index).sort((a, b) => (a.date < b.date ? 1 : -1));
  const lastmod = postsHubContentLastmod(index);
  const schema = buildPostsHubSchema(index);
  const chrome: SiteChromeOptions = {
    homeHref,
    servicesHref: `${homeHref}#services`,
    knowledgeHref: knowledgeHubHref(index, true),
    lineNavHref: lineNav,
    lineFooterHref: lineFooter,
    businessProfileHref: index.base_url_configured ? index.entrypoints.business_profile : "../business-profile.json",
    serviceHref: (item) => servicePageUrl(item, index),
    navLabel: "每日洗護紀錄"
  };
  const cards = articles
    .map((post) => {
      const render = renderPostArticle(post, index);
      const imageSrc = visibleImageSrc(post, index);
      return `<article class="card article-card">
          ${responsiveImageHtml({
            imagePath: post.image_path,
            src: imageSrc,
            alt: `${post.topic} - ${profile.name}`,
            fallbackSize: POST_IMAGE_FALLBACK_SIZE,
            loading: "lazy"
          })}
          <div class="article-meta">Day ${render.articleNumber}｜${escapeHtml(post.date)} ${escapeHtml(post.time)}｜${escapeHtml(careContextFor(post.topic).family)}</div>
          <h3><a href="${escapeHtml(post.article_url)}">${escapeHtml(post.topic)}</a></h3>
          <p>${escapeHtml(captionPreview(post.facebook_caption))}</p>
          <a class="card-link" href="${escapeHtml(post.article_url)}">閱讀文章</a>
        </article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-Hant-TW">
  <head>
    <meta charset="utf-8" />
    ${buildLegacyPathRedirectScript(index)}
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHtml(POSTS_HUB_DESCRIPTION)}" />
    <meta name="robots" content="${postRobotsContent(indexable.size > 0)}" />
    <meta name="googlebot" content="${postRobotsContent(indexable.size > 0)}" />
    <meta name="author" content="${escapeHtml(profile.name)}" />
    <meta name="theme-color" content="#f7f8fb" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <link rel="alternate" hreflang="zh-Hant-TW" href="${escapeHtml(canonical)}" />
    <link rel="alternate" hreflang="x-default" href="${escapeHtml(canonical)}" />
    <link rel="alternate" type="application/rss+xml" title="${escapeHtml(SITE_NAME)} 每日洗護紀錄" href="${escapeHtml(index.base_url_configured ? index.entrypoints.rss : "../rss.xml")}" />
    <meta property="og:title" content="${escapeHtml(POSTS_HUB_TITLE)}" />
    <meta property="og:description" content="${escapeHtml(POSTS_HUB_DESCRIPTION)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:site_name" content="${escapeHtml(profile.name)}" />
    ${schema ? `<script type="application/ld+json">${escapeJsonLd(schema)}</script>` : ""}
    <style>${buildPublicSiteCss()}</style>
    <title>${escapeHtml(POSTS_HUB_TITLE)}</title>
    ${buildAnalyticsTag(index.ga4_measurement_id)}
    ${buildSearchContentAnalyticsTag(index, true)}
  </head>
  <body ${searchAnalyticsBodyAttributes("article_hub", "posts-hub")}>
    ${renderSiteHeader(index, chrome)}
    <main>
      <nav class="breadcrumb" aria-label="麵包屑">
        <ol>
          <li><a href="${escapeHtml(homeHref)}">${escapeHtml(profile.name)}</a></li>
          <li aria-current="page">每日洗護紀錄</li>
        </ol>
      </nav>
      <section class="section page-hero">
        <div class="page-shell grid two">
        <div class="hero-copy">
          <span class="eyebrow">每日洗護紀錄</span>
          <h1>私享家每日洗護紀錄</h1>
          <p class="lead">每天一則門市紀錄：先看材質與痕跡位置，再說能整理到什麼程度。每篇都接到對應服務與 LINE 詢問，依日期由新到舊排列。</p>
          ${lastmod ? `<p class="last-updated">內容更新：<time datetime="${lastmod}">${lastmod}</time></p>` : ""}
          <div class="button-row">
            <a class="button brand" href="${escapeHtml(lineCta)}">LINE 傳照片詢問</a>
            <a class="button secondary" href="${escapeHtml(knowledgeHubHref(index, true))}">洗護知識庫</a>
          </div>
        </div>
        <div class="hero-visual">
          <span class="eyebrow">怎麼看這些紀錄</span>
          <div class="answer-box">
            <p>紀錄是門市實際看件的判斷，不是效果保證。同一類物件的紀錄會互相連結，先找和你手上物件最像的那則，再傳照片問。目前共 ${articles.length} 則紀錄。</p>
          </div>
        </div>
        </div>
      </section>
      <section class="section">
        <div class="page-shell">
          <div class="grid three">
            ${cards}
          </div>
        </div>
      </section>
    </main>
    ${renderSiteFooter(index, chrome)}
  </body>
</html>
`;
}

function rssDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toUTCString() : parsed.toUTCString();
}

function buildRssXml(index: PublicPostIndex): string {
  const articles = indexablePostArticles(index).sort((a, b) => (a.date < b.date ? 1 : -1));
  const items = articles
    .map(
      (post) => `    <item>
      <title>${escapeXml(post.topic)}</title>
      <link>${escapeXml(post.article_url)}</link>
      <guid isPermaLink="true">${escapeXml(post.article_url)}</guid>
      <pubDate>${escapeXml(rssDate(post.date_published))}</pubDate>
      <description>${escapeXml(captionPreview(post.facebook_caption))}</description>
      <enclosure url="${escapeXml(post.image_url)}" type="image/png" length="0" />
    </item>`
    )
    .join("\n");
  const newest = articles[0]?.date_published;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(SITE_NAME)} 每日洗護紀錄</title>`,
    `    <link>${escapeXml(index.canonical_url)}</link>`,
    `    <description>${escapeXml(POSTS_HUB_DESCRIPTION)}</description>`,
    "    <language>zh-Hant</language>",
    `    <atom:link href="${escapeXml(index.entrypoints.rss)}" rel="self" type="application/rss+xml" />`,
    ...(newest ? [`    <lastBuildDate>${escapeXml(rssDate(newest))}</lastBuildDate>`] : []),
    items,
    "  </channel>",
    "</rss>",
    ""
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function buildPostPageHtml(post: PublicPost, index: PublicPostIndex): string {
  const profile = index.business_profile;
  const postSource = { section: "posts" as const, date: post.date, slot: post.slot };
  const lineNav = trackedLineUrl(index, { ...postSource, placement: "nav" });
  const lineFooter = trackedLineUrl(index, { ...postSource, placement: "footer" });
  const canonical = post.article_url;
  const render = renderPostArticle(post, index);
  const schema = buildPostPageSchema(post, index);
  const robots = postRobotsContent(render.indexable);
  const homeHref = index.base_url_configured ? index.canonical_url : "../index.html";
  const chrome: SiteChromeOptions = {
    homeHref,
    servicesHref: `${homeHref}#services`,
    knowledgeHref: knowledgeHubHref(index, true),
    lineNavHref: lineNav,
    lineFooterHref: lineFooter,
    businessProfileHref: index.base_url_configured ? index.entrypoints.business_profile : "../business-profile.json",
    serviceHref: (item) => servicePageUrl(item, index),
    navLabel: "服務與內容"
  };
  const description = captionPreview(post.facebook_caption).slice(0, 180);

  return `<!doctype html>
<html lang="zh-Hant-TW">
  <head>
    <meta charset="utf-8" />
    ${buildLegacyPathRedirectScript(index)}
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="${robots}" />
    <meta name="googlebot" content="${robots}" />
    <meta name="author" content="${escapeHtml(profile.name)}" />
    <meta name="theme-color" content="#f7f8fb" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <link rel="alternate" hreflang="zh-Hant-TW" href="${escapeHtml(canonical)}" />
    <link rel="alternate" hreflang="x-default" href="${escapeHtml(canonical)}" />
    <link rel="alternate" type="application/rss+xml" title="${escapeHtml(SITE_NAME)} 每日洗護紀錄" href="${escapeHtml(index.base_url_configured ? index.entrypoints.rss : "../rss.xml")}" />
    <meta property="og:title" content="${escapeHtml(post.topic)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="article" />
    <meta property="article:published_time" content="${escapeHtml(post.date_published)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:site_name" content="${escapeHtml(profile.name)}" />
    <meta property="og:locale" content="${escapeHtml(SITE_LOCALE)}" />
    <meta property="og:image" content="${escapeHtml(post.image_url)}" />
    <meta property="og:image:alt" content="${escapeHtml(`${post.topic} - ${profile.name}`)}" />
${post.video_url ? `    <meta property="og:video" content="${escapeHtml(post.video_url)}" /><meta property="og:video:type" content="video/mp4" />
` : ""}    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(post.topic)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(post.image_url)}" />
    ${schema ? `<script type="application/ld+json">${escapeJsonLd(schema)}</script>` : ""}
    <style>${buildPublicSiteCss()}</style>
    <title>${escapeHtml(`${post.topic} | ${profile.name}`)}</title>
    ${buildAnalyticsTag(index.ga4_measurement_id)}
    ${buildSearchContentAnalyticsTag(index, true)}
  </head>
  <body ${searchAnalyticsBodyAttributes("article", post.id)}>
    ${renderSiteHeader(index, chrome)}
    ${render.mainHtml}
    ${renderSiteFooter(index, chrome)}
  </body>
</html>
`;
}

interface SiteChromeOptions {
  homeHref: string;
  servicesHref: string;
  knowledgeHref: string;
  lineNavHref: string;
  lineFooterHref: string;
  businessProfileHref: string;
  serviceHref: (service: ServicePageDefinition) => string;
  navLabel: string;
  postsHubHref?: string;
}

function renderSiteHeader(index: PublicPostIndex, options: SiteChromeOptions): string {
  const profile = index.business_profile;
  return `<header class="site-header">
      <div class="site-header__inner">
        <a class="brand-link" href="${escapeHtml(options.homeHref)}" aria-label="${escapeHtml(profile.name)}首頁">
          <span class="brand-mark">私</span>
          <span>${escapeHtml(profile.name)}</span>
        </a>
        <nav class="nav" aria-label="${escapeHtml(options.navLabel)}">
          ${SERVICE_PAGE_DEFINITIONS.map(
            (service) => `<a href="${escapeHtml(options.serviceHref(service))}">${escapeHtml(service.name)}</a>`
          ).join("\n          ")}
          <a href="${escapeHtml(options.knowledgeHref)}">洗護知識庫</a>
          <a href="${escapeHtml(options.lineNavHref)}">LINE 預約</a>
        </nav>
      </div>
    </header>`;
}

function renderSiteFooter(index: PublicPostIndex, options: SiteChromeOptions): string {
  const profile = index.business_profile;
  const pickupService = findServiceBySlug("taichung-citywide-laundry-pickup");
  return `<footer class="site-footer">
      <div class="page-shell site-footer__grid">
        <div>
          <h2>${escapeHtml(profile.name)}</h2>
          <p>私享家提供鞋包清潔、白鞋清潔、衣物與寢具洗護、布品收納整理與台中市免費收送，服務西屯青海路門市周邊與台中全市的客人。</p>
          <p>${escapeHtml(profile.address_text)}（${escapeHtml(profile.landmark)}）｜電話 ${escapeHtml(profile.telephone_local)}｜LINE／手機 ${escapeHtml(profile.mobile_or_line_local)}</p>
          <p>營業時間：${escapeHtml(profile.opening_hours_text)}。實際收件、參考價與處理界線，以門市檢視實物為準。</p>
        </div>
        <div>
          <h3>網站連結</h3>
          <div class="footer-links">
            <a href="${escapeHtml(options.homeHref)}">首頁</a>
            <a href="${escapeHtml(options.servicesHref)}">服務項目</a>
            ${pickupService ? `<a href="${escapeHtml(options.serviceHref(pickupService))}">${escapeHtml(pickupService.name)}</a>` : ""}
            <a href="${escapeHtml(options.knowledgeHref)}">洗護知識庫</a>
            <a href="${escapeHtml(options.postsHubHref ?? postsHubHref(index, true))}">每日洗護紀錄</a>
            <a href="${escapeHtml(options.homeHref)}#homepage-faq">常見問題</a>
            <a href="${escapeHtml(options.businessProfileHref)}">店家資料</a>
          </div>
          <h3 style="margin-top: 22px;">社群</h3>
          <div class="footer-links">
            <a href="${escapeHtml(options.lineFooterHref)}">LINE 加好友</a>
            <a href="${escapeHtml(profile.facebook_url)}">Facebook</a>
            <a href="${escapeHtml(profile.instagram_url)}">Instagram</a>
            ${profile.youtube_url ? `<a href="${escapeHtml(profile.youtube_url)}">YouTube</a>` : ""}
            <a href="${escapeHtml(profile.map_url)}">Google Maps</a>
          </div>
        </div>
      </div>
    </footer>
    <div class="mobile-sticky-cta" aria-label="行動版固定預約">
      <a class="button secondary" href="${escapeHtml(options.servicesHref)}">服務項目</a>
      <a class="button brand" href="${escapeHtml(options.lineFooterHref)}">LINE 預約</a>
    </div>`;
}

const SERVICE_AUDIENCE_BY_SLUG: Record<string, string> = {
  "shoe-bag-care": "通勤族、學生、精品包與皮鞋主人",
  "white-shoe-cleaning": "球鞋族、學生、上班族",
  "fabric-storage": "家庭、換季收納、租屋族",
  "taichung-xitun-laundry": "西屯、逢甲、青海路生活圈",
  "business-bulk-laundry": "店家、公司、宿舍與團體",
  "taichung-citywide-laundry-pickup": "台中市全區住家與公司",
  "taichung-laundry-price-list": "第一次送洗、想先看價格的人"
};

function serviceAudience(service: ServicePageDefinition): string {
  return SERVICE_AUDIENCE_BY_SLUG[service.slug] ?? "台中市客人";
}

function renderServiceProductCard(
  service: ServicePageDefinition,
  index: PublicPostIndex,
  href: string,
  options: { withImage?: boolean; servicePage?: boolean } = {}
): string {
  const image = options.withImage ? findServiceImage(service, index) : undefined;
  const imageSrc = image ? visibleImageSrc(image, index, Boolean(options.servicePage)) : "";
  const imageMarkup = image
    ? `\n        ${responsiveImageHtml({
        imagePath: image.image_path,
        src: imageSrc,
        alt: service.image_alt,
        fallbackSize: SERVICE_IMAGE_FALLBACK_SIZE,
        className: "service-card-image",
        loading: "lazy"
      })}`
    : "";
  return `<article class="card product-card service-card">${imageMarkup}
        <div class="product-card__meta">${escapeHtml(serviceAudience(service))}</div>
        <h3><a href="${escapeHtml(href)}">${escapeHtml(service.name)}</a></h3>
        <p>${escapeHtml(service.summary)}</p>
        <p><strong>能解決：</strong>${escapeHtml(service.answer_summary)}</p>
        <a class="card-link" href="${escapeHtml(href)}">詳細介紹</a>
      </article>`;
}

function renderLocalSolutionCard(page: SupportPageDefinition, href: string): string {
  return `<article class="card solution-card">
        <h3><a href="${escapeHtml(href)}">${escapeHtml(page.h1)}</a></h3>
        <p>${escapeHtml(page.summary)}</p>
        <p><strong>這個地區最需要：</strong>${escapeHtml(page.local_intent)}</p>
        <a class="card-link" href="${escapeHtml(href)}">查看在地收送</a>
      </article>`;
}

function renderHomePostTile(post: PublicPost, index: PublicPostIndex, profile: BusinessProfile): string {
  const imageSrc = visibleImageSrc(post, index);
  const preview = captionPreview(post.facebook_caption);
  // Prefer this post's own article, then the article owning its caption; raw calendar JSON is
  // a last resort because a reader clicking "read full post" should never land on JSON.
  const canonicalArticle = canonicalArticleFor(post, index);
  const articleHref = canonicalArticle
    ? hasArticlePage(post, index)
      ? post.article_url
      : canonicalArticle.article_url
    : post.calendar_path;
  return `<article class="post-tile post-card">
        <a href="${escapeHtml(imageSrc)}">
          ${responsiveImageHtml({
            imagePath: post.image_path,
            src: imageSrc,
            alt: `${post.topic} - ${profile.name}洗護內容照片`,
            fallbackSize: POST_IMAGE_FALLBACK_SIZE,
            loading: "lazy"
          })}
        </a>
        <div class="article-meta">${escapeHtml(post.date)} ${escapeHtml(post.time)}｜${escapeHtml(post.content_role)} / ${escapeHtml(post.visual_route)} / ${escapeHtml(post.traffic_route)}</div>
        <h3>${escapeHtml(post.topic)}</h3>
        <p class="post-caption post-preview">${escapeHtml(preview)}</p>
        <details class="caption-details">
          <summary>閱讀完整文案</summary>
          <p class="post-caption">${escapeHtml(post.facebook_caption)}</p>
        </details>
        <a class="card-link" href="${escapeHtml(articleHref)}">閱讀文章</a>
      </article>`;
}

function buildIndexHtml(index: PublicPostIndex): string {
  const profile = index.business_profile;
  const lineNav = trackedLineUrl(index, { section: "home", placement: "nav" });
  const lineCta = trackedLineUrl(index, { section: "home", placement: "cta" });
  const lineInline = trackedLineUrl(index, { section: "home", placement: "inline" });
  const linePickup = trackedLineUrl(index, { section: "home", placement: "pickup" });
  const lineFooter = trackedLineUrl(index, { section: "home", placement: "footer" });
  const { recentPosts, archivePosts, recentDateCount, archiveDateCount } = homepagePostGroups(index.posts);
  const heroImage = primaryHomeImage(index);
  const heroImageSrc = heroImage ? visibleImageSrc(heroImage, index) : "";
  const heroWebpSrc = heroImage ? webpSrcFor(heroImage.image_path, heroImageSrc) : undefined;
  const heroPreload = heroImage
    ? `\n    <link rel="preload" as="image" href="${escapeHtml(heroWebpSrc ?? heroImageSrc)}"${heroWebpSrc ? ' type="image/webp"' : ""} fetchpriority="high" />`
    : "";
  const whiteShoeService = findServiceBySlug("white-shoe-cleaning");
  const heroInsetImage = whiteShoeService ? findServiceImage(whiteShoeService, index) : undefined;
  const heroInsetSrc = heroInsetImage ? visibleImageSrc(heroInsetImage, index) : "";
  const homeLastmod = homepageContentLastmod(index);
  const homePageSchema = buildHomePageSchema(index);
  const citywidePickupService =
    findServiceBySlug("taichung-citywide-laundry-pickup") ??
    SERVICE_PAGE_DEFINITIONS.find((service) => service.slug === "taichung-citywide-laundry-pickup") ??
    SERVICE_PAGE_DEFINITIONS[0];
  if (!citywidePickupService) {
    throw new Error("Missing taichung-citywide-laundry-pickup service page definition");
  }
  const citywidePickupUrl = servicePageUrl(citywidePickupService, index);
  const priceListService = findServiceBySlug(PRICE_LIST_SLUG);
  const priceListUrl = priceListService ? servicePageUrl(priceListService, index) : citywidePickupUrl;
  const localShoePage = SUPPORT_PAGE_DEFINITIONS.find((page) => page.slug === "qinghai-road-shoe-cleaning");
  const localShoeUrl = localShoePage ? supportPageUrl(localShoePage, index) : "";
  const chrome: SiteChromeOptions = {
    homeHref: index.canonical_url,
    servicesHref: "#services",
    knowledgeHref: knowledgeHubHref(index),
    lineNavHref: lineNav,
    lineFooterHref: lineFooter,
    businessProfileHref: "business-profile.json",
    serviceHref: (service) => servicePageUrl(service, index),
    navLabel: "主選單",
    postsHubHref: postsHubHref(index)
  };
  const rows =
    recentPosts.length > 0
      ? recentPosts.map((post) => renderHomePostTile(post, index, profile)).join("\n")
      : `<p class="section-copy">尚未有審核通過的公開貼文。</p>`;
  const archiveRows = archivePosts.map((post) => renderHomePostTile(post, index, profile)).join("\n");
  const archiveSection =
    archivePosts.length > 0
      ? `<details class="post-archive">
            <summary>較早內容（${archiveDateCount} 天，${archivePosts.length} 篇）</summary>
            <p class="section-copy">這些貼文仍保留在 SEO / AEO / GEO 和社群內容資料庫中，預設收合，避免首頁太長。</p>
            <div class="grid three archive-list">
        ${archiveRows}
            </div>
          </details>`
      : "";
  const serviceCards = SERVICE_PAGE_DEFINITIONS.map((service) =>
    renderServiceProductCard(service, index, servicePageUrl(service, index), { withImage: true, servicePage: true })
  ).join("\n");
  const localPages = SUPPORT_PAGE_DEFINITIONS.filter((page) => page.category === "local");
  const localCards = localPages.map((page) => renderLocalSolutionCard(page, supportPageUrl(page, index))).join("\n");
  const supportCardFor = (page: SupportPageDefinition): string => {
    const service = linkedSupportService(page);
    return `<article class="card article-card">
        <div class="article-meta">${page.category === "local" ? "在地答案" : "洗護答案"}</div>
        <h3><a href="${escapeHtml(supportPageUrl(page, index))}">${escapeHtml(page.h1)}</a></h3>
        <p>${escapeHtml(page.citation_answer ?? page.summary)}</p>
        <div class="link-row">
          <a class="card-link" href="${escapeHtml(supportPageUrl(page, index))}">閱讀答案</a>
          ${service ? `<a class="card-link" href="${escapeHtml(servicePageUrl(service, index))}">${escapeHtml(service.name)}</a>` : ""}
        </div>
      </article>`;
  };
  const supportHubSections = INDEX_GROWTH_HUB_ORDER.map((group) => {
    const pages = SUPPORT_PAGE_DEFINITIONS.filter((page) => hubGroupFor(page) === group.id);
    if (pages.length === 0) return "";
    const featuredPages = pages.slice(0, group.id === "shoes" ? 4 : 2);
    return `<div class="guide-hub-group" id="guide-hub-${escapeHtml(group.id)}">
          <div class="section-header">
            <span class="eyebrow">${escapeHtml(group.heading)}</span>
            <h3>${escapeHtml(group.intro)}</h3>
          </div>
          <div class="grid four">
          ${featuredPages.map((page) => supportCardFor(page)).join("\n")}
          </div>
          <p style="margin-top:16px;"><a class="card-link" href="${escapeHtml(`${knowledgeHubHref(index)}#knowledge-${group.id}`)}">查看${escapeHtml(group.heading)}全部答案 →</a></p>
        </div>`;
  }).join("\n");
  const discoveryGroups = HOME_DISCOVERY_GROUPS.map(
    (group) => `<article class="card">
        <h3>${escapeHtml(group.heading)}</h3>
        <p>${escapeHtml(group.intro)}</p>
        <ul>
          ${group.items
            .map(
              (item) => `<li>
            <a class="card-link" href="${escapeHtml(homeDiscoveryItemUrl(item, index))}">${escapeHtml(item.label)}</a>
            <br /><span class="muted">${escapeHtml(item.description)}</span>
          </li>`
            )
            .join("\n")}
        </ul>
      </article>`
  ).join("\n");
  const trustCards = HOME_TRUST_ITEMS.map(
    (item) => `<article class="card">
        <h3>${escapeHtml(item.heading)}</h3>
        <p>${escapeHtml(item.body)}</p>
      </article>`
  ).join("\n");
  const processCards = HOME_PROCESS_STEPS.map(
    (item, position) => `<div class="card">
        <div class="eyebrow">Step ${position + 1}</div>
        <h3>${escapeHtml(item.heading)}</h3>
        <p>${escapeHtml(item.body)}</p>
      </div>`
  ).join("\n");
  const homepageFaqItems = homeFaqs(profile)
    .map(
      (faq) => `<article class="card">
        <h3>${escapeHtml(faq.question)}</h3>
        <p>${escapeHtml(faq.answer)}</p>
      </article>`
    )
    .join("\n");
  const localSearchChips = LOCAL_SEARCH_QUERY_TARGETS.map(
    (query) => `<span class="chip">${escapeHtml(query)}</span>`
  ).join("\n");

  return `<!doctype html>
<html lang="zh-Hant-TW">
  <head>
    <meta charset="utf-8" />
    ${buildLegacyPathRedirectScript(index)}
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHtml(SITE_DESCRIPTION)}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <meta name="googlebot" content="index, follow, max-image-preview:large" />
    <meta name="author" content="${escapeHtml(profile.name)}" />
    <meta name="theme-color" content="#f7f8fb" />
    <link rel="canonical" href="${escapeHtml(index.canonical_url)}" />
    <link rel="alternate" hreflang="zh-Hant-TW" href="${escapeHtml(index.canonical_url)}" />
    <link rel="alternate" hreflang="x-default" href="${escapeHtml(index.canonical_url)}" />${heroPreload}
    <link rel="llms" href="llms.txt" />
    <link rel="sitemap" type="application/xml" href="sitemap.xml" />
    <link rel="sitemap" type="application/xml" href="ai-sitemap.xml" />
    <link rel="alternate" type="application/json" href="social-posts.json" />
    <link rel="alternate" type="application/json" href="business-profile.json" />
    <link rel="alternate" type="application/json" href="services.json" />
    <link rel="alternate" type="application/json" href="answers.json" />
    <link rel="alternate" type="application/json" href="geo-targets.json" />
    <link rel="alternate" type="application/json" href="search-visibility.json" />
    <link rel="alternate" type="application/jsonl" href="llms.jsonl" />
    <link rel="alternate" type="application/json" href="feed.json" />
    <link rel="alternate" type="application/rss+xml" title="${escapeHtml(SITE_NAME)} 每日洗護紀錄" href="rss.xml" />
    <link rel="alternate" type="application/ld+json" href="knowledge-graph.json" />
    <meta property="og:title" content="${escapeHtml(index.open_graph.title)}" />
    <meta property="og:description" content="${escapeHtml(index.open_graph.description)}" />
    <meta property="og:type" content="${escapeHtml(index.open_graph.type)}" />
    <meta property="og:url" content="${escapeHtml(index.open_graph.url)}" />
    <meta property="og:site_name" content="${escapeHtml(index.open_graph.site_name)}" />
    <meta property="og:locale" content="${escapeHtml(index.open_graph.locale)}" />
    ${index.open_graph.image ? `<meta property="og:image" content="${escapeHtml(index.open_graph.image)}" />` : ""}
    ${index.open_graph.image ? `<meta property="og:image:alt" content="${escapeHtml(index.open_graph.image_alt)}" />` : ""}
    <meta name="twitter:card" content="${index.open_graph.image ? "summary_large_image" : "summary"}" />
    <meta name="twitter:title" content="${escapeHtml(index.open_graph.title)}" />
    <meta name="twitter:description" content="${escapeHtml(index.open_graph.description)}" />
    ${index.open_graph.image ? `<meta name="twitter:image" content="${escapeHtml(index.open_graph.image)}" />` : ""}
    ${index.open_graph.image ? `<meta name="twitter:image:alt" content="${escapeHtml(index.open_graph.image_alt)}" />` : ""}
    ${homePageSchema ? `<script type="application/ld+json">${escapeJsonLd(homePageSchema)}</script>` : ""}
    <style>${buildPublicSiteCss()}</style>
    <title>${escapeHtml(SITE_TITLE)}</title>
    ${buildAnalyticsTag(index.ga4_measurement_id)}
    ${buildSearchContentAnalyticsTag(index)}
  </head>
  <body ${searchAnalyticsBodyAttributes("home", "home")}>
    ${renderSiteHeader(index, chrome)}
    <main>
      <section class="home-hero" data-home-design="mobile-first">
        <div class="page-shell home-hero__grid">
          <div class="home-hero__content">
            <span class="eyebrow">${escapeHtml(profile.name)}｜台中西屯門市・台中全市收送</span>
            <h1>台中免費收送，逢甲・西屯洗鞋先看材質</h1>
            <p class="lead">台中市全區可預約免費收送，收送本身免費、洗護費另計。逢甲與西屯洗鞋可到青海路二段365號門市，或先用 LINE 傳鞋面、鞋底與鞋內照片。</p>
            <div class="home-hero__actions">
              <a class="button brand" href="${escapeHtml(citywidePickupUrl)}">台中全市免費收送</a>
              <a class="button home-hero__photo-action" href="${escapeHtml(lineCta)}">LINE 傳照片預約</a>
            </div>
            <p class="home-hero__note">鞋包、白鞋、衣物寢具都能先傳照片再送洗，先看材質再談清潔。</p>
            <p class="home-hero__note">
              <a href="${escapeHtml(priceListUrl)}">看洗衣價目表</a>
              <span aria-hidden="true">｜</span>
              <a href="#store">門市位置與營業時間</a>
            </p>
            <p class="last-updated">內容更新：<time datetime="${homeLastmod}">${homeLastmod}</time></p>
          </div>
          <div class="home-hero__visual">
            ${
              heroImage
                ? responsiveImageHtml({
                    imagePath: heroImage.image_path,
                    src: heroImageSrc,
                    alt: `${heroImage.topic} - ${profile.name}布品收納檢查示意圖`,
                    fallbackSize: SERVICE_IMAGE_FALLBACK_SIZE,
                    loading: "eager",
                    fetchpriority: "high"
                  })
                : ""
            }
            ${
              heroInsetImage && whiteShoeService
                ? `<div class="home-hero__app">
              ${responsiveImageHtml({
                imagePath: heroInsetImage.image_path,
                src: heroInsetSrc,
                alt: whiteShoeService.image_alt,
                fallbackSize: SERVICE_IMAGE_FALLBACK_SIZE,
                loading: "lazy"
              })}
            </div>`
                : ""
            }
          </div>
        </div>
      </section>
      <section class="home-flow" data-home-flow aria-label="私享家送洗流程">
        <div class="page-shell">
          <ol class="home-flow__list">
            <li><span>1</span><strong>拍照</strong><small>整體、近照與最在意的痕跡</small></li>
            <li><span>2</span><strong>傳 LINE</strong><small>門市先看材質與可整理程度</small></li>
            <li><span>3</span><strong>約收送或到店</strong><small>台中市免費收送、沒有最低消費</small></li>
            <li><span>4</span><strong>洗好送回</strong><small>處理界線先講清楚再動手</small></li>
          </ol>
          <a class="home-office-callout" data-home-office-callout href="${escapeHtml(linePickup)}">
            <strong>收送免費、沒有最低消費門檻</strong>
            <span>一件也可以先問；清潔與洗護費依物件狀態另計，先用 LINE 傳照片再約收送。</span>
          </a>
        </div>
      </section>
      <section class="section" id="services">
        <div class="page-shell">
          <div class="section-header">
            <span class="eyebrow">服務項目</span>
            <h2>鞋包、白鞋、衣物寢具，都能先問再送</h2>
            <p>選你要送的物件，材質判斷、處理界線與收送方式一次看清楚，第一次送洗也能直接上手。</p>
          </div>
          <div class="grid four">
          ${serviceCards}
          </div>
        </div>
      </section>
      <section class="section tight surface" id="how-it-works">
        <div class="page-shell">
          <div class="section-header">
            <span class="eyebrow">怎麼送洗</span>
            <h2>送洗前流程</h2>
          </div>
          <div class="grid five">
          ${processCards}
          </div>
        </div>
      </section>
      <section class="section" id="discovery">
        <div class="page-shell">
          <div class="section-header">
            <span class="eyebrow">依需求找服務</span>
            <h2>依需求找到服務</h2>
            <p>把客人真正會問的物件、情境、收送與送洗前問題拆清楚，讓搜尋「台中西屯洗衣店」「台中洗衣收送」「青海路洗衣店」的人，也能快速理解私享家在判斷什麼。</p>
          </div>
          <div class="grid four discovery-grid">
          ${discoveryGroups}
          </div>
        </div>
      </section>
      <section class="section surface" id="citywide-pickup">
        <div class="page-shell">
          <div class="section-header">
            <span class="eyebrow">在地收送</span>
            <h2>把免費收送放進台中的生活圈</h2>
            <p>收送範圍為台中市全市，<strong>收送本身免費，且沒有最低消費門檻</strong>——不需要單次洗滌滿額才能收送，一件也可以先問。清潔與洗護費用則依物件狀態另計。門市在西屯區青海路二段365號。預約與詢問以 <a class="card-link" href="${escapeHtml(lineInline)}">LINE</a> 為主，先傳照片再約定收送。從逢甲或西屯找洗鞋，可先看<a class="card-link" href="${escapeHtml(localShoeUrl)}"><strong>逢甲洗鞋・西屯洗鞋</strong></a>的門市方位、案例界線與收送範圍。</p>
          </div>
          <div class="grid three">
          ${localCards}
          </div>
          <div class="button-row" style="margin-top:20px;">
            <a class="button brand" href="${escapeHtml(citywidePickupUrl)}">閱讀收送說明頁</a>
            <a class="button secondary" href="${escapeHtml(linePickup)}">LINE 預約收送</a>
          </div>
        </div>
      </section>
      <section class="section" id="guide-hub">
        <div class="page-shell">
          <div class="section-header">
            <span class="eyebrow">洗護知識庫</span>
            <h2>送洗前先看這幾件事</h2>
            <p>問答頁負責回答搜尋問題，再把讀者導向對應服務與 LINE 詢問。先選鞋類、包類、布品或送洗決策，再進對應判斷頁。</p>
            <nav class="link-row" aria-label="指南分組">
              ${INDEX_GROWTH_HUB_ORDER.map(
                (group) => `<a href="#guide-hub-${escapeHtml(group.id)}">${escapeHtml(group.heading)}</a>`
              ).join("\n              ")}
            </nav>
          </div>
          ${supportHubSections}
          <p style="margin-top:20px;"><a class="card-link" href="${escapeHtml(knowledgeHubHref(index))}">查看洗護知識庫總覽 →</a></p>
        </div>
      </section>
      <section class="section surface" id="daily">
        <div class="page-shell">
          <div class="section-header">
            <span class="eyebrow">每日洗護紀錄</span>
            <h2>已發布社群內容</h2>
            <p>只收錄已審核、可公開的 Facebook / Instagram 貼文；最近 ${recentDateCount} 天直接顯示，較早內容收合成 archive，但仍保留給客人、搜尋引擎和 AI 讀取。</p>
          </div>
          <div class="grid three post-list">
        ${rows}
          </div>
          ${archiveSection}
          <p style="margin-top:20px;"><a class="card-link" href="${escapeHtml(postsHubHref(index))}">查看每日洗護紀錄總覽 →</a></p>
        </div>
      </section>
      <section class="section" id="homepage-faq">
        <div class="page-shell">
          <div class="section-header">
            <span class="eyebrow">常見問題</span>
            <h2>台中洗衣與免費收送常見問題</h2>
            <p>先把門市位置、台中市收送範圍、LINE 預約與費用邊界說清楚。</p>
          </div>
          <div class="grid three">
          ${homepageFaqItems}
          </div>
        </div>
      </section>
      <section class="section surface" id="store">
        <div class="page-shell grid two">
          <div>
            <span class="eyebrow">品牌與信任</span>
            <h2>${escapeHtml(profile.name)}</h2>
            <p>私享家洗衣店在台中西屯青海路二段，以鞋包清潔、白鞋清潔、衣物寢具洗護與布品收納為核心，先判斷材質再談清潔，台中市全區可約免費收送。</p>
            <address>
              <p><strong>${escapeHtml(profile.google_business_profile_name)}</strong></p>
              <p>${escapeHtml(profile.address_text)}（${escapeHtml(profile.landmark)}）</p>
              <p>營業時間：${escapeHtml(profile.opening_hours_text)}</p>
              <p>節日營業：${escapeHtml(profile.holiday_hours_rule.default_rule)}</p>
            </address>
            <p>實際收件、參考價與處理界線以門市檢視為準。</p>
          </div>
          <div class="card contact-methods">
            <h2>預約與詢問入口</h2>
            <div class="button-row">
              <a class="button brand" href="${escapeHtml(lineCta)}">LINE 加好友</a>
              <a class="button secondary" href="tel:${escapeHtml(profile.telephone)}">電話洽詢</a>
              <a class="button brand" href="${escapeHtml(profile.map_url)}">Google Maps 導航</a>
            </div>
            <p class="muted">電話：<a href="tel:${escapeHtml(profile.telephone)}">${escapeHtml(profile.telephone_local)}</a>｜LINE／手機：${escapeHtml(profile.mobile_or_line_local)}｜營業時間：${escapeHtml(profile.opening_hours_text)}</p>
            <p class="muted">社群：<a href="${escapeHtml(profile.facebook_url)}">Facebook</a>｜<a href="${escapeHtml(profile.instagram_url)}">Instagram</a></p>
          </div>
        </div>
      </section>
      <section class="section tight">
        <div class="page-shell">
          <div class="section-header">
            <span class="eyebrow">為什麼選私享家</span>
            <h2>先判斷材質，再談清潔</h2>
          </div>
          <div class="grid four">
          ${trustCards}
          </div>
        </div>
      </section>
      <section class="section tight surface">
        <div class="page-shell grid two">
          <div class="card local-search-card">
            <span class="eyebrow">在地搜尋</span>
            <h3>搜尋洗衣店時，讓地區和服務都說清楚。</h3>
            <p>這個公開站會固定把私享家洗衣店、台中市、西屯門市、青海路二段、免費收送、衣物洗護、洗鞋、洗包、白鞋清潔與布品收納連在一起，提供服務頁、社群圖文、LocalBusiness schema、AI 入口與在地搜尋資料。</p>
            <div class="chip-row local-query-row">
              ${localSearchChips}
            </div>
          </div>
          <details class="machine-details">
            <summary>AI 與搜尋引擎可讀入口</summary>
            <p>這些檔案讓搜尋引擎與 AI 理解私享家洗衣店的服務、店家資料、社群內容與在地搜尋資訊。一般客人不需要閱讀它們，但它們會保留作為公開資料來源。</p>
            <nav aria-label="AI 與搜尋入口">
          <a href="llms-lite.txt">llms-lite.txt</a>
          <a href="llms.txt">llms.txt</a>
          <a href="llms-full.txt">llms-full.txt</a>
          <a href="llms.jsonl">llms.jsonl</a>
          <a href=".well-known/llms.txt">.well-known/llms.txt</a>
          <a href=".well-known/ai.json">.well-known/ai.json</a>
          <a href="services.json">services.json</a>
          <a href="answers.json">answers.json</a>
          <a href="geo-targets.json">geo-targets.json</a>
          <a href="search-visibility.json">search-visibility.json</a>
          <a href="social-posts.json">social-posts.json</a>
          <a href="business-profile.json">店家資料</a>
          <a href="latest.json">latest.json</a>
          <a href="feed.json">feed.json</a>
          <a href="rss.xml">rss.xml</a>
          <a href="knowledge-graph.json">knowledge-graph.json</a>
          <a href="ai-discovery.json">ai-discovery.json</a>
          <a href="ai-sitemap.xml">ai-sitemap.xml</a>
          <a href="sitemap.xml">sitemap.xml</a>
            </nav>
          </details>
        </div>
      </section>
      <section class="cta-band">
        <div class="page-shell grid two">
          <div>
            <h2>想先問再送洗？</h2>
            <p>先拍整體、近照與最在意的痕跡，傳 LINE 或帶到青海路二段365號門市，私享家會先說能整理到什麼程度，再決定要不要送洗。</p>
          </div>
          <div class="button-row">
            <a class="button brand" href="${escapeHtml(lineCta)}">LINE 傳照片詢問</a>
            <a class="button secondary" href="#homepage-faq">查看常見問題</a>
          </div>
        </div>
      </section>
    </main>
    ${renderSiteFooter(index, chrome)}
  </body>
</html>
`;
}

function buildKnowledgeHubHtml(index: PublicPostIndex): string {
  const profile = index.business_profile;
  const canonical = knowledgeHubUrl(index);
  const homeHref = index.base_url_configured ? index.canonical_url : "../index.html";
  const lineCta = trackedLineUrl(index, { section: "guide", slug: "knowledge-hub", placement: "cta" });
  const schema = buildKnowledgeHubSchema(index);
  const lastmod = knowledgeHubContentLastmod();
  const chrome: SiteChromeOptions = {
    homeHref,
    servicesHref: `${homeHref}#services`,
    knowledgeHref: index.base_url_configured ? canonical : "./",
    lineNavHref: lineCta,
    lineFooterHref: lineCta,
    businessProfileHref: index.base_url_configured ? index.entrypoints.business_profile : "../business-profile.json",
    serviceHref: (service) => fromKnowledgeHubHref(servicePageUrl(service, index), index),
    navLabel: "知識庫與服務"
  };
  const serviceCards = SERVICE_PAGE_DEFINITIONS.map((service) =>
    renderServiceProductCard(service, index, fromKnowledgeHubHref(servicePageUrl(service, index), index))
  ).join("\n");
  const answerGroups = INDEX_GROWTH_HUB_ORDER.map((group) => {
    const pages = SUPPORT_PAGE_DEFINITIONS.filter((page) => hubGroupFor(page) === group.id);
    if (pages.length === 0) return "";
    const cards = pages
      .map((page) => {
        const service = requireLinkedSupportService(page);
        return `<article class="card article-card">
              <div class="article-meta">${page.category === "local" ? "在地答案" : "洗護答案"}</div>
              <h3><a href="${escapeHtml(fromKnowledgeHubHref(supportPageUrl(page, index), index))}">${escapeHtml(page.h1)}</a></h3>
              <p>${escapeHtml(page.citation_answer ?? page.summary)}</p>
              <div class="link-row">
                <a class="card-link" href="${escapeHtml(fromKnowledgeHubHref(supportPageUrl(page, index), index))}">看完整答案</a>
                <a href="${escapeHtml(fromKnowledgeHubHref(servicePageUrl(service, index), index))}">${escapeHtml(service.name)}</a>
              </div>
            </article>`;
      })
      .join("\n");
    return `<section class="section ${group.id === "shoes" ? "surface" : ""}" id="knowledge-${escapeHtml(group.id)}">
        <div class="page-shell">
          <div class="section-header">
            <span class="eyebrow">問題分組</span>
            <h2>${escapeHtml(group.heading)}</h2>
            <p class="section-copy">${escapeHtml(group.intro)}</p>
          </div>
          <div class="grid three">
            ${cards}
          </div>
        </div>
      </section>`;
  }).join("\n");

  return `<!doctype html>
<html lang="zh-Hant-TW">
  <head>
    <meta charset="utf-8" />
    ${buildLegacyPathRedirectScript(index)}
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHtml(KNOWLEDGE_HUB_DESCRIPTION)}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <meta name="googlebot" content="index, follow, max-image-preview:large" />
    <meta name="author" content="${escapeHtml(profile.name)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <link rel="alternate" hreflang="zh-Hant-TW" href="${escapeHtml(canonical)}" />
    <link rel="alternate" hreflang="x-default" href="${escapeHtml(canonical)}" />
    <meta property="og:title" content="${escapeHtml(KNOWLEDGE_HUB_TITLE)}" />
    <meta property="og:description" content="${escapeHtml(KNOWLEDGE_HUB_DESCRIPTION)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:site_name" content="${escapeHtml(profile.name)}" />
    ${schema ? `<script type="application/ld+json">${escapeJsonLd(schema)}</script>` : ""}
    <style>${buildPublicSiteCss()}</style>
    <title>${escapeHtml(KNOWLEDGE_HUB_TITLE)}</title>
    ${buildAnalyticsTag(index.ga4_measurement_id)}
    ${buildSearchContentAnalyticsTag(index, true)}
  </head>
  <body ${searchAnalyticsBodyAttributes("knowledge_hub", "knowledge-hub")}>
    ${renderSiteHeader(index, chrome)}
    <main>
      <nav class="breadcrumb" aria-label="麵包屑">
        <ol>
          <li><a href="${escapeHtml(homeHref)}">${escapeHtml(profile.name)}</a></li>
          <li aria-current="page">洗護知識庫</li>
        </ol>
      </nav>
      <section class="section page-hero">
        <div class="page-shell grid two">
        <div class="hero-copy">
          <span class="eyebrow">洗護知識庫｜問題 → 服務 → LINE</span>
          <h1>洗鞋、洗包與衣物床被收送知識庫</h1>
          <p class="lead">先選你手上的物件與狀況，讀直接答案與處理界線，再前往對應服務或用 LINE 傳照片。鞋子問題優先整理在最前面。</p>
          ${lastmod ? `<p class="last-updated">內容更新：<time datetime="${lastmod}">${lastmod}</time></p>` : ""}
          <div class="button-row">
            <a class="button brand" href="#knowledge-shoes">先看鞋子問題</a>
            <a class="button secondary" href="${escapeHtml(lineCta)}">LINE 傳照片</a>
            <a class="button secondary" href="tel:${escapeHtml(profile.telephone)}">${escapeHtml(profile.telephone_local)}</a>
          </div>
        </div>
        <div class="hero-visual">
          <span class="eyebrow">這個知識庫怎麼用</span>
          <div class="answer-box">
            <p>每一頁先給直接答案與處理界線，再連到對應服務；拿不準就把整體、近照與材質位置拍下來傳 LINE。</p>
          </div>
        </div>
        </div>
      </section>
      <section class="section">
        <div class="page-shell">
          <div class="section-header">
            <span class="eyebrow">服務入口</span>
            <h2>直接找服務</h2>
            <p class="section-copy">問題頁負責說明狀況；服務頁負責價格邊界、收件方式與下一步。</p>
          </div>
          <div class="grid four">
            ${serviceCards}
          </div>
        </div>
      </section>
      ${answerGroups}
    </main>
    ${renderSiteFooter(index, chrome)}
  </body>
</html>
`;
}

function buildNotFoundHtml(index: PublicPostIndex): string {
  const homeHref = index.canonical_url;
  return `<!doctype html>
<html lang="zh-Hant-TW">
  <head>
    <meta charset="utf-8" />
    ${buildLegacyPathRedirectScript(index)}
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, follow" />
    <meta http-equiv="refresh" content="0; url=${escapeHtml(homeHref)}" />
    <link rel="canonical" href="${escapeHtml(homeHref)}" />
    <script>window.location.replace(${JSON.stringify(homeHref)});</script>
    <style>${buildPublicSiteCss()}
      .not-found-hero { min-height: 100vh; display: grid; place-items: center; padding: 64px 20px; }
      .not-found-panel { max-width: 760px; margin: 0 auto; text-align: center; }
      .not-found-panel h1 { font-size: clamp(3.2rem, 8vw, 6.8rem); line-height: 0.96; margin-bottom: 20px; }
      .not-found-panel p { color: var(--color-muted); font-size: 1.2rem; line-height: 1.7; margin: 0 auto 30px; max-width: 620px; }
    </style>
    <title>${escapeHtml(`${SITE_NAME} | Page moved`)}</title>
    ${buildAnalyticsTag(index.ga4_measurement_id)}
  </head>
  <body>
    <main class="not-found-hero">
      <section class="not-found-panel">
        <span class="eyebrow">Page moved</span>
        <h1>回到私享家首頁。</h1>
        <p>這個網址可能多了 docs 或少了專案路徑，系統會自動帶你回到私享家洗衣店的公開 SEO / AEO / GEO 主站。</p>
        <a class="button brand" href="${escapeHtml(homeHref)}">回到首頁</a>
      </section>
    </main>
  </body>
</html>
`;
}

function buildServicePageHtml(service: ServicePageDefinition, index: PublicPostIndex): string {
  const profile = index.business_profile;
  const serviceSource = { section: "services" as const, slug: service.slug };
  const lineCta = trackedLineUrl(index, { ...serviceSource, placement: "cta" });
  const lineFooter = trackedLineUrl(index, { ...serviceSource, placement: "footer" });
  const canonical = servicePageUrl(service, index);
  const serviceSchema = buildServicePageSchema(service, index);
  const image = findServiceImage(service, index);
  const imageSrc = image ? visibleImageSrc(image, index, true) : "";
  const localShoePage =
    service.slug === "shoe-bag-care"
      ? SUPPORT_PAGE_DEFINITIONS.find((page) => page.slug === "qinghai-road-shoe-cleaning")
      : undefined;
  // R4: body interlink (nav already lists every service) only on the two named pages.
  const priceListPage = findServiceBySlug(PRICE_LIST_SLUG);
  const showPriceListInterlink =
    Boolean(priceListPage) &&
    (service.slug === "shoe-bag-care" || service.slug === "taichung-xitun-laundry");
  const homeHref = index.base_url_configured ? index.canonical_url : "../index.html";
  const businessProfileHref = index.base_url_configured ? index.entrypoints.business_profile : "../business-profile.json";
  const chrome: SiteChromeOptions = {
    homeHref,
    servicesHref: `${homeHref}#services`,
    knowledgeHref: knowledgeHubHref(index, true),
    lineNavHref: lineCta,
    lineFooterHref: lineFooter,
    businessProfileHref,
    serviceHref: (item) => servicePageUrl(item, index),
    navLabel: "服務與資料入口"
  };
  const description = escapeHtml(service.description);
  const lastUpdatedMarkup = service.content_lastmod
    ? `\n          <p class="last-updated">內容更新：<time datetime="${escapeHtml(service.content_lastmod)}">${escapeHtml(service.content_lastmod)}</time></p>`
    : "";
  const caseStudies = service.case_studies
    .map(
      (study) => `<article class="card">
              <span class="eyebrow">${escapeHtml(study.label)}｜${escapeHtml(study.object)}</span>
              <h3>${escapeHtml(study.concern)}</h3>
              <p><strong>材質：</strong>${escapeHtml(study.material)}</p>
              <p><strong>門市先看：</strong>${escapeHtml(study.inspection)}</p>
              <p><strong>處理界線：</strong>${escapeHtml(study.boundary)}</p>
            </article>`
    )
    .join("\n");
  const inspectionTable =
    service.inspection_table && service.inspection_table.length > 0
      ? `<section class="section">
        <div class="page-shell">
          <div class="section-header">
            <span class="eyebrow">材質與風險</span>
            <h2>材質與風險判斷</h2>
          </div>
          <div class="table-wrap">
            <table class="comparison-table">
              <thead>
                <tr>
                  <th>位置</th>
                  <th>門市會看什麼</th>
                  <th>處理前要先說清楚</th>
                </tr>
              </thead>
              <tbody>
                ${service.inspection_table
                  .map(
                    (row) => `<tr>
                  <td>${escapeHtml(row.item)}</td>
                  <td>${escapeHtml(row.focus)}</td>
                  <td>${escapeHtml(row.risk)}</td>
                </tr>`
                  )
                  .join("\n")}
              </tbody>
            </table>
          </div>
        </div>
      </section>`
      : "";
  const priceTableIdByHeading: Record<string, string> = {
    鞋類: "shoes",
    包類: "bags",
    衣物寢具: "clothing"
  };
  const hasPriceTables = Boolean(service.price_tables && service.price_tables.length > 0);
  // R2②: three <table>s immediately after the opening answer; not lists.
  const priceTablesSection =
    hasPriceTables && service.price_tables
      ? `<section class="section" id="price-list">
        <div class="page-shell">
          <div class="section-header">
            <span class="eyebrow">參考價</span>
            <h2>分類參考價目表</h2>
            <p class="section-copy">${escapeHtml(PRICE_LIST_DISCLAIMER)}</p>
          </div>
          ${service.price_tables
            .map((table) => {
              const tableId = priceTableIdByHeading[table.heading] ?? table.heading;
              return `<h3>${escapeHtml(table.heading)}</h3>
          <p class="section-copy">${escapeHtml(PRICE_LIST_DISCLAIMER)}</p>
          <div class="table-wrap">
            <table class="comparison-table" id="price-table-${escapeHtml(tableId)}">
              <caption>${escapeHtml(table.heading)}參考價</caption>
              <thead>
                <tr>
                  <th>項目</th>
                  <th>參考價</th>
                </tr>
              </thead>
              <tbody>
                ${table.rows
                  .map(
                    (row) => `<tr>
                  <td>${escapeHtml(row.item)}</td>
                  <td>${escapeHtml(row.price)}</td>
                </tr>`
                  )
                  .join("\n")}
              </tbody>
            </table>
          </div>`;
            })
            .join("\n")}
        </div>
      </section>`
      : "";
  const caseStorySection = hasPriceTables
    ? ""
    : `<section class="section surface">
        <div class="page-shell">
          <div class="section-header">
            <span class="eyebrow">門市判斷情境</span>
            <h2>${escapeHtml(service.case_story.label)}</h2>
            <p>以下為常見送件情境與處理界線，用於協助送洗前判斷；不是特定客戶成果，也不代表效果保證。</p>
          </div>
          <p class="lead">${escapeHtml(service.case_story.situation)}</p>
          <div class="grid three">${caseStudies}</div>
        </div>
      </section>`;
  const directlyRelatedGuides = SUPPORT_PAGE_DEFINITIONS.filter((page) => page.service_slug === service.slug);
  const generalPhotoGuide = SUPPORT_PAGE_DEFINITIONS.find((page) => page.slug === "photo-before-laundry");
  const relatedGuides = hasPriceTables
    ? []
    : directlyRelatedGuides.length > 0
      ? directlyRelatedGuides
      : generalPhotoGuide
        ? [generalPhotoGuide]
        : [];
  const relatedGuidesSection =
    relatedGuides.length > 0
      ? `<section class="section surface">
        <div class="page-shell">
          <div class="section-header">
            <span class="eyebrow">相關指南</span>
            <h2>相關送洗指南</h2>
            <p class="section-copy">先看對應的判斷步驟，再用 LINE 傳照片詢問。</p>
          </div>
          <div class="grid three">
            ${relatedGuides
              .map(
                (page) => `<article class="card">
              <h3><a href="${escapeHtml(supportPageUrl(page, index))}">${escapeHtml(page.h1)}</a></h3>
              <p>${escapeHtml(page.summary)}</p>
            </article>`
              )
              .join("\n")}
          </div>
        </div>
      </section>`
      : "";

  return `<!doctype html>
<html lang="zh-Hant-TW">
  <head>
    <meta charset="utf-8" />
    ${buildLegacyPathRedirectScript(index)}
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${description}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <meta name="googlebot" content="index, follow, max-image-preview:large" />
    <meta name="author" content="${escapeHtml(profile.name)}" />
    <meta name="theme-color" content="#f5f5f7" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <link rel="alternate" hreflang="zh-Hant-TW" href="${escapeHtml(canonical)}" />
    <link rel="alternate" hreflang="x-default" href="${escapeHtml(canonical)}" />
    <link rel="alternate" type="application/json" href="${escapeHtml(businessProfileHref)}" />
    <link rel="alternate" type="application/json" href="${escapeHtml(index.base_url_configured ? index.entrypoints.services : "../services.json")}" />
    <link rel="alternate" type="application/json" href="${escapeHtml(index.base_url_configured ? index.entrypoints.answers : "../answers.json")}" />
    <link rel="alternate" type="application/json" href="${escapeHtml(index.base_url_configured ? index.entrypoints.geo_targets : "../geo-targets.json")}" />
    <link rel="alternate" type="application/json" href="${escapeHtml(index.base_url_configured ? index.entrypoints.search_visibility : "../search-visibility.json")}" />
    <meta property="og:title" content="${escapeHtml(service.title)}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:site_name" content="${escapeHtml(profile.name)}" />
    <meta property="og:locale" content="${escapeHtml(SITE_LOCALE)}" />
    ${image ? `<meta property="og:image" content="${escapeHtml(image.image_url)}" />` : ""}
    ${image ? `<meta property="og:image:alt" content="${escapeHtml(service.image_alt)}" />` : ""}
    <meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />
    <meta name="twitter:title" content="${escapeHtml(service.title)}" />
    <meta name="twitter:description" content="${description}" />
    ${image ? `<meta name="twitter:image" content="${escapeHtml(image.image_url)}" />` : ""}
    ${image ? `<meta name="twitter:image:alt" content="${escapeHtml(service.image_alt)}" />` : ""}
    ${serviceSchema ? `<script type="application/ld+json">${escapeJsonLd(serviceSchema)}</script>` : ""}
    <style>${buildPublicSiteCss()}</style>
    <title>${escapeHtml(service.title)}</title>
    ${buildAnalyticsTag(index.ga4_measurement_id)}
    ${buildSearchContentAnalyticsTag(index, true)}
  </head>
  <body ${searchAnalyticsBodyAttributes("service", service.slug)}>
    ${renderSiteHeader(index, chrome)}
    <main>
      <nav class="breadcrumb" aria-label="麵包屑">
        <ol>
          <li><a href="${escapeHtml(homeHref)}">${escapeHtml(profile.name)}</a></li>
          <li aria-current="page">${escapeHtml(service.name)}</li>
        </ol>
      </nav>
      <section class="section page-hero">
        <div class="page-shell grid two">
        <div class="hero-copy">
          <span class="eyebrow">${escapeHtml(serviceAreaServedName(service))}｜${escapeHtml(service.name)}</span>
          <h1>${escapeHtml(service.h1)}</h1>
          <p class="lead">${escapeHtml(service.summary)}</p>${lastUpdatedMarkup}
          <div class="button-row">
            <a class="button brand" href="${escapeHtml(lineCta)}">LINE 詢問</a>
            <a class="button secondary" href="#faq">常見問題</a>
          </div>
          ${
            localShoePage
              ? `<p class="section-copy">逢甲或西屯生活圈找洗鞋店，可先看<a href="${escapeHtml(
                  supportPageUrl(localShoePage, index)
                )}">逢甲洗鞋與西屯洗鞋的門市位置、案例界線與收送方式</a>，再決定到店或約收送。</p>`
              : ""
          }
          ${
            showPriceListInterlink && priceListPage
              ? `<p class="section-copy">查台中洗衣、洗鞋、洗包多少錢，可先看<a href="${escapeHtml(
                  servicePageUrl(priceListPage, index)
                )}">台中洗衣價目表</a>；頁上是參考價，實際以檢視為準。</p>`
              : ""
          }
        </div>
        <div class="hero-visual">
          <span class="eyebrow">先講重點</span>
          <div class="answer-box">
            <p>${escapeHtml(service.answer_summary)}</p>
          </div>
        ${
          image
            ? `<figure class="service-photo">
          ${responsiveImageHtml({
            imagePath: image.image_path,
            src: imageSrc,
            alt: service.image_alt,
            fallbackSize: SERVICE_IMAGE_FALLBACK_SIZE,
            loading: "eager",
            fetchpriority: "high"
          })}
          <figcaption>${escapeHtml(image.topic)}｜${escapeHtml(service.image_note)}</figcaption>
        </figure>`
            : ""
        }
        </div>
        </div>
      </section>
      ${priceTablesSection}
      ${caseStorySection}
      <section class="section surface">
        <div class="page-shell grid two">
          <div>
            <h2>${escapeHtml(service.name)}服務重點</h2>
            <div class="grid two">
            ${service.sections
              .map(
                (section) => `<article class="card">
              <h3>${escapeHtml(section.heading)}</h3>
              <p>${escapeHtml(section.body)}</p>
            </article>`
              )
              .join("\n")}
            </div>
          </div>
          <aside class="card">
            <h2>店家資訊</h2>
            <p>${escapeHtml(profile.name)}｜${escapeHtml(profile.address_text)}（${escapeHtml(profile.landmark)}）</p>
            <p>電話：<a href="tel:${escapeHtml(profile.telephone)}">${escapeHtml(profile.telephone_local)}</a>｜LINE：${escapeHtml(profile.mobile_or_line_local)}</p>
            <p>營業時間：${escapeHtml(profile.opening_hours_text)}</p>
            <div class="link-row">
              <a href="${escapeHtml(profile.map_url)}">Google Maps</a>
              <a href="${escapeHtml(lineFooter)}">LINE</a>
              <a href="${escapeHtml(profile.facebook_url)}">Facebook</a>
              <a href="${escapeHtml(profile.instagram_url)}">Instagram</a>
            </div>
          </aside>
        </div>
      </section>
      ${inspectionTable}
      ${relatedGuidesSection}
      <section class="section" id="faq">
        <div class="page-shell">
          <div class="section-header">
            <span class="eyebrow">常見問題</span>
            <h2>常見問題</h2>
          </div>
          <div class="grid three">
            ${service.faqs
              .map(
                (faq) => `<article class="card">
              <h3>${escapeHtml(faq.question)}</h3>
              <p>${escapeHtml(faq.answer)}</p>
            </article>`
              )
              .join("\n")}
          </div>
        </div>
      </section>
    </main>
    ${renderSiteFooter(index, chrome)}
  </body>
</html>
`;
}

function buildSupportPageHtml(page: SupportPageDefinition, index: PublicPostIndex): string {
  const profile = index.business_profile;
  const supportSection: LinePageSection = page.category === "local" ? "local" : "guide";
  const supportSource = { section: supportSection, slug: page.slug };
  const lineNav = trackedLineUrl(index, { ...supportSource, placement: "nav" });
  const lineCta = trackedLineUrl(index, { ...supportSource, placement: "cta" });
  const lineInline = trackedLineUrl(index, { ...supportSource, placement: "inline" });
  const canonical = supportPageUrl(page, index);
  const supportSchema = buildSupportPageSchema(page, index);
  const service = requireLinkedSupportService(page);
  const serviceHref = servicePageUrl(service, index);
  const acceptedGrowthPage = INDEX_GROWTH_SLUGS.has(page.slug);
  const homeHref = index.base_url_configured ? index.canonical_url : page.path.startsWith("local/") ? "../index.html" : "../index.html";
  const relativePrefix = page.path.includes("/") ? "../" : "";
  const businessProfileHref = index.base_url_configured ? index.entrypoints.business_profile : `${relativePrefix}business-profile.json`;
  const servicesHref = index.base_url_configured ? index.entrypoints.services : `${relativePrefix}services.json`;
  const answersHref = index.base_url_configured ? index.entrypoints.answers : `${relativePrefix}answers.json`;
  const searchVisibilityHref = index.base_url_configured
    ? index.entrypoints.search_visibility
    : `${relativePrefix}search-visibility.json`;
  const chrome: SiteChromeOptions = {
    homeHref,
    servicesHref: `${homeHref}#services`,
    knowledgeHref: knowledgeHubHref(index, true),
    lineNavHref: lineNav,
    lineFooterHref: lineNav,
    businessProfileHref,
    serviceHref: (item) => servicePageUrl(item, index),
    navLabel: "支援內容"
  };
  const description = escapeHtml(page.description);
  const image = supportPageImage(page, index);
  const imageSrc = image ? visibleImageSrc(image, index, Boolean(relativePrefix)) : "";
  const imageAlt = image ? supportPageImageAlt(page, image) : "";
  const lastUpdatedMarkup = page.content_lastmod
    ? `\n          <p class="last-updated">內容更新：<time datetime="${escapeHtml(page.content_lastmod)}">${escapeHtml(page.content_lastmod)}</time></p>`
    : "";
  const serviceHeroLink = acceptedGrowthPage
    ? ""
    : `            <a class="button secondary" href="${escapeHtml(serviceHref)}">${escapeHtml(service.name)}</a>\n`;
  const stepItems = page.steps
    .map(
      (step, index) => `<article class="card">
              <div class="eyebrow">Step ${index + 1}</div>
              <h3>${escapeHtml(step.name)}</h3>
              <p>${escapeHtml(step.text)}</p>
            </article>`
    )
    .join("\n");
  const faqItems = page.faqs
    .map(
      (faq) => `<article class="card">
              <h3>${escapeHtml(faq.question)}</h3>
              <p>${escapeHtml(faq.answer)}</p>
            </article>`
    )
    .join("\n");
  const extraSections = (page.sections ?? [])
    .map(
      (section) => `<article class="card">
              <h3>${escapeHtml(section.heading)}</h3>
              <p>${escapeHtml(section.body)}</p>
            </article>`
    )
    .join("\n");
  const keywordChips = page.keywords.map((keyword) => `<span class="chip">${escapeHtml(keyword)}</span>`).join("\n");
  const relatedGuidePages = (page.related_slugs ?? [])
    .map((slug) => SUPPORT_PAGE_DEFINITIONS.find((entry) => entry.slug === slug))
    .filter((entry): entry is SupportPageDefinition => Boolean(entry));
  const pickupService = findServiceBySlug("taichung-citywide-laundry-pickup");
  const priceListService = findServiceBySlug(PRICE_LIST_SLUG);
  const serviceSearchGuide = SUPPORT_PAGE_DEFINITIONS.find((entry) => entry.slug === "taichung-laundry-service-search");
  const relatedGuidesMarkup =
    relatedGuidePages.length > 0
      ? `<div class="link-row" data-related-guides>
              ${relatedGuidePages
                .map(
                  (entry) =>
                    `<a href="${escapeHtml(supportPageUrl(entry, index))}">${escapeHtml(entry.h1)}</a>`
                )
                .join("\n")}
              ${
                pickupService
                  ? `<a href="${escapeHtml(servicePageUrl(pickupService, index))}">${escapeHtml(pickupService.name)}</a>`
                  : ""
              }
              ${
                priceListService
                  ? `<a href="${escapeHtml(servicePageUrl(priceListService, index))}">${escapeHtml(priceListService.name)}</a>`
                  : ""
              }
              ${
                serviceSearchGuide && serviceSearchGuide.slug !== page.slug
                  ? `<a href="${escapeHtml(supportPageUrl(serviceSearchGuide, index))}">${escapeHtml(serviceSearchGuide.h1)}</a>`
                  : ""
              }
            </div>`
      : "";

  return `<!doctype html>
<html lang="zh-Hant-TW">
  <head>
    <meta charset="utf-8" />
    ${buildLegacyPathRedirectScript(index)}
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${description}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <meta name="googlebot" content="index, follow, max-image-preview:large" />
    <meta name="author" content="${escapeHtml(profile.name)}" />
    <meta name="theme-color" content="#f5f5f7" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <link rel="alternate" hreflang="zh-Hant-TW" href="${escapeHtml(canonical)}" />
    <link rel="alternate" hreflang="x-default" href="${escapeHtml(canonical)}" />
    <link rel="alternate" type="application/json" href="${escapeHtml(businessProfileHref)}" />
    <link rel="alternate" type="application/json" href="${escapeHtml(servicesHref)}" />
    <link rel="alternate" type="application/json" href="${escapeHtml(answersHref)}" />
    <link rel="alternate" type="application/json" href="${escapeHtml(searchVisibilityHref)}" />
    <meta property="og:title" content="${escapeHtml(page.title)}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:site_name" content="${escapeHtml(profile.name)}" />
    <meta property="og:locale" content="${escapeHtml(SITE_LOCALE)}" />
    ${image ? `<meta property="og:image" content="${escapeHtml(image.image_url)}" />` : ""}
    ${image ? `<meta property="og:image:alt" content="${escapeHtml(imageAlt)}" />` : ""}
    <meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />
    <meta name="twitter:title" content="${escapeHtml(page.title)}" />
    <meta name="twitter:description" content="${description}" />
    ${image ? `<meta name="twitter:image" content="${escapeHtml(image.image_url)}" />` : ""}
    ${image ? `<meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}" />` : ""}
    ${supportSchema ? `<script type="application/ld+json">${escapeJsonLd(supportSchema)}</script>` : ""}
    <style>${buildPublicSiteCss()}</style>
    <title>${escapeHtml(page.title)}</title>
    ${buildAnalyticsTag(index.ga4_measurement_id)}
    ${buildSearchContentAnalyticsTag(index, true)}
  </head>
  <body ${searchAnalyticsBodyAttributes("answer", page.slug)}>
    ${renderSiteHeader(index, chrome)}
    <main>
      <nav class="breadcrumb" aria-label="麵包屑">
        <ol>
          <li><a href="${escapeHtml(homeHref)}">${escapeHtml(profile.name)}</a></li>
          <li aria-current="page">${escapeHtml(page.h1)}</li>
        </ol>
      </nav>
      <section class="section page-hero">
        <div class="page-shell grid two">
        <div class="hero-copy">
          <span class="eyebrow">${page.category === "local" ? "在地指南" : "洗護指南"}</span>
          <h1>${escapeHtml(page.h1)}</h1>
          <p class="lead">${escapeHtml(page.summary)}</p>${lastUpdatedMarkup}
          <div class="button-row">
            <a class="button brand" href="${escapeHtml(lineCta)}">LINE 詢問</a>
${serviceHeroLink}          </div>
          <div class="chip-row local-query-row">
            ${keywordChips}
          </div>
        </div>
        <div class="hero-visual">
          <span class="eyebrow">直接答案</span>
          <div class="answer-box">
            <p>${escapeHtml(page.citation_answer ?? page.description)}</p>
          </div>
          <p class="muted">這段是可直接引用的答案；下方的判斷步驤與門市說明會把處理界線講清楚，拿不準就先傳照片。</p>
        ${
          image
            ? `<figure class="service-photo">
          ${responsiveImageHtml({
            imagePath: image.image_path,
            src: imageSrc,
            alt: imageAlt,
            fallbackSize: SERVICE_IMAGE_FALLBACK_SIZE,
            loading: "eager",
            fetchpriority: "high"
          })}
          <figcaption>${escapeHtml(image.topic)}</figcaption>
        </figure>`
            : ""
        }
        </div>
        </div>
      </section>
      <section class="section surface">
        <div class="page-shell">
          <div class="section-header">
            <span class="eyebrow">怎麼判斷</span>
            <h2>先把狀態判斷清楚。</h2>
            <p class="section-copy">${escapeHtml(page.description)}</p>
          </div>
          <div class="grid three">
            ${stepItems}
          </div>
        </div>
      </section>
      ${
        extraSections
          ? `<section class="section">
        <div class="page-shell">
          <div class="section-header">
            <span class="eyebrow">${page.category === "local" ? "在地細節" : "門市判斷"}</span>
            <h2>${page.category === "local" ? "門市位置、案例界線與收送" : "門市判斷與處理界線"}</h2>
          </div>
          <div class="grid three">
            ${extraSections}
          </div>
        </div>
      </section>`
          : ""
      }
      <section class="section">
        <div class="page-shell grid two">
          <div>
            <h2>對應服務</h2>
            <p class="section-copy">${escapeHtml(page.local_intent)}</p>
            <div class="link-row">
              <a href="${escapeHtml(serviceHref)}" data-parent-service>${escapeHtml(service.name)}</a>
              <a href="${escapeHtml(lineInline)}">傳照片詢問</a>
            </div>${relatedGuidesMarkup ? `\n            ${relatedGuidesMarkup}` : ""}
          </div>
          <aside class="card">
            <h2>店家資料</h2>
            <p>${escapeHtml(profile.name)}</p>
            <p>${escapeHtml(profile.address_text)}</p>
            <p><a href="tel:${escapeHtml(profile.telephone)}">${escapeHtml(profile.telephone_local)}</a>｜${escapeHtml(profile.mobile_or_line_local)}</p>
            <p>${escapeHtml(profile.opening_hours_text)}</p>
          </aside>
        </div>
      </section>
      <section class="section surface" id="faq">
        <div class="page-shell">
          <div class="section-header">
            <span class="eyebrow">常見問題</span>
            <h2>常見問題</h2>
          </div>
          <div class="grid three">
            ${faqItems}
          </div>
        </div>
      </section>
    </main>
    ${renderSiteFooter(index, chrome)}
  </body>
</html>
`;
}

function postToDiscoveryRecord(post: PublicPost, index: PublicPostIndex): object {
  return {
    id: post.id,
    date: post.date,
    date_published: post.date_published,
    slot: post.slot,
    time: post.time,
    title: post.title,
    topic: post.topic,
    visual_route: post.visual_route,
    traffic_route: post.traffic_route,
    content_role: post.content_role,
    search_intent: post.search_intent,
    target_queries: post.target_queries,
    evidence_type: post.evidence_type,
    hashtags: post.hashtags,
    platforms: post.platforms,
    image_url: post.image_url,
    image_urls: post.image_urls,
    carousel_items: post.carousel_items,
    media_type: post.media_type,
    video_url: post.video_url,
    calendar_url: post.calendar_url,
    article_url: hasArticlePage(post, index) ? post.article_url : "",
    facebook_caption: post.facebook_caption,
    instagram_caption: post.instagram_caption
  };
}

function buildAiDiscovery(index: PublicPostIndex): object {
  const profile = index.business_profile;
  const publishedPosts = [...index.posts].reverse();
  return {
    schema_version: "2026-07-02",
    standard_level: "standard",
    generated_at: index.generated_at,
    website: {
      name: index.site_name,
      business_name: profile.name,
      url: index.canonical_url,
      base_url: index.base_url,
      description: index.description,
      timezone: index.timezone,
      locale: SITE_LOCALE,
      map_url: profile.map_url,
      google_maps_feature_id: profile.google_maps_feature_id,
      google_maps_cid: profile.google_maps_cid,
      google_place_id: profile.google_place_id,
      facebook_url: profile.facebook_url,
      facebook_share_url: profile.facebook_share_url,
      instagram_url: profile.instagram_url,
      line_url: profile.line_url
    },
    business_profile: profile,
    local_search_targets: {
      primary_queries: LOCAL_SEARCH_QUERY_TARGETS,
      primary_area: profile.address.addressLocality,
      street_anchor: "青海路二段",
      canonical_url: index.canonical_url,
      intent_note:
        "Use these as local SEO/AEO/GEO query anchors for people searching laundry, shoe cleaning, bag cleaning, white shoe cleaning, and fabric storage near Taichung Xitun."
    },
    search_visibility: {
      source_url: index.entrypoints.search_visibility,
      query_clusters: SEARCH_INTENT_CLUSTERS.map((cluster) => cluster.id),
      review_checkpoints: AI_VISIBILITY_REVIEW_28D.checkpoints.map((checkpoint) => checkpoint.day),
      measurement_note: "Brand mention, linked citation, cited URL, answer accuracy, referral, LINE inquiry, and booking are separate fields."
    },
    entrypoints: index.entrypoints,
    recommended_read_order: [
      index.entrypoints.llms,
      knowledgeHubUrl(index),
      index.entrypoints.services,
      index.entrypoints.answers,
      index.entrypoints.geo_targets,
      index.entrypoints.search_visibility,
      ...SERVICE_PAGE_DEFINITIONS.map((service) => servicePageUrl(service, index)),
      ...SUPPORT_PAGE_DEFINITIONS.map((page) => supportPageUrl(page, index)),
      index.entrypoints.latest,
      index.entrypoints.knowledge_graph,
      index.entrypoints.feed,
      index.entrypoints.llms_jsonl,
      index.entrypoints.llms_full
    ],
    capabilities: {
      supports_daily_updates: true,
      supports_incremental_feed: true,
      supports_json_ld_knowledge_graph: true,
      supports_full_context: true,
      supports_service_records: true,
      supports_answer_records: true,
      supports_geo_targets: true,
      supports_search_intent_clusters: true,
      supports_28_day_ai_visibility_review: true,
      supports_support_pages: true,
      supports_jsonl_ingestion: true,
      update_frequency: "daily"
    },
    open_graph: index.open_graph,
    structured_data: buildBusinessSchema(index),
    service_pages: SERVICE_PAGE_DEFINITIONS.map((service) => {
      const image = findServiceImage(service, index);
      return {
        slug: service.slug,
        name: service.name,
        title: service.title,
        description: service.description,
        url: servicePageUrl(service, index),
        keywords: service.keywords,
        answer_summary: service.answer_summary,
        image_url: image?.image_url ?? "",
        image_alt: service.image_alt,
        image_note: service.image_note,
        case_story: service.case_story,
        case_studies: service.case_studies,
        faq_count: service.faqs.length
      };
    }),
    support_pages: SUPPORT_PAGE_DEFINITIONS.map((page) => ({
      slug: page.slug,
      category: page.category,
      title: page.title,
      description: page.description,
      url: supportPageUrl(page, index),
      keywords: page.keywords,
      local_intent: page.local_intent,
      linked_service: linkedSupportService(page)?.name ?? "",
      faq_count: page.faqs.length,
      step_count: page.steps.length
    })),
    content_contract: {
      cadence: "Two daily social slots at 11:30 and 20:30 Asia/Taipei.",
      fields: [
        "date",
        "slot",
        "time",
        "topic",
        "content_role",
        "visual_route",
        "traffic_route",
        "search_intent",
        "target_queries",
        "evidence_type",
        "hashtags",
        "facebook_caption",
        "instagram_caption",
        "image_url",
        "calendar_url",
        "article_url"
      ],
      daily_article_policy: {
        min_visible_chars: POST_ARTICLE_MIN_VISIBLE_CHARS,
        min_caption_chars: POST_ARTICLE_MIN_CAPTION_CHARS,
        behavior:
          "Each approved post renders as a daily article (summary, store note, checklist, material table, next step, FAQ, related). Only articles that clear the thickness gate carry index robots and enter sitemap.xml, rss.xml and the posts hub; the rest stay noindex, follow.",
        indexable_article_count: indexablePostArticles(index).length,
        article_count: index.article_posts.length
      },
      homepage_archive_policy: {
        expanded_recent_days: HOME_EXPANDED_RECENT_DAYS,
        expanded_behavior: "Homepage renders approved posts from the newest seven content dates directly.",
        archive_behavior: "Older approved posts stay in SEO/AEO/GEO data and render inside a collapsed homepage archive."
      },
      omitted_until_verified: ["google_place_id", "holiday_hours_overrides"]
    },
    data_quality: {
      public_base_url_configured: index.base_url_configured,
      post_count: index.posts.length,
      latest_date: index.latest_date,
      all_posts_have_images: index.posts.every((post) => Boolean(post.image_url)),
      all_posts_have_hashtags: index.posts.every((post) => post.hashtags.length > 0),
      all_posts_have_routes: index.posts.every((post) => Boolean(post.visual_route && post.traffic_route)),
      all_posts_have_content_roles: index.posts.every((post) => Boolean(post.content_role)),
      posts_with_search_intent: index.posts.filter((post) => Boolean(post.search_intent)).length,
      posts_with_target_queries: index.posts.filter((post) => post.target_queries.length > 0).length,
      posts_with_evidence_type: index.posts.filter((post) => Boolean(post.evidence_type)).length
    },
    latest_date: index.latest_date,
    latest_posts: index.posts
      .filter((post) => post.date === index.latest_date)
      .map((post) => postToDiscoveryRecord(post, index)),
    recent_posts: publishedPosts.slice(0, 30).map((post) => postToDiscoveryRecord(post, index)),
    published_posts: index.posts.map((post) => postToDiscoveryRecord(post, index))
  };
}

export async function generatePublicSite(options: GeneratePublicSiteOptions = {}): Promise<string[]> {
  const root = projectRoot(options.root);
  const config = getConfig();
  const siteBaseUrl = normalizeBaseUrl(options.siteBaseUrl ?? options.baseUrl ?? config.publicSiteBaseUrl);
  if (options.deployment) {
    assertProductionPublicSiteBaseUrl(siteBaseUrl);
  }
  const imageBaseUrl = normalizeBaseUrl(options.imageBaseUrl ?? options.baseUrl ?? config.publicImageBaseUrl) ?? siteBaseUrl;
  const businessProfile = await loadBusinessProfile(root);
  const generatedAt = (options.now ? new Date(options.now) : new Date()).toISOString();
  const publishThroughDate = getZonedDateParts(new Date(generatedAt), config.timezone).date;
  const dates = await listContentDates(root);
  const calendars = await Promise.all(
    dates.map(async (date) => {
      const calendar = await readPrivateDailyContent(date, root);
      if (!calendar) return undefined;
      if (calendar.date !== date) {
        await removePublicContentCalendar(date, root);
        throw new Error(`Content calendar date mismatch: filename ${date} does not match calendar.date ${calendar.date}.`);
      }
      if (date > publishThroughDate) {
        await removePublicContentCalendar(date, root);
        return undefined;
      }

      const approvals = await loadApprovalLog(date, root);
      const approvedSlots = calendar.slots.filter((slot) => isSlotFullyApproved(approvals, slot.slot));
      let publicSlots: DailySlot[];
      try {
        publicSlots = approvedSlots.map((slot) =>
          slotWithAvailablePublicMedia(date, slot, root, options.statPublicAsset ?? statSync)
        );
      } catch (error) {
        await removePublicContentCalendar(date, root);
        throw error;
      }
      await writeApprovedPublicContentCalendar(calendar, publicSlots, root);
      return { calendar, approvedSlots: publicSlots };
    })
  );
  const posts = calendars.flatMap((record) =>
    record ? record.approvedSlots.map((slot) => slotToPublicPost(record.calendar.date, slot, siteBaseUrl, imageBaseUrl)) : []
  );
  posts.sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot);
  const articlePosts = uniqueArticlePosts(posts);

  const index: PublicPostIndex = {
    generated_at: generatedAt,
    site_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    timezone: config.timezone,
    ga4_measurement_id: config.ga4MeasurementId ?? "",
    base_url: siteBaseUrl ?? "",
    base_url_configured: Boolean(siteBaseUrl),
    image_base_url: imageBaseUrl ?? "",
    image_base_url_configured: Boolean(imageBaseUrl),
    canonical_url: canonicalUrl(siteBaseUrl),
    latest_date: posts.at(-1)?.date ?? "",
    open_graph: {
      title: "",
      description: "",
      type: "",
      url: "",
      site_name: "",
      image: "",
      image_alt: "",
      locale: ""
    },
    entrypoints: {
      index: publicUrl("index.html", siteBaseUrl),
      llms: publicUrl("llms.txt", siteBaseUrl),
      llms_lite: publicUrl("llms-lite.txt", siteBaseUrl),
      llms_full: publicUrl("llms-full.txt", siteBaseUrl),
      well_known_llms: publicUrl(".well-known/llms.txt", siteBaseUrl),
      well_known_ai: publicUrl(".well-known/ai.json", siteBaseUrl),
      robots: publicUrl("robots.txt", siteBaseUrl),
      sitemap: publicUrl("sitemap.xml", siteBaseUrl),
      ai_sitemap: publicUrl("ai-sitemap.xml", siteBaseUrl),
      latest: publicUrl("latest.json", siteBaseUrl),
      social_posts: publicUrl("social-posts.json", siteBaseUrl),
      business_profile: publicUrl("business-profile.json", siteBaseUrl),
      services: publicUrl("services.json", siteBaseUrl),
      answers: publicUrl("answers.json", siteBaseUrl),
      geo_targets: publicUrl("geo-targets.json", siteBaseUrl),
      search_visibility: publicUrl("search-visibility.json", siteBaseUrl),
      llms_jsonl: publicUrl("llms.jsonl", siteBaseUrl),
      service_pages: Object.fromEntries(
        SERVICE_PAGE_DEFINITIONS.map((service) => [service.slug, publicUrl(servicePagePath(service), siteBaseUrl)])
      ),
      support_pages: Object.fromEntries(
        SUPPORT_PAGE_DEFINITIONS.map((page) => [page.slug, publicUrl(page.path, siteBaseUrl)])
      ),
      feed: publicUrl("feed.json", siteBaseUrl),
      rss: publicUrl("rss.xml", siteBaseUrl),
      knowledge_graph: publicUrl("knowledge-graph.json", siteBaseUrl),
      ai_discovery: publicUrl("ai-discovery.json", siteBaseUrl)
    },
    business_profile: businessProfile,
    posts,
    article_posts: articlePosts
  };
  index.open_graph = buildOpenGraph(index);

  const latestDate = index.latest_date;
  const latest = {
    generated_at: generatedAt,
    site_name: index.site_name,
    description: index.description,
    timezone: config.timezone,
    base_url: index.base_url,
    base_url_configured: index.base_url_configured,
    canonical_url: index.canonical_url,
    date: latestDate ?? "",
    posts: latestDate ? posts.filter((post) => post.date === latestDate) : []
  };

  const docsRoot = join(root, "docs");
  const wellKnownRoot = join(docsRoot, ".well-known");
  const servicesRoot = join(docsRoot, "services");
  const guidesRoot = join(docsRoot, "guides");
  const localRoot = join(docsRoot, "local");
  const knowledgeRoot = join(docsRoot, "knowledge");
  const scriptsRoot = join(docsRoot, "scripts");
  const postsRoot = join(docsRoot, "posts");
  const goRoot = join(docsRoot, "go");
  const compatibilityDocsRoot = join(docsRoot, "docs");
  await mkdir(docsRoot, { recursive: true });
  await mkdir(wellKnownRoot, { recursive: true });
  await mkdir(servicesRoot, { recursive: true });
  await mkdir(guidesRoot, { recursive: true });
  await mkdir(localRoot, { recursive: true });
  await mkdir(knowledgeRoot, { recursive: true });
  await mkdir(scriptsRoot, { recursive: true });
  await mkdir(postsRoot, { recursive: true });
  await mkdir(goRoot, { recursive: true });
  await mkdir(compatibilityDocsRoot, { recursive: true });
  setActiveDocsRoot(docsRoot);
  await generateWebpDerivatives(index, docsRoot);
  const indexNowKey = configuredIndexNowKey(root);

  const outputs = {
    socialPosts: join(docsRoot, "social-posts.json"),
    businessProfile: join(docsRoot, "business-profile.json"),
    latest: join(docsRoot, "latest.json"),
    services: join(docsRoot, "services.json"),
    answers: join(docsRoot, "answers.json"),
    geoTargets: join(docsRoot, "geo-targets.json"),
    searchVisibility: join(docsRoot, "search-visibility.json"),
    llmsJsonl: join(docsRoot, "llms.jsonl"),
    feed: join(docsRoot, "feed.json"),
    rss: join(docsRoot, "rss.xml"),
    knowledgeGraph: join(docsRoot, "knowledge-graph.json"),
    aiDiscovery: join(docsRoot, "ai-discovery.json"),
    llms: join(docsRoot, "llms.txt"),
    llmsLite: join(docsRoot, "llms-lite.txt"),
    llmsFull: join(docsRoot, "llms-full.txt"),
    wellKnownLlms: join(wellKnownRoot, "llms.txt"),
    wellKnownAi: join(wellKnownRoot, "ai.json"),
    robots: join(docsRoot, "robots.txt"),
    sitemap: join(docsRoot, "sitemap.xml"),
    aiSitemap: join(docsRoot, "ai-sitemap.xml"),
    index: join(docsRoot, "index.html"),
    knowledgeHub: join(docsRoot, KNOWLEDGE_HUB_FILE),
    searchContentAnalytics: join(docsRoot, SEARCH_CONTENT_ANALYTICS_PATH),
    notFound: join(docsRoot, "404.html"),
    lineRedirect: join(goRoot, "line.html"),
    compatibilityDocsIndex: join(compatibilityDocsRoot, "index.html"),
    ...Object.fromEntries(
      SERVICE_PAGE_DEFINITIONS.map((service) => [`servicePage-${service.slug}`, join(servicesRoot, `${service.slug}.html`)])
    ),
    ...Object.fromEntries(SUPPORT_PAGE_DEFINITIONS.map((page) => [`supportPage-${page.slug}`, join(docsRoot, page.path)])),
    nojekyll: join(docsRoot, ".nojekyll")
  };
  // publishPages mirrors docs/ into the root Pages repo by clearing it first, so a CNAME that
  // only lived in the repo settings would be wiped on the next publish. Emit it as part of the
  // build whenever the site is served from a custom domain.
  const cnameHost = customDomainHost(siteBaseUrl);
  if (cnameHost) await writeFile(join(docsRoot, "CNAME"), `${cnameHost}\n`, "utf8");
  else await unlink(join(docsRoot, "CNAME")).catch(() => undefined);

  await writeJsonAtomic(outputs.socialPosts, index);
  await writeJsonAtomic(outputs.businessProfile, businessProfile);
  await writeJsonAtomic(outputs.latest, latest);
  await writeJsonAtomic(outputs.services, buildServicesJson(index));
  await writeJsonAtomic(outputs.answers, buildAnswersJson(index));
  await writeJsonAtomic(outputs.geoTargets, buildGeoTargetsJson(index));
  await writeJsonAtomic(outputs.searchVisibility, buildSearchVisibilityJson(index));
  await writeJsonAtomic(outputs.feed, buildJsonFeed(index));
  await writeFile(outputs.rss, buildRssXml(index), "utf8");
  await writeJsonAtomic(outputs.knowledgeGraph, buildKnowledgeGraph(index));
  const aiDiscovery = buildAiDiscovery(index);
  await writeJsonAtomic(outputs.aiDiscovery, aiDiscovery);
  await writeJsonAtomic(outputs.wellKnownAi, aiDiscovery);
  await writeFile(outputs.llms, buildLlmsText(index), "utf8");
  await writeFile(outputs.llmsLite, buildLlmsLiteText(index), "utf8");
  await writeFile(outputs.llmsFull, buildLlmsFullText(index), "utf8");
  await writeFile(outputs.llmsJsonl, buildLlmsJsonl(index), "utf8");
  await writeFile(outputs.wellKnownLlms, buildLlmsText(index), "utf8");
  await writeFile(outputs.robots, buildRobotsText(index), "utf8");
  await writeFile(outputs.sitemap, buildSitemapXml(index), "utf8");
  await writeFile(outputs.aiSitemap, buildAiSitemapXml(index), "utf8");
  const searchContentAnalytics = buildSearchContentAnalyticsScript();
  assertSearchContentAnalyticsScript(searchContentAnalytics);
  await writeFile(outputs.searchContentAnalytics, searchContentAnalytics, "utf8");
  if (indexNowKey) {
    const keyFileName = indexNowKeyFileName(indexNowKey);
    await writeFile(join(docsRoot, keyFileName), `${indexNowKey}\n`, "utf8");
    await unlink(join(docsRoot, "indexnow-key.txt")).catch(() => undefined);
    const docsEntries = await readdir(docsRoot);
    await Promise.all(
      docsEntries
        .filter((name) => name !== keyFileName && /^[A-Za-z0-9-]{8,128}\.txt$/.test(name))
        .map(async (name) => {
          const path = join(docsRoot, name);
          const content = await readFile(path, "utf8").catch(() => "");
          if (content.trim() === name.replace(/\.txt$/u, "")) await unlink(path);
        })
    );
  }
  await writeFile(outputs.index, buildIndexHtml(index), "utf8");
  await writeFile(outputs.knowledgeHub, buildKnowledgeHubHtml(index), "utf8");
  await writeFile(outputs.notFound, buildNotFoundHtml(index), "utf8");
  await writeFile(
    outputs.lineRedirect,
    buildLineRedirectHtml({
      lineUrl: businessProfile.line_url,
      measurementId: config.ga4MeasurementId
    }),
    "utf8"
  );
  await writeFile(outputs.compatibilityDocsIndex, buildNotFoundHtml(index), "utf8");
  await Promise.all(
    SERVICE_PAGE_DEFINITIONS.map((service) =>
      writeFile(join(servicesRoot, `${service.slug}.html`), buildServicePageHtml(service, index), "utf8")
    )
  );
  await Promise.all(
    SUPPORT_PAGE_DEFINITIONS.map((page) => writeFile(join(docsRoot, page.path), buildSupportPageHtml(page, index), "utf8"))
  );
  const postArticleOutputs = await writePostArticlePages(articlePosts, index, postsRoot);
  await writeFile(outputs.nojekyll, "", "utf8");

  return [...Object.values(outputs), ...postArticleOutputs];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outputs = await generatePublicSite({
    root: getOption(args, "root"),
    baseUrl: getOption(args, "base-url"),
    siteBaseUrl: getOption(args, "site-base-url"),
    imageBaseUrl: getOption(args, "image-base-url"),
    deployment: true
  });
  console.log(`Public site indexes ready:\n${outputs.map((output) => `- ${output}`).join("\n")}`);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
