import { describe, expect, it, vi } from "vitest";
import {
  CAMPAIGN_SLOT,
  insideWindow,
  resolveImageUrl,
  runCampaignPost,
  selectPost,
  taipeiNow,
  type CampaignLogEntry,
  type CampaignPlan
} from "../src/postCampaignPoster";
import type { AppConfig, PostInput } from "../src/types";

const plan: CampaignPlan = {
  campaign: "t",
  publish_window: { start: "17:00", end: "21:00" },
  image_base: "https://site.example/c",
  image_base_fallback: "https://raw.example/c",
  posts: [
    { id: "p1", date: "2026-09-09", image: "a.png", caption_ig: "ig-a", caption_fb: "fb-a" },
    { id: "p2", date: "2026-09-10", image: "b.png", caption_ig: "ig-b", caption_fb: "fb-b" }
  ]
};

const liveConfig: AppConfig = {
  dryRun: false,
  timezone: "Asia/Taipei",
  graphApiVersion: "v25.0",
  metaAccessToken: "t",
  facebookPageId: "1",
  instagramUserId: "2",
  publicSiteBaseUrl: "https://site.example",
  publicImageBaseUrl: "https://site.example",
  publicRootPagesRepo: "",
  verifyPublicImageUrl: false
};

// 18:30 Taipei on 2026-09-09 == 10:30Z
const inWindow = new Date("2026-09-09T10:30:00Z");
// 09:00 Taipei == 01:00Z
const beforeWindow = new Date("2026-09-09T01:00:00Z");

describe("campaign poster plan selection", () => {
  it("selects exactly the post planned for the date, none otherwise", () => {
    expect(selectPost(plan, "2026-09-10")?.id).toBe("p2");
    expect(selectPost(plan, "2026-09-11")).toBeUndefined();
  });

  it("window is [start, end) in Taipei minutes", () => {
    expect(insideWindow(plan, 17 * 60)).toBe(true);
    expect(insideWindow(plan, 20 * 60 + 59)).toBe(true);
    expect(insideWindow(plan, 21 * 60)).toBe(false);
    expect(insideWindow(plan, 16 * 60 + 59)).toBe(false);
  });

  it("taipeiNow converts UTC to the Taipei calendar day", () => {
    // 2026-09-09T17:30Z is 2026-09-10 01:30 Taipei
    expect(taipeiNow(new Date("2026-09-09T17:30:00Z"))).toEqual({ date: "2026-09-10", minutes: 90 });
  });
});

const post1 = plan.posts[0]!;

