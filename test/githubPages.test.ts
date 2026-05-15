import { describe, expect, it } from "vitest";
import { buildGitHubPagesImageUrl } from "../src/githubPages";

describe("GitHub Pages URL builder", () => {
  it("maps docs assets to the public Pages root", () => {
    expect(
      buildGitHubPagesImageUrl("https://example.github.io/laundry-social-auto-poster/", "2026-05-15", 3)
    ).toBe("https://example.github.io/laundry-social-auto-poster/assets/2026-05-15/slot-03.png");
  });
});
