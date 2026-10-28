import { describe, expect, it } from "vitest";
import { mapPublicSiteWrites } from "../src/publicSiteWrites";

describe("public site write queue", () => {
  it("returns results in input order even when writes finish out of order", async () => {
    let finishFirst!: () => void;
    const first = new Promise<void>((resolve) => { finishFirst = resolve; });
    const finished: number[] = [];
    const result = mapPublicSiteWrites([0, 1, 2], 2, async (value) => {
      if (value === 0) await first;
      finished.push(value);
      return ["first", "second", "third"][value];
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(finished).toEqual([1, 2]);
    finishFirst();
    expect(await result).toEqual(["first", "second", "third"]);
  });

  it("stops queued writes, drains active writes, then throws the original failure", async () => {
    const error = { errno: -4094, path: "fixture.txt" };
    let finishOther!: () => void;
    const other = new Promise<void>((resolve) => { finishOther = resolve; });
    const started: number[] = [];
    let settled = false;
    const result = mapPublicSiteWrites([0, 1, 2, 3], 2, async (value) => {
      started.push(value);
      if (value === 0) throw error;
      await other;
    }).then(() => { settled = true; return null; }, (failure) => { settled = true; return failure; });
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    expect(settled).toBe(false);
    finishOther();
    expect(await result).toBe(error);
    expect(started).toEqual([0, 1]);
  });
});
