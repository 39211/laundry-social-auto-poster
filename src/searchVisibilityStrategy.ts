import type { SearchEvidenceType, SearchIntent } from "./types";

export type SearchIntentId = SearchIntent;
export type { SearchEvidenceType } from "./types";

export interface SearchIntentCluster {
  id: SearchIntentId;
  label: string;
  customer_goal: string;
  query_examples: string[];
  answer_pattern: string;
  evidence_required: SearchEvidenceType[];
  primary_routes: string[];
  guardrail: string;
}

export interface SearchVisibilityAssignment {
  search_intent: SearchIntentId;
  target_queries: string[];
  evidence_type: SearchEvidenceType;
}

export const SEARCH_INTENT_CLUSTERS: SearchIntentCluster[] = [
  {
    id: "local-discovery",
    label: "在地找店",
    customer_goal: "確認附近是否有能處理指定物件、可到店或可收送的店家。",
    query_examples: ["台中洗衣店", "西屯洗衣店", "青海路洗衣店", "逢甲洗鞋", "台中洗包包"],
    answer_pattern: "先回答店名、地址、服務物件與收送範圍，再連到可驗證的店家資料與服務頁。",
    evidence_required: ["verified-business-fact", "real-case-photo"],
    primary_routes: [
      "/services/taichung-xitun-laundry.html",
      "/local/qinghai-road-shoe-cleaning.html",
      "/business-profile.json"
    ],
    guardrail: "不得用只替換地名的薄頁搶排名；地區內容必須有真實地址、服務範圍或門市情境。"
  },
  {
    id: "problem-diagnosis",
    label: "問題判斷",
    customer_goal: "先知道物件出了什麼狀況，以及送洗前該拍哪裡、避免做什麼。",
    query_examples: ["白鞋泛黃怎麼辦", "鞋子淋雨怎麼處理", "包包提把髒了怎麼辦", "棉被有潮味怎麼辦", "娃娃可以洗嗎"],
    answer_pattern: "第一段直接回答；接著說明物件、材質、問題位置與門市會看的細節，最後寫清楚處理界線。",
    evidence_required: ["first-party-inspection", "service-boundary"],
    primary_routes: [
      "/guides/white-shoe-yellowing.html",
      "/guides/rainy-shoe-care.html",
      "/guides/bag-handle-cleaning.html",
      "/guides/photo-before-laundry.html"
    ],
    guardrail: "不得把材質老化、磨損或氧化寫成一定能清除的髒污。"
  },
  {
    id: "service-comparison",
    label: "服務選擇",
    customer_goal: "比較自行處理、局部整理、清洗、乾洗或先不處理哪個方向較合適。",
    query_examples: ["西裝要乾洗嗎", "白鞋可以自己刷嗎", "包包局部清潔還是整體清潔", "名牌衣服怎麼洗", "棉被送洗前要看什麼"],
    answer_pattern: "列出不同選項適用的條件、材質風險與何時需要門市檢查，不用空泛的最好或推薦取代判斷。",
    evidence_required: ["service-boundary", "first-party-inspection"],
    primary_routes: [
      "/guides/shirt-suit-dry-cleaning.html",
      "/guides/luxury-dry-cleaning.html",
      "/guides/bedding-duvet-cleaning.html"
    ],
    guardrail: "不得用自稱第一、最好或保證恢復新品來代替可核對的服務差異。"
  },
  {
    id: "trust-proof",
    label: "信任與證據",
    customer_goal: "確認店家是否真的懂材質、會先說風險，並看得到一致的門市判斷。",
    query_examples: ["台中洗鞋推薦", "西屯乾洗店推薦", "精品乾洗怎麼挑", "洗包包會不會掉色", "洗衣店怎麼判斷材質"],
    answer_pattern: "使用真實案例格式：物件、材質、問題、門市先看、處理界線；推薦型查詢只提供可驗證選店條件。",
    evidence_required: ["real-case-photo", "first-party-inspection", "service-boundary"],
    primary_routes: [
      "/services/shoe-bag-care.html",
      "/services/white-shoe-cleaning.html",
      "/services/fabric-storage.html"
    ],
    guardrail: "不得捏造評論、案例結果、星等或客戶見證；AI 生成圖必須清楚標示，不冒充真實案例。"
  },
  {
    id: "pickup-logistics",
    label: "免費收送與大量送洗",
    customer_goal: "確認台中哪些地區可收送、如何預約、哪些物件可先詢問，以及免費的範圍。",
    query_examples: ["台中洗衣收送", "台中免費收送洗衣", "台中到府收送洗衣", "台中公司大量衣物送洗", "台中床組到府收送"],
    answer_pattern: "直接回答台中市全區、收送免費、清潔另計、LINE 預約，再說明要提供的照片、品項與地區。",
    evidence_required: ["pickup-logistics", "verified-business-fact"],
    primary_routes: [
      "/services/taichung-citywide-laundry-pickup.html",
      "/services/business-bulk-laundry.html",
      "/go/line.html"
    ],
    guardrail: "收送免費不得寫成清洗免費；未經店主確認不得自行新增最低件數、價格或時效。"
  },
  {
    id: "aftercare",
    label: "雨季與收納照護",
    customer_goal: "知道淋雨、使用或清洗後如何通風、收納，以及什麼狀況不應繼續自行處理。",
    query_examples: ["鞋子淋雨後怎麼收", "棉被收納前要洗嗎", "雨季鞋櫃濕氣", "外套有煙味怎麼收", "包包受潮怎麼辦"],
    answer_pattern: "先給一個可立即執行且低風險的動作，再說明需要停止自行處理並傳照片詢問的警訊。",
    evidence_required: ["first-party-inspection", "customer-question"],
    primary_routes: [
      "/guides/rainy-shoe-care.html",
      "/guides/bedding-storage-check.html",
      "/guides/photo-before-laundry.html"
    ],
    guardrail: "不提供可能傷材質的強藥劑、漂白、高溫或硬刷指令。"
  }
];

