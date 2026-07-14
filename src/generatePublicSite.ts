import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getOption, isMain } from "./cli";
import { getConfig, hasUsablePublicImageBaseUrl } from "./config";
import { hasApprovedPost, loadApprovalLog, readJsonFile, writeJsonAtomic } from "./logging";
import { contentCalendarPath, docsContentCalendarPath, projectRoot, publicAssetPath } from "./paths";
import type { ApprovalLogEntry, DailyContent, DailySlot, Platform } from "./types";

interface GeneratePublicSiteOptions {
  root?: string;
  baseUrl?: string;
  siteBaseUrl?: string;
  imageBaseUrl?: string;
  now?: string | Date;
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
  hashtags: string[];
  platforms: string[];
  in_language: string;
  image_path: string;
  image_url: string;
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
    llms_jsonl: string;
    service_pages: Record<string, string>;
    support_pages: Record<string, string>;
    feed: string;
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
  faqs: ServiceFaq[];
}

interface SupportPageDefinition {
  slug: string;
  path: string;
  category: "guide" | "local";
  title: string;
  description: string;
  h1: string;
  summary: string;
  keywords: string[];
  service_slug?: string;
  local_intent: string;
  steps: Array<{ name: string; text: string }>;
  faqs: ServiceFaq[];
}

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
const SITE_TITLE = "私享家洗衣店｜台中西屯青海路洗衣、洗鞋、洗包、布品收納";
const SITE_DESCRIPTION =
  "私享家洗衣店位於台中市西屯區青海路二段365號，提供衣物洗護、鞋子清潔、包包清潔與布品收納。可先用 LINE 傳照片詢問，電話 04-2452-7411。";
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
const AI_DO_NOT_INFER_RULES = [
  "Do not infer pricing.",
  "Do not guarantee that white shoes can be fully whitened.",
  "Do not claim that stains, odor, mold, yellowing, or dark marks can always be fully removed.",
  "Do not infer Google review count or rating unless verified from a live Google source.",
  "Do not infer holiday hours or temporary closures.",
  "Use business-profile.json and the service pages as the source of record for business facts."
] as const;
const HOME_EXPANDED_RECENT_DAYS = 7;
const HOME_DEPTH_BACKGROUNDS = [
  {
    className: "depth-laundry",
    path: "assets/backgrounds/premium-laundry-depth.png"
  },
  {
    className: "depth-shoe-bag",
    path: "assets/backgrounds/shoe-bag-care-depth.png"
  },
  {
    className: "depth-white-shoe",
    path: "assets/backgrounds/white-shoe-depth.png"
  },
  {
    className: "depth-fabric",
    path: "assets/backgrounds/fabric-storage-depth.png"
  },
  {
    className: "depth-local-store",
    path: "assets/backgrounds/local-store-depth.png"
  }
] as const;
const LOCAL_SEARCH_QUERY_TARGETS = [
  "洗衣店",
  "台中洗衣店",
  "西屯洗衣店",
  "台中西屯洗衣店",
  "青海路洗衣店",
  "台中西屯洗鞋",
  "台中西屯洗包",
  "台中西屯白鞋清潔",
  "台中西屯布品收納"
] as const;
const SERVICE_PAGE_DEFINITIONS: ServicePageDefinition[] = [
  {
    slug: "shoe-bag-care",
    name: "鞋包清潔",
    title: "鞋包清潔｜台中西屯洗鞋、洗包與材質照護｜私享家洗衣店",
    description:
      "台中西屯鞋包清潔與洗鞋洗包諮詢，私享家洗衣店會先看鞋面、鞋底、包角、提把、內裡與材質狀態，再判斷適合的清潔方式。",
    h1: "鞋包清潔",
    summary:
      "鞋子和包包常見問題不只表面髒，還包括包角水痕、鞋底泥灰、提把油痕、內裡濕氣與材質摩擦痕。私享家會先看材質、位置與痕跡深度，再決定是清潔、局部整理、通風觀察，還是需要先提醒客人可改善的限度。",
    keywords: ["鞋包清潔", "洗鞋", "洗包", "包包清潔", "鞋子清潔", "台中西屯鞋包清潔", "青海路洗鞋"],
    image_hint: "鞋包",
    image_alt: "鞋包清潔前的包角、鞋面與皮革檢查主圖",
    image_note: "AI 生成的高擬真產品風格主圖，用於呈現鞋包清潔前的包角、鞋面、皮革水痕與邊緣檢查情境；不是實際客戶物件照片。",
    static_image_path: "assets/services/shoe-bag-care-hero-product.png",
    static_image_topic: "鞋包清潔前的包角、鞋面與皮革檢查主圖",
    static_image_source: "ai-generated premium product hero image",
    answer_summary:
      "台中西屯洗鞋洗包建議先拍鞋面、鞋底、包角、提把與內裡，私享家會依材質、濕氣、水痕與磨耗程度判斷清潔方式與可改善範圍。",
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
      }
    ]
  },
  {
    slug: "white-shoe-cleaning",
    name: "白鞋清潔",
    title: "白鞋清潔｜台中西屯白鞋泛黃、鞋邊與內裡整理｜私享家洗衣店",
    description:
      "台中西屯白鞋清潔諮詢，針對白鞋泛黃、鞋邊泛灰、縫線卡灰、內裡濕悶與鞋墊狀態，私享家洗衣店先判斷材質再處理。",
    h1: "白鞋清潔",
    summary:
      "白鞋泛灰、泛黃或有悶味，不一定適合硬刷或漂白。鞋面、膠邊、縫線、鞋墊與內裡吸附狀態不同，處理前要先分開檢查，尤其是膠邊氧化和材質磨耗，要先說清楚可改善的限度。",
    keywords: ["白鞋清潔", "白鞋保養", "白鞋泛黃", "鞋邊泛灰", "台中西屯白鞋清潔", "青海路洗鞋"],
    image_hint: "白鞋",
    image_alt: "白鞋清潔前的鞋邊、縫線與內裡檢查主圖",
    image_note: "AI 生成的高擬真產品風格主圖，用於呈現白鞋清潔前的鞋邊、縫線、皮革鞋面與內裡檢查情境；不是實際客戶物件照片。",
    static_image_path: "assets/services/white-shoe-cleaning-hero-product.png",
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
      "台中西屯布品收納與換季整理建議，私享家洗衣店協助檢查衣物、外套、寢具、被套與厚棉布品在收納前的濕氣、味道與髒污。",
    h1: "布品收納",
    summary:
      "布品收納不是把東西折好放進櫃子就結束。收納前要先確認濕氣、汗味、灰塵、黃斑、寢具接觸皮膚的位置與清潔狀態，避免下次拿出來才發現霉味或局部痕跡變深。",
    keywords: ["布品收納", "換季收納", "衣物收納", "寢具清潔", "外套清潔", "台中西屯布品整理"],
    image_hint: "布品",
    image_alt: "外套、寢具與布品收納前檢查主圖",
    image_note: "AI 生成的高擬真產品風格主圖，用於呈現外套、寢具與布品收納前檢查情境；不是實際客戶物件照片。",
    static_image_path: "assets/services/fabric-storage-hero-product.png",
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
    keywords: ["台中西屯洗衣店", "青海路洗衣店", "西屯洗衣", "台中洗鞋", "台中洗包", "私享家洗衣店"],
    image_hint: "私享家",
    image_alt: "私享家洗衣店台中西屯青海路服務導覽",
    image_note: "台中西屯青海路洗衣、洗鞋、洗包與布品收納服務導覽頁。",
    allow_image_fallback: false,
    answer_summary:
      "私享家洗衣店位於台中市西屯區青海路二段365號，提供衣物洗護、鞋包清潔、白鞋清潔與布品收納前檢查，可先用 LINE 傳照片詢問。",
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
        heading: "在地位置",
        body:
          "店址在台中市西屯區青海路二段365號，附近生活圈常見需求包含通勤鞋雨後清潔、上班包包提把和包角整理、換季外套與寢具收納前檢查。"
      },
      {
        heading: "詢問流程",
        body:
          "可以先用 LINE 傳照片，不需要一開始就決定服務項目。門市會先看物件狀態，再回覆建議方向、可改善範圍和是否適合送洗。"
      },
      {
        heading: "社群內容也會同步成搜尋資料",
        body:
          "審核通過的 Facebook 與 Instagram 貼文會同步進公開 SEO / AIO / GEO feed，讓日常門市案例、雨季提醒、節日海報和服務頁互相連回官方內容來源。"
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
        answer: "會。排程產生且審核通過的 FB / IG 貼文會同步成公開 SEO / AIO / GEO 資料，讓服務頁和日常案例互相補強。"
      }
    ]
  }
];

