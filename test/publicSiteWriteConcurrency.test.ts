import { existsSync, mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_NOW, writePublicSiteFixture } from "./helpers/publicSiteWriteFixture";

const io = vi.hoisted(() => ({ enabled: false, active: 0, max: 0, categories: new Set<string>(), requireCalendarDirectoryBeforeDispatch: false }));
vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const tracked = (kind: "writeFile" | "copyFile") => async (...args: unknown[]) => {
    if (!io.enabled) return (actual[kind] as Function)(...args);
    io.active += 1;
    io.max = Math.max(io.max, io.active);
    const path = String(kind === "copyFile" ? args[1] : args[0]).replaceAll("\\", "/");
    for (const category of ["/posts/", "/services/", "/guides/", "/content-calendar/", "/fixture/"]) {
      if (path.includes(category)) io.categories.add(category);
    }
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      return await (actual[kind] as Function)(...args);
    } finally {
      io.active -= 1;
    }
  };
  return {
    ...actual, writeFile: tracked("writeFile"), copyFile: tracked("copyFile"),
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const target = String(args[0]).replaceAll("\\", "/");
      const marker = target.indexOf("/data/content-calendar/");
      if (io.requireCalendarDirectoryBeforeDispatch && marker >= 0) {
        // Observe the dispatch boundary directly, without depending on worker
        // timing to reproduce Windows' concurrent directory-creation EPERM.
        const output = join(target.slice(0, marker), "docs", "content-calendar");
        if (!existsSync(output)) throw new Error("Calendar dispatched before its shared output directory was ready");
      }
      return actual.readFile(...args);
    }
  };
});
import { generatePublicSite } from "../src/generatePublicSite";

const roots: string[] = [];
afterEach(async () => {
  io.enabled = false;
  io.requireCalendarDirectoryBeforeDispatch = false;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.unstubAllEnvs();
});

describe("public site write concurrency", () => {
  it("creates the shared calendar directory before dispatching its atomic writers", async () => {
    const root = mkdtempSync(join(tmpdir(), "site-write-mkdir-"));
    roots.push(root);
    await writePublicSiteFixture(root);
    io.requireCalendarDirectoryBeforeDispatch = true;
    await generatePublicSite({ root, writeConcurrency: 3, now: FIXTURE_NOW, baseUrl: "https://example.invalid", statPublicAsset: () => ({ isFile: () => true }) });
    const posts = JSON.parse(await readFile(join(root, "docs", "social-posts.json"), "utf8")) as { posts: unknown[] };
    expect(posts.posts).toHaveLength(24);
  });

  it.each([
    { name: "default", cap: 8, options: {} },
    { name: "option", cap: 3, options: { writeConcurrency: 3 } },
    { name: "serial", cap: 1, options: { writeConcurrency: 1 } },
    { name: "environment", cap: 2, options: {}, env: "2" }
  ])("bounds real calendar, article, service, support and copy writes ($name)", async ({ cap, options, env }) => {
    const root = mkdtempSync(join(tmpdir(), "site-write-limit-"));
    roots.push(root);
    await writePublicSiteFixture(root);
    vi.stubEnv("PUBLIC_SITE_WRITE_CONCURRENCY", env ?? "");
    io.active = 0; io.max = 0; io.categories.clear(); io.enabled = true;
    await generatePublicSite({ root, now: FIXTURE_NOW, baseUrl: "https://example.invalid", statPublicAsset: () => ({ isFile: () => true }), ...options });
    expect(io.active).toBe(0);
    expect(io.max).toBeLessThanOrEqual(cap);
    expect(io.max).toBeGreaterThan(0);
    expect([...io.categories].sort()).toEqual(["/content-calendar/", "/fixture/", "/guides/", "/posts/", "/services/"]);
  }, 30000);

  it.each(["0", "-1", "1.5", "invalid", "Infinity"])("rejects invalid environment limit %s before creating output", async (limit) => {
    const root = mkdtempSync(join(tmpdir(), "site-write-invalid-"));
    roots.push(root);
    vi.stubEnv("PUBLIC_SITE_WRITE_CONCURRENCY", limit);
    await expect(generatePublicSite({ root })).rejects.toThrow(/write concurrency/i);
  });
});
