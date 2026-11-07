import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { mkdtemp as fsMkdtemp, mkdir as fsMkdir, readFile as fsReadFile, readdir as fsReaddir, rename as fsRename, rm as fsRm, writeFile as fsWriteFile } from "node:fs/promises";
import { writeFile as nodeWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWriteFileWithRetry, writeFileWithRetry } from "../src/fsRetry";
import * as fsRetryModule from "../src/fsRetry";

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

  it("T7 after six retryable failures an atomic replace is tried once and wins", async () => {
    const replaced: Array<{ file: string; data: unknown }> = [];
    const write: NodeWriteFile = async () => {
      throw { code: "UNKNOWN" };
    };
    const writeRetry = createWriteFileWithRetry({
      write,
      sleep: async () => undefined,
      replace: async (file, data) => {
        replaced.push({ file, data });
      }
    });
    const stderr = captureStderr();
    try {
      await writeRetry("docs/rss.xml", "<rss/>", "utf8");
    } finally {
      stderr.restore();
    }
    expect(replaced).toEqual([{ file: "docs/rss.xml", data: "<rss/>" }]);
    expect(stderr.lines.at(-1)).toBe("writeFile atomic fallback ok docs/rss.xml: UNKNOWN\n");
  });

  it("T8 a failing atomic replace rethrows the last direct-write error; ENOENT never falls back", async () => {
    const last = { code: "UNKNOWN", n: 6 };
    let n = 0;
    const writeRetry = createWriteFileWithRetry({
      write: async () => {
        n += 1;
        throw n === 6 ? last : { code: "UNKNOWN", n };
      },
      sleep: async () => undefined,
      replace: async () => {
        throw { code: "EACCES" };
      }
    });
    const stderr = captureStderr();
    let thrown: unknown;
    try {
      await writeRetry("docs/rss.xml", "<rss/>", "utf8");
    } catch (error) {
      thrown = error;
    } finally {
      stderr.restore();
    }
    expect(thrown).toBe(last);
    let replaceCalls = 0;
    const enoent = { code: "ENOENT" };
    const noFallback = createWriteFileWithRetry({
      write: async () => {
        throw enoent;
      },
      sleep: async () => undefined,
      replace: async () => {
        replaceCalls += 1;
      }
    });
    await expect(noFallback("missing/x.xml", "x", "utf8")).rejects.toBe(enoent);
    expect(replaceCalls).toBe(0);
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

type AtomicDeps = fsRetryModule.AtomicReplaceDependencies;
type AtomicCall = { op: string; path?: string; from?: string; to?: string };

function makeFakeAtomicDeps(): { deps: AtomicDeps; calls: AtomicCall[]; files: Map<string, unknown> } {
  const calls: AtomicCall[] = [];
  const files = new Map<string, unknown>();
  let id = 0;
  const deps: AtomicDeps = {
    writeFile: async (file, data) => {
      calls.push({ op: "write", path: String(file) });
      files.set(String(file), data);
    },
    rename: async (from, to) => {
      calls.push({ op: "rename", from, to });
      if (!files.has(from)) throw new Error(`missing fake source: ${from}`);
      const value = files.get(from);
      files.delete(to);
      files.delete(from);
      files.set(to, value);
    },
    unlink: async (path) => {
      calls.push({ op: "unlink", path });
      files.delete(path);
    },
    mkdir: async (path) => {
      calls.push({ op: "mkdir", path });
    },
    lockedFilesDirectory: () => join("archive"),
    uniqueId: () => `uuid-${++id}`,
    now: () => new Date("2026-10-31T12:34:56.789Z")
  };
  return { deps, calls, files };
}

function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

describe("createAtomicReplace unit behavior", () => {
  it("U1 renames the sibling temp file over the target and always tries temp cleanup", async () => {
    const setup = makeFakeAtomicDeps();
    const file = join("docs", "target.xml");
    setup.files.set(file, "old");
    const replace = fsRetryModule.createAtomicReplace(setup.deps);

    await replace(file, "new", "utf8");

    const temp = `${file}.${process.pid}.uuid-1.tmp`;
    expect(setup.calls).toEqual([
      { op: "write", path: temp },
      { op: "rename", from: temp, to: file },
      { op: "unlink", path: temp }
    ]);
    expect(setup.files.get(file)).toBe("new");
    expect(setup.calls.some((call) => call.op === "mkdir")).toBe(false);
  });

  it("U2 moves the locked original for EPERM, EBUSY, UNKNOWN, and EACCES", async () => {
    for (const code of ["EPERM", "EBUSY", "UNKNOWN", "EACCES"]) {
      const setup = makeFakeAtomicDeps();
      const file = join("docs", "target.xml");
      setup.files.set(file, "old");
      const firstError = { code };
      const baseRename = setup.deps.rename;
      let renameCount = 0;
      setup.deps.rename = async (from, to) => {
        renameCount += 1;
        if (renameCount === 1) {
          setup.calls.push({ op: "rename", from, to });
          throw firstError;
        }
        await baseRename(from, to);
      };
      const replace = fsRetryModule.createAtomicReplace(setup.deps);
      const stderr = captureStderr();
      try {
        await replace(file, "new", "utf8");
      } finally {
        stderr.restore();
      }

      const renames = setup.calls.filter((call) => call.op === "rename");
      expect(setup.calls.map((call) => call.op), code).toEqual(["write", "rename", "mkdir", "rename", "rename", "unlink"]);
      expect(renames[1]?.from, code).toBe(file);
      expect(renames[1]?.to, code).toContain(join("archive", ""));
      expect(renames[1]?.to?.endsWith("-target.xml"), code).toBe(true);
      expect(stderr.lines, code).toContain(`writeFile atomic fallback moved locked original ${file} -> ${renames[1]?.to}\n`);
      expect(setup.files.get(file), code).toBe("new");
      expect(setup.files.get(renames[1]?.to ?? ""), code).toBe("old");
    }
  });

  it("U3 does not move the original when the first rename fails with ENOENT", async () => {
    const setup = makeFakeAtomicDeps();
    const file = join("docs", "target.xml");
    setup.files.set(file, "old");
    const error = { code: "ENOENT" };
    const baseRename = setup.deps.rename;
    setup.deps.rename = async (from, to) => {
      setup.calls.push({ op: "rename", from, to });
      throw error;
    };
    const replace = fsRetryModule.createAtomicReplace(setup.deps);

    await expect(replace(file, "new", "utf8")).rejects.toBe(error);
    expect(setup.calls.map((call) => call.op)).toEqual(["write", "rename", "unlink"]);
    expect(setup.files.get(file)).toBe("old");
    void baseRename;
  });

  it("U4 cleans up the temp path when writing the temp file fails", async () => {
    const setup = makeFakeAtomicDeps();
    const error = { code: "EACCES" };
    setup.deps.writeFile = async (file) => {
      setup.calls.push({ op: "write-failed", path: String(file) });
      throw error;
    };
    const replace = fsRetryModule.createAtomicReplace(setup.deps);

    await expect(replace(join("docs", "target.xml"), "new", "utf8")).rejects.toBe(error);
    expect(setup.calls.map((call) => call.op)).toEqual(["write-failed", "unlink"]);
    expect(setup.calls.some((call) => call.op === "rename")).toBe(false);
  });

  it("U5 stops when moving the locked original fails and still cleans the temp path", async () => {
    const setup = makeFakeAtomicDeps();
    const file = join("docs", "target.xml");
    setup.files.set(file, "old");
    const installError = { code: "EPERM" };
    const moveError = { code: "EBUSY" };
    const baseRename = setup.deps.rename;
    let renameCount = 0;
    setup.deps.rename = async (from, to) => {
      renameCount += 1;
      setup.calls.push({ op: "rename", from, to });
      if (renameCount === 1) throw installError;
      if (renameCount === 2) throw moveError;
      await baseRename(from, to);
    };
    const replace = fsRetryModule.createAtomicReplace(setup.deps);

    await expect(replace(file, "new", "utf8")).rejects.toBe(moveError);
    expect(setup.calls.map((call) => call.op)).toEqual(["write", "rename", "mkdir", "rename", "unlink"]);
    expect(setup.files.get(file)).toBe("old");
  });

  it("U6 tries to restore the original after install failure and logs when restore also fails", async () => {
    const file = join("docs", "target.xml");
    for (const restoreFails of [false, true]) {
      const setup = makeFakeAtomicDeps();
      setup.files.set(file, "old");
      const firstError = { code: "EPERM" };
      const installError = { code: "EACCES" };
      const restoreError = { code: "EBUSY" };
      const baseRename = setup.deps.rename;
      let renameCount = 0;
      setup.deps.rename = async (from, to) => {
        renameCount += 1;
        if (renameCount === 1) {
          setup.calls.push({ op: "rename", from, to });
          throw firstError;
        }
        if (renameCount === 3) {
          setup.calls.push({ op: "rename", from, to });
          throw installError;
        }
        if (renameCount === 4 && restoreFails) {
          setup.calls.push({ op: "rename", from, to });
          throw restoreError;
        }
        await baseRename(from, to);
      };
      const replace = fsRetryModule.createAtomicReplace(setup.deps);
      const stderr = captureStderr();
      try {
        await expect(replace(file, "new", "utf8")).rejects.toBe(installError);
      } finally {
        stderr.restore();
      }

      const renames = setup.calls.filter((call) => call.op === "rename");
      expect(renames[3]?.from).toBe(renames[1]?.to);
      expect(renames[3]?.to).toBe(file);
      expect(setup.calls.at(-1)?.op).toBe("unlink");
      if (restoreFails) {
        expect(stderr.lines).toContain(`writeFile atomic fallback restore failed ${file}: original left at ${renames[1]?.to}\n`);
      } else {
        expect(setup.files.get(file)).toBe("old");
      }
    }
  });

  it("U7 refuses to move the original into the target directory or a child", async () => {
    const setup = makeFakeAtomicDeps();
    const file = join("docs", "target.xml");
    setup.files.set(file, "old");
    setup.deps.lockedFilesDirectory = () => join("docs", "archive");
    const error = { code: "EPERM" };
    const baseRename = setup.deps.rename;
    setup.deps.rename = async (from, to) => {
      setup.calls.push({ op: "rename", from, to });
      throw error;
    };
    const replace = fsRetryModule.createAtomicReplace(setup.deps);

    await expect(replace(file, "new", "utf8")).rejects.toBe(error);
    expect(setup.calls.map((call) => call.op)).toEqual(["write", "rename", "unlink"]);
    expect(setup.files.get(file)).toBe("old");
    void baseRename;
  });

  it("U8 logs fallback failure and rethrows the last retryable direct-write error", async () => {
    const last = { code: "UNKNOWN", attempt: 6 };
    let writes = 0;
    const fallbackError = new Error("fallback denied");
    const writeRetry = fsRetryModule.createWriteFileWithRetry({
      write: async () => {
        writes += 1;
        throw writes === 6 ? last : { code: "UNKNOWN", attempt: writes };
      },
      sleep: async () => undefined,
      replace: async () => {
        throw fallbackError;
      }
    });
    const stderr = captureStderr();
    let thrown: unknown;
    try {
      await writeRetry("docs/target.xml", "new", "utf8");
    } catch (error) {
      thrown = error;
    } finally {
      stderr.restore();
    }

    expect(thrown).toBe(last);
    expect(stderr.lines).toContain("writeFile atomic fallback failed docs/target.xml: fallback denied\n");
  });
});

describe("writeFileWithRetry fallback boundary", () => {
  it("T8 extension never falls back for a non-retryable sixth direct-write error", async () => {
    const last = { code: "ENOENT", attempt: 6 };
    let writes = 0;
    let replaceCalls = 0;
    const writeRetry = fsRetryModule.createWriteFileWithRetry({
      write: async () => {
        writes += 1;
        throw writes === 6 ? last : { code: "UNKNOWN", attempt: writes };
      },
      sleep: async () => undefined,
      replace: async () => {
        replaceCalls += 1;
      }
    });

    await expect(writeRetry("docs/target.xml", "new", "utf8")).rejects.toBe(last);
    expect(writes).toBe(6);
    expect(replaceCalls).toBe(0);
  });
});

type HolderMode = "view-only" | "keep-handles" | "keep-handles-nodelete";

function spawnMapHolder(target: string, mode: HolderMode) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Core",
    "$path = $env:FSRETRY_HOLD_PATH",
    "$mode = $env:FSRETRY_HOLD_MODE",
    "$share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete",
    "if ($mode -eq 'keep-handles-nodelete') { $share = [System.IO.FileShare]::ReadWrite }",
    "$fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)",
    "$mmf = [System.IO.MemoryMappedFiles.MemoryMappedFile]::CreateFromFile($fs, [NullString]::Value, 0, [System.IO.MemoryMappedFiles.MemoryMappedFileAccess]::Read, $null, [System.IO.HandleInheritability]::None, $false)",
    "$view = $mmf.CreateViewAccessor(0, 0, [System.IO.MemoryMappedFiles.MemoryMappedFileAccess]::Read)",
    "if ($mode -eq 'view-only') { $mmf.Dispose() }",
    "[Console]::Out.WriteLine('READY')",
    "[Console]::Out.Flush()",
    "[void][Console]::In.ReadLine()",
    "$view.Dispose()",
    "if ($mode -ne 'view-only') { $mmf.Dispose() }"
  ].join("\r\n");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
    env: { ...process.env, FSRETRY_HOLD_PATH: target, FSRETRY_HOLD_MODE: mode },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  let stderr = "";
  let stdout = "";
  let readySettled = false;
  let closed = false;
  const closedPromise = new Promise<void>((resolve) => {
    child.once("close", () => {
      closed = true;
      resolve();
    });
  });
  const ready = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (readySettled) return;
      readySettled = true;
      reject(new Error(`Timed out waiting for READY; stderr=${stderr}`));
    }, 30000);
    const fail = (message: string) => {
      if (readySettled) return;
      readySettled = true;
      clearTimeout(timeout);
      reject(new Error(`${message}; stderr=${stderr}`));
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (!stdout.split(/\r?\n/).some((line) => line.trim() === "READY") || readySettled) return;
      readySettled = true;
      clearTimeout(timeout);
      resolve();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => fail(`Holder process error: ${error.message}`));
    child.once("close", (code, signal) => fail(`Holder exited before READY (code=${code}, signal=${signal})`));
  });
  return {
    child,
    ready,
    async stop() {
      try {
        child.stdin.end();
      } catch {
        // Ignore a closed stdin; this helper owns the child process.
      }
      try {
        child.kill();
      } catch {
        // Ignore a process that already exited; closePromise below still confirms exit.
      }
      if (!closed) await closedPromise;
    }
  };
}

