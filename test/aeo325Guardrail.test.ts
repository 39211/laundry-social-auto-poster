import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type GuardrailModule = typeof import("../src/aeo325Guardrail");

async function guardrail(): Promise<GuardrailModule> {
  const module = await import("../src/aeo325Guardrail").catch(() => undefined);
  expect(module, "AEO325 guardrail module must exist before its behavior can be exercised").toBeDefined();
  return module as GuardrailModule;
}

const root = process.cwd();
const ITEM_UNAPPROVED = { id: "sxj_001", slug: "unapproved-special-cleaning", draft_url: "https://example.com/services/unapproved-special-cleaning.html" };
const ITEM_APPROVED = { id: "sxj_002", slug: "approved-special-cleaning", draft_url: "https://example.com/services/approved-special-cleaning.html" };

function approval(
  ID: string,
  values: Partial<{
    approved: boolean;
    approved_by: string | null;
    approved_at: string | null;
    page_mapping: string | null;
    index_eligible: boolean;
  }> = {}
) {
  return {
    ID,
    approved: false,
    approved_by: null,
    approved_at: null,
    page_mapping: null,
    index_eligible: false,
    ...values
  };
}

const twoItems = [ITEM_UNAPPROVED, ITEM_APPROVED];
const twoApprovals = [
  approval("sxj_001"),
  approval("sxj_002", {
    approved: true,
    approved_by: "店主",
    approved_at: "2026-10-18T20:00:00+08:00",
    page_mapping: "https://example.com/services/approved-special-cleaning.html",
    index_eligible: false
  })
];

function urlSet(source: string, file: string): string[] {
  const decode = (value: string) => value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
  const values = file === "rss.xml"
    ? source
        .split("<link>")
        .slice(1)
        .map((part) => part.split("</link>")[0] ?? "")
        .concat(source.split('<atom:link href="').slice(1).map((part) => part.split('"')[0] ?? ""))
    : source.split("<loc>").slice(1).map((part) => part.split("</loc>")[0] ?? "");
  return [...new Set(values.map((value) => decode(value.trim())).filter((value) => value.startsWith("http")))].sort();
}

function faqFromJsonLd(html: string): Array<{ question: string; answer: string }> {
  const scripts = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const faqPage = scripts
    .map((match) => JSON.parse(match[1] ?? "{}") as { "@graph"?: Array<Record<string, unknown>>; "@type"?: string; mainEntity?: unknown[] })
    .flatMap((value) => value["@graph"] ?? [value])
    .find((value) => value["@type"] === "FAQPage");
  return (faqPage?.mainEntity ?? []).map((value) => {
    const entry = value as { name: string; acceptedAnswer: { text: string } };
    return { question: entry.name, answer: entry.acceptedAnswer.text };
  });
}

