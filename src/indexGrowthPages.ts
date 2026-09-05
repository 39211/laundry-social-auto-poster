/**
 * Phase-1 index-growth catalog: publish_state-gated records, claim-level
 * provenance, and a single validator/resolver that returns an accepted-only
 * public projection. Draft/rejected/merge records cannot enter generators.
 *
 * Similarity: character 3-gram Jaccard on boilerplate-stripped diagnostic text.
 * Doorway-geo uses a location-agnostic procedure fingerprint so an unseen
 * place name substituted through title/body still fails closed.
 */

import { createHash } from "node:crypto";
import type { SupportPageDefinition } from "./publicSiteTypes";
import { KNOWN_SERVICE_SLUGS, isKnownServiceSlug } from "./publicSiteTypes";

export type IndexGrowthHubGroup = "shoes" | "bags" | "textiles" | "decisions" | "local";
export type IndexGrowthPublishState = "accepted" | "draft" | "rejected" | "merge";

export interface IndexGrowthFaq {
  question: string;
  answer: string;
  source_refs: string[];
}

export interface IndexGrowthStep {
  name: string;
  text: string;
  source_refs: string[];
}

export interface IndexGrowthSection {
  heading: string;
  body: string;
  source_refs: string[];
}

export interface IndexGrowthPageDefinition {
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
  content_lastmod?: string;
  content_revision?: string;
  publish_state?: IndexGrowthPublishState;
  intent_cluster?: string;
  canonical_intent_slug?: string;
  citation_source_refs?: string[];
  steps: Array<{ name: string; text: string; source_refs?: string[] }>;
  sections?: Array<{ heading: string; body: string; source_refs?: string[] }>;
  citation_answer?: string;
  faqs: Array<{ question: string; answer: string; source_refs?: string[] }>;
  related_slugs: string[];
  hub_group: IndexGrowthHubGroup;
}

export interface FrozenSourceRecord {
  id: string;
  kind: "service" | "guide" | "local" | "business-profile";
  origin: string;
  note: string;
  content_hash: string;
}

export interface ClaimProvenanceBinding {
  ref: string;
  locator: string;
  summary: string;
  content_hash: string;
}

export interface ProtectedIndexGrowthLock {
  content_revision: string;
  body_hash: string;
}

export interface DiagnosticPage {
  slug: string;
  path: string;
  title: string;
  h1: string;
  description?: string;
  summary?: string;
  keywords?: string[];
  local_intent?: string;
  citation_answer?: string;
  steps?: Array<{ name: string; text: string }>;
  sections?: Array<{ heading: string; body: string }>;
  faqs?: Array<{ question: string; answer: string }>;
}

export interface IndexGrowthValidationFailure {
  code: string;
  message: string;
  slugs?: string[];
}

export interface IndexGrowthValidationResult {
  ok: boolean;
  failures: IndexGrowthValidationFailure[];
}

export interface RejectedIndexGrowthCandidate {
  slug: string;
  proposed_title: string;
  status: "rejected" | "merge" | "draft";
  reason: string;
  publish_state: "rejected" | "merge" | "draft";
}

export const INDEX_GROWTH_SIMILARITY_THRESHOLD = 0.68;
export const INDEX_GROWTH_CITATION_MAX = 50;
export const INDEX_GROWTH_MIN_STEPS = 3;
export const INDEX_GROWTH_MIN_SECTIONS = 3;
export const INDEX_GROWTH_MIN_FAQS = 3;
export const INDEX_GROWTH_MIN_SECTION_CHARS = 70;
export const INDEX_GROWTH_MIN_FAQ_CHARS = 20;
export const INDEX_GROWTH_MIN_STEP_CHARS = 16;

export const PROTECTED_LIVE_COHORT_SLUGS = [
  "luggage-wheel-cleaning",
  "curtain-cleaning",
  "carpet-cleaning",
  "fengjia-laundry-pickup",
  "zhongke-office-laundry",
  "donghai-laundry-pickup"
] as const;

export const PROTECTED_LIVE_COHORT_HASHES: Record<(typeof PROTECTED_LIVE_COHORT_SLUGS)[number], string> = {
  "luggage-wheel-cleaning": "d0c13debf21d1087db91ea7b12d1e7ff336f4d302e7925c27ceffd6d5d1c0905",
  "curtain-cleaning": "20fff04cbca946d659f10ff633360cde67abe56392bcd143641db9b86d1d405b",
  "carpet-cleaning": "44b570616fee285c8fad2401153e94ad5bd2c7f7679477623659f808c7507863",
  "fengjia-laundry-pickup": "7c5e06aa9869c82bc30e220f03e0a20d349ee0114e72b40a213738f413027fb7",
  "zhongke-office-laundry": "dc0511c1cacb7897aa11546b1be12a5bf90a9609e52c8f239c7052728175009b",
  "donghai-laundry-pickup": "c8a0aab64b8a9b0ba28c60190ff12d109f884ced7e78156bbb0c7e77ca23f9d0"
};

export const PROTECTED_INDEX_GROWTH_LOCKS: Record<string, ProtectedIndexGrowthLock> = {
  "suede-shoe-cleaning": {
    content_revision: "2026-08-30#1",
    body_hash: "d8e6beec999909c778ed5a4ffc456b78bba9a8c49bbe906d8e150ceaa2cec1ab"
  },
  "canvas-shoe-mud": {
    content_revision: "2026-08-30#1",
    body_hash: "0dd63c4ef5df06e012f1280742d70085d7739ebb3c3140296d7f5b4f2f348343"
  },
  "leather-shoe-water-marks": {
    content_revision: "2026-08-30#1",
    body_hash: "e5000287b1449c3fc010f8fdff4dcfde87cf3718c5366a16dff24f5cd648f215"
  },
  "shoe-odor-source": {
    content_revision: "2026-08-30#1",
    body_hash: "f63621b9d70217dfa598461b28167c44cf24b9090dd00522be5dc7cc5c8cfb5d"
  },
  "washing-machine-shoe-risk": {
    content_revision: "2026-08-30#1",
    body_hash: "738debaa0bf0d7709665e8bb6bfcaecdbb9d814eb5b33db64651a137ca305674"
  },
  "athletic-shoe-mixed-materials": {
    content_revision: "2026-08-30#1",
    body_hash: "c77a44ea1fc2c27816ae1b6d0e279e573376125ed1efcba2a13a01323d50f03a"
  },
  "shoe-mold-surface-check": {
    content_revision: "2026-08-30#1",
    body_hash: "1f2b991678d80fef53e0c74e03169df974708fef8ea1d88747febdc35cc9551d"
  },
  "shoe-sole-separation-limit": {
    content_revision: "2026-08-30#1",
    body_hash: "db65b727ab12d4d07e3d8b094425f635dbefe0b9605bfc3b303373c264f19eb4"
  },
  "bag-color-transfer": {
    content_revision: "2026-08-30#1",
    body_hash: "83735a82b3eff8d6b2e5533c5f62e82f5f39011bf16d0c12aed25157ef4950ec"
  },
  "bag-ink-marks": {
    content_revision: "2026-08-30#1",
    body_hash: "de1868133776e037f171ea3ec01b9f49e386ab0d0c0b787a345c2e24b9e11db0"
  },
  "bag-lining-care": {
    content_revision: "2026-08-30#1",
    body_hash: "6dda38471538c5004ab48b8afb9fff36f018db4d75015cff162cb3b551de8130"
  },
  "nylon-bag-care": {
    content_revision: "2026-08-30#1",
    body_hash: "b16df670999449d4a6f46150a9aad55fd2b35db00c3791a346bc1cb146ae9a03"
  },
  "canvas-bag-care": {
    content_revision: "2026-08-30#1",
    body_hash: "913903d6418ead4fcabdbcf613bd982426dfdc4562dc01b0ceeff5a1627ab651"
  },
  "backpack-cleaning-check": {
    content_revision: "2026-08-30#1",
    body_hash: "0419de882651c6ede97a2027a5151298b854ab1779ef27edbbb4515b3bfc4a5d"
  },
  "bag-clean-vs-repair": {
    content_revision: "2026-08-30#1",
    body_hash: "da5d477c0d48cf888f9dd68bfbe2347c0ff9a3db4dc9ea68f2a42b4d419195f7"
  },
  "wool-coat-dry-clean": {
    content_revision: "2026-08-30#1",
    body_hash: "779195fdf4dbf040dfb2374a90338410fbe918777d3f14d1a6fb369968b746d7"
  },
  "wool-knit-shrink-risk": {
    content_revision: "2026-08-30#1",
    body_hash: "fe8e115ad0670a3261dff5ec45b8de358267716175682980c0aadca4f5d705c5"
  },
  "clothing-mold-airing": {
    content_revision: "2026-08-30#1",
    body_hash: "785cfcf9bbe59b52e48468dbf12e3325ecab8e528ab6b2a7b6cb8963ca28410e"
  },
  "vacuum-bag-storage-risk": {
    content_revision: "2026-08-30#1",
    body_hash: "f4cae2e884d3b39a6486cdab917176c400878aa49cc35e360159464943b366e0"
  },
  "oil-vs-water-stain-choice": {
    content_revision: "2026-08-30#1",
    body_hash: "4748481f4fc5f9554255afd4a3f7f0ca0c11ae4b69fc0c2effa563eb62c5adfa"
  },
  "blanket-damp-check": {
    content_revision: "2026-08-30#1",
    body_hash: "1fe873dfc9aec3fb5f0871a4b425e55f883f16f3825de4601c40bd7933355d00"
  },
  "post-wash-drying-before-storage": {
    content_revision: "2026-08-30#1",
    body_hash: "21bd717633a6aaab77d39e932e97db0fe4b41b9de2c867a71519ddc6669925dd"
  },
  "synthetic-vs-leather-handle": {
    content_revision: "2026-08-30#1",
    body_hash: "25518feb653302d92ff1d43daae9e1b03a9a693bdecf6b26499b8a035fd900b0"
  },
  "rainy-bag-care": {
    content_revision: "2026-08-30#1",
    body_hash: "c7f76465c979ae13c3c4fdaf8db847ba3b278d3311da13cd31ea1bea9bb5ed3a"
  }
};

/** Pinned source digests. These are reviewed lock values, not startup self-hashes. */
export const PINNED_INDEX_GROWTH_SOURCE_HASHES: Record<string, string> = {
  "bp:business-profile": "9717cb6eb58ebc8c59995be2e1d57065afb4f0b8c7b00b21a838700474275868",
  "svc:shoe-bag-care": "dc64765b040c987d4aab759c6cbb14d5fdd9bd9fb2ff70d05fe33afe714c3c06",
  "svc:white-shoe-cleaning": "7df031a58780f269c7f8c8486814225692c3c3d3eaaf3ad25d2fc677da86541e",
  "svc:fabric-storage": "417418ad5881e5d04b5d38955bdacf90fc59d10ce491965a5c4b4c9d3e5dc0d8",
  "svc:taichung-xitun-laundry": "3afec3dc6c989e77e0a147d09fedad3ad7112a8d42ac1341180670b3ca8b6234",
  "svc:business-bulk-laundry": "5adc52341d323b5800d7b0513bc229dfd4c024abbd0d9f110bb7321f6ed12133",
  "svc:taichung-citywide-laundry-pickup": "94f30e12bf67393d2e67b789ac0cf0d178e6a14755caedca4edf9f1cc4f18ca3",
  "svc:taichung-laundry-price-list": "ebf619e518226d7af93e67e5f31430227e5fd2bf99563fae4c9e64cd6eed22f8",
  "guide:photo-before-laundry": "d4d6cacc10866d6eaf4ffc41ac9b46bcc3e9c7b79c88d519d2ddcbef142c9975",
  "guide:white-shoe-yellowing": "64ddc71651a9ea8fdc1ef774bd1c22148bef86deb0831e0c50cbe78e016970d5",
  "guide:rainy-shoe-care": "1ee1833cb4392f2e08589cd8bb7eb56eda846ce89d5de25b9466241ae7229c01",
  "guide:bag-handle-cleaning": "903d3ebed5ed289dd440390a75ed04cdf251d6b1ab0eda96c0b7e61bb4f6c1f1",
  "guide:luxury-bag-mold": "e3627181211b749522ef4c878ff4a76ef838debd1cc31c4bc74105029421e6f0",
  "guide:birkenstock-care": "ca2fe5d9c45fbd7146101dd6f229fec52096ae974ec6fdaf689eac657fe25df5",
  "guide:plush-doll-cleaning": "c9b098d8946b70d6a1f3186d50be0b9c43a7fad43bbf4f1e8fb63486d7429872",
  "guide:dry-cleaning-guide": "22009a2959538f89b722f2450c7185dfc8745261a70dfe0ad6d45f54abf3cf30",
  "guide:school-uniform-care": "e4034f6201bb378c0d079b7edced63a595818aad2ed2278fd7ac90b5170bb40d",
  "guide:shirt-suit-dry-cleaning": "6ee23715668511641577b010ab6b3fd63c0c9dd744ed3d1c449732cbfb5b7eaa",
  "guide:bedding-storage-check": "0ac016842327bff1f4dabe52b17bb11dfb8c582c27b92d7f8b6323ce67d79191",
  "guide:bedding-duvet-cleaning": "0e0af56bb5fb2040507c46ce064e53d4c1665c2755a6f7f08afaebbad8b33209",
  "guide:down-jacket-cleaning": "4257e87d3ae25e23b49af9f692b5b3ca67d1d66d008a145da58c68eeb977bb06",
  "guide:leather-jacket-care": "95a271451f3ee434639b1dec8835a180c1895318306397d8da0fe0f577aed4ae",
  "guide:qinghai-road-shoe-cleaning": "85858de4a226ad77912ace476047233f13a072113887aacbf9e22721297a82fb",
  "guide:luggage-wheel-cleaning": "4e1c04fbc9509b1a7ce04b756e28312e5d8147fb1abc13a56e884ba314adb5aa",
  "guide:curtain-cleaning": "09421c537e9df1524027817e63e6cb85d22a8750d48c85642c778b34d997087a",
  "guide:carpet-cleaning": "8ec38df30c5840fe8338513103cd2485efd89e0e4c97c1a2f45d62606ff03561"
};

export const INDEX_GROWTH_HUB_ORDER: Array<{
  id: IndexGrowthHubGroup;
  heading: string;
  intro: string;
}> = [
  {
    id: "shoes",
    heading: "鞋類判斷",
    intro: "先分材質與問題：麂皮倒伏、帆布濕泥、皮面水痕、味道來源、機洗風險、發霉與開膠，不是同一種刷法。"
  },
  {
    id: "bags",
    heading: "包類與皮革判斷",
    intro: "色移、筆痕、內裡、尼龍、帆布、背包與雨後包角，要先分髒污、掉色和磨耗，清潔不是補色。"
  },
  {
    id: "textiles",
    heading: "衣物與布品判斷",
    intro: "羊毛大衣、針織縮水、衣物發霉與毯子潮氣，先看洗標和乾燥狀態再決定清不清理。"
  },
  {
    id: "decisions",
    heading: "送洗與收納決策",
    intro: "油污或汗漬、真空袋、洗後乾燥，以及送洗前怎麼拍照；先選對問題頁，再連到對應服務。"
  },
  {
    id: "local",
    heading: "在地與找服務",
    intro: "門市位置、台中市收送與查詢入口。地區頁不是把同一篇答案換成另一個地名。"
  }
];

export const EXISTING_SUPPORT_HUB_GROUPS: Record<string, IndexGrowthHubGroup> = {
  "photo-before-laundry": "decisions",
  "white-shoe-yellowing": "shoes",
  "school-uniform-care": "textiles",
  "birkenstock-care": "shoes",
  "luxury-bag-mold": "bags",
  "down-jacket-cleaning": "textiles",
  "leather-jacket-care": "textiles",
  "dry-cleaning-guide": "decisions",
  "rainy-shoe-care": "shoes",
  "bag-handle-cleaning": "bags",
  "bedding-storage-check": "textiles",
  "shirt-suit-dry-cleaning": "decisions",
  "bedding-duvet-cleaning": "textiles",
  "plush-doll-cleaning": "textiles",
  "luxury-dry-cleaning": "decisions",
  "luxury-designer-shoe-care": "shoes",
  "taichung-laundry-service-search": "local",
  "clothing-alteration-with-laundry": "decisions",
  "qinghai-road-shoe-cleaning": "local",
  "luggage-wheel-cleaning": "bags",
  "curtain-cleaning": "textiles",
  "carpet-cleaning": "textiles",
  "fengjia-laundry-pickup": "local",
  "zhongke-office-laundry": "local",
  "donghai-laundry-pickup": "local"
};

export function frozenSourceRecordHash(record: {
  id: string;
  kind: FrozenSourceRecord["kind"];
  origin: string;
  note: string;
}): string {
  return createHash("sha256")
    .update(`id=${record.id}\nkind=${record.kind}\norigin=${record.origin}\nnote=${record.note}`, "utf8")
    .digest("hex");
}

function pinnedSourceHash(id: string): string | undefined {
  return PINNED_INDEX_GROWTH_SOURCE_HASHES[id];
}

