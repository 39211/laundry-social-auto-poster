import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliverPendingFacebookAlerts } from "../src/facebookLostAlert";
import { scheduledLogPath } from "../src/paths";
import { reconcileUncertainRows } from "../src/scheduleAhead";
import type { AppConfig, DailySlot } from "../src/types";

// A-BACKFILL H-1 / H-3. No network: every Graph call goes to a fake fetch; no real data or tokens.
const DATE = "2026-11-20";
const SLOT_TIME = Math.floor(Date.parse("2026-11-20T12:00:00+08:00") / 1000);
const THREE_DAYS_BEFORE = new Date((SLOT_TIME - 3 * 24 * 3600) * 1000);
const TEN_MIN_BEFORE = new Date((SLOT_TIME - 10 * 60) * 1000);
const AFTER_SLOT = new Date((SLOT_TIME + 3600) * 1000);

const config = {
  dryRun: false,
  graphApiVersion: "v21.0",
  facebookPageId: "100000000000000",
  metaAccessToken: "test-only-not-a-token"
} as unknown as AppConfig;

const slots = [
  {
    slot: 1,
    media_type: "reel",
    facebook_caption: "測試用貼文，不會送出。",
    instagram_caption: "測試用貼文，不會送出。"
  }
] as unknown as DailySlot[];

const emptyPage = (async () =>
  new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { "content-type": "application/json" }
  })) as unknown as typeof fetch;

const graphDown = (async () => {
  throw new TypeError("fetch failed (test)");
}) as unknown as typeof fetch;

describe("A-BACKFILL reconcileUncertainRows", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "sched-reconcile-"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (root && root.includes("sched-reconcile-")) await rm(root, { recursive: true, force: true });
  });

  async function seedRow(mediaType: "reel" | "image"): Promise<void> {
    const path = scheduledLogPath(DATE, root);
    await mkdir(dirname(path), { recursive: true });
    const row = {
      date: DATE,
      slot: 1,
      platform: "facebook",
      scheduled_post_id: "",
      scheduled_publish_time: SLOT_TIME,
      published_media_type: mediaType,
      status: "uncertain",
      error: "response lost (test)",
      created_at: "2026-11-17T08:00:00.000Z"
    };
    await writeFile(path, JSON.stringify([row], null, 2), "utf8");
  }
  async function readRows(): Promise<Array<{ status?: string }>> {
    return JSON.parse(await readFile(scheduledLogPath(DATE, root), "utf8"));
  }
  const run = (fetchImpl: typeof fetch, now: Date, allowReschedule = true) =>
    reconcileUncertainRows({ date: DATE, root, config, fetchImpl, now, slots, allowReschedule });

  it("keeps an unconfirmed Reel row (does not queue a second Reel) when the Page lists nothing", async () => {
    await seedRow("reel");
    const outcome = await run(emptyPage, THREE_DAYS_BEFORE);
    expect(outcome.rescheduled.has(1)).toBe(false);
    expect(outcome.handled.get(1)?.action).toBe("uncertain");
    const rows = await readRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("uncertain");
  });

  it("control: an unconfirmed image row confirmed absent is still rescheduled", async () => {
    await seedRow("image");
    const outcome = await run(emptyPage, THREE_DAYS_BEFORE);
    expect(outcome.rescheduled.has(1)).toBe(true);
    expect(await readRows()).toHaveLength(0);
  });

  it("an unconfirmed Reel row inside the last 15 minutes still goes to the FB_LOST alert, not silence", async () => {
    await seedRow("reel");
    const outcome = await run(emptyPage, TEN_MIN_BEFORE);
    expect(outcome.handled.get(1)?.action).toBe("lost");
    const alert = JSON.parse(await readFile(join(root, "output", "alerts", `fb-lost-${DATE}-slot1.json`), "utf8"));
    expect(alert.alert).toBe("FB_LOST");
  });

  it("Page unreachable after slot time writes a staff alert that is delivered exactly once", async () => {
    await seedRow("image");
    const outcome = await run(graphDown, AFTER_SLOT);
    expect(outcome.handled.get(1)?.action).toBe("uncertain");
    const alert = JSON.parse(await readFile(join(root, "output", "alerts", `fb-lost-${DATE}-slot1.json`), "utf8"));
    expect(alert.alert).toBe("FB_LOST");
    expect(alert.date).toBe(DATE);
    expect(alert.slot).toBe(1);
    expect(alert.reason).toContain("could not be checked");

    const sentKeys: string[] = [];
    const sender = async (_message: string, key: string): Promise<boolean> => {
      sentKeys.push(key);
      return true;
    };
    expect(await deliverPendingFacebookAlerts({ root, date: DATE, sender })).toEqual({ delivered: 1, pending: 0 });
    expect(await deliverPendingFacebookAlerts({ root, date: DATE, sender })).toEqual({ delivered: 0, pending: 0 });
    expect(sentKeys).toEqual([`sxj:fb-lost:${DATE}:slot1`]);
  });

  it("Page unreachable BEFORE slot time (not too late yet) writes no alert and keeps the row", async () => {
    await seedRow("image");
    const outcome = await run(graphDown, THREE_DAYS_BEFORE);
    expect(outcome.handled.get(1)?.action).toBe("uncertain");
    await expect(readFile(join(root, "output", "alerts", `fb-lost-${DATE}-slot1.json`), "utf8")).rejects.toThrow();
    expect(await readRows()).toHaveLength(1);
  });

  it("the not-on-the-Page FB_LOST alert keeps its original reason text", async () => {
    await seedRow("image");
    await run(emptyPage, AFTER_SLOT);
    const alert = JSON.parse(await readFile(join(root, "output", "alerts", `fb-lost-${DATE}-slot1.json`), "utf8"));
    expect(alert.reason).toContain("no matching post is on the Page");
  });
});
