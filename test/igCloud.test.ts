import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approvePost } from "../src/approvePost";
import { getConfig } from "../src/config";
import { stampDailyContentWrite } from "../src/contentPlan";
import { generateDailyContent } from "../src/generateDailyContent";
import {
  IG_CLOUD_SCHEMA,
  buildIgCloudSnapshot,
  igCloudDeps,
  igCloudMarkerPath,
  igCloudTakenBackPath,
  igInputFromSnapshot,
  pauseIgCloud,
  pushIgCloudSnapshot,
  readIgCloudMarker,
  readIgCloudTakenBack,
  reclaimIfCloudCannotPost,
  releaseIgCloudSnapshots,
  resumeIgCloud,
  syncIgCloudResult,
  takeBackIgCloudSlot,
  type GhResult,
  type GhRunner,
  type IgCloudSnapshot
} from "../src/igCloud";
import { snapshotScheduledDay } from "../src/igCloudBackfill";
import { loadApprovalLog, loadDailyContent, loadPostLog, writeApprovalLog } from "../src/logging";
import { postCurrentSlot } from "../src/postCurrentSlot";
import { loadScheduledLog, scheduleAheadFacebook } from "../src/scheduleAhead";
import type { AppConfig, DailySlot } from "../src/types";

const REPO = "tester/ig-cloud";

function ok(stdout = ""): GhResult {
  return { code: 0, stdout, stderr: "" };
}
function notFound(): GhResult {
  return { code: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" };
}

/** A fake gh CLI over an in-memory repo; records every call. */
function fakeGh(state: {
  mode?: string;
  /** The CLOUD_MODE variable was deleted (gh's own wording). */
  modeDeleted?: boolean;
  files: Map<string, string>;
  failPut?: boolean;
  landOnFailedPut?: boolean;
  /** DELETE fails without a 404. */
  failDelete?: boolean;
  /** DELETE answers success but the file stays. */
  deleteIgnored?: boolean;
  /** DELETE applies on the server, then its response is lost. */
  deleteAppliedButFailed?: boolean;
  /** GET fails without a 404 for these paths. */
  failGetPaths?: string[];
  /** Statuses `gh run list` reports; absent = no runs. */
  runs?: string[];
  failRunList?: boolean;
  commits?: Record<string, string>;
}) {
  const calls: string[][] = [];
  const gh: GhRunner = async (args) => {
    calls.push(args);
    if (args[0] === "variable" && args[1] === "get") {
      if (state.modeDeleted) return { code: 1, stdout: "", stderr: "variable CLOUD_MODE was not found\n" };
      return state.mode === undefined ? notFound() : ok(`${state.mode}\n`);
    }
    if (args[0] === "run" && args[1] === "list") {
      if (state.failRunList) return { code: 1, stdout: "", stderr: "gh: connection reset" };
      return ok(JSON.stringify((state.runs ?? []).map((status) => ({ status }))));
    }
    if (args[0] === "variable" && args[1] === "set") {
      state.mode = args[args.indexOf("--body") + 1];
      return ok();
    }
    if (args[0] === "workflow" && args[1] === "run") return ok();
    if (args[0] !== "api") return { code: 1, stdout: "", stderr: "unexpected gh call" };
    const commit = /^repos\/([^/]+\/[^/]+)\/commits\/(.+)$/.exec(args[1] ?? "");
    if (commit) {
      const sha = state.commits?.[`${commit[1]}@${commit[2]}`];
      return sha ? ok(`${sha}\n`) : notFound();
    }
    const method = args.includes("-X") ? args[args.indexOf("-X") + 1] : "GET";
    const target = args.find((arg) => arg.startsWith(`repos/${REPO}/contents/`)) ?? "";
    const path = target.slice(`repos/${REPO}/contents/`.length);
    const field = (name: string) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
    if (method === "GET") {
      if (state.failGetPaths?.includes(path)) return { code: 1, stdout: "", stderr: "gh: connection reset" };
      const text = state.files.get(path);
      if (text === undefined) return notFound();
      return ok(JSON.stringify({ sha: `sha-${path}`, content: Buffer.from(text, "utf8").toString("base64") }));
    }
    if (method === "PUT") {
      if (state.failPut) {
        if (state.landOnFailedPut) state.files.set(path, Buffer.from(field("content") ?? "", "base64").toString("utf8"));
        return { code: 1, stdout: "", stderr: "gh: connection reset" };
      }
      state.files.set(path, Buffer.from(field("content") ?? "", "base64").toString("utf8"));
      return ok("{}");
    }
    if (method === "DELETE") {
      if (state.failDelete) return { code: 1, stdout: "", stderr: "gh: connection reset" };
      if (state.deleteAppliedButFailed) {
        state.files.delete(path);
        return { code: 1, stdout: "", stderr: "gh: connection reset" };
      }
      if (!state.deleteIgnored) state.files.delete(path);
      return ok("{}");
    }
    return { code: 1, stdout: "", stderr: "unexpected method" };
  };
  return { gh, calls };
}

function shaOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The public site and raw GitHub: each URL serves "media:<url>" unless a body is given; listed URLs 404. */
function fakeMedia(bodies: Record<string, string> = {}, missing: string[] = []): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    if (missing.includes(url)) return new Response("not found", { status: 404 });
    return new Response(bodies[url] ?? `media:${url}`, { status: 200 });
  }) as typeof fetch;
}

const media = fakeMedia();

/** What the cloud should receive for a snapshot whose media all serve their default body. */
function fingerprinted(snapshot: IgCloudSnapshot): IgCloudSnapshot {
  return {
    ...snapshot,
    image_sha256s: snapshot.image_urls.map((url) => shaOf(`media:${url}`)),
    image_urls_pinned: snapshot.image_urls.map(() => null)
  };
}

function liveConfig(): AppConfig {
  return getConfig({
    ...process.env,
    DRY_RUN: "false",
    PUBLIC_IMAGE_BASE_URL: "https://tester.github.io/laundry-social-auto-poster",
    META_ACCESS_TOKEN: "test-token-value",
    FB_PAGE_ID: "111000111",
    IG_USER_ID: "222000222",
    VERIFY_PUBLIC_IMAGE_URL: "false"
  });
}

async function installCloud(root: string): Promise<void> {
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(join(root, "data", "ig-cloud.json"), JSON.stringify({ repo: REPO }), "utf8");
}

function slotFixture(): DailySlot {
  return {
    slot: 2,
    time: "20:30",
    topic: "名牌包發霉,先別自己硬擦",
    format: "image-post",
    media_type: "carousel",
    instagram_caption: "IG 版文案,私訊我們",
    facebook_caption: "FB 版文案,傳 LINE 給我們",
    local_image_path: "docs/assets/2026-10-02/slot-02.png",
    public_image_url: "https://tester.github.io/a/slot-02.png"
  } as unknown as DailySlot;
}

function sampleSnapshot(overrides: Partial<IgCloudSnapshot> = {}): IgCloudSnapshot {
  return {
    ...buildIgCloudSnapshot({
      date: "2026-10-02",
      slot: slotFixture(),
      publishUnix: Math.floor(Date.parse("2026-10-02T20:30:00+08:00") / 1000),
      igMediaType: "carousel",
      imageUrls: ["https://tester.github.io/a/slot-02.png", "https://tester.github.io/a/slot-02-slide-02.png"],
      config: liveConfig(),
      fbScheduledPostId: "fb-sched-9",
      now: new Date("2026-09-29T13:40:00Z")
    }),
    ...overrides
  };
}

afterEach(() => {
  igCloudDeps.gh = async () => ({ code: 1, stdout: "", stderr: "gh not stubbed in this test" });
});