async function makeRealTarget() {
  const root = await fsMkdtemp(join(tmpdir(), "fs-retry-r-"));
  const docs = join(root, "docs");
  await fsMkdir(docs, { recursive: true });
  const target = join(docs, "target.xml");
  const oldContent = `OLD-${"x".repeat(4096)}`;
  await fsWriteFile(target, oldContent, "utf8");
  const previousProjectRoot = process.env.PROJECT_ROOT;
  process.env.PROJECT_ROOT = root;
  return {
    root,
    docs,
    target,
    oldContent,
    restoreProjectRoot() {
      if (previousProjectRoot === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = previousProjectRoot;
    }
  };
}

async function readDirectoryOrEmpty(path: string): Promise<string[]> {
  try {
    return await fsReaddir(path);
  } catch (error) {
    if (errorCodeOf(error) === "ENOENT") return [];
    throw error;
  }
}

const itOnWindows = it.runIf(process.platform === "win32");

itOnWindows("R0 view-only mapping reproduces UNKNOWN -4094 open without changing content", async () => {
  const context = await makeRealTarget();
  const holder = spawnMapHolder(context.target, "view-only");
  try {
    await holder.ready;
    let thrown: unknown;
    try {
      await nodeWriteFile(context.target, "NEW", "utf8");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: "UNKNOWN", errno: -4094, syscall: "open" });
    expect(await fsReadFile(context.target, "utf8")).toBe(context.oldContent);
  } finally {
    await holder.stop();
    context.restoreProjectRoot();
    await fsRm(context.root, { recursive: true, force: true });
  }
}, 60000);