function sourceMatchesPinnedLock(id: string, record: FrozenSourceRecord): boolean {
  if (id !== record.id) return false;
  const pinned = pinnedSourceHash(id);
  if (!pinned || !record.content_hash?.trim()) return false;
  return record.content_hash === pinned && frozenSourceRecordHash(record) === pinned;
}

function freezeSourceRecord(id: string, record: Omit<FrozenSourceRecord, "content_hash">): FrozenSourceRecord {
  if (id !== record.id) {
    throw new Error(`source registry key ${id} does not match record.id ${record.id}`);
  }
  const pinned = pinnedSourceHash(id);
  if (!pinned) {
    throw new Error(`missing pinned source hash for ${id}`);
  }
  if (frozenSourceRecordHash(record) !== pinned) {
    throw new Error(`source ${id} origin/note does not match the pinned content hash`);
  }
  return { ...record, content_hash: pinned };
}

/** Frozen first-party sources. Competitors are demand discovery only. */
const RAW_INDEX_GROWTH_SOURCE_REGISTRY: Record<string, Omit<FrozenSourceRecord, "content_hash">> = {
  "bp:business-profile": {
    id: "bp:business-profile",
    kind: "business-profile",
    origin: "data/business-profile.json",
    note: "Owner-verified NAP, hours, LINE, and citywide pickup facts."
  },
  "svc:shoe-bag-care": {
    id: "svc:shoe-bag-care",
    kind: "service",
    origin: "src/generatePublicSite.ts",
    note: "Live shoe/bag service definition."
  },
  "svc:white-shoe-cleaning": {
    id: "svc:white-shoe-cleaning",
    kind: "service",
    origin: "src/generatePublicSite.ts",
    note: "Live white-shoe service definition."
  },
  "svc:fabric-storage": {
    id: "svc:fabric-storage",
    kind: "service",
    origin: "src/generatePublicSite.ts",
    note: "Live fabric/storage service definition."
  },
  "svc:taichung-xitun-laundry": {
    id: "svc:taichung-xitun-laundry",
    kind: "service",
    origin: "src/generatePublicSite.ts",
    note: "Live Xitun laundry service definition."
  },
  "svc:business-bulk-laundry": {
    id: "svc:business-bulk-laundry",
    kind: "service",
    origin: "src/generatePublicSite.ts",
    note: "Live bulk/office laundry service definition."
  },
  "svc:taichung-citywide-laundry-pickup": {
    id: "svc:taichung-citywide-laundry-pickup",
    kind: "service",
    origin: "src/generatePublicSite.ts",
    note: "Live citywide pickup service definition."
  },
  "svc:taichung-laundry-price-list": {
    id: "svc:taichung-laundry-price-list",
    kind: "service",
    origin: "src/generatePublicSite.ts",
    note: "Live public price-list definition."
  },
  "guide:photo-before-laundry": {
    id: "guide:photo-before-laundry",
    kind: "guide",
    origin: "src/generatePublicSite.ts",
    note: "Photo-before-laundry guide."
  },
  "guide:white-shoe-yellowing": {
    id: "guide:white-shoe-yellowing",
    kind: "guide",
    origin: "src/generatePublicSite.ts",
    note: "White-shoe grey vs yellow guide."
  },
  "guide:rainy-shoe-care": {
    id: "guide:rainy-shoe-care",
    kind: "guide",
    origin: "src/generatePublicSite.ts",
    note: "Rainy-shoe care guide."
  },
  "guide:bag-handle-cleaning": {
    id: "guide:bag-handle-cleaning",
    kind: "guide",
    origin: "src/generatePublicSite.ts",
    note: "Bag-handle, corner, and luggage-wheel guide."
  },
  "guide:luxury-bag-mold": {
    id: "guide:luxury-bag-mold",
    kind: "guide",
    origin: "src/generatePublicSite.ts",
    note: "Luxury-bag mold guide."
  },
  "guide:birkenstock-care": {
    id: "guide:birkenstock-care",
    kind: "guide",
    origin: "src/generatePublicSite.ts",
    note: "Birkenstock cork/suede boundary."
  },
  "guide:plush-doll-cleaning": {
    id: "guide:plush-doll-cleaning",
    kind: "guide",
    origin: "src/generatePublicSite.ts",
    note: "Plush dehydration/spin-cycle boundary."
  },
  "guide:dry-cleaning-guide": {
    id: "guide:dry-cleaning-guide",
    kind: "guide",
    origin: "src/generatePublicSite.ts",
    note: "Dry-clean vs wash decision guide."
  },
  "guide:school-uniform-care": {
    id: "guide:school-uniform-care",
    kind: "guide",
    origin: "src/generatePublicSite.ts",
    note: "Uniform and school-bag mention."
  },
  "guide:shirt-suit-dry-cleaning": {
    id: "guide:shirt-suit-dry-cleaning",
    kind: "guide",
    origin: "src/generatePublicSite.ts",
    note: "Shirt/suit structure guide."
  },
  "guide:bedding-storage-check": {
    id: "guide:bedding-storage-check",
    kind: "guide",
    origin: "src/generatePublicSite.ts",
    note: "Bedding storage dryness check."
  },
  "guide:bedding-duvet-cleaning": {
    id: "guide:bedding-duvet-cleaning",
    kind: "guide",
    origin: "src/generatePublicSite.ts",
    note: "Duvet drying-before-storage facts."
  },
  "guide:down-jacket-cleaning": {
    id: "guide:down-jacket-cleaning",
    kind: "guide",
    origin: "src/generatePublicSite.ts",
    note: "Down-jacket drying facts."
  },
  "guide:leather-jacket-care": {
    id: "guide:leather-jacket-care",
    kind: "guide",
    origin: "src/generatePublicSite.ts",
    note: "Leather vs synthetic vs suede paths."
  },
  "guide:qinghai-road-shoe-cleaning": {
    id: "guide:qinghai-road-shoe-cleaning",
    kind: "local",
    origin: "src/generatePublicSite.ts",
    note: "Qinghai-road local shoe page, including suede/canvas facts."
  },
  "guide:luggage-wheel-cleaning": {
    id: "guide:luggage-wheel-cleaning",
    kind: "guide",
    origin: "src/generatePublicSite.ts",
    note: "Live luggage-wheel page."
  },
  "guide:curtain-cleaning": {
    id: "guide:curtain-cleaning",
    kind: "guide",
    origin: "src/generatePublicSite.ts",
    note: "Live curtain page."
  },
  "guide:carpet-cleaning": {
    id: "guide:carpet-cleaning",
    kind: "guide",
    origin: "src/generatePublicSite.ts",
    note: "Live carpet page."
  }
};

export const INDEX_GROWTH_SOURCE_REGISTRY: Record<string, FrozenSourceRecord> = Object.fromEntries(
  Object.entries(RAW_INDEX_GROWTH_SOURCE_REGISTRY).map(([id, record]) => [id, freezeSourceRecord(id, record)])
);

const PLACEHOLDER_PATTERN =
  /TODO|TBD|FIXME|\bXXX\b|lorem ipsum|placeholder|\{\{|\}\}|\[insert|待補|範例客戶|MAGIC|changeme/iu;
const COMPETITOR_PATTERN = /ultron|凌通|rebirth407|spajack|shoescares|ultron-lingtung/iu;
const PRICE_PATTERN = /\$\s*\d+|\d+\s*元(?:起)?/u;
const LASTMOD_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const REVISION_PATTERN = /^(\d{4}-\d{2}-\d{2})#([1-9]\d*)$/u;
const GEO_TOKEN_PATTERN =
  /[\p{Script=Han}A-Za-z0-9]{1,8}(?:市|縣|區|鄉|鎮|里|村|路|街|巷|段|號|夜市|商圈|園區|大學|宿舍|生活圈|工業區)|(?:台|臺)[北中南東]|新北|高雄|基隆|桃園|新竹|嘉義|宜蘭|花蓮|臺東|台東|屏東|雲林|苗栗|南投|澎湖|金門|馬祖|西屯|北屯|南屯|逢甲|東海|中科|青海|公館|大安|士林|西門|文華|福星/gu;
const BOILERPLATE_PHRASES = [
  "私享家洗衣店",
  "私享家",
  "台中市西屯區青海路二段365號",
  "青海路二段365號",
  "至善國中對面",
  "至善國中",
  "0968327653",
  "0968-327-653",
  "台中市全區",
  "台中市可約免費收送",
  "免費到府收送",
  "免費收送",
  "不保證變全新",
  "不保證回白",
  "以實際檢視為準",
  "乾洗柔洗另計",
  "沒有最低消費門檻",
  "對應鞋包清潔頁",
  "對應布品收納頁",
  "對應台中西屯洗衣店頁"
];

/** Established zh counting rule: Unicode code points after stripping whitespace. */
export function citationAnswerLength(value: string): number {
  return Array.from(value.replace(/\s+/gu, "")).length;
}

export function hubGroupFor(page: { slug: string; hub_group?: IndexGrowthHubGroup }): IndexGrowthHubGroup {
  return page.hub_group ?? EXISTING_SUPPORT_HUB_GROUPS[page.slug] ?? "decisions";
}

function stripBoilerplate(text: string): string {
  let next = text;
  for (const phrase of BOILERPLATE_PHRASES) {
    next = next.split(phrase).join("");
  }
  return next;
}

export function normalizeDiagnosticText(text: string, stripLocations = false): string {
  let next = stripBoilerplate(text).normalize("NFKC").toLocaleLowerCase("zh-Hant-TW");
  if (stripLocations) next = next.replace(GEO_TOKEN_PATTERN, "地");
  return next.replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function characterNgrams(text: string, size = 3): Set<string> {
  const chars = Array.from(text);
  const grams = new Set<string>();
  if (chars.length < size) {
    if (chars.length > 0) grams.add(chars.join(""));
    return grams;
  }
  for (let index = 0; index <= chars.length - size; index += 1) {
    grams.add(chars.slice(index, index + size).join(""));
  }
  return grams;
}

export function ngramJaccard(left: string, right: string, size = 3): number {
  const a = characterNgrams(left, size);
  const b = characterNgrams(right, size);
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const gram of a) {
    if (b.has(gram)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

export function pageDiagnosticText(page: DiagnosticPage): string {
  const steps = (page.steps ?? []).map((step) => `${step.name}${step.text}`).join("");
  const sections = (page.sections ?? [])
    .filter((section) => !/送洗前|對應服務|對應鞋包|對應西屯|對應布品/.test(section.heading))
    .map((section) => `${section.heading}${section.body}`)
    .join("");
  const faqs = (page.faqs ?? []).map((faq) => `${faq.question}${faq.answer}`).join("");
  const keywords = (page.keywords ?? []).join("");
  return `${page.title}${page.description ?? ""}${page.h1}${page.summary ?? ""}${keywords}${page.local_intent ?? ""}${page.citation_answer ?? ""}${steps}${sections}${faqs}`;
}

function locationBearingText(page: DiagnosticPage): string {
  return `${page.title}${page.h1}${page.local_intent ?? ""}${page.description ?? ""}${(page.keywords ?? []).join("")}`;
}

function procedureText(page: DiagnosticPage): string {
  const steps = (page.steps ?? []).map((step) => `${step.name}${step.text}`).join("");
  const sections = (page.sections ?? []).map((section) => `${section.heading}${section.body}`).join("");
  const faqs = (page.faqs ?? []).map((faq) => `${faq.question}${faq.answer}`).join("");
  return `${page.citation_answer ?? ""}${page.summary ?? ""}${steps}${sections}${faqs}`;
}

function stripLocationSurface(text: string, locationSurface: string): string {
  let next = normalizeDiagnosticText(text, true);
  const surface = normalizeDiagnosticText(locationSurface, false);
  const surfaceTokens = new Set<string>();
  const chars = Array.from(surface);
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index <= chars.length - size; index += 1) {
      surfaceTokens.add(chars.slice(index, index + size).join(""));
    }
  }
  for (const token of [...surfaceTokens].sort((a, b) => b.length - a.length)) {
    if (token.length >= 2) next = next.split(token).join("");
  }
  return next;
}

export function doorwayFingerprint(page: DiagnosticPage): string {
  return stripLocationSurface(procedureText(page), locationBearingText(page));
}

export function doorwayPairSimilarity(left: DiagnosticPage, right: DiagnosticPage): number {
  const leftId = normalizeDiagnosticText(locationBearingText(left), false);
  const rightId = normalizeDiagnosticText(locationBearingText(right), false);
  const leftGrams = characterNgrams(leftId, 2);
  const rightGrams = characterNgrams(rightId, 2);
  const leftOnly = new Set([...leftGrams].filter((gram) => !rightGrams.has(gram)));
  const rightOnly = new Set([...rightGrams].filter((gram) => !leftGrams.has(gram)));
  const apply = (page: DiagnosticPage, extra: Set<string>): string => {
    let next = normalizeDiagnosticText(procedureText(page), true);
    for (const gram of [...extra].sort((a, b) => b.length - a.length)) {
      if (gram.length >= 2) next = next.split(gram).join("");
    }
    return next;
  };
  return ngramJaccard(apply(left, leftOnly), apply(right, rightOnly));
}

function claimRefs(refs: string[] | undefined): string[] {
  return (refs ?? []).map((ref) => ref.trim()).filter(Boolean);
}

function cloneClaimRefs(refs: readonly string[]): string[] {
  return refs.map((ref) => ref);
}

function sameRefList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((ref, index) => ref === right[index]);
}

export function claimProvenanceBinding(
  ref: string,
  registry: Record<string, FrozenSourceRecord> = INDEX_GROWTH_SOURCE_REGISTRY
): ClaimProvenanceBinding | undefined {
  const record = registry[ref];
  if (!record) return undefined;
  if (!record.origin.trim() || !record.note.trim() || !record.content_hash.trim()) return undefined;
  if (!sourceMatchesPinnedLock(ref, record)) return undefined;
  return {
    ref,
    locator: record.origin,
    summary: record.note,
    content_hash: record.content_hash
  };
}

function pushFailure(
  failures: IndexGrowthValidationFailure[],
  code: string,
  message: string,
  slugs?: string[]
): void {
  failures.push({ code, message, slugs });
}

function clothingMoldPageBlob(page: IndexGrowthPageDefinition): string {
  const steps = (page.steps ?? []).map((step) => `${step.name}${step.text}`).join("");
  const sections = (page.sections ?? []).map((section) => `${section.heading}${section.body}`).join("");
  const faqs = (page.faqs ?? []).map((faq) => `${faq.question}${faq.answer}`).join("");
  return `${page.citation_answer ?? ""}${page.summary}${steps}${sections}${faqs}`;
}

function textPromotesMoldDisturbance(text: string): boolean {
  const pattern = /戶外抖|抖掉霉|刷霉屑|拍打霉/gu;
  const localNegation = /(?:先不要|不要|停手|避免|禁止)$/u;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const prefix = Array.from(text.slice(0, index)).slice(-4).join("");
    if (!localNegation.test(prefix)) return true;
  }
  return false;
}

function hasBleachRatioRecipe(text: string): boolean {
  return /漂白(?:水|液)?[^。\n]{0,24}\d+\s*[:：倍]\s*\d+|\d+\s*[:：]\s*\d+[^。\n]{0,12}漂白/.test(text);
}

function hasGuaranteedMoldRecovery(text: string): boolean {
  const pattern = /保證(?:完全)?(?:恢復|復原|無霉|無斑)|一定(?:可以|能)?(?:恢復|復原)/gu;
  const localNegation = /(?:不|無法|不能)$/u;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const prefix = Array.from(text.slice(0, index)).slice(-2).join("");
    if (!localNegation.test(prefix)) return true;
  }
  return false;
}

function requireClothingMoldSafety(
  failures: IndexGrowthValidationFailure[],
  page: IndexGrowthPageDefinition
): void {
  if (page.slug !== "clothing-mold-airing") return;
  const blob = clothingMoldPageBlob(page);
  if (!/避免擾動/.test(blob)) {
    pushFailure(failures, "mold-safety", `${page.slug} must require avoiding mold disturbance`, [page.slug]);
  }
  if (!/口罩/.test(blob) || !/手套/.test(blob)) {
    pushFailure(failures, "mold-safety", `${page.slug} must require appropriate PPE for close inspection`, [page.slug]);
  }
  if (!/看過物件|門市檢視|專業評估/.test(blob)) {
    pushFailure(failures, "mold-safety", `${page.slug} must keep a professional assessment boundary`, [page.slug]);
  }
  const claimTexts = [
    page.citation_answer ?? "",
    page.summary,
    ...(page.steps ?? []).map((step) => step.text),
    ...(page.sections ?? []).map((section) => section.body),
    ...(page.faqs ?? []).map((faq) => faq.answer)
  ];
  for (const text of claimTexts) {
    if (textPromotesMoldDisturbance(text)) {
      pushFailure(
        failures,
        "mold-safety",
        `${page.slug} must not advise shaking or brushing mold debris`,
        [page.slug]
      );
      break;
    }
  }
  if (hasBleachRatioRecipe(blob)) {
    pushFailure(failures, "mold-safety", `${page.slug} must not publish bleach ratios`, [page.slug]);
  }
  if (hasGuaranteedMoldRecovery(blob)) {
    pushFailure(failures, "mold-safety", `${page.slug} must not claim guaranteed recovery`, [page.slug]);
  }
}