export const AI_VISIBILITY_REVIEW_28D = {
  version: "2026-07-28",
  purpose: "分開量測傳統搜尋、AI 品牌提及、來源引用與實際 LINE 轉換，不用單一分數宣稱成功。",
  engines: [
    "google-web",
    "google-ai-overview",
    "chatgpt-search",
    "perplexity",
    "bing-copilot",
    "gemini",
    "grok-search"
  ],
  checkpoints: [
    {
      day: 0,
      action: "固定問題面板、裝置或地區、引擎與查詢原文；建立基準，缺失資料保留 null。"
    },
    {
      day: 7,
      action: "只看是否被抓取、索引、提及或引用的早期變化；不因一次答案波動改整個內容策略。"
    },
    {
      day: 28,
      action: "按引擎與搜尋意圖比較趨勢，結合 GSC、AI 引用網址、LINE 點擊、有效詢問、預約與營收決定保留題組。"
    }
  ],
  prompt_rules: [
    "探索型問題不得先放入私享家品牌名，避免把品牌注入誤判為自然能見度。",
    "品牌核對型問題獨立記錄，用來檢查店名、地址、服務與營業資訊是否準確。",
    "同一問題在各引擎使用相同原文；若答案沒有來源連結，brand_mention 與 linked_citation 必須分開記錄。",
    "每筆結果保存引擎、查詢、日期、品牌位置、被引用網址、競品來源、答案正確性與可重現證據。"
  ],
  metrics: [
    { id: "indexed_page", definition: "對應的人類可讀 HTML 頁是否可被搜尋引擎索引。" },
    { id: "brand_mention", definition: "答案文字是否提到私享家，不要求附來源網址。" },
    { id: "linked_citation", definition: "答案是否附上私享家網域中的可點擊來源網址。" },
    { id: "recommendation_position", definition: "私享家若進入候選清單，記錄出現順序；未出現保留 null。" },
    { id: "cited_url", definition: "實際被引用的服務頁、指南頁或貼文頁。" },
    { id: "answer_accuracy", definition: "店名、地址、收送範圍、服務與處理界線是否正確。" },
    { id: "ai_referral", definition: "分析工具可辨識的 AI 來源造訪；無法辨識時保留 null。" },
    { id: "line_click", definition: "由對應頁面進入 LINE 的點擊。" },
    { id: "qualified_inquiry", definition: "有物件、材質、問題或收送地區資訊的有效詢問。" },
    { id: "booking_or_revenue", definition: "可追溯到該題組的預約或營收；無歸因證據時保留 null。" }
  ],
  decision_rules: [
    "只有提及增加但沒有引用、LINE 點擊或有效詢問時，不判定為商業成功。",
    "同一題組至少比較兩個時間點與三個以上引擎，避免把一次生成差異當成趨勢。",
    "保留能同時提升搜尋曝光或 AI 能見度，且帶來有效詢問的題組；停止大量相似但沒有證據與轉換的內容。"
  ]
} as const;

