import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  assertMirroredReferencedAssets,
  collectReferencedPublicAssetPaths,
  MAX_REFERENCED_PUBLIC_ASSETS,
  publishPagesAssets,
  runPublishPagesCli
} from "../src/publishPages";

const gitAvailable = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function makeGitRepo(): { root: string; origin: string } {
  const root = mkdtempSync(join(tmpdir(), "laundry-social-publish-"));
  const origin = mkdtempSync(join(tmpdir(), "laundry-social-origin-"));

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

function writeSitemap(root: string, lastmod: string): void {
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, "docs", "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.com/</loc><lastmod>${lastmod}</lastmod></url>\n</urlset>\n`
  );
}

function sha256Bytes(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function gitShow(root: string, spec: string): Buffer {
  return execFileSync("git", ["show", spec], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

function writeMinimalPublishDocs(root: string, date: string): void {
  mkdirSync(join(root, "docs", "assets", date), { recursive: true });
  mkdirSync(join(root, "docs", "content-calendar"), { recursive: true });
  writeFileSync(join(root, "docs", "index.html"), "<!doctype html><title>ok</title>\n");
  writeFileSync(join(root, "docs", "content-calendar", `${date}.json`), `{"slots":[]}\n`);
  writeFileSync(join(root, "docs", "assets", date, "slot-01.png"), "fake image");
  writeSitemap(root, "2026-01-01");
}

function cloneSourceRepo(origin: string): string {
  const root = join(mkdtempSync(join(tmpdir(), "laundry-social-clone-")), "src");
  execFileSync("git", ["clone", "--branch", "main", origin, root], { stdio: ["ignore", "pipe", "pipe"] });
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  return root;
}

const ESCAPED_ASSET_SEPARATOR_REFS = [
  String.raw`assets\2020-01-01\slot-01.webp`,
  String.raw`assets\/2020-01-01\/slot-01.webp`,
  "assets%2F2020-01-01%2Fslot-01.webp"
] as const;

function escapedSeparatorError(ref: string): RegExp {
  return new RegExp(`escaped or encoded assets path separators: ${ref.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}`);
}

async function runSkipAuditPublishCli(root: string, date: string, rootPagesRepo: string): Promise<void> {
  const previous = process.env.PUBLIC_ROOT_PAGES_REPO;
  process.env.PUBLIC_ROOT_PAGES_REPO = rootPagesRepo;
  try {
    await runPublishPagesCli(["--skip-audit", "--skip-indexnow", "--root", root, "--date", date]);
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_ROOT_PAGES_REPO;
    else process.env.PUBLIC_ROOT_PAGES_REPO = previous;
  }
}

function expectUnchangedPublishHeads(
  root: string,
  sourceOrigin: string,
  rootPagesOrigin: string,
  sourceHead: string,
  sourceOriginHead: string,
  rootPagesHead: string,
  remoteSitemap?: Buffer
): void {
  expect(git(root, ["rev-parse", "HEAD"])).toBe(sourceHead);
  expect(git(sourceOrigin, ["rev-parse", "refs/heads/main"])).toBe(sourceOriginHead);
  expect(git(rootPagesOrigin, ["rev-parse", "refs/heads/main"])).toBe(rootPagesHead);
  if (remoteSitemap) {
    expect(gitShow(rootPagesOrigin, "main:sitemap.xml").equals(remoteSitemap)).toBe(true);
  }
}

describe("publishPagesAssets", () => {
  const gitIt = gitAvailable ? it : it.skip;

  // 60s budget: this drives real git including the root-Pages mirror clone,
  // which took 24.5s against vitest's 15s default on a cold-disk CI runner
  // (2026-08-25) while passing everywhere else.
  gitIt("does not commit .env when publishing Pages assets", () => {
    const { root } = makeGitRepo();
    const date = "2026-05-15";
    const priorDate = "2026-05-14";

    mkdirSync(join(root, "docs", "assets", date), { recursive: true });
    mkdirSync(join(root, "docs", "assets", "backgrounds"), { recursive: true });
    mkdirSync(join(root, "docs", "content-calendar"), { recursive: true });
    mkdirSync(join(root, "docs", "docs"), { recursive: true });
    mkdirSync(join(root, "docs", "guides"), { recursive: true });
    mkdirSync(join(root, "docs", "local"), { recursive: true });
    writeFileSync(join(root, "docs", "index.html"), "<!doctype html><title>ok</title>\n");
    writeFileSync(join(root, "docs", "404.html"), "<!doctype html><title>redirect</title>\n");
    writeFileSync(join(root, "docs", "docs", "index.html"), "<!doctype html><title>compat</title>\n");
    writeFileSync(join(root, "docs", "guides", "photo-before-laundry.html"), "<!doctype html><title>guide</title>\n");
    writeFileSync(join(root, "docs", "local", "qinghai-road-shoe-cleaning.html"), "<!doctype html><title>local</title>\n");
    writeFileSync(join(root, "docs", "social-posts.json"), '{"posts":[]}\n');
    writeFileSync(join(root, "docs", "content-calendar", `${priorDate}.json`), '{"slots":["prior"]}\n');
    writeFileSync(join(root, "docs", "content-calendar", `${date}.json`), '{"slots":[]}\n');
    writeFileSync(join(root, "docs", "assets", date, "slot-01.png"), "fake image");
    writeFileSync(join(root, "docs", "assets", "backgrounds", "premium-laundry-depth.png"), "fake background");
    writeSitemap(root, "2026-01-01");
    writeFileSync(join(root, ".env"), "META_ACCESS_TOKEN=EAA-this-should-not-commit\n");

    const result = publishPagesAssets(date, root);
    const tree = git(root, ["ls-tree", "-r", "HEAD", "--name-only"]);

    expect(result).toContain("Published GitHub Pages assets");
    expect(tree).toContain(`docs/content-calendar/${priorDate}.json`);
    expect(tree).toContain(`docs/content-calendar/${date}.json`);
    expect(tree).toContain(`docs/assets/${date}/slot-01.png`);
    expect(tree).toContain("docs/assets/backgrounds/premium-laundry-depth.png");
    expect(tree).toContain("docs/404.html");
    expect(tree).toContain("docs/docs/index.html");
    expect(tree).toContain("docs/guides/photo-before-laundry.html");
    expect(tree).toContain("docs/local/qinghai-road-shoe-cleaning.html");
    expect(tree).toContain("docs/social-posts.json");
    expect(tree).not.toContain(".env");
  }, 60000);

  gitIt("mirrors docs contents to a root Pages repository", () => {
    const { root } = makeGitRepo();
    const { origin: rootPagesOrigin } = makeGitRepo();
    const date = "2026-05-15";

    mkdirSync(join(root, "docs", "assets", date), { recursive: true });
    mkdirSync(join(root, "docs", "content-calendar"), { recursive: true });
    writeFileSync(join(root, "docs", "index.html"), "<!doctype html><title>root</title>\n");
    writeFileSync(join(root, "docs", ".nojekyll"), "");
    writeFileSync(join(root, "docs", "content-calendar", `${date}.json`), '{"slots":[]}\n');
    writeFileSync(join(root, "docs", "assets", date, "slot-01.png"), "fake image");
    writeSitemap(root, "2026-01-01");
    writeFileSync(join(root, ".env"), "META_ACCESS_TOKEN=EAA-this-should-not-commit\n");

    const result = publishPagesAssets(date, root, rootPagesOrigin);
    const mirrorTree = git(rootPagesOrigin, ["ls-tree", "-r", "main", "--name-only"]);

    expect(result).toContain("Mirrored public site to root Pages repo");
    expect(mirrorTree).toContain("index.html");
    expect(mirrorTree).toContain(`content-calendar/${date}.json`);
    expect(mirrorTree).toContain(`assets/${date}/slot-01.png`);
    expect(mirrorTree).not.toContain("docs/index.html");
    expect(mirrorTree).not.toContain(".env");
  }, 45000);

  gitIt("publishes approved post article pages alongside the rest of the SEO assets", () => {
    const { root } = makeGitRepo();
    const date = "2026-05-15";

    mkdirSync(join(root, "docs", "assets", date), { recursive: true });
    mkdirSync(join(root, "docs", "content-calendar"), { recursive: true });
    mkdirSync(join(root, "docs", "posts"), { recursive: true });
    writeFileSync(join(root, "docs", "index.html"), "<!doctype html><title>ok</title>\n");
    writeFileSync(join(root, "docs", "content-calendar", `${date}.json`), '{"slots":[]}\n');
    writeFileSync(join(root, "docs", "assets", date, "slot-01.png"), "fake image");
    writeFileSync(join(root, "docs", "posts", `${date}-slot-01.html`), "<!doctype html><title>post</title>\n");
    writeFileSync(join(root, "docs", "posts", `${date}-slot-02.html`), "<!doctype html><title>post-2</title>\n");
    writeSitemap(root, "2026-01-01");

    const result = publishPagesAssets(date, root);
    const tree = git(root, ["ls-tree", "-r", "HEAD", "--name-only"]);

    expect(result).toContain("Published GitHub Pages assets");
    expect(tree).toContain(`docs/posts/${date}-slot-01.html`);
    expect(tree).toContain(`docs/posts/${date}-slot-02.html`);
  }, 15000);

  gitIt("refuses to publish text files that look like they contain secrets", () => {
    const { root } = makeGitRepo();
    const date = "2026-05-15";

    mkdirSync(join(root, "docs", "assets", date), { recursive: true });
    mkdirSync(join(root, "docs", "content-calendar"), { recursive: true });
    writeFileSync(join(root, "docs", "index.html"), "<!doctype html><title>ok</title>\n");
    writeFileSync(join(root, "docs", "content-calendar", `${date}.json`), '{"META_ACCESS_TOKEN":"EAA-secret"}\n');
    writeFileSync(join(root, "docs", "assets", date, "slot-01.png"), "fake image");
    writeSitemap(root, "2026-01-01");

    expect(() => publishPagesAssets(date, root)).toThrow("possible secret");
  }, 15000);

  gitIt("catches a bare token pasted into content, with no variable name beside it", () => {
    // The named-key patterns never fire on the realistic leak: a raw token
    // that ended up inside a caption or feed. Only the bare-value regexes
    // catch that, and they had no positive case at all.
    const { root } = makeGitRepo();
    const date = "2026-05-15";

    mkdirSync(join(root, "docs", "assets", date), { recursive: true });
    mkdirSync(join(root, "docs", "content-calendar"), { recursive: true });
    writeFileSync(join(root, "docs", "index.html"), "<!doctype html><title>ok</title>\n");
    writeFileSync(join(root, "docs", "assets", date, "slot-01.png"), "fake image");
    writeFileSync(
      join(root, "docs", "content-calendar", `${date}.json`),
      `{"caption":"contact us EAA${"a1B2".repeat(8)} thanks"}\n`
    );
    writeSitemap(root, "2026-01-01");

    expect(() => publishPagesAssets(date, root)).toThrow("possible secret");
  }, 15000);

  gitIt("replaces mirror text directories without deleting root files or historical assets", () => {
    const { root } = makeGitRepo();
    const { root: seed, origin: rootPagesOrigin } = makeGitRepo();
    const date = "2026-05-15";
    const futureDate = "2026-05-16";
    mkdirSync(join(seed, "assets", "2020-01-01"), { recursive: true });
    mkdirSync(join(seed, ".github", "workflows"), { recursive: true });
    mkdirSync(join(seed, ".well-known"), { recursive: true });
    mkdirSync(join(seed, "content-calendar"), { recursive: true });
    mkdirSync(join(seed, "posts"), { recursive: true });
    writeFileSync(join(seed, "assets", "2020-01-01", "huge.bin"), "keep-me");
    writeFileSync(join(seed, ".github", "workflows", "pages.yml"), "name: pages\n");
    writeFileSync(join(seed, ".well-known", "keep.json"), '{"keep":true}\n');
    writeFileSync(join(seed, ".well-known", "ai.json"), '{"version":"old"}\n');
    writeFileSync(join(seed, "content-calendar", `${futureDate}.json`), '{"slots":["future"]}\n');
    writeFileSync(join(seed, "posts", `${futureDate}-slot-01.html`), "future post\n");
    writeFileSync(join(seed, "index.html"), "old-home\n");
    writeFileSync(join(seed, "keep-root.txt"), "keep-root\n");
    git(seed, ["add", "-A"]);
    git(seed, ["commit", "-m", "seed historical asset"]);
    git(seed, ["push", "origin", "main"]);

    mkdirSync(join(root, "docs", "assets", date), { recursive: true });
    mkdirSync(join(root, "docs", ".well-known"), { recursive: true });
    mkdirSync(join(root, "docs", "content-calendar"), { recursive: true });
    mkdirSync(join(root, "docs", "posts"), { recursive: true });
    mkdirSync(join(root, "data", "content-calendar"), { recursive: true });
    writeFileSync(join(root, "docs", "index.html"), "<!doctype html><title>new</title>\n");
    writeFileSync(join(root, "docs", ".nojekyll"), "");
    writeFileSync(join(root, "docs", "unlisted-root.txt"), "must not mirror\n");
    writeFileSync(join(root, "docs", ".well-known", "ai.json"), '{"version":"new"}\n');
    writeFileSync(join(root, "docs", ".well-known", "unlisted.txt"), "must not mirror\n");
    writeFileSync(join(root, "docs", "content-calendar", `${date}.json`), '{"slots":[]}\n');
    writeFileSync(join(root, "docs", "posts", `${date}-slot-01.html`), "today post\n");
    writeFileSync(join(root, "docs", "assets", date, "slot-01.png"), "fake image");
    writeSitemap(root, "2026-01-01");
    writeFileSync(join(root, "data", "content-calendar", `${futureDate}.json`), '{"slots":["private-future"]}\n');

    const result = publishPagesAssets(date, root, rootPagesOrigin);
    const mirrorTree = git(rootPagesOrigin, ["ls-tree", "-r", "main", "--name-only"]);

    expect(result).toContain("Mirrored public site");
    expect(mirrorTree).toContain(`content-calendar/${date}.json`);
    expect(mirrorTree).toContain(`posts/${date}-slot-01.html`);
    expect(mirrorTree).not.toContain(`content-calendar/${futureDate}.json`);
    expect(mirrorTree).not.toContain(`posts/${futureDate}-slot-01.html`);
    expect(mirrorTree).not.toContain("unlisted-root.txt");
    expect(mirrorTree).not.toContain(".well-known/unlisted.txt");
    expect(mirrorTree).toContain("keep-root.txt");
    expect(mirrorTree).toContain(".github/workflows/pages.yml");
    expect(mirrorTree).toContain(".well-known/keep.json");
    expect(mirrorTree).toContain(".well-known/ai.json");
    expect(mirrorTree).toContain("assets/2020-01-01/huge.bin");
    expect(mirrorTree).toContain(`assets/${date}/slot-01.png`);
    expect(git(rootPagesOrigin, ["show", "main:assets/2020-01-01/huge.bin"])).toBe("keep-me");
    expect(git(rootPagesOrigin, ["show", "main:index.html"])).toContain("new");
    expect(git(rootPagesOrigin, ["show", "main:.well-known/keep.json"])).toContain('"keep":true');
    expect(git(rootPagesOrigin, ["show", "main:.well-known/ai.json"])).toContain('"version":"new"');
    expect(existsSync(join(root, "data", "content-calendar", `${futureDate}.json`))).toBe(true);
    expect(readFileSync(join(root, "data", "content-calendar", `${futureDate}.json`), "utf8")).toContain("private-future");
  }, 45000);

  gitIt("scans xml and jsonl publish targets too", () => {
    // sitemap.xml and llms.jsonl are in the publish list but were not in the
    // text-file extension list, so they shipped unscanned.
    const { root } = makeGitRepo();
    const date = "2026-05-15";

    mkdirSync(join(root, "docs", "assets", date), { recursive: true });
    mkdirSync(join(root, "docs", "content-calendar"), { recursive: true });
    writeFileSync(join(root, "docs", "index.html"), "<!doctype html><title>ok</title>\n");
    writeFileSync(join(root, "docs", "content-calendar", `${date}.json`), '{"slots":[]}\n');
    writeFileSync(join(root, "docs", "assets", date, "slot-01.png"), "fake image");
    writeFileSync(join(root, "docs", "sitemap.xml"), `<urlset>sk-${"x".repeat(24)}</urlset>\n`);

    expect(() => publishPagesAssets(date, root)).toThrow("possible secret");
  }, 15000);

  gitIt("fails closed on a future sitemap lastmod before any commit, push, or root mirror", () => {
    const { root, origin: sourceOrigin } = makeGitRepo();
    const { root: seed, origin: rootPagesOrigin } = makeGitRepo();
    const date = "2026-05-15";
    const now = new Date("2026-08-29T16:30:00.000Z"); // Taipei 2026-08-30
    writeFileSync(join(seed, "sitemap.xml"), "<urlset><url><loc>/</loc><lastmod>2026-08-30</lastmod></url></urlset>\n");
    git(seed, ["add", "sitemap.xml"]);
    git(seed, ["commit", "-m", "seed sitemap"]);
    git(seed, ["push", "origin", "main"]);

    writeMinimalPublishDocs(root, date);
    writeSitemap(root, "2026-08-31");
    const sourceHead = git(root, ["rev-parse", "HEAD"]);
    const sourceOriginHead = git(sourceOrigin, ["rev-parse", "refs/heads/main"]);
    const rootPagesHead = git(rootPagesOrigin, ["rev-parse", "refs/heads/main"]);
    const remoteSitemap = gitShow(rootPagesOrigin, "main:sitemap.xml");

    expect(() => publishPagesAssets(date, root, rootPagesOrigin, now)).toThrow(/2026-08-31/);
    expectUnchangedPublishHeads(
      root,
      sourceOrigin,
      rootPagesOrigin,
      sourceHead,
      sourceOriginHead,
      rootPagesHead,
      remoteSitemap
    );

    writeSitemap(root, "2026-08-30");
    const result = publishPagesAssets(date, root, rootPagesOrigin, now);
    expect(result).toContain("Published GitHub Pages assets");
    expect(git(root, ["rev-parse", "HEAD"])).not.toBe(sourceHead);
    expect(git(sourceOrigin, ["rev-parse", "refs/heads/main"])).not.toBe(sourceOriginHead);
    expect(git(rootPagesOrigin, ["rev-parse", "refs/heads/main"])).not.toBe(rootPagesHead);
    expect(git(rootPagesOrigin, ["show", "main:sitemap.xml"])).toContain("2026-08-30");
    expect(git(rootPagesOrigin, ["show", "main:sitemap.xml"])).not.toContain("2026-08-31");
  }, 60000);

  gitIt("uses Asia/Taipei today for lastmod: UTC yesterday/Taipei today passes, Taipei tomorrow fails", () => {
    const { root, origin: sourceOrigin } = makeGitRepo();
    const { origin: rootPagesOrigin } = makeGitRepo();
    const date = "2026-05-15";
    const now = new Date("2026-08-29T16:30:00.000Z"); // Taipei 2026-08-30
    const previousTimezone = process.env.TIMEZONE;
    process.env.TIMEZONE = "UTC";
    try {
      writeMinimalPublishDocs(root, date);
      writeSitemap(root, "2026-08-30");
      const passed = publishPagesAssets(date, root, rootPagesOrigin, now);
      expect(passed).toContain("Published GitHub Pages assets");
      const sourceHead = git(root, ["rev-parse", "HEAD"]);
      const sourceOriginHead = git(sourceOrigin, ["rev-parse", "refs/heads/main"]);
      const rootPagesHead = git(rootPagesOrigin, ["rev-parse", "refs/heads/main"]);

      writeSitemap(root, "2026-08-31");
      expect(() => publishPagesAssets(date, root, rootPagesOrigin, now)).toThrow(/after 2026-08-30 \(Asia\/Taipei\)/);
      expect(git(root, ["rev-parse", "HEAD"])).toBe(sourceHead);
      expect(git(sourceOrigin, ["rev-parse", "refs/heads/main"])).toBe(sourceOriginHead);
      expect(git(rootPagesOrigin, ["rev-parse", "refs/heads/main"])).toBe(rootPagesHead);
    } finally {
      if (previousTimezone === undefined) delete process.env.TIMEZONE;
      else process.env.TIMEZONE = previousTimezone;
    }
  }, 60000);

  it("fails verification when a referenced historical webp is omitted from the mirror manifest", () => {
    const docsRoot = mkdtempSync(join(tmpdir(), "laundry-webp-docs-"));
    const mirrorRoot = mkdtempSync(join(tmpdir(), "laundry-webp-mirror-"));
    const oldDate = "2020-01-01";
    mkdirSync(join(docsRoot, "assets", oldDate), { recursive: true });
    mkdirSync(join(mirrorRoot, "assets", oldDate), { recursive: true });
    writeFileSync(
      join(docsRoot, "index.html"),
      `<picture><source type="image/webp" srcset="https://example.com/assets/${oldDate}/slot-01.webp" /></picture>\n`
    );
    writeFileSync(join(docsRoot, "assets", oldDate, "slot-01.webp"), "new-webp-bytes\n");
    writeFileSync(join(mirrorRoot, "index.html"), readFileSync(join(docsRoot, "index.html")));

    const referenced = collectReferencedPublicAssetPaths(docsRoot, ["index.html"]);
    expect(referenced).toContain(`assets/${oldDate}/slot-01.webp`);
    expect(() => assertMirroredReferencedAssets(docsRoot, mirrorRoot, referenced, ["index.html"])).toThrow(/missing/);

    const mutated = referenced.filter((path) => path !== `assets/${oldDate}/slot-01.webp`);
    expect(mutated).not.toContain(`assets/${oldDate}/slot-01.webp`);
    // Mutated list is the actual verification input; collector scan paths still rediscover the webp.
    expect(() => assertMirroredReferencedAssets(docsRoot, mirrorRoot, mutated, ["index.html"])).toThrow(/missing/);
  });

  gitIt("mirrors referenced historical webp bytes and leaves unrelated root history alone", () => {
    const { root } = makeGitRepo();
    const { root: seed, origin: rootPagesOrigin } = makeGitRepo();
    const date = "2026-05-15";
    const oldDate = "2020-01-01";
    const missingDate = "2019-12-31";
    const futureDate = "2026-05-16";
    mkdirSync(join(seed, "assets", oldDate), { recursive: true });
    mkdirSync(join(seed, ".github", "workflows"), { recursive: true });
    mkdirSync(join(seed, "posts"), { recursive: true });
    writeFileSync(join(seed, "assets", oldDate, "slot-01.webp"), "old-webp-bytes\n");
    writeFileSync(join(seed, "assets", oldDate, "unrelated.bin"), "keep-unrelated\n");
    writeFileSync(join(seed, ".github", "workflows", "pages.yml"), "name: pages\n");
    writeFileSync(join(seed, "keep-root.txt"), "keep-root\n");
    writeFileSync(join(seed, "CNAME"), "old.example\n");
    writeFileSync(join(seed, "posts", `${futureDate}-slot-01.html`), "future post\n");
    git(seed, ["add", "-A"]);
    git(seed, ["commit", "-m", "seed historical webp"]);
    git(seed, ["push", "origin", "main"]);

    mkdirSync(join(root, "docs", "assets", date), { recursive: true });
    mkdirSync(join(root, "docs", "assets", oldDate), { recursive: true });
    mkdirSync(join(root, "docs", "assets", missingDate), { recursive: true });
    mkdirSync(join(root, "docs", "posts"), { recursive: true });
    mkdirSync(join(root, "docs", "content-calendar"), { recursive: true });
    mkdirSync(join(root, "data", "content-calendar"), { recursive: true });
    const updatedWebp = "new-webp-bytes-updated\n";
    const addedWebp = "added-webp-bytes\n";
    writeFileSync(join(root, "docs", "assets", oldDate, "slot-01.webp"), updatedWebp);
    writeFileSync(join(root, "docs", "assets", missingDate, "slot-01.webp"), addedWebp);
    writeFileSync(join(root, "docs", "assets", date, "slot-01.png"), "fake image");
    writeFileSync(
      join(root, "docs", "index.html"),
      `<!doctype html><picture><source srcset="https://example.com/assets/${oldDate}/slot-01.webp" /><source srcset="/assets/${missingDate}/slot-01.webp" /></picture>\n`
    );
    writeFileSync(join(root, "docs", "posts", `${date}-slot-01.html`), "today post\n");
    writeFileSync(join(root, "docs", "content-calendar", `${date}.json`), '{"slots":[]}\n');
    writeSitemap(root, "2026-01-01");
    writeFileSync(join(root, "docs", "CNAME"), "new.example\n");
    writeFileSync(join(root, "data", "content-calendar", `${futureDate}.json`), '{"slots":["private-future"]}\n');

    const result = publishPagesAssets(date, root, rootPagesOrigin);
    const mirrorTree = git(rootPagesOrigin, ["ls-tree", "-r", "main", "--name-only"]);

    expect(result).toContain("Mirrored public site");
    expect(sha256Bytes(gitShow(rootPagesOrigin, `main:assets/${oldDate}/slot-01.webp`))).toBe(sha256Bytes(updatedWebp));
    expect(sha256Bytes(gitShow(rootPagesOrigin, `main:assets/${missingDate}/slot-01.webp`))).toBe(sha256Bytes(addedWebp));
    expect(git(rootPagesOrigin, ["show", `main:assets/${oldDate}/unrelated.bin`])).toBe("keep-unrelated");
    expect(git(rootPagesOrigin, ["show", "main:keep-root.txt"])).toBe("keep-root");
    expect(git(rootPagesOrigin, ["show", "main:.github/workflows/pages.yml"])).toBe("name: pages");
    expect(git(rootPagesOrigin, ["show", "main:CNAME"])).toBe("new.example");
    expect(mirrorTree).not.toContain(`posts/${futureDate}-slot-01.html`);
    expect(existsSync(join(root, "data", "content-calendar", `${futureDate}.json`))).toBe(true);
    expect(readFileSync(join(root, "data", "content-calendar", `${futureDate}.json`), "utf8")).toContain("private-future");
  }, 60000);

  gitIt("removes only a remote CNAME tombstone when the source file is gone", () => {
    const { root, origin: sourceOrigin } = makeGitRepo();
    const { root: seed, origin: rootPagesOrigin } = makeGitRepo();
    const date = "2026-05-15";
    mkdirSync(join(seed, "assets", "2020-01-01"), { recursive: true });
    mkdirSync(join(seed, ".github", "workflows"), { recursive: true });
    writeFileSync(join(seed, "CNAME"), "gone.example\n");
    writeFileSync(join(seed, "keep-root.txt"), "keep-root\n");
    writeFileSync(join(seed, ".github", "workflows", "pages.yml"), "name: pages\n");
    writeFileSync(join(seed, "assets", "2020-01-01", "huge.bin"), "keep-me");
    git(seed, ["add", "-A"]);
    git(seed, ["commit", "-m", "seed cname"]);
    git(seed, ["push", "origin", "main"]);

    writeMinimalPublishDocs(root, date);
    writeFileSync(join(root, "docs", "CNAME"), "gone.example\n");
    git(root, ["add", "--", "docs/CNAME"]);
    git(root, ["commit", "-m", "track source cname"]);
    git(root, ["push"]);
    unlinkSync(join(root, "docs", "CNAME"));

    const result = publishPagesAssets(date, root, rootPagesOrigin);
    const sourceOriginTree = git(sourceOrigin, ["ls-tree", "-r", "main", "--name-only"]).split(/\r?\n/);
    const mirrorTree = git(rootPagesOrigin, ["ls-tree", "-r", "main", "--name-only"]).split(/\r?\n/);

    expect(result).toContain("Mirrored public site");
    expect(sourceOriginTree).not.toContain("docs/CNAME");
    expect(sourceOriginTree).toContain("docs/sitemap.xml");
    expect(mirrorTree).not.toContain("CNAME");
    expect(mirrorTree).toContain("keep-root.txt");
    expect(mirrorTree).toContain(".github/workflows/pages.yml");
    expect(mirrorTree).toContain("assets/2020-01-01/huge.bin");
    expect(git(rootPagesOrigin, ["show", "main:keep-root.txt"])).toBe("keep-root");
    expect(git(rootPagesOrigin, ["show", "main:assets/2020-01-01/huge.bin"])).toBe("keep-me");

    const cloneRoot = cloneSourceRepo(sourceOrigin);
    expect(existsSync(join(cloneRoot, "docs", "CNAME"))).toBe(false);
    expect(existsSync(join(cloneRoot, "docs", "sitemap.xml"))).toBe(true);
    const republish = publishPagesAssets(date, cloneRoot, rootPagesOrigin);
    expect(republish).toMatch(/No GitHub Pages changes|Mirrored public site|Published GitHub Pages/);
    expect(git(sourceOrigin, ["ls-tree", "-r", "main", "--name-only"]).split(/\r?\n/)).not.toContain("docs/CNAME");
    expect(git(rootPagesOrigin, ["ls-tree", "-r", "main", "--name-only"]).split(/\r?\n/)).not.toContain("CNAME");
    expect(git(rootPagesOrigin, ["show", "main:keep-root.txt"])).toBe("keep-root");
    expect(git(rootPagesOrigin, ["show", "main:.github/workflows/pages.yml"])).toBe("name: pages");
    expect(git(rootPagesOrigin, ["show", "main:assets/2020-01-01/huge.bin"])).toBe("keep-me");
  }, 60000);

  gitIt("CLI skip-audit skip-indexnow still fail-closes missing empty and future sitemap before any git action", async () => {
    const { root, origin: sourceOrigin } = makeGitRepo();
    const { root: seed, origin: rootPagesOrigin } = makeGitRepo();
    const date = "2026-05-15";
    const oldSitemap = "<urlset><url><loc>/</loc><lastmod>2026-01-01</lastmod></url></urlset>\n";
    writeFileSync(join(seed, "sitemap.xml"), oldSitemap);
    git(seed, ["add", "sitemap.xml"]);
    git(seed, ["commit", "-m", "seed sitemap"]);
    git(seed, ["push", "origin", "main"]);

    writeMinimalPublishDocs(root, date);
    unlinkSync(join(root, "docs", "sitemap.xml"));
    const sourceHead = git(root, ["rev-parse", "HEAD"]);
    const sourceOriginHead = git(sourceOrigin, ["rev-parse", "refs/heads/main"]);
    const rootPagesHead = git(rootPagesOrigin, ["rev-parse", "refs/heads/main"]);
    const remoteSitemap = gitShow(rootPagesOrigin, "main:sitemap.xml");

    await expect(runSkipAuditPublishCli(root, date, rootPagesOrigin)).rejects.toThrow(
      /docs\/sitemap\.xml is missing/
    );
    expectUnchangedPublishHeads(
      root,
      sourceOrigin,
      rootPagesOrigin,
      sourceHead,
      sourceOriginHead,
      rootPagesHead,
      remoteSitemap
    );

    writeFileSync(join(root, "docs", "sitemap.xml"), "  \n");
    await expect(runSkipAuditPublishCli(root, date, rootPagesOrigin)).rejects.toThrow(
      /docs\/sitemap\.xml is empty/
    );
    expectUnchangedPublishHeads(
      root,
      sourceOrigin,
      rootPagesOrigin,
      sourceHead,
      sourceOriginHead,
      rootPagesHead,
      remoteSitemap
    );

    writeSitemap(root, "2099-01-01");
    await expect(runSkipAuditPublishCli(root, date, rootPagesOrigin)).rejects.toThrow(/2099-01-01/);
    expectUnchangedPublishHeads(
      root,
      sourceOrigin,
      rootPagesOrigin,
      sourceHead,
      sourceOriginHead,
      rootPagesHead,
      remoteSitemap
    );
  }, 60000);

  it("still collects a literal assets/ date path after escaped-separator cases", () => {
    const docsRoot = mkdtempSync(join(tmpdir(), "laundry-literal-assets-"));
    const oldDate = "2020-01-01";
    mkdirSync(join(docsRoot, "assets", oldDate), { recursive: true });
    writeFileSync(join(docsRoot, "assets", oldDate, "slot-01.webp"), "safe-bytes\n");
    writeFileSync(join(docsRoot, "index.html"), `<img src="assets/${oldDate}/slot-01.webp" />\n`);
    expect(collectReferencedPublicAssetPaths(docsRoot, ["index.html"])).toEqual([
      `assets/${oldDate}/slot-01.webp`
    ]);
  });

  for (const [file, ref] of [
    ["index.html", ESCAPED_ASSET_SEPARATOR_REFS[0]],
    ["latest.json", ESCAPED_ASSET_SEPARATOR_REFS[1]],
    ["sitemap.xml", ESCAPED_ASSET_SEPARATOR_REFS[2]]
  ] as const) {
    it(`rejects ${JSON.stringify(ref)} in ${file} without decoding it into a safe path`, () => {
      const docsRoot = mkdtempSync(join(tmpdir(), "laundry-escaped-assets-"));
      const oldDate = "2020-01-01";
      mkdirSync(join(docsRoot, "assets", oldDate), { recursive: true });
      writeFileSync(join(docsRoot, "assets", oldDate, "slot-01.webp"), "safe-bytes\n");
      writeFileSync(join(docsRoot, file), `<img src="${ref}" />\n`);
      expect(() => collectReferencedPublicAssetPaths(docsRoot, [file])).toThrow(escapedSeparatorError(ref));
    });
  }

  for (const ref of ["assets%2f2020-01-01%2fslot-01.webp", "assets&#47;2020-01-01&#47;slot-01.webp"]) {
    it(`rejects equivalent escaped separator ${JSON.stringify(ref)}`, () => {
      const docsRoot = mkdtempSync(join(tmpdir(), "laundry-escaped-extra-"));
      mkdirSync(join(docsRoot, "assets", "2020-01-01"), { recursive: true });
      writeFileSync(join(docsRoot, "assets", "2020-01-01", "slot-01.webp"), "safe-bytes\n");
      writeFileSync(join(docsRoot, "index.html"), `<img src="${ref}" />\n`);
      expect(() => collectReferencedPublicAssetPaths(docsRoot, ["index.html"])).toThrow(escapedSeparatorError(ref));
    });
  }

  for (const ref of ESCAPED_ASSET_SEPARATOR_REFS) {
    gitIt(`fails closed on ${JSON.stringify(ref)} before any git action`, () => {
      const { root, origin: sourceOrigin } = makeGitRepo();
      const { origin: rootPagesOrigin } = makeGitRepo();
      const date = "2026-05-15";
      const oldDate = "2020-01-01";
      writeMinimalPublishDocs(root, date);
      mkdirSync(join(root, "docs", "assets", oldDate), { recursive: true });
      writeFileSync(join(root, "docs", "assets", oldDate, "slot-01.webp"), "safe-bytes\n");
      const sourceHead = git(root, ["rev-parse", "HEAD"]);
      const sourceOriginHead = git(sourceOrigin, ["rev-parse", "refs/heads/main"]);
      const rootPagesHead = git(rootPagesOrigin, ["rev-parse", "refs/heads/main"]);

      writeFileSync(join(root, "docs", "index.html"), `<!doctype html><img src="${ref}" />\n`);
      expect(() => publishPagesAssets(date, root, rootPagesOrigin)).toThrow(escapedSeparatorError(ref));
      expectUnchangedPublishHeads(root, sourceOrigin, rootPagesOrigin, sourceHead, sourceOriginHead, rootPagesHead);
    }, 30000);
  }

  gitIt("mirrors referenced historical avif bytes", () => {
    const { root } = makeGitRepo();
    const { root: seed, origin: rootPagesOrigin } = makeGitRepo();
    const date = "2026-05-15";
    const oldDate = "2020-01-01";
    mkdirSync(join(seed, "assets", oldDate), { recursive: true });
    writeFileSync(join(seed, "assets", oldDate, "slot-01.avif"), "old-avif-bytes\n");
    git(seed, ["add", "-A"]);
    git(seed, ["commit", "-m", "seed historical avif"]);
    git(seed, ["push", "origin", "main"]);

    writeMinimalPublishDocs(root, date);
    mkdirSync(join(root, "docs", "assets", oldDate), { recursive: true });
    const updatedAvif = "new-avif-bytes-updated\n";
    writeFileSync(join(root, "docs", "assets", oldDate, "slot-01.avif"), updatedAvif);
    writeFileSync(
      join(root, "docs", "index.html"),
      `<!doctype html><img src="https://example.com/assets/${oldDate}/slot-01.avif" />\n`
    );

    const result = publishPagesAssets(date, root, rootPagesOrigin);
    expect(result).toContain("Mirrored public site");
    expect(sha256Bytes(gitShow(rootPagesOrigin, `main:assets/${oldDate}/slot-01.avif`))).toBe(sha256Bytes(updatedAvif));
  }, 60000);

  gitIt("fails closed on nested or percent-encoded assets references before any git action", () => {
    const { root, origin: sourceOrigin } = makeGitRepo();
    const { origin: rootPagesOrigin } = makeGitRepo();
    const date = "2026-05-15";
    writeMinimalPublishDocs(root, date);
    writeFileSync(
      join(root, "docs", "index.html"),
      `<!doctype html><img src="https://example.com/assets/2020-01-01/nested/slot-01.webp" />\n`
    );
    const sourceHead = git(root, ["rev-parse", "HEAD"]);
    const sourceOriginHead = git(sourceOrigin, ["rev-parse", "refs/heads/main"]);
    const rootPagesHead = git(rootPagesOrigin, ["rev-parse", "refs/heads/main"]);

    expect(() => publishPagesAssets(date, root, rootPagesOrigin)).toThrow(
      /non-allowlisted assets\/ references: assets\/2020-01-01\/nested\/slot-01\.webp/
    );
    expect(git(root, ["rev-parse", "HEAD"])).toBe(sourceHead);
    expect(git(sourceOrigin, ["rev-parse", "refs/heads/main"])).toBe(sourceOriginHead);
    expect(git(rootPagesOrigin, ["rev-parse", "refs/heads/main"])).toBe(rootPagesHead);

    writeFileSync(
      join(root, "docs", "index.html"),
      `<!doctype html><img src="https://example.com/assets/2020-01-01/slot%2D01.webp" />\n`
    );
    expect(() => publishPagesAssets(date, root, rootPagesOrigin)).toThrow(
      /non-allowlisted assets\/ references: assets\/2020-01-01\/slot%2D01\.webp/
    );
    expect(git(root, ["rev-parse", "HEAD"])).toBe(sourceHead);
    expect(git(sourceOrigin, ["rev-parse", "refs/heads/main"])).toBe(sourceOriginHead);
    expect(git(rootPagesOrigin, ["rev-parse", "refs/heads/main"])).toBe(rootPagesHead);

    writeFileSync(
      join(root, "docs", "index.html"),
      `<!doctype html><img src="https://example.com/assets/../../../etc/passwd" />\n`
    );
    expect(() => publishPagesAssets(date, root, rootPagesOrigin)).toThrow(/non-allowlisted assets\/ references/);
    expect(git(root, ["rev-parse", "HEAD"])).toBe(sourceHead);
    expect(git(sourceOrigin, ["rev-parse", "refs/heads/main"])).toBe(sourceOriginHead);
    expect(git(rootPagesOrigin, ["rev-parse", "refs/heads/main"])).toBe(rootPagesHead);
  }, 30000);

  gitIt("refuses to silently drop referenced assets over the selective-mirror budget", () => {
    const { root, origin: sourceOrigin } = makeGitRepo();
    const { origin: rootPagesOrigin } = makeGitRepo();
    const date = "2026-05-15";
    writeMinimalPublishDocs(root, date);
    const refs = Array.from(
      { length: MAX_REFERENCED_PUBLIC_ASSETS + 1 },
      (_, index) => `assets/2020-01-01/file-${String(index).padStart(4, "0")}.webp`
    );
    writeFileSync(join(root, "docs", "index.html"), `<!doctype html>${refs.map((path) => `src="${path}"`).join(" ")}\n`);
    const sourceHead = git(root, ["rev-parse", "HEAD"]);
    const sourceOriginHead = git(sourceOrigin, ["rev-parse", "refs/heads/main"]);
    const rootPagesHead = git(rootPagesOrigin, ["rev-parse", "refs/heads/main"]);

    expect(() => publishPagesAssets(date, root, rootPagesOrigin)).toThrow(
      /2001 referenced public assets exceed the selective-mirror budget/
    );
    expect(git(root, ["rev-parse", "HEAD"])).toBe(sourceHead);
    expect(git(sourceOrigin, ["rev-parse", "refs/heads/main"])).toBe(sourceOriginHead);
    expect(git(rootPagesOrigin, ["rev-parse", "refs/heads/main"])).toBe(rootPagesHead);
  }, 30000);
});
