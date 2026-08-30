import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_INDEX_GROWTH_PAGE_COUNT,
  ACCEPTED_INDEX_GROWTH_PAGES,
  INDEX_GROWTH_CATALOG,
  INDEX_GROWTH_CITATION_MAX,
  INDEX_GROWTH_REJECTED_CANDIDATES,
  INDEX_GROWTH_SIMILARITY_THRESHOLD,
  INDEX_GROWTH_SOURCE_REGISTRY,
  PROTECTED_LIVE_COHORT_SLUGS,
  citationAnswerLength,
  ngramJaccard,
  normalizeDiagnosticText,
  pageDiagnosticText,
  protectedSupportContentHash,
  resolveAcceptedIndexGrowthPages,
  validateIndexGrowthPages
} from "../src/indexGrowthPages";
import type { IndexGrowthPageDefinition } from "../src/indexGrowthPages";
import { KNOWN_SERVICE_SLUGS } from "../src/publicSiteTypes";

const TODAY = "2026-08-31";
const CLONE_SLUG = "suede-shoe-cleaning-unseen-geo-clone";

function catalogPage(slug: string): IndexGrowthPageDefinition {
  const page = INDEX_GROWTH_CATALOG.find((item) => item.slug === slug);
  if (!page) throw new Error(`missing catalog page ${slug}`);
  return page;
}

function cloneWithUnseenLocation(page: IndexGrowthPageDefinition): IndexGrowthPageDefinition {
  const swap = (value: string): string =>
    value
      .replaceAll("台中西屯", "臨海鎮")
      .replaceAll("台中市", "臨海市")
      .replaceAll("台中", "臨海")
      .replaceAll("西屯", "臨海")
      .replaceAll("逢甲", "漁港");
  return {
    ...page,
    slug: CLONE_SLUG,
    path: page.path.replace(".html", "-linhai.html"),
    title: swap(page.title),
    h1: swap(page.h1),
    description: swap(page.description),
    local_intent: swap(page.local_intent),
    keywords: page.keywords.map(swap),
    canonical_intent_slug: CLONE_SLUG,
    intent_cluster: `${page.intent_cluster}-linhai`,
    steps: page.steps.map((step) => ({ ...step, name: swap(step.name), text: swap(step.text) })),
    sections: (page.sections ?? []).map((section) => ({
      ...section,
      heading: swap(section.heading),
      body: swap(section.body)
    })),
    faqs: page.faqs.map((faq) => ({ ...faq, question: swap(faq.question), answer: swap(faq.answer) }))
  };
}