describe("buildIgCloudSnapshot", () => {
  it("carries the Facebook caption, the Facebook queue id and a first comment", () => {
    const snapshot = sampleSnapshot();
    expect(snapshot.schema).toBe(IG_CLOUD_SCHEMA);
    expect(snapshot.caption).toBe("FB 版文案,傳 LINE 給我們");
    expect(snapshot.fb_scheduled_post_id).toBe("fb-sched-9");
    expect(snapshot.first_comment).toContain("go/line.html?source=ig-comment");
    expect(snapshot.video_url).toBeNull();
    expect(snapshot.facebook_page_id).toBe("111000111");
  });

  it("drops image urls for a reel and keeps the video identity", () => {
    const reel = buildIgCloudSnapshot({
      date: "2026-10-02",
      slot: slotFixture(),
      publishUnix: 1,
      igMediaType: "reel",
      imageUrls: ["https://tester.github.io/a/cover.png"],
      videoUrl: "https://tester.github.io/a/slot-02.mp4",
      videoBytes: 50_639_276,
      videoSha256: "8351d117",
      config: liveConfig(),
      fbScheduledPostId: "fb-sched-9"
    });
    expect(reel.image_urls).toEqual([]);
    expect(reel.video_url).toBe("https://tester.github.io/a/slot-02.mp4");
    expect(reel.video_bytes).toBe(50_639_276);
    expect(reel.video_sha256).toBe("8351d117");
  });
});

describe("pushIgCloudSnapshot", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ig-cloud-push-"));
  });

  it("does nothing and calls nothing when the integration is not installed", async () => {
    const { gh, calls } = fakeGh({ mode: "live", files: new Map() });
    const outcome = await pushIgCloudSnapshot(sampleSnapshot(), root, { gh, fetchImpl: media });
    expect(outcome.pushed).toBe(false);
    expect(calls).toEqual([]);
    expect(await readIgCloudMarker(root, "2026-10-02", 2)).toBeUndefined();
  });

  it("keeps Instagram on this PC unless the cloud is live", async () => {
    await installCloud(root);
    for (const mode of ["shadow", "off", undefined]) {
      const state = { mode, files: new Map<string, string>() };
      const { gh } = fakeGh(state);
      const outcome = await pushIgCloudSnapshot(sampleSnapshot(), root, { gh, fetchImpl: media });
      expect(outcome.pushed).toBe(false);
      expect(state.files.size).toBe(0);
      expect(await readIgCloudMarker(root, "2026-10-02", 2)).toBeUndefined();
    }
  });

  it("pushes the exact snapshot and claims the slot when the cloud is live", async () => {
    await installCloud(root);
    const state = { mode: "live", files: new Map<string, string>() };
    const { gh } = fakeGh(state);
    const snapshot = sampleSnapshot();
    const outcome = await pushIgCloudSnapshot(snapshot, root, { gh, fetchImpl: media });
    expect(outcome.pushed).toBe(true);
    // The cloud gets the fingerprint of every image as the site served it.
    expect(JSON.parse(state.files.get("queue/2026-10-02-slot2.json") ?? "{}")).toEqual(fingerprinted(snapshot));
    expect(await readIgCloudMarker(root, "2026-10-02", 2)).toEqual(fingerprinted(snapshot));
  });

  it("keeps a slot on this PC when the cloud has no run at its time", async () => {
    await installCloud(root);
    const state = { mode: "live", files: new Map<string, string>() };
    const { gh, calls } = fakeGh(state);
    const at1900 = Math.floor(Date.parse("2026-10-02T19:00:00+08:00") / 1000);
    const outcome = await pushIgCloudSnapshot(sampleSnapshot({ publish_unix: at1900 }), root, { gh });
    expect(outcome).toMatchObject({ pushed: false, reason: expect.stringContaining("19:00 Taipei has no cloud run") });
    expect(calls).toEqual([]);
    expect(await readIgCloudMarker(root, "2026-10-02", 2)).toBeUndefined();
  });

  it("gives the slot back to this PC when the push provably did not land", async () => {
    await installCloud(root);
    const state = { mode: "live", files: new Map<string, string>(), failPut: true };
    const { gh } = fakeGh(state);
    await expect(pushIgCloudSnapshot(sampleSnapshot(), root, { gh, fetchImpl: media })).rejects.toThrow(/PUT/);
    expect(await readIgCloudMarker(root, "2026-10-02", 2)).toBeUndefined();
  });

  it("keeps the slot with the cloud when a failed push actually landed", async () => {
    await installCloud(root);
    const state = { mode: "live", files: new Map<string, string>(), failPut: true, landOnFailedPut: true };
    const { gh } = fakeGh(state);
    const outcome = await pushIgCloudSnapshot(sampleSnapshot(), root, { gh, fetchImpl: media });
    expect(outcome.pushed).toBe(true);
    expect(await readIgCloudMarker(root, "2026-10-02", 2)).toBeDefined();
  });
});

describe("syncIgCloudResult and release", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ig-cloud-sync-"));
    await installCloud(root);
    const { gh } = fakeGh({ mode: "live", files: new Map() });
    await pushIgCloudSnapshot(sampleSnapshot(), root, { gh, fetchImpl: media });
  });

  it("records a published cloud result once, with its first comment", async () => {
    const files = new Map<string, string>([
      [
        "results/2026-10-02-slot2.json",
        JSON.stringify({ date: "2026-10-02", slot: 2, mode: "live", status: "published", post_id: "ig-77", comment_id: "c-9" })
      ]
    ]);
    const { gh } = fakeGh({ mode: "live", files });
    const entry = await syncIgCloudResult(root, "2026-10-02", 2, { gh });
    expect(entry).toMatchObject({ platform: "instagram", status: "success", post_id: "ig-77", published_media_type: "carousel" });
    expect(await syncIgCloudResult(root, "2026-10-02", 2, { gh })).toBeUndefined();
    const log = await loadPostLog("2026-10-02", root);
    expect(log.filter((row) => row.platform === "instagram")).toHaveLength(1);
    const comments = JSON.parse(await readFile(join(root, "data", "first-comments", "2026-10-02.json"), "utf8"));
    expect(comments).toEqual([expect.objectContaining({ slot: 2, media_id: "ig-77", comment_id: "c-9" })]);
  });

  it("records already_live in the posted log without claiming its first comment", async () => {
    const files = new Map<string, string>([
      [
        "results/2026-10-02-slot2.json",
        JSON.stringify({ date: "2026-10-02", slot: 2, mode: "live", status: "already_live", post_id: "ig-79" })
      ]
    ]);
    const { gh } = fakeGh({ mode: "live", files });
    const entry = await syncIgCloudResult(root, "2026-10-02", 2, { gh });
    expect(entry).toMatchObject({ platform: "instagram", status: "success", post_id: "ig-79" });
    expect(await loadPostLog("2026-10-02", root)).toContainEqual(expect.objectContaining({ post_id: "ig-79", status: "success" }));
    expect(await readFile(join(root, "data", "first-comments", "2026-10-02.json"), "utf8").catch(() => undefined)).toBeUndefined();
  });

  it("ignores shadow results and missing results", async () => {
    const { gh: missing } = fakeGh({ mode: "live", files: new Map() });
    expect(await syncIgCloudResult(root, "2026-10-02", 2, { gh: missing })).toBeUndefined();
    const files = new Map([
      ["results/2026-10-02-slot2.json", JSON.stringify({ date: "2026-10-02", slot: 2, mode: "shadow", status: "shadow_ok" })]
    ]);
    const { gh } = fakeGh({ mode: "live", files });
    expect(await syncIgCloudResult(root, "2026-10-02", 2, { gh })).toBeUndefined();
    // Only a live run's result may count as published, whatever it claims.
    const mislabelled = new Map([
      [
        "results/2026-10-02-slot2.json",
        JSON.stringify({ date: "2026-10-02", slot: 2, mode: "shadow", status: "published", post_id: "not-real" })
      ]
    ]);
    const { gh: shadowGh } = fakeGh({ mode: "live", files: mislabelled });
    expect(await syncIgCloudResult(root, "2026-10-02", 2, { gh: shadowGh })).toBeUndefined();
    expect(await loadPostLog("2026-10-02", root)).toEqual([]);
  });

  it("marks the first comment as the cloud's even before the cloud reports one", async () => {
    // The cloud commits the post first and the comment seconds later. A sync in
    // between must still stop the local first-comment step from adding a second.
    const files = new Map([
      ["results/2026-10-02-slot2.json", JSON.stringify({ date: "2026-10-02", slot: 2, mode: "live", status: "published", post_id: "ig-78" })]
    ]);
    const { gh } = fakeGh({ mode: "live", files });
    await syncIgCloudResult(root, "2026-10-02", 2, { gh });
    const comments = JSON.parse(await readFile(join(root, "data", "first-comments", "2026-10-02.json"), "utf8"));
    expect(comments).toEqual([expect.objectContaining({ slot: 2, media_id: "ig-78", comment_id: "cloud" })]);
  });

  it("records an uncertain cloud publish so nothing here posts it again", async () => {
    const files = new Map([
      ["results/2026-10-02-slot2.json", JSON.stringify({ date: "2026-10-02", slot: 2, mode: "live", status: "uncertain", error: "lost" })]
    ]);
    const { gh } = fakeGh({ mode: "live", files });
    const entry = await syncIgCloudResult(root, "2026-10-02", 2, { gh });
    expect(entry?.status).toBe("uncertain");
  });

  it("release hands future slots back and deletes them from the cloud queue", async () => {
    const state = { mode: "live", files: new Map<string, string>([["queue/2026-10-02-slot2.json", "{}"]]) };
    const { gh } = fakeGh(state);
    const { released, failed } = await releaseIgCloudSnapshots(root, { gh, now: new Date("2026-10-01T12:00:00Z") });
    expect(released).toEqual(["2026-10-02-slot2.json"]);
    expect(failed).toEqual([]);
    expect(state.files.has("queue/2026-10-02-slot2.json")).toBe(false);
    expect(await readIgCloudMarker(root, "2026-10-02", 2)).toBeUndefined();
  });

  it("release leaves slots whose time has passed", async () => {
    const { gh } = fakeGh({ mode: "live", files: new Map() });
    const { released } = await releaseIgCloudSnapshots(root, { gh, now: new Date("2026-10-03T00:00:00Z") });
    expect(released).toEqual([]);
    expect(await readIgCloudMarker(root, "2026-10-02", 2)).toBeDefined();
  });
});

