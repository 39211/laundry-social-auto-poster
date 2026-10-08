import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { writeFile as nodeWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWriteFileWithRetry, writeFileWithRetry } from "../src/fsRetry";

type NodeWriteFile = typeof nodeWriteFile;

const NOT_THROWN = Symbol("not-thrown");

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

async function run(steps: Array<{ error?: unknown }>, path = "docs/rss.xml", data = "<rss/>") {
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
    sleep: async (ms) => {
      sleeps.push(ms);
    }
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
    expect(outcome.calls).toEqual([{ file: "docs/rss.xml", data: "<rss/>", options: "utf8" }]);
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
    expect(outcome.lines).toEqual([
      "writeFile retry 1/6 docs/rss.xml: UNKNOWN\n",
      "writeFile retry 2/6 docs/rss.xml: UNKNOWN\n"
    ]);
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
      "writeFile retry 1/6 docs/rss.xml: UNKNOWN\n",
      "writeFile retry 2/6 docs/rss.xml: UNKNOWN\n",
      "writeFile retry 3/6 docs/rss.xml: UNKNOWN\n",
      "writeFile retry 4/6 docs/rss.xml: UNKNOWN\n",
      "writeFile retry 5/6 docs/rss.xml: UNKNOWN\n"
    ]);
  });

  it("T5 retries EBUSY, EPERM, and EACCES once", async () => {
    for (const code of ["EBUSY", "EPERM", "EACCES"]) {
      const error = { code };
      const outcome = await run([{ error }, {}]);
      expect(outcome.thrown, code).toBe(NOT_THROWN);
      expect(outcome.calls, code).toHaveLength(2);
      expect(outcome.sleeps, code).toEqual([250]);
      expect(outcome.lines, code).toEqual([`writeFile retry 1/6 docs/rss.xml: ${code}\n`]);
    }
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
