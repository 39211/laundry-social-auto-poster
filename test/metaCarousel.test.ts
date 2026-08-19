import { describe, expect, it, vi } from "vitest";
import { postFacebookCarousel } from "../src/postFacebook";
import { postInstagramCarousel } from "../src/postInstagram";
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
  date: "2026-07-20",
  slot: 1,
  caption: "白襯衫送洗前檢查",
  imageUrl: "https://39211.github.io/assets/2026-07-20/slot-01.png",
  imageUrls: [1, 2, 3, 4].map((slide) =>
    slide === 1
      ? "https://39211.github.io/assets/2026-07-20/slot-01.png"
      : `https://39211.github.io/assets/2026-07-20/slot-01-slide-0${slide}.png`
  ),
  mediaType: "carousel"
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("Meta carousel publishers", () => {
  it("publishes one Facebook multi-photo post from four unpublished photos", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "photo-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "photo-2" }))
      .mockResolvedValueOnce(jsonResponse({ id: "photo-3" }))
      .mockResolvedValueOnce(jsonResponse({ id: "photo-4" }))
      .mockResolvedValueOnce(jsonResponse({ id: "page_post-1" }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "page_post-1",
          permalink_url: "https://www.facebook.com/12345/posts/page_post-1",
          message: input.caption,
          attachments: {
            data: [
              {
                media_type: "album",
                subattachments: {
                  data: input.imageUrls!.map((url) => ({ media_type: "photo", media: { image: { src: url } } }))
                }
              }
            ]
          }
        })
      ) as unknown as typeof fetch;

    const result = await postFacebookCarousel(input, config, fetchImpl);

    expect(result.post_id).toBe("page_post-1");
    expect(result.remote_publication_evidence).toMatchObject({
      remote_id: "page_post-1",
      remote_media_type: "CAROUSEL",
      caption_exact_match: true
    });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    const firstBody = ((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit)
      .body as URLSearchParams;
    expect(firstBody.get("published")).toBe("false");
    const publishBody = ((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[4]?.[1] as RequestInit)
      .body as URLSearchParams;
    expect(publishBody.get("attached_media[0]")).toBe(JSON.stringify({ media_fbid: "photo-1" }));
    expect(publishBody.get("attached_media[3]")).toBe(JSON.stringify({ media_fbid: "photo-4" }));
  });

  it("does not retry a committed Facebook carousel when its readback is missing media", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "photo-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "photo-2" }))
      .mockResolvedValueOnce(jsonResponse({ id: "photo-3" }))
      .mockResolvedValueOnce(jsonResponse({ id: "photo-4" }))
      .mockResolvedValueOnce(jsonResponse({ id: "page_post-1" }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "page_post-1",
          permalink_url: "https://www.facebook.com/12345/posts/page_post-1",
          message: input.caption,
          attachments: { data: [] }
        })
      ) as unknown as typeof fetch;

    await expect(withRetry(() => postFacebookCarousel(input, config, fetchImpl), 3, 0)).rejects.toBeInstanceOf(NonRetryableError);
    // Four unpublished uploads, one irreversible feed commit, one readback: no second commit sequence.
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it.each([
    ["an empty object", {}],
    ["a null id", { id: null }]
  ])("does not issue a Facebook carousel success receipt when the commit returns %s", async (_kind, payload) => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "photo-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "photo-2" }))
      .mockResolvedValueOnce(jsonResponse({ id: "photo-3" }))
      .mockResolvedValueOnce(jsonResponse({ id: "photo-4" }))
      .mockResolvedValueOnce(jsonResponse(payload)) as unknown as typeof fetch;

    await expect(withRetry(() => postFacebookCarousel(input, config, fetchImpl), 3, 0)).rejects.toBeInstanceOf(NonRetryableError);
    // Four unpublished uploads then one irreversible /feed commit; no second sequence.
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("creates four Instagram children, a carousel parent, then publishes it", async () => {
    const responses: Response[] = [];
    for (let slide = 1; slide <= 4; slide += 1) {
      responses.push(jsonResponse({ id: `child-${slide}` }));
      responses.push(jsonResponse({ id: `child-${slide}`, status_code: "FINISHED" }));
    }
    responses.push(jsonResponse({ id: "parent-1" }));
    responses.push(jsonResponse({ id: "parent-1", status_code: "FINISHED" }));
    responses.push(jsonResponse({ id: "published-1" }));
    responses.push(
      jsonResponse({
        id: "published-1",
        media_type: "CAROUSEL_ALBUM",
        media_product_type: "FEED",
        permalink: "https://www.instagram.com/p/published-1/",
        caption: input.caption
      })
    );
    const fetchImpl = vi.fn(async () => responses.shift()!) as unknown as typeof fetch;

    const result = await postInstagramCarousel(input, config, fetchImpl, {
      maxAttempts: 1,
      intervalMs: 0,
      sleep: async () => undefined
    });

    expect(result.post_id).toBe("published-1");
    expect(result.remote_publication_evidence).toMatchObject({
      remote_id: "published-1",
      remote_media_type: "CAROUSEL",
      caption_exact_match: true
    });
    expect(fetchImpl).toHaveBeenCalledTimes(12);
    const firstChildBody = ((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit)
      .body as URLSearchParams;
    expect(firstChildBody.get("is_carousel_item")).toBe("true");
    const parentBody = ((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[8]?.[1] as RequestInit)
      .body as URLSearchParams;
    expect(parentBody.get("media_type")).toBe("CAROUSEL");
    expect(parentBody.get("children")).toBe("child-1,child-2,child-3,child-4");
  });

  it("adds one processed video child after four images for an Instagram mixed carousel", async () => {
    const responses: Response[] = [];
    for (let slide = 1; slide <= 4; slide += 1) {
      responses.push(jsonResponse({ id: `image-${slide}` }));
      responses.push(jsonResponse({ id: `image-${slide}`, status_code: "FINISHED" }));
    }
    responses.push(jsonResponse({ id: "video-5" }));
    responses.push(jsonResponse({ id: "video-5", status_code: "IN_PROGRESS" }));
    responses.push(jsonResponse({ id: "video-5", status_code: "FINISHED" }));
    responses.push(jsonResponse({ id: "parent-mixed" }));
    responses.push(jsonResponse({ id: "parent-mixed", status_code: "FINISHED" }));
    responses.push(jsonResponse({ id: "published-mixed" }));
    responses.push(
      jsonResponse({
        id: "published-mixed",
        media_type: "CAROUSEL_ALBUM",
        media_product_type: "FEED",
        permalink: "https://www.instagram.com/p/published-mixed/",
        caption: input.caption
      })
    );
    const fetchImpl = vi.fn(async () => responses.shift()!) as unknown as typeof fetch;

    const result = await postInstagramCarousel(
      {
        ...input,
        mediaType: "mixed-carousel",
        videoUrl: "https://39211.github.io/assets/2026-07-29/slot-01.mp4"
      },
      config,
      fetchImpl,
      { maxAttempts: 2, intervalMs: 0, sleep: async () => undefined }
    );

    expect(result.post_id).toBe("published-mixed");

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const bodyOf = (index: number) => (calls[index]?.[1] as RequestInit).body as URLSearchParams;

    // Meta documents that reels cannot appear in carousels, so a video child is
    // VIDEO. REELS here is rejected at container creation, and the failure would
    // only surface on the first live mixed carousel.
    const videoBody = bodyOf(8);
    expect(Object.fromEntries(videoBody.entries())).toEqual({
      media_type: "VIDEO",
      video_url: "https://39211.github.io/assets/2026-07-29/slot-01.mp4",
      is_carousel_item: "true",
      access_token: "test-access-token"
    });

    const imageBody = bodyOf(0);
    expect(Object.fromEntries(imageBody.entries())).toEqual({
      image_url: "https://39211.github.io/assets/2026-07-20/slot-01.png",
      is_carousel_item: "true",
      access_token: "test-access-token"
    });

    const parentBody = bodyOf(11);
    expect(parentBody.get("media_type")).toBe("CAROUSEL");
    expect(parentBody.get("children")).toBe("image-1,image-2,image-3,image-4,video-5");
  });

  it("does not retry a committed Instagram carousel when its canonical readback is wrong", async () => {
    const responses: Response[] = [];
    for (let slide = 1; slide <= 4; slide += 1) {
      responses.push(jsonResponse({ id: `child-${slide}` }));
      responses.push(jsonResponse({ id: `child-${slide}`, status_code: "FINISHED" }));
    }
    responses.push(jsonResponse({ id: "parent-1" }));
    responses.push(jsonResponse({ id: "parent-1", status_code: "FINISHED" }));
    responses.push(jsonResponse({ id: "published-1" }));
    responses.push(
      jsonResponse({
        id: "published-1",
        media_type: "IMAGE",
        media_product_type: "FEED",
        permalink: "https://www.instagram.com/p/published-1/",
        caption: input.caption
      })
    );
    const fetchImpl = vi.fn(async () => responses.shift()!) as unknown as typeof fetch;

    await expect(
      withRetry(
        () => postInstagramCarousel(input, config, fetchImpl, { maxAttempts: 1, intervalMs: 0, sleep: async () => undefined }),
        3,
        0
      )
    ).rejects.toBeInstanceOf(NonRetryableError);
    // Four children, parent, one media_publish, and one failed readback; no duplicate publish.
    expect(fetchImpl).toHaveBeenCalledTimes(12);
  });

  it("does not call Meta for carousel dry-runs", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const dryConfig = { ...config, dryRun: true };

    await expect(postFacebookCarousel(input, dryConfig, fetchImpl)).resolves.toMatchObject({ dry_run: true });
    await expect(postInstagramCarousel(input, dryConfig, fetchImpl)).resolves.toMatchObject({ dry_run: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
