import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { auditPublicSite, formatPublicSiteAudit, publicSiteAuditFailures } from "./auditPublicSite";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { docsContentCalendarPath, projectRoot, relativeAssetPath } from "./paths";
import { assertCanonicalPublicPublicationApproval } from "./publicPublicationApproval";
import { getZonedDateParts } from "./scheduler";

const TRUSTED_SYSTEM_GIT = "C:\\Program Files\\Git\\cmd\\git.exe";
const UNSAFE_GIT_ENVIRONMENT_NAMES = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG",
  "GIT_EXEC_PATH",
  "GIT_TEMPLATE_DIR",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_ASKPASS",
  "GIT_PROXY_COMMAND",
  "GIT_EXTERNAL_DIFF",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM"
]);

function resolveTrustedGitExecutable(): string {
  // Publishing is a production side effect. Do not resolve `git` through
  // PATH: on Windows a workspace-local git.cmd/git.exe can win that lookup.
  if (!existsSync(TRUSTED_SYSTEM_GIT)) {
    throw new Error("Trusted system Git executable is unavailable; refusing Pages publish.");
  }
  return TRUSTED_SYSTEM_GIT;
}

function assertNoWorkspaceGitShadow(root: string): void {
  const shadow = ["git.exe", "git.cmd", "git.bat"].find((name) => existsSync(join(root, name)));
  if (shadow) {
    throw new Error(`Refusing Pages publish while workspace-local ${shadow} is present.`);
  }
}

function inheritedUnsafeGitEnvironment(): string[] {
  return Object.entries(process.env)
    .filter(([name, value]) => {
      if (!value?.trim()) return false;
      const normalized = name.toUpperCase();
      return (
        UNSAFE_GIT_ENVIRONMENT_NAMES.has(normalized) ||
        /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/.test(normalized)
      );
    })
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right));
}

function assertNoUnsafeGitEnvironment(): void {
  const unsafe = inheritedUnsafeGitEnvironment();
  if (unsafe.length > 0) {
    throw new Error(`Refusing Pages publish with inherited Git override(s): ${unsafe.join(", ")}`);
  }
}

function scrubbedGitEnvironment(): NodeJS.ProcessEnv {
  // Keep normal credentials/proxy setup available for an approved push, but
  // do not pass any Git process state to the trusted executable. Git's
  // repository/config/runtime overrides can redirect a clone, command, or
  // object write outside the approved worktree.
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("GIT_")));
}

function runGit(args: string[], root: string): string {
  assertNoUnsafeGitEnvironment();
  assertNoWorkspaceGitShadow(root);
  // The directory is created immediately before the process and removed as
  // soon as it exits. It deliberately contains no hooks, and the command-line
  // config takes precedence over any local/global core.hooksPath setting.
  const emptyHooksPath = mkdtempSync(join(tmpdir(), "laundry-pages-git-hooks-"));
  try {
    return execFileSync(resolveTrustedGitExecutable(), ["-c", `core.hooksPath=${emptyHooksPath}`, ...args], {
      cwd: root,
      encoding: "utf8",
      env: scrubbedGitEnvironment(),
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } finally {
    rmSync(emptyHooksPath, { recursive: true, force: true });
  }
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
  // A missing origin or unavailable system Git remains a normal no-publish
  // outcome. A workspace shadow is different: reject it explicitly instead
  // of allowing it to masquerade as a missing origin.
  assertNoUnsafeGitEnvironment();
  assertNoWorkspaceGitShadow(root);
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

function clearMirrorWorktree(root: string): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    // .github holds the Pages deploy workflow. The mirror moved to
    // Actions-based deployment on 2026-08-07 because legacy Jekyll builds
    // began failing on the 646MB asset tree; wiping the workflow on every
    // mirror push would silently remove the only thing that deploys the site.
    if (entry.name === ".github") continue;
    rmSync(join(root, entry.name), { recursive: true, force: true });
  }
}

function publishRootPagesMirror(date: string, root: string, rootPagesRepo: string): string {
  if (!rootPagesRepo) return "";

  const docsRoot = join(root, "docs");
  if (!existsSync(docsRoot)) return "Root Pages mirror skipped because docs/ does not exist.";

  const mirrorRoot = mkdtempSync(join(tmpdir(), "laundry-root-pages-"));
  try {
    runGit(["clone", rootPagesRepo, mirrorRoot], root);
    runGit(["config", "user.name", gitConfigValue(root, "user.name") || "Codex Automation"], mirrorRoot);
    runGit(["config", "user.email", gitConfigValue(root, "user.email") || "codex-automation@users.noreply.github.com"], mirrorRoot);
    checkoutMain(mirrorRoot);
    clearMirrorWorktree(mirrorRoot);
    copyDirectoryContents(docsRoot, mirrorRoot);

    runGit(["add", "-A"], mirrorRoot);
    const status = runGit(["status", "--porcelain"], mirrorRoot);
    if (!status) return `No root Pages mirror changes to publish for ${date}.`;

    runGit(["commit", "--no-verify", "-m", `Mirror public site ${date}`], mirrorRoot);
    runGit(["push", "origin", "HEAD:main"], mirrorRoot);
    return `Mirrored public site to root Pages repo for ${date}.`;
  } finally {
    rmSync(mirrorRoot, { recursive: true, force: true });
  }
}

export async function publishPagesAssets(date: string, root = projectRoot(), rootPagesRepo = ""): Promise<string> {
  // Fail before the initial origin check so an inherited Git override cannot
  // be disguised as a routine "origin is not configured" skip.
  assertNoUnsafeGitEnvironment();
  if (!hasOrigin(root)) {
    return "Git remote origin is not configured; skipped GitHub Pages commit and push.";
  }

  // A direct `npm run publish-pages` must not bypass the scheduler's
  // PowerShell bridge. Verify the same date-specific approval chain before
  // staging, committing, cloning the mirror, or pushing any public files.
  await assertCanonicalPublicPublicationApproval(date, root);

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
    // GitHub Pages reads the custom domain from this file. The root mirror is cleared and
    // recopied from docs/ on every publish, so leaving it out would drop the domain each time.
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
    const mirrorOnly = publishRootPagesMirror(date, root, rootPagesRepo);
    return [`No GitHub Pages changes to publish for ${date}.`, mirrorOnly].filter(Boolean).join("\n");
  }

  runGit(["commit", "--no-verify", "-m", `Generate daily Pages assets ${date}`, "--", ...paths], root);
  runGit(["push"], root);
  const mirrorResult = publishRootPagesMirror(date, root, rootPagesRepo);
  return [`Published GitHub Pages assets for ${date}: ${assetDir}, ${docsCalendar}`, mirrorResult].filter(Boolean).join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = getConfig();
  const date = getOption(args, "date") || getZonedDateParts(new Date(), config.timezone).date;
  const root = projectRoot(getOption(args, "root"));
  console.log(await publishPagesAssets(date, root, config.publicRootPagesRepo || ""));
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
