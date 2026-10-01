import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { approvePost } from "../src/approvePost";
import { loadDailyContent, writeDailyContent } from "../src/logging";
import { postedLogPath } from "../src/paths";
import { retirePausedNoonSlot } from "../src/retirePausedNoonSlot";
import type { AbDayPlan } from "../src/abTestPlan";
import type { DailyContent, DailySlot } from "../src/types";

const DATE = "2099-12-31";
const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function makeSlot(number: number): DailySlot {
  return {
    slot: number,
    time: number === 1 ? "11:30" : number === 2 ? "20:30" : "12:00",
    category: "知識文",
    topic: `test topic ${number}`,
    format: number === 3 ? "reel" : "image",
    media_type: number === 3 ? "reel" : "image",
    instagram_caption: `instagram ${number}`,
    facebook_caption: `facebook ${number}`,
    image_prompt: `image prompt ${number}`,
    visual_route: "shop-inspection",
    traffic_route: "object-proof",
    local_image_path: `docs/assets/${DATE}/slot-${String(number).padStart(2, "0")}.png`,
    public_image_url: `https://example.invalid/assets/${DATE}/slot-${String(number).padStart(2, "0")}.png`,
    status: "pending"
  } as DailySlot;
}

function pausedPlan(paused = true): AbDayPlan {
  return {
    date: DATE,
    noon: { conceptId: "noon-concept", variant: "10s", ...(paused ? { paused: true } : {}) },
    evening: { conceptId: "evening-concept", variant: "15s" }
  };
}

async function tempRoot(options: {
  paused?: boolean;
  includePlan?: boolean;
  includeSlot3?: boolean;
} = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "retire-paused-noon-"));
  roots.push(root);
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  await mkdir(join(root, "data"), { recursive: true });
  const plan = options.includePlan === false ? [] : [pausedPlan(options.paused)];
  await writeFile(join(root, "data", "ab-test-plan.json"), JSON.stringify(plan), "utf8");

  const slots = [makeSlot(1), makeSlot(2), ...(options.includeSlot3 === false ? [] : [makeSlot(3)])];
  const content: DailyContent = {
    date: DATE,
    timezone: "Asia/Taipei",
    generated_at: "2099-12-31T00:00:00.000Z",
    slots
  };
  await writeDailyContent(content, root);
  return root;
}

async function addSlot3Images(root: string): Promise<void> {
  const directory = join(root, "docs", "assets", DATE);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "slot-03.png"), Buffer.from("test image bytes"));
  await writeFile(join(directory, "slot-03-slide-02.png"), Buffer.from("test slide bytes"));
}

async function approveExistingDay(root: string): Promise<Record<string, string>> {
  for (const slot of [1, 2]) {
    await approvePost({
      date: DATE,
      slot,
      platforms: ["facebook", "instagram"],
      approvedBy: "fixture",
      note: "temporary fingerprint fixture",
      force: true,
      root
    });
  }
  return JSON.parse(await readFile(join(root, "data", "approved-log", `${DATE}.fingerprints.json`), "utf8")) as Record<string, string>;
}

async function snapshotFiles(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};

  async function visit(directory: string, prefix: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path, relative);
      else if (entry.isFile()) snapshot[relative] = (await readFile(path)).toString("base64");
    }
  }

  await visit(root, "");
  return snapshot;
}

