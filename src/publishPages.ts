import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { auditPublicSite, formatPublicSiteAudit, publicSiteAuditFailures } from "./auditPublicSite";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { docsContentCalendarPath, projectRoot, relativeAssetPath } from "./paths";
import { getZonedDateParts } from "./scheduler";

function runGit(args: string[], root: string): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
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
  return [".html", ".json", ".md", ".txt", ".js", ".ts", ".css"].includes(extname(filePath).toLowerCase());
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

export function publishPagesAssets(date: string, root = projectRoot()): string {
  if (!hasOrigin(root)) {
    return "Git remote origin is not configured; skipped GitHub Pages commit and push.";
  }

  const assetDir = relativeAssetPath(date, 1).replace(/\/slot-01\.png$/, "");
  const docsCalendar = docsContentCalendarPath(date, root);
  const docsCalendarRelative = `docs/content-calendar/${date}.json`;
  const paths = [assetDir, docsCalendarRelative, "docs/index.html"];

  assertNoForbiddenStagedPaths(root);
  assertNoSecretsInPublishTargets(root, paths);

  runGit(["add", "--", ...paths], root);
  if (!hasStagedChanges(root, paths)) {
    return `No GitHub Pages changes to publish for ${date}.`;
  }

  runGit(["commit", "-m", `Generate daily Pages assets ${date}`, "--", ...paths], root);
  runGit(["push"], root);
  return `Published GitHub Pages assets for ${date}: ${assetDir}, ${docsCalendar}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = getConfig();
  const date = getOption(args, "date") || getZonedDateParts(new Date(), config.timezone).date;
  const root = projectRoot(getOption(args, "root"));
  console.log(publishPagesAssets(date, root));
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
