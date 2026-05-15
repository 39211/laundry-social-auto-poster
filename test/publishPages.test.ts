import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { publishPagesAssets } from "../src/publishPages";

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
  it("does not commit .env when publishing Pages assets", () => {
    const { root } = makeGitRepo();
    const date = "2026-05-15";

    mkdirSync(join(root, "docs", "assets", date), { recursive: true });
    mkdirSync(join(root, "docs", "content-calendar"), { recursive: true });
    writeFileSync(join(root, "docs", "index.html"), "<!doctype html><title>ok</title>\n");
    writeFileSync(join(root, "docs", "content-calendar", `${date}.json`), '{"slots":[]}\n');
    writeFileSync(join(root, "docs", "assets", date, "slot-01.png"), "fake image");
    writeFileSync(join(root, ".env"), "META_ACCESS_TOKEN=EAA-this-should-not-commit\n");

    const result = publishPagesAssets(date, root);
    const tree = git(root, ["ls-tree", "-r", "HEAD", "--name-only"]);

    expect(result).toContain("Published GitHub Pages assets");
    expect(tree).toContain(`docs/content-calendar/${date}.json`);
    expect(tree).toContain(`docs/assets/${date}/slot-01.png`);
    expect(tree).not.toContain(".env");
  });

  it("refuses to publish text files that look like they contain secrets", () => {
    const { root } = makeGitRepo();
    const date = "2026-05-15";

    mkdirSync(join(root, "docs", "assets", date), { recursive: true });
    mkdirSync(join(root, "docs", "content-calendar"), { recursive: true });
    writeFileSync(join(root, "docs", "index.html"), "<!doctype html><title>ok</title>\n");
    writeFileSync(join(root, "docs", "content-calendar", `${date}.json`), '{"META_ACCESS_TOKEN":"EAA-secret"}\n');
    writeFileSync(join(root, "docs", "assets", date, "slot-01.png"), "fake image");

    expect(() => publishPagesAssets(date, root)).toThrow("possible secret");
  });
});