function faqFromVisibleHtml(html: string): Array<{ question: string; answer: string }> {
  const section = html.match(/<section\b[^>]*id=["']faq["'][^>]*>([\s\S]*?)<\/section>/i)?.[1] ?? "";
  const decode = (value: string) => value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
  return [...section.matchAll(/<h3>([\s\S]*?)<\/h3>[\s\S]*?<p>([\s\S]*?)<\/p>/gi)].map((match) => ({
    question: decode((match[1] ?? "").replace(/<[^>]*>/g, "").trim()),
    answer: decode((match[2] ?? "").replace(/<[^>]*>/g, "").trim())
  }));
}

describe("AEO325 publication guardrail", () => {
  it("loads the 325-row approval register with every row closed by default", async () => {
    const api = await guardrail();
    const config = await api.loadAeo325Guardrail(root);

    expect(config.items).toHaveLength(325);
    expect(new Set(config.items.map((item) => item.slug)).size).toBe(325);
    expect(config.approvals).toHaveLength(325);
    expect(config.approvals.every((row) => row.approved === false && row.index_eligible === false && row.page_mapping === null)).toBe(true);
  });

  it.each([
    "HTML",
    "Service JSON-LD",
    "FAQ JSON-LD",
    "AI data",
    "feed",
    "sitemap",
    "internal link"
  ])("rejects an unapproved slug in %s output", async (surface) => {
    const api = await guardrail();
    const contents = surface === "HTML" ? `<h1>${ITEM_UNAPPROVED.slug}</h1>` : `https://example.com/services/${ITEM_UNAPPROVED.slug}.html`;

    expect(() =>
      api.assertNoUnapprovedAeo325Slugs(twoItems, twoApprovals, [{ path: `docs/${surface}.html`, contents }])
    ).toThrow(ITEM_UNAPPROVED.slug);
  });

  it("rejects an approved row without approver or ISO timestamp", async () => {
    const api = await guardrail();
    const missingApprover = [approval("sxj_001", { approved: true, approved_at: "2026-10-18T20:00:00+08:00", page_mapping: "https://example.com/services/unapproved-special-cleaning.html" })];
    const missingTime = [approval("sxj_001", { approved: true, approved_by: "店主", page_mapping: "https://example.com/services/unapproved-special-cleaning.html" })];

    expect(() => api.validateAeo325Approvals([ITEM_UNAPPROVED], missingApprover)).toThrow(/approved_by/);
    expect(() => api.validateAeo325Approvals([ITEM_UNAPPROVED], missingTime)).toThrow(/approved_at/);
  });

  it("allows approved body records while keeping index-ineligible records out of the sitemap", async () => {
    const api = await guardrail();
    const body = api.filterAeo325OutputRecords(twoItems, twoApprovals, [
      { ID: "sxj_001", text: "unapproved" },
      { ID: "sxj_002", text: "approved body" }
    ], "html");
    const sitemap = api.filterAeo325SitemapCandidates(twoItems, twoApprovals, [
      {
        ID: "sxj_002",
        url: "https://example.com/services/approved-special-cleaning.html",
        canonical: "https://example.com/services/approved-special-cleaning.html",
        noindex: false,
        redirect: false
      }
    ]);

    expect(body.map((record) => record.ID)).toEqual(["sxj_002"]);
    expect(sitemap).toEqual([]);
  });

  it("does not restore a mapped URL to sitemap when its canonical points elsewhere", async () => {
    const api = await guardrail();
    const approvedAndIndexEligible = [approval("sxj_002", {
      approved: true,
      approved_by: "店主",
      approved_at: "2026-10-18T20:00:00+08:00",
      page_mapping: "https://example.com/services/approved-special-cleaning.html",
      index_eligible: true
    })];
    const result = api.filterAeo325SitemapCandidates([ITEM_APPROVED], approvedAndIndexEligible, [{
      ID: "sxj_002",
      url: "https://example.com/services/approved-special-cleaning.html",
      canonical: "https://example.com/guides/approved-special-cleaning.html",
      noindex: false,
      redirect: false
    }]);

    expect(result).toEqual([]);
  });

  it("does not restore noindex or redirect targets to sitemap", async () => {
    const api = await guardrail();
    const approvedAndIndexEligible = [approval("sxj_002", {
      approved: true,
      approved_by: "店主",
      approved_at: "2026-10-18T20:00:00+08:00",
      page_mapping: "https://example.com/services/approved-special-cleaning.html",
      index_eligible: true
    })];
    const candidates = [
      {
        ID: "sxj_002",
        url: "https://example.com/services/approved-special-cleaning.html",
        canonical: "https://example.com/services/approved-special-cleaning.html",
        noindex: true,
        redirect: false
      },
      {
        ID: "sxj_002",
        url: "https://example.com/services/approved-special-cleaning.html",
        canonical: "https://example.com/services/approved-special-cleaning.html",
        noindex: false,
        redirect: true
      }
    ];

    expect(api.filterAeo325SitemapCandidates([ITEM_APPROVED], approvedAndIndexEligible, candidates)).toEqual([]);
  });

  it("fails closed for duplicate, missing, and unknown approval IDs", async () => {
    const api = await guardrail();
    expect(() => api.validateAeo325Approvals([ITEM_UNAPPROVED], [approval("sxj_001"), approval("sxj_001")])).toThrow(/duplicate/i);
    expect(() => api.validateAeo325Approvals([ITEM_UNAPPROVED, ITEM_APPROVED], [approval("sxj_001")])).toThrow(/missing/i);
    expect(() => api.validateAeo325Approvals([ITEM_UNAPPROVED], [approval("sxj_999")])).toThrow(/unknown/i);
  });

  it("filters an unapproved FAQ without dropping an approved FAQ on the same page", async () => {
    const api = await guardrail();
    const result = api.filterAeo325OutputRecords(twoItems, twoApprovals, [
      { ID: "sxj_001", question: "unapproved question", answer: "unapproved answer" },
      { ID: "sxj_002", question: "approved question", answer: "approved answer" }
    ], "faq-jsonld");

    expect(result).toEqual([{ ID: "sxj_002", question: "approved question", answer: "approved answer" }]);
  });

  it("keeps the established sitemap, AI sitemap, and RSS URL sets unchanged", async () => {
    const baseline = JSON.parse(await readFile(join(root, "config/aeo325/public-url-baseline.json"), "utf8")) as {
      files: Record<string, { count: number; sha256: string }>;
    };

    for (const file of ["sitemap.xml", "ai-sitemap.xml", "rss.xml"]) {
      const urls = urlSet(await readFile(join(root, "docs", file), "utf8"), file);
      const digest = createHash("sha256").update(`${urls.join("\n")}\n`).digest("hex");
      expect(urls).toHaveLength(baseline.files[file]?.count);
      expect(digest).toBe(baseline.files[file]?.sha256);
    }
  });

  it("keeps visible FAQs and FAQ JSON-LD text identical on all managed page copies", async () => {
    const pages = [
      "services/white-shoe-cleaning.html",
      "guides/white-shoe-yellowing.html",
      "services/luxury-bag-cleaning.html",
      "guides/luxury-bag-mold.html",
      "services/down-jacket-cleaning.html",
      "guides/down-jacket-cleaning.html"
    ];

    for (const page of pages) {
      const html = await readFile(join(root, "docs", page), "utf8");
      expect(faqFromVisibleHtml(html), page).toEqual(faqFromJsonLd(html));
    }
  });
});