itOnWindows("R0 keep-handles mapping reproduces UNKNOWN -4094 open without changing content", async () => {
  const context = await makeRealTarget();
  const holder = spawnMapHolder(context.target, "keep-handles");
  try {
    await holder.ready;
    let thrown: unknown;
    try {
      await nodeWriteFile(context.target, "NEW", "utf8");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: "UNKNOWN", errno: -4094, syscall: "open" });
    expect(await fsReadFile(context.target, "utf8")).toBe(context.oldContent);
  } finally {
    await holder.stop();
    context.restoreProjectRoot();
    await fsRm(context.root, { recursive: true, force: true });
  }
}, 60000);

itOnWindows("R1 view-only mapping is repaired by the default atomic replacement export", async () => {
  const context = await makeRealTarget();
  const holder = spawnMapHolder(context.target, "view-only");
  const stderr = captureStderr();
  try {
    await holder.ready;
    const writeRetry = fsRetryModule.createWriteFileWithRetry({
      write: nodeWriteFile,
      sleep: async () => undefined,
      replace: fsRetryModule.atomicReplace
    });
    await writeRetry(context.target, "NEW-CONTENT", "utf8");
    expect(await fsReadFile(context.target, "utf8")).toBe("NEW-CONTENT");
    expect(await fsReaddir(context.docs)).toEqual(["target.xml"]);
    expect(stderr.lines).toContain(`writeFile atomic fallback ok ${context.target}: UNKNOWN\n`);
  } finally {
    stderr.restore();
    await holder.stop();
    context.restoreProjectRoot();
    await fsRm(context.root, { recursive: true, force: true });
  }
}, 60000);

