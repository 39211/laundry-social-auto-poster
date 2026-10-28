import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { writeFile as nodeWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWriteFileWithRetry, MAX_CONCURRENT_WRITES, writeFileWithRetry } from "../src/fsRetry";

type NodeWriteFile = typeof nodeWriteFile;

const NOT_THROWN = Symbol("not-thrown");
const RETRY_AT = "2026-10-25T06:32:27.123Z";

function retryLine(attempt: number, code: string, errno?: number, stamp = RETRY_AT): string {
  const errnoText = errno === undefined ? "" : ` errno=${errno}`;
  return `${stamp} writeFile retry ${attempt}/6 docs/rss.xml: ${code}${errnoText}\n`;
}

function captureStderr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stderr.write;
  return {
    lines,
    restore: () => {
      process.stderr.write = original;
    }
  };
}

async function run(
  steps: Array<{ error?: unknown }>,
  path = "docs/rss.xml",
  data = "<rss/>",
  now: () => Date = () => new Date(RETRY_AT)
) {
  const calls: Array<{ file: unknown; data: unknown; options: unknown }> = [];
  const sleeps: number[] = [];
  const write: NodeWriteFile = async (file, fileData, options) => {
    calls.push({ file, data: fileData, options });
    const step = steps[calls.length - 1];
    if (!step) throw new Error(`unexpected write #${calls.length}`);
    if ("error" in step && step.error !== undefined) throw step.error;
  };
  const writeRetry = createWriteFileWithRetry({
    write,
    rename: async () => {},
    read: async () => Buffer.from(data),
    remove: async () => {},
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now
  });
  const stderr = captureStderr();
  let thrown: unknown = NOT_THROWN;
  try {
    await writeRetry(path, data, "utf8");
  } catch (error) {
    thrown = error;
  } finally {
    stderr.restore();
  }
  return { calls, sleeps, lines: stderr.lines, thrown };
}