describe("a switched-off cloud gives its slots back", () => {
  const DATE = "2026-10-02";
  const QUEUED = `queue/${DATE}-slot2.json`;
  const RESULT = `results/${DATE}-slot2.json`;
  const noWait = { sleep: async () => undefined, waitMs: 3, pollMs: 1, settleMs: 0 };
  let root: string;
  let snapshot: IgCloudSnapshot;

  function cloud(state: Omit<Parameters<typeof fakeGh>[0], "files">, includeQueued = true) {
    const full = { ...state, files: new Map(includeQueued ? [[QUEUED, JSON.stringify(snapshot)]] : []) };
    return { state: full, ...fakeGh(full) };
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ig-cloud-takeback-"));
    await installCloud(root);
    const pushed = await pushIgCloudSnapshot(sampleSnapshot(), root, { gh: fakeGh({ mode: "live", files: new Map() }).gh, fetchImpl: media });
    snapshot = pushed.snapshot as IgCloudSnapshot;
  });

  for (const [name, setup] of [
    ["off", { mode: "off" }],
    ["shadow", { mode: "shadow" }],
    ["a deleted CLOUD_MODE variable", { modeDeleted: true }]
  ] as const) {
    it(`takes the slot back from a cloud switched to ${name}, with what Facebook got`, async () => {
      const { state, gh } = cloud(setup);
      const outcome = await reclaimIfCloudCannotPost(root, DATE, 2, { gh, ...noWait });
      expect(outcome?.status).toBe("taken_back");
      expect(state.files.has(QUEUED)).toBe(false);
      expect(await readIgCloudMarker(root, DATE, 2)).toBeUndefined();
      expect(await readIgCloudTakenBack(root, DATE, 2)).toEqual(snapshot);
    });
  }

  it("leaves the slot with a live cloud, and with a switch it cannot read", async () => {
    for (const setup of [{ mode: "live" }, {}]) {
      const { state, gh, calls } = cloud(setup);
      expect(await reclaimIfCloudCannotPost(root, DATE, 2, { gh, ...noWait })).toBeUndefined();
      expect(calls.some((args) => args.includes("DELETE"))).toBe(false);
      expect(state.files.has(QUEUED)).toBe(true);
      expect(await readIgCloudMarker(root, DATE, 2)).toBeDefined();
    }
  });

  it("takes the slot back from a live cloud when its queue has no snapshot", async () => {
    const { state, gh } = cloud({ mode: "live" }, false);
    const outcome = await reclaimIfCloudCannotPost(root, DATE, 2, { gh, ...noWait });
    expect(outcome?.status).toBe("taken_back");
    expect(await readIgCloudMarker(root, DATE, 2)).toBeUndefined();
    expect(await readIgCloudTakenBack(root, DATE, 2)).toEqual(snapshot);
    expect(state.files.has(QUEUED)).toBe(false);
  });

  it("keeps an already-missing live snapshot local on a read failure and takes it back on retry", async () => {
    const { state, gh, calls } = cloud({ mode: "live", failRunList: true }, false);
    const kept = await reclaimIfCloudCannotPost(root, DATE, 2, { gh, ...noWait });
    expect(kept?.status).toBe("kept");
    expect(calls.filter((args) => args.includes("-X") && args[args.indexOf("-X") + 1] === "PUT")).toHaveLength(0);
    expect(state.files.has(QUEUED)).toBe(false);
    expect(await readIgCloudMarker(root, DATE, 2)).toEqual(snapshot);

    state.failRunList = false;
    const takenBack = await reclaimIfCloudCannotPost(root, DATE, 2, { gh, ...noWait });
    expect(takenBack?.status).toBe("taken_back");
    expect(calls.filter((args) => args.includes("-X") && args[args.indexOf("-X") + 1] === "PUT")).toHaveLength(0);
    expect(await readIgCloudMarker(root, DATE, 2)).toBeUndefined();
    expect(await readIgCloudTakenBack(root, DATE, 2)).toEqual(snapshot);
  });

  it("still restores a kept snapshot when the cloud switch is off", async () => {
    const { calls, gh } = cloud({ mode: "off", failRunList: true });
    const outcome = await reclaimIfCloudCannotPost(root, DATE, 2, { gh, ...noWait });
    expect(outcome?.status).toBe("kept");
    expect(calls.filter((args) => args.includes("-X") && args[args.indexOf("-X") + 1] === "PUT")).toHaveLength(1);
  });

  it("keeps a live slot when its queue snapshot cannot be read", async () => {
    const { state, gh, calls } = cloud({ mode: "live", failGetPaths: [QUEUED] });
    expect(await reclaimIfCloudCannotPost(root, DATE, 2, { gh, ...noWait })).toBeUndefined();
    expect(calls.some((args) => args.includes("DELETE"))).toBe(false);
    expect(state.files.has(QUEUED)).toBe(true);
    expect(await readIgCloudMarker(root, DATE, 2)).toBeDefined();
  });

  it("does not withdraw a slot the cloud already posted", async () => {
    const posted = JSON.stringify({ date: DATE, slot: 2, mode: "live", status: "published", post_id: "ig-1" });
    await syncIgCloudResult(root, DATE, 2, { gh: fakeGh({ mode: "live", files: new Map([[RESULT, posted]]) }).gh });
    const { calls, gh } = cloud({ mode: "off" });
    expect(await reclaimIfCloudCannotPost(root, DATE, 2, { gh, ...noWait })).toBeUndefined();
    expect(calls.some((args) => args.includes("DELETE"))).toBe(false);
  });

  it("waits out a cloud run in flight and records its post instead of posting again", async () => {
    const { state, gh } = cloud({ mode: "off", runs: ["in_progress"] });
    const outcome = await takeBackIgCloudSlot(root, DATE, 2, {
      gh,
      ...noWait,
      waitMs: 10,
      sleep: async () => {
        // The run got past its check before the withdrawal: it posts, records, ends.
        state.files.set(RESULT, JSON.stringify({ date: DATE, slot: 2, mode: "live", status: "published", post_id: "ig-cloud-9" }));
        state.runs = ["completed"];
      }
    });
    expect(outcome.status).toBe("cloud_posted");
    expect(await readIgCloudMarker(root, DATE, 2)).toBeDefined();
    expect(await readIgCloudTakenBack(root, DATE, 2)).toBeUndefined();
    const log = await loadPostLog(DATE, root);
    expect(log.find((row) => row.platform === "instagram")).toMatchObject({ status: "success", post_id: "ig-cloud-9" });
  });

  it("looks at the run list a second time, for a run GitHub had not listed yet", async () => {
    const { state, gh } = cloud({ mode: "off" });
    let lists = 0;
    const counting: GhRunner = async (args) => {
      if (args[0] === "run") {
        lists += 1;
        // Listed only from the second look on, then it finishes with a post.
        state.runs = lists === 2 ? ["queued"] : [];
      }
      return gh(args);
    };
    const outcome = await takeBackIgCloudSlot(root, DATE, 2, {
      gh: counting,
      ...noWait,
      waitMs: 10,
      sleep: async (milliseconds) => {
        if (milliseconds === noWait.pollMs) {
          state.files.set(RESULT, JSON.stringify({ date: DATE, slot: 2, mode: "live", status: "published", post_id: "ig-late" }));
        }
      }
    });
    expect(outcome.status).toBe("cloud_posted");
    expect(await readIgCloudTakenBack(root, DATE, 2)).toBeUndefined();
  });

  it("keeps the slot when the withdrawal fails or cannot be confirmed", async () => {
    for (const setup of [{ mode: "off", failDelete: true }, { mode: "off", deleteIgnored: true }]) {
      const { gh } = cloud(setup);
      const outcome = await takeBackIgCloudSlot(root, DATE, 2, { gh, ...noWait });
      expect(outcome.status).toBe("kept");
      expect(await readIgCloudMarker(root, DATE, 2)).toBeDefined();
      expect(await readIgCloudTakenBack(root, DATE, 2)).toBeUndefined();
    }
  });

  it("restores the snapshot when DELETE applied but its response was lost", async () => {
    const { state, gh } = cloud({ mode: "off", deleteAppliedButFailed: true });
    const outcome = await takeBackIgCloudSlot(root, DATE, 2, { gh, ...noWait });
    expect(outcome.status).toBe("kept");
    expect(outcome.reason).toContain("snapshot restored");
    expect(JSON.parse(state.files.get(QUEUED) ?? "null")).toEqual(snapshot);
    expect(await readIgCloudMarker(root, DATE, 2)).toBeDefined();
  });

  it("keeps the slot, with its snapshot back in the cloud queue, while a cloud run stays active or the run list cannot be read", async () => {
    for (const setup of [{ mode: "off", runs: ["in_progress"] }, { mode: "off", failRunList: true }]) {
      const { state, gh } = cloud(setup);
      const outcome = await takeBackIgCloudSlot(root, DATE, 2, { gh, ...noWait });
      expect(outcome.status).toBe("kept");
      expect(outcome.reason).toContain("snapshot restored");
      // The withdrawal did happen; what the cloud holds now is the same snapshot again.
      expect(JSON.parse(state.files.get(QUEUED) ?? "null")).toEqual(snapshot);
      expect(await readIgCloudMarker(root, DATE, 2)).toBeDefined();
      expect(await readIgCloudTakenBack(root, DATE, 2)).toBeUndefined();
    }
  });

  it("puts the snapshot back when the cloud's result cannot be read", async () => {
    const { state, gh } = cloud({ mode: "off", failGetPaths: [RESULT] });
    const outcome = await takeBackIgCloudSlot(root, DATE, 2, { gh, ...noWait });
    expect(outcome.status).toBe("kept");
    expect(outcome.reason).toContain("snapshot restored");
    expect(state.files.has(QUEUED)).toBe(true);
    expect(await readIgCloudMarker(root, DATE, 2)).toBeDefined();
    expect(await readIgCloudTakenBack(root, DATE, 2)).toBeUndefined();
  });

  it("says so when the snapshot could not be put back, and still keeps the marker", async () => {
    const { state, gh } = cloud({ mode: "off", failRunList: true, failPut: true });
    const outcome = await takeBackIgCloudSlot(root, DATE, 2, { gh, ...noWait });
    expect(outcome.status).toBe("kept");
    expect(outcome.reason).toContain("NOT restored");
    expect(outcome.reason).toContain("takes it back at its next run");
    expect(outcome.reason).not.toContain("--snapshot");
    expect(outcome.reason).not.toContain("--release");
    expect(state.files.has(QUEUED)).toBe(false);
    expect(await readIgCloudMarker(root, DATE, 2)).toBeDefined();
    expect(await readIgCloudTakenBack(root, DATE, 2)).toBeUndefined();
  });

  it("restores the snapshot when moving the marker to taken-back fails", async () => {
    const { state, gh } = cloud({ mode: "off" });
    await mkdir(igCloudTakenBackPath(root, DATE, 2), { recursive: true });
    const outcome = await takeBackIgCloudSlot(root, DATE, 2, { gh, ...noWait });
    expect(outcome.status).toBe("kept");
    expect(outcome.reason).toContain("could not move the marker");
    expect(outcome.reason).toContain("snapshot restored");
    expect(JSON.parse(state.files.get(QUEUED) ?? "null")).toEqual(snapshot);
    expect(await readIgCloudMarker(root, DATE, 2)).toBeDefined();
  });
});

