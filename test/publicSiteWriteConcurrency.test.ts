import { existsSync, mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_NOW, runPublicSiteCli, writePublicSiteFixture } from "./helpers/publicSiteWriteFixture";

const io = vi.hoisted(() => ({
  enabled: false, active: 0, max: 0, events: [] as string[], categories: new Set<string>(),
  inflight: new Set<Promise<unknown>>(), requireCalendarDirectoryBeforeDispatch: false,
  beforeCalendarWrite: undefined as ((path: string) => Promise<void>) | undefined,
  afterUnlink: undefined as ((path: string) => void) | undefined
}));
vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  function monitor<T>(promise: Promise<T>): Promise<T> {
    io.inflight.add(promise);
    promise.then(() => io.inflight.delete(promise), () => io.inflight.delete(promise));
    return promise;
  }
  const trackedWrite = (kind: "writeFile" | "copyFile") => (...args: unknown[]) => monitor((async () => {
    if (!io.enabled) return (actual[kind] as Function)(...args);
    io.events.push(kind);
    io.active += 1; io.max = Math.max(io.max, io.active);
    const path = String(args[kind === "copyFile" ? 1 : 0]).replaceAll("\\", "/");
    for (const category of ["/posts/", "/services/", "/guides/", "/content-calendar/", "/fixture/"]) {
      if (path.includes(category)) io.categories.add(category);
    }
    try {
      if (path.includes("/docs/content-calendar/")) await io.beforeCalendarWrite?.(path);
      await new Promise<void>((done) => setImmediate(done));
      return await (actual[kind] as Function)(...args);
    } finally { io.active -= 1; }
  })());
  const mutation = (kind: "mkdir" | "rename" | "unlink") => (...args: unknown[]) => monitor((async () => {
    if (io.enabled) io.events.push(kind);
    try { return await (actual[kind] as Function)(...args); }
    finally { if (kind === "unlink") io.afterUnlink?.(String(args[0]).replaceAll("\\", "/")); }
  })());
  return {
    ...actual, writeFile: trackedWrite("writeFile"), copyFile: trackedWrite("copyFile"),
    mkdir: mutation("mkdir"), rename: mutation("rename"), unlink: mutation("unlink"),
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const target = String(args[0]).replaceAll("\\", "/");
      const marker = target.indexOf("/data/content-calendar/");
      if (io.requireCalendarDirectoryBeforeDispatch && marker >= 0 &&
          !existsSync(join(target.slice(0, marker), "docs", "content-calendar"))) {
        throw new Error("Calendar dispatched before its shared output directory was ready");
      }
      return actual.readFile(...args);
    }
  };
});
import { generatePublicSite } from "../src/generatePublicSite";

