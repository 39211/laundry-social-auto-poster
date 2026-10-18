import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

function hasSlugPathSegment(pathname: string, slug: string): boolean {
  const expectedSegments = new Set([slug, `${slug}.html`, `${slug}.htm`]);
  return pathname.toLowerCase().split("/").some((segment) => expectedSegments.has(segment));
}

function faqFromJsonLd(html: string): Array<{ question: string; answer: string }> {
  const scripts = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const faqPage = scripts
    .map((match) => JSON.parse(match[1] ?? "{}") as { "@graph"?: Array<Record<string, unknown>>; "@type"?: string; mainEntity?: unknown[] })
    .flatMap((value) => value["@graph"] ?? [value])
    .find((value) => value["@type"] === "FAQPage");
  const mainEntity = faqPage?.mainEntity;
  if (!Array.isArray(mainEntity)) return [];
  return mainEntity.map((value) => {
    const entry = value as { name: string; acceptedAnswer: { text: string } };
    return { question: entry.name, answer: entry.acceptedAnswer.text };
  });
}

async function withTemporaryDocs(callback: (root: string, docsRoot: string) => Promise<void>): Promise<void> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "aeo325-guardrail-"));
  const docsRoot = join(temporaryRoot, "docs");
  await mkdir(docsRoot, { recursive: true });
  try {
    await callback(temporaryRoot, docsRoot);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function writeOutput(docsRoot: string, path: string, contents: string | Buffer): Promise<void> {
  const outputPath = join(docsRoot, path);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, contents);
}

