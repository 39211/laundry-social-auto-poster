import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSlotTime, ensurePublishTimes, getSlotPublishTime, readPublishTimes } from "../src/publishTimes";

const CONFIG = {
  name: "afternoon-vs-usual-2026-10",
  start_date: "2026-10-06",
  end_date: "2026-10-19",
  slots: [1, 2],
  probability_afternoon: 0.5,
  afternoon_window: { start: "14:00", end: "15:30" },
  min_gap_minutes: 60,
  preregistered: { primary_metric: "reach", secondary_metric: "distribution", decision_rule: "compare" }
};
const WINDOWS_CONFIG = {
  name: "slot-windows-vs-usual-2026-10",
  start_date: "2026-10-06",
  end_date: "2026-10-19",
  slots: [1, 2],
  probability_afternoon: 0.5,
  windows: {
    "1": { start: "14:00", end: "15:30", arm: "afternoon" },
    "2": { start: "19:00", end: "19:30", arm: "early-evening" }
  },
  min_gap_minutes: 60,
  preregistered: { primary_metric: "reach", secondary_metric: "views", decision_rule: "per-slot" }
};
const DATE = "2026-10-06";
let root: string;

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "publish-times-"));
  await writeJson(join(root, "data", "publish-time-experiment.json"), CONFIG);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("publish-time file reading", () => {
  it("uses defaults when the file is absent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(readPublishTimes(DATE, root)).toBeNull();
    expect(await getSlotPublishTime(DATE, 1, root)).toBe("11:30");
    expect(await getSlotPublishTime(DATE, 2, root)).toBe("20:30");
    expect(defaultSlotTime(3)).toBe("12:00");
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["bad JSON", "{"],
    ["date mismatch", JSON.stringify({ date: "2026-10-07", slots: [] })],
    ["invalid time", JSON.stringify({ date: DATE, slots: [{ slot: 1, time: "24:00" }] })],
    ["non-integer slot", JSON.stringify({ date: DATE, slots: [{ slot: "1", time: "14:12" }] })]
  ])("rejects the whole file on %s and falls back", async (_label, value) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await mkdir(join(root, "data", "publish-times"), { recursive: true });
    await writeFile(join(root, "data", "publish-times", `${DATE}.json`), value);
    expect(readPublishTimes(DATE, root)).toBeNull();
    expect(await getSlotPublishTime(DATE, 1, root)).toBe("11:30");
    expect(await getSlotPublishTime(DATE, 2, root)).toBe("20:30");
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("uses a default only for a slot omitted from a valid file", async () => {
    await writeJson(join(root, "data", "publish-times", `${DATE}.json`), {
      date: DATE,
      experiment: CONFIG.name,
      assigned_at: "2026-10-03T13:40:12.345Z",
      slots: [{ slot: 1, time: "14:12", arm: "afternoon" }]
    });
    expect(await getSlotPublishTime(DATE, 1, root)).toBe("14:12");
    expect(await getSlotPublishTime(DATE, 2, root)).toBe("20:30");
  });

  it("strips a UTF-8 BOM before parsing the daily file", async () => {
    const path = join(root, "data", "publish-times", `${DATE}.json`);
    await mkdir(join(root, "data", "publish-times"), { recursive: true });
    await writeFile(path, `\uFEFF${JSON.stringify({ date: DATE, slots: [{ slot: 1, time: "14:12" }] })}`, "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(readPublishTimes(DATE, root)?.slots[0]?.time).toBe("14:12");
    expect(await getSlotPublishTime(DATE, 1, root)).toBe("14:12");
    expect(warn).not.toHaveBeenCalled();
  });

  it("rejects the whole daily file when a slot is duplicated", async () => {
    const path = join(root, "data", "publish-times", `${DATE}.json`);
    await mkdir(join(root, "data", "publish-times"), { recursive: true });
    await writeFile(path, JSON.stringify({
      date: DATE,
      slots: [{ slot: 1, time: "14:12" }, { slot: 1, time: "15:10" }]
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(readPublishTimes(DATE, root)).toBeNull();
    expect(await getSlotPublishTime(DATE, 1, root)).toBe("11:30");
    expect(await getSlotPublishTime(DATE, 2, root)).toBe("20:30");
    expect(warn).toHaveBeenCalled();
  });
});

describe("ensurePublishTimes", () => {
  it("does not write outside the experiment range or without a readable config", async () => {
    expect(await ensurePublishTimes("2026-10-20", root)).toBeNull();
    await rm(join(root, "data", "publish-time-experiment.json"));
    expect(await ensurePublishTimes(DATE, root)).toBeNull();
    expect(readPublishTimes(DATE, root)).toBeNull();
  });

  it("does not write when the experiment configuration is unreadable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await writeFile(join(root, "data", "publish-time-experiment.json"), "{bad json");
    expect(await ensurePublishTimes(DATE, root)).toBeNull();
    expect(readPublishTimes(DATE, root)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("writes an assignment once and preserves its bytes on later calls", async () => {
    const first = await ensurePublishTimes(DATE, root, {
      randomInt: (min) => min,
      now: new Date("2026-10-03T13:40:12.345Z")
    });
    const path = join(root, "data", "publish-times", `${DATE}.json`);
    const original = await readFile(path, "utf8");
    const second = await ensurePublishTimes(DATE, root, {
      randomInt: (_min, max) => max - 1,
      now: new Date("2026-10-04T13:40:12.345Z")
    });
    expect(second).toEqual(first);
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it.each([
    ["scheduled-log", [{ slot: 1, scheduled_post_id: "fb-1" }]],
    ["posted-log", [{ slot: 2, platform: "instagram", status: "success", dry_run: false }]]
  ])("does not change times after non-dry-run %s evidence", async (directory, entries) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await writeJson(join(root, "data", directory, `${DATE}.json`), entries);
    expect(await ensurePublishTimes(DATE, root)).toBeNull();
    expect(readPublishTimes(DATE, root)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("returns an existing valid file byte-for-byte without overwriting", async () => {
    const path = join(root, "data", "publish-times", `${DATE}.json`);
    const original = '{"date":"2026-10-06","experiment":"fixed","assigned_at":"fixed","slots":[{"slot":1,"time":"14:12"}]}\n';
    await mkdir(join(root, "data", "publish-times"), { recursive: true });
    await writeFile(path, original);
    const result = await ensurePublishTimes(DATE, root);
    expect(result?.slots[0]?.time).toBe("14:12");
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("replaces an invalid pre-existing daily file with a valid assignment", async () => {
    const path = join(root, "data", "publish-times", `${DATE}.json`);
    await mkdir(join(root, "data", "publish-times"), { recursive: true });
    await writeFile(path, "{bad json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await ensurePublishTimes(DATE, root, {
      randomInt: (min) => min,
      now: new Date("2026-10-03T13:40:12.345Z")
    });
    expect(result?.date).toBe(DATE);
    expect(readPublishTimes(DATE, root)?.slots).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
  });

  it("preserves a file that appears while assignment is being prepared", async () => {
    const path = join(root, "data", "publish-times", `${DATE}.json`);
    const winner = { date: DATE, experiment: "winner", assigned_at: "race", slots: [{ slot: 1, time: "14:12" }] };
    let wrote = false;
    // Ensure the racing writer completes before the implementation's commit-point read.
    const syncRandom = (min: number, max: number) => {
      if (!wrote) {
        wrote = true;
        mkdirSync(join(root, "data", "publish-times"), { recursive: true });
        writeFileSync(path, JSON.stringify(winner));
      }
      return Math.min(min, max - 1);
    };
    const result = await ensurePublishTimes(DATE, root, { randomInt: syncRandom });
    expect(result?.experiment).toBe("winner");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(winner);
  });

  it("rejects the whole experiment when a configured slot has no window or fallback", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await writeJson(join(root, "data", "publish-time-experiment.json"), {
      ...WINDOWS_CONFIG,
      windows: { "1": WINDOWS_CONFIG.windows["1"] }
    });
    const path = join(root, "data", "publish-times", `${DATE}.json`);

    expect(await ensurePublishTimes(DATE, root)).toBeNull();
    expect(existsSync(path)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it.each([
    ["start after end", { "1": { start: "15:00", end: "14:00", arm: "afternoon" }, "2": WINDOWS_CONFIG.windows["2"] }],
    ["malformed time", { "1": { start: "9:00", end: "15:00", arm: "afternoon" }, "2": WINDOWS_CONFIG.windows["2"] }],
    ["empty arm", { "1": { start: "14:00", end: "15:00", arm: "" }, "2": WINDOWS_CONFIG.windows["2"] }]
  ])("does not write when a per-slot window has %s", async (_label, windows) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await writeJson(join(root, "data", "publish-time-experiment.json"), { ...WINDOWS_CONFIG, windows });
    const path = join(root, "data", "publish-times", `${DATE}.json`);

    expect(await ensurePublishTimes(DATE, root)).toBeNull();
    expect(existsSync(path)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("uses a legacy fallback for missing window keys and ignores integer keys for other slots", async () => {
    await writeJson(join(root, "data", "publish-time-experiment.json"), {
      ...WINDOWS_CONFIG,
      afternoon_window: { start: "16:00", end: "16:00" },
      windows: {
        "1": { start: "14:00", end: "14:00" },
        "3": null
      },
      probability_afternoon: 1,
      min_gap_minutes: 0
    });
    const result = await ensurePublishTimes(DATE, root, { randomInt: (min) => min });

    expect(result?.slots).toEqual([
      { slot: 1, time: "14:00", arm: "afternoon" },
      { slot: 2, time: "16:00", arm: "afternoon" }
    ]);
  });

  it("rejects a non-integer windows key even when it is outside the configured slots", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await writeJson(join(root, "data", "publish-time-experiment.json"), {
      ...WINDOWS_CONFIG,
      windows: { ...WINDOWS_CONFIG.windows, extra: { start: "14:00", end: "15:00" } }
    });
    const path = join(root, "data", "publish-times", `${DATE}.json`);

    expect(await ensurePublishTimes(DATE, root)).toBeNull();
    expect(existsSync(path)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("assigns each slot from its own window, keeps usual times, and visits all four arm combinations over 2,000 days", async () => {
    const extended = { ...WINDOWS_CONFIG, start_date: "2020-01-01", end_date: "2025-12-31" };
    await writeJson(join(root, "data", "publish-time-experiment.json"), extended);
    let state = 0x12345678;
    const randomInt = (min: number, max: number) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return min + (state % (max - min));
    };
    const seenCombinations = new Set<string>();
    for (let index = 0; index < 2_000; index += 1) {
      const day = new Date(Date.UTC(2020, 0, 1 + index)).toISOString().slice(0, 10);
      const result = await ensurePublishTimes(day, root, { randomInt, now: new Date("2026-10-03T13:40:12.345Z") });
      expect(result).not.toBeNull();
      const one = result!.slots.find((slot) => slot.slot === 1)!;
      const two = result!.slots.find((slot) => slot.slot === 2)!;
      const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
      if (one.arm === "afternoon") {
        expect(minutes(one.time)).toBeGreaterThanOrEqual(14 * 60);
        expect(minutes(one.time)).toBeLessThanOrEqual(15 * 60 + 30);
      } else {
        expect(one).toMatchObject({ time: "11:30", arm: "usual" });
      }
      if (two.arm === "early-evening") {
        expect(minutes(two.time)).toBeGreaterThanOrEqual(19 * 60);
        expect(minutes(two.time)).toBeLessThanOrEqual(19 * 60 + 30);
      } else {
        expect(two).toMatchObject({ time: "20:30", arm: "usual" });
      }
      expect(minutes(one.time)).toBeLessThan(minutes(two.time));
      seenCombinations.add(`${one.arm}:${two.arm}`);
    }
    expect(seenCombinations).toEqual(new Set([
      "afternoon:early-evening",
      "afternoon:usual",
      "usual:early-evening",
      "usual:usual"
    ]));
  }, 120_000);

  it("enforces the minimum gap when both per-slot test windows overlap", async () => {
    const overlapping = {
      ...WINDOWS_CONFIG,
      start_date: "2020-01-01",
      end_date: "2020-04-10",
      probability_afternoon: 1,
      windows: {
        "1": { start: "14:00", end: "15:30", arm: "afternoon" },
        "2": { start: "14:00", end: "15:30", arm: "early-evening" }
      }
    };
    await writeJson(join(root, "data", "publish-time-experiment.json"), overlapping);
    let state = 0x7a5b3c1d;
    const randomInt = (min: number, max: number) => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return min + (state % (max - min));
    };
    for (let index = 0; index < 100; index += 1) {
      const day = new Date(Date.UTC(2020, 0, 1 + index)).toISOString().slice(0, 10);
      const result = await ensurePublishTimes(day, root, { randomInt });
      const one = result!.slots.find((slot) => slot.slot === 1)!;
      const two = result!.slots.find((slot) => slot.slot === 2)!;
      const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
      expect(two.arm).toBe("early-evening");
      expect(minutes(two.time) - minutes(one.time)).toBeGreaterThanOrEqual(60);
    }
  });

  it("preserves the legacy random-call order and exact two-slot assignment", async () => {
    const calls: Array<[number, number]> = [];
    const randomInt = (min: number, max: number) => {
      calls.push([min, max]);
      return min;
    };
    const result = await ensurePublishTimes(DATE, root, {
      randomInt,
      now: new Date("2026-10-03T13:40:12.345Z")
    });

    expect(calls).toEqual([
      [0, 1_000_000],
      [0, 1_000_000],
      [14 * 60, 14 * 60 + 31],
      [15 * 60, 15 * 60 + 31]
    ]);
    expect(result?.slots).toEqual([
      { slot: 1, time: "14:00", arm: "afternoon" },
      { slot: 2, time: "15:00", arm: "afternoon" }
    ]);
  });

  it("assigns 2,000 days within the afternoon, ordering, and gap limits", async () => {
    const extended = { ...CONFIG, start_date: "2020-01-01", end_date: "2025-12-31" };
    await writeJson(join(root, "data", "publish-time-experiment.json"), extended);
    let state = 0x12345678;
    const randomInt = (min: number, max: number) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return min + (state % (max - min));
    };
    const seenArms = new Set<string>();
    for (let index = 0; index < 2_000; index += 1) {
      const day = new Date(Date.UTC(2020, 0, 1 + index)).toISOString().slice(0, 10);
      const result = await ensurePublishTimes(day, root, { randomInt, now: new Date("2026-10-03T13:40:12.345Z") });
      expect(result).not.toBeNull();
      const [one, two] = result!.slots;
      for (const slot of result!.slots) {
        if (slot.arm === "afternoon") {
          const minute = Number(slot.time.slice(0, 2)) * 60 + Number(slot.time.slice(3));
          expect(minute).toBeGreaterThanOrEqual(14 * 60);
          expect(minute).toBeLessThanOrEqual(15 * 60 + 30);
        }
        seenArms.add(`${slot.slot}:${slot.arm}`);
      }
      const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
      expect(minutes(one!.time)).toBeLessThan(minutes(two!.time));
      if (one!.arm === "afternoon" && two!.arm === "afternoon") {
        expect(minutes(two!.time) - minutes(one!.time)).toBeGreaterThanOrEqual(60);
      }
    }
    expect(seenArms).toEqual(new Set(["1:afternoon", "1:usual", "2:afternoon", "2:usual"]));
  }, 120_000);
});
