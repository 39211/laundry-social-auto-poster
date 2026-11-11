import { describe, expect, it } from "vitest";
import { syncHomepageContentDates, type HomepageContentDatesInput } from "../src/homepageContentDates.js";
const canonicalUrl = "https://example.com/";
const home = { "@type": "WebPage", url: canonicalUrl, dateModified: "2026-11-03" };
const other = { "@type": "WebPage", url: `${canonicalUrl}other`, dateModified: "2026-12-01" };
function fixture(data: unknown = { "@graph": [home, other] }): HomepageContentDatesInput {
  return {
    canonicalUrl,
    html: `<p>Keep this exactly.</p><script type="application/ld+json">${JSON.stringify(data, null, 2)}</script><!-- SXJ:RECENT_POSTS -->cards<!-- /SXJ:RECENT_POSTS --><footer>Keep</footer>`,
    sitemapXml: `<urlset><url><loc>${canonicalUrl}</loc><lastmod>2026-10-07</lastmod></url><url><loc>${canonicalUrl}other</loc><lastmod>2026-12-01</lastmod></url></urlset>`,
    includedPostDates: ["2026-11-09", "2026-11-10T12:00:00+08:00"]
  };
}
describe("syncHomepageContentDates", () => {
  it("updates only the homepage dates and preserves other markup byte for byte", () => {
    const input = fixture();
    const result = syncHomepageContentDates(input);
    expect(result.lastmod).toBe("2026-11-10");
    expect(result.html).toBe(input.html.replace('"dateModified": "2026-11-03"', '"dateModified": "2026-11-10"'));
    expect(result.sitemapXml).toBe(input.sitemapXml.replace("2026-10-07", "2026-11-10"));
    expect(result.changed).toBe(true);
    expect(syncHomepageContentDates({ ...input, ...result })).toEqual({ ...result, changed: false });
  });
  it.each([home, [other, home], { "@graph": [other, { ...home, "@type": ["WebPage", "CollectionPage"] }] }])("supports JSON-LD object, array and graph", (data) => {
    expect(syncHomepageContentDates(fixture(data)).lastmod).toBe("2026-11-10");
  });
  it("keeps a later authored date and ignores unrelated newer dates", () => {
    const result = syncHomepageContentDates({ ...fixture(), includedPostDates: ["2026-10-01"] });
    expect(result.lastmod).toBe("2026-11-03");
  });
  it("inserts missing sitemap lastmod and homepage schema date", () => {
    const input = fixture({ "@type": "WebPage", "@id": `${canonicalUrl}#webpage` });
    input.sitemapXml = input.sitemapXml.replace("<lastmod>2026-10-07</lastmod>", "");
    const result = syncHomepageContentDates(input);
    expect(result.sitemapXml).toContain(`<loc>${canonicalUrl}</loc><lastmod>2026-11-10</lastmod>`);
    expect(result.html).toContain('"dateModified":"2026-11-10"');
  });
  it("does not change a nested dateModified in the homepage node", () => {
    const input = fixture({ ...home, primaryImageOfPage: { dateModified: "2026-09-01" } });
    const result = syncHomepageContentDates(input);
    expect(result.html).toBe(input.html.replace('"dateModified": "2026-11-03"', '"dateModified": "2026-11-10"'));
  });
  it.each(["2026-02-30", "not-a-date", "2026-13-01", "2026-11-10junk", "2026-11-10T99:00:00Z"])("fails closed on invalid included date %s", (value) => {
    const input = { ...fixture(), includedPostDates: [value] };
    expect(syncHomepageContentDates(input)).toMatchObject({ html: input.html, sitemapXml: input.sitemapXml, changed: false, reason: "Invalid included post date" });
  });
  it.each([
    (input: HomepageContentDatesInput) => ({ ...input, html: input.html.replace("<!-- SXJ:RECENT_POSTS -->", "") }),
    (input: HomepageContentDatesInput) => ({ ...input, html: input.html + "<!-- SXJ:RECENT_POSTS -->" }),
    (input: HomepageContentDatesInput) => ({ ...input, html: input.html.replace('"2026-11-03"', '"2026-02-30"') }),
    (input: HomepageContentDatesInput) => ({ ...input, sitemapXml: input.sitemapXml.replace("2026-10-07", "2026-02-30") }),
    (input: HomepageContentDatesInput) => ({ ...input, sitemapXml: input.sitemapXml.replace(`<loc>${canonicalUrl}</loc>`, "<loc>https://elsewhere.test/</loc>") })
  ])("fails closed without partially updating either document", (mutate) => {
    const input = mutate(fixture());
    const result = syncHomepageContentDates(input);
    expect(result).toMatchObject({ html: input.html, sitemapXml: input.sitemapXml, changed: false });
    expect(result.reason).toBeTruthy();
  });
  it("fails closed for missing or duplicate homepage nodes", () => {
    for (const data of [other, [home, home], { ...home, url: `${canonicalUrl}other`, "@id": `${canonicalUrl}#webpage` }]) {
      const input = fixture(data);
      expect(syncHomepageContentDates(input)).toMatchObject({ html: input.html, sitemapXml: input.sitemapXml, changed: false, reason: "Missing or ambiguous homepage WebPage" });
    }
  });
});