describe("resolveImageUrl", () => {
  it("uses the site URL when reachable and falls back to raw when it is not", async () => {
    const verify = vi.fn(async (url: string) => {
      if (url.startsWith("https://site.example")) throw new Error("404");
    });
    await expect(resolveImageUrl(plan, post1, verify)).resolves.toBe("https://raw.example/c/a.png");
    const ok = vi.fn(async () => undefined);
    await expect(resolveImageUrl(plan, post1, ok)).resolves.toBe("https://site.example/c/a.png");
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("throws when neither host serves the image", async () => {
    const verify = vi.fn(async () => {
      throw new Error("down");
    });
    await expect(resolveImageUrl(plan, post1, verify)).rejects.toThrow(/no reachable public image URL for p1/);
  });
});

describe("runCampaignPost", () => {
  it("posts FB with the FB caption and IG with the IG caption, slot 9, and logs both", async () => {
    const postFacebook = vi.fn(async (_input: PostInput) => ({ platform: "facebook", status: "success", dry_run: false, attempts: 1, post_id: "fb1" }) as const);
    const postInstagram = vi.fn(async (_input: PostInput) => ({ platform: "instagram", status: "success", dry_run: false, attempts: 1, post_id: "ig1" }) as const);
    const log: CampaignLogEntry[] = [];
    const out = await runCampaignPost(
      { root: "/nowhere", now: inWindow },
      { config: liveConfig, plan, verify: async () => undefined, postFacebook, postInstagram, log: (e) => log.push(e), existing: [] }
    );
    expect(out.post).toBe("p1");
    expect(postFacebook.mock.calls[0]![0]).toMatchObject({ caption: "fb-a", slot: CAMPAIGN_SLOT, imageUrl: "https://site.example/c/a.png", date: "2026-09-09" });
    expect(postInstagram.mock.calls[0]![0]).toMatchObject({ caption: "ig-a", slot: CAMPAIGN_SLOT });
    expect(log.map((e) => [e.platform, e.status, e.post_id])).toEqual([
      ["facebook", "success", "fb1"],
      ["instagram", "success", "ig1"]
    ]);
  });

  it("refuses outside the window unless forced, and never calls a publisher", async () => {
    const postFacebook = vi.fn();
    const out = await runCampaignPost(
      { root: "/nowhere", now: beforeWindow },
      { config: liveConfig, plan, verify: async () => undefined, postFacebook, postInstagram: postFacebook, existing: [], log: () => undefined }
    );
    expect(out.skipped).toMatch(/outside publish window/);
    expect(postFacebook).not.toHaveBeenCalled();
    const forced = await runCampaignPost(
      { root: "/nowhere", now: beforeWindow, force: true, platforms: ["facebook"] },
      {
        config: liveConfig,
        plan,
        verify: async () => undefined,
        postFacebook: vi.fn(async () => ({ platform: "facebook", status: "success", dry_run: false, attempts: 1, post_id: "x" }) as const),
        existing: [],
        log: () => undefined
      }
    );
    expect(forced.results).toEqual([{ platform: "facebook", status: "success", post_id: "x" }]);
  });

  it("does not re-post a platform already logged as success (retry trigger cannot double-post)", async () => {
    const postFacebook = vi.fn();
    const postInstagram = vi.fn(async () => ({ platform: "instagram", status: "success", dry_run: false, attempts: 1, post_id: "ig2" }) as const);
    const existing: CampaignLogEntry[] = [{ id: "p1", platform: "facebook", status: "success", post_id: "fb-old", at: "x" }];
    const out = await runCampaignPost(
      { root: "/nowhere", now: inWindow },
      { config: liveConfig, plan, verify: async () => undefined, postFacebook, postInstagram, existing, log: () => undefined }
    );
    expect(postFacebook).not.toHaveBeenCalled();
    expect(out.results[0]).toEqual({ platform: "facebook", status: "success", post_id: "fb-old", already: true });
    expect(out.results[1]).toMatchObject({ platform: "instagram", post_id: "ig2" });
  });

  it("a failed platform is logged as failed, the other platform still runs, and a prior failure is retried", async () => {
    const postFacebook = vi.fn(async () => {
      throw new Error("boom");
    });
    const postInstagram = vi.fn(async () => ({ platform: "instagram", status: "success", dry_run: false, attempts: 1, post_id: "ig3" }) as const);
    const log: CampaignLogEntry[] = [];
    const existing: CampaignLogEntry[] = [{ id: "p1", platform: "facebook", status: "failed", error: "earlier", at: "x" }];
    const out = await runCampaignPost(
      { root: "/nowhere", now: inWindow },
      { config: liveConfig, plan, verify: async () => undefined, postFacebook, postInstagram, existing, log: (e) => log.push(e) }
    );
    expect(postFacebook).toHaveBeenCalledTimes(1);
    expect(out.results).toEqual([
      { platform: "facebook", status: "failed", error: "boom" },
      { platform: "instagram", status: "success", post_id: "ig3" }
    ]);
    expect(log.map((e) => e.status)).toEqual(["failed", "success"]);
  });

  it("dry-run skips URL verification and writes no log", async () => {
    const verify = vi.fn();
    const log = vi.fn();
    const postFacebook = vi.fn(async () => ({ platform: "facebook", status: "success", dry_run: true, attempts: 1, post_id: "dry" }) as const);
    await runCampaignPost(
      { root: "/nowhere", now: inWindow, platforms: ["facebook"] },
      { config: { ...liveConfig, dryRun: true }, plan, verify, postFacebook, existing: [], log }
    );
    expect(verify).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