function duplicateMap(values: Array<{ key: string; slug: string }>): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const item of values) {
    const list = grouped.get(item.key) ?? [];
    list.push(item.slug);
    grouped.set(item.key, list);
  }
  return grouped;
}

function requireSourceRefs(
  failures: IndexGrowthValidationFailure[],
  slug: string,
  label: string,
  refs: string[] | undefined,
  registry: Record<string, FrozenSourceRecord>,
  expectedRefs?: string[]
): void {
  const resolved = claimRefs(refs);
  if (resolved.length === 0) {
    pushFailure(failures, "missing-source-refs", `${slug} ${label} is missing source_refs`, [slug]);
    return;
  }
  if (expectedRefs && !sameRefList(resolved, expectedRefs)) {
    pushFailure(
      failures,
      "claim-provenance",
      `${slug} ${label} source_refs are not bound to the frozen claim provenance`,
      [slug]
    );
  }
  for (const ref of resolved) {
    if (!registry[ref]) {
      pushFailure(failures, "unknown-source-ref", `${slug} ${label} source_ref ${ref} is not in the frozen registry`, [slug]);
      continue;
    }
    const binding = claimProvenanceBinding(ref, registry);
    if (!binding) {
      pushFailure(
        failures,
        "source-provenance",
        `${slug} ${label} source_ref ${ref} is missing locator, summary, or immutable content hash`,
        [slug]
      );
    }
  }
}