const roots: string[] = [];
function fixtureRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), name));
  roots.push(root);
  return root;
}
function enableIo(): void {
  io.events = []; io.categories.clear(); io.active = 0; io.max = 0; io.enabled = true;
}
afterEach(async () => {
  io.enabled = false; io.requireCalendarDirectoryBeforeDispatch = false;
  io.beforeCalendarWrite = undefined; io.afterUnlink = undefined;
  await new Promise<void>((done) => setImmediate(done));
  while (io.inflight.size) await Promise.allSettled([...io.inflight]);
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error("Refusing cleanup outside test temp root");
    await rm(root, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
});

describe("public site write concurrency", () => {
  it("creates the shared calendar directory before dispatching its atomic writers", async () => {
    const root = fixtureRoot("site-write-mkdir-");
    await writePublicSiteFixture(root);
    io.requireCalendarDirectoryBeforeDispatch = true;
    await generatePublicSite({ root, writeConcurrency: 3, now: FIXTURE_NOW, baseUrl: "https://example.invalid",
      statPublicAsset: () => ({ isFile: () => true }) });
    const posts = JSON.parse(await readFile(join(root, "docs", "social-posts.json"), "utf8")) as { posts: unknown[] };
    expect(posts.posts).toHaveLength(24);
  });

  it.each([
    { name: "default", cap: 8, options: {} },
    { name: "option", cap: 3, options: { writeConcurrency: 3 } },
    { name: "serial", cap: 1, options: { writeConcurrency: 1 } },
    { name: "environment", cap: 2, options: {}, env: "2" }
  ])("bounds actual calendar, article, service, support and verified copy writes ($name)", async ({ cap, options, env }) => {
    const root = fixtureRoot("site-write-limit-");
    await writePublicSiteFixture(root);
    vi.stubEnv("PUBLIC_SITE_WRITE_CONCURRENCY", env ?? "");
    enableIo();
    await generatePublicSite({ root, now: FIXTURE_NOW, baseUrl: "https://example.invalid",
      statPublicAsset: () => ({ isFile: () => true }), ...options });
    expect(io.active).toBe(0);
    expect(io.max).toBeGreaterThan(0);
    expect(io.max).toBeLessThanOrEqual(cap);
    expect([...io.categories].sort()).toEqual(["/content-calendar/", "/fixture/", "/guides/", "/posts/", "/services/"]);
  }, 30000);

  it.each(["0", "-1", "1.5", "invalid", "Infinity"])("rejects environment limit %s with zero output mutations", async (limit) => {
    const root = fixtureRoot("site-write-invalid-");
    await writePublicSiteFixture(root, { approved: false });
    vi.stubEnv("PUBLIC_SITE_WRITE_CONCURRENCY", limit);
    enableIo();
    await expect(generatePublicSite({ root })).rejects.toThrow(/write concurrency/i);
    expect(io.events).toEqual([]);
    expect(existsSync(join(root, "docs"))).toBe(false);
  });

  it("stops calendar dispatch and drains the other atomic write before rejecting with the original error", async () => {
    const root = fixtureRoot("site-write-failure-");
    await writePublicSiteFixture(root);
    vi.stubEnv("PUBLIC_SITE_WRITE_CONCURRENCY", "");
    const failure = new Error("synthetic calendar failure");
    let bothStarted!: () => void, releaseOther!: () => void, failureCleaned!: () => void;
    const both = new Promise<void>((done) => { bothStarted = done; });
    const other = new Promise<void>((done) => { releaseOther = done; });
    const cleaned = new Promise<void>((done) => { failureCleaned = done; });
    const started: string[] = [];
    let failedPath = "", settled = false;
    io.beforeCalendarWrite = async (path) => {
      const index = started.push(path) - 1;
      if (started.length === 2) bothStarted();
      if (index === 0) { failedPath = path; await both; throw failure; }
      if (index === 1) await other;
    };
    io.afterUnlink = (path) => { if (path === failedPath) failureCleaned(); };
    enableIo();
    const pending = generatePublicSite({ root, writeConcurrency: 2, now: FIXTURE_NOW,
      baseUrl: "https://example.invalid", statPublicAsset: () => ({ isFile: () => true }) })
      .then(() => { settled = true; return undefined; }, (error: unknown) => { settled = true; return error; });
    try {
      await both; await cleaned;
      await new Promise<void>((done) => setImmediate(done));
      expect(started).toHaveLength(2);
      expect(settled).toBe(false);
    } finally { releaseOther(); await pending; }
    expect(await pending).toBe(failure);
    expect(io.active).toBe(0);
    expect(started).toHaveLength(2);
  });

  it("direct CLI honors --write-concurrency over an invalid environment value", async () => {
    const root = fixtureRoot("site-write-cli-valid-");
    await writePublicSiteFixture(root, { approved: false });
    const result = await runPublicSiteCli(root, ["--write-concurrency", "1"], "invalid");
    console.info("PUBLIC_SITE_CLI_RECEIPT " + JSON.stringify(result));
    const detail = JSON.stringify(result);
    expect(result.status, detail).toBe(0);
    expect(result.metrics?.writes, detail).toBeGreaterThan(0);
    expect(result.metrics?.max, detail).toBe(1);
    expect(result.metrics?.active, detail).toBe(0);
    expect(existsSync(join(root, "docs", "social-posts.json")), detail).toBe(true);
  }, 30000);

  it.each([
    { name: "zero", args: ["--write-concurrency", "0"] },
    { name: "missing value", args: ["--write-concurrency"] }
  ])("direct CLI rejects $name before any output mutation", async ({ args }) => {
    const root = fixtureRoot("site-write-cli-invalid-");
    await writePublicSiteFixture(root, { approved: false });
    const result = await runPublicSiteCli(root, args, "");
    console.info("PUBLIC_SITE_CLI_RECEIPT " + JSON.stringify(result));
    const detail = JSON.stringify(result);
    expect(result.status, detail).not.toBe(0);
    expect(result.stderr, detail).toMatch(/write concurrency/i);
    expect(result.metrics?.mutations, detail).toBe(0);
    expect(existsSync(join(root, "docs")), detail).toBe(false);
  }, 30000);
});
