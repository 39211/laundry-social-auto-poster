import { describe, expect, it } from "vitest";
import { createConcurrencyLimiter } from "../src/concurrencyLimit";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("createConcurrencyLimiter", () => {
  it("never runs more than max tasks at once and still finishes all of them in order", async () => {
    const limit = createConcurrencyLimiter(3);
    let active = 0;
    let peak = 0;
    const started: number[] = [];
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        limit(async () => {
          started.push(index);
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 2));
          active -= 1;
          return index * 2;
        })
      )
    );
    expect(peak).toBe(3);
    expect(results).toEqual(Array.from({ length: 20 }, (_, index) => index * 2));
    expect(started).toEqual(Array.from({ length: 20 }, (_, index) => index));
  });

  it("queues the extra task until a running one finishes", async () => {
    const limit = createConcurrencyLimiter(1);
    const gate = deferred();
    const order: string[] = [];
    const first = limit(async () => {
      order.push("first-start");
      await gate.promise;
      order.push("first-end");
    });
    const second = limit(async () => {
      order.push("second-start");
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(order).toEqual(["first-start"]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("frees the slot when a task throws, so the queue does not stall", async () => {
    const limit = createConcurrencyLimiter(1);
    const failing = limit(async () => {
      throw new Error("boom");
    });
    const next = limit(async () => "ok");
    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });

  it("rejects a limit that is not a positive integer", () => {
    expect(() => createConcurrencyLimiter(0)).toThrow(RangeError);
    expect(() => createConcurrencyLimiter(1.5)).toThrow(RangeError);
  });
});
