import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { openMock } = vi.hoisted(() => ({ openMock: vi.fn() }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  openMock.mockImplementation(actual.open);
  return { ...actual, open: openMock };
});

import { withJsonFileLock } from "../src/logging";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("JSON file lock owner fencing", () => {
  const roots: string[] = [];

  afterEach(async () => {
    openMock.mockClear();
    await Promise.all(
      roots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }))
    );
  });

  it("does not reclaim an active owner merely because its lock is stale", async () => {
    const root = await mkdtemp(join(tmpdir(), "json-lock-owner-fencing-"));
    roots.push(root);
    const path = join(root, "data", "ledger.json");
    const lockPath = `${path}.lock`;
    const aEntered = deferred();
    const releaseA = deferred();
    const bAcquired = deferred();
    const releaseB = deferred();

    const ownerA = withJsonFileLock(path, async () => {
      aEntered.resolve();
      await releaseA.promise;
    });
    await aEntered.promise;

    const old = new Date(Date.now() - 2_000);
    await utimes(lockPath, old, old);

    let bEntered = false;
    const ownerB = withJsonFileLock(
      path,
      async () => {
        bEntered = true;
        bAcquired.resolve();
        await releaseB.promise;
      },
      { staleMs: 1, timeoutMs: 1_000 }
    );

    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(bEntered).toBe(false);
    await expect(stat(lockPath)).resolves.toBeDefined();

    releaseA.resolve();
    await ownerA;
    await bAcquired.promise;
    await expect(stat(lockPath)).resolves.toBeDefined();

    releaseB.resolve();
    await ownerB;
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reclaims a stale legacy lock only after its recorded owner PID exits", async () => {
    const root = await mkdtemp(join(tmpdir(), "json-lock-dead-owner-"));
    roots.push(root);
    const path = join(root, "data", "ledger.json");
    const lockPath = `${path}.lock`;
    await mkdir(dirname(lockPath), { recursive: true });
    const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
    const deadPid = child.pid;
    await once(child, "exit");
    expect(deadPid).toBeDefined();
    await writeFile(lockPath, `${deadPid} 2026-08-19T00:00:00.000Z\n`, "utf8");
    const old = new Date(Date.now() - 2_000);
    await utimes(lockPath, old, old);

    let entered = false;
    await withJsonFileLock(
      path,
      async () => {
        entered = true;
      },
      { staleMs: 1, timeoutMs: 1_000 }
    );

    expect(entered).toBe(true);
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not reclaim an unparseable stale owner under the default policy", async () => {
    const root = await mkdtemp(join(tmpdir(), "json-lock-unknown-owner-"));
    roots.push(root);
    const path = join(root, "data", "ledger.json");
    const lockPath = `${path}.lock`;
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, "legacy crashed owner\n", "utf8");
    const old = new Date(Date.now() - 2_000);
    await utimes(lockPath, old, old);

    await expect(withJsonFileLock(path, async () => undefined, { staleMs: 1, timeoutMs: 25 })).rejects.toThrow(
      "Timed out waiting for JSON log lock"
    );
    await expect(stat(lockPath)).resolves.toBeDefined();
  });

  it("does not reclaim a stale lock under the fail-closed policy", async () => {
    const root = await mkdtemp(join(tmpdir(), "json-lock-fail-policy-"));
    roots.push(root);
    const path = join(root, "data", "ledger.json");
    const lockPath = `${path}.lock`;
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, "legacy crashed owner\n", "utf8");
    const old = new Date(Date.now() - 2_000);
    await utimes(lockPath, old, old);

    let entered = false;
    await expect(
      withJsonFileLock(
        path,
        async () => {
          entered = true;
        },
        { staleMs: 1, timeoutMs: 25, stalePolicy: "fail" }
      )
    ).rejects.toThrow("Refusing stale JSON log lock under fail-closed policy");

    expect(entered).toBe(false);
    await expect(stat(lockPath)).resolves.toBeDefined();
  });

  it("treats a proven EPERM lock collision as contention, not ownership", async () => {
    const root = await mkdtemp(join(tmpdir(), "json-lock-eperm-contention-"));
    roots.push(root);
    const path = join(root, "data", "ledger.json");
    const lockPath = `${path}.lock`;
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, "owner=existing\npid=1\nacquired_at=2026-08-19T00:00:00.000Z\n", "utf8");

    let injected = false;
    openMock.mockImplementationOnce(async () => {
      injected = true;
      const error = new Error("simulated Windows sharing violation") as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    });

    await expect(
      withJsonFileLock(path, async () => undefined, { staleMs: 60_000, timeoutMs: 30, stalePolicy: "fail" })
    ).rejects.toThrow("automatic recovery is disabled and manual recovery is required");

    expect(injected).toBe(true);
    await expect(stat(lockPath)).resolves.toBeDefined();
  });
});
