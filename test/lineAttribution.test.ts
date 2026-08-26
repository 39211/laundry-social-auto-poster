import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  buildLineRedirectHtml,
  generatePublicSite,
  lineSourceSlug,
  listLineTouchpoints
} from "../src/generatePublicSite";

const REPO_ROOT = process.cwd();
const REPORT_SCRIPT = join(REPO_ROOT, "scripts", "line-attribution-report.ps1");
const LINE_ME = "https://line.me/ti/p/4m-rA6hxf6";

async function writeBusinessProfile(root: string): Promise<void> {
  await mkdir(join(root, "data"), { recursive: true });
  const profile = await readFile(join(REPO_ROOT, "data", "business-profile.json"), "utf8");
  await writeFile(join(root, "data", "business-profile.json"), profile, "utf8");
}

async function writeCalendar(root: string, date: string): Promise<void> {
  await Promise.all([
    mkdir(join(root, "data", "content-calendar"), { recursive: true }),
    mkdir(join(root, "docs", "content-calendar"), { recursive: true })
  ]);
  const calendar = `${JSON.stringify(
    {
      date,
      timezone: "Asia/Taipei",
      generated_at: `${date}T00:00:00.000Z`,
      slots: [
        {
          slot: 1,
          time: "11:30",
          category: "knowledge",
          topic: "Sneaker edge inspection",
          instagram_caption: "IG caption #test",
          facebook_caption: "FB caption #test",
          image_prompt: "photo prompt",
          visual_route: "shop-inspection",
          traffic_route: "object-proof",
          search_intent: "problem-diagnosis",
          target_queries: ["台中洗鞋店"],
          evidence_type: "first-party-inspection",
          local_image_path: `docs/assets/${date}/slot-01.png`,
          public_image_url: "",
          status: "pending"
        }
      ]
    },
    null,
    2
  )}\n`;
  await Promise.all([
    writeFile(join(root, "data", "content-calendar", `${date}.json`), calendar, "utf8"),
    writeFile(join(root, "docs", "content-calendar", `${date}.json`), calendar, "utf8")
  ]);
}

async function writeApprovalLog(root: string, date: string): Promise<void> {
  await mkdir(join(root, "data", "approved-log"), { recursive: true });
  const entries = (["facebook", "instagram"] as const).map((platform) => ({
    date,
    slot: 1,
    platform,
    status: "approved",
    approved_by: "Test",
    note: "Approved for public SEO sync",
    created_at: `${date}T02:20:00.000Z`
  }));
  await writeFile(join(root, "data", "approved-log", `${date}.json`), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1] ?? "");
}

function findBareLineMeHrefs(html: string): string[] {
  return hrefs(html).filter((href) => /line\.me/i.test(href));
}

function findLineRedirectHrefs(html: string): string[] {
  return hrefs(html).filter((href) => /\/go\/line\.html/i.test(href));
}