export const COMMUNITY_PRACTICE_SOURCES = [
  {
    platform: "X",
    url: "https://x.com/harpreetchatha_/status/2069991843367198774",
    observed_practice: "SEO 可索引性、品牌共識與引擎差異仍是 AEO/GEO 的底層，llms.txt 或特殊 schema 不應被當成已證實的流量捷徑。",
    evidence_level: "practitioner-discussion"
  },
  {
    platform: "X",
    url: "https://x.com/Mrinalini_sen99/status/2080141408296665188",
    observed_practice: "以客戶問題、競品引用缺口、逐引擎監測與固定週期建立 AI share-of-voice 檢查。",
    evidence_level: "practitioner-discussion"
  },
  {
    platform: "X",
    url: "https://x.com/1414sergiy/status/2080302938938040498",
    observed_practice: "品牌被提到與網站被附來源引用是不同事件，量測時必須拆開。",
    evidence_level: "practitioner-discussion"
  },
  {
    platform: "X",
    url: "https://x.com/izhongyuting/status/2081050461684306354",
    observed_practice: "AI 能見度應按問題類型與引擎拆分，不能只看全站單一分數。",
    evidence_level: "practitioner-discussion"
  },
  {
    platform: "GitHub",
    url: "https://github.com/danishashko/geo-aeo-tracker",
    observed_practice: "開源實作使用固定 prompt、跨引擎執行、引用網址、競品缺口與歷史趨勢來追蹤 AI 能見度。",
    evidence_level: "open-source-implementation"
  },
  {
    platform: "GitHub",
    url: "https://github.com/coreyhaines31/marketingskills/blob/main/skills/ai-seo/SKILL.md",
    observed_practice: "分開追蹤 citation rate、share of voice、recommendation rate、source attribution，並以固定查詢面板定期複查。",
    evidence_level: "open-source-practitioner-guide"
  },
  {
    platform: "GitHub",
    url: "https://github.com/Auriti-Labs/geo-optimizer-skill",
    observed_practice: "爬蟲出現、頁面可讀、品牌提及與實際附來源引用是不同證據，需要不同檢查。",
    evidence_level: "open-source-implementation"
  },
  {
    platform: "GitHub",
    url: "https://github.com/AnswerDotAI/llms-txt",
    observed_practice: "llms.txt 是協助模型在推論時選擇網站內容的導覽提案，不是排名或流量保證。",
    evidence_level: "format-proposal"
  }
] as const;

const SERVICE_QUERY_MAP: Record<string, string[]> = {
  "white-shoe": [
    "台中洗鞋",
    "西屯洗鞋",
    "逢甲洗鞋",
    "台中白鞋清潔",
    "白鞋泛黃怎麼辦",
    "白鞋變黃怎麼辦",
    "球鞋清洗台中",
    "運動鞋清洗台中"
  ],
  "shoe-bag": [
    "台中洗鞋",
    "西屯洗鞋",
    "逢甲洗鞋",
    "台中洗包包",
    "西屯洗包包",
    "台中洗包",
    "包包提把清潔",
    "包包發霉怎麼辦",
    "皮革包包清潔",
    "台中洗鞋店",
    "台中白鞋清潔",
    "球鞋清洗台中",
    "運動鞋清洗台中"
  ],
  "fabric-storage": [
    "台中棉被清洗",
    "台中床組清洗",
    "西屯寢具清洗",
    "台中羽絨被送洗",
    "台中外套清洗",
    "棉被有潮味怎麼辦",
    "布品收納前檢查"
  ],
  local: [
    "台中西屯洗衣店",
    "西屯洗衣店",
    "青海路洗衣店",
    "逢甲洗衣店",
    "台中洗鞋",
    "西屯洗鞋",
    "逢甲洗鞋",
    "台中洗包包",
    "西屯洗包包",
    "台中免費收送洗衣"
  ],
  "photo-guide": [
    "洗衣送洗前怎麼拍",
    "洗鞋送洗前怎麼拍",
    "洗包包送洗前怎麼拍",
    "LINE 傳照片報價",
    "送洗前要拍哪裡",
    "台中洗鞋預約",
    "台中洗包包預約"
  ],
  "shirt-suit": [
    "台中西裝乾洗",
    "西屯西裝乾洗",
    "台中襯衫清洗",
    "西屯乾洗店",
    "西裝要乾洗嗎",
    "西裝送洗注意事項"
  ],
  "bedding-duvet": [
    "台中床組清洗",
    "台中棉被清洗",
    "西屯寢具清洗",
    "台中羽絨被送洗",
    "台中床被收送",
    "棉被有潮味怎麼辦"
  ],
  "plush-doll": [
    "台中娃娃清洗",
    "台中布偶清潔",
    "絨毛玩偶送洗",
    "娃娃可以洗嗎"
  ],
  "luxury-dry": [
    "台中精品乾洗",
    "台中名牌衣物清潔",
    "西屯精品乾洗",
    "精緻乾洗",
    "精品衣物怎麼洗"
  ],
  "pickup-delivery": [
    "台中洗衣收送",
    "台中免費收送洗衣",
    "台中到府收送洗衣",
    "西屯洗衣收送",
    "逢甲洗衣收送",
    "台中床被收送",
    "台中公司大量衣物送洗"
  ]
};

