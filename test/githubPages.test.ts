import { describe, expect, it } from "vitest";
import { hasUsablePublicImageBaseUrl } from "../src/config";
import { buildGitHubPagesImageUrl } from "../src/githubPages";

describe("GitHub Pages URL builder", () => {
  it("maps docs assets to the public Pages root", () => {
    expect(
      buildGitHubPagesImageUrl("https://example.github.io/laundry-social-auto-poster/", "2026-05-15", 3)
    ).toBe("https://example.github.io/laundry-social-auto-poster/assets/2026-05-15/slot-03.png");
  });

  it("accepts both Netlify root domains and GitHub Pages path domains as public bases", () => {
    expect(hasUsablePublicImageBaseUrl("https://sixiangjia-laundry-social.netlify.app")).toBe(true);
    expect(hasUsablePublicImageBaseUrl("https://tester.github.io/laundry-social-auto-poster")).toBe(true);
    expect(hasUsablePublicImageBaseUrl("http://sixiangjia-laundry-social.netlify.app")).toBe(false);
  });
});
