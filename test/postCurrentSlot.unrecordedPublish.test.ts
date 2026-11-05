import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/logging", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/logging")>();
  return { ...actual, loadDailyContent: vi.fn(), appendPostLog: vi.fn(actual.appendPostLog) };
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

import { appendPostLog, hasRecordedPost, loadDailyContent, loadPostLog } from "../src/logging";
import { postCurrentSlot } from "../src/postCurrentSlot";
import { postFacebookPhoto } from "../src/postFacebook";
import { postInstagramPhoto } from "../src/postInstagram";
import { NonRetryableError } from "../src/retry";
import type { PostInput, PostLogEntry } from "../src/types";
import { DATE, approveAll, makeContent, noNetwork, publishedAs } from "./helpers/publishHarness";

function eperm(): Error {
  return Object.assign(new Error("EPERM: operation not permitted, rename posted-log tmp"), { code: "EPERM" });
}

describe("a post whose posted-log write fails", () => {
  let root: string;
  let savedOffSchedule: string | undefined;
  let actualLogging: typeof import("../src/logging");

  const lockPath = (slot: number) => join(root, "data", "publish-locks", `${DATE}-slot${slot}.lock`);
  const runSlot1 = () =>
    postCurrentSlot({
      root,
      slot: 1,
      dryRun: false,
      now: "2026-08-20T08:05:00+08:00",
      verifyPublicImageUrl: false,
      fetchImpl: noNetwork
    });
  const failFacebookLogWrites = () =>
    vi.mocked(appendPostLog).mockImplementation(async (entry: PostLogEntry, logRoot?: string) => {
      if (entry.platform === "facebook") throw eperm();
      return actualLogging.appendPostLog(entry, logRoot);
    });

  beforeEach(async () => {
    actualLogging = await vi.importActual<typeof import("../src/logging")>("../src/logging");
    root = await mkdtemp(join(tmpdir(), "publish-unrecorded-"));
    savedOffSchedule = process.env.ALLOW_OFF_SCHEDULE_PUBLISH;
    delete process.env.ALLOW_OFF_SCHEDULE_PUBLISH;

    vi.mocked(loadDailyContent).mockReset();
    vi.mocked(loadDailyContent).mockImplementation(async (date: string) =>
      date === DATE ? (makeContent() as never) : undefined
    );
    vi.mocked(appendPostLog).mockReset();
    vi.mocked(appendPostLog).mockImplementation(actualLogging.appendPostLog);
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

  it("retries a failed posted-log write instead of recording a live post as failed", async () => {
    vi.mocked(appendPostLog).mockImplementationOnce(async () => {
      throw eperm();
    });

    await expect(runSlot1()).resolves.toBeDefined();

    const log = await loadPostLog(DATE, root);
    expect(log.filter((entry) => entry.platform === "facebook").map((entry) => entry.status)).toEqual(["success"]);
    expect(hasRecordedPost(log, 1, "instagram", false)).toBe(true);
    expect(postFacebookPhoto).toHaveBeenCalledTimes(1);
  });

  it("pins a published-but-unrecorded post, still publishes Instagram, and refuses the next run", async () => {
    failFacebookLogWrites();

    await expect(runSlot1()).rejects.toThrow(
      /facebook 2026-08-20 slot 1 published \(post_id fb-1\) but the posted log could not be written/
    );
    expect(vi.mocked(postInstagramPhoto).mock.calls.map((call) => call[0].slot)).toEqual([1]);
    const log = await loadPostLog(DATE, root);
    expect(hasRecordedPost(log, 1, "instagram", false)).toBe(true);
    expect(log.some((entry) => entry.platform === "facebook" && entry.status === "failed")).toBe(false);
    expect(await readFile(lockPath(1), "utf8")).toMatch(/^UNRECORDED_PUBLISH facebook post_id=fb-1 /);

    await expect(runSlot1()).rejects.toThrow(/posted log has no record/);
    expect(postFacebookPhoto).toHaveBeenCalledTimes(1);
  });

  it("pins the slot when a commit-uncertain failure cannot be recorded", async () => {
    failFacebookLogWrites();
    vi.mocked(postFacebookPhoto).mockImplementation(async () => {
      throw new NonRetryableError("Facebook /photos timed out after the commit call");
    });

    await expect(runSlot1()).rejects.toThrow(
      /facebook 2026-08-20 slot 1 may have published .*posted log could not be written/
    );
    expect(await readFile(lockPath(1), "utf8")).toMatch(/^UNRECORDED_PUBLISH facebook /);

    await expect(runSlot1()).rejects.toThrow(/posted log has no record/);
    expect(postFacebookPhoto).toHaveBeenCalledTimes(1);
  });

  it("does not reclaim a stale lock that names a platform the log never recorded", async () => {
    await mkdir(join(root, "data", "publish-locks"), { recursive: true });
    await writeFile(lockPath(1), "IN_FLIGHT facebook since 2026-08-20T00:01:00.000Z\n", "utf8");
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(lockPath(1), old, old);

    await expect(runSlot1()).rejects.toThrow(/stopped while publishing facebook/);
    expect(postFacebookPhoto).not.toHaveBeenCalled();
    expect(postInstagramPhoto).not.toHaveBeenCalled();
  });

  it("names the platform in the slot lock before Meta is called", async () => {
    const seen: string[] = [];
    vi.mocked(postFacebookPhoto).mockImplementation(async (input: PostInput) => {
      seen.push(await readFile(lockPath(1), "utf8"));
      return publishedAs("facebook")(input);
    });

    await runSlot1();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^IN_FLIGHT facebook since /);
  });

  it("does not append a duplicate row when a log write fails after the row landed", async () => {
    let first = true;
    vi.mocked(appendPostLog).mockImplementation(async (entry: PostLogEntry, logRoot?: string) => {
      await actualLogging.appendPostLog(entry, logRoot);
      if (first && entry.platform === "facebook") {
        first = false;
        throw eperm();
      }
    });

    await expect(runSlot1()).resolves.toBeDefined();

    const log = await loadPostLog(DATE, root);
    expect(log.filter((row) => row.platform === "facebook" && row.slot === 1)).toHaveLength(1);
  });
});
