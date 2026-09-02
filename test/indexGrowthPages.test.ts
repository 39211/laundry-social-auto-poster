import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  INDEX_GROWTH_CATALOG,
  INDEX_GROWTH_CITATION_MAX,
  INDEX_GROWTH_REJECTED_CANDIDATES,
  INDEX_GROWTH_SIMILARITY_THRESHOLD,
  INDEX_GROWTH_SOURCE_REGISTRY,
  PROTECTED_INDEX_GROWTH_LOCKS,
  PROTECTED_LIVE_COHORT_SLUGS,
  citationAnswerLength,
  claimProvenanceBinding,
  frozenSourceRecordHash,
  ngramJaccard,
  normalizeDiagnosticText,
  pageDiagnosticText,
  protectedSupportContentHash,
  resolveAcceptedIndexGrowthPages,
  validateIndexGrowthPages
} from "../src/indexGrowthPages";
import type { FrozenSourceRecord, IndexGrowthPageDefinition } from "../src/indexGrowthPages";
import { KNOWN_SERVICE_SLUGS } from "../src/publicSiteTypes";

const TODAY = "2026-09-03";
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
    const acceptedProjection = resolveAcceptedIndexGrowthPages(INDEX_GROWTH_CATALOG, {
      today: TODAY,
      knownServiceSlugs: KNOWN_SERVICE_SLUGS
    });
    expect(INDEX_GROWTH_CATALOG.filter((page) => page.publish_state === "accepted")).toHaveLength(
      acceptedProjection.length
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
      expect(PROTECTED_INDEX_GROWTH_LOCKS[left.slug]?.content_revision).toBe(left.content_revision);
      expect(PROTECTED_INDEX_GROWTH_LOCKS[left.slug]?.body_hash).toBe(protectedSupportContentHash(left));
      expect((left.citation_source_refs ?? []).length).toBeGreaterThan(0);
      for (const ref of left.citation_source_refs ?? []) {
        const binding = claimProvenanceBinding(ref);
        expect(binding, ref).toBeTruthy();
        expect(binding?.locator).toBeTruthy();
        expect(binding?.summary).toBeTruthy();
        expect(binding?.content_hash).toMatch(/^[a-f0-9]{64}$/u);
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
      content_lastmod: "2026-09-04",
      content_revision: "2026-09-04#1"
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
    expect(projection).toHaveLength(
      INDEX_GROWTH_CATALOG.filter((page) => page.publish_state === "accepted").length
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
    expect(projection).toHaveLength(
      resolveAcceptedIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY }).length - 1
    );
  });
});

function cloneRegistry(): Record<string, FrozenSourceRecord> {
  return Object.fromEntries(
    Object.entries(INDEX_GROWTH_SOURCE_REGISTRY).map(([id, record]) => [id, { ...record }])
  );
}