const SUPPORT_PAGE_DEFINITIONS: SupportPageDefinition[] = [
  {
    slug: "photo-before-laundry",
    path: "guides/photo-before-laundry.html",
    category: "guide",
    title: "送洗前怎麼拍照片詢問？｜私享家洗衣店",
    description: "送洗前先拍整體、局部、材質與最在意的痕跡，私享家洗衣店才能更準確判斷衣物、鞋子、包包或布品是否適合整理。",
    h1: "送洗前怎麼拍照片詢問？",
    summary: "先用照片把物件狀態說清楚，比只問價錢更有用。私享家會依材質、髒污來源、濕氣與磨耗狀態先做初步判斷。",
    keywords: ["送洗前拍照", "LINE 詢問洗衣店", "台中西屯洗衣店", "青海路洗衣店"],
    local_intent: "台中西屯 送洗前 LINE 詢問",
    steps: [
      { name: "拍整體", text: "先拍完整正面或整體外觀，讓門市知道物件類型、大小與主要材質。" },
      { name: "拍局部", text: "再拍污漬、泛黃、水痕、包角、鞋邊或領口袖口等局部近照。" },
      { name: "拍使用位置", text: "鞋子拍鞋內與鞋底，包包拍提把和四角，外套寢具拍標籤和容易悶住的位置。" },
      { name: "說明期待", text: "告訴我們最在意的是味道、痕跡、泛黃、收納前整理，還是材質保護。" }
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
    description: "白鞋泛黃不一定只是髒污，可能和材質、膠邊、氧化、濕氣與清潔方式有關。整理前先判斷鞋面、鞋邊與內裡狀態。",
    h1: "白鞋泛黃怎麼判斷？",
    summary: "白鞋清潔要先分清楚是表面髒污、膠邊氧化、內裡濕悶，還是材質本身變色，避免用錯方式讓鞋面變毛或膠痕更明顯。",
    keywords: ["白鞋泛黃", "白鞋清潔", "台中西屯白鞋清潔", "鞋子保養"],
    service_slug: "white-shoe-cleaning",
    local_intent: "台中西屯 白鞋泛黃 白鞋清潔",
    steps: [
      { name: "看鞋面", text: "確認鞋面是皮革、布面、網布還是合成材質。" },
      { name: "看鞋邊", text: "檢查膠邊是否泛黃、磨耗或有清潔後留下的刷痕。" },
      { name: "看內裡", text: "檢查鞋內濕氣、鞋墊能否拆卸，以及是否有悶味。" },
      { name: "決定方式", text: "依材質選擇清潔和整理方式，不先用漂白水或硬刷處理。" }
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
    slug: "rainy-shoe-care",
    path: "guides/rainy-shoe-care.html",
    category: "guide",
    title: "雨天鞋子進水後怎麼辦？｜私享家洗衣店",
    description: "雨天通勤後鞋內濕氣、鞋底泥灰和鞋邊水痕容易被忽略。先通風、不要悶放，再判斷是否需要專業清潔。",
    h1: "雨天鞋子進水後怎麼辦？",
    summary: "鞋子淋雨後最怕直接收進鞋櫃。濕氣留在鞋內、鞋墊和縫線附近，會讓味道與水痕更難處理。",
    keywords: ["雨天鞋子保養", "鞋子進水", "雨季保養", "台中洗鞋"],
    service_slug: "shoe-bag-care",
    local_intent: "台中西屯 雨天鞋子清潔",
    steps: [
      { name: "先通風", text: "回家後先放在通風處，不要直接塞進密閉鞋櫃。" },
      { name: "取出鞋墊", text: "能拆的鞋墊先取出，讓內部濕氣散出。" },
      { name: "拍鞋邊", text: "拍鞋底邊緣、鞋面水痕和鞋內照片給門市判斷。" },
      { name: "避免高溫", text: "不要用高溫烘或曬到變形，材質可能變硬或變色。" }
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
    title: "包包提把與包角髒了怎麼判斷？｜私享家洗衣店",
    description: "包包提把、包角和底部常先累積手汗、水痕、摩擦和灰塵。整理前要先看材質與痕跡是否已滲入。",
    h1: "包包提把與包角髒了怎麼判斷？",
    summary: "包包不是只有表面擦一擦。提把、包角、底部和五金附近，常見的是手汗、摩擦、水痕與材質吸附混在一起。",
    keywords: ["包包清潔", "包包提把清潔", "包角清潔", "台中西屯洗包"],
    service_slug: "shoe-bag-care",
    local_intent: "台中西屯 包包清潔",
    steps: [
      { name: "看材質", text: "先分辨皮革、尼龍、帆布、麂皮或合成材質。" },
      { name: "看提把", text: "提把容易累積手汗和摩擦，拍近照才能判斷深淺。" },
      { name: "看包角", text: "包角如果已磨損或退色，處理目標會和單純表面髒污不同。" },
      { name: "看內裡", text: "內裡味道、粉塵和水痕也會影響整理方式。" }
    ],
    faqs: [
      {
        question: "包包提把髒了可以只清提把嗎？",
        answer: "要看材質與髒污範圍。有些狀況可以局部處理，有些則需要搭配整體清潔，避免色差太明顯。"
      },
      {
        question: "包角磨損能洗掉嗎？",
        answer: "磨損不是髒污，清潔只能處理表面髒和部分水痕，磨耗本身需另外評估。"
      }
    ]
  },
  {
    slug: "bedding-storage-check",
    path: "guides/bedding-storage-check.html",
    category: "guide",
    title: "寢具外套收納前要檢查什麼？｜私享家洗衣店",
    description: "寢具、外套與厚棉布品收納前，先檢查領口袖口、腋下、棉被邊角、濕氣和悶味，避免收起來後味道變重。",
    h1: "寢具外套收納前要檢查什麼？",
    summary: "換季收納前不是只要摺好。厚棉布品、外套和寢具如果帶著汗味、濕氣或局部髒污收進袋子，下一季拿出來會更明顯。",
    keywords: ["布品收納", "寢具收納", "外套收納", "換季清潔"],
    service_slug: "fabric-storage",
    local_intent: "台中西屯 布品收納 寢具清潔",
    steps: [
      { name: "看高接觸處", text: "外套先看領口、袖口、腋下和口袋邊。" },
      { name: "看厚棉邊角", text: "棉被、毯子和厚布品先看邊角、折線和收納袋內側。" },
      { name: "聞悶味", text: "有悶味代表可能有濕氣或使用痕跡，不建議直接封存。" },
      { name: "再收納", text: "整理後再收進透氣或乾燥的收納方式，降低下一季異味。"}
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
    slug: "qinghai-road-shoe-cleaning",
    path: "local/qinghai-road-shoe-cleaning.html",
    category: "local",
    service_slug: "shoe-bag-care",
    title: "青海路附近洗鞋洗包服務｜私享家洗衣店",
    description: "私享家洗衣店位於台中市西屯區青海路二段，提供白鞋清潔、鞋包照護、衣物洗護與布品收納，可先用 LINE 傳照片詢問。",
    h1: "青海路附近洗鞋洗包服務",
    summary: "如果你在青海路二段、西屯區附近找洗鞋、洗包或洗衣店，可以先把鞋邊、包角、提把、衣物標籤和髒污位置拍給私享家判斷。",
    keywords: ["青海路洗衣店", "青海路洗鞋", "台中西屯洗鞋", "西屯洗包"],
    local_intent: "青海路 洗鞋 洗包 洗衣店",
    steps: [
      { name: "確認位置", text: "店址在台中市西屯區青海路二段365號。" },
      { name: "先傳照片", text: "鞋子、包包、衣物和布品都可以先傳照片判斷方向。" },
      { name: "看服務類型", text: "白鞋清潔、鞋包照護、衣物洗護和布品收納都有對應服務頁。" },
      { name: "再決定送洗", text: "確認材質和狀態後，再決定是否值得整理與怎麼處理。" }
    ],
    faqs: [
      {
        question: "青海路附近可以先用 LINE 問洗鞋嗎？",
        answer: "可以，建議拍鞋面、鞋邊、鞋底和鞋內照片，讓門市先判斷狀態。"
      },
      {
        question: "私享家洗衣店有洗包包嗎？",
        answer: "有提供鞋包照護相關服務，包包會先看材質、包角、提把和內裡狀態。"
      }
    ]
  }
];

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
      }
    ]
  },
  {
    heading: "依地區找服務",
    intro: "把店家位置和生活圈寫成可讀內容，讓搜尋引擎與 AI 清楚知道私享家洗衣店服務的是台中西屯、青海路與周邊客人的實際送洗需求。",
    items: [
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
        label: "逢甲與西屯通勤後",
        description: "適合雨後鞋底泥灰、包角水痕、外套汗味與換季收納前檢查。",
        serviceSlug: "taichung-xitun-laundry"
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
    heading: "1. 拍照詢問",
    body: "先拍整體、近照、材質位置與最在意的痕跡，尤其是鞋邊、包角、提把、領口、袖口與寢具接觸皮膚的位置。"
  },
  {
    heading: "2. 門市判斷",
    body: "門市先看是表面灰塵、潮氣、油痕、氧化、材質磨耗或長時間收納造成的味道，再決定是否適合整理。"
  },
  {
    heading: "3. 再決定送洗",
    body: "能整理到什麼程度先說清楚，避免客人以為所有痕跡都能變成全新，也避免不必要的處理。"
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

function canonicalUrl(baseUrl: string | undefined): string {
  return baseUrl ? `${baseUrl}/` : "index.html";
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
    identifier: identifiers,
    contactPoint: [
      {
        "@type": "ContactPoint",
        telephone: profile.telephone,
        contactType: "customer service",
        areaServed: "TW",
        availableLanguage: ["zh-Hant"]
      },
      {
        "@type": "ContactPoint",
        telephone: profile.mobile_or_line,
        url: profile.line_url,
        contactType: "LINE / mobile estimates",
        areaServed: "TW",
        availableLanguage: ["zh-Hant"]
      }
    ],
    openingHours: profile.opening_hours_schema,
    openingHoursSpecification: profile.opening_hours_specification,
    ...(specialOpeningHoursSpecification.length > 0 ? { specialOpeningHoursSpecification } : {}),
    hasMap: profile.map_url,
    sameAs: [profile.facebook_url, profile.instagram_url, profile.line_url],
    image: images,
    areaServed: [
      {
        "@type": "Country",
        name: "Taiwan"
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
          areaServed: "台中西屯",
          url: servicePageUrl(service, index)
        }
      }))
    }
  };
  return schema;
}

