import { describe, expect, it, vi } from "vitest";
import { postFacebookPhoto } from "../src/postFacebook";
import { postInstagramPhoto } from "../src/postInstagram";
import type { AppConfig } from "../src/types";

const config: AppConfig = {
  dryRun: true,
  timezone: "Asia/Taipei",
  graphApiVersion: "v25.0",
  publicSiteBaseUrl: "https://example.github.io/laundry-social-auto-poster",
  publicImageBaseUrl: "https://example.github.io/laundry-social-auto-poster",
  publicRootPagesRepo: "",
  verifyPublicImageUrl: false
};

describe("dry-run Meta clients", () => {
  it("does not call fetch for Facebook dry-runs", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await postFacebookPhoto(
      { date: "2026-05-15", slot: 1, caption: "測試", imageUrl: "https://example.test/a.png" },
      config,
      fetchImpl
    );

    expect(result.status).toBe("success");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not call fetch for Instagram dry-runs", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await postInstagramPhoto(
      { date: "2026-05-15", slot: 1, caption: "測試", imageUrl: "https://example.test/a.png" },
      config,
      fetchImpl
    );

    expect(result.status).toBe("success");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
