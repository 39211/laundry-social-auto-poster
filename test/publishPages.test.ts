import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { publishPagesAssets } from "../src/publishPages";

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

describe("publishPagesAssets", () => {
  const gitIt = gitAvailable ? it : it.skip;

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
  }, 15000);

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

  gitIt("refuses to publish text files that look like they contain secrets", () => {
    const { root } = makeGitRepo();
    const date = "2026-05-15";

    mkdirSync(join(root, "docs", "assets", date), { recursive: true });
    mkdirSync(join(root, "docs", "content-calendar"), { recursive: true });
    writeFileSync(join(root, "docs", "index.html"), "<!doctype html><title>ok</title>\n");
    writeFileSync(join(root, "docs", "content-calendar", `${date}.json`), '{"META_ACCESS_TOKEN":"EAA-secret"}\n');
    writeFileSync(join(root, "docs", "assets", date, "slot-01.png"), "fake image");

    expect(() => publishPagesAssets(date, root)).toThrow("possible secret");
  }, 15000);
});
