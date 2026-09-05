import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { auditPublicSite, formatPublicSiteAudit, publicSiteAuditFailures } from "./auditPublicSite";
import { assertLocalSitemapHasNoFutureLastmod } from "./auditSitemap";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { docsContentCalendarPath, projectRoot, relativeAssetPath } from "./paths";
import { regeneratePublicImageMetadataSync } from "./publicImageMetadata";
import { getZonedDateParts } from "./scheduler";
import { submitIndexNow } from "./submitIndexNow";

const GIT_PATHSPEC_BATCH = 40;
export const MAX_REFERENCED_PUBLIC_ASSETS = 2000;
const ALLOWED_ASSET_EXTENSIONS = new Set(["png", "webp", "jpeg", "jpg", "gif", "mp4", "avif"]);
// Capture every assets/ path in public text. Allowlist decides keep vs fail-closed;
// a narrow regex must not silently drop nested, encoded, or unknown references.
const REFERENCED_ASSET_PATTERN = /(?:docs\/)?(assets\/[^\s"'<>)\]?#&,]*)/gi;
const ASSET_PATH_TERMINATOR = /[\s"'<>]/;
// Escaped or encoded separators that never match the literal assets/ collector.
// Reject them as written; never decode into a safe assets/date/file path.
const ESCAPED_ASSET_SEPARATOR_PREFIX =
  /(?:docs(?:\\+|%(?:2[fF]|5[cC]|252[fF])|&#(?:47|92|x2[fF]|x5[cC]);?|&(?:sol|bsol);|\\u002[fF]|\\x2[fF]))?assets(?:\\+|%(?:2[fF]|5[cC]|252[fF])|&#(?:47|92|x2[fF]|x5[cC]);?|&(?:sol|bsol);|\\u002[fF]|\\x2[fF])/gi;

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
  if (paths.length === 0) return false;
  for (let i = 0; i < paths.length; i += GIT_PATHSPEC_BATCH) {
    const batch = paths.slice(i, i + GIT_PATHSPEC_BATCH);
    try {
      runGit(["diff", "--cached", "--quiet", "--", ...batch], root);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 1) return true;
      throw error;
    }
  }
  return false;
}

function withPathspecFile<T>(paths: string[], fn: (pathspecFile: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "laundry-pathspec-"));
  try {
    const pathspecFile = join(dir, "pathspec.txt");
    writeFileSync(pathspecFile, uniquePaths(paths.map(normalizeGitPath)).join("\n") + "\n", "utf8");
    return fn(pathspecFile.replaceAll("\\", "/"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function gitAddPaths(root: string, paths: string[], sparse = false): void {
  if (paths.length === 0) return;
  withPathspecFile(paths, (pathspecFile) => {
    runGit(["add", ...(sparse ? ["--sparse"] : []), `--pathspec-from-file=${pathspecFile}`], root);
  });
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function isAllowlistedAssetFile(relativePath: string): boolean {
  const normalized = normalizeGitPath(relativePath);
  if (!normalized || /[%\\\0]/.test(normalized)) return false;
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes(".."))) return false;
  if (parts.length !== 3 || parts[0] !== "assets") return false;
  const bucket = parts[1];
  const file = parts[2];
  if (!bucket || !file || file.startsWith(".")) return false;
  if (!/^[A-Za-z0-9._-]+$/.test(file)) return false;
  const dot = file.lastIndexOf(".");
  if (dot <= 0 || dot === file.length - 1) return false;
  const ext = file.slice(dot + 1).toLowerCase();
  if (!ALLOWED_ASSET_EXTENSIONS.has(ext)) return false;
  if (bucket === "backgrounds" || bucket === "services") return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(bucket);
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

function isAssetPublishPath(relativePath: string): boolean {
  const normalized = normalizeGitPath(relativePath);
  return normalized === "assets" || normalized.startsWith("assets/");
}

function collectEscapedAssetPathRefs(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(ESCAPED_ASSET_SEPARATOR_PREFIX)) {
    const start = match.index ?? 0;
    let end = start + match[0].length;
    while (end < text.length && !ASSET_PATH_TERMINATOR.test(text.charAt(end))) end += 1;
    found.push(text.slice(start, end));
  }
  return found;
}

function assertNoEscapedAssetPathSeparators(text: string): void {
  const found = [...new Set(collectEscapedAssetPathRefs(text))].sort();
  if (found.length > 0) {
    throw new Error(
      `Refusing to publish: public site has escaped or encoded assets path separators: ${found.join(", ")}.`
    );
  }
}

export function collectReferencedPublicAssetPaths(docsRoot: string, relativePublishPaths: string[]): string[] {
  const found = new Set<string>();
  const rejected = new Set<string>();
  for (const relativePath of relativePublishPaths) {
    if (isAssetPublishPath(relativePath)) continue;
    const files = collectFiles(docsRoot, relativePath).filter(isTextPublishFile);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      // Fail closed on escaped/encoded separators before the literal assets/ scan.
      // Decoding them into allowlisted paths would hide the reference.
      assertNoEscapedAssetPathSeparators(text);
      for (const match of text.matchAll(REFERENCED_ASSET_PATTERN)) {
        const assetPath = normalizeGitPath(match[1] ?? "");
        if (isAllowlistedAssetFile(assetPath)) found.add(assetPath);
        else rejected.add(assetPath || match[1] || "assets/");
      }
    }
  }
  if (rejected.size > 0) {
    throw new Error(
      `Refusing to publish: public site has non-allowlisted assets/ references: ${[...rejected].sort().join(", ")}.`
    );
  }
  return [...found].sort();
}

export function assertMirroredReferencedAssets(
  docsRoot: string,
  mirrorRoot: string,
  referenced: string[],
  relativePublishPaths: string[] = []
): void {
  const discovered = relativePublishPaths.length > 0 ? collectReferencedPublicAssetPaths(docsRoot, relativePublishPaths) : [];
  const required = uniquePaths([...referenced, ...discovered]);
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const relativePath of required) {
    const source = join(docsRoot, ...relativePath.split("/"));
    const target = join(mirrorRoot, ...relativePath.split("/"));
    if (!existsSync(source)) {
      throw new Error(`Refusing to publish: public site references missing source asset docs/${relativePath}`);
    }
    if (!existsSync(target)) {
      missing.push(relativePath);
      continue;
    }
    if (sha256File(source) !== sha256File(target)) mismatched.push(relativePath);
  }
  if (missing.length > 0 || mismatched.length > 0) {
    const details = [
      missing.length > 0 ? `missing: ${missing.join(", ")}` : "",
      mismatched.length > 0 ? `content mismatch: ${mismatched.join(", ")}` : ""
    ]
      .filter(Boolean)
      .join("; ");
    throw new Error(`Refusing to publish incomplete referenced-asset mirror (${details}).`);
  }
}

function gitTracksPath(root: string, relativePath: string): boolean {
  const normalized = normalizeGitPath(relativePath);
  const fromTree = runGit(["ls-tree", "--name-only", "HEAD", "--", normalized], root);
  if (fromTree.split(/\r?\n/).some((line) => line === normalized)) return true;
  const fromIndex = runGit(["ls-files", "--", normalized], root);
  return fromIndex.split(/\r?\n/).some((line) => line === normalized);
}

function remoteTracksPath(mirrorRoot: string, relativePath: string): boolean {
  return gitTracksPath(mirrorRoot, relativePath);
}

function sourceCnameTombstonePaths(root: string): string[] {
  const relative = "docs/CNAME";
  if (existsSync(join(root, "docs", "CNAME"))) return [];
  if (!gitTracksPath(root, relative)) return [];
  return [relative];
}

function applyCnameTombstone(docsRoot: string, mirrorRoot: string): void {
  if (existsSync(join(docsRoot, "CNAME"))) return;
  if (!remoteTracksPath(mirrorRoot, "CNAME")) return;
  const target = join(mirrorRoot, "CNAME");
  if (existsSync(target)) rmSync(target);
  runGit(["rm", "--cached", "--sparse", "--ignore-unmatch", "-f", "--", "CNAME"], mirrorRoot);
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

const MIRROR_REPLACE_DIRS = new Set([
  "guides",
  "knowledge",
  "local",
  "services",
  "scripts",
  "go",
  "posts",
  "content-calendar",
  "docs"
]);

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
    if (
      parts.length === 1 ||
      (parts.length === 2 && parts[0] === ".well-known") ||
      isAllowlistedAssetFile(relativePath)
    ) {
      return "file";
    }
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

function assertStagedReferencedAssets(docsRoot: string, mirrorRoot: string, referenced: string[]): void {
  for (const relativePath of referenced) {
    const source = join(docsRoot, ...relativePath.split("/"));
    const sourceHash = runGit(["hash-object", "--", source], mirrorRoot);
    let stagedHash = "";
    try {
      stagedHash = runGit(["rev-parse", `:${relativePath}`], mirrorRoot);
    } catch {
      throw new Error(`Refusing to publish: referenced asset was not staged in the root mirror: ${relativePath}`);
    }
    if (stagedHash !== sourceHash) {
      throw new Error(`Refusing to publish: staged root mirror asset ${relativePath} does not match source bytes.`);
    }
  }
}

function publishRootPagesMirror(date: string, root: string, rootPagesRepo: string, paths: string[]): string {
  if (!rootPagesRepo) return "";

  const docsRoot = join(root, "docs");
  if (!existsSync(docsRoot)) return "Root Pages mirror skipped because docs/ does not exist.";
  const relativePaths = mirrorRelativePaths(paths);
  const referencedAssets = collectReferencedPublicAssetPaths(docsRoot, relativePaths);
  if (referencedAssets.length > MAX_REFERENCED_PUBLIC_ASSETS) {
    throw new Error(
      `Refusing to publish: ${referencedAssets.length} referenced public assets exceed the selective-mirror budget of ${MAX_REFERENCED_PUBLIC_ASSETS}. Refusing to silently drop assets.`
    );
  }
  const missingSource = referencedAssets.filter((relativePath) => !existsSync(join(docsRoot, ...relativePath.split("/"))));
  if (missingSource.length > 0) {
    throw new Error(`Refusing to publish: public site references missing assets: ${missingSource.join(", ")}.`);
  }
  const mirrorPaths = uniquePaths([...relativePaths, ...referencedAssets]);
  const cones = mirrorSparseCones(docsRoot, mirrorPaths, date);

  const mirrorRoot = mkdtempSync(join(tmpdir(), "laundry-root-pages-"));
  try {
    // Overlay HTML/SEO files, the day's asset directories, and individual
    // referenced historical assets (including newly generated WebP). Do not
    // clear the remote tree, `git add -A`, or disable sparse-checkout: a
    // blob:none clone plus a full replace made `git add -A` talk to the
    // promisor and fail with "Empty reply from server" (2026-08-29).
    runGit(
      ["clone", "--depth", "1", "--filter=blob:none", "--single-branch", "--branch", "main", "--no-checkout", rootPagesRepo, mirrorRoot],
      root
    );
    runGit(["sparse-checkout", "init", "--cone"], mirrorRoot);
    runGit(["sparse-checkout", "set", ...cones], mirrorRoot);
    runGit(["config", "user.name", gitConfigValue(root, "user.name") || "Codex Automation"], mirrorRoot);
    runGit(["config", "user.email", gitConfigValue(root, "user.email") || "codex-automation@users.noreply.github.com"], mirrorRoot);
    checkoutMain(mirrorRoot);
    const added = copyMirrorPublishTree(docsRoot, mirrorRoot, date, mirrorPaths);
    applyCnameTombstone(docsRoot, mirrorRoot);
    assertMirroredReferencedAssets(docsRoot, mirrorRoot, referencedAssets, relativePaths);
    gitAddPaths(mirrorRoot, added, true);
    if (referencedAssets.length > 0) gitAddPaths(mirrorRoot, referencedAssets, true);
    assertStagedReferencedAssets(docsRoot, mirrorRoot, referencedAssets);
    const status = runGit(["status", "--porcelain"], mirrorRoot);
    if (!status) return `No root Pages mirror changes to publish for ${date}.`;

    runGit(["commit", "-m", `Mirror public site ${date}`], mirrorRoot);
    runGit(["push", "origin", "HEAD:main"], mirrorRoot);
    return `Mirrored public site to root Pages repo for ${date}.`;
  } finally {
    rmSync(mirrorRoot, { recursive: true, force: true });
  }
}

export function publishPagesAssets(
  date: string,
  root = projectRoot(),
  rootPagesRepo = "",
  now: Date = new Date(),
  options?: { env?: NodeJS.ProcessEnv }
): string {
  // Future-lastmod is a local fail-closed publish gate. It cannot be bypassed
  // by --skip-audit (public URL audit), IndexNow, warnings, or network state.
  assertLocalSitemapHasNoFutureLastmod(root, now);

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
    "docs/knowledge",
    "docs/local",
    "docs/scripts",
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
    "docs/rss.xml",
    "docs/knowledge-graph.json",
    "docs/ai-discovery.json",
    "docs/.nojekyll",
    // GitHub Pages reads the custom domain from this file. Keep CNAME in the
    // scanned allowlist so selective mirror updates can refresh it safely.
    "docs/CNAME"
  ];
  const paths = existingPublishPaths(root, [assetDir, ...publicSiteFiles, ...indexNowKeyPublishPaths(root)]);
  const docsRoot = join(root, "docs");
  const referencedAssets = existsSync(docsRoot)
    ? collectReferencedPublicAssetPaths(docsRoot, mirrorRelativePaths(paths))
    : [];
  if (referencedAssets.length > MAX_REFERENCED_PUBLIC_ASSETS) {
    throw new Error(
      `Refusing to publish: ${referencedAssets.length} referenced public assets exceed the selective-mirror budget of ${MAX_REFERENCED_PUBLIC_ASSETS}. Refusing to silently drop assets.`
    );
  }
  const referencedDocsPaths = referencedAssets.map((relativePath) => `docs/${relativePath}`);
  const missingSource = referencedDocsPaths.filter((path) => !existsSync(join(root, ...path.split("/"))));
  if (missingSource.length > 0) {
    throw new Error(`Refusing to publish: public site references missing assets: ${missingSource.join(", ")}.`);
  }
  const pathsToPublish = uniquePaths([...paths, ...referencedDocsPaths]);
  // Missing CNAME must still be staged on the source so a later clone cannot
  // resurrect it. Do not pass the missing path to the root mirror copy.
  const imageMetadataPath = "docs-internal/public-image-metadata.json";
  const sourcePathsToStage = uniquePaths([
    ...pathsToPublish,
    ...sourceCnameTombstonePaths(root),
    imageMetadataPath
  ]);

  // Regen before the secret scan so the JSON is on disk and included in the
  // scanned set. A bad PNG fails closed here (intentional): abort this tick.
  // Site base is PUBLIC_SITE_BASE_URL only. PUBLIC_IMAGE_BASE_URL may be a
  // separate CDN path and must not become the HTML/sitemap base.
  regeneratePublicImageMetadataSync(root, {
    env: options?.env ?? { PUBLIC_SITE_BASE_URL: process.env.PUBLIC_SITE_BASE_URL }
  });
  assertNoForbiddenStagedPaths(root);
  assertNoSecretsInPublishTargets(root, uniquePaths([...pathsToPublish, imageMetadataPath]));

  gitAddPaths(root, sourcePathsToStage);
  // The mirror is what actually serves the public site, and it can be behind
  // even when this repo has nothing left to commit — assets committed by hand,
  // or a mirror push that failed after a successful commit here. Returning
  // early on "nothing to commit" skipped it, which left published URLs 404 with
  // everything looking done. The mirror runs either way.
  if (!hasStagedChanges(root, sourcePathsToStage)) {
    const mirrorOnly = publishRootPagesMirror(date, root, rootPagesRepo, pathsToPublish);
    return [`No GitHub Pages changes to publish for ${date}.`, mirrorOnly].filter(Boolean).join("\n");
  }

  withPathspecFile(sourcePathsToStage, (pathspecFile) => {
    runGit(["commit", "-m", `Generate daily Pages assets ${date}`, `--pathspec-from-file=${pathspecFile}`], root);
  });
  runGit(["push"], root);
  const mirrorResult = publishRootPagesMirror(date, root, rootPagesRepo, pathsToPublish);
  return [`Published GitHub Pages assets for ${date}: ${assetDir}, ${docsCalendar}`, mirrorResult].filter(Boolean).join("\n");
}

export async function runPublishPagesCli(args: string[] = process.argv.slice(2)): Promise<void> {
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
  runPublishPagesCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
