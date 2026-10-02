import { describe, expect, it, vi } from "vitest";
import { postFacebookReel } from "../src/postFacebook";
import { postInstagramReel } from "../src/postInstagram";
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

  it("treats a slow transcode as success, because the publish already committed", async () => {
    // The finish call publishes the Reel irreversibly. Throwing on a polling
    // timeout after that point fed withRetry, which reran the whole upload and
    // put duplicate Reels on the Page — so a still-processing status must
    // resolve, not reject. Only a terminal error status is a failure.
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
    })).resolves.toMatchObject({ status: "success" });
    // Exactly one upload cycle: start, upload, finish, one status poll.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("still fails on a terminal Facebook video status", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ video_id: "video-1", upload_url: "https://rupload.test/video-1" }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ status: { video_status: "error" } })) as unknown as typeof fetch;

    await expect(postFacebookReel(input, config, fetchImpl, {
      maxAttempts: 1,
      intervalMs: 0,
      sleep: async () => undefined
    })).rejects.toThrow("terminal status");
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

  it("does not retry a committed Instagram publish when verification lags", async () => {
    // media_publish is the commit point. Rejecting afterwards fed withRetry,
    // which recreated the container and published the same Reel again — so an
    // unconfirmed verification resolves and is logged, never raised.
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
    })).resolves.toMatchObject({ status: "success", post_id: "published-1" });
    // One container, one status wait, one publish, one verification — no rerun.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});

// The production caller wraps every publisher in withRetry (postCurrentSlot), so
// these go through it too: a check that fails after the Reel is live must not
// make withRetry run the publish again. Counted at the commit call itself.
describe("a check that fails after a Reel is live never publishes it again", () => {
  const noWait = { maxAttempts: 2, intervalMs: 0, sleep: async () => undefined };
  const faults = {
    "a dropped connection": () => Promise.reject(new TypeError("fetch failed")),
    "a 502 page that is not JSON": () => Promise.resolve(new Response("<html>502 Bad Gateway</html>", { status: 502 })),
    // JSON null parses without error, so it got past the try around
    // response.json() and crashed on the first field read instead.
    "a reply whose body is JSON null": () => Promise.resolve(jsonResponse(null)),
    "a 502 whose body is JSON null": () => Promise.resolve(jsonResponse(null, 502))
  };

  for (const [name, fault] of Object.entries(faults)) {
    it(`Instagram: ${name} on the verification`, async () => {
      let publishes = 0;
      let checks = 0;
      const fetchImpl = vi.fn(async (url: string | URL) => {
        const target = String(url);
        if (target.endsWith("/media_publish")) {
          publishes += 1;
          return jsonResponse({ id: `published-${publishes}` });
        }
        if (target.includes("fields=status_code")) return jsonResponse({ id: "container-1", status_code: "FINISHED" });
        if (target.includes("fields=id%2Cmedia_type")) {
          checks += 1;
          if (checks === 1) return fault();
          return jsonResponse({ id: `published-${publishes}`, media_type: "VIDEO", media_product_type: "REELS" });
        }
        return jsonResponse({ id: "container-1" });
      }) as unknown as typeof fetch;

      const { value, attempts } = await withRetry(() => postInstagramReel(input, config, fetchImpl, noWait), 3);
      expect(publishes).toBe(1);
      expect(attempts).toBe(1);
      expect(value).toMatchObject({ status: "success", post_id: "published-1" });
    });

    it(`Facebook: ${name} on the status check after publishing`, async () => {
      let finishes = 0;
      const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
        const target = String(url);
        if (target.startsWith("https://rupload.test/")) return jsonResponse({ success: true });
        const phase = init?.body instanceof URLSearchParams ? init.body.get("upload_phase") : null;
        if (phase === "start") return jsonResponse({ video_id: "video-1", upload_url: "https://rupload.test/video-1" });
        if (phase === "finish") {
          finishes += 1;
          return jsonResponse({ success: true });
        }
        if (target.includes("fields=status")) return fault();
        return jsonResponse({ error: { message: `unexpected ${target}` } }, 404);
      }) as unknown as typeof fetch;

      const { value, attempts } = await withRetry(() => postFacebookReel(input, config, fetchImpl, noWait), 3);
      expect(finishes).toBe(1);
      expect(attempts).toBe(1);
      expect(value).toMatchObject({ status: "success", post_id: "video-1" });
    });
  }

  function facebookReelFetch(onFinish: () => Promise<Response>, onStatus: () => Promise<Response>) {
    const calls = { finishes: 0 };
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.startsWith("https://rupload.test/")) return jsonResponse({ success: true });
      const phase = init?.body instanceof URLSearchParams ? init.body.get("upload_phase") : null;
      if (phase === "start") return jsonResponse({ video_id: "video-1", upload_url: "https://rupload.test/video-1" });
      if (phase === "finish") {
        calls.finishes += 1;
        return onFinish();
      }
      if (target.includes("fields=status")) return onStatus();
      return jsonResponse({ error: { message: `unexpected ${target}` } }, 404);
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  it("Instagram: a media_publish reply of JSON null is not retried", async () => {
    let publishes = 0;
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const target = String(url);
      if (target.endsWith("/media_publish")) {
        publishes += 1;
        return jsonResponse(null);
      }
      if (target.includes("fields=status_code")) return jsonResponse({ id: "container-1", status_code: "FINISHED" });
      return jsonResponse({ id: "container-1" });
    }) as unknown as typeof fetch;

    await expect(withRetry(() => postInstagramReel(input, config, fetchImpl, noWait), 3)).rejects.toBeInstanceOf(
      NonRetryableError
    );
    expect(publishes).toBe(1);
  });

  it("Facebook: a finish reply of JSON null is not retried", async () => {
    const { fetchImpl, calls } = facebookReelFetch(
      () => Promise.resolve(jsonResponse(null)),
      () => Promise.resolve(jsonResponse({ status: { video_status: "ready" } }))
    );

    await expect(withRetry(() => postFacebookReel(input, config, fetchImpl, noWait), 3)).rejects.toBeInstanceOf(
      NonRetryableError
    );
    expect(calls.finishes).toBe(1);
  });

  it("Facebook: a status value that is not text does not publish again", async () => {
    const { fetchImpl, calls } = facebookReelFetch(
      () => Promise.resolve(jsonResponse({ success: true })),
      () => Promise.resolve(jsonResponse({ status: { video_status: 5 } }))
    );

    const { value, attempts } = await withRetry(() => postFacebookReel(input, config, fetchImpl, noWait), 3);
    expect(calls.finishes).toBe(1);
    expect(attempts).toBe(1);
    expect(value).toMatchObject({ status: "success", post_id: "video-1" });
  });

  it("Facebook: an unreadable status is reported once, as unreadable", async () => {
    const { fetchImpl } = facebookReelFetch(
      () => Promise.resolve(jsonResponse({ success: true })),
      () => Promise.resolve(jsonResponse(null))
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await withRetry(() => postFacebookReel(input, config, fetchImpl, noWait), 3);
      const warnings = warn.mock.calls.map((args) => String(args[0]));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("status could not be read (Facebook Reel status check failed with 200)");
    } finally {
      warn.mockRestore();
    }
  });
});