describe("a taken-back slot posts the bytes Facebook got", () => {
  const site = ["https://tester.github.io/a/slot-02.png", "https://tester.github.io/a/slot-02-slide-02.png"];
  const pin = (url: string) => url.replace("https://tester.github.io/a/", "https://raw.githubusercontent.com/tester/site/abc/");
  const snapshot = (): IgCloudSnapshot => ({
    ...sampleSnapshot(),
    image_sha256s: [shaOf("A1"), shaOf("A2")],
    image_urls_pinned: [pin(site[0] ?? ""), null]
  });

  it("uses Facebook's caption and the site's images when they still match", async () => {
    const input = await igInputFromSnapshot(snapshot(), fakeMedia({ [site[0] ?? ""]: "A1", [site[1] ?? ""]: "A2" }));
    expect(input).toMatchObject({ caption: "FB 版文案,傳 LINE 給我們", mediaType: "carousel", imageUrls: site });
  });

  it("takes a replaced image from its pinned copy", async () => {
    const input = await igInputFromSnapshot(
      snapshot(),
      fakeMedia({ [site[0] ?? ""]: "B1", [pin(site[0] ?? "")]: "A1", [site[1] ?? ""]: "A2" })
    );
    expect(input.imageUrls).toEqual([pin(site[0] ?? ""), site[1]]);
  });

  it("posts nothing when neither the site nor a pinned copy has Facebook's bytes", async () => {
    await expect(
      igInputFromSnapshot(snapshot(), fakeMedia({ [site[0] ?? ""]: "B1", [pin(site[0] ?? "")]: "B1", [site[1] ?? ""]: "A2" }))
    ).rejects.toThrow("not posting a version Facebook did not get");
    await expect(
      igInputFromSnapshot(snapshot(), fakeMedia({ [site[0] ?? ""]: "A1", [site[1] ?? ""]: "B2" }))
    ).rejects.toThrow("not posting a version Facebook did not get");
  });

  it("posts nothing when the video is not the one Facebook got", async () => {
    const video = "https://tester.github.io/a/slot-02.mp4";
    const reel = { ...snapshot(), ig_media_type: "reel" as const, image_urls: [], image_sha256s: [], image_urls_pinned: [], video_url: video, video_sha256: shaOf("V1") };
    await expect(igInputFromSnapshot(reel, fakeMedia({ [video]: "V2" }))).rejects.toThrow("not posting a version Facebook did not get");
    await expect(igInputFromSnapshot(reel, fakeMedia({ [video]: "V1" }))).resolves.toMatchObject({ mediaType: "reel", videoUrl: video });
  });
});