describe("writeFileWithRetry", () => {
  it("T1 succeeds on the first attempt", async () => {
    const outcome = await run([{}]);
    expect(outcome.thrown).toBe(NOT_THROWN);
    expect(outcome.calls).toEqual([{ file: expect.stringMatching(/^docs\/rss\.xml\.tmp-/), data: expect.any(Buffer), options: "utf8" }]);
    expect(outcome.sleeps).toEqual([]);
    expect(outcome.lines).toEqual([]);
  });

  it("T2 retries UNKNOWN twice then succeeds", async () => {
    const first = { code: "UNKNOWN" };
    const second = { code: "UNKNOWN" };
    const outcome = await run([{ error: first }, { error: second }, {}]);
    expect(outcome.thrown).toBe(NOT_THROWN);
    expect(outcome.calls).toHaveLength(3);
    expect(outcome.sleeps).toEqual([250, 500]);
    expect(outcome.lines).toEqual([retryLine(1, "UNKNOWN"), retryLine(2, "UNKNOWN")]);
  });

  it("T3 rejects ENOENT immediately with the same error", async () => {
    const error = { code: "ENOENT", errno: -4058, path: "missing.xml" };
    const outcome = await run([{ error }]);
    expect(outcome.thrown).toBe(error);
    expect(outcome.calls).toHaveLength(1);
    expect(outcome.sleeps).toEqual([]);
    expect(outcome.lines).toEqual([]);
  });

  it("T4 rejects the last UNKNOWN after six attempts", async () => {
    const errors = Array.from({ length: 6 }, (_, index) => ({ code: "UNKNOWN", n: index + 1 }));
    const outcome = await run(errors.map((error) => ({ error })));
    expect(outcome.thrown).toBe(errors[5]);
    expect(outcome.thrown).toMatchObject({ code: "UNKNOWN" });
    expect(outcome.calls).toHaveLength(6);
    expect(outcome.sleeps).toEqual([250, 500, 1000, 2000, 3000]);
    expect(outcome.lines).toEqual([
      retryLine(1, "UNKNOWN"),
      retryLine(2, "UNKNOWN"),
      retryLine(3, "UNKNOWN"),
      retryLine(4, "UNKNOWN"),
      retryLine(5, "UNKNOWN"),
      retryLine(6, "UNKNOWN")
    ]);
  });

  it("T5 retries EBUSY, EPERM, and EACCES once", async () => {
    for (const code of ["EBUSY", "EPERM", "EACCES"]) {
      const error = { code };
      const outcome = await run([{ error }, {}]);
      expect(outcome.thrown, code).toBe(NOT_THROWN);
      expect(outcome.calls, code).toHaveLength(2);
      expect(outcome.sleeps, code).toEqual([250]);
      expect(outcome.lines, code).toEqual([retryLine(1, code)]);
    }
  });

  it("T7 stamps each UNKNOWN errno -4094 failure with its own ISO millisecond time", async () => {
    const stamps = [
      "2026-10-25T06:32:27.100Z",
      "2026-10-25T06:32:27.351Z",
      "2026-10-25T06:32:28.352Z",
      "2026-10-25T06:32:30.353Z",
      "2026-10-25T06:32:33.354Z",
      "2026-10-25T06:32:36.355Z"
    ];
    let cursor = 0;
    const errors = stamps.map(() => ({ code: "UNKNOWN", errno: -4094 }));
    const outcome = await run(
      errors.map((error) => ({ error })),
      "docs/rss.xml",
      "<rss/>",
      () => new Date(stamps[cursor++] ?? stamps[stamps.length - 1]!)
    );
    expect(outcome.thrown).toBe(errors[5]);
    expect(outcome.sleeps).toEqual([250, 500, 1000, 2000, 3000]);
    expect(outcome.lines).toEqual(
      stamps.map((stamp, index) => retryLine(index + 1, "UNKNOWN", -4094, stamp))
    );
    expect(cursor).toBe(6);
  });

  it("T8 retries UNKNOWN errno -4094 and bare errno -4094, then succeeds with errno in the log", async () => {
    const outcome = await run([{ error: { code: "UNKNOWN", errno: -4094 } }, { error: { errno: -4094 } }, {}]);
    expect(outcome.thrown).toBe(NOT_THROWN);
    expect(outcome.calls).toHaveLength(3);
    expect(outcome.sleeps).toEqual([250, 500]);
    expect(outcome.lines).toEqual([
      retryLine(1, "UNKNOWN", -4094),
      `${RETRY_AT} writeFile retry 2/6 docs/rss.xml: none errno=-4094\n`
    ]);
  });

  it("T9 logs the final failed attempt before throwing, then stops sleeping", async () => {
    const errors = Array.from({ length: 6 }, () => ({ code: "EBUSY", errno: -4082 }));
    const outcome = await run(errors.map((error) => ({ error })));
    expect(outcome.thrown).toBe(errors[5]);
    expect(outcome.calls).toHaveLength(6);
    expect(outcome.sleeps).toHaveLength(5);
    expect(outcome.lines).toHaveLength(6);
    expect(outcome.lines[5]).toBe(retryLine(6, "EBUSY", -4082));
  });

  it("T6 default writer persists bytes under os.tmpdir()", async () => {
    const root = mkdtempSync(join(tmpdir(), "fs-retry-"));
    const file = join(root, "rss.xml");
    const payload = "rss-retry-私享家\n";
    try {
      await writeFileWithRetry(file, payload, "utf8");
      expect(readFileSync(file, "utf8")).toBe(payload);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("writeFileWithRetry concurrency cap", () => {
  function countingWriter(failCodeFor?: (file: string) => string | undefined) {
    let active = 0;
    let peak = 0;
    const write: NodeWriteFile = async (file) => {
      active += 1;
      peak = Math.max(peak, active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 3));
        const code = failCodeFor?.(String(file));
        if (code) throw { code };
      } finally {
        active -= 1;
      }
    };
    return { write, peak: () => peak };
  }

  it("caps simultaneous writes at 8 by default while all 60 writes still complete", async () => {
    expect(MAX_CONCURRENT_WRITES).toBe(8);
    const counter = countingWriter();
    const writeRetry = createWriteFileWithRetry({
      write: counter.write,
      rename: async () => {},
      read: async () => Buffer.from("x"),
      remove: async () => {},
      sleep: async () => {}
    });
    await Promise.all(Array.from({ length: 60 }, (_, index) => writeRetry(`docs/posts/page-${index}.html`, "x", "utf8")));
    expect(counter.peak()).toBe(8);
  });

  it("honours a smaller injected cap and keeps it even when writes retry after -4094", async () => {
    const failedOnce = new Set<string>();
    const counter = countingWriter((file) => {
      const key = file.replace(/\.tmp-.*$/u, "");
      if (failedOnce.has(key)) return undefined;
      failedOnce.add(key);
      return "UNKNOWN";
    });
    const writeRetry = createWriteFileWithRetry({
      write: counter.write,
      rename: async () => {},
      read: async () => Buffer.from("x"),
      remove: async () => {},
      sleep: async () => {},
      maxConcurrentWrites: 2
    });
    const stderr = captureStderr();
    try {
      await Promise.all(Array.from({ length: 12 }, (_, index) => writeRetry(`docs/p-${index}.html`, "x", "utf8")));
    } finally {
      stderr.restore();
    }
    expect(counter.peak()).toBe(2);
    expect(stderr.lines).toHaveLength(12);
  });

  it("releases the slot after a non-retryable error so later writes are not blocked", async () => {
    const counter = countingWriter((file) => (file.startsWith("docs/bad") ? "ENOENT" : undefined));
    const writeRetry = createWriteFileWithRetry({
      write: counter.write,
      rename: async () => {},
      read: async () => Buffer.from("x"),
      remove: async () => {},
      sleep: async () => {},
      maxConcurrentWrites: 1
    });
    const results = await Promise.allSettled([
      writeRetry("docs/bad.html", "x", "utf8"),
      writeRetry("docs/good-1.html", "x", "utf8"),
      writeRetry("docs/good-2.html", "x", "utf8")
    ]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled", "fulfilled"]);
    expect(counter.peak()).toBe(1);
  });
});
