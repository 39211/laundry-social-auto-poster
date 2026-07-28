import { describe, expect, it } from "vitest";
import { hasUsablePublicImageBaseUrl } from "../src/config";
import {
  buildGitHubPagesCarouselImageUrl,
  buildGitHubPagesImageUrl,
  buildGitHubPagesVideoUrl
} from "../src/githubPages";

describe("GitHub Pages URL builder", () => {
  it("maps docs assets to the public Pages root", () => {
    expect(
      buildGitHubPagesImageUrl("https://example.github.io/laundry-social-auto-poster/", "2026-05-15", 3)
    ).toBe("https://example.github.io/laundry-social-auto-poster/assets/2026-05-15/slot-03.png");
  });

  it("maps Reel assets to a public MP4 URL", () => {
    expect(buildGitHubPagesVideoUrl("https://39211.github.io/", "2026-07-16", 2)).toBe(
      "https://39211.github.io/assets/2026-07-16/slot-02.mp4"
    );
  });

  it("maps carousel slides without changing the legacy cover URL", () => {
    expect(buildGitHubPagesCarouselImageUrl("https://39211.github.io/", "2026-07-20", 1, 1)).toBe(
      "https://39211.github.io/assets/2026-07-20/slot-01.png"
    );
    expect(buildGitHubPagesCarouselImageUrl("https://39211.github.io/", "2026-07-20", 1, 4)).toBe(
      "https://39211.github.io/assets/2026-07-20/slot-01-slide-04.png"
    );
  });

  it("accepts both Netlify root domains and GitHub Pages path domains as public bases", () => {
    expect(hasUsablePublicImageBaseUrl("https://sixiangjia-laundry-social.netlify.app")).toBe(true);
    expect(hasUsablePublicImageBaseUrl("https://tester.github.io/laundry-social-auto-poster")).toBe(true);
    expect(hasUsablePublicImageBaseUrl("http://sixiangjia-laundry-social.netlify.app")).toBe(false);
  });
});
