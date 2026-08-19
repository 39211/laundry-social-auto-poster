import { describe, expect, it, vi } from "vitest";
import { postFacebookPhoto, postFacebookReel } from "../src/postFacebook";
import { postInstagramPhoto, postInstagramReel } from "../src/postInstagram";
import { NonRetryableError, withRetry } from "../src/retry";
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
  it.each([
    ["an empty object", {}],
    ["a null id", { id: null }]
  ])("does not issue a Facebook photo success receipt when the commit returns %s", async (_kind, payload) => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(payload)) as unknown as typeof fetch;

    await expect(
      withRetry(
        () => postFacebookPhoto({ ...input, mediaType: "image", videoUrl: undefined }, config, fetchImpl),
        3,
        0
      )
    ).rejects.toBeInstanceOf(NonRetryableError);
    // The POST may have committed despite its unusable response; never submit it again.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns Facebook photo success only after an exact canonical remote readback", async () => {
    const photoInput = { ...input, mediaType: "image" as const, videoUrl: undefined };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "fb-photo-1" }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "fb-photo-1",
          permalink_url: "https://www.facebook.com/12345/posts/fb-photo-1",
          description: photoInput.caption,
          attachments: { data: [{ media_type: "photo", media: { image: { src: photoInput.imageUrl } } }] }
        })
      ) as unknown as typeof fetch;

    const result = await postFacebookPhoto(photoInput, config, fetchImpl);

    expect(result).toMatchObject({
      post_id: "fb-photo-1",
      remote_publication_evidence: {
        remote_id: "fb-photo-1",
        remote_media_type: "IMAGE",
        caption_exact_match: true
      }
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a committed Facebook photo when its canonical readback is missing", async () => {
    const photoInput = { ...input, mediaType: "image" as const, videoUrl: undefined };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "fb-photo-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "fb-photo-1" })) as unknown as typeof fetch;

    await expect(withRetry(() => postFacebookPhoto(photoInput, config, fetchImpl), 3, 0)).rejects.toBeInstanceOf(NonRetryableError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns Instagram photo success only after an exact canonical remote readback", async () => {
    const photoInput = { ...input, mediaType: "image" as const, videoUrl: undefined };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "ig-container-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "ig-container-1", status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse({ id: "ig-photo-1" }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "ig-photo-1",
          media_type: "IMAGE",
          media_product_type: "FEED",
          permalink: "https://www.instagram.com/p/ig-photo-1/",
          caption: photoInput.caption
        })
      ) as unknown as typeof fetch;

    const result = await postInstagramPhoto(photoInput, config, fetchImpl, {
      maxAttempts: 1,
      intervalMs: 0,
      sleep: async () => undefined
    });

    expect(result).toMatchObject({
      post_id: "ig-photo-1",
      remote_publication_evidence: {
        remote_id: "ig-photo-1",
        remote_media_type: "IMAGE",
        caption_exact_match: true
      }
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("does not retry a committed Instagram photo when canonical readback is not visible", async () => {
    const photoInput = { ...input, mediaType: "image" as const, videoUrl: undefined };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "ig-container-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "ig-container-1", status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse({ id: "ig-photo-1" }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "ig-photo-1",
          media_type: "IMAGE",
          media_product_type: "FEED",
          caption: photoInput.caption
        })
      ) as unknown as typeof fetch;

    await expect(
      withRetry(
        () => postInstagramPhoto(photoInput, config, fetchImpl, { maxAttempts: 1, intervalMs: 0, sleep: async () => undefined }),
        3,
        0
      )
    ).rejects.toBeInstanceOf(NonRetryableError);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("uses the Facebook hosted Reel upload flow", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ video_id: "video-1", upload_url: "https://rupload.test/video-1" }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "video-1",
          status: { video_status: "ready" },
          permalink_url: "https://www.facebook.com/reel/video-1",
          description: input.caption
        })
      ) as unknown as typeof fetch;

    const result = await postFacebookReel(input, config, fetchImpl, {
      maxAttempts: 1,
      intervalMs: 0,
      sleep: async () => undefined
    });

    expect(result.post_id).toBe("video-1");
    expect(result.remote_reel_evidence).toMatchObject({
      remote_id: "video-1",
      permalink: "https://www.facebook.com/reel/video-1",
      remote_media_type: "REELS",
      caption_exact_match: true
    });
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

  it("fails closed without a second Facebook commit when the remote Reel remains unready", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ video_id: "video-1", upload_url: "https://rupload.test/video-1" }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ id: "video-1", status: { video_status: "processing" } })) as unknown as typeof fetch;

    await expect(
      withRetry(
        () => postFacebookReel(input, config, fetchImpl, { maxAttempts: 1, intervalMs: 0, sleep: async () => undefined }),
        3,
        0
      )
    ).rejects.toBeInstanceOf(NonRetryableError);
    // Exactly one upload cycle: start, upload, finish, one status poll.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("still fails on a terminal Facebook video status", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ video_id: "video-1", upload_url: "https://rupload.test/video-1" }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ id: "video-1", status: { video_status: "error" } })) as unknown as typeof fetch;

    await expect(postFacebookReel(input, config, fetchImpl, {
      maxAttempts: 1,
      intervalMs: 0,
      sleep: async () => undefined
    })).rejects.toBeInstanceOf(NonRetryableError);
  });

  it("creates, waits for, and publishes an Instagram Reel container", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "container-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "container-1", status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse({ id: "published-1" }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "published-1",
          media_type: "VIDEO",
          media_product_type: "REELS",
          permalink: "https://www.instagram.com/reel/published-1/",
          caption: input.caption
        })
      ) as unknown as typeof fetch;

    const result = await postInstagramReel(input, config, fetchImpl, {
      maxAttempts: 1,
      intervalMs: 0,
      sleep: async () => undefined
    });

    expect(result.post_id).toBe("published-1");
    expect(result.remote_reel_evidence).toMatchObject({
      remote_id: "published-1",
      permalink: "https://www.instagram.com/reel/published-1/",
      remote_media_type: "REELS",
      caption_exact_match: true
    });
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

  it("fails closed without a second Instagram commit when remote media is not a Reel", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "container-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "container-1", status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse({ id: "published-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "published-1", media_type: "IMAGE", media_product_type: "FEED" })) as unknown as typeof fetch;

    await expect(
      withRetry(
        () => postInstagramReel(input, config, fetchImpl, { maxAttempts: 1, intervalMs: 0, sleep: async () => undefined }),
        3,
        0
      )
    ).rejects.toBeInstanceOf(NonRetryableError);
    // One container, one status wait, one publish, one verification — no rerun.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["missing permalink", { id: "published-1", media_type: "VIDEO", media_product_type: "REELS", caption: input.caption }],
    ["caption mismatch", { id: "published-1", media_type: "VIDEO", media_product_type: "REELS", permalink: "https://www.instagram.com/reel/published-1/", caption: "wrong caption" }],
    ["a non-Instagram permalink", { id: "published-1", media_type: "VIDEO", media_product_type: "REELS", permalink: "https://example.com/reel/published-1/", caption: input.caption }]
  ])("does not retry a committed Instagram Reel when verification has %s", async (_kind, readBack) => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "container-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "container-1", status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse({ id: "published-1" }))
      .mockResolvedValueOnce(jsonResponse(readBack)) as unknown as typeof fetch;

    await expect(
      withRetry(
        () => postInstagramReel(input, config, fetchImpl, { maxAttempts: 1, intervalMs: 0, sleep: async () => undefined }),
        3,
        0
      )
    ).rejects.toBeInstanceOf(NonRetryableError);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("does not retry a committed Instagram Reel when its remote GET throws", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "container-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "container-1", status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse({ id: "published-1" }))
      .mockRejectedValueOnce(new Error("readback connection reset")) as unknown as typeof fetch;

    await expect(
      withRetry(
        () => postInstagramReel(input, config, fetchImpl, { maxAttempts: 1, intervalMs: 0, sleep: async () => undefined }),
        3,
        0
      )
    ).rejects.toBeInstanceOf(NonRetryableError);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["missing public permalink", { id: "video-1", status: { video_status: "ready" }, description: input.caption }],
    ["description mismatch", { id: "video-1", status: { video_status: "ready" }, permalink_url: "https://www.facebook.com/reel/video-1", description: "wrong caption" }],
    ["remote id mismatch", { id: "wrong-id", status: { video_status: "ready" }, permalink_url: "https://www.facebook.com/reel/video-1", description: input.caption }],
    ["a non-Facebook permalink", { id: "video-1", status: { video_status: "ready" }, permalink_url: "https://example.com/reel/video-1", description: input.caption }]
  ])("does not retry a committed Facebook Reel when verification has %s", async (_kind, readBack) => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ video_id: "video-1", upload_url: "https://rupload.test/video-1" }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse(readBack)) as unknown as typeof fetch;

    await expect(
      withRetry(
        () => postFacebookReel(input, config, fetchImpl, { maxAttempts: 1, intervalMs: 0, sleep: async () => undefined }),
        3,
        0
      )
    ).rejects.toBeInstanceOf(NonRetryableError);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["an object", { state: "ready" }],
    ["a number", 7]
  ])("does not retry a committed Facebook Reel when video_status is %s", async (_kind, videoStatus) => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ video_id: "video-1", upload_url: "https://rupload.test/video-1" }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ id: "video-1", status: { video_status: videoStatus } })) as unknown as typeof fetch;

    await expect(
      withRetry(
        () => postFacebookReel(input, config, fetchImpl, { maxAttempts: 1, intervalMs: 0, sleep: async () => undefined }),
        3,
        0
      )
    ).rejects.toBeInstanceOf(NonRetryableError);
    // start, upload, finish, one malformed remote readback — never a second finish.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["null", null],
    ["an object without success=true", { id: "video-1" }]
  ])("does not retry a committed Facebook Reel when finish returns %s", async (_kind, finishPayload) => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ video_id: "video-1", upload_url: "https://rupload.test/video-1" }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse(finishPayload)) as unknown as typeof fetch;

    await expect(
      withRetry(
        () => postFacebookReel(input, config, fetchImpl, { maxAttempts: 1, intervalMs: 0, sleep: async () => undefined }),
        3,
        0
      )
    ).rejects.toBeInstanceOf(NonRetryableError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry a committed Facebook Reel when its remote GET throws", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ video_id: "video-1", upload_url: "https://rupload.test/video-1" }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockRejectedValueOnce(new Error("readback connection reset")) as unknown as typeof fetch;

    await expect(
      withRetry(
        () => postFacebookReel(input, config, fetchImpl, { maxAttempts: 1, intervalMs: 0, sleep: async () => undefined }),
        3,
        0
      )
    ).rejects.toBeInstanceOf(NonRetryableError);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("does not retry a committed Facebook Reel when its remote GET JSON body is unreadable", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ video_id: "video-1", upload_url: "https://rupload.test/video-1" }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(new Response("{", { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

    await expect(
      withRetry(
        () => postFacebookReel(input, config, fetchImpl, { maxAttempts: 1, intervalMs: 0, sleep: async () => undefined }),
        3,
        0
      )
    ).rejects.toBeInstanceOf(NonRetryableError);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["null", null],
    ["an object with a non-string id", { id: { unexpected: "published-1" } }]
  ])("does not retry a committed Instagram Reel when media_publish returns %s", async (_kind, publishPayload) => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "container-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "container-1", status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse(publishPayload)) as unknown as typeof fetch;

    await expect(
      withRetry(
        () => postInstagramReel(input, config, fetchImpl, { maxAttempts: 1, intervalMs: 0, sleep: async () => undefined }),
        3,
        0
      )
    ).rejects.toBeInstanceOf(NonRetryableError);
    // The invalid commit response cannot cause a second container or publish.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["null", null],
    ["an object with non-string media fields", { id: "published-1", media_type: { kind: "VIDEO" }, media_product_type: ["REELS"] }]
  ])("does not retry a committed Instagram Reel when the remote GET returns %s", async (_kind, readBack) => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "container-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "container-1", status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse({ id: "published-1" }))
      .mockResolvedValueOnce(jsonResponse(readBack)) as unknown as typeof fetch;

    await expect(
      withRetry(
        () => postInstagramReel(input, config, fetchImpl, { maxAttempts: 1, intervalMs: 0, sleep: async () => undefined }),
        3,
        0
      )
    ).rejects.toBeInstanceOf(NonRetryableError);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