describe("retirePausedNoonSlot", () => {
  it("dry-runs without changing bytes, then applies through the calendar writer and preserves approved fingerprints", async () => {
    const root = await tempRoot();
    await addSlot3Images(root);
    const fingerprintsBefore = await approveExistingDay(root);
    expect(Object.keys(fingerprintsBefore).sort()).toEqual(["1", "2"]);
    const beforeContent = await loadDailyContent(DATE, root);
    const beforeDryRun = await snapshotFiles(root);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const dryRun = await retirePausedNoonSlot({ date: DATE, root });
    expect(dryRun.status).toBe("planned");
    expect(log.mock.calls.flat().join(" ")).toContain("dry-run");
    expect(await snapshotFiles(root)).toEqual(beforeDryRun);

    const applied = await retirePausedNoonSlot({ date: DATE, root, apply: true });
    expect(applied.status).toBe("applied");
    expect(applied.movedAssets).toHaveLength(2);

    const afterContent = await loadDailyContent(DATE, root);
    expect(afterContent?.slots.map((slot) => slot.slot)).toEqual([1, 2]);
    expect(afterContent?.slots).toEqual(beforeContent?.slots.filter((slot) => slot.slot !== 3));
    expect(
      afterContent?.tampered,
      "approved slot fingerprints must remain trusted after the official calendar writer stamps the reduced calendar"
    ).toBeUndefined();
    expect(await readdir(join(root, "docs", "assets", DATE, "_stale"))).toEqual([
      "slot-03-slide-02.png",
      "slot-03.png"
    ]);

    for (const slot of [1, 2]) {
      await approvePost({
        date: DATE,
        slot,
        platforms: ["facebook", "instagram"],
        approvedBy: "fingerprint-preservation-check",
        force: true,
        root
      });
    }
    const fingerprintsAfter = JSON.parse(
      await readFile(join(root, "data", "approved-log", `${DATE}.fingerprints.json`), "utf8")
    ) as Record<string, string>;
    expect(fingerprintsAfter["1"]).toBe(fingerprintsBefore["1"]);
    expect(fingerprintsAfter["2"]).toBe(fingerprintsBefore["2"]);
  });

  it("does not retire when posted-log contains slot 3, including a dry-run row", async () => {
    const root = await tempRoot();
    await addSlot3Images(root);
    await mkdir(join(root, "data", "posted-log"), { recursive: true });
    await writeFile(
      postedLogPath(DATE, root),
      JSON.stringify([{ date: DATE, slot: 3, dry_run: true, status: "failed" }]),
      "utf8"
    );
    const before = await snapshotFiles(root);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await retirePausedNoonSlot({ date: DATE, root, apply: true });

    expect(result.status).toBe("skipped");
    expect(result.reasons?.join(" ")).toContain("posted-log");
    expect(log.mock.calls.flat().join(" ")).toContain("posted-log");
    expect(await snapshotFiles(root)).toEqual(before);
  });

  it("does not retire when noon is active", async () => {
    const root = await tempRoot({ paused: false });
    await addSlot3Images(root);
    const before = await snapshotFiles(root);

    const result = await retirePausedNoonSlot({ date: DATE, root, apply: true });

    expect(result.status).toBe("skipped");
    expect(result.reasons?.join(" ")).toContain("A/B noon has an active planSlot");
    expect(await snapshotFiles(root)).toEqual(before);
  });

  it("dry-runs and removes a no-video slot 3 when the date has no A/B plan", async () => {
    const root = await tempRoot({ includePlan: false });
    await addSlot3Images(root);
    const beforeContent = await loadDailyContent(DATE, root);
    expect(beforeContent?.slots.find((slot) => slot.slot === 3)?.local_video_path).toBeUndefined();
    const before = await snapshotFiles(root);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const dryRun = await retirePausedNoonSlot({ date: DATE, root });
    expect(dryRun.status).toBe("planned");
    expect(log.mock.calls.flat().join(" ")).toContain("dry-run");
    expect(log.mock.calls.flat().join(" ")).toContain("slot-03.png");
    expect(await snapshotFiles(root)).toEqual(before);

    const applied = await retirePausedNoonSlot({ date: DATE, root, apply: true });

    expect(applied.status).toBe("applied");
    expect(applied.movedAssets).toHaveLength(2);
    const content = await loadDailyContent(DATE, root);
    expect(content?.slots.map((slot) => slot.slot)).toEqual([1, 2]);
  });

  it("returns successfully without writing when slot 3 is absent from the calendar", async () => {
    const root = await tempRoot({ includeSlot3: false });
    const before = await snapshotFiles(root);

    const result = await retirePausedNoonSlot({ date: DATE, root, apply: true });

    expect(result.status).toBe("skipped");
    expect(result.reasons?.join(" ")).toContain("calendar has no slot 3");
    expect(await snapshotFiles(root)).toEqual(before);
  });

  it("does not retire when an approved-log row exists for slot 3", async () => {
    const root = await tempRoot();
    await addSlot3Images(root);
    await mkdir(join(root, "data", "approved-log"), { recursive: true });
    await writeFile(join(root, "data", "approved-log", `${DATE}.json`), JSON.stringify([{ slot: 3 }]), "utf8");

    const result = await retirePausedNoonSlot({ date: DATE, root, apply: true });

    expect(result.status).toBe("skipped");
    expect(result.reasons?.join(" ")).toContain("approved-log");
  });

  it("does not retire when scheduled-log contains slot 3", async () => {
    const root = await tempRoot();
    await addSlot3Images(root);
    await mkdir(join(root, "data", "scheduled-log"), { recursive: true });
    await writeFile(join(root, "data", "scheduled-log", `${DATE}.json`), JSON.stringify([{ slot: 3 }]), "utf8");

    const result = await retirePausedNoonSlot({ date: DATE, root, apply: true });

    expect(result.status).toBe("skipped");
    expect(result.reasons?.join(" ")).toContain("scheduled-log");
  });

  it("does not retire when data/ig-cloud contains a dated slot 3 marker", async () => {
    const root = await tempRoot();
    await addSlot3Images(root);
    await mkdir(join(root, "data", "ig-cloud"), { recursive: true });
    await writeFile(join(root, "data", "ig-cloud", `${DATE}-slot-03.marker`), "marker", "utf8");

    const result = await retirePausedNoonSlot({ date: DATE, root, apply: true });

    expect(result.status).toBe("skipped");
    expect(result.reasons?.join(" ")).toContain("ig-cloud");
  });
});
