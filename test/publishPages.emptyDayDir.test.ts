import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publishPagesAssets as publishPagesAssetsUnisolated, runPublishPagesCli } from "../src/publishPages";

const gitAvailable = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function makeGitRepo(): { root: string; origin: string } {
  const root = mkdtempSync(join(tmpdir(), "laundry-empty-day-source-"));
  const origin = mkdtempSync(join(tmpdir(), "laundry-empty-day-origin-"));
  temporaryRoots.push(root, origin);

  git(origin, ["init", "--bare"]);
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["branch", "-M", "main"]);
  git(root, ["remote", "add", "origin", origin]);
  writeFileSync(join(root, "README.md"), "initial\n");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-m", "Initial"]);
  git(root, ["push", "-u", "origin", "main"]);
  return { root, origin };
}

function writeMinimalSite(root: string, date: string): void {
  mkdirSync(join(root, "docs", "assets", date), { recursive: true });
  mkdirSync(join(root, "docs", "content-calendar"), { recursive: true });
  writeFileSync(join(root, "docs", "index.html"), "<!doctype html><title>ok</title>\n");
  writeFileSync(join(root, "docs", "content-calendar", `${date}.json`), '{"slots":[]}\n');
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, "docs", "sitemap.xml"),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.com/</loc><lastmod>2026-01-01</lastmod></url>\n</urlset>\n'
  );
}

function publishPagesAssets(date: string, root: string, rootPagesRepo = ""): string {
  return publishPagesAssetsUnisolated(date, root, rootPagesRepo, new Date(), {
    env: { PUBLIC_SITE_BASE_URL: "https://example.com/" }
  });
}

function assertPublishedSourceRepo(root: string, origin: string, date: string): void {
  const head = git(root, ["rev-parse", "HEAD"]);
  const originHead = git(origin, ["rev-parse", "refs/heads/main"]);
  const tree = git(root, ["ls-tree", "-r", "HEAD", "--name-only"]);
  expect(head).not.toBe(git(root, ["rev-parse", "HEAD^"]));
  expect(originHead).toBe(head);
  expect(tree.split(/\r?\n/)).toContain(`docs/content-calendar/${date}.json`);
  expect(tree.split(/\r?\n/).some((path) => path.startsWith(`docs/assets/${date}/`))).toBe(false);
}

describe("publishPagesAssets with an empty daily asset directory", () => {
  const gitIt = gitAvailable ? it : it.skip;

  gitIt("T1: commits and pushes other public files when the daily asset directory is empty", () => {
    const { root, origin } = makeGitRepo();
    const date = "2026-11-16";
    writeMinimalSite(root, date);

    const result = publishPagesAssets(date, root);

    expect(result.startsWith(`Published GitHub Pages assets for ${date}`)).toBe(true);
    assertPublishedSourceRepo(root, origin, date);
    expect(existsSync(join(root, "docs", "assets", date, ".gitkeep"))).toBe(false);
  }, 30000);

  gitIt("T2: mirrors other public files when the daily asset directory is empty", () => {
    const { root, origin } = makeGitRepo();
    const mirror = makeGitRepo();
    const date = "2026-11-16";
    writeMinimalSite(root, date);

    expect(() => publishPagesAssets(date, root, mirror.origin)).not.toThrow();

    assertPublishedSourceRepo(root, origin, date);
    const mirrorTree = git(mirror.origin, ["ls-tree", "-r", "main", "--name-only"]).split(/\r?\n/);
    expect(mirrorTree).toContain(`content-calendar/${date}.json`);
    expect(mirrorTree.some((path) => path.startsWith(`assets/${date}/`))).toBe(false);
  }, 60000);

  gitIt("T3: commits and pushes when the daily asset directory contains only an empty subdirectory", () => {
    const { root, origin } = makeGitRepo();
    const date = "2026-11-16";
    writeMinimalSite(root, date);
    mkdirSync(join(root, "docs", "assets", date, "empty-child"));

    const result = publishPagesAssets(date, root);

    expect(result.startsWith(`Published GitHub Pages assets for ${date}`)).toBe(true);
    assertPublishedSourceRepo(root, origin, date);
  }, 30000);

  gitIt("T4: keeps the pathspec when a tracked daily image was deleted", () => {
    const { root, origin } = makeGitRepo();
    const date = "2026-11-16";
    writeMinimalSite(root, date);
    const image = join(root, "docs", "assets", date, "slot-01.png");
    writeFileSync(image, "tracked image\n");
    git(root, ["add", "docs"]);
    git(root, ["commit", "-m", "Add tracked daily image"]);
    git(root, ["push", "origin", "main"]);
    const priorHead = git(root, ["rev-parse", "HEAD"]);
    unlinkSync(image);

    const result = publishPagesAssets(date, root);

    const tree = git(root, ["ls-tree", "-r", "HEAD", "--name-only"]);
    const head = git(root, ["rev-parse", "HEAD"]);
    expect(result.startsWith(`Published GitHub Pages assets for ${date}`)).toBe(true);
    expect(head).not.toBe(priorHead);
    expect(tree).not.toContain(`docs/assets/${date}/slot-01.png`);
    expect(git(origin, ["rev-parse", "refs/heads/main"])).toBe(head);
  }, 30000);

  gitIt("T5: CLI publish succeeds for an empty daily asset directory", async () => {
    const { root, origin } = makeGitRepo();
    const date = "2026-11-16";
    writeMinimalSite(root, date);
    const priorRootPagesRepo = process.env.PUBLIC_ROOT_PAGES_REPO;
    process.env.PUBLIC_ROOT_PAGES_REPO = "";
    try {
      await expect(
        runPublishPagesCli(["--skip-audit", "--skip-indexnow", "--root", root, "--date", date])
      ).resolves.toBeUndefined();
    } finally {
      if (priorRootPagesRepo === undefined) delete process.env.PUBLIC_ROOT_PAGES_REPO;
      else process.env.PUBLIC_ROOT_PAGES_REPO = priorRootPagesRepo;
    }

    assertPublishedSourceRepo(root, origin, date);
    expect(readFileSync(join(root, "docs", "content-calendar", `${date}.json`), "utf8")).toBe('{"slots":[]}\n');
  }, 30000);
});
