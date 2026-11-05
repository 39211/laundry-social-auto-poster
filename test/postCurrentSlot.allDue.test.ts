import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/logging", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/logging")>();
  return { ...actual, loadDailyContent: vi.fn() };
});
vi.mock("../src/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config")>();
  return {
    ...actual,
    getConfig: () => ({
      dryRun: false,
      timezone: "Asia/Taipei",
      graphApiVersion: "v21.0",
      metaAccessToken: "unit-test-token",
      facebookPageId: "1000000000",
      instagramUserId: "2000000000",
      publicSiteBaseUrl: "https://site.invalid",
      publicImageBaseUrl: "https://assets.invalid/laundry",
      publicRootPagesRepo: "unit-test/pages.invalid",
      verifyPublicImageUrl: false
    }),
    assertLiveMetaConfig: () => undefined,
    assertPublicImageBaseUrl: () => undefined
  };
});
vi.mock("../src/pause", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/pause")>();
  return { ...actual, readPause: async () => null as never };
});
vi.mock("../src/scheduler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/scheduler")>();
  const schedule = [
    { slot: 1, time: "08:00", category: "知識文" as const },
    { slot: 2, time: "18:00", category: "情境文" as const }
  ];
  return {
    ...actual,
    DAILY_SCHEDULE: schedule,
    findSlotByNumber: (n: number) => schedule.find((item) => item.slot === n)
  };
});
vi.mock("../src/publishTimes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/publishTimes")>();
  return { ...actual, getSlotPublishTime: (_date: string, slot: number) => (slot === 1 ? "08:00" : "18:00") };
});
vi.mock("../src/imageStamp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/imageStamp")>();
  return {
    ...actual,
    inspectApprovedImageDigestFile: vi.fn(async () => ({ kind: "missing" }) as never),
    imagesChangedSinceStamp: vi.fn(async () => []),
    imagesDifferFromApproval: vi.fn(async () => [])
  };
});
vi.mock("../src/mediaAssets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/mediaAssets")>();
  return { ...actual, imageAssetsForSlot: () => [] };
});
vi.mock("../src/abTestPlan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/abTestPlan")>();
  return { ...actual, loadAbTestPlan: async () => ({}) as never, planForDate: () => undefined, planSlot: () => undefined };
});
vi.mock("../src/scheduleAhead", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/scheduleAhead")>();
  return { ...actual, loadScheduledLog: async () => [] };
});
vi.mock("../src/postFacebook", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/postFacebook")>();
  return { ...actual, postFacebookPhoto: vi.fn(), postFacebookCarousel: vi.fn(), postFacebookReel: vi.fn() };
});
vi.mock("../src/postInstagram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/postInstagram")>();
  return { ...actual, postInstagramPhoto: vi.fn(), postInstagramCarousel: vi.fn(), postInstagramReel: vi.fn() };
});

import { hasRecordedPost, loadDailyContent, loadPostLog, writePostLog } from "../src/logging";
import { postCurrentSlot } from "../src/postCurrentSlot";
import { postFacebookPhoto } from "../src/postFacebook";
import { postInstagramPhoto } from "../src/postInstagram";
import { NonRetryableError } from "../src/retry";
import type { PostInput } from "../src/types";
import { DATE, approveAll, makeContent, noNetwork, publishedAs } from "./helpers/publishHarness";

describe("--all-due evening run", () => {
  let root: string;
  let savedOffSchedule: string | undefined;

  const run = () =>
    postCurrentSlot({
      root,
      allDue: true,
      dryRun: false,
      now: "2026-08-20T19:00:00+08:00",
      verifyPublicImageUrl: false,
      fetchImpl: noNetwork
    });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "publish-alldue-"));
    savedOffSchedule = process.env.ALLOW_OFF_SCHEDULE_PUBLISH;
    delete process.env.ALLOW_OFF_SCHEDULE_PUBLISH;

    vi.mocked(loadDailyContent).mockReset();
    vi.mocked(loadDailyContent).mockImplementation(async (date: string) =>
      date === DATE ? (makeContent() as never) : undefined
    );
    vi.mocked(postFacebookPhoto).mockReset();
    vi.mocked(postFacebookPhoto).mockImplementation(publishedAs("facebook"));
    vi.mocked(postInstagramPhoto).mockReset();
    vi.mocked(postInstagramPhoto).mockImplementation(publishedAs("instagram"));
    await approveAll(root);
  });

  afterEach(async () => {
    if (savedOffSchedule === undefined) delete process.env.ALLOW_OFF_SCHEDULE_PUBLISH;
    else process.env.ALLOW_OFF_SCHEDULE_PUBLISH = savedOffSchedule;
    await rm(root, { recursive: true, force: true });
  });

  it("skips this morning's published slot and still publishes the evening slot", async () => {
    await writePostLog(
      DATE,
      (["facebook", "instagram"] as const).map((platform) => ({
        date: DATE,
        slot: 1,
        platform,
        status: "success" as const,
        dry_run: false,
        attempts: 1,
        post_id: `${platform}-morning`,
        created_at: "2026-08-20T00:01:00.000Z"
      })),
      root
    );

    const results = await run();

    expect(vi.mocked(postFacebookPhoto).mock.calls.map((call) => call[0].slot)).toEqual([2]);
    expect(results.filter((entry) => entry.slot === 1).map((entry) => entry.status)).toEqual(["skipped", "skipped"]);
    expect(results.filter((entry) => entry.slot === 2).map((entry) => entry.status)).toEqual(["success", "success"]);
  });

  it("still tries the evening slot when an earlier slot fails, then reports that failure", async () => {
    await expect(run()).rejects.toThrow(/Refusing to live-publish slot 1/);

    expect(vi.mocked(postFacebookPhoto).mock.calls.map((call) => call[0].slot)).toEqual([2]);
    const log = await loadPostLog(DATE, root);
    expect(hasRecordedPost(log, 2, "facebook", false)).toBe(true);
    expect(hasRecordedPost(log, 2, "instagram", false)).toBe(true);
  });

  it("reports every failing slot in one error and writes nothing to stderr mid-run", async () => {
    vi.mocked(postFacebookPhoto).mockImplementation(async (input: PostInput) => {
      if (input.slot === 2) throw new NonRetryableError("slot 2 facebook commit timed out");
      return publishedAs("facebook")(input);
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const error = await run().then(
        () => undefined,
        (caught: unknown) => caught
      );
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toMatch(/slot 1: Refusing to live-publish slot 1/);
      expect(message).toMatch(/slot 2: slot 2 facebook commit timed out/);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
    const log = await loadPostLog(DATE, root);
    expect(hasRecordedPost(log, 2, "instagram", false)).toBe(true);
  });
});
