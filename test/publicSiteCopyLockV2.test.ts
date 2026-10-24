import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({ operation: "", remaining: 0, calls: 0, code: "EPERM", errno: 0, corrupt: false, target: "" }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const fail = (operation: string) => {
    if (fault.operation !== operation) return;
    fault.calls += 1;
    if (fault.remaining-- > 0) throw Object.assign(new Error("locked"), { code: fault.code, errno: fault.errno });
  };
  return {
    ...actual,
    copyFile: async (...args: Parameters<typeof actual.copyFile>) => { fail("copy"); return actual.copyFile(...args); },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      fail("rename");
      if (fault.operation === "write") expect(await actual.readFile(fault.target, "utf8")).toBe("old");
      return actual.rename(...args);
    },
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      fail("write");
      if (fault.operation === "write") expect(String(args[0])).toMatch(/\.tmp-/);
      return actual.writeFile(...args);
    },
    readFile: async (...args: Parameters<typeof actual.readFile>) => fault.corrupt && String(args[0]) === fault.target
      ? Buffer.from("wrong") : actual.readFile(...args)
  };
});
const { copyFileVerified } = await import("../src/verifiedCopy");
const { createWriteFileWithRetry } = await import("../src/fsRetry");
const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const roots: string[] = [];
afterEach(async () => {
  Object.assign(fault, { operation: "", remaining: 0, calls: 0, code: "EPERM", errno: 0, corrupt: false });
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "copy-v2-"));
  roots.push(root);
  const source = join(root, "source");
  const target = join(root, "target");
  await actual.writeFile(source, "new");
  await actual.writeFile(target, "old");
  fault.target = target;
  return { root, source, target };
}
for (const [operation, code] of [["rename", "EPERM"], ["copy", "EACCES"]]) {
  it(`copy recovers from ${operation} ${code}`, async () => {
    const { root, source, target } = await fixture();
    Object.assign(fault, { operation, code, remaining: 2 });
    const sleeps: number[] = [];
    await copyFileVerified(source, target, target, undefined, async (ms) => { sleeps.push(ms); });
    expect(await readFile(target, "utf8")).toBe("new");
    expect(sleeps).toEqual([200, 400]);
    expect(await readdir(root)).toEqual(["source", "target"]);
  });
}
for (const remaining of [4, 5]) {
  it(`copy has five attempts with ${remaining} locks`, async () => {
    const { source, target } = await fixture();
    Object.assign(fault, { operation: "copy", remaining, code: "UNKNOWN", errno: -4094 });
    const sleeps: number[] = [];
    const result = copyFileVerified(source, target, target, undefined, async (ms) => { sleeps.push(ms); });
    if (remaining === 5) await expect(result).rejects.toThrow(target);
    else await result;
    expect(fault.calls).toBe(5);
    expect(sleeps).toEqual([200, 400, 800, 1600]);
  });
}
for (const [operation, remaining] of [["write", 2], ["rename", 2], ["write", 4], ["write", 5], ["rename", 5]] as const) {
  it(`writer retries ${operation} locked ${remaining} times atomically`, async () => {
    const { root, target } = await fixture();
    Object.assign(fault, { operation, remaining, code: "UNKNOWN", errno: -4094 });
    const sleeps: number[] = [];
    const writer = createWriteFileWithRetry({ write: writeFile, sleep: async (ms) => { sleeps.push(ms); } });
    const result = writer(target, "new", "utf8");
    if (remaining === 5) await expect(result).rejects.toMatchObject({ code: "UNKNOWN" });
    else await result;
    expect(fault.calls).toBe(Math.min(remaining + 1, 5));
    expect(sleeps).toEqual([200, 400, 800, 1600].slice(0, Math.min(remaining, 4)));
    expect(await actual.readFile(target, "utf8")).toBe(remaining === 5 ? "old" : "new");
    expect(await readdir(root)).toEqual(["source", "target"]);
  });
}
it("writer rejects a destination sha mismatch naming the file", async () => {
  const { target } = await fixture();
  fault.corrupt = true;
  const writer = createWriteFileWithRetry({ write: writeFile, sleep: async () => {} });
  await expect(writer(target, "new")).rejects.toThrow(target);
});
