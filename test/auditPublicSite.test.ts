import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditPublicSite, publicSiteAuditFailures } from "../src/auditPublicSite";

function writeAuditFixture(root: string, options: { missingAlt?: boolean; profileMismatch?: boolean } = {}): void {
  mkdirSync(join(root, "data"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  const profile = {
    name: "私享家洗衣店",
    google_business_profile_name: "私享家 旗艦總店",
    address: {
      streetAddress: "青海路二段365號"
    },
    address_text: "407 臺中市西屯區至善里青海路二段365號",
    telephone_local: "04-2452-7411",
    line_id: "0968327653",
    mobile_or_line_local: "0968-327-653",
    opening_hours_text: "週一至週五 10:00-20:00；週六 12:00-18:00；週日公休"
  };
  writeFileSync(join(root, "data", "business-profile.json"), `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  writeFileSync(
    join(root, "docs", "business-profile.json"),
    `${JSON.stringify(options.profileMismatch ? { ...profile, telephone_local: "04-0000-0000" } : profile, null, 2)}\n`,
    "utf8"
  );
  writeFileSync(
    join(root, "docs", "index.html"),
    [
      "<!doctype html>",
      "<html><head>",
      '<meta property="og:image" content="assets/hero.png">',
      '<script type="application/ld+json">{"@context":"https://schema.org","@type":"ImageObject","contentUrl":"assets/schema.png","caption":"Schema image"}</script>',
      "</head><body>",
      `<h1>${profile.name}</h1>`,
      `<p>${profile.google_business_profile_name}</p>`,
      `<address>${profile.address_text} ${profile.address.streetAddress}</address>`,
      `<p>${profile.telephone_local} ${profile.line_id} ${profile.opening_hours_text}</p>`,
      options.missingAlt ? '<img src="assets/hero.png">' : '<img src="assets/hero.png" alt="Hero image">',
      "</body></html>"
    ].join("\n"),
    "utf8"
  );
  writeFileSync(
    join(root, "docs", "latest.json"),
    `${JSON.stringify({ image_url: "https://assets.example.test/latest.png" }, null, 2)}\n`,
    "utf8"
  );
}

function fetchWithStatuses(statuses: Record<string, { status: number; contentType: string }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = statuses[url] ?? { status: 200, contentType: "image/png" };
    return new Response("", {
      status: match.status,
      headers: { "content-type": match.contentType }
    });
  }) as typeof fetch;
}

describe("auditPublicSite", () => {
  it("passes when images, OG, schema image, and NAP are valid", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-audit-pass-"));
    writeAuditFixture(root);

    const result = await auditPublicSite({
      root,
      siteBaseUrl: "https://example.test/site",
      retries: 0,
      fetchImpl: fetchWithStatuses({})
    });

    expect(result.img_tag_count).toBe(1);
    expect(result.og_image_count).toBe(1);
    expect(result.schema_image_count).toBe(1);
    expect(result.alt_issues).toEqual([]);
    expect(result.broken_urls).toEqual([]);
    expect(result.nap.docs_profile_matches_data).toBe(true);
    expect(Object.values(result.nap.homepage_contains).every(Boolean)).toBe(true);
    expect(publicSiteAuditFailures(result)).toEqual([]);
  });

  it("reports missing alt, broken images, non-image responses, and NAP mismatches", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-audit-fail-"));
    writeAuditFixture(root, { missingAlt: true, profileMismatch: true });

    const result = await auditPublicSite({
      root,
      siteBaseUrl: "https://example.test/site",
      retries: 0,
      fetchImpl: fetchWithStatuses({
        "https://example.test/site/assets/hero.png": { status: 404, contentType: "text/html" },
        "https://example.test/site/assets/schema.png": { status: 200, contentType: "text/html" },
        "https://assets.example.test/latest.png": { status: 200, contentType: "image/png" }
      })
    });
    const failures = publicSiteAuditFailures(result);

    expect(result.alt_issues).toHaveLength(1);
    expect(result.broken_urls).toHaveLength(1);
    expect(result.non_image_content_types).toHaveLength(1);
    expect(result.nap.docs_profile_matches_data).toBe(false);
    expect(failures.some((failure) => failure.includes("Missing image alt"))).toBe(true);
    expect(failures.some((failure) => failure.includes("Broken image URL"))).toBe(true);
    expect(failures.some((failure) => failure.includes("Non-image content type"))).toBe(true);
    expect(failures.some((failure) => failure.includes("NAP mismatch"))).toBe(true);
  });
});
