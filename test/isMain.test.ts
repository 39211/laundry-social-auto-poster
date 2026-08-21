import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isMain } from "../src/cli";

// Pass-through fs mock with one-shot fault injection: realpath failures that
// hit only one isMain operand (EACCES, fd exhaustion) cannot be produced
// deterministically with a real filesystem, so the mock throws once for a
// registered path and delegates everything else to the real realpathSync.
const realpathFault = vi.hoisted(() => ({ failOnce: new Set<string>() }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const realpathSync = (path: unknown, options?: unknown): string => {
    const key = String(path);
    if (realpathFault.failOnce.delete(key)) {
      throw Object.assign(new Error(`EACCES: injected fault, realpath '${key}'`), {
        code: "EACCES",
      });
    }
    return (actual.realpathSync as (p: unknown, o?: unknown) => string)(path, options);
  };
  return {
    ...actual,
    realpathSync: Object.assign(realpathSync, {
      native: actual.realpathSync.native,
    }) as unknown as typeof actual.realpathSync,
  };
});

// isMain guards the entry point of every CLI in src/. When it wrongly returns
// false the CLI exits 0 having printed nothing, which schedulers read as
// success (ERROR-BOOK F28: invoking any tsx CLI through a directory junction
// put the junction path in argv[1] while the ESM loader resolved
// import.meta.url through the real path). These tests pin the contract: two
// paths naming the same real file must compare equal, even when only one of
// them goes through a link, and a missing file must degrade to the lexical
// comparison instead of throwing.

let root: string;
let realArgv: string[];

beforeEach(async () => {
  // Snapshot argv before any await can throw, or afterEach restores undefined.
  realArgv = process.argv;
  root = await mkdtemp(join(tmpdir(), "ismain-"));
});

afterEach(async () => {
  process.argv = realArgv;
  realpathFault.failOnce.clear();
  await rm(root, { recursive: true, force: true });
});

describe("isMain", () => {
  it("matches when argv[1] is the module's own path", async () => {
    const entry = join(root, "entry.ts");
    await writeFile(entry, "export {};\n");
    process.argv = [process.execPath, entry];
    expect(isMain(pathToFileURL(entry).href)).toBe(true);
  });

  it("matches when either side reaches the module through a junction-style link", async () => {
    const realDir = join(root, "real");
    await mkdir(realDir);
    const entry = join(realDir, "entry.ts");
    await writeFile(entry, "export {};\n");
    const linkDir = join(root, "link");
    await symlink(realDir, linkDir, "junction");
    const linkedEntry = join(linkDir, "entry.ts");

    // The F28 shape: junction path in argv[1], real path in import.meta.url.
    process.argv = [process.execPath, linkedEntry];
    expect(isMain(pathToFileURL(entry).href)).toBe(true);

    // And the mirror image, for loaders that keep the link path in the URL.
    process.argv = [process.execPath, entry];
    expect(isMain(pathToFileURL(linkedEntry).href)).toBe(true);
  });

  it("rejects a different module in the same directory", async () => {
    const entry = join(root, "entry.ts");
    const other = join(root, "other.ts");
    await writeFile(entry, "export {};\n");
    await writeFile(other, "export {};\n");
    process.argv = [process.execPath, other];
    expect(isMain(pathToFileURL(entry).href)).toBe(false);
  });

  it("returns false when there is no argv[1]", async () => {
    const entry = join(root, "entry.ts");
    await writeFile(entry, "export {};\n");
    process.argv = [process.execPath];
    expect(isMain(pathToFileURL(entry).href)).toBe(false);
  });

  it("falls back to the lexical comparison when the path does not exist", () => {
    const ghost = join(root, "ghost.ts");
    process.argv = [process.execPath, ghost];
    expect(isMain(pathToFileURL(ghost).href)).toBe(true);
  });

  it("keeps distinct nonexistent paths distinct in the fallback", () => {
    // Pins that the fallback preserves the lexical path itself: collapsing
    // realpath failures to any shared sentinel would make these equal.
    process.argv = [process.execPath, join(root, "ghost-a.ts")];
    expect(isMain(pathToFileURL(join(root, "ghost-b.ts")).href)).toBe(false);
  });

  it("compares both sides lexically when realpath fails on only one side", async () => {
    const realDir = join(root, "real");
    await mkdir(realDir);
    const entry = join(realDir, "entry.ts");
    await writeFile(entry, "export {};\n");
    const linkDir = join(root, "link");
    await symlink(realDir, linkDir, "junction");
    const linkedEntry = join(linkDir, "entry.ts");

    // Both operands carry the same link-path spelling; a one-shot fault makes
    // exactly one side lose realpath. Mixing that side's lexical path with the
    // other side's resolved path would split identical inputs into a
    // junction-style mismatch and silently skip main().
    realpathFault.failOnce.add(linkedEntry);
    process.argv = [process.execPath, linkedEntry];
    expect(isMain(pathToFileURL(linkedEntry).href)).toBe(true);
  });

  it.runIf(process.platform === "win32")(
    "compares case-insensitively on win32",
    async () => {
      const entry = join(root, "Entry.ts");
      await writeFile(entry, "export {};\n");
      process.argv = [process.execPath, entry.toLowerCase()];
      expect(isMain(pathToFileURL(entry).href)).toBe(true);
    },
  );
});