describe("the pause brake reaches the cloud", () => {
  const state = { reason: "老闆看片中", since: "2026-10-01T12:00:00.000Z", paused_by: "owner" };
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ig-cloud-pause-"));
  });

  it("writes PAUSED to the cloud repo and moves no slot", async () => {
    await installCloud(root);
    const { gh } = fakeGh({ mode: "live", files: new Map() });
    await pushIgCloudSnapshot(sampleSnapshot(), root, { gh, fetchImpl: media });
    const repo = { mode: "live", files: new Map<string, string>([["queue/2026-10-02-slot2.json", "{}"]]) };
    const { gh: pauseGh } = fakeGh(repo);
    await pauseIgCloud(root, state, { gh: pauseGh });
    expect(JSON.parse(repo.files.get("PAUSED") ?? "null")).toEqual(state);
    expect(repo.mode).toBe("live");
    expect(repo.files.has("queue/2026-10-02-slot2.json")).toBe(true);
    expect(await readIgCloudMarker(root, "2026-10-02", 2)).toBeDefined();

    const { gh: resumeGh, calls } = fakeGh(repo);
    await resumeIgCloud(root, { gh: resumeGh });
    expect(repo.files.has("PAUSED")).toBe(false);
    expect(repo.mode).toBe("live");
    // The pause may have covered a slot's last scheduled run: run once now.
    expect(calls).toContainEqual(["workflow", "run", "ig-publish", "--repo", REPO]);
  });

  it("clearing when nothing was paused does not start a cloud run", async () => {
    await installCloud(root);
    const { gh, calls } = fakeGh({ mode: "live", files: new Map() });
    const message = await resumeIgCloud(root, { gh });
    expect(message).toContain("沒有 PAUSED");
    expect(calls.some((args) => args[0] === "workflow")).toBe(false);
  });

  it("falls back to switching the cloud off, and clearing the pause switches it back on", async () => {
    await installCloud(root);
    const repo = { mode: "live", files: new Map<string, string>(), failPut: true };
    const { gh } = fakeGh(repo);
    const message = await pauseIgCloud(root, state, { gh });
    expect(repo.mode).toBe("off");
    expect(message).toContain("CLOUD_MODE");

    repo.failPut = false;
    const { gh: resumeGh, calls } = fakeGh(repo);
    await resumeIgCloud(root, { gh: resumeGh });
    expect(repo.mode).toBe("live");
    expect(calls).toContainEqual(["workflow", "run", "ig-publish", "--repo", REPO]);
    // Done once: a second clear has nothing of the pause's left to undo.
    repo.mode = "off";
    const { gh: againGh, calls: againCalls } = fakeGh(repo);
    await resumeIgCloud(root, { gh: againGh });
    expect(repo.mode).toBe("off");
    expect(againCalls.some((args) => args[0] === "workflow")).toBe(false);
  });

  it("never switches on a cloud the owner turned off", async () => {
    await installCloud(root);
    const repo = { mode: "off", files: new Map<string, string>([["PAUSED", "{}"]]) };
    const { gh, calls } = fakeGh(repo);
    const message = await resumeIgCloud(root, { gh });
    expect(repo.files.has("PAUSED")).toBe(false);
    expect(repo.mode).toBe("off");
    expect(message).toContain(`gh variable set CLOUD_MODE --body live --repo ${REPO}`);
    expect(calls.some((args) => args[0] === "workflow")).toBe(false);
  });

  it("calls nothing when the integration is not installed", async () => {
    const { gh, calls } = fakeGh({ mode: "live", files: new Map() });
    await pauseIgCloud(root, state, { gh });
    await resumeIgCloud(root, { gh });
    expect(calls).toEqual([]);
  });
});

describe("the cloud gets the exact bytes Facebook got", () => {
  const base = liveConfig().publicImageBaseUrl.replace(/\/+$/, "");
  const one = `${base}/assets/2026-10-02/slot-02.png`;
  const two = `${base}/assets/2026-10-02/slot-02-slide-02.png`;
  const siteCommit = "a".repeat(40);
  const sourceCommit = "b".repeat(40);
  const rawSite = (path: string) => `https://raw.githubusercontent.com/tester/site/${siteCommit}/${path}`;
  const rawSource = (path: string) => `https://raw.githubusercontent.com/tester/source/${sourceCommit}/docs/${path}`;
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ig-cloud-pin-"));
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(
      join(root, "data", "ig-cloud.json"),
      JSON.stringify({
        repo: REPO,
        pin_sources: [
          { repo: "tester/site", ref: "main", prefix: "" },
          { repo: "tester/source", ref: "live", prefix: "docs/" }
        ]
      }),
      "utf8"
    );
  });
  const commits = { "tester/site@main": siteCommit, "tester/source@live": sourceCommit };

  it("pins each image to the first commit that holds the same bytes", async () => {
    const state = { mode: "live", files: new Map<string, string>(), commits };
    const { gh } = fakeGh(state);
    // Slide 2 at the mirror commit is a different file; the source repo has the right one.
    const fetchImpl = fakeMedia({
      [one]: "bytes-1",
      [two]: "bytes-2",
      [rawSite("assets/2026-10-02/slot-02.png")]: "bytes-1",
      [rawSite("assets/2026-10-02/slot-02-slide-02.png")]: "swapped",
      [rawSource("assets/2026-10-02/slot-02-slide-02.png")]: "bytes-2"
    });
    const outcome = await pushIgCloudSnapshot(sampleSnapshot({ image_urls: [one, two] }), root, { gh, fetchImpl });
    expect(outcome.pushed).toBe(true);
    const pushed = JSON.parse(state.files.get("queue/2026-10-02-slot2.json") ?? "{}") as IgCloudSnapshot;
    expect(pushed.image_sha256s).toEqual([shaOf("bytes-1"), shaOf("bytes-2")]);
    expect(pushed.image_urls_pinned).toEqual([
      rawSite("assets/2026-10-02/slot-02.png"),
      rawSource("assets/2026-10-02/slot-02-slide-02.png")
    ]);
  });

  it("leaves an image unpinned when no commit holds its bytes", async () => {
    const state = { mode: "live", files: new Map<string, string>(), commits };
    const { gh } = fakeGh(state);
    const fetchImpl = fakeMedia({ [one]: "bytes-1", [two]: "bytes-2" });
    await pushIgCloudSnapshot(sampleSnapshot({ image_urls: [one, two] }), root, { gh, fetchImpl });
    const pushed = JSON.parse(state.files.get("queue/2026-10-02-slot2.json") ?? "{}") as IgCloudSnapshot;
    expect(pushed.image_urls_pinned).toEqual([null, null]);
  });

  it("keeps the slot on this PC when an image cannot be read", async () => {
    const state = { mode: "live", files: new Map<string, string>(), commits };
    const { gh } = fakeGh(state);
    const outcome = await pushIgCloudSnapshot(sampleSnapshot({ image_urls: [one, two] }), root, {
      gh,
      fetchImpl: fakeMedia({}, [two])
    });
    expect(outcome).toMatchObject({ pushed: false, reason: expect.stringContaining("could not pin down") });
    expect(state.files.size).toBe(0);
    expect(await readIgCloudMarker(root, "2026-10-02", 2)).toBeUndefined();
  });

  it("keeps a Reel on this PC when the site's video is not the file Facebook was scheduled with", async () => {
    const video = `${base}/assets/2026-10-02/slot-02.mp4`;
    const reel = sampleSnapshot({
      ig_media_type: "reel",
      image_urls: [],
      video_url: video,
      video_bytes: 13,
      video_sha256: shaOf("scheduled-mp4")
    });
    const swapped = { mode: "live", files: new Map<string, string>(), commits };
    const refused = await pushIgCloudSnapshot(reel, root, { gh: fakeGh(swapped).gh, fetchImpl: fakeMedia({ [video]: "regenerated-mp4" }) });
    expect(refused).toMatchObject({ pushed: false, reason: expect.stringContaining("video differs") });
    expect(swapped.files.size).toBe(0);
    expect(await readIgCloudMarker(root, "2026-10-02", 2)).toBeUndefined();

    const same = { mode: "live", files: new Map<string, string>(), commits };
    const accepted = await pushIgCloudSnapshot(reel, root, { gh: fakeGh(same).gh, fetchImpl: fakeMedia({ [video]: "scheduled-mp4" }) });
    expect(accepted.pushed).toBe(true);
    expect(same.files.has("queue/2026-10-02-slot2.json")).toBe(true);
  });
});