function lineRedirectContractHolds(html: string): boolean {
  const sendsEvent = /gtag\(\s*['"]event['"]\s*,\s*['"]line_click['"]/u.test(html);
  const hasLinkSource = /link_source\s*:/.test(html);
  const hasReferrer = /page_referrer\s*:/.test(html);
  const hasNoscript = /<noscript>[\s\S]*http-equiv=["']refresh["'][\s\S]*<\/noscript>/i.test(html);
  const stillRedirects = /location\.replace\(destination\)/.test(html);
  // GA4's registered dimension is customEvent:source, so link_source alone
  // leaves the breakdown empty if the property is ever re-mapped; both names
  // ship. And a source that can be empty is a click nobody can learn from:
  // 2026-08-26 held three line_clicks with an empty source, so the value now
  // falls back to the referrer and then to a literal, never to nothing.
  const hasSourceAlias = /(^|[^_\w])source\s*:\s*source/m.test(html);
  const neverEmpty = /params\.get\(['"]source['"]\)\s*\|\|[\s\S]{0,80}\|\|\s*['"]unknown['"]/u.test(html);
  return (
    sendsEvent && hasLinkSource && hasReferrer && hasNoscript && stillRedirects && hasSourceAlias && neverEmpty
  );
}

async function collectCustomerHtml(docsRoot: string): Promise<Map<string, string>> {
  const pages = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.name.endsWith(".html")) continue;
      const rel = full.slice(docsRoot.length + 1).replaceAll("\\", "/");
      if (rel === "go/line.html") continue;
      pages.set(rel, await readFile(full, "utf8"));
    }
  }
  await walk(docsRoot);
  return pages;
}

function runReport(args: string[]): { status: number; stdout: string; stderr: string } {
  // -ExecutionPolicy Bypass matches how every scheduled wrapper invokes its
  // scripts on this machine; without it the policy blocks the file outright
  // and all three assertions fail on the same UnauthorizedAccess error.
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", REPORT_SCRIPT, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: `${result.stderr ?? ""}${result.error ? String(result.error) : ""}`
  };
}

describe("line source slug", () => {
  it("composes page + placement and keeps the ticket examples", () => {
    expect(lineSourceSlug({ section: "guide", slug: "rainy-shoe-care", placement: "cta" })).toBe(
      "guide-rainy-shoe-care-cta"
    );
    expect(lineSourceSlug({ section: "home", placement: "footer" })).toBe("footer");
    expect(lineSourceSlug({ section: "services", slug: "shoe-bag-care", placement: "cta" })).toBe(
      "services-shoe-bag-care-cta"
    );
    expect(lineSourceSlug({ section: "home", placement: "cta" })).toBe("home-cta");
    expect(lineSourceSlug({ section: "posts", date: "2026-07-02", slot: 1, placement: "nav" })).toBe(
      "posts-2026-07-02-slot-01-nav"
    );
    expect(lineSourceSlug({ section: "local", slug: "qinghai-road-shoe-cleaning", placement: "inline" })).toBe(
      "local-qinghai-road-shoe-cleaning-inline"
    );
  });
});

describe("line redirect page", () => {
  it("emits line_click with link_source + page_referrer and a noscript fallback", () => {
    const html = buildLineRedirectHtml({ lineUrl: LINE_ME, measurementId: "G-TESTMEASURE1" });
    expect(lineRedirectContractHolds(html)).toBe(true);
    expect(html).toContain(LINE_ME);
    expect(html).toContain("params.get('source')");
    expect(html).toContain("G-TESTMEASURE1");
    expect(html).toMatch(/typeof window\.gtag === 'function'/);
    expect(html).toContain("catch (err)");
  });

  it("still redirects when gtag is missing", () => {
    const html = buildLineRedirectHtml({ lineUrl: LINE_ME, measurementId: "G-TESTMEASURE1" });
    expect(html).toMatch(/else\s*\{\s*redirect\(\);/s);
  });

  it("mutation 1: stripping the event send fails the contract", () => {
    const html = buildLineRedirectHtml({ lineUrl: LINE_ME, measurementId: "G-TESTMEASURE1" });
    expect(lineRedirectContractHolds(html)).toBe(true);
    const stripped = html.replace(/window\.gtag\(\s*'event',\s*'line_click'[\s\S]*?\}\);/, "");
    expect(stripped).not.toMatch(/gtag\(\s*['"]event['"]\s*,\s*['"]line_click['"]/);
    expect(lineRedirectContractHolds(stripped)).toBe(false);
  });
});

describe("generated site LINE touchpoints", () => {
  it("routes every customer LINE href through the redirect and lists every slug", async () => {
    const root = mkdtempSync(join(tmpdir(), "line-attr-site-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02");
    await writeApprovalLog(root, "2026-07-02");
    await generatePublicSite({
      root,
      baseUrl: "https://example.com/laundry-social-auto-poster",
      now: "2026-07-02T01:00:00.000Z"
    });

    const docsRoot = join(root, "docs");
    const redirect = await readFile(join(docsRoot, "go", "line.html"), "utf8");
    expect(lineRedirectContractHolds(redirect)).toBe(true);
    expect(redirect).toContain(LINE_ME);

    const expected = listLineTouchpoints([{ date: "2026-07-02", slot: 1 }]);
    expect(expected.map((row) => row.slug)).toEqual(expect.arrayContaining([
      "guide-rainy-shoe-care-cta",
      "footer",
      "services-shoe-bag-care-cta",
      "home-cta",
      "posts-2026-07-02-slot-01-cta"
    ]));

    const pages = await collectCustomerHtml(docsRoot);
    const missing: string[] = [];
    const bare: string[] = [];
    const untracked: string[] = [];
    const seen = new Set<string>();

    for (const [page, html] of pages) {
      for (const href of findBareLineMeHrefs(html)) {
        bare.push(`${page} -> ${href}`);
      }
      for (const href of findLineRedirectHrefs(html)) {
        const source = new URL(href, "https://example.com").searchParams.get("source");
        if (!source) untracked.push(`${page} -> ${href}`);
        else seen.add(source);
      }
    }

    expect(bare, `bare line.me hrefs:\n${bare.join("\n")}`).toEqual([]);
    expect(untracked, `redirect hrefs missing source:\n${untracked.join("\n")}`).toEqual([]);

    for (const row of expected) {
      const html = pages.get(row.page);
      if (!html?.includes(`source=${row.slug}`)) missing.push(`${row.page} ${row.placement} ${row.slug}`);
    }
    expect(missing, `missing slugs:\n${missing.join("\n")}`).toEqual([]);
    expect([...seen].sort()).toEqual([...new Set(expected.map((row) => row.slug))].sort());
  });

  it("mutation 2: a bare line.me href on a customer page fails the scan", async () => {
    const root = mkdtempSync(join(tmpdir(), "line-attr-bare-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02");
    await writeApprovalLog(root, "2026-07-02");
    await generatePublicSite({
      root,
      baseUrl: "https://example.com/laundry-social-auto-poster",
      now: "2026-07-02T01:00:00.000Z"
    });
    const pages = await collectCustomerHtml(join(root, "docs"));
    const clean = [...pages.values()].flatMap(findBareLineMeHrefs);
    expect(clean).toEqual([]);
    const poisoned = `${pages.get("index.html") ?? ""}<a href="${LINE_ME}">LINE</a>`;
    expect(findBareLineMeHrefs(poisoned)).toEqual([LINE_ME]);
  });
});

describe("line-attribution-report.ps1", () => {
  it("rolls fixture CSV into link_source x count x wow", async () => {
    const root = mkdtempSync(join(tmpdir(), "line-attr-report-"));
    const exportsDir = join(root, "data", "ga4-exports");
    const reportsDir = join(root, "reports");
    await mkdir(exportsDir, { recursive: true });
    await writeFile(
      join(exportsDir, "line_click-fixture.csv"),
      [
        "# GA4 exploration export",
        "link_source,Event count,Date",
        "home-cta,5,20260810",
        "home-cta,7,20260811",
        "footer,3,20260810",
        "footer,1,20260804",
        "guide-rainy-shoe-care-cta,4,20260803",
        ""
      ].join("\n"),
      "utf8"
    );

    const result = runReport([
      "-Root",
      root,
      "-ExportsDir",
      exportsDir,
      "-ReportsDir",
      reportsDir,
      "-Now",
      "2026-08-12"
    ]);
    expect(result.status, result.stderr || result.stdout).toBe(0);

    const reportPath = join(reportsDir, "line-attribution-2026-W33.md");
    const report = await readFile(reportPath, "utf8");
    expect(report).toContain("| home-cta | 12 | 0 | +12 |");
    expect(report).toContain("| footer | 3 | 1 | +2 |");
    expect(report).toContain("| guide-rainy-shoe-care-cta | 0 | 4 | -4 |");
  });

  it("prints the no-data tutorial and does not fail when exports are missing", () => {
    const root = mkdtempSync(join(tmpdir(), "line-attr-empty-"));
    const result = runReport([
      "-Root",
      root,
      "-ExportsDir",
      join(root, "data", "ga4-exports"),
      "-ReportsDir",
      join(root, "reports"),
      "-Now",
      "2026-08-12"
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/無資料/);
    expect(result.stdout).toMatch(/data\/ga4-exports/);
  });

  it("mutation 3: a misaligned CSV (no link_source / Event count) fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "line-attr-badcsv-"));
    const exportsDir = join(root, "data", "ga4-exports");
    await mkdir(exportsDir, { recursive: true });
    await writeFile(
      join(exportsDir, "line_click-swapped.csv"),
      ["Event name,Event count", "line_click,12", ""].join("\n"),
      "utf8"
    );
    const result = runReport([
      "-Root",
      root,
      "-ExportsDir",
      exportsDir,
      "-ReportsDir",
      join(root, "reports"),
      "-Now",
      "2026-08-12"
    ]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/misaligned|link_source/i);
  });
});

// The caption's LINE line ends in ?source=post, and every platform that
// auto-links a bare URL decides for itself where the URL stops. Running a
// full-width bracket straight onto the query string invites it to take "(或加"
// into the source value -- the one field that says where a click came from.
describe("caption LINE call-to-action", () => {
  it("separates the tracked URL from the bracket that follows it", async () => {
    const { lineContactLine } = await import("../src/contentPlan");
    const line = lineContactLine();
    expect(line).toContain("?source=post");
    expect(line).not.toMatch(/\?source=post\(/u);
    expect(line).toMatch(/\?source=post\s\(/u);
  });
});