function buildHomePageSchema(index: PublicPostIndex): object | undefined {
  const business = buildBusinessSchema(index);
  if (!business) return undefined;

  const businessNode = { ...(business as Record<string, unknown>) };
  delete businessNode["@context"];

  return {
    "@context": "https://schema.org",
    "@graph": [
      businessNode,
      {
        "@type": "WebSite",
        "@id": `${index.canonical_url}#website`,
        name: index.business_profile.name,
        alternateName: SITE_TITLE,
        url: index.canonical_url,
        inLanguage: "zh-Hant-TW",
        description: SITE_DESCRIPTION,
        publisher: { "@id": `${index.canonical_url}#business` }
      },
      {
        "@type": "WebPage",
        "@id": `${index.canonical_url}#webpage`,
        url: index.canonical_url,
        name: SITE_TITLE,
        description: SITE_DESCRIPTION,
        inLanguage: "zh-Hant-TW",
        isPartOf: { "@id": `${index.canonical_url}#website` },
        about: { "@id": `${index.canonical_url}#business` },
        ...(index.open_graph.image
          ? {
              primaryImageOfPage: {
                "@type": "ImageObject",
                contentUrl: index.open_graph.image,
                caption: index.open_graph.image_alt
              }
            }
          : {}),
        dateModified: index.generated_at
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

function postHumanUrl(post: PublicPost, index: PublicPostIndex): string {
  return hasArticlePage(post, index) ? post.article_url : post.calendar_url;
}

function indexNowKeyFileName(key: string): string {
  if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) {
    throw new Error("INDEXNOW_KEY must be 8-128 letters, numbers, or hyphens.");
  }
  return `${key}.txt`;
}

function findServiceBySlug(slug: string): ServicePageDefinition | undefined {
  return SERVICE_PAGE_DEFINITIONS.find((service) => service.slug === slug);
}

function linkedSupportService(page: SupportPageDefinition): ServicePageDefinition | undefined {
  return page.service_slug ? findServiceBySlug(page.service_slug) : undefined;
}

function homeDiscoveryItemUrl(item: HomeDiscoveryItem, index: PublicPostIndex): string {
  if (item.serviceSlug) {
    const service = findServiceBySlug(item.serviceSlug);
    if (service) return servicePageUrl(service, index);
  }
  return item.href ?? index.canonical_url;
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

function primaryHomeImage(index: PublicPostIndex): PublicImageReference | undefined {
  const fabricService = findServiceBySlug("fabric-storage");
  if (fabricService) {
    const fabricImage = findServiceImage(fabricService, index);
    if (fabricImage) return fabricImage;
  }
  return index.posts[0] ? postImageReference(index.posts[0]) : undefined;
}

function buildServicePageSchema(service: ServicePageDefinition, index: PublicPostIndex): object | undefined {
  const business = buildBusinessSchema(index);
  if (!business) return undefined;

  const canonical = servicePageUrl(service, index);
  const image = findServiceImage(service, index);
  const businessNode = { ...(business as Record<string, unknown>) };
  delete businessNode["@context"];

  return {
    "@context": "https://schema.org",
    "@graph": [
      businessNode,
      {
        "@type": "WebPage",
        "@id": `${canonical}#webpage`,
        url: canonical,
        name: service.title,
        description: service.description,
        inLanguage: "zh-Hant-TW",
        isPartOf: { "@id": `${index.canonical_url}#website` },
        about: { "@id": `${canonical}#service` },
        ...(image?.image_url
          ? {
              primaryImageOfPage: {
                "@type": "ImageObject",
                contentUrl: image.image_url,
                caption: service.image_alt
              }
            }
          : {}),
        dateModified: index.generated_at
      },
      {
        "@type": "Service",
        "@id": `${canonical}#service`,
        name: service.name,
        description: service.summary,
        serviceType: service.name,
        provider: { "@id": `${index.canonical_url}#business` },
        areaServed: {
          "@type": "AdministrativeArea",
          name: "台中西屯"
        },
        keywords: service.keywords
      },
      {
        "@type": "FAQPage",
        "@id": `${canonical}#faq`,
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

function buildSupportPageSchema(page: SupportPageDefinition, index: PublicPostIndex): object | undefined {
  const business = buildBusinessSchema(index);
  if (!business) return undefined;

  const canonical = supportPageUrl(page, index);
  const service = linkedSupportService(page);
  const serviceUrl = service ? servicePageUrl(service, index) : undefined;
  const businessNode = { ...(business as Record<string, unknown>) };
  delete businessNode["@context"];

  return {
    "@context": "https://schema.org",
    "@graph": [
      businessNode,
      {
        "@type": "WebPage",
        "@id": `${canonical}#webpage`,
        url: canonical,
        name: page.title,
        description: page.description,
        inLanguage: "zh-Hant-TW",
        isPartOf: { "@id": `${index.canonical_url}#website` },
        about: serviceUrl ? { "@id": `${serviceUrl}#service` } : { "@id": `${index.canonical_url}#business` },
        dateModified: index.generated_at
      },
      {
        "@type": "HowTo",
        "@id": `${canonical}#howto`,
        name: page.h1,
        description: page.summary,
        inLanguage: "zh-Hant-TW",
        totalTime: "PT5M",
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
  const expected = new Set(posts.map((post) => post.article_path.split("/").at(-1)!));
  const existing = await readdir(postsRoot);
  await Promise.all(
    existing
      .filter((name) => name.endsWith(".html") && !expected.has(name))
      .map((name) => unlink(join(postsRoot, name)))
  );

  const paths = posts.map((post) => join(postsRoot, post.article_path.split("/").at(-1)!));
  await Promise.all(paths.map((path, indexPosition) => writeFile(path, buildPostPageHtml(posts[indexPosition]!, index), "utf8")));
  return paths;
}

function slotToPublicPost(
  date: string,
  slot: DailySlot,
  siteBaseUrl: string | undefined,
  imageBaseUrl: string | undefined
): PublicPost {
  const imagePath = publicAssetPath(date, slot.slot);
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
    hashtags: extractHashtags(slot.facebook_caption, slot.instagram_caption),
    platforms: PLATFORM_NAMES,
    in_language: "zh-Hant",
    image_path: imagePath,
    image_url: publicUrl(imagePath, imageBaseUrl ?? siteBaseUrl),
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
  return `${profile.name}位於${profile.address_text}，主要服務台中西屯與青海路二段附近客人，內容涵蓋衣物洗護、鞋包清潔、白鞋清潔與布品收納。客人可先透過 LINE 傳照片，由門市依材質、髒污位置、濕氣與保存狀態做初步判斷；網站不提供未驗證價格、不保證完全洗白或完全去除所有痕跡。`;
}

function bestSourcePages(index: PublicPostIndex): Array<{ label: string; url: string }> {
  const shoeBagCare = findServiceBySlug("shoe-bag-care");
  const whiteShoeCleaning = findServiceBySlug("white-shoe-cleaning");
  const fabricStorage = findServiceBySlug("fabric-storage");
  const taichungXitunLaundry = findServiceBySlug("taichung-xitun-laundry");
  const photoBeforeLaundry = SUPPORT_PAGE_DEFINITIONS.find((page) => page.slug === "photo-before-laundry");
  return [
    { label: "Business profile", url: index.entrypoints.business_profile },
    ...(taichungXitunLaundry ? [{ label: "Local laundry service", url: servicePageUrl(taichungXitunLaundry, index) }] : []),
    ...(shoeBagCare ? [{ label: "Shoe and bag care", url: servicePageUrl(shoeBagCare, index) }] : []),
    ...(whiteShoeCleaning ? [{ label: "White shoe cleaning", url: servicePageUrl(whiteShoeCleaning, index) }] : []),
    ...(fabricStorage ? [{ label: "Fabric storage", url: servicePageUrl(fabricStorage, index) }] : []),
    ...(photoBeforeLaundry ? [{ label: "Photo-before-laundry guide", url: supportPageUrl(photoBeforeLaundry, index) }] : []),
    { label: "Answers", url: index.entrypoints.answers },
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
    `- [Answers JSON](${index.entrypoints.answers}): concise AIO/GEO answers for service and local-intent queries.`,
    `- [Geo targets JSON](${index.entrypoints.geo_targets}): local service areas, address anchors, and query-intent map for 台中西屯 searches.`,
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
    "- Cadence: two daily social slots, 11:30 and 19:30 Asia/Taipei.",
    "- Each post includes: date, slot, time, title, topic, visual_route, traffic_route, hashtags, image_url, calendar_url, facebook_caption, instagram_caption.",
    "- Use the business profile and structured data as the source of record for phone, hours, map, and social links.",
    "- Do not treat Google Maps CID as Google Place ID. Use google_place_id only when it is non-null.",
    "- Emit concrete holiday opening hours only from owner-verified holiday_hours_rule.overrides.",
    "- Use visual_route, traffic_route, and hashtags as observable labels for later performance analysis.",
    "",
    "## Business Data Sources",
    ...profile.source_notes.map((note) => `- ${note}`),
    "",
    "## Published Posts",
    ...(publishedPosts.length > 0 ? publishedPosts : []).flatMap((post) => [
      `- [${post.title}](${postHumanUrl(post, index)})`,
      `  platform targets: ${post.platforms.join(", ")}`,
      `  routes: visual_route=${post.visual_route}; traffic_route=${post.traffic_route}`,
      `  hashtags: ${post.hashtags.join(" ") || "(none)"}`,
      `  image: ${post.image_url}`,
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
    "- Performance labels are preserved as visual_route, traffic_route, and hashtags.",
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
  for (const crawler of AI_CRAWLERS) {
    lines.push(
      `User-agent: ${crawler}`,
      "Allow: /",
      "Allow: /llms.txt",
      "Allow: /llms-lite.txt",
      "Allow: /llms-full.txt",
      "Allow: /llms.jsonl",
      "Allow: /services.json",
      "Allow: /answers.json",
      "Allow: /geo-targets.json",
      "Allow: /feed.json",
      "Allow: /knowledge-graph.json",
      "Allow: /guides/",
      "Allow: /local/",
      ""
    );
  }
  if (index.base_url_configured) lines.push(`Sitemap: ${index.entrypoints.sitemap}`);
  else lines.push("# Sitemap URL will be absolute after PUBLIC_IMAGE_BASE_URL is configured.");
  return `${lines.join("\n")}\n`;
}

function buildSitemapXml(index: PublicPostIndex): string {
  const urls = index.base_url_configured
    ? [
        index.canonical_url,
        ...Object.values(index.entrypoints.service_pages),
        ...Object.values(index.entrypoints.support_pages),
        ...index.article_posts.map((post) => post.article_url)
      ]
    : [];
  const uniqueUrls = Array.from(new Set(urls));
  const items = uniqueUrls
    .map((url) => {
      const priority = url === index.canonical_url ? "1.0" : url.includes("/posts/") ? "0.6" : "0.7";
      const changefreq = url === index.canonical_url ? "weekly" : url.includes("/posts/") ? "never" : "monthly";
      return `  <url><loc>${escapeXml(url)}</loc><lastmod>${escapeXml(index.generated_at)}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
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
        { loc: index.entrypoints.geo_targets, purpose: "geo-target-records" },
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
        ...index.article_posts.map((post) => ({ loc: post.article_url, purpose: `published-post-${post.slot}` })),
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
    .map(
      (item) =>
        `  <url><loc>${escapeXml(item.loc)}</loc><lastmod>${escapeXml(index.generated_at)}</lastmod><changefreq>daily</changefreq><!-- ${escapeXml(item.purpose)} --></url>`
    )
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
    description: "Service-level SEO, AIO, and GEO source records for 私享家洗衣店.",
    canonical_url: index.canonical_url,
    business_profile_url: index.entrypoints.business_profile,
    services: SERVICE_PAGE_DEFINITIONS.map((service) => serviceToPublicRecord(service, index))
  };
}

function serviceLocalQueryName(service: ServicePageDefinition): string {
  return service.local_query_name ?? service.name;
}

function buildAnswersJson(index: PublicPostIndex): object {
  const profile = index.business_profile;
  const homeAnswers = [
    {
      id: "homepage-local-laundry-search",
      type: "local_search_answer",
      question: "搜尋台中西屯洗衣店時，私享家洗衣店提供哪些服務？",
      answer: `私享家洗衣店位於${profile.address_text}，主要服務台中西屯與青海路二段附近客人，提供衣物洗護、鞋包清潔、白鞋清潔與布品收納；可先用 LINE 傳照片詢問，再由門市依材質、髒污、濕氣與收納狀態判斷。`,
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
    const localQueryName = serviceLocalQueryName(service);
    return [
      {
        id: `${service.slug}-summary`,
        type: "service_summary",
        question: `台中西屯${localQueryName}要怎麼判斷？`,
        answer: service.answer_summary,
        service: service.name,
        source_url: url,
        local_intent: `台中西屯 ${localQueryName}`,
        image_url: findServiceImage(service, index)?.image_url ?? ""
      },
      ...service.faqs.map((faq, faqIndex) => ({
        id: `${service.slug}-faq-${String(faqIndex + 1).padStart(2, "0")}`,
        type: "faq",
        question: faq.question,
        answer: faq.answer,
        service: service.name,
        source_url: `${url}#faq`,
        local_intent: `台中西屯 ${localQueryName}`
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
    answers: [...homeAnswers, ...serviceAnswers, ...supportAnswers].map((answer) => addAnswerSafety(answer, profile))
  };
}

function buildGeoTargetsJson(index: PublicPostIndex): object {
  const profile = index.business_profile;
  const serviceAreas = [
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
    coordinates: {
      latitude: null,
      longitude: null,
      status: "not_verified"
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
        serviceAreas.map((area) => ({
          query: `${area.label} ${serviceLocalQueryName(service)}`,
          service: service.name,
          area: area.label,
          url: servicePageUrl(service, index),
          answer_summary: service.answer_summary
        }))
      ),
      ...SUPPORT_PAGE_DEFINITIONS.flatMap((page) =>
        serviceAreas.map((area) => ({
          query: `${area.label} ${page.local_intent}`,
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
      hashtags: post.hashtags,
      image_url: post.image_url,
      calendar_url: post.calendar_url
    }))
  ];

  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function buildKnowledgeGraph(index: PublicPostIndex): object {
  const business = buildBusinessSchema(index);
  const profile = index.business_profile;
  return {
    "@context": "https://schema.org",
    "@graph": [
      business,
      {
        "@type": "WebSite",
        "@id": `${index.canonical_url}#website`,
        name: SITE_NAME,
        url: index.canonical_url,
        inLanguage: "zh-Hant",
        description: SITE_DESCRIPTION
      },
      {
        "@type": "Dataset",
        "@id": `${index.canonical_url}#social-post-dataset`,
        name: `${profile.name} social post dataset`,
        description: SITE_DESCRIPTION,
        url: index.entrypoints.social_posts,
        dateModified: index.generated_at,
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
          {
            "@type": "Service",
            "@id": `${canonical}#service`,
            name: service.name,
            description: service.answer_summary,
            serviceType: service.name,
            provider: business ? { "@id": `${index.canonical_url}#business` } : undefined,
            areaServed: {
              "@type": "AdministrativeArea",
              name: "台中西屯"
            },
            keywords: service.keywords,
            url: canonical
          },
          {
            "@type": "FAQPage",
            "@id": `${canonical}#faq`,
            url: `${canonical}#faq`,
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
            keywords: page.keywords
          },
          {
            "@type": "HowTo",
            "@id": `${canonical}#howto`,
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
      --bg: #f5f5f7;
      --surface: #ffffff;
      --surface-soft: #fbfbfd;
      --surface-dark: #050505;
      --surface-dark-soft: #151516;
      --ink: #1d1d1f;
      --muted: #6e6e73;
      --muted-strong: #424245;
      --line: #d2d2d7;
      --line-soft: rgba(0, 0, 0, 0.08);
      --accent: #0066cc;
      --accent-soft: #e8f2ff;
      --shadow: 0 28px 90px rgba(0, 0, 0, 0.12);
      --max: 1180px;
    }
    * { box-sizing: border-box; }
    html { max-width: 100%; scroll-behavior: smooth; overflow-x: hidden; }
    body {
      width: 100%;
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif;
      line-height: 1.58;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
      overflow-x: hidden;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; text-underline-offset: 4px; }
    img { display: block; max-width: 100%; height: auto; background: #e8e8ed; }
    main { width: 100%; margin: 0; overflow: hidden; }
    address { font-style: normal; }
    .topbar {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 22px;
      min-height: 46px;
      padding: 0 max(22px, calc((100vw - var(--max)) / 2));
      background: rgba(245, 245, 247, 0.82);
      border-bottom: 1px solid var(--line-soft);
      backdrop-filter: saturate(180%) blur(18px);
    }
    .brand { font-weight: 650; color: var(--ink); text-decoration: none; letter-spacing: 0; white-space: nowrap; }
    .nav { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px 22px; font-size: 0.82rem; }
    .nav a {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      color: var(--muted-strong);
      text-decoration: none;
    }
    .nav a:hover { color: var(--ink); text-decoration: none; }
    .section-inner { width: min(var(--max), calc(100% - 44px)); min-width: 0; margin: 0 auto; }
    .product-hero {
      text-align: center;
      padding: 78px 0 0;
      background: var(--surface);
    }
    .hero-dark {
      background: var(--surface-dark);
      color: #f5f5f7;
    }
    .hero-light { background: var(--surface); color: var(--ink); }
    .hero-copy {
      width: min(900px, 100%);
      min-width: 0;
      margin: 0 auto;
      padding: 0 0 34px;
    }
    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 12px;
      margin-top: 24px;
    }
    .primary-link, .secondary-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 42px;
      padding: 8px 19px;
      border-radius: 999px;
      font-weight: 620;
      text-decoration: none;
    }
    .primary-link { background: var(--accent); color: #fff; }
    .secondary-link { color: var(--accent); background: transparent; }
    .primary-link:hover, .secondary-link:hover { text-decoration: none; }
    h1, h2, h3 {
      line-height: 1.25;
      letter-spacing: 0;
      overflow-wrap: anywhere;
      text-wrap: balance;
    }
    h1 { margin: 0 0 16px; font-size: 5.85rem; font-weight: 720; letter-spacing: 0; }
    h2 { margin: 0; font-size: 3.28rem; font-weight: 710; letter-spacing: 0; }
    h3 { margin: 0 0 10px; font-size: 1.18rem; font-weight: 680; }
    .lead { margin: 0 auto; max-width: 780px; color: var(--muted); font-size: 1.42rem; font-weight: 430; line-height: 1.45; }
    p, li, figcaption, .lead, .answer-box, .card {
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .hero-dark .lead, .hero-dark .eyebrow, .hero-dark figcaption { color: rgba(245, 245, 247, 0.72); }
    .meta-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 24px 0 0; }
    .chip {
      display: inline-flex;
      align-items: center;
      min-height: 30px;
      padding: 5px 11px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.08);
      color: inherit;
      text-decoration: none;
    }
    .hero-light .chip, .chip.on-light {
      border-color: rgba(0, 0, 0, 0.08);
      background: rgba(255, 255, 255, 0.72);
      color: var(--muted-strong);
    }
    .hero-media, .service-photo, .product-visual {
      width: min(1120px, calc(100% - 44px));
      margin: 0 auto;
    }
    .hero-media img, .service-photo img, .product-visual img {
      width: 100%;
      aspect-ratio: 16 / 9;
      object-fit: cover;
      border-radius: 8px;
      box-shadow: var(--shadow);
    }
    .hero-media figcaption, .service-photo figcaption, .product-visual figcaption {
      max-width: 760px;
      padding: 14px 0 0;
      margin: 0 auto;
      line-height: 1.7;
      overflow-wrap: anywhere;
    }
    .product-band { padding: 96px 0; border-top: 1px solid var(--line-soft); background: var(--bg); }
    .product-band.surface { background: var(--surface); }
    ${HOME_DEPTH_BACKGROUNDS.map((background) => `.${background.className} { --depth-image: url("${background.path}"); }`).join("\n    ")}
    .depth-band {
      position: relative;
      isolation: isolate;
      overflow: hidden;
    }
    .depth-band::before {
      content: "";
      position: absolute;
      inset: 0;
      z-index: 0;
      background-image: var(--depth-image);
      background-size: min(980px, 74vw) auto;
      background-repeat: no-repeat;
      background-position: 100% center;
      opacity: 0.72;
      transform: scale(1.04);
      filter: saturate(0.98) contrast(1.08);
      mix-blend-mode: multiply;
      -webkit-mask-image: linear-gradient(90deg, transparent 0%, rgba(0, 0, 0, 0.2) 24%, rgba(0, 0, 0, 0.82) 58%, rgba(0, 0, 0, 1) 100%);
      mask-image: linear-gradient(90deg, transparent 0%, rgba(0, 0, 0, 0.2) 24%, rgba(0, 0, 0, 0.82) 58%, rgba(0, 0, 0, 1) 100%);
      pointer-events: none;
    }
    .depth-band::after {
      content: "";
      position: absolute;
      inset: 0;
      z-index: 1;
      background:
        radial-gradient(circle at 48% 30%, rgba(255, 255, 255, 0.96), rgba(255, 255, 255, 0.8) 30%, rgba(255, 255, 255, 0.34) 58%, rgba(255, 255, 255, 0.06) 100%),
        linear-gradient(90deg, rgba(255, 255, 255, 0.96) 0%, rgba(255, 255, 255, 0.78) 42%, rgba(255, 255, 255, 0.08) 100%);
      pointer-events: none;
    }
    .depth-band > .section-inner { position: relative; z-index: 2; }
    .depth-band:not(.surface)::after {
      background:
        radial-gradient(circle at 48% 30%, rgba(245, 245, 247, 0.96), rgba(245, 245, 247, 0.8) 30%, rgba(245, 245, 247, 0.34) 58%, rgba(245, 245, 247, 0.06) 100%),
        linear-gradient(90deg, rgba(245, 245, 247, 0.96) 0%, rgba(245, 245, 247, 0.78) 42%, rgba(245, 245, 247, 0.08) 100%);
    }
    .depth-shoe-bag::before,
    .depth-local-store::before {
      background-position: 100% center;
    }
    .depth-fabric::before {
      background-position: 100% center;
    }
    .section-header { max-width: 900px; min-width: 0; margin: 0 auto 46px; text-align: center; }
    .section-header h2 { font-size: clamp(2.72rem, 5.4vw, 5.05rem); line-height: 1.04; }
    .section-header .section-copy { margin: 18px auto 0; max-width: 760px; color: var(--muted); font-size: 1.22rem; line-height: 1.62; }
    .section-header-bottom { margin: 64px auto 0; }
    .section-header-bottom h2 { font-size: clamp(3rem, 5.8vw, 5.45rem); }
    .section-header-bottom .section-copy { max-width: 820px; font-size: 1.28rem; }
    .grid, .product-grid, .discovery-grid, .case-grid, .trust-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 18px;
    }
    .trust-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .two-col { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 0.66fr); gap: 46px; align-items: start; }
    .card {
      background: var(--surface);
      border: 1px solid var(--line-soft);
      border-radius: 8px;
      padding: 28px;
      box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02);
    }
    .product-tile, .feature-panel, .spec-tile, .post-tile {
      min-height: 100%;
      background: var(--surface);
      border-radius: 8px;
      padding: 42px;
      text-align: center;
      border: 1px solid var(--line-soft);
    }
    .product-tile { min-height: 520px; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; }
    .product-tile:nth-child(2) {
      background: var(--surface-dark);
      color: #f5f5f7;
      border-color: rgba(255, 255, 255, 0.12);
    }
    .product-tile:nth-child(2) p, .product-tile:nth-child(2) .eyebrow { color: rgba(245, 245, 247, 0.72); }
    .product-tile h3 { font-size: clamp(2.05rem, 3.4vw, 3.5rem); line-height: 1.05; margin-bottom: 14px; }
    .product-tile p, .feature-panel p, .spec-tile p, .post-tile p { color: var(--muted); margin: 0 auto; max-width: 560px; }
    .product-tile .link-row, .feature-panel .link-row, .post-tile .link-row { justify-content: center; }
    .feature-panel {
      text-align: left;
      padding: 38px 0;
      background: transparent;
      border: 0;
      border-top: 1px solid var(--line);
      border-radius: 0;
      display: grid;
      grid-template-columns: minmax(220px, 0.55fr) minmax(0, 1fr);
      gap: 34px;
      align-items: start;
    }
    .feature-panel h3 { font-size: clamp(2rem, 3.2vw, 3.42rem); line-height: 1.06; }
    .feature-panel > p:not(.eyebrow) { margin: 0; max-width: 520px; font-size: 1.1rem; line-height: 1.72; }
    .feature-panel ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 0; text-align: left; }
    .feature-panel li { padding: 18px 0; border-top: 1px solid var(--line-soft); }
    .feature-panel li:first-child { padding-top: 0; }
    .feature-panel li p { max-width: none; margin-top: 4px; }
    .spec-tile {
      padding: 28px 0;
      text-align: left;
      background: transparent;
      border: 0;
      border-top: 1px solid var(--line);
      border-radius: 0;
    }
    .spec-tile h3 { font-size: 1.45rem; }
    .card h2 { font-size: 1.55rem; margin-bottom: 14px; }
    .card p, .fact-list p { margin: 0; color: var(--muted); }
    .card + .card { margin-top: 14px; }
    .card ul { margin: 14px 0 0; padding: 0; list-style: none; display: grid; gap: 12px; }
    .card li { padding-top: 12px; border-top: 1px solid var(--line-soft); }
    .card li:first-child { padding-top: 0; border-top: 0; }
    .card li p { margin-top: 4px; }
    .fact-list { display: grid; gap: 12px; font-size: 1.02rem; }
    .table-wrap { overflow-x: auto; border: 1px solid var(--line-soft); border-radius: 8px; background: var(--surface); }
    .comparison-table { width: 100%; min-width: 720px; border-collapse: collapse; text-align: left; }
    .comparison-table th, .comparison-table td { padding: 18px 20px; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
    .comparison-table tr:last-child td { border-bottom: 0; }
    .comparison-table th { color: var(--ink); font-size: 0.92rem; }
    .comparison-table td { color: var(--muted-strong); }
    .eyebrow { color: var(--muted); font-weight: 680; font-size: 0.82rem; letter-spacing: 0; }
    .service-card { min-height: 100%; }
    .service-card a { font-weight: 700; }
    .service-card h3 a { color: inherit; }
    .service-card p:last-child { font-size: 1.02rem; }
    .service-card-image {
      width: 100%;
      aspect-ratio: 16 / 10;
      object-fit: cover;
      border-radius: 8px;
      margin: 24px 0;
      border: 1px solid var(--line-soft);
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.12);
    }
    .post-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
    .post-list article { overflow: hidden; }
    .post-list img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 8px; border: 1px solid var(--line-soft); margin: 16px 0 12px; }
    .post-tile { text-align: left; background: var(--surface); padding: 30px; }
    .post-tile h3 { font-size: clamp(1.58rem, 2.5vw, 2.35rem); line-height: 1.1; }
    .post-tile p { margin-left: 0; margin-right: 0; }
    .post-caption { white-space: pre-line; color: var(--ink); line-height: 1.78; }
    .post-preview { color: var(--muted-strong); font-size: 1.08rem; }
    .caption-details { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--line-soft); }
    .caption-details summary { cursor: pointer; font-weight: 700; color: var(--accent); }
    .caption-details .post-caption { margin-top: 14px; font-size: 0.98rem; }
    .post-archive { margin-top: 28px; border-top: 1px solid var(--line); padding-top: 22px; }
    .post-archive summary { cursor: pointer; font-size: .95rem; font-weight: 700; color: var(--ink); list-style-position: outside; }
    .post-archive .section-copy { margin: 12px 0 20px; }
    .archive-list { margin-top: 16px; }
    figure { margin: 0; }
    figcaption { margin-top: 8px; color: var(--muted); font-size: 0.9rem; }
    .answer-box {
      border: 1px solid var(--line-soft);
      background: var(--surface-soft);
      padding: 24px;
      border-radius: 8px;
    }
    .answer-box p { margin: 0; color: var(--muted-strong); font-size: 1.05rem; }
    .hero-copy .answer-box { margin-top: 26px; text-align: center; }
    .story-band { background: var(--surface-dark); color: #f5f5f7; }
    .story-band .section-copy, .story-band .eyebrow { color: rgba(245, 245, 247, 0.72); }
    .story-band .card {
      background: var(--surface-dark-soft);
      border-color: rgba(255, 255, 255, 0.12);
    }
    .story-band .card p { color: rgba(245, 245, 247, 0.74); }
    .utility-band { background: var(--surface); padding: 52px 0 72px; }
    .machine-details {
      max-width: 940px;
      margin: 0 auto;
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
      padding: 20px 0;
    }
    .machine-details summary {
      cursor: pointer;
      font-weight: 700;
      color: var(--ink);
      list-style-position: outside;
    }
    .machine-details .section-copy { margin: 12px 0 18px; max-width: 760px; color: var(--muted); }
    .utility-band .nav { justify-content: flex-start; gap: 6px 18px; }
    .local-query-row {
      justify-content: flex-start;
      margin-top: 18px;
    }
    .local-query-row .chip {
      border-color: rgba(0, 0, 0, 0.08);
      background: rgba(255, 255, 255, 0.74);
      color: var(--muted-strong);
    }
    .link-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
    .link-row a {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      padding: 6px 12px;
      border-radius: 999px;
      background: var(--accent-soft);
    }
    .muted { color: var(--muted); }
    @media (max-width: 820px) {
      .topbar {
        position: static;
        align-items: flex-start;
        padding: 10px 16px;
        display: grid;
        grid-template-columns: 1fr;
      }
      .section-inner, .hero-media, .service-photo, .product-visual {
        width: min(var(--max), calc(100vw - 24px));
        max-width: calc(100vw - 24px);
      }
      .hero-copy, .section-header, .answer-box, .card, .lead { max-width: 100%; }
      .product-hero { padding-top: 50px; }
      .product-band { padding: 54px 0; }
      .two-col { grid-template-columns: 1fr; display: grid; }
      .grid, .product-grid, .post-list, .case-grid, .discovery-grid, .trust-grid { grid-template-columns: 1fr; }
      .nav { width: 100%; justify-content: flex-start; gap: 4px 16px; font-size: 0.8rem; }
      .nav a { min-height: 30px; }
      h1 { font-size: clamp(2.72rem, 11vw, 3.15rem); }
      h2 { font-size: clamp(1.78rem, 7.2vw, 2.15rem); }
      h1, h2, h3, p, li, figcaption, .lead, .answer-box, .card { word-break: break-all; }
      .lead { font-size: 1.12rem; }
      .hero-actions { justify-content: center; }
      .product-tile, .feature-panel, .spec-tile, .post-tile, .card { padding: 24px; }
      .feature-panel { grid-template-columns: 1fr; padding: 26px 0; }
      .spec-tile { padding: 22px 0; }
      .product-tile { min-height: 260px; }
      .product-tile h3 { font-size: 1.72rem; }
      .depth-band::before {
        opacity: 0.1;
        background-size: 150% auto;
        background-position: center bottom;
        transform: scale(1.1);
        -webkit-mask-image: linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.55) 38%, rgba(0, 0, 0, 1) 100%);
        mask-image: linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.55) 38%, rgba(0, 0, 0, 1) 100%);
      }
      .depth-band::after,
      .depth-band:not(.surface)::after {
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(245, 245, 247, 0.9));
      }
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

function captionPreview(caption: string): string {
  return caption
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find(Boolean) ?? caption.trim();
}

function buildPostPageSchema(post: PublicPost, index: PublicPostIndex): object | undefined {
  if (!index.base_url_configured) return undefined;
  const profile = index.business_profile;
  const description = captionPreview(post.facebook_caption).slice(0, 180);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        "@id": `${post.article_url}#article`,
        url: post.article_url,
        mainEntityOfPage: { "@id": `${post.article_url}#webpage` },
        headline: post.topic,
        description,
        datePublished: post.date_published,
        dateModified: index.generated_at,
        inLanguage: "zh-Hant-TW",
        author: { "@id": `${index.canonical_url}#business` },
        publisher: { "@id": `${index.canonical_url}#business` },
        image: { "@type": "ImageObject", contentUrl: post.image_url, caption: `${post.topic} - ${profile.name}` },
        about: { "@id": `${index.canonical_url}#business` },
        keywords: post.hashtags.map((tag) => tag.replace(/^#/, ""))
      },
      {
        "@type": "WebPage",
        "@id": `${post.article_url}#webpage`,
        url: post.article_url,
        name: post.topic,
        description,
        isPartOf: { "@id": `${index.canonical_url}#website` },
        about: { "@id": `${index.canonical_url}#business` },
        primaryImageOfPage: { "@id": `${post.article_url}#image` }
      },
      {
        "@type": "ImageObject",
        "@id": `${post.article_url}#image`,
        contentUrl: post.image_url,
        caption: `${post.topic} - ${profile.name}`
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: profile.name, item: index.canonical_url },
          { "@type": "ListItem", position: 2, name: "Care journal", item: post.article_url },
          { "@type": "ListItem", position: 3, name: post.topic, item: post.article_url }
        ]
      }
    ]
  };
}

function buildPostPageHtml(post: PublicPost, index: PublicPostIndex): string {
  const profile = index.business_profile;
  const canonical = post.article_url;
  const schema = buildPostPageSchema(post, index);
  const service = findServiceBySlug("taichung-xitun-laundry") ?? SERVICE_PAGE_DEFINITIONS[0];
  const serviceHref = service ? servicePageUrl(service, index) : index.canonical_url;
  const homeHref = index.base_url_configured ? index.canonical_url : "../index.html";
  const imageSrc = visibleImageSrc(post, index);
  const description = captionPreview(post.facebook_caption).slice(0, 180);
  const hashtags = post.hashtags.map((tag) => `<span class="chip on-light">${escapeHtml(tag)}</span>`).join("\n");

  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <meta name="googlebot" content="index, follow, max-image-preview:large" />
    <meta name="author" content="${escapeHtml(profile.name)}" />
    <meta name="theme-color" content="#f5f5f7" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <link rel="alternate" hreflang="zh-Hant-TW" href="${escapeHtml(canonical)}" />
    <meta property="og:title" content="${escapeHtml(post.topic)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:site_name" content="${escapeHtml(profile.name)}" />
    <meta property="og:locale" content="${escapeHtml(SITE_LOCALE)}" />
    <meta property="og:image" content="${escapeHtml(post.image_url)}" />
    <meta property="og:image:alt" content="${escapeHtml(`${post.topic} - ${profile.name}`)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(post.topic)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(post.image_url)}" />
    ${schema ? `<script type="application/ld+json">${escapeJsonLd(schema)}</script>` : ""}
    <style>${buildPublicSiteCss()}</style>
    <title>${escapeHtml(`${post.topic} | ${profile.name}`)}</title>
  </head>
  <body>
    <main>
      <header class="topbar">
        <a class="brand" href="${escapeHtml(homeHref)}">${escapeHtml(profile.name)}</a>
        <nav class="nav" aria-label="Primary navigation">
          <a href="${escapeHtml(serviceHref)}">Service</a>
          <a href="${escapeHtml(profile.map_url)}">Google Maps</a>
          <a href="${escapeHtml(profile.line_url)}">LINE</a>
        </nav>
      </header>
      <section class="product-hero hero-light service-hero">
        <div class="section-inner hero-copy">
          <p class="eyebrow">Care journal | ${escapeHtml(post.date)} ${escapeHtml(post.time)}</p>
          <h1>${escapeHtml(post.topic)}</h1>
          <p class="lead">${escapeHtml(description)}</p>
          <div class="hero-actions">
            <a class="primary-link" href="${escapeHtml(profile.line_url)}">LINE</a>
            <a class="secondary-link" href="${escapeHtml(serviceHref)}">Service details</a>
          </div>
        </div>
        <figure class="service-photo">
          <img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(`${post.topic} - ${profile.name}`)}" loading="eager" fetchpriority="high" width="1200" />
          <figcaption>${escapeHtml(post.topic)}</figcaption>
        </figure>
      </section>
      <section class="product-band surface">
        <div class="section-inner two-col">
          <article>
            <p class="eyebrow">Store note</p>
            <h2>Check the item before choosing the next step</h2>
            <p class="post-caption">${escapeHtml(post.facebook_caption)}</p>
            <div class="meta-row local-query-row">${hashtags}</div>
          </article>
          <aside class="card">
            <h2>${escapeHtml(profile.name)}</h2>
            <p>${escapeHtml(profile.address_text)}</p>
            <p>${escapeHtml(profile.opening_hours_text)}</p>
            <div class="link-row">
              <a href="${escapeHtml(profile.line_url)}">LINE</a>
              <a href="${escapeHtml(profile.map_url)}">Google Maps</a>
              <a href="${escapeHtml(profile.facebook_url)}">Facebook</a>
              <a href="${escapeHtml(profile.instagram_url)}">Instagram</a>
            </div>
          </aside>
        </div>
      </section>
    </main>
  </body>
</html>
`;
}

function renderHomePostTile(post: PublicPost, index: PublicPostIndex, profile: BusinessProfile): string {
  const imageSrc = visibleImageSrc(post, index);
  const preview = captionPreview(post.facebook_caption);
  const articleHref = hasArticlePage(post, index) ? post.article_url : post.calendar_path;
  return `<article class="post-tile post-card">
        <h3>${escapeHtml(post.topic)}</h3>
        <p><strong>${escapeHtml(post.date)} ${escapeHtml(post.time)}</strong>｜${escapeHtml(post.visual_route)} / ${escapeHtml(post.traffic_route)}</p>
        <a href="${escapeHtml(imageSrc)}">
          <img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(`${post.topic} - ${profile.name}洗護內容照片`)}" loading="lazy" width="1200" />
        </a>
        <p class="post-caption post-preview">${escapeHtml(preview)}</p>
        <details class="caption-details">
          <summary>閱讀完整文案</summary>
          <p class="post-caption">${escapeHtml(post.facebook_caption)}</p>
        </details>
        <p><a href="${escapeHtml(articleHref)}">read full post</a></p>
      </article>`;
}

function buildIndexHtml(index: PublicPostIndex): string {
  const profile = index.business_profile;
  const { recentPosts, archivePosts, recentDateCount, archiveDateCount } = homepagePostGroups(index.posts);
  const heroImage = primaryHomeImage(index);
  const heroImageSrc = heroImage ? visibleImageSrc(heroImage, index) : "";
  const homePageSchema = buildHomePageSchema(index);
  const rows =
    recentPosts.length > 0
      ? recentPosts.map((post) => renderHomePostTile(post, index, profile)).join("\n")
      : `<p class="section-copy">尚未有審核通過的公開貼文。</p>`;
  const archiveRows = archivePosts.map((post) => renderHomePostTile(post, index, profile)).join("\n");
  const archiveSection =
    archivePosts.length > 0
      ? `<details class="post-archive">
            <summary>較早內容（${archiveDateCount} 天，${archivePosts.length} 篇）</summary>
            <p class="section-copy">這些貼文仍保留在 SEO / AIO / GEO 和社群內容資料庫中，預設收合，避免首頁太長。</p>
            <div class="post-list archive-list">
        ${archiveRows}
            </div>
          </details>`
      : "";
  const serviceCards = SERVICE_PAGE_DEFINITIONS.map((service) => {
    const image = findServiceImage(service, index);
    const imageSrc = image ? visibleImageSrc(image, index, true) : "";
    const imageMarkup = image
      ? `\n        <img class="service-card-image" src="${escapeHtml(imageSrc)}" alt="${escapeHtml(service.image_alt)}" loading="lazy" width="900" />`
      : "";
    return `<article class="product-tile service-card">
        <p class="eyebrow">Service</p>
        <h3><a href="${escapeHtml(servicePageUrl(service, index))}">${escapeHtml(service.name)}</a></h3>${imageMarkup}
        <p>${escapeHtml(service.answer_summary)}</p>
        <div class="link-row">
          <a href="${escapeHtml(servicePageUrl(service, index))}">進一步了解</a>
        </div>
      </article>`;
  }).join("\n");
  const supportCards = SUPPORT_PAGE_DEFINITIONS.map((page) => {
    const service = linkedSupportService(page);
    return `<article class="product-tile service-card">
        <p class="eyebrow">${page.category === "local" ? "Local" : "Guide"}</p>
        <h3><a href="${escapeHtml(supportPageUrl(page, index))}">${escapeHtml(page.h1)}</a></h3>
        <p>${escapeHtml(page.summary)}</p>
        <div class="link-row">
          <a href="${escapeHtml(supportPageUrl(page, index))}">閱讀指南</a>
          ${service ? `<a href="${escapeHtml(servicePageUrl(service, index))}">${escapeHtml(service.name)}</a>` : ""}
        </div>
      </article>`;
  }).join("\n");
  const discoveryGroups = HOME_DISCOVERY_GROUPS.map(
    (group) => `<article class="feature-panel">
        <p class="eyebrow">Care path</p>
        <h3>${escapeHtml(group.heading)}</h3>
        <p>${escapeHtml(group.intro)}</p>
        <ul>
          ${group.items
            .map(
              (item) => `<li>
            <a href="${escapeHtml(homeDiscoveryItemUrl(item, index))}"><strong>${escapeHtml(item.label)}</strong></a>
            <p>${escapeHtml(item.description)}</p>
          </li>`
            )
            .join("\n")}
        </ul>
      </article>`
  ).join("\n");
  const trustCards = HOME_TRUST_ITEMS.map(
    (item) => `<article class="spec-tile">
        <h3>${escapeHtml(item.heading)}</h3>
        <p>${escapeHtml(item.body)}</p>
      </article>`
  ).join("\n");
  const processCards = HOME_PROCESS_STEPS.map(
    (item) => `<article class="spec-tile">
        <h3>${escapeHtml(item.heading)}</h3>
        <p>${escapeHtml(item.body)}</p>
      </article>`
  ).join("\n");
  const localSearchChips = LOCAL_SEARCH_QUERY_TARGETS.map(
    (query) => `<span class="chip on-light">${escapeHtml(query)}</span>`
  ).join("\n");

  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHtml(SITE_DESCRIPTION)}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <meta name="googlebot" content="index, follow, max-image-preview:large" />
    <meta name="author" content="${escapeHtml(profile.name)}" />
    <meta name="theme-color" content="#f5f5f7" />
    <link rel="canonical" href="${escapeHtml(index.canonical_url)}" />
    <link rel="alternate" hreflang="zh-Hant-TW" href="${escapeHtml(index.canonical_url)}" />
    <link rel="alternate" hreflang="x-default" href="${escapeHtml(index.canonical_url)}" />
    <link rel="llms" href="llms.txt" />
    <link rel="sitemap" type="application/xml" href="sitemap.xml" />
    <link rel="sitemap" type="application/xml" href="ai-sitemap.xml" />
    <link rel="alternate" type="application/json" href="social-posts.json" />
    <link rel="alternate" type="application/json" href="business-profile.json" />
    <link rel="alternate" type="application/json" href="services.json" />
    <link rel="alternate" type="application/json" href="answers.json" />
    <link rel="alternate" type="application/json" href="geo-targets.json" />
    <link rel="alternate" type="application/jsonl" href="llms.jsonl" />
    <link rel="alternate" type="application/json" href="feed.json" />
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
  </head>
  <body>
    <main>
      <header class="topbar">
        <a class="brand" href="${escapeHtml(index.canonical_url)}">${escapeHtml(profile.name)}</a>
        <nav class="nav" aria-label="主要服務">
          ${SERVICE_PAGE_DEFINITIONS.map(
            (service) => `<a href="${escapeHtml(servicePageUrl(service, index))}">${escapeHtml(service.name)}</a>`
          ).join("\n")}
          <a href="${escapeHtml(profile.map_url)}">Google Maps</a>
          <a href="${escapeHtml(profile.line_url)}">LINE</a>
        </nav>
      </header>
      <section class="product-hero hero-dark">
        <div class="section-inner hero-copy">
          <p class="eyebrow">台中西屯洗護與收納</p>
          <h1>台中西屯青海路洗衣、洗鞋、洗包、布品收納</h1>
          <p class="lead">私享家洗衣店先看衣物、鞋子、包包與布品的實際狀態，再決定怎麼洗護與收納。</p>
          <div class="hero-actions">
            <a class="primary-link" href="#services">查看服務</a>
            <a class="secondary-link" href="${escapeHtml(profile.line_url)}">LINE 詢問</a>
          </div>
          <div class="meta-row">
            <span class="chip">${escapeHtml(profile.address.addressLocality)}</span>
            <span class="chip">${escapeHtml(profile.telephone_local)}</span>
            <span class="chip">${escapeHtml(profile.opening_hours_text)}</span>
          </div>
        </div>
        ${
          heroImage
            ? `<figure class="hero-media">
          <img src="${escapeHtml(heroImageSrc)}" alt="${escapeHtml(`${heroImage.topic} - ${profile.name}布品收納檢查示意圖`)}" width="1200" />
          <figcaption>${escapeHtml(heroImage.topic)}｜布品收納檢查示意圖</figcaption>
        </figure>`
            : ""
        }
      </section>
      <section class="product-band surface depth-band depth-laundry">
        <div class="section-inner">
          <div class="discovery-grid">
          ${discoveryGroups}
          </div>
          <div class="section-header section-header-bottom">
            <p class="eyebrow">Search intent</p>
            <h2>依需求找到服務。</h2>
            <p class="section-copy">把客人真正會問的物件、情境、送洗前問題拆清楚，讓搜尋「台中西屯洗衣店」「青海路洗衣店」的人，也能快速理解私享家在判斷什麼。</p>
          </div>
        </div>
      </section>
      <section class="product-band depth-band depth-shoe-bag" id="services">
        <div class="section-inner">
          <div class="section-header">
            <p class="eyebrow">Services</p>
            <h2>四個主要服務入口。</h2>
            <p class="section-copy">用服務頁承接 SEO / AIO / GEO，也讓社群貼文不只是今天看完就消失。</p>
          </div>
          <div class="product-grid">
          ${serviceCards}
          </div>
        </div>
      </section>
      <section class="product-band surface depth-band depth-fabric">
        <div class="section-inner">
          <div class="section-header">
            <p class="eyebrow">Guides</p>
            <h2>送洗前先看這幾件事。</h2>
            <p class="section-copy">把客人常問的拍照、白鞋泛黃、雨季鞋子、包包提把、寢具外套收納與青海路在地搜尋拆成獨立頁面，讓人和 AI 都能直接找到答案。</p>
          </div>
          <div class="product-grid">
          ${supportCards}
          </div>
        </div>
      </section>
      <section class="product-band surface depth-band depth-fabric">
        <div class="section-inner">
          <div class="section-header">
            <p class="eyebrow">Care logic</p>
            <h2>為什麼選私享家。</h2>
          </div>
          <div class="trust-grid">
          ${trustCards}
          </div>
        </div>
      </section>
      <section class="product-band depth-band depth-white-shoe" id="how-it-works">
        <div class="section-inner">
          <div class="section-header">
            <p class="eyebrow">How it works</p>
            <h2>送洗前流程</h2>
          </div>
          <div class="grid">
          ${processCards}
          </div>
        </div>
      </section>
      <section class="product-band surface depth-band depth-local-store">
        <div class="section-inner two-col">
          <div>
            <h2>店家資訊</h2>
            <address class="fact-list">
              <p><strong>${escapeHtml(profile.google_business_profile_name)}</strong></p>
              <p>${escapeHtml(profile.address_text)}（${escapeHtml(profile.landmark)}）</p>
              <p>電話：${escapeHtml(profile.telephone_local)}｜LINE／手機：${escapeHtml(profile.mobile_or_line_local)}</p>
              <p>營業時間：${escapeHtml(profile.opening_hours_text)}</p>
              <p>節日營業：${escapeHtml(profile.holiday_hours_rule.default_rule)}</p>
            </address>
            <div class="link-row">
              <a href="${escapeHtml(profile.map_url)}">Google Maps</a>
              <a href="${escapeHtml(profile.facebook_url)}">Facebook</a>
              <a href="${escapeHtml(profile.instagram_url)}">Instagram</a>
              <a href="${escapeHtml(profile.line_url)}">LINE</a>
            </div>
          </div>
          <div class="card local-search-card">
            <p class="eyebrow">Local search</p>
            <h3>搜尋洗衣店時，讓地區和服務都說清楚。</h3>
            <p>這個公開站會固定把私享家洗衣店、台中市西屯區、青海路二段、衣物洗護、洗鞋、洗包、白鞋清潔與布品收納連在一起，提供服務頁、社群圖文、LocalBusiness schema、AI 入口與在地搜尋資料。</p>
            <div class="meta-row local-query-row">
              ${localSearchChips}
            </div>
          </div>
        </div>
      </section>
      <section class="product-band utility-band">
        <div class="section-inner">
          <details class="machine-details">
            <summary>AI 與搜尋引擎可讀入口</summary>
            <p class="section-copy">這些檔案讓搜尋引擎與 AI 理解私享家洗衣店的服務、店家資料、社群內容與在地搜尋資訊。一般客人不需要閱讀它們，但它們會保留作為公開資料來源。</p>
            <nav class="nav" aria-label="AI 與搜尋入口">
          <a href="llms-lite.txt">llms-lite.txt</a>
          <a href="llms.txt">llms.txt</a>
          <a href="llms-full.txt">llms-full.txt</a>
          <a href="llms.jsonl">llms.jsonl</a>
          <a href=".well-known/llms.txt">.well-known/llms.txt</a>
          <a href=".well-known/ai.json">.well-known/ai.json</a>
          <a href="services.json">services.json</a>
          <a href="answers.json">answers.json</a>
          <a href="geo-targets.json">geo-targets.json</a>
          <a href="social-posts.json">social-posts.json</a>
          <a href="business-profile.json">店家資料</a>
          <a href="latest.json">latest.json</a>
          <a href="feed.json">feed.json</a>
          <a href="knowledge-graph.json">knowledge-graph.json</a>
          <a href="ai-discovery.json">ai-discovery.json</a>
          <a href="ai-sitemap.xml">ai-sitemap.xml</a>
          <a href="sitemap.xml">sitemap.xml</a>
            </nav>
          </details>
        </div>
      </section>
      <section class="product-band">
        <div class="section-inner">
          <div class="section-header">
            <p class="eyebrow">Published posts</p>
            <h2>已發布社群內容</h2>
            <p class="section-copy">只收錄已審核、可公開的 Facebook / Instagram 貼文；最近 ${recentDateCount} 天直接顯示，較早內容收合成 archive，但仍保留給客人、搜尋引擎和 AI 讀取。</p>
          </div>
          <div class="post-list">
        ${rows}
          </div>
          ${archiveSection}
        </div>
      </section>
    </main>
  </body>
</html>
`;
}

function buildNotFoundHtml(index: PublicPostIndex): string {
  const homeHref = index.canonical_url;
  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, follow" />
    <meta http-equiv="refresh" content="0; url=${escapeHtml(homeHref)}" />
    <link rel="canonical" href="${escapeHtml(homeHref)}" />
    <script>window.location.replace(${JSON.stringify(homeHref)});</script>
    <style>${buildPublicSiteCss()}
      .not-found-hero { min-height: 100vh; display: grid; place-items: center; padding: 64px 20px; }
      .not-found-panel { max-width: 760px; margin: 0 auto; text-align: center; }
      .not-found-panel h1 { font-size: clamp(3.2rem, 8vw, 6.8rem); line-height: 0.96; margin-bottom: 20px; }
      .not-found-panel p { color: var(--muted); font-size: 1.2rem; line-height: 1.7; margin: 0 auto 30px; max-width: 620px; }
    </style>
    <title>${escapeHtml(`${SITE_NAME} | Page moved`)}</title>
  </head>
  <body>
    <main class="not-found-hero">
      <section class="not-found-panel">
        <p class="eyebrow">Page moved</p>
        <h1>回到私享家首頁。</h1>
        <p>這個網址可能多了 docs 或少了專案路徑，系統會自動帶你回到私享家洗衣店的公開 SEO / AIO / GEO 主站。</p>
        <a class="primary-link" href="${escapeHtml(homeHref)}">回到首頁</a>
      </section>
    </main>
  </body>
</html>
`;
}

function buildServicePageHtml(service: ServicePageDefinition, index: PublicPostIndex): string {
  const profile = index.business_profile;
  const canonical = servicePageUrl(service, index);
  const serviceSchema = buildServicePageSchema(service, index);
  const image = findServiceImage(service, index);
  const imageSrc = image ? visibleImageSrc(image, index, true) : "";
  const homeHref = index.base_url_configured ? index.canonical_url : "../index.html";
  const businessProfileHref = index.base_url_configured ? index.entrypoints.business_profile : "../business-profile.json";
  const description = escapeHtml(service.description);
  const caseStudies = service.case_studies
    .map(
      (study) => `<article class="card">
              <p class="eyebrow">${escapeHtml(study.label)}｜${escapeHtml(study.object)}</p>
              <h3>${escapeHtml(study.concern)}</h3>
              <p><strong>材質：</strong>${escapeHtml(study.material)}</p>
              <p><strong>門市先看：</strong>${escapeHtml(study.inspection)}</p>
              <p><strong>處理界線：</strong>${escapeHtml(study.boundary)}</p>
            </article>`
    )
    .join("\n");
  const inspectionTable =
    service.inspection_table && service.inspection_table.length > 0
      ? `<section class="product-band">
        <div class="section-inner">
          <div class="section-header">
            <p class="eyebrow">Material & risk</p>
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

  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
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
  </head>
  <body>
    <main>
      <header class="topbar">
        <a class="brand" href="${escapeHtml(homeHref)}">私享家洗衣店</a>
        <nav class="nav" aria-label="服務與資料入口">
          ${SERVICE_PAGE_DEFINITIONS.map(
            (item) => `<a href="${escapeHtml(servicePageUrl(item, index))}">${escapeHtml(item.name)}</a>`
          ).join("\n")}
          <a href="${escapeHtml(businessProfileHref)}">店家資料</a>
        </nav>
      </header>
      <section class="product-hero hero-light service-hero">
        <div class="section-inner hero-copy">
          <p class="eyebrow">台中西屯｜${escapeHtml(service.name)}</p>
          <h1>${escapeHtml(service.h1)}</h1>
          <p class="lead">${escapeHtml(service.summary)}</p>
          <div class="hero-actions">
            <a class="primary-link" href="${escapeHtml(profile.line_url)}">LINE 詢問</a>
            <a class="secondary-link" href="#faq">常見問題</a>
          </div>
          <div class="answer-box">
            <p>${escapeHtml(service.answer_summary)}</p>
          </div>
        </div>
        ${
          image
            ? `<figure class="service-photo">
          <img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(service.image_alt)}" loading="eager" fetchpriority="high" width="1200" />
          <figcaption>${escapeHtml(image.topic)}｜${escapeHtml(service.image_note)}</figcaption>
        </figure>`
            : ""
        }
      </section>
      <section class="product-band story-band">
        <div class="section-inner">
          <div class="section-header">
            <p class="eyebrow">門市判斷情境</p>
            <h2>${escapeHtml(service.case_story.label)}</h2>
            <p>以下為常見送件情境與處理界線，用於協助送洗前判斷；不是特定客戶成果，也不代表效果保證。</p>
          </div>
          <p class="lead">${escapeHtml(service.case_story.situation)}</p>
          <div class="case-grid">${caseStudies}</div>
        </div>
      </section>
      <section class="product-band surface">
        <div class="section-inner two-col">
          <div>
            <h2>${escapeHtml(service.name)}服務重點</h2>
            ${service.sections
              .map(
                (section) => `<article class="card">
              <h3>${escapeHtml(section.heading)}</h3>
              <p>${escapeHtml(section.body)}</p>
            </article>`
              )
              .join("\n")}
          </div>
          <aside class="card">
            <h2>店家資訊</h2>
            <p>${escapeHtml(profile.name)}｜${escapeHtml(profile.address_text)}（${escapeHtml(profile.landmark)}）</p>
            <p>電話：${escapeHtml(profile.telephone_local)}｜LINE：${escapeHtml(profile.mobile_or_line_local)}</p>
            <p>營業時間：${escapeHtml(profile.opening_hours_text)}</p>
            <div class="link-row">
              <a href="${escapeHtml(profile.map_url)}">Google Maps</a>
              <a href="${escapeHtml(profile.line_url)}">LINE</a>
              <a href="${escapeHtml(profile.facebook_url)}">Facebook</a>
              <a href="${escapeHtml(profile.instagram_url)}">Instagram</a>
            </div>
          </aside>
        </div>
      </section>
      ${inspectionTable}
      <section class="product-band" id="faq">
        <div class="section-inner">
          <div class="section-header">
            <p class="eyebrow">FAQ</p>
            <h2>常見問題</h2>
          </div>
          <div class="grid">
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
  </body>
</html>
`;
}

function buildSupportPageHtml(page: SupportPageDefinition, index: PublicPostIndex): string {
  const profile = index.business_profile;
  const canonical = supportPageUrl(page, index);
  const supportSchema = buildSupportPageSchema(page, index);
  const service = linkedSupportService(page);
  const serviceHref = service ? servicePageUrl(service, index) : index.canonical_url;
  const homeHref = index.base_url_configured ? index.canonical_url : page.path.startsWith("local/") ? "../index.html" : "../index.html";
  const relativePrefix = page.path.includes("/") ? "../" : "";
  const businessProfileHref = index.base_url_configured ? index.entrypoints.business_profile : `${relativePrefix}business-profile.json`;
  const servicesHref = index.base_url_configured ? index.entrypoints.services : `${relativePrefix}services.json`;
  const answersHref = index.base_url_configured ? index.entrypoints.answers : `${relativePrefix}answers.json`;
  const description = escapeHtml(page.description);
  const stepItems = page.steps
    .map(
      (step, index) => `<article class="spec-tile">
              <p class="eyebrow">Step ${index + 1}</p>
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
  const keywordChips = page.keywords.map((keyword) => `<span class="chip on-light">${escapeHtml(keyword)}</span>`).join("\n");

  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
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
    <meta property="og:title" content="${escapeHtml(page.title)}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:site_name" content="${escapeHtml(profile.name)}" />
    <meta property="og:locale" content="${escapeHtml(SITE_LOCALE)}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(page.title)}" />
    <meta name="twitter:description" content="${description}" />
    ${supportSchema ? `<script type="application/ld+json">${escapeJsonLd(supportSchema)}</script>` : ""}
    <style>${buildPublicSiteCss()}</style>
    <title>${escapeHtml(page.title)}</title>
  </head>
  <body>
    <main>
      <header class="topbar">
        <a class="brand" href="${escapeHtml(homeHref)}">${escapeHtml(profile.name)}</a>
        <nav class="nav" aria-label="支援內容">
          ${SERVICE_PAGE_DEFINITIONS.map(
            (item) => `<a href="${escapeHtml(servicePageUrl(item, index))}">${escapeHtml(item.name)}</a>`
          ).join("\n")}
          <a href="${escapeHtml(profile.line_url)}">LINE</a>
          <a href="${escapeHtml(profile.map_url)}">Google Maps</a>
        </nav>
      </header>
      <section class="product-hero hero-light service-hero">
        <div class="section-inner hero-copy">
          <p class="eyebrow">${page.category === "local" ? "Local guide" : "Care guide"}</p>
          <h1>${escapeHtml(page.h1)}</h1>
          <p class="lead">${escapeHtml(page.summary)}</p>
          <div class="hero-actions">
            <a class="primary-link" href="${escapeHtml(profile.line_url)}">LINE 詢問</a>
            <a class="secondary-link" href="${escapeHtml(serviceHref)}">${escapeHtml(service?.name ?? "回到首頁")}</a>
          </div>
          <div class="meta-row local-query-row">
            ${keywordChips}
          </div>
        </div>
      </section>
      <section class="product-band surface">
        <div class="section-inner">
          <div class="section-header">
            <p class="eyebrow">How to check</p>
            <h2>先把狀態判斷清楚。</h2>
            <p class="section-copy">${escapeHtml(page.description)}</p>
          </div>
          <div class="grid">
            ${stepItems}
          </div>
        </div>
      </section>
      <section class="product-band">
        <div class="section-inner two-col">
          <div>
            <h2>對應服務</h2>
            <p class="section-copy">${escapeHtml(page.local_intent)}</p>
            <div class="link-row">
              <a href="${escapeHtml(serviceHref)}">${escapeHtml(service?.name ?? "查看私享家服務")}</a>
              <a href="${escapeHtml(profile.line_url)}">傳照片詢問</a>
            </div>
          </div>
          <aside class="card">
            <h2>店家資料</h2>
            <p>${escapeHtml(profile.name)}</p>
            <p>${escapeHtml(profile.address_text)}</p>
            <p>${escapeHtml(profile.telephone_local)}｜${escapeHtml(profile.mobile_or_line_local)}</p>
            <p>${escapeHtml(profile.opening_hours_text)}</p>
          </aside>
        </div>
      </section>
      <section class="product-band surface" id="faq">
        <div class="section-inner">
          <div class="section-header">
            <p class="eyebrow">FAQ</p>
            <h2>常見問題</h2>
          </div>
          <div class="grid">
            ${faqItems}
          </div>
        </div>
      </section>
    </main>
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
    hashtags: post.hashtags,
    platforms: post.platforms,
    image_url: post.image_url,
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
        "Use these as local SEO/AIO/GEO query anchors for people searching laundry, shoe cleaning, bag cleaning, white shoe cleaning, and fabric storage near Taichung Xitun."
    },
    entrypoints: index.entrypoints,
    recommended_read_order: [
      index.entrypoints.llms,
      index.entrypoints.services,
      index.entrypoints.answers,
      index.entrypoints.geo_targets,
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
      cadence: "Two daily social slots at 11:30 and 19:30 Asia/Taipei.",
      fields: [
        "date",
        "slot",
        "time",
        "topic",
        "visual_route",
        "traffic_route",
        "hashtags",
        "facebook_caption",
        "instagram_caption",
        "image_url",
        "calendar_url",
        "article_url"
      ],
      homepage_archive_policy: {
        expanded_recent_days: HOME_EXPANDED_RECENT_DAYS,
        expanded_behavior: "Homepage renders approved posts from the newest seven content dates directly.",
        archive_behavior: "Older approved posts stay in SEO/AIO/GEO data and render inside a collapsed homepage archive."
      },
      omitted_until_verified: ["google_place_id", "holiday_hours_overrides"]
    },
    data_quality: {
      public_base_url_configured: index.base_url_configured,
      post_count: index.posts.length,
      latest_date: index.latest_date,
      all_posts_have_images: index.posts.every((post) => Boolean(post.image_url)),
      all_posts_have_hashtags: index.posts.every((post) => post.hashtags.length > 0),
      all_posts_have_routes: index.posts.every((post) => Boolean(post.visual_route && post.traffic_route))
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
  const imageBaseUrl = normalizeBaseUrl(options.imageBaseUrl ?? options.baseUrl ?? config.publicImageBaseUrl) ?? siteBaseUrl;
  const businessProfile = await loadBusinessProfile(root);
  const generatedAt = (options.now ? new Date(options.now) : new Date()).toISOString();
  const dates = await listContentDates(root);
  const calendars = await Promise.all(
    dates.map(async (date) => {
      const calendar = await readPrivateDailyContent(date, root);
      if (!calendar) return undefined;

      const approvals = await loadApprovalLog(date, root);
      const approvedSlots = calendar.slots.filter((slot) => isSlotFullyApproved(approvals, slot.slot));
      await writeApprovedPublicContentCalendar(calendar, approvedSlots, root);
      return { calendar, approvedSlots };
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
      llms_jsonl: publicUrl("llms.jsonl", siteBaseUrl),
      service_pages: Object.fromEntries(
        SERVICE_PAGE_DEFINITIONS.map((service) => [service.slug, publicUrl(servicePagePath(service), siteBaseUrl)])
      ),
      support_pages: Object.fromEntries(
        SUPPORT_PAGE_DEFINITIONS.map((page) => [page.slug, publicUrl(page.path, siteBaseUrl)])
      ),
      feed: publicUrl("feed.json", siteBaseUrl),
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
  const postsRoot = join(docsRoot, "posts");
  const compatibilityDocsRoot = join(docsRoot, "docs");
  await mkdir(docsRoot, { recursive: true });
  await mkdir(wellKnownRoot, { recursive: true });
  await mkdir(servicesRoot, { recursive: true });
  await mkdir(guidesRoot, { recursive: true });
  await mkdir(localRoot, { recursive: true });
  await mkdir(postsRoot, { recursive: true });
  await mkdir(compatibilityDocsRoot, { recursive: true });
  const indexNowKey = process.env.INDEXNOW_KEY?.trim();

  const outputs = {
    socialPosts: join(docsRoot, "social-posts.json"),
    businessProfile: join(docsRoot, "business-profile.json"),
    latest: join(docsRoot, "latest.json"),
    services: join(docsRoot, "services.json"),
    answers: join(docsRoot, "answers.json"),
    geoTargets: join(docsRoot, "geo-targets.json"),
    llmsJsonl: join(docsRoot, "llms.jsonl"),
    feed: join(docsRoot, "feed.json"),
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
    notFound: join(docsRoot, "404.html"),
    compatibilityDocsIndex: join(compatibilityDocsRoot, "index.html"),
    ...Object.fromEntries(
      SERVICE_PAGE_DEFINITIONS.map((service) => [`servicePage-${service.slug}`, join(servicesRoot, `${service.slug}.html`)])
    ),
    ...Object.fromEntries(SUPPORT_PAGE_DEFINITIONS.map((page) => [`supportPage-${page.slug}`, join(docsRoot, page.path)])),
    nojekyll: join(docsRoot, ".nojekyll")
  };

  await writeJsonAtomic(outputs.socialPosts, index);
  await writeJsonAtomic(outputs.businessProfile, businessProfile);
  await writeJsonAtomic(outputs.latest, latest);
  await writeJsonAtomic(outputs.services, buildServicesJson(index));
  await writeJsonAtomic(outputs.answers, buildAnswersJson(index));
  await writeJsonAtomic(outputs.geoTargets, buildGeoTargetsJson(index));
  await writeJsonAtomic(outputs.feed, buildJsonFeed(index));
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
  if (indexNowKey) {
    await writeFile(join(docsRoot, indexNowKeyFileName(indexNowKey)), `${indexNowKey}\n`, "utf8");
    await unlink(join(docsRoot, "indexnow-key.txt")).catch(() => undefined);
  }
  await writeFile(outputs.index, buildIndexHtml(index), "utf8");
  await writeFile(outputs.notFound, buildNotFoundHtml(index), "utf8");
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
    imageBaseUrl: getOption(args, "image-base-url")
  });
  console.log(`Public site indexes ready:\n${outputs.map((output) => `- ${output}`).join("\n")}`);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