describe("live publisher with a cloud-owned slot", () => {
  const date = "2026-05-15";
  let root: string;

  beforeEach(async () => {
    vi.stubEnv("DRY_RUN", "false");
    vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://tester.github.io/laundry-social-auto-poster");
    vi.stubEnv("META_ACCESS_TOKEN", "EAAabcdefghijklmnopqrstuvwxyz1234567890");
    vi.stubEnv("FB_PAGE_ID", "123456789012345");
    vi.stubEnv("IG_USER_ID", "12345678901234567");
    vi.stubEnv("ALLOW_OFF_SCHEDULE_PUBLISH", "true");
    root = await mkdtemp(join(tmpdir(), "ig-cloud-live-"));
    await generateDailyContent({ date, root, force: true });
    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    await writeFile(join(root, "docs", "assets", date, "slot-01.png"), "fake image");
    await approvePost({ date, slot: 1, platforms: ["facebook", "instagram"], approvedBy: "Test", note: "t", root, force: true });
    const entries = await loadApprovalLog(date, root);
    await writeApprovalLog(
      date,
      entries.map((entry) => {
        const { forced: _forced, forced_reasons: _reasons, ...rest } = entry as typeof entry & { forced_reasons?: unknown };
        return rest;
      }),
      root
    );
    // Facebook for slot 1 was queued ahead in Meta; the live run only records it.
    await mkdir(join(root, "data", "scheduled-log"), { recursive: true });
    await writeFile(
      join(root, "data", "scheduled-log", `${date}.json`),
      JSON.stringify([
        {
          date,
          slot: 1,
          platform: "facebook",
          scheduled_post_id: "fb-sched-1",
          scheduled_publish_time: Math.floor(Date.parse(`${date}T11:30:00+08:00`) / 1000),
          published_media_type: "carousel",
          created_at: "2026-05-12T13:40:00.000Z"
        }
      ]),
      "utf8"
    );
    await installCloud(root);
    await mkdir(join(root, "data", "ig-cloud", "queue"), { recursive: true });
    await writeFile(
      igCloudMarkerPath(root, date, 1),
      JSON.stringify(sampleSnapshot({ date, slot: 1, ig_media_type: "carousel" })),
      "utf8"
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("never posts Instagram itself while the cloud has not reported", async () => {
    const snapshot = await readIgCloudMarker(root, date, 1);
    igCloudDeps.gh = fakeGh({ mode: "live", files: new Map([[`queue/${date}-slot1.json`, JSON.stringify(snapshot)]]) }).gh;
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const results = await postCurrentSlot({ root, date, slot: 1, now: `${date}T11:31:00+08:00`, dryRun: false, verifyPublicImageUrl: false, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    const instagram = results.find((entry) => entry.platform === "instagram");
    expect(instagram).toMatchObject({ status: "skipped", note: expect.stringContaining("cloud owns Instagram") });
    const log = await loadPostLog(date, root);
    expect(log.map((row) => `${row.platform}:${row.status}`)).toEqual(["facebook:success"]);
  });

  it("records the cloud's post instead of publishing again", async () => {
    const files = new Map([
      [`results/${date}-slot1.json`, JSON.stringify({ date, slot: 1, mode: "live", status: "published", post_id: "ig-cloud-1" })]
    ]);
    igCloudDeps.gh = fakeGh({ mode: "live", files }).gh;
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await postCurrentSlot({ root, date, slot: 1, now: `${date}T11:40:00+08:00`, dryRun: false, verifyPublicImageUrl: false, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    const log = await loadPostLog(date, root);
    expect(log.find((row) => row.platform === "instagram")).toMatchObject({ status: "success", post_id: "ig-cloud-1" });
  });

  it("posts Instagram itself, with what Facebook got, once the cloud is switched off", async () => {
    const owned = fingerprinted(sampleSnapshot({ date, slot: 1, ig_media_type: "carousel" }));
    await writeFile(igCloudMarkerPath(root, date, 1), JSON.stringify(owned), "utf8");
    const state = { mode: "off", files: new Map([[`queue/${date}-slot1.json`, JSON.stringify(owned)]]) };
    igCloudDeps.gh = fakeGh(state).gh;
    const realSleep = igCloudDeps.sleep;
    igCloudDeps.sleep = async () => undefined;
    const bodies: URLSearchParams[] = [];
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("https://graph.facebook.com/")) return new Response(`media:${url}`, { status: 200 });
      if (url.includes("/media?fields=id%2Ccaption")) return json({ data: [] });
      if (init?.body instanceof URLSearchParams) bodies.push(init.body);
      if (url.includes("fields=status_code")) return json({ status_code: "FINISHED" });
      if (url.endsWith("/media_publish")) return json({ id: "ig-pc-1" });
      return json({ id: `container-${bodies.length}` });
    }) as typeof fetch;
    try {
      await postCurrentSlot({ root, date, slot: 1, now: `${date}T13:30:00+08:00`, dryRun: false, verifyPublicImageUrl: false, fetchImpl });
    } finally {
      igCloudDeps.sleep = realSleep;
    }
    const log = await loadPostLog(date, root);
    expect(log.find((row) => row.platform === "instagram")).toMatchObject({ status: "success", post_id: "ig-pc-1" });
    expect(bodies.map((body) => body.get("image_url")).filter(Boolean)).toEqual(owned.image_urls);
    expect(bodies.map((body) => body.get("caption")).filter(Boolean)).toEqual([owned.caption]);
    expect(state.files.has(`queue/${date}-slot1.json`)).toBe(false);
    expect(await readIgCloudMarker(root, date, 1)).toBeUndefined();
  });

  /** The cloud switched off while it owns slot 1; fakes answer its media and comment reads. */
  async function switchedOff(
    list: () => Response,
    options: { caption?: string; comments?: () => Response } = {}
  ): Promise<{ owned: IgCloudSnapshot; fetchImpl: typeof fetch; publishes: () => number }> {
    const owned = fingerprinted(sampleSnapshot({
      date,
      slot: 1,
      ig_media_type: "carousel",
      ...(options.caption === undefined ? {} : { caption: options.caption })
    }));
    await writeFile(igCloudMarkerPath(root, date, 1), JSON.stringify(owned), "utf8");
    igCloudDeps.gh = fakeGh({ mode: "off", files: new Map([[`queue/${date}-slot1.json`, JSON.stringify(owned)]]) }).gh;
    igCloudDeps.sleep = async () => undefined;
    let publishes = 0;
    const reply = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const fetchImpl = (async (input: string | URL) => {
      const url = String(input);
      if (!url.startsWith("https://graph.facebook.com/")) return new Response(`media:${url}`, { status: 200 });
      if (url.includes("/media?fields=id%2Ccaption")) return list();
      if (url.includes("/comments?")) return options.comments?.() ?? reply({ data: [] });
      if (url.includes("fields=status_code")) return reply({ status_code: "FINISHED" });
      if (url.endsWith("/media_publish")) {
        publishes += 1;
        return reply({ id: "ig-pc-1" });
      }
      return reply({ id: "container" });
    }) as typeof fetch;
    return { owned, fetchImpl, publishes: () => publishes };
  }
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("records the cloud's post but leaves its missing first comment unclaimed", async () => {
    // The cloud published and then failed to push its result: nothing on main
    // says so, but the post is on the account with the snapshot's caption.
    let caption = "";
    const { owned, fetchImpl, publishes } = await switchedOff(() =>
      reply({ data: [{ id: "ig-cloud-lost", caption, timestamp: new Date(Date.now() - 60_000).toISOString() }] })
    );
    caption = owned.caption;
    const realSleep = igCloudDeps.sleep;
    try {
      await postCurrentSlot({ root, date, slot: 1, now: `${date}T13:30:00+08:00`, dryRun: false, verifyPublicImageUrl: false, fetchImpl });
    } finally {
      igCloudDeps.sleep = realSleep;
    }
    expect(publishes()).toBe(0);
    const log = await loadPostLog(date, root);
    expect(log.find((row) => row.platform === "instagram")).toMatchObject({ status: "success", post_id: "ig-cloud-lost", attempts: 0 });
    const comments = JSON.parse(await readFile(join(root, "data", "first-comments", `${date}.json`), "utf8").catch(() => "[]"));
    expect(comments.some((item: { slot: number }) => item.slot === 1)).toBe(false);
  });

  it("claims the cloud's existing first comment by its comment id", async () => {
    let caption = "";
    let firstComment = "";
    const { owned, fetchImpl } = await switchedOff(
      () => reply({ data: [{ id: "ig-cloud-commented", caption, timestamp: new Date(Date.now() - 60_000).toISOString() }] }),
      { comments: () => reply({ data: [{ id: "c-9", text: firstComment }] }) }
    );
    caption = owned.caption;
    firstComment = owned.first_comment;
    await postCurrentSlot({ root, date, slot: 1, now: `${date}T13:30:00+08:00`, dryRun: false, verifyPublicImageUrl: false, fetchImpl });
    const comments = JSON.parse(await readFile(join(root, "data", "first-comments", `${date}.json`), "utf8"));
    expect(comments).toEqual([expect.objectContaining({ slot: 1, media_id: "ig-cloud-commented", comment_id: "c-9" })]);
  });

  it("does not claim a cloud first comment when the comment list cannot be read", async () => {
    let caption = "";
    const { owned, fetchImpl } = await switchedOff(
      () => reply({ data: [{ id: "ig-cloud-comment-error-unclaimed", caption, timestamp: new Date(Date.now() - 60_000).toISOString() }] }),
      { comments: () => reply({ error: { message: "rate limited" } }, 500) }
    );
    caption = owned.caption;
    await postCurrentSlot({ root, date, slot: 1, now: `${date}T13:30:00+08:00`, dryRun: false, verifyPublicImageUrl: false, fetchImpl });
    const comments = JSON.parse(await readFile(join(root, "data", "first-comments", `${date}.json`), "utf8").catch(() => "[]"));
    expect(comments.some((item: { slot: number }) => item.slot === 1)).toBe(false);
  });

  it("does not claim a first comment when the comment list cannot be read", async () => {
    let caption = "";
    const { owned, fetchImpl } = await switchedOff(
      () => reply({ data: [{ id: "ig-cloud-comment-error", caption, timestamp: new Date(Date.now() - 60_000).toISOString() }] }),
      { comments: () => reply({ error: { message: "rate limited" } }, 500) }
    );
    caption = owned.caption;
    await postCurrentSlot({ root, date, slot: 1, now: `${date}T13:30:00+08:00`, dryRun: false, verifyPublicImageUrl: false, fetchImpl });
    const comments = JSON.parse(await readFile(join(root, "data", "first-comments", `${date}.json`), "utf8").catch(() => "[]"));
    expect(comments.some((item: { slot: number }) => item.slot === 1)).toBe(false);
  });

  it("publishes when a recent Instagram post has a different caption", async () => {
    const { fetchImpl, publishes } = await switchedOff(() =>
      reply({ data: [{ id: "ig-recent-other", caption: "different caption", timestamp: new Date(Date.now() - 60_000).toISOString() }] })
    );
    await postCurrentSlot({ root, date, slot: 1, now: `${date}T13:30:00+08:00`, dryRun: false, verifyPublicImageUrl: false, fetchImpl });
    expect(publishes()).toBe(1);
    expect((await loadPostLog(date, root)).find((row) => row.platform === "instagram")).toMatchObject({ status: "success", post_id: "ig-pc-1" });
  });

  it("publishes when the matching Instagram post is older than twelve hours", async () => {
    let caption = "";
    const { owned, fetchImpl, publishes } = await switchedOff(() =>
      reply({ data: [{ id: "ig-old-match", caption, timestamp: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString() }] })
    );
    caption = owned.caption;
    await postCurrentSlot({ root, date, slot: 1, now: `${date}T13:30:00+08:00`, dryRun: false, verifyPublicImageUrl: false, fetchImpl });
    expect(publishes()).toBe(1);
    expect((await loadPostLog(date, root)).find((row) => row.platform === "instagram")).toMatchObject({ status: "success", post_id: "ig-pc-1" });
  });

  it("normalizes CRLF and trailing whitespace when matching the cloud's live post", async () => {
    const caption = "Snapshot line one\nSnapshot line two";
    let listCaption = "";
    const { owned, fetchImpl, publishes } = await switchedOff(
      () => reply({ data: [{ id: "ig-cloud-lost", caption: listCaption, timestamp: new Date(Date.now() - 60_000).toISOString() }] }),
      { caption }
    );
    listCaption = `${owned.caption.replace(/\n/g, "\r\n")}   `;
    await postCurrentSlot({ root, date, slot: 1, now: `${date}T13:30:00+08:00`, dryRun: false, verifyPublicImageUrl: false, fetchImpl });
    expect(publishes()).toBe(0);
    expect((await loadPostLog(date, root)).find((row) => row.platform === "instagram")).toMatchObject({ status: "success", post_id: "ig-cloud-lost" });
  });

  it("posts nothing from a taken-back slot when the Instagram list cannot be read", async () => {
    const { fetchImpl, publishes } = await switchedOff(() => reply({ error: { message: "rate limited" } }, 500));
    await postCurrentSlot({ root, date, slot: 1, now: `${date}T13:30:00+08:00`, dryRun: false, verifyPublicImageUrl: false, fetchImpl }).catch(
      () => undefined
    );
    expect(publishes()).toBe(0);
    const log = await loadPostLog(date, root);
    expect(log.find((row) => row.platform === "instagram")).toMatchObject({ status: "failed" });
  });

  it("checks the seven-day caption rule against the snapshot's caption for a taken-back slot", async () => {
    // Yesterday went live with exactly today's calendar caption for slot 1, which
    // the repeat rule refuses; the taken-back slot posts the snapshot's Facebook
    // caption, which is new, so it must go out.
    const today = await loadDailyContent(date, root);
    expect(today?.slots.find((item) => item.slot === 1)?.instagram_caption).toBeTruthy();
    // Yesterday is a copy of today (a calendar needs its 2 or 3 slots to load).
    const yesterday = "2026-05-14";
    await writeFile(
      join(root, "data", "content-calendar", `${yesterday}.json`),
      JSON.stringify(
        stampDailyContentWrite(
          { ...today, date: yesterday, generated_at: new Date().toISOString(), slots: today?.slots.map((item) => ({ ...item })) } as Parameters<
            typeof stampDailyContentWrite
          >[0],
          { root }
        ),
        null,
        2
      ),
      "utf8"
    );
    await mkdir(join(root, "data", "posted-log"), { recursive: true });
    await writeFile(
      join(root, "data", "posted-log", `${yesterday}.json`),
      JSON.stringify([
        { date: yesterday, slot: 1, platform: "instagram", status: "success", dry_run: false, attempts: 1, post_id: "ig-yesterday", created_at: new Date().toISOString() }
      ]),
      "utf8"
    );
    const { fetchImpl, publishes } = await switchedOff(() => reply({ data: [] }));
    await postCurrentSlot({ root, date, slot: 1, now: `${date}T13:30:00+08:00`, dryRun: false, verifyPublicImageUrl: false, fetchImpl });
    expect(publishes()).toBe(1);
    expect((await loadPostLog(date, root)).find((row) => row.platform === "instagram")).toMatchObject({ status: "success", post_id: "ig-pc-1" });
  });

  it("refuses a taken-back caption matching a live Instagram post's Facebook caption", async () => {
    const today = await loadDailyContent(date, root);
    expect(today).toBeTruthy();
    const yesterday = "2026-05-14";
    const { owned, fetchImpl, publishes } = await switchedOff(() => reply({ data: [] }));
    const yesterdaySlots = today!.slots.map((item) =>
      item.slot === 1 ? { ...item, facebook_caption: owned.caption } : { ...item }
    );
    await writeFile(
      join(root, "data", "content-calendar", `${yesterday}.json`),
      JSON.stringify(
        stampDailyContentWrite(
          { ...today!, date: yesterday, generated_at: new Date().toISOString(), slots: yesterdaySlots } as Parameters<
            typeof stampDailyContentWrite
          >[0],
          { root }
        ),
        null,
        2
      ),
      "utf8"
    );
    await mkdir(join(root, "data", "posted-log"), { recursive: true });
    await writeFile(
      join(root, "data", "posted-log", `${yesterday}.json`),
      JSON.stringify([
        { date: yesterday, slot: 1, platform: "instagram", status: "success", dry_run: false, attempts: 1, post_id: "ig-yesterday", created_at: new Date().toISOString() }
      ]),
      "utf8"
    );
    await expect(
      postCurrentSlot({ root, date, slot: 1, now: `${date}T13:30:00+08:00`, dryRun: false, verifyPublicImageUrl: false, fetchImpl })
    ).rejects.toThrow(/Refusing to repeat it/);
    expect(publishes()).toBe(0);
  });
});

describe("schedule-ahead hands Instagram to a live cloud", () => {
  const DATE = "2026-09-21";
  // One day, two image slots, both approved: what schedule-ahead needs.
  async function writeTwoSlotDay(root: string) {
    await mkdir(join(root, "data", "content-calendar"), { recursive: true });
    await mkdir(join(root, "data", "approved-log"), { recursive: true });
    await mkdir(join(root, "docs", "assets", DATE), { recursive: true });
    await writeFile(join(root, "docs", "assets", DATE, "slot-01.png"), "png-bytes");
    await writeFile(join(root, "docs", "assets", DATE, "slot-02.png"), "png-bytes");
    const slot = {
      slot: 1,
      time: "11:30",
      topic: "排程測試主題 1",
      format: "image-post",
      media_type: "image",
      instagram_caption: "IG caption",
      facebook_caption: "FB caption",
      local_image_path: `docs/assets/${DATE}/slot-01.png`,
      public_image_url: `https://tester.github.io/laundry-social-auto-poster/assets/${DATE}/slot-01.png`
    };
    const slot2 = {
      ...slot,
      slot: 2,
      time: "20:30",
      topic: "排程測試主題 2",
      instagram_caption: "IG caption 2",
      facebook_caption: "FB caption 2",
      local_image_path: `docs/assets/${DATE}/slot-02.png`,
      public_image_url: `https://tester.github.io/laundry-social-auto-poster/assets/${DATE}/slot-02.png`
    };
    await writeFile(
      join(root, "data", "content-calendar", `${DATE}.json`),
      `${JSON.stringify(
        stampDailyContentWrite(
          { date: DATE, timezone: "Asia/Taipei", generated_at: new Date().toISOString(), slots: [slot, slot2] } as Parameters<
            typeof stampDailyContentWrite
          >[0],
          { root }
        ),
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      join(root, "data", "approved-log", `${DATE}.json`),
      JSON.stringify(
        [1, 2].flatMap((n) =>
          (["facebook", "instagram"] as const).map((platform) => ({ date: DATE, slot: n, platform, status: "approved", approved_at: new Date().toISOString() }))
        )
      ),
      "utf8"
    );
    return slot;
  }
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ id: "fb-obj-1", post_id: "fb-post-1" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

  it("queues Facebook, then pushes the same version for Instagram", async () => {
    const root = await mkdtemp(join(tmpdir(), "ig-cloud-sched-"));
    const slot = await writeTwoSlotDay(root);
    await installCloud(root);
    const state = { mode: "live", files: new Map<string, string>() };
    const { gh } = fakeGh(state);
    const results = await scheduleAheadFacebook({
      date: DATE,
      root,
      config: liveConfig(),
      fetchImpl,
      now: new Date("2026-09-20T21:00:00+08:00"),
      igCloud: { gh, fetchImpl: media }
    });
    expect(results).toEqual([
      expect.objectContaining({ slot: 1, action: "scheduled" }),
      expect.objectContaining({ slot: 2, action: "scheduled" })
    ]);
    expect(state.files.has(`queue/${DATE}-slot2.json`)).toBe(true);
    const scheduled = (await loadScheduledLog(DATE, root)).find((row) => row.slot === 1);
    const pushed = JSON.parse(state.files.get(`queue/${DATE}-slot1.json`) ?? "{}") as IgCloudSnapshot;
    expect(pushed).toMatchObject({
      date: DATE,
      slot: 1,
      ig_media_type: "image",
      caption: "FB caption",
      publish_unix: scheduled?.scheduled_publish_time,
      fb_scheduled_post_id: scheduled?.scheduled_post_id,
      image_urls: [slot.public_image_url]
    });
    expect(pushed.image_sha256s).toEqual([shaOf(`media:${slot.public_image_url}`)]);
    expect(pushed.backfill).toBeUndefined();
    expect(await readIgCloudMarker(root, DATE, 1)).toEqual(pushed);
  });

  it("backfills a slot Facebook already published, at the given time and never before its own day", async () => {
    const root = await mkdtemp(join(tmpdir(), "ig-cloud-backfill-"));
    await writeTwoSlotDay(root);
    await installCloud(root);
    // The day went into the Facebook queue before the cloud was live.
    const off = { mode: "off", files: new Map<string, string>() };
    await scheduleAheadFacebook({
      date: DATE,
      root,
      config: liveConfig(),
      fetchImpl,
      now: new Date("2026-09-20T21:00:00+08:00"),
      igCloud: { gh: fakeGh(off).gh, fetchImpl: media }
    });
    expect(off.files.size).toBe(0);

    const repo = { mode: "live", files: new Map<string, string>() };
    const { gh } = fakeGh(repo);
    const after = new Date("2026-09-22T09:00:00+08:00");
    const day = { date: DATE, root, slot: 1, config: liveConfig(), igCloud: { gh, fetchImpl: media } };
    // Slot time has passed: without a backfill time the slot stays here.
    expect(await snapshotScheduledDay({ ...day, now: after })).toEqual([expect.stringContaining("stays on this PC")]);
    // A backfill may not go out before the content's own day.
    expect(
      await snapshotScheduledDay({ ...day, now: new Date("2026-09-20T09:00:00+08:00"), publishAt: new Date("2026-09-20T12:00:00+08:00") })
    ).toEqual([expect.stringContaining("before the slot's own date")]);
    // Nor at a time no cloud run would ever pick up.
    expect(await snapshotScheduledDay({ ...day, now: after, publishAt: new Date("2026-09-23T15:00:00+08:00") })).toEqual([
      expect.stringContaining("15:00 Taipei has no cloud run")
    ]);
    expect(repo.files.size).toBe(0);
    expect(await readIgCloudMarker(root, DATE, 1)).toBeUndefined();

    const publishAt = new Date("2026-09-23T12:00:00+08:00");
    expect(await snapshotScheduledDay({ ...day, now: after, publishAt })).toEqual([expect.stringContaining("cloud owns Instagram")]);
    const pushed = JSON.parse(repo.files.get(`queue/${DATE}-slot1.json`) ?? "{}") as IgCloudSnapshot;
    expect(pushed).toMatchObject({ date: DATE, slot: 1, backfill: true, publish_unix: publishAt.getTime() / 1000, caption: "FB caption" });
    expect(await readIgCloudMarker(root, DATE, 1)).toEqual(pushed);
  });
});