function clusterById(id: SearchIntentId): SearchIntentCluster {
  const cluster = SEARCH_INTENT_CLUSTERS.find((item) => item.id === id);
  if (!cluster) throw new Error(`Missing search intent cluster: ${id}`);
  return cluster;
}

function intentForContent(service: string, slot: number, topic: string): SearchIntentId {
  if (service === "pickup-delivery") return "pickup-logistics";
  if (service === "local") return "local-discovery";
  if (/收納|雨|濕|潮|悶|味|旅行|整理|保養|不要/u.test(topic)) return "aftercare";
  if (/乾洗|一起送洗|局部|整體|自行|自己/u.test(topic)) return "service-comparison";
  return slot === 1 ? "problem-diagnosis" : "trust-proof";
}

function evidenceFor(intent: SearchIntentId, slot: number): SearchEvidenceType {
  if (intent === "pickup-logistics") return "pickup-logistics";
  if (intent === "local-discovery") return "verified-business-fact";
  if (intent === "service-comparison") return "service-boundary";
  if (intent === "trust-proof") return slot === 2 ? "real-case-photo" : "first-party-inspection";
  if (intent === "aftercare") return "customer-question";
  return "first-party-inspection";
}

function prioritizedServiceQueries(service: string, topic: string): string[] {
  const serviceQueries = SERVICE_QUERY_MAP[service] ?? [];
  if (service !== "shoe-bag") return serviceQueries;

  const isBagTopic = /包|提把|皮革|皮件|錢包/u.test(topic);
  const isShoeTopic = /鞋|球鞋|白鞋|勃肯/u.test(topic);
  if (!isBagTopic && !isShoeTopic) return serviceQueries;

  const shoeQueries = serviceQueries.filter((query) => /鞋/u.test(query));
  const bagQueries = serviceQueries.filter((query) => /包|皮革/u.test(query));
  const remaining = serviceQueries.filter((query) => !/鞋|包|皮革/u.test(query));

  if (isBagTopic && isShoeTopic) {
    return [...shoeQueries.slice(0, 3), ...bagQueries.slice(0, 3), ...remaining];
  }
  return isBagTopic
    ? [...bagQueries, ...shoeQueries, ...remaining]
    : [...shoeQueries, ...bagQueries, ...remaining];
}

export function searchVisibilityForContent(service: string, slot: number, topic: string): SearchVisibilityAssignment {
  const searchIntent = intentForContent(service, slot, topic);
  const cluster = clusterById(searchIntent);
  const serviceQueries = prioritizedServiceQueries(service, topic);
  // A content package needs enough query coverage to describe a real local
  // service, but it must not turn into a public keyword wall. Keep the first
  // six service-specific purchase/problem terms and add intent companions when
  // needed. A shoe or bag topic prioritizes its own object words before the
  // shared service set.
  const targetQueries = Array.from(new Set([...serviceQueries.slice(0, 6), ...cluster.query_examples])).slice(0, 6);

  return {
    search_intent: searchIntent,
    target_queries: targetQueries,
    evidence_type: evidenceFor(searchIntent, slot)
  };
}
