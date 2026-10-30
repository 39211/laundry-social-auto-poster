import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectReferencedPublicAssetPaths } from "../src/publishPages";
const root = join(process.cwd(), "seo-overrides");
const pages = ["index.html", "services/taichung-laundry-price-list.html", "services/shoe-bag-care.html", "services/luxury-garment-cleaning.html", "services/taichung-citywide-laundry-pickup.html", "services/business-bulk-laundry.html", "campaign/index.html"];
describe("approved v4 runtime survives SEO head preservation", () => {
  it("ships the booking runtime and its referenced assets on every primary page", () => {
    for (const path of pages) {
      const html = readFileSync(join(root, path), "utf8");
      expect(html, path).toMatch(/<script\b[^>]*src="[^\"]*assets\/v4\/sxj-v4\.js[^\"]*"/);
      const assets = collectReferencedPublicAssetPaths(root, [path]);
      expect(assets, path).toContain("assets/v4/sxj-v4.js");
      expect(assets, path).toContain("assets/v4/sxj-v4.css");
    }
  });
  it("ships the map runtime alongside the pickup controls", () => {
    const assets = collectReferencedPublicAssetPaths(root, ["services/taichung-citywide-laundry-pickup.html"]);
    expect(assets).toContain("assets/v4/sxj-map.js");
  });
});
