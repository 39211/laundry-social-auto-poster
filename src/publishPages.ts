import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { auditPublicSite, formatPublicSiteAudit, publicSiteAuditFailures } from "./auditPublicSite";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { docsContentCalendarPath, projectRoot, relativeAssetPath } from "./paths";
import { getZonedDateParts } from "./scheduler";
import { submitIndexNow } from "./submitIndexNow";

function runGit(args: string[], root: string): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitConfigValue(root: string, key: string): string {
  try {
    return runGit(["config", "--get", key], root);
  } catch {
    return "";
  }
}

function checkoutMain(root: string): void {
  try {
    runGit(["checkout", "-B", "main", "origin/main"], root);
  } catch {
    runGit(["checkout", "-B", "main"], root);
  }
}

function hasOrigin(root: string): boolean {
  try {
    runGit(["remote", "get-url", "origin"], root);
    return true;
  } catch {
    return false;
  }
}

function hasStagedChanges(root: string, paths: string[]): boolean {
  try {
    runGit(["diff", "--cached", "--quiet", "--", ...paths], root);
    return false;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 1) return true;
    throw error;
  }
}

function normalizeGitPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isForbiddenPublishPath(path: string): boolean {
  const normalized = normalizeGitPath(path);
  return (
    normalized === ".env" ||
    normalized.startsWith(".env.") ||
    normalized.includes("/.env") ||
    normalized.startsWith("node_modules/") ||
    normalized.startsWith("data/posted-log/")
  );
}

function assertNoForbiddenStagedPaths(root: string): void {
  const staged = runGit(["diff", "--cached", "--name-only"], root)
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  const forbidden = staged.filter(isForbiddenPublishPath);
  if (forbidden.length > 0) {
    throw new Error(`Refusing to publish while secret or private files are staged: ${forbidden.join(", ")}`);
  }
}

function collectFiles(root: string, relativePath: string): string[] {
  const fullPath = join(root, ...relativePath.split("/"));
  if (!existsSync(fullPath)) return [];
  const info = statSync(fullPath);
  if (info.isFile()) return [fullPath];
  if (!info.isDirectory()) return [];

  return readdirSync(fullPath).flatMap((entry) => collectFiles(root, `${relativePath}/${entry}`));
}

function isTextPublishFile(filePath: string): boolean {
  // .xml and .jsonl are in the publish list (sitemaps, llms.jsonl); leaving
  // them out of this list meant they were published without the secret scan.
  return [".html", ".json", ".jsonl", ".md", ".txt", ".js", ".ts", ".css", ".xml"].includes(
    extname(filePath).toLowerCase()
  );
}