async function nonExemptUnapprovedSlug(api: GuardrailModule): Promise<string> {
  const config = await api.loadAeo325Guardrail(root);
  const approvedIds = new Set(config.approvals.filter((row) => row.approved).map((row) => row.ID));
  const item = config.items.find((candidate) => !approvedIds.has(candidate.id) && !config.preExistingSlugs.includes(candidate.slug));
  if (!item) throw new Error("Expected a non-exempt unapproved AEO325 slug");
  return item.slug;
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

  it("keeps public sitemap and feed URLs free of new AEO325 slugs and preserves target URL expectations", async () => {
    const api = await guardrail();
    const config = await api.loadAeo325Guardrail(root);
    const approvedIds = new Set(config.approvals.filter((row) => row.approved).map((row) => row.ID));
    const unapprovedSlugs = config.items
      .filter((item) => !approvedIds.has(item.id) && !config.preExistingSlugs.includes(item.slug))
      .map((item) => item.slug.toLowerCase());

    const urlSets = new Map<string, string[]>();
    for (const file of ["sitemap.xml", "ai-sitemap.xml", "rss.xml"]) {
      const urls = urlSet(await readFile(join(root, "docs", file), "utf8"), file);
      urlSets.set(file, urls);
      const paths = urls.map((url) => new URL(url).pathname.toLowerCase());
      for (const slug of unapprovedSlugs) {
        expect(paths.some((pathname) => hasSlugPathSegment(pathname, slug)), `${file} excludes ${slug}`).toBe(false);
      }
    }

    const targetPaths = new Set([
      "/services/white-shoe-cleaning.html",
      "/guides/white-shoe-yellowing.html",
      "/services/luxury-bag-cleaning.html",
      "/guides/luxury-bag-mold.html",
      "/services/down-jacket-cleaning.html",
      "/guides/down-jacket-cleaning.html"
    ]);
    const expectedTargetPaths: Record<string, string[]> = {
      "sitemap.xml": [
        "/services/white-shoe-cleaning.html",
        "/guides/white-shoe-yellowing.html",
        "/services/luxury-bag-cleaning.html",
        "/guides/luxury-bag-mold.html",
        "/guides/down-jacket-cleaning.html"
      ],
      "ai-sitemap.xml": [
        "/services/white-shoe-cleaning.html",
        "/guides/white-shoe-yellowing.html",
        "/guides/luxury-bag-mold.html",
        "/guides/down-jacket-cleaning.html"
      ]
    };
    for (const [file, expectedPaths] of Object.entries(expectedTargetPaths)) {
      const urls = urlSets.get(file) ?? [];
      const actualTargets = urls.map((url) => new URL(url).pathname).filter((path) => targetPaths.has(path));
      expect(actualTargets.sort(), `${file} target URL presence`).toEqual([...expectedPaths].sort());
    }
  });

  it("does not match a slug substring inside a dated feature-post path", () => {
    const slug = "unapproved-special-cleaning";
    const featurePostPath = `/posts/2026-10-19-feature-${slug}.html`;

    expect(hasSlugPathSegment(featurePostPath, slug)).toBe(false);
    expect(hasSlugPathSegment(`/services/${slug}`, slug)).toBe(true);
    expect(hasSlugPathSegment(`/services/${slug}.html`, slug)).toBe(true);
    expect(hasSlugPathSegment(`/services/${slug}.htm`, slug)).toBe(true);
  });

  it.each([
    {
      id: "01 binary path token",
      path: (slug: string) => `assets/${slug}.png`,
      contents: () => Buffer.from("binary payload", "utf8"),
      shouldReject: true
    },
    {
      id: "02 JavaScript path token",
      path: (slug: string) => `${slug}.js`,
      contents: () => "// no slug in content",
      shouldReject: true
    },
    {
      id: "03 HTM path token",
      path: (slug: string) => `services/${slug}.htm`,
      contents: () => "<!-- no slug in content -->",
      shouldReject: true
    },
    {
      id: "04 fetch JSON URL",
      path: () => "scripts/fetch.js",
      contents: (slug: string) => `fetch("/answers/${slug}.json")`,
      shouldReject: true
    },
    {
      id: "05 CSS image URL",
      path: () => "styles/images.css",
      contents: (slug: string) => `background-image: url('/img/${slug}.webp')`,
      shouldReject: true
    },
    {
      id: "06 newline URL boundary",
      path: () => "no-extension",
      contents: (slug: string) => `see /services/${slug}\n`,
      shouldReject: true
    },
    {
      id: "07 encoded URL in HTML",
      path: () => "pages/share.html",
      contents: (slug: string) => `?url=https%3A%2F%2Fsixiangjialaundry.com%2Fservices%2F${slug}.html`,
      shouldReject: true
    },
    {
      id: "08 encoded URL in JavaScript",
      path: () => "scripts/share.js",
      contents: (slug: string) => `const url = "https%3A%2F%2Fsixiangjialaundry.com%2Fservices%2F${slug}.html";`,
      shouldReject: true
    },
    {
      id: "09 uppercase URL",
      path: () => "scripts/uppercase.js",
      contents: (slug: string) => `fetch("/Services/${slug[0]?.toUpperCase()}${slug.slice(1)}.HTML")`,
      shouldReject: true
    },
    {
      id: "10 bare CSS class token",
      path: () => "styles/classes.css",
      contents: (slug: string) => `.${slug}-card{}`,
      shouldReject: false
    },
    {
      id: "11 exempt slug path",
      path: () => "guides/down-vest-cleaning.html",
      contents: () => "",
      shouldReject: false
    }
  ])("r4 scanner case $id", async ({ id, path, contents, shouldReject }) => {
    const api = await guardrail();
    const slug = await nonExemptUnapprovedSlug(api);
    const outputPath = path(slug);
    await withTemporaryDocs(async (temporaryRoot, docsRoot) => {
      await writeOutput(docsRoot, outputPath, contents(slug));
      const check = api.assertAeo325PublicOutputSafety(temporaryRoot, root);
      if (shouldReject) {
        await expect(check, id).rejects.toThrow(`unapproved AEO325 slug ${slug} appears in public output docs/${outputPath}`);
      } else {
        await expect(check, id).resolves.toBeUndefined();
      }
    });
  });

  it.each([
    { path: "scripts/x.js", contents: (slug: string) => `fetch("/${slug}")` },
    { path: "styles/x.css", contents: (slug: string) => `background-image: url('/${slug}')` },
    { path: "img/x.svg", contents: (slug: string) => `<use href="/${slug}.html" />` },
    { path: "a/b/c.htm", contents: (slug: string) => `<a href="/${slug}?source=guardrail">` },
    { path: "no-extension", contents: (slug: string) => `https://example.com/${slug}.html` },
    { path: "site.webmanifest", contents: (slug: string) => `{"start_url":"/${slug}"}` }
  ])("scans public output path $path for unapproved URL shapes", async ({ path, contents }) => {
    const api = await guardrail();
    const slug = await nonExemptUnapprovedSlug(api);
    await withTemporaryDocs(async (temporaryRoot, docsRoot) => {
      await writeOutput(docsRoot, path, contents(slug));
      await expect(api.assertAeo325PublicOutputSafety(temporaryRoot, root)).rejects.toThrow(
        `unapproved AEO325 slug ${slug} appears in public output docs/${path}`
      );
    });
  });

  it("does not read binary blacklisted outputs when they contain slug bytes", async () => {
    const api = await guardrail();
    const slug = await nonExemptUnapprovedSlug(api);
    await withTemporaryDocs(async (temporaryRoot, docsRoot) => {
      await writeOutput(docsRoot, "assets/slug.png", Buffer.from(`\u0000${slug}\u0000`, "utf8"));
      await expect(api.assertAeo325PublicOutputSafety(temporaryRoot, root)).resolves.toBeUndefined();
    });
  });

  it("does not reject a bare slug used as a CSS class name", async () => {
    const api = await guardrail();
    const slug = await nonExemptUnapprovedSlug(api);
    await withTemporaryDocs(async (temporaryRoot, docsRoot) => {
      await writeOutput(docsRoot, "styles/classes.css", `.${slug} { color: red; }`);
      await expect(api.assertAeo325PublicOutputSafety(temporaryRoot, root)).resolves.toBeUndefined();
    });
  });

  it("allows the established exempt slug in a JavaScript URL shape", async () => {
    const api = await guardrail();
    await withTemporaryDocs(async (temporaryRoot, docsRoot) => {
      await writeOutput(docsRoot, "scripts/legacy.js", 'fetch("/down-vest-cleaning.html")');
      await expect(api.assertAeo325PublicOutputSafety(temporaryRoot, root)).resolves.toBeUndefined();
    });
  });

  it("follows Windows directory junctions and stops when a junction loops to an already visited directory", async ({ skip }) => {
    if (process.platform !== "win32") {
      skip();
      return;
    }

    const temporaryRoot = await mkdtemp(join(tmpdir(), "aeo325-guardrail-junction-"));
    const docsRoot = join(temporaryRoot, "docs");
    const externalDirectory = join(temporaryRoot, "linked-output");
    const outputJunction = join(docsRoot, "linked");
    const loopJunction = join(externalDirectory, "back-to-docs");
    const createdJunctions: string[] = [];
    try {
      const api = await guardrail();
      const slug = await nonExemptUnapprovedSlug(api);
      await mkdir(docsRoot, { recursive: true });
      await mkdir(externalDirectory, { recursive: true });
      await writeOutput(externalDirectory, "leak.js", `fetch("/${slug}")`);
      try {
        await symlink(externalDirectory, outputJunction, "junction");
        createdJunctions.push(outputJunction);
        await symlink(docsRoot, loopJunction, "junction");
        createdJunctions.push(loopJunction);
      } catch (error) {
        skip(`Windows junction creation unavailable: ${String(error)}`);
        return;
      }
      await expect(api.assertAeo325PublicOutputSafety(temporaryRoot, root)).rejects.toThrow(
        `unapproved AEO325 slug ${slug} appears in public output docs/linked/leak.js`
      );
    } finally {
      for (const junction of createdJunctions) await unlink(junction);
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("allows only the two legacy slugs anywhere and rejects every other unapproved slug", async () => {
    const api = await guardrail();
    const config = await api.loadAeo325Guardrail(root);

    expect([...config.preExistingSlugs].sort()).toEqual([
      "down-vest-cleaning",
      "gore-tex-jacket-cleaning"
    ]);

    await expect(api.assertAeo325PublicOutputSafety(root)).resolves.toBeUndefined();
    const legacyOutputs = [
      { path: "docs/new-page.html", contents: "down-vest-cleaning ".repeat(40) },
      { path: "docs/another-new-file.json", contents: "gore-tex-jacket-cleaning" }
    ];
    expect(() => api.assertNoUnapprovedAeo325Slugs(
      config.items,
      config.approvals,
      legacyOutputs,
      config.preExistingSlugs
    )).not.toThrow();
    const nonExemptSlug = config.items.find((item) => !config.preExistingSlugs.includes(item.slug))?.slug;
    expect(nonExemptSlug).toBeDefined();
    if (!nonExemptSlug) throw new Error("Expected a non-exempt unapproved AEO325 slug");
    expect(() => api.assertNoUnapprovedAeo325Slugs(
      config.items,
      config.approvals,
      [{ path: "docs/new-page.html", contents: nonExemptSlug }],
      config.preExistingSlugs
    )).toThrow(nonExemptSlug);
  }, 30000);

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
