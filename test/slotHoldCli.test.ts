import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSlotHoldCli, slotHoldCliHooks } from "../src/slotHoldCli";
import { loadSlotHolds, slotHoldsFilePath, slotHoldsLockPath } from "../src/slotHolds";
import { enableSlotHolds, sampleHold, writeEmptySlotHolds, writeHolds, writeSlotHoldsRequired } from "./helpers/slotHoldsFixture";

const roots: string[] = [];

afterEach(async () => {
  slotHoldCliHooks.afterFirstRead = undefined;
  process.exitCode = undefined;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "slot-hold-cli-"));
  roots.push(root);
  return root;
}

async function capture(fn: () => Promise<void>): Promise<{ out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...args: unknown[]) => {
    out.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    err.push(args.map(String).join(" "));
  };
  try {
    await fn();
  } finally {
    console.log = log;
    console.error = error;
  }
  return { out: out.join("\n"), err: err.join("\n") };
}

describe("slot-hold CLI", () => {
  it("init creates an empty holds file and refuses a second init", async () => {
    const root = await tempRoot();
    await writeSlotHoldsRequired(root);
    await runSlotHoldCli(["init", "--root", root]);
    const first = await loadSlotHolds(root);
    expect(first).toEqual({ status: "ok", holds: [] });
    await expect(runSlotHoldCli(["init", "--root", root])).rejects.toThrow(/already exists/);
  });

  it("add / list / remove round-trip with --root", async () => {
    const root = await tempRoot();
    await enableSlotHolds(root);
    await runSlotHoldCli([
      "add",
      "--root",
      root,
      "--date",
      "2026-10-01",
      "--slot",
      "2",
      "--reason",
      "visual route",
      "--by",
      "owner"
    ]);
    const listed = await capture(() => runSlotHoldCli(["list", "--root", root, "--date", "2026-10-01"]));
    expect(listed.out).toContain("visual route");
    expect(listed.out).toContain('"slot": 2');
    await runSlotHoldCli([
      "remove",
      "--root",
      root,
      "--date",
      "2026-10-01",
      "--slot",
      "2",
      "--reason",
      "visual route"
    ]);
    const after = await loadSlotHolds(root);
    expect(after.status).toBe("ok");
    expect(after.holds).toEqual([]);
  });

  it("list on invalid file prints the reason and throws (nonzero CLI)", async () => {
    const root = await tempRoot();
    await writeSlotHoldsRequired(root);
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "slot-holds.json"), "{ nope", "utf8");
    const printed = await capture(async () => {
      await expect(runSlotHoldCli(["list", "--root", root])).rejects.toThrow(/SLOT-HOLDS INVALID/);
    });
    expect(printed.err).toContain("SLOT-HOLDS INVALID:");
  });

  it("add/remove refuse when the current file is invalid", async () => {
    const root = await tempRoot();
    await writeSlotHoldsRequired(root);
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "slot-holds.json"), "{ nope", "utf8");
    await expect(
      runSlotHoldCli(["add", "--root", root, "--date", "2026-10-01", "--slot", "1", "--reason", "x", "--by", "owner"])
    ).rejects.toThrow(/SLOT-HOLDS INVALID/);
    await expect(
      runSlotHoldCli(["remove", "--root", root, "--date", "2026-10-01", "--slot", "1", "--reason", "x"])
    ).rejects.toThrow(/SLOT-HOLDS INVALID/);
  });

  it("remove of a missing reason fails", async () => {
    const root = await tempRoot();
    await enableSlotHolds(root, [sampleHold()]);
    await expect(
      runSlotHoldCli(["remove", "--root", root, "--date", "2026-10-01", "--slot", "1", "--reason", "no such reason"])
    ).rejects.toThrow(/No hold found/);
  });

  it("two concurrent adds do not lose entries", async () => {
    const root = await tempRoot();
    await enableSlotHolds(root);
    await Promise.all([
      runSlotHoldCli(["add", "--root", root, "--date", "2026-10-01", "--slot", "1", "--reason", "alpha", "--by", "a"]),
      runSlotHoldCli(["add", "--root", root, "--date", "2026-10-01", "--slot", "1", "--reason", "beta", "--by", "b"])
    ]);
    const loaded = await loadSlotHolds(root);
    expect(loaded.status).toBe("ok");
    expect(loaded.holds.map((entry) => entry.reason).sort()).toEqual(["alpha", "beta"]);
  });

  it("aborts when the file changes after the first read, before rename", async () => {
    const root = await tempRoot();
    await enableSlotHolds(root);
    slotHoldCliHooks.afterFirstRead = async () => {
      await writeHolds(root, [sampleHold({ reason: "injected by race" })]);
    };
    await expect(
      runSlotHoldCli(["add", "--root", root, "--date", "2026-10-01", "--slot", "1", "--reason", "alpha", "--by", "owner"])
    ).rejects.toThrow(/changed after the first read/);
    const loaded = await loadSlotHolds(root);
    expect(loaded.status).toBe("ok");
    expect(loaded.holds.map((entry) => entry.reason)).toEqual(["injected by race"]);
  });

  it("prints lock path and age when the lock cannot be acquired", async () => {
    const root = await tempRoot();
    await enableSlotHolds(root);
    const lockPath = slotHoldsLockPath(root);
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(lockPath, "held\n", "utf8");
    const started = Date.now();
    await expect(
      runSlotHoldCli(["add", "--root", root, "--date", "2026-10-01", "--slot", "1", "--reason", "alpha", "--by", "owner"])
    ).rejects.toThrow(new RegExp(`Timed out waiting for slot-holds lock ${lockPath.replace(/\\/g, "\\\\")}`));
    expect(Date.now() - started).toBeGreaterThanOrEqual(9000);
  }, 20_000);

  it("still writes a hold when the slot is already platform-queued, then exits nonzero", async () => {
    const root = await tempRoot();
    await enableSlotHolds(root);
    await mkdir(join(root, "data", "scheduled-log"), { recursive: true });
    await mkdir(join(root, "data", "youtube-log"), { recursive: true });
    await writeFile(
      join(root, "data", "scheduled-log", "2026-10-01.json"),
      JSON.stringify([
        {
          date: "2026-10-01",
          slot: 2,
          platform: "facebook",
          scheduled_post_id: "fb-queued-99",
          scheduled_publish_time: 1,
          published_media_type: "image",
          created_at: new Date().toISOString()
        }
      ]),
      "utf8"
    );
    await writeFile(
      join(root, "data", "youtube-log", "2026-10-01.json"),
      JSON.stringify([{ date: "2026-10-01", slot: 2, video_id: "yt-queued-77", title: "t", uploaded_at: new Date().toISOString() }]),
      "utf8"
    );
    process.exitCode = 0;
    const printed = await capture(() =>
      runSlotHoldCli(["add", "--root", root, "--date", "2026-10-01", "--slot", "2", "--reason", "pause", "--by", "owner"])
    );
    expect(printed.err).toContain("SLOT-HOLD PLATFORM-QUEUED facebook fb-queued-99");
    expect(printed.err).toContain("SLOT-HOLD PLATFORM-QUEUED youtube yt-queued-77");
    expect(process.exitCode).toBe(1);
    const loaded = await loadSlotHolds(root);
    expect(loaded.status).toBe("ok");
    expect(loaded.holds).toHaveLength(1);
    expect(await readFile(slotHoldsFilePath(root), "utf8")).toContain("pause");
  });

  it("init on a tree without the marker still creates the file", async () => {
    const root = await tempRoot();
    await runSlotHoldCli(["init", "--root", root]);
    expect(JSON.parse(await readFile(slotHoldsFilePath(root), "utf8"))).toEqual({ version: 1, holds: [] });
    await writeEmptySlotHolds(root);
  });
});
