import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync as read } from "node:fs";
import { describe, expect, it } from "vitest";
import { writeApprovedImageDigests, loadApprovedImageDigests } from "../src/imageStamp";

// Luna D6: the approval snapshot is the only witness publishing trusts, and it
// was written with a plain writeFile. A write torn by a crash or a race parses
// as "unusable", which downgrades the day's publish check. The contract under
// test: after any attempt, the file on disk is either the previous complete
// snapshot or the new complete snapshot — never a fragment — and no temp
// litter is left either way.

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "digests-"));
  mkdirSync(join(root, "data", "approved-log"), { recursive: true });
  return root;
}

describe("writeApprovedImageDigests", () => {
  it("writes a snapshot the loader reads back verbatim, leaving no temp files", async () => {
    const root = tempRoot();
    const digests = { "1": { "docs/assets/x/slot-01.png": "abc123" } };
    await writeApprovedImageDigests(root, "2026-08-17", digests);

    expect(await loadApprovedImageDigests(root, "2026-08-17")).toEqual(digests);
    const litter = readdirSync(join(root, "data", "approved-log")).filter((f) =>
      f.includes(".tmp-")
    );
    expect(litter).toEqual([]);
  });

  it("keeps the previous snapshot intact when the new write fails", async () => {
    const root = tempRoot();
    const good = { "1": { "docs/assets/x/slot-01.png": "abc123" } };
    await writeApprovedImageDigests(root, "2026-08-17", good);

    // A circular object makes JSON.stringify throw before any bytes can move.
    const poisoned: Record<string, unknown> = {};
    poisoned["self"] = poisoned;
    await expect(
      writeApprovedImageDigests(
        root,
        "2026-08-17",
        poisoned as unknown as Parameters<typeof writeApprovedImageDigests>[2]
      )
    ).rejects.toThrow();

    // The target still carries the previous complete snapshot, not a fragment.
    expect(await loadApprovedImageDigests(root, "2026-08-17")).toEqual(good);
    const litter = readdirSync(join(root, "data", "approved-log")).filter((f) =>
      f.includes(".tmp-")
    );
    expect(litter).toEqual([]);
  });
});

describe("snapshot writer wiring", () => {
  // Green tests on the helper mean nothing if a caller quietly goes back to
  // a raw writeFile (the grok MUTATION_2 lesson, applied to this snapshot).
  const repoRoot = join(__dirname, "..");

  it("both approval writers go through the atomic helper and never raw-write the snapshot", () => {
    for (const file of ["src/approvePost.ts", "src/autoApprove.ts"]) {
      const source = read(join(repoRoot, file), "utf8");
      expect(source, file).toContain("writeApprovedImageDigests(");
      expect(source, file).not.toMatch(/writeFile\w*\(\s*imageDigestsPath/u);
    }
  });
});