describe("indexGrowthPages fail-closed mutations", () => {
  it("mutation 1: rebinding a citation source_ref to another legal ref fails closed", () => {
    const baseline = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(baseline.ok).toBe(true);

    const original = catalogPage("suede-shoe-cleaning");
    const rebound = Object.keys(INDEX_GROWTH_SOURCE_REGISTRY).find(
      (ref) => !(original.citation_source_refs ?? []).includes(ref)
    );
    if (!rebound) throw new Error("need another legal registry ref");
    const mutated = INDEX_GROWTH_CATALOG.map((page) =>
      page.slug === original.slug
        ? { ...page, citation_source_refs: [rebound, ...(page.citation_source_refs ?? []).slice(1)] }
        : page
    );
    const red = validateIndexGrowthPages(mutated, { today: TODAY });
    expect(red.ok).toBe(false);
    expect(red.failures.some((failure) => failure.code === "claim-provenance")).toBe(true);

    const restored = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(restored.ok).toBe(true);
    expect(restored.failures).toEqual([]);
  });

  it("mutation 2: rewriting content_revision to #999 fails closed", () => {
    const baseline = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(baseline.ok).toBe(true);

    const mutated = INDEX_GROWTH_CATALOG.map((page) =>
      page.slug === "canvas-shoe-mud"
        ? { ...page, content_revision: `${page.content_lastmod}#999` }
        : page
    );
    const red = validateIndexGrowthPages(mutated, { today: TODAY });
    expect(red.ok).toBe(false);
    expect(red.failures.some((failure) => failure.code === "revision-mismatch")).toBe(true);

    const restored = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(restored.ok).toBe(true);
    expect(restored.failures).toEqual([]);
  });

  it("mutation 3: rewriting a still-long protected body fails closed", () => {
    const baseline = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(baseline.ok).toBe(true);

    const original = catalogPage("suede-shoe-cleaning");
    const firstSection = original.sections?.[0];
    if (!firstSection) throw new Error("missing suede section");
    const rewritten = firstSection.body.replace("勃肯那類軟木鞋床是另一個系統", "其他軟木底鞋款改走另一套判斷");
    expect(citationAnswerLength(rewritten)).toBeGreaterThanOrEqual(70);
    expect(rewritten).not.toBe(firstSection.body);
    const mutated = INDEX_GROWTH_CATALOG.map((page) =>
      page.slug === original.slug
        ? {
            ...page,
            sections: (page.sections ?? []).map((section, index) =>
              index === 0 ? { ...section, body: rewritten } : section
            )
          }
        : page
    );
    const red = validateIndexGrowthPages(mutated, { today: TODAY });
    expect(red.ok).toBe(false);
    expect(red.failures.some((failure) => failure.code === "protected-content-hash")).toBe(true);

    const restored = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(restored.ok).toBe(true);
    expect(restored.failures).toEqual([]);
  });

  it("mutation 4: clothing-mold outdoor shake/brush advice fails closed", () => {
    const baseline = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(baseline.ok).toBe(true);

    const mutated = INDEX_GROWTH_CATALOG.map((page) =>
      page.slug === "clothing-mold-airing"
        ? {
            ...page,
            faqs: page.faqs.map((faq, index) =>
              index === 0
                ? { ...faq, answer: "拿到戶外抖掉霉屑，再用漂白水1:10刷掉，斑一定恢復。" }
                : faq
            )
          }
        : page
    );
    const red = validateIndexGrowthPages(mutated, { today: TODAY });
    expect(red.ok).toBe(false);
    expect(red.failures.some((failure) => failure.code === "mold-safety")).toBe(true);

    const restored = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(restored.ok).toBe(true);
    expect(restored.failures).toEqual([]);
  });

  it("mutation 5: emptying registry origin and note fails closed", () => {
    const baseline = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(baseline.ok).toBe(true);

    const mutatedRegistry = cloneRegistry();
    const target = mutatedRegistry["bp:business-profile"];
    if (!target) throw new Error("missing business-profile source");
    mutatedRegistry["bp:business-profile"] = { ...target, origin: "", note: "" };
    const red = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, {
      today: TODAY,
      sourceRegistry: mutatedRegistry
    });
    expect(red.ok).toBe(false);
    expect(red.failures.some((failure) => failure.code === "source-provenance")).toBe(true);

    const restored = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(restored.ok).toBe(true);
    expect(restored.failures).toEqual([]);
  });

  it("mutation 6: removing publish_state fails closed instead of shrinking silently", () => {
    const baseline = resolveAcceptedIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(baseline).toHaveLength(
      INDEX_GROWTH_CATALOG.filter((page) => page.publish_state === "accepted").length
    );

    const mutated = INDEX_GROWTH_CATALOG.map((page) => {
      if (page.slug !== "rainy-bag-care") return page;
      const { publish_state: _dropped, ...rest } = page;
      return rest;
    });
    const red = validateIndexGrowthPages(mutated, { today: TODAY });
    expect(red.ok).toBe(false);
    expect(red.failures.some((failure) => failure.code === "publish-state")).toBe(true);
    expect(() => resolveAcceptedIndexGrowthPages(mutated, { today: TODAY })).toThrow(/publish-state/);

    const restored = resolveAcceptedIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(restored).toHaveLength(baseline.length);
    expect(validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY }).ok).toBe(true);
  });

  it("mutation 7: in-place rebind of cloned catalog existing refs fails closed", () => {
    const baseline = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(baseline.ok).toBe(true);

    const cloned = INDEX_GROWTH_CATALOG.map((page) => ({ ...page }));
    const target = cloned.find((page) => page.slug === "suede-shoe-cleaning");
    const refs = target?.citation_source_refs;
    if (!target || !refs?.length) throw new Error("missing citation refs");
    const original = refs[0];
    const rebound = Object.keys(INDEX_GROWTH_SOURCE_REGISTRY).find((ref) => !refs.includes(ref));
    if (!original || !rebound) throw new Error("need another legal registry ref");
    refs[0] = rebound;
    try {
      const red = validateIndexGrowthPages(cloned, { today: TODAY });
      expect(red.ok).toBe(false);
      expect(red.failures.some((failure) => failure.code === "claim-provenance")).toBe(true);
    } finally {
      refs[0] = original;
    }

    const restored = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(restored.ok).toBe(true);
    expect(restored.failures).toEqual([]);
  });

  it("mutation 8: forging origin/note and recomputing self-hash still fails closed", () => {
    const baseline = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(baseline.ok).toBe(true);

    const mutatedRegistry = cloneRegistry();
    const target = mutatedRegistry["bp:business-profile"];
    if (!target) throw new Error("missing business-profile source");
    const forged = {
      ...target,
      origin: "https://forged.example/business-profile",
      note: "Forged but non-empty locator and summary."
    };
    mutatedRegistry["bp:business-profile"] = {
      ...forged,
      content_hash: frozenSourceRecordHash(forged)
    };
    const red = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, {
      today: TODAY,
      sourceRegistry: mutatedRegistry
    });
    expect(red.ok).toBe(false);
    expect(red.failures.some((failure) => failure.code === "source-provenance")).toBe(true);

    const restored = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(restored.ok).toBe(true);
    expect(restored.failures).toEqual([]);
  });

  it("mutation 9: mold negation is local-only; lock-updated danger red, safe negation green", () => {
    const baseline = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(baseline.ok).toBe(true);

    const lock = PROTECTED_INDEX_GROWTH_LOCKS["clothing-mold-airing"];
    if (!lock) throw new Error("missing clothing-mold lock");
    const originalHash = lock.body_hash;

    const dangerCatalog = INDEX_GROWTH_CATALOG.map((page) =>
      page.slug === "clothing-mold-airing"
        ? {
            ...page,
            faqs: page.faqs.map((faq, index) =>
              index === 0
                ? { ...faq, answer: "不要直接濕擦；請拿到戶外抖掉霉屑，再觀察斑點。" }
                : faq
            )
          }
        : page
    );
    const dangerPage = dangerCatalog.find((page) => page.slug === "clothing-mold-airing");
    if (!dangerPage) throw new Error("missing clothing-mold page");
    lock.body_hash = protectedSupportContentHash(dangerPage);
    try {
      const red = validateIndexGrowthPages(dangerCatalog, { today: TODAY });
      expect(red.ok).toBe(false);
      expect(red.failures.some((failure) => failure.code === "mold-safety")).toBe(true);
      expect(
        red.failures.some(
          (failure) =>
            failure.code === "protected-content-hash" && failure.slugs?.includes("clothing-mold-airing")
        )
      ).toBe(false);
    } finally {
      lock.body_hash = originalHash;
    }

    const safeCatalog = INDEX_GROWTH_CATALOG.map((page) =>
      page.slug === "clothing-mold-airing"
        ? {
            ...page,
            faqs: page.faqs.map((faq, index) =>
              index === 0
                ? { ...faq, answer: "色斑不一定能恢復，門市也不保證恢復，只能先評估。" }
                : faq
            )
          }
        : page
    );
    const safePage = safeCatalog.find((page) => page.slug === "clothing-mold-airing");
    if (!safePage) throw new Error("missing clothing-mold page");
    lock.body_hash = protectedSupportContentHash(safePage);
    try {
      const green = validateIndexGrowthPages(safeCatalog, { today: TODAY });
      expect(green.failures.filter((failure) => failure.code === "mold-safety")).toEqual([]);
      expect(green.ok).toBe(true);
    } finally {
      lock.body_hash = originalHash;
    }

    const restored = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(restored.ok).toBe(true);
    expect(restored.failures).toEqual([]);
  });

  it("mutation 10: accepted projection comes from the single resolver path", () => {
    const validated = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(validated.ok).toBe(true);
    const acceptedCount = INDEX_GROWTH_CATALOG.filter((page) => page.publish_state === "accepted").length;
    const projection = resolveAcceptedIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(projection).toHaveLength(acceptedCount);

    const withDraft = INDEX_GROWTH_CATALOG.map((page) =>
      page.slug === "rainy-bag-care" ? { ...page, publish_state: "draft" as const } : page
    );
    const draftProjection = resolveAcceptedIndexGrowthPages(withDraft, { today: TODAY });
    expect(draftProjection.some((page) => page.slug === "rainy-bag-care")).toBe(false);
    expect(draftProjection).toHaveLength(acceptedCount - 1);

    const missingState = INDEX_GROWTH_CATALOG.map((page) => {
      if (page.slug !== "rainy-bag-care") return page;
      const { publish_state: _dropped, ...rest } = page;
      return rest;
    });
    expect(() => resolveAcceptedIndexGrowthPages(missingState, { today: TODAY })).toThrow(/publish-state/);
  });

  it("mutation 11: swapping two valid registry records fails closed on identity", () => {
    const baseline = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(baseline.ok).toBe(true);

    const mutatedRegistry = cloneRegistry();
    const leftKey = "bp:business-profile";
    const rightKey = "svc:shoe-bag-care";
    const left = mutatedRegistry[leftKey];
    const right = mutatedRegistry[rightKey];
    if (!left || !right) throw new Error("need two valid registry records");
    expect(left.id).toBe(leftKey);
    expect(right.id).toBe(rightKey);
    expect(left.content_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(right.content_hash).toMatch(/^[a-f0-9]{64}$/u);
    mutatedRegistry[leftKey] = right;
    mutatedRegistry[rightKey] = left;

    const red = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, {
      today: TODAY,
      sourceRegistry: mutatedRegistry
    });
    expect(red.ok).toBe(false);
    expect(red.failures.some((failure) => failure.code === "source-provenance")).toBe(true);

    const restored = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(restored.ok).toBe(true);
    expect(restored.failures).toEqual([]);
  });

  it("mutation 12: next-day accepted lastmod with revised lock uses explicit today", () => {
    const baseline = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(baseline.ok).toBe(true);

    const slug = "rainy-bag-care";
    const lock = PROTECTED_INDEX_GROWTH_LOCKS[slug];
    if (!lock) throw new Error("missing rainy-bag lock");
    const originalRevision = lock.content_revision;
    const originalHash = lock.body_hash;
    const nextDay = "2026-09-04";
    const priorDay = "2026-09-03";
    const updatedCatalog = INDEX_GROWTH_CATALOG.map((page) =>
      page.slug === slug
        ? {
            ...page,
            publish_state: "accepted" as const,
            content_lastmod: nextDay,
            content_revision: `${nextDay}#1`
          }
        : page
    );
    const updatedPage = updatedCatalog.find((page) => page.slug === slug);
    if (!updatedPage) throw new Error("missing rainy-bag page");
    expect(updatedPage.publish_state).toBe("accepted");
    lock.content_revision = `${nextDay}#1`;
    lock.body_hash = protectedSupportContentHash(updatedPage);
    try {
      const green = validateIndexGrowthPages(updatedCatalog, { today: nextDay });
      expect(green.failures, JSON.stringify(green.failures, null, 2)).toEqual([]);
      expect(green.ok).toBe(true);
      const projection = resolveAcceptedIndexGrowthPages(updatedCatalog, { today: nextDay });
      expect(projection.some((page) => page.slug === slug && page.content_lastmod === nextDay)).toBe(true);

      const red = validateIndexGrowthPages(updatedCatalog, { today: priorDay });
      expect(red.ok).toBe(false);
      expect(
        red.failures.some(
          (failure) => failure.code === "volatile-lastmod" && failure.slugs?.includes(slug)
        )
      ).toBe(true);
    } finally {
      lock.content_revision = originalRevision;
      lock.body_hash = originalHash;
    }

    const restored = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(restored.ok).toBe(true);
    expect(restored.failures).toEqual([]);
  });

  it("mutation 13: removing citation_answer from accepted shoe-odor-source fails closed via resolver", () => {
    const baseline = resolveAcceptedIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(baseline.some((page) => page.slug === "shoe-odor-source" && Boolean(page.citation_answer))).toBe(
      true
    );

    const mutated = INDEX_GROWTH_CATALOG.map((page) => {
      if (page.slug !== "shoe-odor-source") return page;
      const { citation_answer: _dropped, ...rest } = page;
      return rest;
    });
    expect(mutated.find((page) => page.slug === "shoe-odor-source")?.publish_state).toBe("accepted");
    expect(() => resolveAcceptedIndexGrowthPages(mutated, { today: TODAY })).toThrow(/citation-fallback/);

    const restored = resolveAcceptedIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY });
    expect(restored.some((page) => page.slug === "shoe-odor-source" && Boolean(page.citation_answer))).toBe(
      true
    );
    expect(validateIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: TODAY }).ok).toBe(true);
  });
});
