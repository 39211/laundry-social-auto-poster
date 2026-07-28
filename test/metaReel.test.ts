import { describe, expect, it, vi } from "vitest";
import { postFacebookReel } from "../src/postFacebook";
import { postInstagramReel } from "../src/postInstagram";
import type { AppConfig, PostInput } from "../src/types";

const config: AppConfig = {
  dryRun: false,
  timezone: "Asia/Taipei",
  graphApiVersion: "v25.0",
  metaAccessToken: "test-access-token",
  facebookPageId: "12345",
  instagramUserId: "67890",
  publicSiteBaseUrl: "https://39211.github.io",
  publicImageBaseUrl: "https://39211.github.io",
  publicRootPagesRepo: "",
  verifyPublicImageUrl: false
};

const input: PostInput = {
  date: "2026-07-16",
  slot: 2,
  caption: "台中市全區免費到府收送",
  imageUrl: "https://39211.github.io/assets/2026-07-16/slot-02.png",
  mediaType: "reel",
  videoUrl: "https://39211.github.io/assets/2026-07-16/slot-02.mp4"
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("Meta Reel publishers", () => {
  it("uses the Facebook hosted Reel upload flow", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ video_id: "video-1", upload_url: "https://rupload.test/video-1" }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ status: { video_status: "ready" } })) as unknown as typeof fetch;

    const result = await postFacebookReel(input, config, fetchImpl, {
      maxAttempts: 1,
      intervalMs: 0,
      sleep: async () => undefined
    });

    expect(result.post_id).toBe("video-1");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://rupload.test/video-1",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ file_url: input.videoUrl })
      })
    );
  });

  it("does not report success until the Facebook Reel is ready", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ video_id: "video-1", upload_url: "https://rupload.test/video-1" }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ status: { video_status: "processing" } })) as unknown as typeof fetch;

    await expect(postFacebookReel(input, config, fetchImpl, {
      maxAttempts: 1,
      intervalMs: 0,
      sleep: async () => undefined
    })).rejects.toThrow("was not ready");
  });

  it("creates, waits for, and publishes an Instagram Reel container", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "container-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "container-1", status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse({ id: "published-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "published-1", media_type: "VIDEO", media_product_type: "REELS" })) as unknown as typeof fetch;

    const result = await postInstagramReel(input, config, fetchImpl, {
      maxAttempts: 1,
      intervalMs: 0,
      sleep: async () => undefined
    });

    expect(result.post_id).toBe("published-1");
    const createInit = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    const body = createInit.body as URLSearchParams;
    expect(body.get("media_type")).toBe("REELS");
    expect(body.get("video_url")).toBe(input.videoUrl);
    expect(body.get("share_to_feed")).toBe("true");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("does not call Meta for Reel dry-runs", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const dryConfig = { ...config, dryRun: true };

    await expect(postFacebookReel(input, dryConfig, fetchImpl)).resolves.toMatchObject({ dry_run: true });
    await expect(postInstagramReel(input, dryConfig, fetchImpl)).resolves.toMatchObject({ dry_run: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not report success when the published Instagram media is not a Reel", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "container-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "container-1", status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse({ id: "published-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "published-1", media_type: "IMAGE", media_product_type: "FEED" })) as unknown as typeof fetch;

    await expect(postInstagramReel(input, config, fetchImpl, {
      maxAttempts: 1,
      intervalMs: 0,
      sleep: async () => undefined
    })).rejects.toThrow("was not verified as a Reel");
  });
});