describe("indexGrowthPages validator", () => {
  it("accepts the phase-1 catalog below the calibrated similarity threshold", () => {
    expect(INDEX_GROWTH_CATALOG.filter((page) => page.publish_state === "accepted")).toHaveLength(
      ACCEPTED_INDEX_GROWTH_PAGE_COUNT
    );
    const result = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, {
      today: TODAY,
      knownServiceSlugs: KNOWN_SERVICE_SLUGS
    });
    expect(result.failures, JSON.stringify(result.failures, null, 2)).toEqual([]);
    expect(result.ok).toBe(true);

    let maxSimilarity = 0;
    let maxPair = "";
    const accepted = INDEX_GROWTH_CATALOG.filter((page) => page.publish_state === "accepted");
    for (let i = 0; i < accepted.length; i += 1) {
      const left = accepted[i];
      if (!left) continue;
      expect(citationAnswerLength(left.citation_answer ?? "")).toBeLessThanOrEqual(INDEX_GROWTH_CITATION_MAX);
      expect(left.citation_answer).not.toBe(left.description);
      expect(left.category).toBe("guide");
      expect(left.path.startsWith("guides/")).toBe(true);
      expect(left.publish_state).toBe("accepted");
      expect(left.intent_cluster).toBeTruthy();
      expect(left.canonical_intent_slug).toBe(left.slug);
      expect(left.content_revision).toBe(`${left.content_lastmod}#1`);
      expect((left.citation_source_refs ?? []).length).toBeGreaterThan(0);
      for (const ref of left.citation_source_refs ?? []) {
        expect(INDEX_GROWTH_SOURCE_REGISTRY[ref], ref).toBeTruthy();
      }
      for (let j = i + 1; j < accepted.length; j += 1) {
        const right = accepted[j];
        if (!right) continue;
        const similarity = ngramJaccard(
          normalizeDiagnosticText(pageDiagnosticText(left)),
          normalizeDiagnosticText(pageDiagnosticText(right))
        );
        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
          maxPair = `${left.slug} vs ${right.slug}`;
        }
      }
    }
    expect(maxSimilarity, maxPair).toBeLessThan(INDEX_GROWTH_SIMILARITY_THRESHOLD);
  });

  it("fails closed on duplicate slug, missing citation, placeholder, and short sections", () => {
    const base = catalogPage("suede-shoe-cleaning");
    const duplicateSlug = {
      ...base,
      path: "guides/other.html",
      title: "另一題",
      h1: "另一題",
      citation_answer: "另一個獨立答案用來避開重複。",
      summary: "另一個獨立答案用來避開重複。",
      local_intent: "另一意圖",
      canonical_intent_slug: "other-intent"
    };
    const missingCitation = {
      ...base,
      slug: "missing-citation",
      path: "guides/missing-citation.html",
      title: "缺答案",
      h1: "缺答案",
      citation_answer: undefined,
      summary: "缺答案時會落到品牌描述。",
      description: "缺答案時會落到品牌描述。",
      local_intent: "缺答案意圖",
      canonical_intent_slug: "missing-citation"
    };
    const placeholder = {
      ...base,
      slug: "placeholder-page",
      path: "guides/placeholder-page.html",
      title: "待補標題",
      h1: "待補標題",
      citation_answer: "這頁還有 TODO 內容不能發布。",
      summary: "這頁還有 TODO 內容不能發布。",
      local_intent: "待補意圖",
      canonical_intent_slug: "placeholder-page"
    };
    const shortSections = {
      ...base,
      slug: "short-sections",
      path: "guides/short-sections.html",
      title: "過短段落",
      h1: "過短段落",
      citation_answer: "過短段落不能當成完整判斷頁。",
      summary: "過短段落不能當成完整判斷頁。",
      local_intent: "過短意圖",
      canonical_intent_slug: "short-sections",
      sections: [
        { heading: "一", body: "太短", source_refs: base.citation_source_refs ?? [] },
        { heading: "二", body: "也短", source_refs: base.citation_source_refs ?? [] }
      ]
    };

    const duplicateResult = validateIndexGrowthPages([base, duplicateSlug], { today: TODAY });
    expect(duplicateResult.ok).toBe(false);
    expect(duplicateResult.failures.some((failure) => failure.code === "duplicate-field")).toBe(true);

    const citationResult = validateIndexGrowthPages([missingCitation], { today: TODAY });
    expect(citationResult.ok).toBe(false);
    expect(citationResult.failures.some((failure) => failure.code === "citation-fallback")).toBe(true);

    const placeholderResult = validateIndexGrowthPages([placeholder], { today: TODAY });
    expect(placeholderResult.ok).toBe(false);
    expect(placeholderResult.failures.some((failure) => failure.code === "placeholder")).toBe(true);

    const shortResult = validateIndexGrowthPages([shortSections], { today: TODAY });
    expect(shortResult.ok).toBe(false);
    expect(shortResult.failures.some((failure) => failure.code === "short-sections")).toBe(true);
  });

  it("rejects a clone that only swaps an unseen location, with exact similarity and doorway-geo codes", () => {
    const original = catalogPage("suede-shoe-cleaning");
    const clone = cloneWithUnseenLocation(original);
    expect(clone.slug).toBe(CLONE_SLUG);
    const mutated = validateIndexGrowthPages([...INDEX_GROWTH_CATALOG, clone], { today: TODAY });
    expect(mutated.ok).toBe(false);
    const similarity = mutated.failures.find(
      (failure) => failure.code === "similarity" && failure.slugs?.includes(CLONE_SLUG)
    );
    const doorway = mutated.failures.find(
      (failure) => failure.code === "doorway-geo" && failure.slugs?.includes(CLONE_SLUG)
    );
    expect(similarity, JSON.stringify(mutated.failures, null, 2)).toBeTruthy();
    expect(doorway, JSON.stringify(mutated.failures, null, 2)).toBeTruthy();
    expect(similarity?.message).toContain(CLONE_SLUG);
    expect(similarity?.message).toContain(original.slug);
    expect(doorway?.message).toContain(CLONE_SLUG);
    expect(doorway?.message).toContain(original.slug);
    expect(similarity?.slugs).toEqual(expect.arrayContaining([original.slug, CLONE_SLUG]));
    expect(doorway?.slugs).toEqual(expect.arrayContaining([original.slug, CLONE_SLUG]));

    const restored = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(restored.ok).toBe(true);
    expect(restored.failures).toEqual([]);
  });

  it("rejects a future lastmod, revision mismatch, and unsupported price tokens", () => {
    const base = catalogPage("canvas-shoe-mud");
    const future = {
      ...base,
      slug: "future-lastmod",
      path: "guides/future-lastmod.html",
      title: "未來日期",
      h1: "未來日期",
      citation_answer: "未來日期不能寫進 lastmod。",
      summary: "未來日期不能寫進 lastmod。",
      local_intent: "未來日期意圖",
      canonical_intent_slug: "future-lastmod",
      content_lastmod: "2026-09-01",
      content_revision: "2026-09-01#1"
    };
    const revisionMismatch = {
      ...base,
      slug: "revision-mismatch",
      path: "guides/revision-mismatch.html",
      title: "修訂日期不符",
      h1: "修訂日期不符",
      citation_answer: "修訂號必須對上內容日期。",
      summary: "修訂號必須對上內容日期。",
      local_intent: "修訂不符意圖",
      canonical_intent_slug: "revision-mismatch",
      content_lastmod: "2026-08-30",
      content_revision: "2026-08-29#1"
    };
    const priced = {
      ...base,
      slug: "priced-guide",
      path: "guides/priced-guide.html",
      title: "含價格",
      h1: "含價格",
      citation_answer: "這頁不該寫死價格。",
      summary: "這頁不該寫死價格。",
      local_intent: "含價格意圖",
      canonical_intent_slug: "priced-guide",
      faqs: [
        ...base.faqs.slice(0, 2),
        {
          question: "多少錢？",
          answer: "一般運動鞋 $250，這是不該出現在新指南的數字。",
          source_refs: base.citation_source_refs ?? []
        }
      ]
    };
    const futureResult = validateIndexGrowthPages([future], { today: TODAY });
    expect(futureResult.failures.some((failure) => failure.code === "volatile-lastmod")).toBe(true);
    const revisionResult = validateIndexGrowthPages([revisionMismatch], { today: TODAY });
    expect(revisionResult.failures.some((failure) => failure.code === "revision-mismatch")).toBe(true);
    const priceResult = validateIndexGrowthPages([priced], { today: TODAY });
    expect(priceResult.failures.some((failure) => failure.code === "unsupported-price")).toBe(true);
  });

  it("rejects an unknown parent service instead of falling back", () => {
    const base = catalogPage("suede-shoe-cleaning");
    const orphan = {
      ...base,
      slug: "orphan-parent",
      path: "guides/orphan-parent.html",
      title: "沒有父服務",
      h1: "沒有父服務",
      citation_answer: "沒有已知父服務的頁不能發布。",
      summary: "沒有已知父服務的頁不能發布。",
      local_intent: "沒有父服務意圖",
      canonical_intent_slug: "orphan-parent",
      service_slug: "not-a-real-service"
    };
    const result = validateIndexGrowthPages([orphan], { today: TODAY, knownServiceSlugs: KNOWN_SERVICE_SLUGS });
    expect(result.failures.some((failure) => failure.code === "unknown-parent")).toBe(true);
  });

  it("keeps rejected, merge, and draft candidates out of the accepted projection", () => {
    const projection = resolveAcceptedIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(projection).toHaveLength(ACCEPTED_INDEX_GROWTH_PAGE_COUNT);
    expect(ACCEPTED_INDEX_GROWTH_PAGES.map((page) => page.slug).sort()).toEqual(
      projection.map((page) => page.slug).sort()
    );
    const accepted = new Set(projection.map((page) => page.slug));
    for (const candidate of INDEX_GROWTH_REJECTED_CANDIDATES) {
      expect(accepted.has(candidate.slug)).toBe(false);
      expect(["rejected", "merge", "draft"]).toContain(candidate.status);
      expect(candidate.publish_state).toBe(candidate.status);
    }
    expect(JSON.stringify(projection)).not.toContain("source_refs");
    expect(JSON.stringify(projection)).not.toContain("publish_state");
    expect(JSON.stringify(projection)).not.toContain("intent_cluster");
    expect(JSON.stringify(projection)).not.toContain("citation_source_refs");
  });

  it("reproduces the 32-URL GSC snapshot as 26 indexed / 5 discovered-not-indexed / 1 unknown", () => {
    const csv = readFileSync("research/index-growth-100/topic-inventory.csv", "utf8").trim().split(/\r?\n/);
    const header = csv[0]?.split(",") ?? [];
    const stateIdx = header.indexOf("gsc_state");
    const publishIdx = header.indexOf("publish_state");
    const existing = csv.slice(1).map((line) => line.split(",")).filter((cols) => cols[publishIdx] === "existing");
    const counts = existing.reduce<Record<string, number>>((acc, cols) => {
      const state = cols[stateIdx] ?? "";
      acc[state] = (acc[state] ?? 0) + 1;
      return acc;
    }, {});
    expect(existing).toHaveLength(32);
    expect(counts.indexed).toBe(26);
    expect(counts.discovered_not_indexed).toBe(5);
    expect(counts.unknown).toBe(1);
    const generated = csv.slice(1).map((line) => line.split(",")).filter((cols) => cols[publishIdx] === "accepted");
    expect(generated.every((cols) => cols[stateIdx] === "generated")).toBe(true);
    expect(generated.every((cols) => cols[stateIdx] !== "indexed" && cols[stateIdx] !== "submitted")).toBe(true);
  });

  it("structurally omits a draft catalog row from the resolver projection", () => {
    const catalog = INDEX_GROWTH_CATALOG.map((page) =>
      page.slug === "rainy-bag-care" ? { ...page, publish_state: "draft" as const } : page
    );
    const projection = resolveAcceptedIndexGrowthPages(catalog, { today: TODAY });
    expect(projection.some((page) => page.slug === "rainy-bag-care")).toBe(false);
    expect(projection).toHaveLength(ACCEPTED_INDEX_GROWTH_PAGE_COUNT - 1);
  });
});
