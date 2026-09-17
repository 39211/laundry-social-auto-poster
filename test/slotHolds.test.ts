import { access, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SLOT_HOLDS_REQUIRED_REL,
  detectSlotHoldsEnabled,
  holdReasons,
  isSlotHeld,
  loadSlotHolds,
  slotHoldsIo,
  slotHoldsRequiredPath
} from "../src/slotHolds";
import { enableSlotHolds, sampleHold, writeHolds, writeSlotHoldsRequired } from "./helpers/slotHoldsFixture";

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "slot-holds-"));
  roots.push(root);
  return root;
}

function invalidError(result: Awaited<ReturnType<typeof loadSlotHolds>>): string {
  if (result.status !== "invalid") throw new Error(`expected invalid, got ${result.status}`);
  return result.error;
}

describe("config/slot-holds.required marker", () => {
  it("is present in this repo so production pull enables holds", async () => {
    const path = join(process.cwd(), SLOT_HOLDS_REQUIRED_REL);
    await expect(access(path)).resolves.toBeUndefined();
    const info = await stat(path);
    expect(info.isFile()).toBe(true);
    expect(info.size).toBeGreaterThan(0);
  });
});

describe("loadSlotHolds S5-1 cases", () => {
  it("enabled + missing file is invalid", async () => {
    const root = await tempRoot();
    await writeSlotHoldsRequired(root);
    const result = await loadSlotHolds(root);
    expect(invalidError(result)).toMatch(/missing/i);
    expect(isSlotHeld(result, "2026-10-01", 1)).toBe(true);
    expect(isSlotHeld(result, "2099-01-01", 3)).toBe(true);
  });

  it("enabled + empty file is invalid", async () => {
    const root = await tempRoot();
    await writeSlotHoldsRequired(root);
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "slot-holds.json"), "", "utf8");
    const result = await loadSlotHolds(root);
    expect(invalidError(result)).toMatch(/empty/i);
  });

  it("enabled + bad JSON is invalid", async () => {
    const root = await tempRoot();
    await writeSlotHoldsRequired(root);
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "slot-holds.json"), "{ this is not json", "utf8");
    const result = await loadSlotHolds(root);
    expect(invalidError(result)).toMatch(/JSON parse failed/i);
  });

  it("enabled + wrong version is invalid", async () => {
    const root = await tempRoot();
    await writeSlotHoldsRequired(root);
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "slot-holds.json"), JSON.stringify({ version: 2, holds: [] }), "utf8");
    const result = await loadSlotHolds(root);
    expect(invalidError(result)).toMatch(/version must be 1/);
  });

  it("enabled + missing field is invalid", async () => {
    const root = await tempRoot();
    await writeSlotHoldsRequired(root);
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(
      join(root, "data", "slot-holds.json"),
      JSON.stringify({
        version: 1,
        holds: [{ date: "2026-10-01", slot: 1, set_by: "owner", set_at: "2026-09-17T03:00:00.000Z" }]
      }),
      "utf8"
    );
    const result = await loadSlotHolds(root);
    expect(invalidError(result)).toMatch(/reason/);
  });

  it("enabled + slot=4 is invalid", async () => {
    const root = await tempRoot();
    await writeSlotHoldsRequired(root);
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(
      join(root, "data", "slot-holds.json"),
      JSON.stringify({ version: 1, holds: [{ ...sampleHold(), slot: 4 }] }),
      "utf8"
    );
    const result = await loadSlotHolds(root);
    expect(invalidError(result)).toMatch(/slot must be 1, 2, or 3/);
  });

  it("enabled + bad date format is invalid", async () => {
    const root = await tempRoot();
    await writeSlotHoldsRequired(root);
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(
      join(root, "data", "slot-holds.json"),
      JSON.stringify({ version: 1, holds: [{ ...sampleHold(), date: "2026/10/01" }] }),
      "utf8"
    );
    const result = await loadSlotHolds(root);
    expect(invalidError(result)).toMatch(/date must be YYYY-MM-DD/);
  });

  it("enabled + duplicate (date, slot, reason) is invalid", async () => {
    const root = await tempRoot();
    await writeSlotHoldsRequired(root);
    const hold = sampleHold();
    await writeHolds(root, [hold, { ...hold, set_by: "other" }]);
    const result = await loadSlotHolds(root);
    expect(invalidError(result)).toMatch(/duplicate hold/);
  });

  it("enabled + truncated file is invalid", async () => {
    const root = await tempRoot();
    await writeSlotHoldsRequired(root);
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "slot-holds.json"), '{"version":1,"holds":[{"date":"2026-10-01"', "utf8");
    const result = await loadSlotHolds(root);
    expect(invalidError(result)).toMatch(/JSON parse failed/i);
  });

  it("disabled + missing file is ok with no holds", async () => {
    const root = await tempRoot();
    const result = await loadSlotHolds(root);
    expect(result).toEqual({ status: "ok", holds: [] });
    expect(isSlotHeld(result, "2026-10-01", 1)).toBe(false);
  });

  it("disabled + bad file is invalid", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "slot-holds.json"), "{ nope", "utf8");
    const result = await loadSlotHolds(root);
    expect(result.status).toBe("invalid");
  });

  it("marker stat error other than ENOENT is treated as enabled", async () => {
    const root = await tempRoot();
    const required = slotHoldsRequiredPath(root);
    const realStat = slotHoldsIo.stat;
    slotHoldsIo.stat = async (path: string) => {
      if (path === required) {
        const error = new Error("resource busy") as NodeJS.ErrnoException;
        error.code = "EBUSY";
        throw error;
      }
      return realStat(path);
    };
    try {
      expect(await detectSlotHoldsEnabled(root)).toBe(true);
      const result = await loadSlotHolds(root);
      expect(invalidError(result)).toMatch(/missing/i);
    } finally {
      slotHoldsIo.stat = realStat;
    }
  });

  it("same slot may have multiple reasons; any remaining hold is held", async () => {
    const root = await tempRoot();
    await enableSlotHolds(root, [
      sampleHold({ reason: "visual route undecided" }),
      sampleHold({ reason: "topic swap pending" })
    ]);
    const result = await loadSlotHolds(root);
    expect(result.status).toBe("ok");
    expect(isSlotHeld(result, "2026-10-01", 1)).toBe(true);
    expect(holdReasons(result, "2026-10-01", 1)).toEqual(["visual route undecided", "topic swap pending"]);
    expect(isSlotHeld(result, "2026-10-01", 2)).toBe(false);
  });

  it("uses stat, not existsSync, so only ENOENT disables", async () => {
    const root = await tempRoot();
    expect(await detectSlotHoldsEnabled(root)).toBe(false);
    await writeSlotHoldsRequired(root);
    expect(await detectSlotHoldsEnabled(root)).toBe(true);
    await stat(slotHoldsRequiredPath(root));
  });
});