function assertNoSecretsInPublishTargets(root: string, paths: string[]): void {
  const forbiddenTarget = paths.find(isForbiddenPublishPath);
  if (forbiddenTarget) {
    throw new Error(`Refusing to publish forbidden path: ${forbiddenTarget}`);
  }

  const secretPatterns = [
    /OPENAI_API_KEY\s*["']?\s*[:=]/i,
    /META_ACCESS_TOKEN\s*["']?\s*[:=]/i,
    /CLOUDINARY_URL\s*["']?\s*[:=]/i,
    /SUPABASE_SERVICE_ROLE_KEY\s*["']?\s*[:=]/i,
    /sk-[A-Za-z0-9_-]{20,}/,
    /EAA[A-Za-z0-9]{20,}/
  ];

  const files = paths.flatMap((path) => collectFiles(root, path)).filter(isTextPublishFile);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const matched = secretPatterns.find((pattern) => pattern.test(text));
    if (matched) {
      throw new Error(`Refusing to publish possible secret in ${file}`);
    }
  }
}

function existingPublishPaths(root: string, paths: string[]): string[] {
  return paths.filter((path) => existsSync(join(root, ...path.split("/"))));
}

function indexNowKeyPublishPaths(root: string): string[] {
  const docsRoot = join(root, "docs");
  if (!existsSync(docsRoot)) return [];
  return readdirSync(docsRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name !== "indexnow-key.txt" &&
        /^[A-Za-z0-9-]{8,128}\.txt$/.test(entry.name) &&
        readFileSync(join(docsRoot, entry.name), "utf8").trim() === entry.name.replace(/\.txt$/u, "")
    )
    .map((entry) => `docs/${entry.name}`);
}

function copyDirectoryContents(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryContents(sourcePath, targetPath);
    } else if (entry.isFile()) {
      copyFileSync(sourcePath, targetPath);
    }
  }
}

const MIRROR_REPLACE_DIRS = new Set(["guides", "local", "services", "go", "posts", "content-calendar", "docs"]);

type MirrorPathKind = "replace-directory" | "overlay-directory" | "file";

function mirrorRelativePaths(paths: string[]): string[] {
  return Array.from(
    new Set(
      paths.map((path) => {
        const normalized = normalizeGitPath(path);
        if (!normalized.startsWith("docs/")) {
          throw new Error(`Refusing to mirror a path outside docs/: ${path}`);
        }
        const relative = normalized.slice("docs/".length);
        const parts = relative.split("/");
        if (!relative || parts.some((part) => !part || part === "." || part === "..")) {
          throw new Error(`Refusing to mirror an invalid docs path: ${path}`);
        }
        return relative;
      })
    )
  );
}

function mirrorPathKind(docsRoot: string, relativePath: string, date: string): MirrorPathKind {
  const source = join(docsRoot, ...relativePath.split("/"));
  const info = statSync(source);
  if (info.isDirectory()) {
    if (MIRROR_REPLACE_DIRS.has(relativePath)) return "replace-directory";
    if (["assets/backgrounds", "assets/services", `assets/${date}`].includes(relativePath)) {
      return "overlay-directory";
    }
    throw new Error(`Refusing to mirror a non-allowlisted directory: docs/${relativePath}`);
  }
  if (info.isFile()) {
    const parts = relativePath.split("/");
    if (parts.length === 1 || (parts.length === 2 && parts[0] === ".well-known")) return "file";
    throw new Error(`Refusing to mirror a non-allowlisted individual file: docs/${relativePath}`);
  }
  throw new Error(`Refusing to mirror a non-file, non-directory path: docs/${relativePath}`);
}

function mirrorSparseCones(docsRoot: string, relativePaths: string[], date: string): string[] {
  const cones = new Set([".github"]);
  for (const relativePath of relativePaths) {
    const kind = mirrorPathKind(docsRoot, relativePath, date);
    if (kind !== "file") {
      cones.add(relativePath);
    } else if (relativePath.startsWith(".well-known/")) {
      cones.add(".well-known");
    }
  }
  return [...cones];
}

function copyMirrorPublishTree(
  docsRoot: string,
  mirrorRoot: string,
  date: string,
  relativePaths: string[]
): string[] {
  const added: string[] = [];
  mkdirSync(mirrorRoot, { recursive: true });
  for (const relativePath of relativePaths) {
    const source = join(docsRoot, ...relativePath.split("/"));
    const target = join(mirrorRoot, ...relativePath.split("/"));
    const kind = mirrorPathKind(docsRoot, relativePath, date);
    if (kind === "file") {
      const parentParts = relativePath.split("/").slice(0, -1);
      if (parentParts.length > 0) mkdirSync(join(mirrorRoot, ...parentParts), { recursive: true });
      copyFileSync(source, target);
    } else {
      if (kind === "replace-directory") rmSync(target, { recursive: true, force: true });
      copyDirectoryContents(source, target);
    }
    added.push(relativePath);
  }
  return added;
}

function publishRootPagesMirror(date: string, root: string, rootPagesRepo: string, paths: string[]): string {
  if (!rootPagesRepo) return "";

  const docsRoot = join(root, "docs");
  if (!existsSync(docsRoot)) return "Root Pages mirror skipped because docs/ does not exist.";
  const relativePaths = mirrorRelativePaths(paths);
  const cones = mirrorSparseCones(docsRoot, relativePaths, date);

  const mirrorRoot = mkdtempSync(join(tmpdir(), "laundry-root-pages-"));
  try {
    // Overlay HTML/SEO files and the day's assets. Do not clear the remote tree or
    // `git add -A` the accumulated 646MB asset history: a blob:none clone plus a
    // full replace made `git add -A` talk to the promisor and fail with
    // "Empty reply from server" (2026-08-29). Historical assets stay on the remote.
    runGit(
      ["clone", "--depth", "1", "--filter=blob:none", "--single-branch", "--branch", "main", "--no-checkout", rootPagesRepo, mirrorRoot],
      root
    );
    runGit(["sparse-checkout", "init", "--cone"], mirrorRoot);
    runGit(["sparse-checkout", "set", ...cones], mirrorRoot);
    runGit(["config", "user.name", gitConfigValue(root, "user.name") || "Codex Automation"], mirrorRoot);
    runGit(["config", "user.email", gitConfigValue(root, "user.email") || "codex-automation@users.noreply.github.com"], mirrorRoot);
    checkoutMain(mirrorRoot);
    const added = copyMirrorPublishTree(docsRoot, mirrorRoot, date, relativePaths);
    if (added.length > 0) runGit(["add", "--sparse", "--", ...added], mirrorRoot);
    const status = runGit(["status", "--porcelain"], mirrorRoot);
    if (!status) return `No root Pages mirror changes to publish for ${date}.`;

    runGit(["commit", "-m", `Mirror public site ${date}`], mirrorRoot);
    runGit(["push", "origin", "HEAD:main"], mirrorRoot);
    return `Mirrored public site to root Pages repo for ${date}.`;
  } finally {
    rmSync(mirrorRoot, { recursive: true, force: true });
  }
}

export function publishPagesAssets(date: string, root = projectRoot(), rootPagesRepo = ""): string {
  if (!hasOrigin(root)) {
    return "Git remote origin is not configured; skipped GitHub Pages commit and push.";
  }

  const assetDir = relativeAssetPath(date, 1).replace(/\/slot-01\.png$/, "");
  const docsCalendar = docsContentCalendarPath(date, root);
  const publicSiteFiles = [
    "docs/index.html",
    "docs/404.html",
    "docs/docs",
    "docs/assets/backgrounds",
    "docs/assets/services",
    "docs/content-calendar",
    "docs/posts",
    "docs/services",
    "docs/guides",
    "docs/local",
    "docs/go",
    "docs/llms-lite.txt",
    "docs/llms.txt",
    "docs/llms-full.txt",
    "docs/.well-known/llms.txt",
    "docs/.well-known/ai.json",
    "docs/robots.txt",
    "docs/sitemap.xml",
    "docs/ai-sitemap.xml",
    "docs/social-posts.json",
    "docs/business-profile.json",
    "docs/latest.json",
    "docs/services.json",
    "docs/answers.json",
    "docs/geo-targets.json",
    "docs/search-visibility.json",
    "docs/llms.jsonl",
    "docs/feed.json",
    "docs/knowledge-graph.json",
    "docs/ai-discovery.json",
    "docs/.nojekyll",
    // GitHub Pages reads the custom domain from this file. Keep CNAME in the
    // scanned allowlist so selective mirror updates can refresh it safely.
    "docs/CNAME"
  ];
  const paths = existingPublishPaths(root, [assetDir, ...publicSiteFiles, ...indexNowKeyPublishPaths(root)]);

  assertNoForbiddenStagedPaths(root);
  assertNoSecretsInPublishTargets(root, paths);

  runGit(["add", "--", ...paths], root);
  // The mirror is what actually serves the public site, and it can be behind
  // even when this repo has nothing left to commit — assets committed by hand,
  // or a mirror push that failed after a successful commit here. Returning
  // early on "nothing to commit" skipped it, which left published URLs 404 with
  // everything looking done. The mirror runs either way.
  if (!hasStagedChanges(root, paths)) {
    const mirrorOnly = publishRootPagesMirror(date, root, rootPagesRepo, paths);
    return [`No GitHub Pages changes to publish for ${date}.`, mirrorOnly].filter(Boolean).join("\n");
  }

  runGit(["commit", "-m", `Generate daily Pages assets ${date}`, "--", ...paths], root);
  runGit(["push"], root);
  const mirrorResult = publishRootPagesMirror(date, root, rootPagesRepo, paths);
  return [`Published GitHub Pages assets for ${date}: ${assetDir}, ${docsCalendar}`, mirrorResult].filter(Boolean).join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = getConfig();
  const date = getOption(args, "date") || getZonedDateParts(new Date(), config.timezone).date;
  const root = projectRoot(getOption(args, "root"));
  console.log(publishPagesAssets(date, root, config.publicRootPagesRepo || ""));
  if (!getFlag(args, "skip-indexnow")) {
    try {
      const result = await submitIndexNow({ root, live: true });
      console.log(`IndexNow: notified ${result.urlCount} URLs for ${result.host}.`);
    } catch (error) {
      // IndexNow is a notification, not the source of truth for what's live -- a
      // transient failure here must not fail the publish step or the audit below.
      console.log(`IndexNow submission failed (non-fatal): ${(error as Error).message}`);
    }
  }
  if (!getFlag(args, "skip-audit")) {
    const auditMode = getOption(args, "audit-mode") === "local" ? "local" : "public";
    const audit = await auditPublicSite({
      root,
      siteBaseUrl: config.publicImageBaseUrl,
      mode: auditMode,
      retries: getNumberOption(args, "audit-retries") ?? 1,
      retryMs: getNumberOption(args, "audit-retry-ms") ?? 30000
    });
    console.log(formatPublicSiteAudit(audit));
    if (publicSiteAuditFailures(audit).length > 0) {
      process.exitCode = 1;
    }
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