itOnWindows("R2 keep-handles mapping is moved aside before the replacement is installed", async () => {
  const context = await makeRealTarget();
  const holder = spawnMapHolder(context.target, "keep-handles");
  const stderr = captureStderr();
  try {
    await holder.ready;
    const probe = join(context.root, "probe.xml");
    await fsWriteFile(probe, "probe", "utf8");
    let probeError: unknown;
    try {
      await fsRename(probe, context.target);
    } catch (error) {
      probeError = error;
    }
    await fsRm(probe, { force: true });
    expect(probeError, "Precondition failed: rename over a keep-handles mapped target must return EPERM on this host").toMatchObject({ code: "EPERM" });

    const writeRetry = fsRetryModule.createWriteFileWithRetry({
      write: nodeWriteFile,
      sleep: async () => undefined,
      replace: fsRetryModule.atomicReplace
    });
    await writeRetry(context.target, "NEW-CONTENT", "utf8");
    const lockedDirectory = join(context.root, "output", "locked-files");
    const archived = await fsReaddir(lockedDirectory);
    expect(await fsReadFile(context.target, "utf8")).toBe("NEW-CONTENT");
    expect(await fsReaddir(context.docs)).toEqual(["target.xml"]);
    expect(archived).toHaveLength(1);
    expect(archived[0]?.endsWith("-target.xml")).toBe(true);
    expect(await fsReadFile(join(lockedDirectory, archived[0] ?? ""), "utf8")).toBe(context.oldContent);
    expect(stderr.lines.some((line) => line.startsWith(`writeFile atomic fallback moved locked original ${context.target} -> `))).toBe(true);
  } finally {
    stderr.restore();
    await holder.stop();
    context.restoreProjectRoot();
    await fsRm(context.root, { recursive: true, force: true });
  }
}, 60000);