export function validateIndexGrowthPages(
  pages: IndexGrowthPageDefinition[],
  options: {
    existingPages?: DiagnosticPage[];
    knownServiceSlugs?: readonly string[];
    today?: string;
    sourceRegistry?: Record<string, FrozenSourceRecord>;
  } = {}
): IndexGrowthValidationResult {
  const failures: IndexGrowthValidationFailure[] = [];
  const today = options.today;
  if (!today || !LASTMOD_PATTERN.test(today)) {
    pushFailure(failures, "volatile-lastmod", "validator today must be an explicit YYYY-MM-DD, not build time");
  }
  const existing = options.existingPages ?? [];
  const knownServiceSlugs = new Set(options.knownServiceSlugs ?? KNOWN_SERVICE_SLUGS);
  const sourceRegistry = options.sourceRegistry ?? INDEX_GROWTH_SOURCE_REGISTRY;
  for (const [id, record] of Object.entries(sourceRegistry)) {
    if (!record.origin?.trim() || !record.note?.trim()) {
      pushFailure(failures, "source-provenance", `source registry ${id} is missing origin or note`);
    }
    if (!sourceMatchesPinnedLock(id, record)) {
      pushFailure(
        failures,
        "source-provenance",
        `source registry ${id} content hash does not match the pinned source lock`
      );
    }
  }
  const acceptedPages = pages.filter((page) => page.publish_state === "accepted");
  const knownSlugs = new Set([
    ...Object.keys(EXISTING_SUPPORT_HUB_GROUPS),
    ...existing.map((page) => page.slug),
    ...pages.map((page) => page.slug)
  ]);

  for (const [field, grouped] of [
    ["slug", duplicateMap(acceptedPages.map((page) => ({ key: page.slug, slug: page.slug })))],
    ["path", duplicateMap(acceptedPages.map((page) => ({ key: page.path, slug: page.slug })))],
    ["title", duplicateMap(acceptedPages.map((page) => ({ key: page.title, slug: page.slug })))],
    ["h1", duplicateMap(acceptedPages.map((page) => ({ key: page.h1, slug: page.slug })))],
    [
      "citation_answer",
      duplicateMap(acceptedPages.map((page) => ({ key: page.citation_answer ?? "", slug: page.slug })))
    ],
    ["local_intent", duplicateMap(acceptedPages.map((page) => ({ key: page.local_intent, slug: page.slug })))],
    [
      "canonical_intent_slug",
      duplicateMap(
        acceptedPages.map((page) => ({ key: page.canonical_intent_slug ?? "", slug: page.slug }))
      )
    ]
  ] as Array<[string, Map<string, string[]>]>) {
    for (const [key, slugs] of grouped) {
      if (!key) continue;
      if (slugs.length > 1) {
        pushFailure(failures, "duplicate-field", `duplicate ${field}: ${key}`, slugs);
      }
    }
  }

  for (const page of pages) {
    const slug = page.slug;
    if (!page.publish_state) {
      pushFailure(failures, "publish-state", `${slug} is missing publish_state`, [slug]);
      continue;
    }
    if (!["accepted", "draft", "rejected", "merge"].includes(page.publish_state)) {
      pushFailure(failures, "publish-state", `${slug} has unknown publish_state`, [slug]);
      continue;
    }
    if (page.publish_state !== "accepted") continue;

    if (!page.slug || !page.path || !page.title || !page.h1 || !page.description || !page.summary) {
      pushFailure(failures, "missing-field", `${slug || "(empty-slug)"} is missing a required identity field`, [slug]);
    }
    if (page.category !== "guide") {
      pushFailure(failures, "local-landing", `${slug} is not allowed as a new local landing in this batch`, [slug]);
    }
    if (!page.path.startsWith("guides/") || !page.path.endsWith(".html")) {
      pushFailure(failures, "path-shape", `${slug} path must be guides/*.html`, [slug]);
    }
    if (!page.service_slug) {
      pushFailure(failures, "missing-parent", `${slug} is missing service_slug`, [slug]);
    } else if (!knownServiceSlugs.has(page.service_slug) || !isKnownServiceSlug(page.service_slug)) {
      pushFailure(
        failures,
        "unknown-parent",
        `${slug} service_slug ${page.service_slug} is not in the known service registry`,
        [slug]
      );
    }
    if (!page.intent_cluster) {
      pushFailure(failures, "missing-intent-cluster", `${slug} is missing intent_cluster`, [slug]);
    }
    if (!page.canonical_intent_slug) {
      pushFailure(failures, "missing-canonical-intent", `${slug} is missing canonical_intent_slug`, [slug]);
    }
    if (!page.citation_answer) {
      pushFailure(failures, "citation-fallback", `${slug} is missing citation_answer and would fall back to description`, [
        slug
      ]);
    } else {
      const citationLen = citationAnswerLength(page.citation_answer);
      if (citationLen < 8 || citationLen > INDEX_GROWTH_CITATION_MAX) {
        pushFailure(
          failures,
          "citation-length",
          `${slug} citation_answer length ${citationLen} is outside 8-${INDEX_GROWTH_CITATION_MAX}`,
          [slug]
        );
      }
      if (page.citation_answer === page.description) {
        pushFailure(failures, "citation-fallback", `${slug} citation_answer equals branded description`, [slug]);
      }
    }
    if (page.summary !== page.citation_answer) {
      pushFailure(failures, "citation-lead", `${slug} summary must equal citation_answer so the lead is the query answer`, [
        slug
      ]);
    }
    const intentMeta = PAGE_INTENT_META[slug];
    const expectedClaimRefs = intentMeta ? cloneClaimRefs(intentMeta.sources) : undefined;
    requireSourceRefs(failures, slug, "citation_answer", page.citation_source_refs, sourceRegistry, expectedClaimRefs);
    if (!page.steps || page.steps.length < INDEX_GROWTH_MIN_STEPS) {
      pushFailure(failures, "short-steps", `${slug} needs at least ${INDEX_GROWTH_MIN_STEPS} steps`, [slug]);
    } else {
      page.steps.forEach((step, index) => {
        if (!step.name || citationAnswerLength(step.text) < INDEX_GROWTH_MIN_STEP_CHARS) {
          pushFailure(failures, "short-steps", `${slug} step ${index + 1} is too short`, [slug]);
        }
        requireSourceRefs(failures, slug, `step ${index + 1}`, step.source_refs, sourceRegistry, expectedClaimRefs);
      });
    }
    const sections = page.sections ?? [];
    if (sections.length < INDEX_GROWTH_MIN_SECTIONS) {
      pushFailure(failures, "short-sections", `${slug} needs at least ${INDEX_GROWTH_MIN_SECTIONS} sections`, [slug]);
    } else {
      const headings = new Set<string>();
      sections.forEach((section, index) => {
        if (!section.heading || headings.has(section.heading)) {
          pushFailure(failures, "short-sections", `${slug} section ${index + 1} heading is missing or duplicated`, [slug]);
        }
        headings.add(section.heading);
        if (citationAnswerLength(section.body) < INDEX_GROWTH_MIN_SECTION_CHARS) {
          pushFailure(failures, "short-sections", `${slug} section ${index + 1} body is too short`, [slug]);
        }
        requireSourceRefs(failures, slug, `section ${index + 1}`, section.source_refs, sourceRegistry, expectedClaimRefs);
      });
    }
    if (!page.faqs || page.faqs.length < INDEX_GROWTH_MIN_FAQS) {
      pushFailure(failures, "short-faqs", `${slug} needs at least ${INDEX_GROWTH_MIN_FAQS} FAQs`, [slug]);
    } else {
      page.faqs.forEach((faq, index) => {
        if (!faq.question || citationAnswerLength(faq.answer) < INDEX_GROWTH_MIN_FAQ_CHARS) {
          pushFailure(failures, "short-faqs", `${slug} FAQ ${index + 1} is too short`, [slug]);
        }
        requireSourceRefs(failures, slug, `FAQ ${index + 1}`, faq.source_refs, sourceRegistry, expectedClaimRefs);
      });
    }
    const related = page.related_slugs ?? [];
    const uniqueRelated = new Set(related);
    if (related.length < 2 || uniqueRelated.size !== related.length || related.includes(page.slug)) {
      pushFailure(failures, "related-links", `${slug} needs at least two unique related_slugs and must not self-link`, [
        slug
      ]);
    } else {
      for (const relatedSlug of related) {
        if (!knownSlugs.has(relatedSlug)) {
          pushFailure(failures, "related-links", `${slug} related slug ${relatedSlug} does not exist`, [slug]);
        }
      }
    }
    if (!page.content_lastmod || !LASTMOD_PATTERN.test(page.content_lastmod)) {
      pushFailure(failures, "volatile-lastmod", `${slug} content_lastmod must be explicit YYYY-MM-DD`, [slug]);
    } else if (today && page.content_lastmod > today) {
      pushFailure(
        failures,
        "volatile-lastmod",
        `${slug} content_lastmod ${page.content_lastmod} is after today ${today}`,
        [slug]
      );
    }
    if (!page.content_revision) {
      pushFailure(failures, "revision-mismatch", `${slug} is missing content_revision`, [slug]);
    } else {
      const match = page.content_revision.match(REVISION_PATTERN);
      if (!match) {
        pushFailure(
          failures,
          "revision-mismatch",
          `${slug} content_revision ${page.content_revision} must be YYYY-MM-DD#N`,
          [slug]
        );
      } else if (page.content_lastmod && match[1] !== page.content_lastmod) {
        pushFailure(
          failures,
          "revision-mismatch",
          `${slug} content_revision ${page.content_revision} does not match content_lastmod ${page.content_lastmod}`,
          [slug]
        );
      }
      const lock = PROTECTED_INDEX_GROWTH_LOCKS[slug];
      if (lock && page.content_revision !== lock.content_revision) {
        pushFailure(
          failures,
          "revision-mismatch",
          `${slug} content_revision ${page.content_revision} is not bound to the protected content lock`,
          [slug]
        );
      }
    }
    const lock = PROTECTED_INDEX_GROWTH_LOCKS[slug];
    if (PAGE_INTENT_META[slug] && !lock) {
      pushFailure(failures, "protected-content-hash", `${slug} is missing a protected content lock`, [slug]);
    }
    if (lock && protectedSupportContentHash(page) !== lock.body_hash) {
      pushFailure(
        failures,
        "protected-content-hash",
        `${slug} protected body hash does not match the frozen lock for ${lock.content_revision}`,
        [slug]
      );
    }
    const blob = `${page.title}\n${page.description}\n${page.h1}\n${page.summary}\n${page.citation_answer ?? ""}\n${pageDiagnosticText(page)}`;
    if (PLACEHOLDER_PATTERN.test(blob)) {
      pushFailure(failures, "placeholder", `${slug} contains a placeholder or template token`, [slug]);
    }
    if (COMPETITOR_PATTERN.test(blob)) {
      pushFailure(failures, "competitor-copy", `${slug} contains a competitor name`, [slug]);
    }
    if (PRICE_PATTERN.test(blob)) {
      pushFailure(failures, "unsupported-price", `${slug} quotes a price; point to the price-list page instead`, [slug]);
    }
    const stopBlob = `${(page.sections ?? []).map((section) => section.body).join("")}${page.faqs.map((faq) => faq.answer).join("")}`;
    if (!/停手|不要|不建議|不能|不保證|先不要/.test(stopBlob)) {
      pushFailure(failures, "missing-stop-condition", `${slug} is missing explicit self-care stop conditions`, [slug]);
    }
    if (!/限度|不能當|只能|不是清潔|無法|另評估/.test(stopBlob)) {
      pushFailure(failures, "missing-limitation", `${slug} is missing explicit cleaning limitations`, [slug]);
    }
    requireClothingMoldSafety(failures, page);
  }

  const comparisonTargets: DiagnosticPage[] = [...existing, ...acceptedPages];
  for (const page of acceptedPages) {
    const existingHit = existing.find(
      (item) =>
        item.slug === page.slug ||
        item.path === page.path ||
        item.title === page.title ||
        item.h1 === page.h1 ||
        (page.citation_answer && item.citation_answer === page.citation_answer) ||
        (page.canonical_intent_slug && item.slug === page.canonical_intent_slug && item.slug !== page.slug)
    );
    if (existingHit) {
      pushFailure(
        failures,
        page.canonical_intent_slug && existingHit.slug === page.canonical_intent_slug
          ? "same-intent"
          : "duplicate-existing",
        `${page.slug} collides with existing page ${existingHit.slug}`,
        [page.slug, existingHit.slug]
      );
    }
  }

  for (let i = 0; i < comparisonTargets.length; i += 1) {
    const left = comparisonTargets[i];
    if (!left) continue;
    const leftAccepted = acceptedPages.some((page) => page.slug === left.slug);
    const leftText = normalizeDiagnosticText(pageDiagnosticText(left));
    for (let j = i + 1; j < comparisonTargets.length; j += 1) {
      const right = comparisonTargets[j];
      if (!right) continue;
      const rightAccepted = acceptedPages.some((page) => page.slug === right.slug);
      if (!leftAccepted && !rightAccepted) continue;
      const rightText = normalizeDiagnosticText(pageDiagnosticText(right));
      const similarity = ngramJaccard(leftText, rightText);
      if (similarity >= INDEX_GROWTH_SIMILARITY_THRESHOLD) {
        pushFailure(
          failures,
          "similarity",
          `${left.slug} and ${right.slug} diagnostic 3-gram Jaccard ${similarity.toFixed(3)} >= ${INDEX_GROWTH_SIMILARITY_THRESHOLD}`,
          [left.slug, right.slug]
        );
      }
      const geoSimilarity = doorwayPairSimilarity(left, right);
      if (geoSimilarity >= INDEX_GROWTH_SIMILARITY_THRESHOLD) {
        pushFailure(
          failures,
          "doorway-geo",
          `${left.slug} and ${right.slug} look like a geography-only clone after location substitution (Jaccard ${geoSimilarity.toFixed(3)})`,
          [left.slug, right.slug]
        );
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

export function assertIndexGrowthPagesValid(
  pages: IndexGrowthPageDefinition[],
  options?: Parameters<typeof validateIndexGrowthPages>[1]
): void {
  const result = validateIndexGrowthPages(pages, options);
  if (!result.ok) {
    throw new Error(
      `index growth pages failed validation:\n${result.failures.map((failure) => `${failure.code}: ${failure.message}`).join("\n")}`
    );
  }
}

export function stripIndexGrowthProvenance(page: IndexGrowthPageDefinition): SupportPageDefinition {
  return {
    slug: page.slug,
    path: page.path,
    category: page.category,
    title: page.title,
    description: page.description,
    h1: page.h1,
    summary: page.summary,
    keywords: page.keywords,
    service_slug: page.service_slug,
    local_intent: page.local_intent,
    content_lastmod: page.content_lastmod,
    steps: page.steps.map((step) => ({ name: step.name, text: step.text })),
    sections: (page.sections ?? []).map((section) => ({ heading: section.heading, body: section.body })),
    citation_answer: page.citation_answer,
    faqs: page.faqs.map((faq) => ({ question: faq.question, answer: faq.answer })),
    related_slugs: page.related_slugs,
    hub_group: page.hub_group
  };
}

export function resolveAcceptedIndexGrowthPages(
  catalog: IndexGrowthPageDefinition[],
  options: Parameters<typeof validateIndexGrowthPages>[1] = {}
): SupportPageDefinition[] {
  assertIndexGrowthPagesValid(catalog, options);
  return catalog
    .filter((page) => page.publish_state === "accepted")
    .map(stripIndexGrowthProvenance);
}

export function protectedSupportContentProjection(page: {
  title: string;
  description: string;
  h1: string;
  summary: string;
  citation_answer?: string;
  steps: Array<{ name: string; text: string }>;
  sections?: Array<{ heading: string; body: string }>;
  faqs: Array<{ question: string; answer: string }>;
}): string {
  return JSON.stringify({
    title: page.title,
    description: page.description,
    h1: page.h1,
    summary: page.summary,
    citation_answer: page.citation_answer ?? page.summary,
    steps: page.steps.map((step) => ({ name: step.name, text: step.text })),
    sections: (page.sections ?? []).map((section) => ({ heading: section.heading, body: section.body })),
    faqs: page.faqs.map((faq) => ({ question: faq.question, answer: faq.answer }))
  });
}

export function protectedSupportContentHash(page: Parameters<typeof protectedSupportContentProjection>[0]): string {
  return createHash("sha256").update(protectedSupportContentProjection(page), "utf8").digest("hex");
}

export const INDEX_GROWTH_REJECTED_CANDIDATES: RejectedIndexGrowthCandidate[] = [
  {
    slug: "wallet-cleaning",
    proposed_title: "皮夾怎麼洗",
    status: "rejected",
    publish_state: "rejected",
    reason: "現有公開頁只列皮包/一般包，沒有獨立皮夾檢查流程；薄頁風險高。"
  },
  {
    slug: "mattress-protector-sofa-cover",
    proposed_title: "保潔墊與沙發套",
    status: "rejected",
    publish_state: "rejected",
    reason: "只出現在未公開的 prices.json，現有頁面與 business-profile 沒有可引用事實。"
  },
  {
    slug: "clothing-pilling-vs-stain",
    proposed_title: "起毛球還是污漬",
    status: "rejected",
    publish_state: "rejected",
    reason: "現有內容只把起毛當硬刷風險，沒有衣物起毛球的獨立判斷步驟。"
  },
  {
    slug: "collar-yellowing-everyday",
    proposed_title: "日常衣物領口發黃",
    status: "merge",
    publish_state: "merge",
    reason: "與 school-uniform-care、shirt-suit-dry-cleaning 同一決策簇，不另開頁。"
  },
  {
    slug: "xitun-vs-beitun-shoe-clone",
    proposed_title: "北屯洗鞋",
    status: "rejected",
    publish_state: "rejected",
    reason: "只換行政區的 doorway，現有政策禁止。"
  },
  {
    slug: "high-boot-vs-low-boot",
    proposed_title: "高靴低靴怎麼洗",
    status: "rejected",
    publish_state: "rejected",
    reason: "只是價目表品名切分，沒有獨立問題意圖。"
  },
  {
    slug: "brand-model-sneaker-pages",
    proposed_title: "依品牌型號洗鞋",
    status: "rejected",
    publish_state: "rejected",
    reason: "依品牌或型號大量複製，屬於 scaled content。"
  }
];

interface PageIntentMeta {
  cluster: string;
  canonical: string;
  sources: string[];
}

const PAGE_INTENT_META: Record<string, PageIntentMeta> = {
  "suede-shoe-cleaning": {
    cluster: "suede-nap-direction",
    canonical: "suede-shoe-cleaning",
    sources: ["svc:shoe-bag-care", "guide:qinghai-road-shoe-cleaning", "guide:rainy-shoe-care", "bp:business-profile"]
  },
  "canvas-shoe-mud": {
    cluster: "canvas-wet-mud-wait",
    canonical: "canvas-shoe-mud",
    sources: ["guide:rainy-shoe-care", "guide:qinghai-road-shoe-cleaning", "svc:shoe-bag-care", "bp:business-profile"]
  },
  "leather-shoe-water-marks": {
    cluster: "leather-rain-oil-lock",
    canonical: "leather-shoe-water-marks",
    sources: ["guide:rainy-shoe-care", "guide:qinghai-road-shoe-cleaning", "svc:shoe-bag-care", "bp:business-profile"]
  },
  "shoe-odor-source": {
    cluster: "shoe-odor-source",
    canonical: "shoe-odor-source",
    sources: ["svc:shoe-bag-care", "guide:rainy-shoe-care", "bp:business-profile"]
  },
  "washing-machine-shoe-risk": {
    cluster: "shoe-machine-wash-risk",
    canonical: "washing-machine-shoe-risk",
    sources: ["guide:birkenstock-care", "guide:plush-doll-cleaning", "svc:shoe-bag-care", "guide:photo-before-laundry"]
  },
  "athletic-shoe-mixed-materials": {
    cluster: "athletic-mixed-materials",
    canonical: "athletic-shoe-mixed-materials",
    sources: ["svc:shoe-bag-care", "guide:white-shoe-yellowing", "bp:business-profile"]
  },
  "shoe-mold-surface-check": {
    cluster: "shoe-mold-surface",
    canonical: "shoe-mold-surface-check",
    sources: ["guide:luxury-bag-mold", "svc:taichung-laundry-price-list", "svc:shoe-bag-care"]
  },
  "shoe-sole-separation-limit": {
    cluster: "sole-separation-not-cleaning",
    canonical: "shoe-sole-separation-limit",
    sources: ["svc:shoe-bag-care", "guide:birkenstock-care", "bp:business-profile"]
  },
  "bag-color-transfer": {
    cluster: "bag-color-transfer",
    canonical: "bag-color-transfer",
    sources: ["svc:shoe-bag-care", "guide:bag-handle-cleaning", "bp:business-profile"]
  },
  "bag-ink-marks": {
    cluster: "bag-ink-marks",
    canonical: "bag-ink-marks",
    sources: ["guide:bag-handle-cleaning", "svc:shoe-bag-care", "bp:business-profile"]
  },
  "bag-lining-care": {
    cluster: "bag-lining-odor",
    canonical: "bag-lining-care",
    sources: ["guide:bag-handle-cleaning", "svc:shoe-bag-care", "bp:business-profile"]
  },
  "nylon-bag-care": {
    cluster: "nylon-bag-film",
    canonical: "nylon-bag-care",
    sources: ["svc:shoe-bag-care", "guide:bag-handle-cleaning", "bp:business-profile"]
  },
  "canvas-bag-care": {
    cluster: "canvas-bag-mud-corner",
    canonical: "canvas-bag-care",
    sources: ["svc:shoe-bag-care", "guide:bag-handle-cleaning", "guide:rainy-shoe-care", "bp:business-profile"]
  },
  "backpack-cleaning-check": {
    cluster: "backpack-structure",
    canonical: "backpack-cleaning-check",
    sources: ["guide:school-uniform-care", "svc:taichung-laundry-price-list", "svc:shoe-bag-care", "bp:business-profile"]
  },
  "bag-clean-vs-repair": {
    cluster: "clean-vs-repair-boundary",
    canonical: "bag-clean-vs-repair",
    sources: ["svc:shoe-bag-care", "guide:luxury-bag-mold", "bp:business-profile"]
  },
  "wool-coat-dry-clean": {
    cluster: "wool-coat-structure",
    canonical: "wool-coat-dry-clean",
    sources: ["guide:dry-cleaning-guide", "svc:taichung-xitun-laundry", "bp:business-profile"]
  },
  "wool-knit-shrink-risk": {
    cluster: "wool-knit-shrink",
    canonical: "wool-knit-shrink-risk",
    sources: ["guide:dry-cleaning-guide", "svc:taichung-xitun-laundry", "bp:business-profile"]
  },
  "clothing-mold-airing": {
    cluster: "clothing-mold-airing",
    canonical: "clothing-mold-airing",
    sources: ["guide:luxury-bag-mold", "svc:fabric-storage", "guide:bedding-storage-check"]
  },
  "vacuum-bag-storage-risk": {
    cluster: "vacuum-bag-undried",
    canonical: "vacuum-bag-storage-risk",
    sources: ["svc:fabric-storage", "guide:bedding-storage-check", "bp:business-profile"]
  },
  "oil-vs-water-stain-choice": {
    cluster: "oil-vs-sweat-stain",
    canonical: "oil-vs-water-stain-choice",
    sources: ["guide:dry-cleaning-guide", "guide:shirt-suit-dry-cleaning", "svc:taichung-xitun-laundry"]
  },
  "blanket-damp-check": {
    cluster: "blanket-damp-check",
    canonical: "blanket-damp-check",
    sources: ["guide:bedding-storage-check", "svc:fabric-storage", "bp:business-profile"]
  },
  "post-wash-drying-before-storage": {
    cluster: "post-wash-drying",
    canonical: "post-wash-drying-before-storage",
    sources: ["guide:bedding-duvet-cleaning", "guide:down-jacket-cleaning", "svc:fabric-storage"]
  },
  "synthetic-vs-leather-handle": {
    cluster: "handle-material-fork",
    canonical: "synthetic-vs-leather-handle",
    sources: ["guide:leather-jacket-care", "guide:bag-handle-cleaning", "svc:shoe-bag-care"]
  },
  "rainy-bag-care": {
    cluster: "rainy-bag-dust-bag",
    canonical: "rainy-bag-care",
    sources: ["svc:shoe-bag-care", "guide:rainy-shoe-care", "guide:bag-handle-cleaning", "bp:business-profile"]
  }
};

for (const meta of Object.values(PAGE_INTENT_META)) {
  Object.freeze(meta.sources);
  Object.freeze(meta);
}
Object.freeze(PAGE_INTENT_META);

function attachProvenance(page: IndexGrowthPageDefinition): IndexGrowthPageDefinition {
  const meta = PAGE_INTENT_META[page.slug];
  if (!meta) {
    throw new Error(`missing PAGE_INTENT_META for ${page.slug}`);
  }
  const lastmod = page.content_lastmod;
  if (!lastmod) {
    throw new Error(`missing content_lastmod for ${page.slug}`);
  }
  return {
    ...page,
    publish_state: "accepted",
    intent_cluster: meta.cluster,
    canonical_intent_slug: meta.canonical,
    content_lastmod: lastmod,
    content_revision: `${lastmod}#1`,
    citation_source_refs: cloneClaimRefs(meta.sources),
    steps: page.steps.map((step) => ({ ...step, source_refs: cloneClaimRefs(meta.sources) })),
    sections: (page.sections ?? []).map((section) => ({ ...section, source_refs: cloneClaimRefs(meta.sources) })),
    faqs: page.faqs.map((faq) => ({ ...faq, source_refs: cloneClaimRefs(meta.sources) }))
  };
}

const RAW_ACCEPTED_INDEX_GROWTH_PAGE_BODIES: IndexGrowthPageDefinition[] = [
  {
    slug: "suede-shoe-cleaning",
    path: "guides/suede-shoe-cleaning.html",
    category: "guide",
    title: "麂皮鞋變硬、發亮怎麼判斷？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明麂皮鞋摸起來變硬或發亮時，多半是絨毛倒伏而不是普通髒污，先分乾刷與濕擦風險再決定是否送整理。",
    h1: "麂皮鞋變硬、發亮，還能自己擦嗎？",
    summary: "麂皮變硬多半是絨毛倒伏，不要濕擦；先乾刷看方向。",
    citation_answer: "麂皮變硬多半是絨毛倒伏，不要濕擦；先乾刷看方向。",
    keywords: ["麂皮鞋清潔", "麂皮鞋變硬", "麂皮鞋發亮", "台中洗麂皮"],
    service_slug: "shoe-bag-care",
    local_intent: "台中西屯 麂皮鞋 變硬 發亮 乾刷",
    content_lastmod: "2026-08-30",
    hub_group: "shoes",
    related_slugs: ["canvas-shoe-mud", "rainy-shoe-care"],
    steps: [
      { name: "先認絨面", text: "看鞋面是直立短絨還是光滑塗層。絨面被壓平會發亮，那不是泥灰。" },
      { name: "分乾污與水痕", text: "表面浮灰可以輕拍；水痕、染色或油點要另看，不能當成同一種髒。" },
      { name: "停手濕擦", text: "濕布會把絨毛壓得更平，整片泡水更容易變硬。先不要噴未知清潔劑。" },
      { name: "拍照問方向", text: "拍鞋面自然光、發亮位置與鞋內，說明有沒有淋雨或自己擦過。" }
    ],
    sections: [
      {
        heading: "絨毛倒伏和髒污怎麼分",
        body:
          "麂皮常見的「變舊」不是顏色變深這麼簡單。絨毛被踩平或被水壓過，光線一照會發亮，摸起來變硬；那是纖維方向被改變，不是一層可以整片刷掉的灰。門市會先看倒伏範圍、有沒有水圈、染色或油點。勃肯那類軟木鞋床是另一個系統，本頁只處理一般麂皮鞋面。雨後進水的通風步驟見雨天鞋子指南，不要把兩題混成一次硬刷。"
      },
      {
        heading: "自行處理的停手條件",
        body:
          "停手條件：整雙已泡過水、絨面大面積發亮變硬、出現深色水圈或染料移動，或已經用濕布、橡皮擦、未知噴劑試過。清潔限度：表面浮灰與輕微倒伏有機會整理；染色、油點、泡水後的硬塊只能評估淡化，不保證回到原絨向，也不保證變全新。不知道材質就先保留原狀。"
      },
      {
        heading: "送洗前對應鞋包清潔",
        body:
          "拍鞋面、發亮近照、鞋側與整體，用 LINE 傳給門市並說明是否淋雨或自行擦過。對應服務是鞋包清潔頁；台中市可約免費收送，清潔費另依物件判斷。本頁不報固定價。帆布濕泥的等乾判斷見帆布鞋指南，不要用同一套水洗想像處理麂皮。"
      }
    ],
    faqs: [
      {
        question: "麂皮鞋可以拿濕布擦亮嗎？",
        answer: "不建議。濕擦常把絨毛壓平，看起來更亮更硬。先停手，拍自然光近照再問。"
      },
      {
        question: "麂皮被雨淋過還能恢復嗎？",
        answer: "要看倒伏與水圈範圍。輕微浮灰較有機會；泡水變硬或染色只能淡化，不保證原絨向。"
      },
      {
        question: "這頁和勃肯鞋清潔是同一件事嗎？",
        answer: "不是。勃肯要另外看軟木鞋床；本頁只處理一般麂皮鞋面的倒伏與水痕風險。"
      }
    ]
  },
  {
    slug: "canvas-shoe-mud",
    path: "guides/canvas-shoe-mud.html",
    category: "guide",
    title: "帆布鞋沾泥，該等乾還是立刻刷？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明帆布鞋沾泥時，濕刷容易把泥推進織紋並起毛，應先等乾再判斷能不能整理。",
    h1: "帆布鞋沾泥，現在刷還是等乾？",
    summary: "帆布沾泥先等乾再處理；濕刷會把泥推進織紋。",
    citation_answer: "帆布沾泥先等乾再處理；濕刷會把泥推進織紋。",
    keywords: ["帆布鞋沾泥", "帆布鞋清潔", "帆布鞋起毛", "台中洗帆布鞋"],
    service_slug: "shoe-bag-care",
    local_intent: "台中西屯 帆布鞋 沾泥 等乾 起毛",
    content_lastmod: "2026-08-30",
    hub_group: "shoes",
    related_slugs: ["suede-shoe-cleaning", "rainy-shoe-care"],
    steps: [
      { name: "先別動濕泥", text: "泥還是濕的，越刷越往織紋裡走。先讓鞋子通風，不要塞進鞋櫃。" },
      { name: "等乾看塊狀", text: "乾了以後泥常成塊，輕拍或輕刮表面比濕刷安全。" },
      { name: "看纖維有沒有起毛", text: "已經刷過、織紋發白起毛，再刷只會讓色差更明顯。" },
      { name: "拍織紋近照", text: "拍鞋頭、側邊織紋與鞋內，說明是剛沾到還是已經自己刷過。" }
    ],
    sections: [
      {
        heading: "為什麼濕的時候不能刷",
        body:
          "帆布是織紋，不是平滑塗層。濕泥被刷子推過，會進到線與線之間，乾了變成灰帶，看起來像洗不掉的舊痕。門市先看泥是浮在表面、已經進織紋，還是連纖維都被刷起毛。雨天鞋子指南講的是進水後通風與取出鞋墊；本頁只回答「帆布上的泥要不要現在動手」。兩件事可以同時發生，但判斷順序不同。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：泥還濕就想用刷子或洗衣槽沖、已經起毛、或用漂白水想一次刷白。清潔限度：乾掉的表面泥塊較有機會；推進織紋的灰帶、起毛後的色差、膠邊氧化，只能評估改善範圍，不能當成保證回新。漂白或硬刷會讓後續更難判斷。"
      },
      {
        heading: "送洗前對應鞋包清潔",
        body:
          "等表面不滴水後，拍整體、織紋近照、鞋底邊與鞋內。對應鞋包清潔頁，白鞋灰與黃另看白鞋泛黃指南。台中市可約免費收送；本頁不列金額，費用依實際檢視。不要為了趕收納把濕帆布塞進塑膠袋。"
      }
    ],
    faqs: [
      {
        question: "帆布鞋踩到泥，回家第一件事是什麼？",
        answer: "先通風等乾，不要立刻刷。濕刷會把泥推進織紋，之後看起來更像洗不掉。"
      },
      {
        question: "等乾了自己用硬刷可以嗎？",
        answer: "不建議硬刷。織紋一起毛，色差會留下。先拍近照問，不要先破壞表面。"
      },
      {
        question: "帆布發黃和沾泥是同一題嗎？",
        answer: "不是。泥是顆粒進織紋；泛黃可能是氧化或洗劑殘留。先分位置再決定頁面。"
      }
    ]
  },
  {
    slug: "leather-shoe-water-marks",
    path: "guides/leather-shoe-water-marks.html",
    category: "guide",
    title: "皮鞋淋雨後的水痕，能不能先上油？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明皮鞋淋雨後水痕常過幾天才浮出，這時上油可能把水痕鎖進皮面，應先通風再判斷。",
    h1: "皮鞋雨痕浮出來前，不要急著上油",
    summary: "皮鞋雨痕先不要上油；水痕浮出後上油會鎖進皮裡。",
    citation_answer: "皮鞋雨痕先不要上油；水痕浮出後上油會鎖進皮裡。",
    keywords: ["皮鞋水痕", "皮鞋淋雨", "皮鞋上油", "台中洗皮鞋"],
    service_slug: "shoe-bag-care",
    local_intent: "台中西屯 皮鞋 水痕 上油 淋雨",
    content_lastmod: "2026-08-30",
    hub_group: "shoes",
    related_slugs: ["rainy-shoe-care", "suede-shoe-cleaning"],
    steps: [
      { name: "先吸水不要揉", text: "用乾布輕壓吸走表面水，不要來回擦，避免把水推向更深的皮層。" },
      { name: "取出鞋墊通風", text: "能拆的鞋墊先取出，鞋內用報紙或乾燥物吸濕，遠離高溫。" },
      { name: "觀察延遲水痕", text: "當天看起來乾了也不代表結束，水痕常隔幾天圈出來。" },
      { name: "上油前先問", text: "水痕還在移動時上油，等於把圈印鎖住，之後常要另談補色。" }
    ],
    sections: [
      {
        heading: "水痕為什麼會晚點出現",
        body:
          "皮面吸進雨水後，表面先乾、裡面還在移動。隔天或數天後才出現一圈深淺不同的印，是水分帶走或推積油脂的結果。門市會看水圈邊界、皮面是否已乾裂、有沒有自行上油或吹熱風。雨天鞋子指南處理的是通風與不要悶鞋櫃；本頁單獨回答「要不要立刻擦油」。麂皮不能用同一套上油想像。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：高溫吹風機、太陽直曬、立刻厚塗鞋油、或用未知清潔乳亂擦。清潔限度：還沒鎖油的雨痕較有判斷空間；已經上油鎖住的水圈、破皮、掉色，清潔只能處理表面髒，水痕本身可能只淡化。不保證皮面回到淋雨前。"
      },
      {
        heading: "送洗前對應鞋包清潔",
        body:
          "拍鞋面水圈、側邊、鞋內與整體，說明淋雨時間和有沒有上油。對應鞋包清潔頁；台中市可約免費收送。本頁不報皮鞋固定價。若同時有膠邊氧化，那是另一個問題，不要以為擦油能一併解決。"
      }
    ],
    faqs: [
      {
        question: "皮鞋淋雨當天擦乾上油，比較不容易壞嗎？",
        answer: "不一定。水痕常晚點才浮出，這時上油可能把圈印鎖進皮面。先通風，不要急著上油。"
      },
      {
        question: "可以用吹風機把皮鞋吹乾嗎？",
        answer: "不建議高溫直吹。膠與皮革都可能變形。先吸水、取出鞋墊、陰乾。"
      },
      {
        question: "水痕洗得掉嗎？",
        answer: "要看有沒有被油鎖住。未上油的雨痕較能評估；已鎖住的只能淡化，不保證消失。"
      }
    ]
  },
  {
    slug: "shoe-odor-source",
    path: "guides/shoe-odor-source.html",
    category: "guide",
    title: "鞋臭是濕氣、汗還是悶放？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明鞋內味道要先分雨水潮氣、穿著汗垢與收納悶放，不能只用香味覆蓋。",
    h1: "鞋臭先分來源，不要先噴香水",
    summary: "鞋臭先分潮氣、汗垢與悶放；不要用香味蓋住。",
    citation_answer: "鞋臭先分潮氣、汗垢與悶放；不要用香味蓋住。",
    keywords: ["鞋子臭", "鞋內悶味", "鞋子除臭", "台中洗鞋除臭"],
    service_slug: "shoe-bag-care",
    local_intent: "台中西屯 鞋臭 悶味 汗 收納",
    content_lastmod: "2026-08-30",
    hub_group: "shoes",
    related_slugs: ["washing-machine-shoe-risk", "rainy-shoe-care"],
    steps: [
      { name: "先問什麼時候開始臭", text: "淋雨後、連續穿幾天，還是從櫃子拿出來才臭，三種來源不同。" },
      { name: "拆得開的先拆", text: "鞋墊能拆就取出聞，味道在墊上、內裡還是鞋底夾層，處理範圍不一樣。" },
      { name: "看潮不潮", text: "摸起來還濕，先通風；已經乾但仍臭，比較像汗垢或悶放吸附。" },
      { name: "不要先噴香", text: "香味只蓋表面。未乾就密封，味道會更重。" }
    ],
    sections: [
      {
        heading: "三種味道不要當成同一題",
        body:
          "雨水味偏潮、帶布料濕氣；汗味集中在鞋墊與前掌；櫃子悶味常整雙都有、還可能混到防塵袋的塑膠味。門市會問時間線，再看鞋墊可否拆、內裡磨耗、有沒有發霉斑點。白鞋清潔頁看的是灰與黃；本頁只回答味道來源。發霉另走鞋子發霉判斷，不要用除臭噴霧當除霉。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：未乾就進洗衣機、噴大量香水或酒精、用塑膠袋把鞋密封隔夜。清潔限度：表層潮氣與可拆鞋墊的汗味較有處理空間；長期吸附進內裡泡棉、發霉根或材質本身老化味，只能降低、不保證無味，也不保證變全新。"
      },
      {
        heading: "送洗前對應鞋包清潔",
        body:
          "拍鞋內、鞋墊正反面與整體，並用一句話說明味道何時出現。對應鞋包清潔頁。台中市可約免費收送。本頁不承諾除臭天數或保證無味。若你打算整雙丟洗衣機，先看機洗風險頁。"
      }
    ],
    faqs: [
      {
        question: "鞋子臭噴除臭劑就好了嗎？",
        answer: "不夠。香味蓋不住潮氣或汗垢來源。先分是濕、是汗還是悶放，再決定通風或送整理。"
      },
      {
        question: "只有鞋墊臭，可以只換墊嗎？",
        answer: "可以先拆開判斷，但內裡泡棉也可能吸附。只換墊卻把濕鞋塞回櫃子，味道常回來。"
      },
      {
        question: "放冷凍庫可以除臭嗎？",
        answer: "本頁不建議自行用極端溫度處理。皮革、膠與泡棉反應不同，先拍照說明來源較安全。"
      }
    ]
  },
  {
    slug: "washing-machine-shoe-risk",
    path: "guides/washing-machine-shoe-risk.html",
    category: "guide",
    title: "鞋子可以丟洗衣機嗎？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明整雙鞋進家用洗衣機的風險：脫水傷結構、泡水傷膠邊與內裡，應先看材質再決定。",
    h1: "鞋子能不能丟洗衣機？先看這三個風險",
    summary: "鞋子不建議丟洗衣機；泡水與脫水會傷膠邊與內裡。",
    citation_answer: "鞋子不建議丟洗衣機；泡水與脫水會傷膠邊與內裡。",
    keywords: ["鞋子洗衣機", "鞋子可以水洗嗎", "運動鞋機洗", "台中洗鞋"],
    service_slug: "shoe-bag-care",
    local_intent: "台中西屯 鞋子 洗衣機 風險 膠邊",
    content_lastmod: "2026-08-30",
    hub_group: "shoes",
    related_slugs: ["athletic-shoe-mixed-materials", "photo-before-laundry"],
    steps: [
      { name: "先分材質", text: "網布、皮革、麂皮、帆布對水的反應不同，不能用衣服那套程序套到整雙鞋。" },
      { name: "想一想脫水", text: "家用脫水會扭結構、讓膠線鬆、讓泡棉移位。這比「有沒有洗乾淨」更先發生。" },
      { name: "看膠邊與貼合", text: "已經開裂的膠邊，進水後更容易張開。貼合鞋面也怕高溫。" },
      { name: "先拍照再決定", text: "不確定就不要丟進去。拍鞋面、鞋底接合與鞋內，問適不適合整理。" }
    ],
    sections: [
      {
        heading: "機洗傷的不是髒，是結構",
        body:
          "客人常問能不能像衣服一樣丟進去。鞋子有膠線、泡棉、鞋墊層和不同鞋面，洗衣機的摩擦與脫水是為衣物設計的。勃肯軟木、麂皮、皮鞋都不該整雙浸泡；運動鞋就算網布耐一點，膠邊與內裡仍可能變形。娃娃頁也提醒脫水會結塊——同一類風險，只是物件不同。本頁不提供「哪一個洗衣程序一定安全」的配方。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：已經開膠、皮革或麂皮、有電子感應、或鞋內還很濕就想連洗帶烘。清潔限度：表面泥灰與可拆鞋墊可以評估局部整理；機洗造成的開膠、皺縮、染色擴散，不是清潔能回復的結構，只能先停手說明界線。"
      },
      {
        heading: "送洗前對應鞋包清潔",
        body:
          "若還沒丟進洗衣機，保持原狀拍照。若已經機洗過，拍變形、開膠與掉色位置，讓門市先說能維持什麼。對應鞋包清潔頁；混合材質運動鞋另看材質分部位頁。台中市可約免費收送。本頁不列價、不保證機洗後能修復。"
      }
    ],
    faqs: [
      {
        question: "運動鞋輕柔洗加洗衣袋可以嗎？",
        answer: "仍有風險。脫水與浸泡會作用在膠邊和內裡，不因洗衣袋就變成無風險。先問材質。"
      },
      {
        question: "洗完用烘衣機烘鞋可以嗎？",
        answer: "不建議。高溫讓膠與合成材質變形。先通風陰乾，不要用高溫追乾。"
      },
      {
        question: "已經丟進去洗壞了還能問嗎？",
        answer: "可以。拍開膠、變形與掉色位置，門市會先說清潔限度，不會把結構損壞當成一般髒污。"
      }
    ]
  },
  {
    slug: "athletic-shoe-mixed-materials",
    path: "guides/athletic-shoe-mixed-materials.html",
    category: "guide",
    title: "運動鞋網布、膠邊、內裡為什麼不能同一種刷法？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明運動鞋常是網布、合成皮、膠邊與內裡拼起來的，清潔前要分部位，不能整雙當同一種材質。",
    h1: "運動鞋要分部位看，不能整雙當同一種布",
    summary: "運動鞋要分網布、膠邊與內裡；不能同一種刷法。",
    citation_answer: "運動鞋要分網布、膠邊與內裡；不能同一種刷法。",
    keywords: ["運動鞋清潔", "網布鞋清洗", "膠邊泛黃", "台中洗運動鞋"],
    service_slug: "shoe-bag-care",
    local_intent: "台中西屯 運動鞋 網布 膠邊 內裡",
    content_lastmod: "2026-08-30",
    hub_group: "shoes",
    related_slugs: ["white-shoe-yellowing", "washing-machine-shoe-risk"],
    steps: [
      { name: "標出四個部位", text: "鞋面網布或合成皮、膠邊、縫線、鞋內，分開看髒的是灰、是氧化還是汗。" },
      { name: "膠邊先分灰和黃", text: "灰多半是附著；黃在膠裡常是氧化。氧化不能當髒污猛刷。" },
      { name: "網布避免起毛", text: "硬刷網布會讓纖維翹起，色差比髒更明顯。" },
      { name: "內裡另案", text: "味道與潮氣在內裡，不在鞋面。只刷外面等於沒處理穿著層。" }
    ],
    sections: [
      {
        heading: "一雙鞋通常不是一種材質",
        body:
          "通勤運動鞋常把透氣網、熱貼合皮面、橡膠膠邊和泡棉內裡拼在同一雙。看起來都髒，原因卻不同：網布是顆粒與起毛，膠邊是灰或氧化，內裡是汗與潮。白鞋泛黃頁專門分辨灰與黃；本頁把範圍擴大到「整雙運動鞋要怎麼分部位」，包括不是全白的配色。價目表上的一般運動鞋或皮類運動鞋，也是先對品名、再看實際材質，不是品名決定刷法。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：用同一把硬刷從網布刷到膠邊、漂白整雙、或把開膠處當灰塵摳。清潔限度：部位上的浮灰較有機會；膠氧化、網布起毛、貼合翹起與開膠，清潔不能當維修。不保證配色回到購買當日。"
      },
      {
        heading: "送洗前對應鞋包清潔",
        body:
          "拍鞋面、膠邊、鞋內與整體四張，並指出最在意的是網布、膠還是味道。對應鞋包清潔頁；全白再對白鞋清潔。台中市可約免費收送。本頁不寫固定價，避免把品名價當成這雙鞋的報價。"
      }
    ],
    faqs: [
      {
        question: "運動鞋鞋面和膠邊可以一起用力刷白嗎？",
        answer: "不行。網布怕起毛，膠邊黃可能是氧化。同一種力道常讓兩處都更差。"
      },
      {
        question: "皮類運動鞋和一般運動鞋差在哪？",
        answer: "差在鞋面耐水與耐刷程度。名稱只是起點，仍要看實際部位，不能只看品名。"
      },
      {
        question: "只想洗鞋面、內裡不管可以嗎？",
        answer: "可以先說你的優先順序，但潮氣在內裡時，只處理外面味道常還在。門市會分開講。"
      }
    ]
  },
  {
    slug: "shoe-mold-surface-check",
    path: "guides/shoe-mold-surface-check.html",
    category: "guide",
    title: "鞋子發霉先別刷：怎麼看出表面還是滲入？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明鞋子發霉時不要立刻刷或噴酒精，先判斷是表面白粉還是已經留下色斑。",
    h1: "鞋子發霉：先通風，不要先刷",
    summary: "鞋子發霉先通風、不要刷；先看是表面還是已滲入。",
    citation_answer: "鞋子發霉先通風、不要刷；先看是表面還是已滲入。",
    keywords: ["鞋子發霉", "鞋內發霉", "鞋子長霉", "台中洗鞋發霉"],
    service_slug: "shoe-bag-care",
    local_intent: "台中西屯 鞋子發霉 表面霉 滲入",
    content_lastmod: "2026-08-30",
    hub_group: "shoes",
    related_slugs: ["luxury-bag-mold", "clothing-mold-airing"],
    steps: [
      { name: "先移出密閉空間", text: "從鞋櫃或塑膠袋拿出來通風，不要繼續悶。不要用濕布用力擦。" },
      { name: "看霉的形態", text: "像粉、浮在表面，和已經留下色斑或黑點，處理限度不同。" },
      { name: "檢查鞋內與鞋墊", text: "外觀乾淨不代表鞋內沒有。鞋墊背面常被忽略。" },
      { name: "不要自行用酒精", text: "皮革與染色材質碰到酒精可能脫脂、色差。先拍照。" }
    ],
    sections: [
      {
        heading: "鞋霉和包霉是同一類風險，但部位不同",
        body:
          "精品包發霉頁已經說明：濕擦會把霉往孔隙推。鞋子也一樣，只是多了鞋內、鞋墊和膠邊縫。門市會看外底邊緣、內裡、鞋舌背面。衣物發霉頁處理的是布料收納；本頁只回答鞋子。發霉在價目與服務說明裡屬於特殊污況，要另看，不能當成普通灰塵。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：濕刷、酒精、漂白、陽光暴晒想「烤乾霉」。清潔限度：浮在表面的白霉較能評估；留下色斑、滲進內裡或皮革毛孔的，以抑制擴散與淡化為目標，不保證無斑、不保證無味。結構發霉嚴重時，會先說可能不適合硬處理。"
      },
      {
        heading: "送洗前對應鞋包清潔",
        body:
          "拍外觀、發霉近照、鞋內與鞋墊背面，說明放在哪裡多久。對應鞋包清潔頁。台中市可約免費收送。本頁不報發霉加價數字；特殊污況要看過物件。處理完也不要用塑膠袋立刻密封。"
      }
    ],
    faqs: [
      {
        question: "鞋子長白毛，用酒精擦掉就好了嗎？",
        answer: "不建議。酒精可能讓皮面脫脂或色差，也可能把霉推開。先通風拍照。"
      },
      {
        question: "發霉的鞋洗完會不會再長？",
        answer: "若收納環境仍潮濕，可能再發。清潔不是永久免疫，乾燥與透氣收納才是後段。"
      },
      {
        question: "鞋面沒霉、鞋內有斑點怎麼辦？",
        answer: "以鞋內為準。外觀乾淨仍要拍鞋墊背面。不要只清外面。"
      }
    ]
  },
  {
    slug: "shoe-sole-separation-limit",
    path: "guides/shoe-sole-separation-limit.html",
    category: "guide",
    title: "鞋底開膠是清潔問題嗎？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明鞋底開膠、大底分離不是表面髒污，清潔不能把黏著層重新接回去，應先停手拍照問界線。",
    h1: "鞋底開膠：先停手，這不是刷得掉的髒",
    summary: "鞋底開膠不是清潔能處理的；先停手拍照問界線。",
    citation_answer: "鞋底開膠不是清潔能處理的；先停手拍照問界線。",
    keywords: ["鞋底開膠", "鞋子脫膠", "鞋底分離", "台中洗鞋"],
    service_slug: "shoe-bag-care",
    local_intent: "台中西屯 鞋底開膠 脫膠 清潔限度",
    content_lastmod: "2026-08-30",
    hub_group: "shoes",
    related_slugs: ["athletic-shoe-mixed-materials", "washing-machine-shoe-risk"],
    steps: [
      { name: "分髒污和結構", text: "膠邊灰是髒；大底張開、鞋頭翹起是黏著失效。兩件事不要一起猛刷。" },
      { name: "不要自行灌膠", text: "市售強黏劑可能汙染鞋面，也讓後續更難評估。先拍現況。" },
      { name: "回想進水或機洗", text: "浸泡、烘乾、高溫都可能讓膠線提早張開。時間線要一起說。" },
      { name: "問的是限度不是保證修", text: "本店公開服務是清潔與洗護判斷，不是承諾結構維修。" }
    ],
    sections: [
      {
        heading: "開膠不是氧化膠邊，也不是泥",
        body:
          "膠邊氧化發黃，和鞋底從接合縫張開，看起來都在「膠」附近，決策完全不同。前者是材料變色，後者是結構分離。運動鞋混合材質頁說明部位要分開看；本頁把開膠單獨拉出來，避免客人以為洗乾淨就會黏回去。既有服務說明已寫清潔不等同修復，開膠是這句話最具體的例子。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：硬把張開處掰更大、自行灌不明膠水、或整雙再丟洗衣機。清潔限度：張開處附近的泥灰可以評估表面整理；黏著層本身不是洗護能重建的。門市會先講清「能清髒、不能保證重新黏合」，沒有看過物件不承諾維修項目。"
      },
      {
        heading: "送洗前對應鞋包清潔",
        body:
          "拍張開縫的近照、鞋底、鞋面與整體，說明是否進水或機洗過。對應鞋包清潔頁，目的是先取得誠實界線，不是先假設能修好。台中市可約免費收送。若只是膠邊灰，走運動鞋分部位或白鞋泛黃，不要用開膠頁硬套。"
      }
    ],
    faqs: [
      {
        question: "開一點縫，洗完會不會自己黏回去？",
        answer: "不會把清潔當成重新黏合。張開是結構問題，洗掉泥不會讓膠線恢復。"
      },
      {
        question: "你們有修鞋底嗎？",
        answer: "公開服務以清潔與洗護判斷為主。開膠是否另有整理方式，要看過物件後才說明，本頁不預先承諾。"
      },
      {
        question: "開膠的鞋還能拍照詢問嗎？",
        answer: "可以。正是要先問界線。把縫的近照傳 LINE，比先灌膠或再機洗安全。"
      }
    ]
  },
  {
    slug: "bag-color-transfer",
    path: "guides/bag-color-transfer.html",
    category: "guide",
    title: "包包染色、色移，怎麼分髒污和掉色？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明包身或衣服染料移到包包上時，要先分是浮色髒污還是材質掉色，兩者限度不同。",
    h1: "包包色移：先分染色和自己掉色",
    summary: "包包色移先分外來染料與自身掉色；掉色不能當補色洗。",
    citation_answer: "包包色移先分外來染料與自身掉色；掉色不能當補色洗。",
    keywords: ["包包掉色", "包包染色", "色移怎麼辦", "台中洗包"],
    service_slug: "shoe-bag-care",
    local_intent: "台中西屯 包包 色移 掉色 染色",
    content_lastmod: "2026-08-30",
    hub_group: "bags",
    related_slugs: ["bag-clean-vs-repair", "bag-handle-cleaning"],
    steps: [
      { name: "看顏色從哪來", text: "深衣沾淺包、新包染到衣服，或包自己磨出淺斑，三種完全不同。" },
      { name: "看邊界", text: "外來色常有明確印子；自身掉色多在摩擦處慢慢變淺。" },
      { name: "不要用去漬劑試", text: "溶劑可能把染料推開或讓塗層霧掉。先保留原狀。" },
      { name: "同時拍來源衣物", text: "若是衣服染到包，把那件衣也拍一張，有助判斷是浮色還是已吃進材質。" }
    ],
    sections: [
      {
        heading: "色移不是提把油垢，也不是發霉斑",
        body:
          "提把發暗常是手汗；發霉是白粉或色斑擴散；色移是染料搬家。門市會看印子形狀、摩擦位置與材質是皮革、尼龍還是塗層布。清潔頁能處理的是表面髒與部分浮色；自身塗層磨薄露出底色，屬於掉色磨耗。既有鞋包說明已寫清潔不等同補色，本頁把這句話落到色移場景。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：酒精、漂白、去漬筆在色塊上試擦。清潔限度：尚未吃進材質的浮色較能評估；已滲入、已掉色見底、或塗層霧化，只能淡化或維持，不保證回到原色。補色是另一道工序，不是洗完自動發生。"
      },
      {
        heading: "送洗前對應鞋包清潔",
        body:
          "拍整包、色塊近照、摩擦位置與可能的來源衣物。對應鞋包清潔頁；若問題其實是邊油磨穿，走提把包角頁。台中市可約免費收送。本頁不報補色價，避免把清潔和修復混成一個數字。"
      }
    ],
    faqs: [
      {
        question: "深色牛仔褲把淺色包染黑了，洗得掉嗎？",
        answer: "要看染料有沒有吃進材質。浮色較能評估；已滲入只能淡化，不保證回到原色。"
      },
      {
        question: "包自己越背越淺，是不是沒洗乾淨？",
        answer: "摩擦變淺多半是掉色或塗層磨耗，不是殘留髒。清潔不能當成補色。"
      },
      {
        question: "可以先用濕紙巾擦掉色塊嗎？",
        answer: "不建議。濕擦可能把染料推開或傷塗層。先拍照問，不要先試藥劑。"
      }
    ]
  },
  {
    slug: "bag-ink-marks",
    path: "guides/bag-ink-marks.html",
    category: "guide",
    title: "包內裡筆痕能清嗎？先不要用酒精｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明包內裡原子筆或油性筆痕要先看纖維與滲入範圍，自行用酒精擦可能讓印變大。",
    h1: "包內裡筆痕：先看滲了多深",
    summary: "包內筆痕先不要用酒精擦；先拍材質與滲入範圍。",
    citation_answer: "包內筆痕先不要用酒精擦；先拍材質與滲入範圍。",
    keywords: ["包包筆痕", "內裡原子筆", "包內沾到筆", "台中洗包"],
    service_slug: "shoe-bag-care",
    local_intent: "台中西屯 包包 內裡 筆痕 酒精",
    content_lastmod: "2026-08-30",
    hub_group: "bags",
    related_slugs: ["bag-lining-care", "bag-handle-cleaning"],
    steps: [
      { name: "分筆的種類", text: "水性和油性、鉛筆與麥克筆，吃進纖維的方式不同。能說來源就說。" },
      { name: "看有沒有暈開", text: "已經暈成一片，比剛點到的小點更難。不要再加水或酒精。" },
      { name: "看內裡材質", text: "光滑塗層、織布、絨布內裡，可處理範圍差很多。" },
      { name: "外袋也要拍", text: "筆有時穿過內袋印到外層。只拍一格內袋會漏判。" }
    ],
    sections: [
      {
        heading: "筆痕是內裡問題，不是提把油",
        body:
          "提把頁提到內裡粉塵和筆痕要分開看；本頁把筆痕當成獨立決策。酒精常被當成萬用去墨，但對皮革與部分塗層是脫脂、對織布則可能把油墨推得更開。門市先看印的大小、是否穿過夾層、內裡能不能局部處理而不把整包浸濕。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：酒精、去光水、去漬筆、橡皮大力擦到起毛。清潔限度：剛沾上、未暈開的痕跡較能評估；已滲過夾層、絨布擴散或織紋起毛，只能降低對比，不保證無痕。不把內裡洗到「像沒寫過」當成功標準。"
      },
      {
        heading: "送洗前對應鞋包清潔",
        body:
          "拍內裡筆痕、周圍內袋、外層對應位置與整包。對應鞋包清潔頁。內裡若同時有味道，另看內裡粉塵與味道頁。台中市可約免費收送。本頁不列去墨價，也不把去墨當成一定無痕的服務承諾。"
      }
    ],
    faqs: [
      {
        question: "原子筆剛點到內袋，用酒精擦可以嗎？",
        answer: "不建議。酒精可能暈開油墨或傷材質。先拍照，保留原狀。"
      },
      {
        question: "筆痕一定能清到看不見嗎？",
        answer: "不一定。未滲入的較有機會；已暈開或穿過夾層的，以淡化為目標，不保證無痕。"
      },
      {
        question: "只有內袋髒、外面很新，要整包處理嗎？",
        answer: "不一定。先讓門市看內裡能不能局部處理，避免為了內袋把外層一起冒險。"
      }
    ]
  },
  {
    slug: "bag-lining-care",
    path: "guides/bag-lining-care.html",
    category: "guide",
    title: "包內裡粉塵與味道，外觀乾淨就不用管嗎？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明包包外觀乾淨時，內裡仍可能有粉塵、屑與悶味，收進防塵袋前要分開檢查。",
    h1: "包內裡：外觀乾淨不代表裡面能收",
    summary: "包內裡粉塵與味道要分開看；外觀乾淨不代表內袋乾淨。",
    citation_answer: "包內裡粉塵與味道要分開看；外觀乾淨不代表內袋乾淨。",
    keywords: ["包內裡清潔", "包包悶味", "內袋灰塵", "台中洗包"],
    service_slug: "shoe-bag-care",
    local_intent: "台中西屯 包包 內裡 粉塵 悶味",
    content_lastmod: "2026-08-30",
    hub_group: "bags",
    related_slugs: ["bag-ink-marks", "rainy-bag-care"],
    steps: [
      { name: "打開所有夾層", text: "主袋、拉鍊內袋與底襯都要看，不要只拍外觀正面。" },
      { name: "分屑、粉、味", text: "紙屑灰塵是一層；味道可能在布裡。有味不要立刻密封。" },
      { name: "看受潮痕跡", text: "內底深色水印代表進過水。先通風，不要用熱風。" },
      { name: "防塵袋不是答案", text: "未乾或有味就套防塵袋，等於把味道關進去。" }
    ],
    sections: [
      {
        heading: "內裡是收納問題，不只是美觀",
        body:
          "客人常覺得包外面還新，就直接進櫃子。內裡卻堆了粉、收據屑、下雨滲進去的潮。提把頁把內裡當檢查項之一；本頁把「外觀與內裡不同步」當成主題。尼龍與帆布內襯的吸味程度不同，不能只問「洗不洗外面」。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：把整包泡水想沖內袋、用香水噴內裡、未乾就進防塵袋。清潔限度：浮粉與可清的內袋表面較能評估；吃進內襯的悶味、發霉根或水印，只能降低，不保證無味。內裡破損或脫線要先說，清洗可能擴大。"
      },
      {
        heading: "送洗前對應鞋包清潔",
        body:
          "拍打開的主袋、內底、夾層與整包外觀。對應鞋包清潔頁。若主因是雨後包角，走雨後包包頁。台中市可約免費收送。本頁不報內裡單獨價，因為內袋結構差很多，要看過才能說範圍。"
      }
    ],
    faqs: [
      {
        question: "外面很新，只吸一下內袋就好了嗎？",
        answer: "可以先吸浮塵，但有潮味或水印就不要密封。味道在布裡時，表面吸塵不夠。"
      },
      {
        question: "內裡可以單獨拆出來洗嗎？",
        answer: "多數日常包不能當衣服那樣拆內襯。能不能局部處理要看結構，先拍照。"
      },
      {
        question: "有味道的包可以先放防塵袋嗎？",
        answer: "不要。未處理的潮味會被悶住。先通風，確認乾燥再收。"
      }
    ]
  },
  {
    slug: "nylon-bag-care",
    path: "guides/nylon-bag-care.html",
    category: "guide",
    title: "尼龍包的油垢與水痕怎麼判斷？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明尼龍或合成纖維包身常見油膜與雨痕，不能用皮革那套去油或上油方式處理。",
    h1: "尼龍包：油膜和水痕不是同一種髒",
    summary: "尼龍包先看油垢與水痕；不要用皮革去油方式硬處理。",
    citation_answer: "尼龍包先看油垢與水痕；不要用皮革去油方式硬處理。",
    keywords: ["尼龍包清潔", "尼龍包油垢", "尼龍包水痕", "台中洗包"],
    service_slug: "shoe-bag-care",
    local_intent: "台中西屯 尼龍包 油垢 水痕",
    content_lastmod: "2026-08-30",
    hub_group: "bags",
    related_slugs: ["canvas-bag-care", "rainy-bag-care"],
    steps: [
      { name: "確認是尼龍不是皮", text: "觸感偏滑、線感明顯，通常不是要上油的真皮。認錯材質最傷。" },
      { name: "分油膜和土痕", text: "手油在提把與翻蓋邊緣發亮；泥土在底部。兩者清潔路徑不同。" },
      { name: "看塗層有沒有霧", text: "強力去油劑可能讓表面變霧、發白。出現霧面就停手。" },
      { name: "五金另看", text: "金屬扣若已氧化，不要把清潔劑流進縫裡。" }
    ],
    sections: [
      {
        heading: "尼龍不是「比較能亂洗的皮」",
        body:
          "鞋包頁把尼龍或帆布包身列成常見材質，但不能因此當成萬能水洗。尼龍怕的是塗層被溶劑霧掉、車縫進水後的內裡潮，以及油膜被搓出毛邊。帆布包頁處理織紋泥；本頁處理較滑的合成纖維與油膜。雨後要不要進防塵袋，見雨後包包頁。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：皮革保養油往尼龍上抹、去漬劑大面積擦、洗衣機整包洗。清潔限度：表面土與輕油膜較能評估；塗層霧化、色差、車縫進水後的內裡味，只能維持或淡化。不保證恢復出廠光澤。"
      },
      {
        heading: "送洗前對應鞋包清潔",
        body:
          "拍包身、提把油膜、底部與內裡。對應鞋包清潔頁。台中市可約免費收送。本頁不引用包類價目數字；品名是一般包還是背包，要對過物件再看價目表，避免把參考價當成這顆包的報價。"
      }
    ],
    faqs: [
      {
        question: "尼龍包可以用皮革清潔乳嗎？",
        answer: "不建議。那是另一套油脂系統，可能留下膜或霧面。先確認材質再處理。"
      },
      {
        question: "尼龍包可以丟洗衣機嗎？",
        answer: "有風險。五金、塗層與內裡結構不一定耐脫水。先拍照問，不要整包浸泡。"
      },
      {
        question: "油垢會不會越擦越亮？",
        answer: "用力搓可能把纖維磨亮或磨霧。亮不一定是乾淨。出現霧面就停手。"
      }
    ]
  },
  {
    slug: "canvas-bag-care",
    path: "guides/canvas-bag-care.html",
    category: "guide",
    title: "帆布包泥灰與包角，要等乾還是現洗？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明帆布包身沾泥時，濕刷會推進織紋，包角磨耗則不是髒污，應分開判斷。",
    h1: "帆布包：泥要等乾，包角磨耗不能當髒洗",
    summary: "帆布包泥灰等乾再處理；包角磨耗不是髒污。",
    citation_answer: "帆布包泥灰等乾再處理；包角磨耗不是髒污。",
    keywords: ["帆布包清潔", "帆布包沾泥", "包角磨損", "台中洗帆布包"],
    service_slug: "shoe-bag-care",
    local_intent: "台中西屯 帆布包 泥灰 包角",
    content_lastmod: "2026-08-30",
    hub_group: "bags",
    related_slugs: ["nylon-bag-care", "canvas-shoe-mud"],
    steps: [
      { name: "包身先等乾", text: "帆布包和帆布鞋同一邏輯：濕泥越刷越進織紋。先通風。" },
      { name: "四個角分開拍", text: "包角深色可能是泥，也可能是磨出底色。近照才能分。" },
      { name: "提把材質可能不同", text: "包身帆布、提把卻是皮或合成皮，不能同一種方式。" },
      { name: "內底一併看", text: "帆布包常把泥帶進內底。只清外面不夠。" }
    ],
    sections: [
      {
        heading: "包身織紋與包角磨耗是兩題",
        body:
          "帆布鞋沾泥頁講鞋面織紋；帆布包還有負重摩擦的四個角。提把頁已說明磨損不是髒污。本頁把「等乾處理泥」和「包角不能洗回邊油」寫在同一決策裡，避免只問洗不洗得到全新。尼龍包較滑、較怕塗層霧化，不要和帆布共用同一套硬刷。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：濕刷包身、硬刷包角想刷回原色、整包機洗。清潔限度：乾掉的表面泥較有機會；織紋裡的灰帶、包角掉色與邊料磨穿，清潔只能處理髒，不能重建角。不保證變全新。"
      },
      {
        heading: "送洗前對應鞋包清潔",
        body:
          "拍整包、四角、織紋近照與內底。對應鞋包清潔頁。台中市可約免費收送。本頁不報一般包金額；先對材質與磨耗，再決定要不要看價目表，避免把包角磨損當成可以洗掉的髒。"
      }
    ],
    faqs: [
      {
        question: "帆布包下雨淋髒，回家可以先刷嗎？",
        answer: "先等乾。濕刷會把泥推進織紋，包身起毛後更像舊痕。"
      },
      {
        question: "包角黑黑的洗得白嗎？",
        answer: "要先分是泥還是磨耗。泥可評估；磨出底色不能當髒洗掉。"
      },
      {
        question: "帆布包和帆布鞋可以同一天一起問嗎？",
        answer: "可以，但請分開拍照。包角承重磨耗和鞋面踩泥，判斷點不一樣。"
      }
    ]
  },
  {
    slug: "backpack-cleaning-check",
    path: "guides/backpack-cleaning-check.html",
    category: "guide",
    title: "書包、背包送洗前要看哪裡？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明背包與書包要先看底部、背帶、內袋與是否有電子或硬板，不能整顆當衣服泡水。",
    h1: "書包背包：先看底部、背帶和內袋",
    summary: "書包背包先看底部、背帶與內袋；不要整顆泡水。",
    citation_answer: "書包背包先看底部、背帶與內袋；不要整顆泡水。",
    keywords: ["書包清洗", "背包清洗", "書包怎麼洗", "台中洗書包"],
    service_slug: "shoe-bag-care",
    local_intent: "台中西屯 書包 背包 底部 背帶",
    content_lastmod: "2026-08-30",
    hub_group: "bags",
    related_slugs: ["bag-lining-care", "school-uniform-care"],
    steps: [
      { name: "清空並拍內袋", text: "筆袋格、筆痕、碎屑都先拍。有筆電層或硬板要標出來。" },
      { name: "看底部和背帶", text: "底部拖地磨耗、肩帶油汗，是背包最常見的兩個舊點。" },
      { name: "找不該進水的東西", text: "反光條、發泡墊、磁扣、名牌掛件，浸泡可能變形。" },
      { name: "不要整顆丟洗衣機", text: "結構包和鞋子一樣怕脫水。先問再決定。" }
    ],
    sections: [
      {
        heading: "背包是結構件，不是加大的帆布袋",
        body:
          "價目與既有制服頁都把書包、背包當成可詢問的品項，但沒有說可以整顆當衣服洗。門市會看底部磨耗、肩帶材質、內裡筆痕與是否有不該浸水的配件。開學制服整理是領口與整燙順序；本頁是背包結構。兩者可一起收送，仍要分開拍照。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：整顆機洗、刷掉底部塗層、用酒精清內袋筆痕。清潔限度：浮塵、肩帶表面髒較能評估；底部磨穿、泡棉變形、內裡筆痕擴散，只能維持或淡化。不保證回到新書包外觀。"
      },
      {
        heading: "送洗前對應鞋包清潔",
        body:
          "拍整包背面、底部、肩帶近照與打開的內袋。對應鞋包清潔頁；若同時送制服，制服走自己的指南。台中市可約免費收送。本頁不寫背包固定價，避免和實際結構落差。"
      }
    ],
    faqs: [
      {
        question: "國中書包很重很髒，可以直接丟洗衣機嗎？",
        answer: "不建議。底部、泡棉與配件不一定耐脫水。先拍結構再問。"
      },
      {
        question: "只洗外面、內袋自己吸塵可以嗎？",
        answer: "可以先說明你的範圍。若內袋有筆痕或潮味，只洗外面常不夠，門市會分開講。"
      },
      {
        question: "背包和鞋子可以同一批收送嗎？",
        answer: "可以一起詢問，但要分開拍照。背包結構和鞋面材質不是同一種風險。"
      }
    ]
  },
  {
    slug: "bag-clean-vs-repair",
    path: "guides/bag-clean-vs-repair.html",
    category: "guide",
    title: "包包該清潔、補色還是先不處理？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明清潔、補色與結構維修是不同工序，送洗前要先分髒污、掉色和破損，避免用清潔期待修復。",
    h1: "清潔不是補色，也不是維修",
    summary: "清潔只處理髒與部分水痕；補色修復是另一件事。",
    citation_answer: "清潔只處理髒與部分水痕；補色修復是另一件事。",
    keywords: ["包包清潔還是補色", "包包維修", "邊油磨損", "台中洗包"],
    service_slug: "shoe-bag-care",
    local_intent: "台中西屯 包包 清潔 補色 維修分界",
    content_lastmod: "2026-08-30",
    hub_group: "bags",
    related_slugs: ["bag-color-transfer", "luxury-bag-mold"],
    steps: [
      { name: "列出你最在意的結果", text: "去髒、去味、補回顏色，還是修好裂縫。目標不同，工序不同。" },
      { name: "對位置", text: "表面灰、色移、邊油磨穿、五金鬆脫，逐項標，不要包成一句「救回來」。" },
      { name: "先接受限度", text: "沒看過物件前，沒有「洗完一定像新的」這條路。" },
      { name: "再決定送不送", text: "只想清潔也可以；不要為了補色期待去走清潔，結果落差最大。" }
    ],
    sections: [
      {
        heading: "三條路不要共用一個保證",
        body:
          "鞋包服務頁寫過：已掉色或磨損的位置，清潔只能改善髒污，不能當作補色修復。精品包發霉頁處理霉；提把頁處理油汗與邊角。本頁是決策頁：你要的是洗髒、補色還是結構。公開價目把發霉特污與補色另計，意思就是它們不是同一道水洗。本頁不重複報價，只把分界講清楚。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：把裂縫當髒污刷、自行補色再送洗卻不告知。清潔限度：灰塵、部分水痕與浮霉較能評估；邊油磨穿、皮革色差、結構破裂，超出清潔目標。不保證新品外觀。若門市判斷需要其他工序，會另說，不在本頁先承諾做得到。"
      },
      {
        heading: "送洗前對應鞋包清潔",
        body:
          "拍整包、最在意位置近照，並寫下你要的是去髒還是補色。對應鞋包清潔頁；查參考價請走價目表頁，不要在指南頁找保證數字。台中市可約免費收送。目標講清楚，門市才不會用清潔結果去回答修復期待。"
      }
    ],
    faqs: [
      {
        question: "洗包會順便把邊角補色嗎？",
        answer: "不會自動發生。清潔與補色是不同工序。先說你的目標，再看物件。"
      },
      {
        question: "掉色的包還值得送清潔嗎？",
        answer: "若目標是去髒與去味，仍可評估。若目標是補回原色，要另談，不能用清潔結果衡量。"
      },
      {
        question: "發霉是走清潔還是修復？",
        answer: "先走發霉判斷，不要直接當補色。霉斑造成的色差，常只能淡化。"
      }
    ]
  },
  {
    slug: "wool-coat-dry-clean",
    path: "guides/wool-coat-dry-clean.html",
    category: "guide",
    title: "羊毛大衣能水洗嗎？先看結構再決定｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明羊毛大衣常有襯裡與墊肩，水洗容易縮皺變形，應先看洗標與結構再決定乾洗或停手。",
    h1: "羊毛大衣：先看結構，不要直接丟水洗",
    summary: "羊毛大衣通常走乾洗；水洗容易縮皺，先看洗標。",
    citation_answer: "羊毛大衣通常走乾洗；水洗容易縮皺，先看洗標。",
    keywords: ["羊毛大衣清洗", "大衣乾洗", "羊毛大衣水洗", "台中乾洗大衣"],
    service_slug: "taichung-xitun-laundry",
    local_intent: "台中西屯 羊毛大衣 乾洗 縮水",
    content_lastmod: "2026-08-30",
    hub_group: "textiles",
    related_slugs: ["dry-cleaning-guide", "wool-knit-shrink-risk"],
    steps: [
      { name: "先拍洗標", text: "圓圈乾洗、水盆水洗或打叉禁止，看不懂就拍照。不要憑手感猜。" },
      { name: "看有沒有襯裡墊肩", text: "有結構的大衣水洗後，內外縮率不同，版型會垮。" },
      { name: "分油光和塵", text: "領口油光偏乾洗路徑；表面浮塵不一定需要整件強洗。" },
      { name: "不要家用機洗", text: "滾筒加上脫水，是縮絨最常見的原因。先停手問。" }
    ],
    sections: [
      {
        heading: "大衣的風險在版型，不只在髒",
        body:
          "乾洗水洗差異頁已說明羊毛與有襯裡的外套通常走乾洗。本頁把對象收成羊毛大衣：墊肩、襯裡、厚織，水洗後常見的是袖籠變形與身片縮短。長大衣在公開價目是獨立品項，但本頁不抄金額，只回答「能不能當毛衣丟水裡」。針織毛衣是另一種縮絨機制，見針織頁。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：家用洗衣機、熱水、用力擰乾。清潔限度：表面塵與領口油光可評估；已經縮絨、墊肩位移或染色，乾洗也不能保證拉回原尺寸。不把「乾洗」理解成一定比較乾淨或一定能恢復新品。"
      },
      {
        heading: "送洗前對應西屯洗衣",
        body:
          "拍洗標、整件、領口袖口與最在意的油光。對應台中西屯洗衣店頁；決策背景見乾洗指南。台中市可約免費收送。查參考價請看價目表頁，本頁不重列數字，也不把乾洗理解成一定能恢復原尺寸。"
      }
    ],
    faqs: [
      {
        question: "洗標寫可水洗的羊毛大衣，自己洗可以嗎？",
        answer: "仍要看襯裡與厚度。洗標是起點不是保證不縮。不確定就先拍照，不要先機洗。"
      },
      {
        question: "大衣發霉要先乾洗嗎？",
        answer: "先走衣物發霉判斷，不要還沒通風就整件密封送。霉斑色差可能只能淡化。"
      },
      {
        question: "大衣和西裝外套是同一種乾洗嗎？",
        answer: "都常走乾洗，但厚度與結構不同。請分開拍照，不要當成同一件報。"
      }
    ]
  },
  {
    slug: "wool-knit-shrink-risk",
    path: "guides/wool-knit-shrink-risk.html",
    category: "guide",
    title: "羊毛針織、毛衣縮水前要先看什麼？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明針織毛衣怕的是縮絨與變形，不確定洗標時不要機洗或掛著滴乾。",
    h1: "針織毛衣：怕縮的是絨，不是表面那層灰",
    summary: "針織毛衣怕縮水變形；不確定就先拍洗標再問。",
    citation_answer: "針織毛衣怕縮水變形；不確定就先拍洗標再問。",
    keywords: ["毛衣縮水", "羊毛衫清洗", "針織衫怎麼洗", "台中洗毛衣"],
    service_slug: "taichung-xitun-laundry",
    local_intent: "台中西屯 毛衣 針織 縮水 洗標",
    content_lastmod: "2026-08-30",
    hub_group: "textiles",
    related_slugs: ["wool-coat-dry-clean", "dry-cleaning-guide"],
    steps: [
      { name: "認針織不是大衣", text: "沒有墊肩的毛衣，風險是纖維咬合縮絨，不是版型垮那麼單純。" },
      { name: "拍洗標與起毬位置", text: "起毬在摩擦處，和油污、霉斑不是同一種痕跡。" },
      { name: "不要掛著滴乾", text: "濕的針織被重力拉長，乾了變成異形。平鋪才是方向。" },
      { name: "機洗先當高風險", text: "攪動加溫水是縮絨捷徑。先問再決定。" }
    ],
    sections: [
      {
        heading: "縮絨一發生，多半回不去原尺寸",
        body:
          "乾洗指南把羊毛列為怕水縮皺的材質。毛衣沒有大衣那樣的襯裡，但針織圈容易在熱水與摩擦下咬緊，衣服變短變厚。本頁不討論起毛球美容，現有資料不足以當獨立服務；只提醒起毬不要用硬刷當去污。大衣頁處理結構件；本頁處理可拉伸的針織。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：熱水、洗衣機、掛乾、用去毬器猛刮到破洞。清潔限度：表面塵與氣味可評估；已經縮絨變厚、變短，通常無法拉回原尺寸。不保證恢復購買時的鬆緊。"
      },
      {
        heading: "送洗前對應西屯洗衣",
        body:
          "拍洗標、平放的整件、領口與起毬位置。對應台中西屯洗衣店頁。台中市可約免費收送。公開價目有毛衣品項，本頁不重寫數字，避免把品名價當成這件已縮絨毛衣的結果。"
      }
    ],
    faqs: [
      {
        question: "羊毛衫縮了一點，再洗會不會拉開？",
        answer: "縮絨後通常拉不回原尺寸。再洗可能更咬緊。先拍照說明現況，不要再試熱水。"
      },
      {
        question: "毛衣起毬要先剃再送洗嗎？",
        answer: "不建議先猛刮。破了就不是髒污問題。先保留原狀，讓門市看纖維。"
      },
      {
        question: "手洗比較安全嗎？",
        answer: "仍看水溫與搓揉。手洗不是保證。洗標看不懂就先問。"
      }
    ]
  },
  {
    slug: "clothing-mold-airing",
    path: "guides/clothing-mold-airing.html",
    category: "guide",
    title: "衣物發霉先通風還是直接洗？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明衣櫃取出的霉味衣物應先通風分辨表面霉與色斑，不要立刻套袋或濕擦。",
    h1: "衣物發霉：先通風，不要先套袋去洗",
    summary: "衣物發霉先通風、不要濕擦；先看是表面還是色斑。",
    citation_answer: "衣物發霉先通風、不要濕擦；先看是表面還是色斑。",
    keywords: ["衣服發霉", "衣櫃霉味", "衣物長霉", "台中洗衣發霉"],
    service_slug: "fabric-storage",
    local_intent: "台中西屯 衣物發霉 通風 色斑",
    content_lastmod: "2026-08-30",
    hub_group: "textiles",
    related_slugs: ["shoe-mold-surface-check", "bedding-storage-check"],
    steps: [
      {
        name: "從密閉空間拿出來",
        text:
          "衣櫃、真空袋、旅行箱取出後先掛通風，不要再套塑膠。避免擾動：不要戶外抖、不要刷霉屑；近看時戴口罩與手套，這是基本防護，不是除霉方法。"
      },
      { name: "看斑點顏色", text: "表面白粉和已經留下綠黑斑，可改善程度不同。" },
      { name: "分材質", text: "棉、羊毛、皮衣內裡，耐受不同。皮衣走皮衣頁，不要當棉T洗。" },
      { name: "不要先噴香水", text: "香味蓋不住霉。未處理就噴香，判斷會更難。" }
    ],
    sections: [
      {
        heading: "衣霉、鞋霉、包霉共用「先別擦」",
        body:
          "精品包與鞋子發霉頁都把濕擦當高風險。衣物多了纖維吸濕與染色擴散：還沒通風就丟洗衣機，斑可能更開。布品收納頁講收之前要聞潮；本頁講已經看到霉點時的第一個決策。皮衣發霉有自己的護理路徑，不要用本頁當皮衣作業指導。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：濕擦、漂白整件、未通風就真空壓縮、不要戶外抖霉、不要刷霉屑。清潔限度：浮霉與潮味較能評估；留下的色斑、纖維脆化，只能淡化或維持，不保證無斑，也不保證恢復。發霉在公開說明屬特殊污況，要看過物件並以門市檢視為準，本頁不寫加價，也不寫漂白比例。"
      },
      {
        heading: "送洗前對應布品收納",
        body:
          "拍整件、斑點近照、洗標與收納環境。對應布品收納頁；若是寢具，另看收納檢查或棉被清洗頁。台中市可約免費收送。處理後仍要乾燥再收，否則會再發。本頁不寫發霉加價，特殊污況要看過物件。"
      }
    ],
    faqs: [
      {
        question: "衣服有霉味但看不到斑，可以直接洗嗎？",
        answer: "先通風確認是潮還是霉。未看斑就漂白或密封，都可能讓狀況更難判斷。"
      },
      {
        question: "發霉衣物洗完斑還在，是沒洗乾淨嗎？",
        answer: "色斑常已改變纖維顏色，不是表面髒。清潔目標是抑制與淡化，不保證無斑。"
      },
      {
        question: "和鞋子發霉可以同一批送嗎？",
        answer: "可以一起問，但要分開拍照。鞋內與衣物纖維的風險不同。"
      }
    ]
  },
  {
    slug: "vacuum-bag-storage-risk",
    path: "guides/vacuum-bag-storage-risk.html",
    category: "guide",
    title: "衣物還沒乾，可以真空壓縮嗎？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明真空袋與密封收納在布品未全乾時會把潮氣與味道悶住，應先確認乾燥再壓縮。",
    h1: "真空袋不是收納捷徑：沒乾就壓等於悶味",
    summary: "還沒乾就真空壓縮，味道會被悶住；先確認全乾。",
    citation_answer: "還沒乾就真空壓縮，味道會被悶住；先確認全乾。",
    keywords: ["真空袋收納", "壓縮袋霉味", "換季收納真空", "台中布品收納"],
    service_slug: "fabric-storage",
    local_intent: "台中西屯 真空袋 壓縮 未乾 悶味",
    content_lastmod: "2026-08-30",
    hub_group: "decisions",
    related_slugs: ["post-wash-drying-before-storage", "bedding-storage-check"],
    steps: [
      { name: "先聞再壓", text: "有潮味或汗味，先不要抽真空。壓縮會把味道關在纖維裡。" },
      { name: "厚件摸中間", text: "外套與寢具表面乾、夾層不一定乾。中間涼涼的就先等。" },
      { name: "選透氣過渡", text: "不確定時用透氣袋過渡，比一次抽到最扁安全。" },
      { name: "有斑先問", text: "黃斑或霉點未處理就壓縮，下次打開常更深。" }
    ],
    sections: [
      {
        heading: "真空袋解決的是體積，不是潮氣",
        body:
          "布品收納頁寫過：有潮氣、汗味就直接真空或防塵袋，味道可能被悶住。本頁把決策收成「可不可以壓」。洗後乾燥頁回答洗完怎麼確認乾；收納檢查頁回答收之前看哪裡。三頁不要合成一句「收起來就好」。羽絨更怕沒乾就壓縮失蓬，見羽絨指南。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：剛烘過仍溫熱就抽真空、把未洗的霉衣直接壓平。清潔限度：壓縮本身不是清潔；悶出來的味與斑，之後只能評估改善，不保證回到壓縮前。不把真空袋當消毒工具。"
      },
      {
        heading: "送洗前對應布品收納",
        body:
          "若已經壓出味道，拍打開當下的布品、袋子內側與洗標。對應布品收納頁。台中市可約免費收送。本頁不討論真空袋品牌，只討論乾燥這個前提；袋子本身不能代替清潔或除霉。"
      }
    ],
    faqs: [
      {
        question: "外套洗完當天抽真空可以嗎？",
        answer: "若中間層還沒乾，不要壓。表面摸起來乾不夠，尤其是厚件。"
      },
      {
        question: "已經真空三個月打開有味，再壓一次會好嗎？",
        answer: "不會。先通風、確認來源，未處理再壓會更重。"
      },
      {
        question: "沒有真空袋、用塑膠袋綁緊一樣嗎？",
        answer: "一樣會把未乾的潮氣關住。重點是乾燥，不是袋子形狀。"
      }
    ]
  },
  {
    slug: "oil-vs-water-stain-choice",
    path: "guides/oil-vs-water-stain-choice.html",
    category: "guide",
    title: "油漬還是汗漬？這決定乾洗還是水洗｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明油性髒污與水性汗漬的處理方向不同，送洗前先分類型，避免用錯方式把痕跡定住。",
    h1: "先分油漬和汗漬，再決定乾洗或水洗",
    summary: "汗漬偏水洗、油光偏乾洗；先分髒污類型再選方式。",
    citation_answer: "汗漬偏水洗、油光偏乾洗；先分髒污類型再選方式。",
    keywords: ["油漬怎麼洗", "汗漬發黃", "乾洗還是水洗", "台中洗衣"],
    service_slug: "taichung-xitun-laundry",
    local_intent: "台中西屯 油漬 汗漬 乾洗 水洗",
    content_lastmod: "2026-08-30",
    hub_group: "decisions",
    related_slugs: ["dry-cleaning-guide", "shirt-suit-dry-cleaning"],
    steps: [
      { name: "看位置猜類型", text: "領口袖口常見皮脂；菜湯、機油是油性；飲料、汗鹽偏水性。" },
      { name: "看洗標", text: "再對的污漬類型，也要過洗標。絲質羊毛不能只因為是汗就丟水。" },
      { name: "不要先用廚房清潔劑", text: "去油噴劑對衣物染料與纖維是未知反應。先停手。" },
      { name: "混合污先說", text: "又油又汗很常見。門市會分區判斷，不是選一個極端。" }
    ],
    sections: [
      {
        heading: "這頁是「髒的種類」，不是再寫一次乾洗定義",
        body:
          "乾洗指南已經解釋溶劑與水的差異。本頁只幫客人先分類：油光、皮脂、妝痕偏向乾洗路徑；汗、飲料偏水洗。襯衫西裝頁處理領口黃與結構件。先分錯類型，再用家用去油，痕跡可能被定住。本頁不保證某種類型一定能去除。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：熱水燙油斑、漂白汗黃、自行塗廚房去油劑。清潔限度：新鮮污較能評估；高溫定型的領口黃、深油已擴散，只能淡化。不保證回白。材質限制大於污漬名稱。"
      },
      {
        heading: "送洗前對應西屯洗衣",
        body:
          "拍整體、污漬近照、洗標，並說明是油、汗還是不知道。對應台中西屯洗衣店頁。台中市可約免費收送。價目表把水洗參考價與乾洗另計分開，本頁不重列數字。"
      }
    ],
    faqs: [
      {
        question: "領口黃一定是汗，所以一定水洗嗎？",
        answer: "領口常是皮脂加汗。還要看面料。西裝或羊毛不能只因為「黃」就水洗。"
      },
      {
        question: "油漬用洗碗精可以嗎？",
        answer: "不建議。濃度與染料反應未知，可能把斑推開或留下圈。先拍照。"
      },
      {
        question: "不知道是油還是水，怎麼問？",
        answer: "直接說不知道，並拍位置與時間。門市會先分，不會逼你先選一種方式。"
      }
    ]
  },
  {
    slug: "blanket-damp-check",
    path: "guides/blanket-damp-check.html",
    category: "guide",
    title: "毯子、毛毯收納前怎麼確認乾了？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明毯子與厚毛毯中間層可能仍潮，收納前要分材質與潮氣，不能只摸表面。",
    h1: "毯子摸起來乾，中間層仍可能是潮的",
    summary: "毯子收納前先聞潮味；厚層表面乾、中間不一定乾。",
    citation_answer: "毯子收納前先聞潮味；厚層表面乾、中間不一定乾。",
    keywords: ["毯子清洗", "毛毯收納", "毯子發霉", "台中洗毯子"],
    service_slug: "fabric-storage",
    local_intent: "台中西屯 毯子 毛毯 潮氣 收納",
    content_lastmod: "2026-08-30",
    hub_group: "textiles",
    related_slugs: ["bedding-storage-check", "post-wash-drying-before-storage"],
    steps: [
      { name: "分毯子不是被子", text: "毯子通常較薄或另一種絨面，但仍有夾層潮氣。不要用棉被頁的填充假設硬套。" },
      { name: "摺線與邊角", text: "摺進去的邊最容易留潮與灰塵。打開來聞。" },
      { name: "看絨面倒伏", text: "絨被壓平發亮，不一定是髒；濕刷會更倒。" },
      { name: "未乾不進櫃", text: "有潮味就先不要摺進塑膠。先問清不清理。" }
    ],
    sections: [
      {
        heading: "毯子頁不重複棉被填充那題",
        body:
          "床組棉被頁看填充與蓬度；收納檢查頁看外套與寢具接觸皮膚處。本頁對象是毯子、毛毯這類常被當成「比較小件所以可以直接收」的布。既有收納文把毯子和厚布品邊角列成檢查項。沒有公開固定的毯子價目列在服務價目表主表時，本頁就不報價，只講潮氣與絨面風險。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：濕時硬刷絨面、未乾進真空袋、高溫烘到焦味。清潔限度：浮塵與未封死的潮味較能評估；久放黃痕、絨面永久倒伏，只能維持。不保證回新絨向。"
      },
      {
        heading: "送洗前對應布品收納",
        body:
          "拍整張、摺線、邊角與洗標。對應布品收納頁。體積仍可約台中市免費收送。若其實是帶填充的棉被，改走棉被清洗頁，不要用毯子頁硬套填充問題。本頁也不報未在公開價目表列出的毯子固定價。"
      }
    ],
    faqs: [
      {
        question: "沙發上的毯子沒有洗標，可以自己洗嗎？",
        answer: "先不要機洗。拍絨面與邊角，讓門市看材質。沒標籤就更不能猜水溫。"
      },
      {
        question: "毯子和被子可以同一袋收嗎？",
        answer: "可以一起問，但填充件與絨毯的乾燥時間不同。未全乾不要共壓一袋。"
      },
      {
        question: "毛毯有靜電和灰塵，是不是該洗了？",
        answer: "浮塵可先評估；若其實是潮味或霉，重點改成乾燥與發霉判斷，不是靜電本身。"
      }
    ]
  },
  {
    slug: "post-wash-drying-before-storage",
    path: "guides/post-wash-drying-before-storage.html",
    category: "guide",
    title: "送洗後沒乾透就收，會怎樣？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明清洗後的衣物與寢具若夾層未乾就收納，潮氣會再轉成味道，應把乾燥當成獨立步驟。",
    h1: "洗完沒乾透就收，等於把潮氣封回去",
    summary: "洗完沒乾透就收納，等於把潮氣封回去。",
    citation_answer: "洗完沒乾透就收納，等於把潮氣封回去。",
    keywords: ["洗完如何收納", "衣服沒乾就收", "寢具乾燥", "台中洗衣收納"],
    service_slug: "fabric-storage",
    local_intent: "台中西屯 洗後乾燥 收納 潮氣",
    content_lastmod: "2026-08-30",
    hub_group: "decisions",
    related_slugs: ["vacuum-bag-storage-risk", "bedding-duvet-cleaning"],
    steps: [
      { name: "取件先掛再收", text: "剛取回不要立刻進櫃或真空。給夾層一個通風時間。" },
      { name: "厚件摸內層", text: "羽絨、棉被、大衣看中間，不看表面。" },
      { name: "塑膠套先打開", text: "若有暫時套著，回家先打開。塑膠會把殘餘濕氣關住。" },
      { name: "有味先停", text: "取回後若有潮味，先聯絡說明，不要自行高溫烘後再投訴。" }
    ],
    sections: [
      {
        heading: "乾燥是清潔的下一題，不是附贈",
        body:
          "棉被頁與羽絨頁都把「沒乾透就收納」寫成味道來源。本頁把這句話做成獨立決策，涵蓋衣物與布品，不重複怎麼洗棉被。真空袋頁回答壓不壓；本頁回答「洗完那一天能不能收」。門市取件後的塑膠套是運送保護，不是長期密封建議。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：取回立刻真空、高溫烘想追乾、把潮味當「沒洗乾淨」反覆自行處理。清潔限度：一次清洗不保證對抗之後的潮濕環境。沒乾就收造成的悶味，要重新判斷，不是原清潔失效這麼簡單。"
      },
      {
        heading: "送洗前對應布品收納",
        body:
          "若你問的是收納前要不要洗，走寢具收納檢查；若問洗完怎麼收，用本頁。對應布品收納頁。台中市可約免費收送。本頁不承諾乾燥時數，因為厚度與天氣都會變。"
      }
    ],
    faqs: [
      {
        question: "取件套著塑膠袋，可以連袋放進櫃子嗎？",
        answer: "不建議當長期收納。先打開通風，確認夾層乾了再收。"
      },
      {
        question: "洗完當週就要真空收進閣樓可以嗎？",
        answer: "先確認中間層乾透。沒把握就先透氣過渡，不要一次壓死。"
      },
      {
        question: "這和收納前檢查有何不同？",
        answer: "收納檢查是「髒的要不要先處理」；本頁是「已經洗了，乾了沒」。時間點不同。"
      }
    ]
  },
  {
    slug: "synthetic-vs-leather-handle",
    path: "guides/synthetic-vs-leather-handle.html",
    category: "guide",
    title: "包包提把是真皮還是合成皮？分錯會傷｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明真皮與合成皮提把的清潔與乾燥反應不同，先分材質再處理手汗與脫皮。",
    h1: "提把先分真皮或合成皮，再決定能不能擦",
    summary: "合成皮與真皮提把清潔方式不同；先分材質再處理。",
    citation_answer: "合成皮與真皮提把清潔方式不同；先分材質再處理。",
    keywords: ["合成皮提把", "真皮提把清潔", "包包脫皮", "台中洗包"],
    service_slug: "shoe-bag-care",
    local_intent: "台中西屯 提把 真皮 合成皮 脫皮",
    content_lastmod: "2026-08-30",
    hub_group: "bags",
    related_slugs: ["bag-handle-cleaning", "leather-jacket-care"],
    steps: [
      { name: "看塗層有沒有起皮", text: "合成皮常見表面膜揭起；真皮較多是乾燥、掉色或邊油磨。" },
      { name: "不要上錯油", text: "皮革油上在合成膜上可能發黏、更髒。先認材質。" },
      { name: "手汗位置近照", text: "握感發黑是油汗還是膜在剝，決定能不能清。" },
      { name: "包身可能不同材", text: "尼龍包配皮提把很常見。只拍包身會判錯。" }
    ],
    sections: [
      {
        heading: "提把頁講位置，本頁講材質分叉",
        body:
          "提把、包角與行李箱輪子頁已經把提把當高接觸區。本頁解決「看起來都像皮」的誤判：合成皮膜一剝，再擦油或再刷，只會更大片。皮衣頁也強調真皮、合成皮、麂皮路徑不同。這裡把範圍縮在提把，因為它是最先被擦錯的地方。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：膜已翹起仍用力擦、真皮乾燥仍用酒精。清潔限度：真皮表面髒與輕油汗較能評估；合成膜剝離無法用清潔長回膜。不保證提把回到新色。掉皮後的補色屬另一工序。"
      },
      {
        heading: "送洗前對應鞋包清潔",
        body:
          "拍提把近照、起皮處、包身材質與整包。對應鞋包清潔頁。台中市可約免費收送。本頁不報皮包價，避免把合成皮提把當成名牌皮的修復承諾，也不把脫皮膜當成可以洗回去的髒。"
      }
    ],
    faqs: [
      {
        question: "提把一搓就脫皮，再擦油會好嗎？",
        answer: "多半不會。那常是合成膜在剝。再上油可能更黏。先停手拍照。"
      },
      {
        question: "摸起來像皮就是真皮嗎？",
        answer: "不一定。要看起皮方式與切面。不確定就拍近照，不要先保養。"
      },
      {
        question: "真皮提把發黑洗得掉嗎？",
        answer: "手汗未深滲時較能評估；已進皮層只能淡化，不能當補色。"
      }
    ]
  },
  {
    slug: "rainy-bag-care",
    path: "guides/rainy-bag-care.html",
    category: "guide",
    title: "雨後包包怎麼處理？包角和內裡先看哪？｜私享家洗衣店",
    description:
      "私享家洗衣店（台中市西屯區青海路二段365號）說明包包淋雨後應先通風檢查包角與內裡，不要立刻收進防塵袋或上油。",
    h1: "雨後包包：先通風看包角與內裡",
    summary: "雨後包包先通風看包角與內裡；不要立刻收進防塵袋。",
    citation_answer: "雨後包包先通風看包角與內裡；不要立刻收進防塵袋。",
    keywords: ["包包淋雨", "包角水痕", "雨天洗包", "台中洗包"],
    service_slug: "shoe-bag-care",
    local_intent: "台中西屯 包包淋雨 包角 內裡 防塵袋",
    content_lastmod: "2026-08-30",
    hub_group: "bags",
    related_slugs: ["rainy-shoe-care", "bag-lining-care"],
    steps: [
      { name: "打開包通風", text: "拉開拉鍊，取出濕物，讓內裡散氣。不要連著內容物一起悶。" },
      { name: "看四個角", text: "包角最容易吸水變深。深色是水痕還是本來磨耗，要等表面不滴再拍。" },
      { name: "皮革件先不上油", text: "和皮鞋同一邏輯：水還在移動時上油，可能鎖痕。" },
      { name: "防塵袋等全乾", text: "外面摸乾、內底仍潮就套袋，味道會在袋子裡發生。" }
    ],
    sections: [
      {
        heading: "這不是雨天鞋子的換皮版本",
        body:
          "雨天鞋子頁處理鞋墊、膠邊與高溫烘。包包多了內袋積水、防塵袋收納和包角承重。尼龍與帆布包身怕的是內裡潮與織紋泥；皮革件怕鎖油。本頁把物件換成包，決策改成「要不要立刻進防塵袋」。行李箱輪子仍在提把頁，不在這裡重複。"
      },
      {
        heading: "停手條件與清潔限度",
        body:
          "停手條件：熱風灌進包內、濕時上油、未乾進防塵袋。清潔限度：表面水與浮土較能評估；鎖進皮面的水圈、包角掉色、內裡霉，只能淡化。不保證外觀回到淋雨前。"
      },
      {
        heading: "送洗前對應鞋包清潔",
        body:
          "拍整包、四角、打開的內底與是否已上油。對應鞋包清潔頁。鞋子若也淋雨，鞋走雨天鞋子頁，包走本頁，分開拍。台中市可約免費收送。本頁不列包類價，也不把防塵袋當成淋雨後的收納解法。"
      }
    ],
    faqs: [
      {
        question: "皮包淋雨，擦乾上油保護比較好？",
        answer: "先通風。水痕常晚點出現，這時上油可能鎖印。不要急著保養。"
      },
      {
        question: "尼龍包淋濕，可以吹熱風快乾嗎？",
        answer: "不建議高溫。內裡與塗層反應不同。打開通風比較安全。"
      },
      {
        question: "雨後包包和雨後鞋子可以一起送嗎？",
        answer: "可以一起收送，但風險不同，請分開拍照，不要只傳一張全家福。"
      }
    ]
  }
];

export const INDEX_GROWTH_CATALOG: IndexGrowthPageDefinition[] =
  RAW_ACCEPTED_INDEX_GROWTH_PAGE_BODIES.map(attachProvenance);
