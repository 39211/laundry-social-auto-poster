import { describe, expect, it, vi } from "vitest";
import { postInstagramPhoto } from "../src/postInstagram";
import type { AppConfig } from "../src/types";

const appendPostLog = vi.fn();

vi.mock("../src/logging", () => ({ appendPostLog }));

const liveConfig: AppConfig = {
  dryRun: false,
  timezone: "Asia/Taipei",
  graphApiVersion: "v25.0",
  metaAccessToken: "test-access-token",
  facebookPageId: "12345",
  instagramUserId: "67890",
  publicSiteBaseUrl: "https://laundry.example.test",
  publicImageBaseUrl: "https://laundry.example.test",
  publicRootPagesRepo: "",
  verifyPublicImageUrl: false
};

const input = {
  date: "2026-07-12",
  slot: 2,
  caption: "Test caption",
  imageUrl: "https://laundry.example.test/slot-02.png"
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("postInstagramPhoto container readiness", () => {
  it("waits for FINISHED before publishing and does not write posted logs directly", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "container-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "container-1", status_code: "IN_PROGRESS" }))
      .mockResolvedValueOnce(jsonResponse({ id: "container-1", status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse({ id: "published-1" })) as unknown as typeof fetch;
    const sleep = vi.fn(async () => undefined);

    const result = await postInstagramPhoto(input, liveConfig, fetchImpl, {
      maxAttempts: 3,
      intervalMs: 25,
      sleep
    });

    expect(result.post_id).toBe("published-1");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/container-1?fields=status_code%2Cstatus&access_token=test-access-token"),
      { method: "GET" }
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      "https://graph.facebook.com/v25.0/67890/media_publish",
      expect.objectContaining({ method: "POST" })
    );
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(25);
    expect(appendPostLog).not.toHaveBeenCalled();
  });

  it("does not publish while the container remains in progress", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "container-2" }))
      .mockImplementation(async () => jsonResponse({ id: "container-2", status_code: "IN_PROGRESS" })) as unknown as typeof fetch;

    await expect(
      postInstagramPhoto(input, liveConfig, fetchImpl, {
        maxAttempts: 2,
        intervalMs: 0,
        sleep: async () => undefined
      })
    ).rejects.toThrow("was not publishable after 2 status checks");

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(appendPostLog).not.toHaveBeenCalled();
  });
});