itOnWindows("R3 keep-handles-nodelete rejects the fallback and leaves target content intact", async () => {
  const context = await makeRealTarget();
  const holder = spawnMapHolder(context.target, "keep-handles-nodelete");
  const stderr = captureStderr();
  try {
    await holder.ready;
    const writeRetry = fsRetryModule.createWriteFileWithRetry({
      write: nodeWriteFile,
      sleep: async () => undefined,
      replace: fsRetryModule.atomicReplace
    });
    let thrown: unknown;
    try {
      await writeRetry(context.target, "NEW-CONTENT", "utf8");
    } catch (error) {
      thrown = error;
    }
    expect(errorCodeOf(thrown)).toBe("UNKNOWN");
    expect(await fsReadFile(context.target, "utf8")).toBe(context.oldContent);
    expect(await fsReaddir(context.docs)).toEqual(["target.xml"]);
    expect(await readDirectoryOrEmpty(join(context.root, "output", "locked-files"))).toEqual([]);
    expect(stderr.lines.some((line) => line.startsWith(`writeFile atomic fallback failed ${context.target}: `))).toBe(true);
  } finally {
    stderr.restore();
    await holder.stop();
    context.restoreProjectRoot();
    await fsRm(context.root, { recursive: true, force: true });
  }
}, 60000);

itOnWindows("R4 default writer archives the locked original using the default project output path", async () => {
  const context = await makeRealTarget();
  const holder = spawnMapHolder(context.target, "keep-handles");
  try {
    await holder.ready;
    await fsRetryModule.writeFileWithRetry(context.target, "NEW-CONTENT", "utf8");
    const lockedDirectory = join(context.root, "output", "locked-files");
    const archived = await fsReaddir(lockedDirectory);
    expect(await fsReadFile(context.target, "utf8")).toBe("NEW-CONTENT");
    expect(await fsReaddir(context.docs)).toEqual(["target.xml"]);
    expect(archived).toHaveLength(1);
    expect(archived[0]?.endsWith("-target.xml")).toBe(true);
    expect(await fsReadFile(join(lockedDirectory, archived[0] ?? ""), "utf8")).toBe(context.oldContent);
  } finally {
    await holder.stop();
    context.restoreProjectRoot();
    await fsRm(context.root, { recursive: true, force: true });
  }
}, 90000);
