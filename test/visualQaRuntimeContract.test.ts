import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const project = process.cwd();
const roots: string[] = [];
const SYSTEM_GIT = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "cmd", "git.exe");
const TEST_RUNTIME_SEAM = "allow-temp-production-runtime-shims-v1";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function quote(value: string): string {
  return value.replace(/'/g, "''");
}

async function writeJson(root: string, relative: string, value: unknown): Promise<void> {
  const path = join(root, ...relative.split("/"));
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function initAndCommit(root: string, paths: string[]): Promise<void> {
  await execFileAsync(SYSTEM_GIT, ["init", "--quiet"], { cwd: root });
  if (paths.length === 0) return;
  await execFileAsync(SYSTEM_GIT, ["add", "--", ...paths], { cwd: root });
  await execFileAsync(
    SYSTEM_GIT,
    ["-c", "user.name=Visual QA Fixture", "-c", "user.email=visual-qa-fixture@example.test", "commit", "--quiet", "-m", "fixture"],
    { cwd: root }
  );
}

async function writeTrustedNpmShim(): Promise<string> {
  const runtime = await mkdtemp(join(tmpdir(), "visual-qa-trusted-npm-"));
  roots.push(runtime);
  const path = join(runtime, "npm.cmd");
  await writeFile(path, "@echo off\r\nexit /b 0\r\n", "utf8");
  return path;
}

async function writeTrustedFfmpegShim(): Promise<string> {
  const runtime = await mkdtemp(join(tmpdir(), "visual-qa-trusted-ffmpeg-"));
  roots.push(runtime);
  const path = join(runtime, "ffmpeg.exe");
  // The negative test only proves resolution and must never invoke this file.
  await writeFile(path, "not-an-executable", "utf8");
  return path;
}

async function writeTrustedTsxShim(source: string): Promise<string> {
  const runtime = await mkdtemp(join(tmpdir(), "visual-qa-trusted-tsx-"));
  roots.push(runtime);
  const path = join(runtime, "tsx.mjs");
  await writeFile(path, source, "utf8");
  return path;
}

async function runPowerShell(command: string): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      { cwd: project }
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof failure.code === "number" ? failure.code : -1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message
    };
  }
}

describe("visual QA runtime and post-child contract", () => {
  it("does not execute PATH python or APPDATA Codex shadows when trusted carousel QA is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "visual-qa-shadow-"));
    roots.push(root);
    const date = "2026-08-19";
    const pathShadow = join(root, "path-shadow");
    const appData = join(root, "appdata");
    const pythonMarker = join(root, "unexpected-path-python.txt");
    const codexMarker = join(root, "unexpected-appdata-codex.txt");
    await initAndCommit(root, []);
    await mkdir(pathShadow, { recursive: true });
    await mkdir(join(appData, "npm"), { recursive: true });
    await writeFile(join(pathShadow, "python.cmd"), `@echo off\r\n> "${pythonMarker}" echo path-python\r\n`, "utf8");
    const appDataCodex = join(appData, "npm", "codex.cmd");
    await writeFile(appDataCodex, `@echo off\r\n> "${codexMarker}" echo appdata-codex\r\n`, "utf8");
    await writeJson(root, `data/image-prompts/${date}.json`, {
      items: [
        { slot: 1, topic: "衣物送洗", target_path: `docs/assets/${date}/slot-01-a.png`, prompt: "a" },
        { slot: 1, topic: "衣物送洗", target_path: `docs/assets/${date}/slot-01-b.png`, prompt: "b" }
      ]
    });
    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    await writeFile(join(root, "docs", "assets", date, "slot-01-a.png"), "not-run", "utf8");
    await writeFile(join(root, "docs", "assets", date, "slot-01-b.png"), "not-run", "utf8");
    const trustedNpm = await writeTrustedNpmShim();
    const trustedFfmpeg = await writeTrustedFfmpegShim();
    const trustedTsx = await writeTrustedTsxShim(`console.error("unexpected trusted TSX invocation"); process.exitCode = 91;\n`);

    const result = await runPowerShell([
      `$env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM = '${TEST_RUNTIME_SEAM}'`,
      `$env:LAUNDRY_TRUSTED_NPM_CMD = '${quote(trustedNpm)}'`,
      `$env:LAUNDRY_TRUSTED_TSX_ENTRY = '${quote(trustedTsx)}'`,
      `$env:LAUNDRY_TRUSTED_FFMPEG_EXE = '${quote(trustedFfmpeg)}'`,
      `$env:LAUNDRY_TRUSTED_CODEX_CMD = '${quote(appDataCodex)}'`,
      `$env:APPDATA = '${quote(appData)}'`,
      `$env:PATH = '${quote(pathShadow)};' + $env:PATH`,
      `& '${quote(join(project, "scripts", "generate-missing-images.ps1"))}' -Date '${date}' -QaOnly -RootOverride '${quote(root)}'`,
      "exit $LASTEXITCODE"
    ].join("; "));

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(result.stderr).toContain("trusted immutable Codex runtime could not be established");
    expect(await exists(pythonMarker)).toBe(false);
    expect(await exists(codexMarker)).toBe(false);
    expect(await exists(join(root, "output", "visual-qa"))).toBe(false);
  });

  it("does not fall back to a PATH ffmpeg shadow before carousel canary preparation", async () => {
    const root = await mkdtemp(join(tmpdir(), "visual-qa-ffmpeg-shadow-"));
    roots.push(root);
    const date = "2026-08-19";
    const pathShadow = join(root, "path-shadow");
    const ffmpegMarker = join(root, "unexpected-path-ffmpeg.txt");
    const tsxMarker = join(root, "unexpected-trusted-tsx.txt");
    await initAndCommit(root, []);
    await mkdir(pathShadow, { recursive: true });
    await writeFile(join(pathShadow, "ffmpeg.cmd"), `@echo off\r\n> "${ffmpegMarker}" echo path-ffmpeg\r\n`, "utf8");
    await writeJson(root, `data/image-prompts/${date}.json`, {
      items: [
        { slot: 1, topic: "衣物送洗", target_path: `docs/assets/${date}/slot-01-a.png`, prompt: "a" },
        { slot: 1, topic: "衣物送洗", target_path: `docs/assets/${date}/slot-01-b.png`, prompt: "b" }
      ]
    });
    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    await writeFile(join(root, "docs", "assets", date, "slot-01-a.png"), "not-run", "utf8");
    await writeFile(join(root, "docs", "assets", date, "slot-01-b.png"), "not-run", "utf8");
    const trustedNpm = await writeTrustedNpmShim();
    const trustedTsx = await writeTrustedTsxShim(
      `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(tsxMarker)}, "tsx", "utf8"); process.exitCode = 91;\n`
    );

    const result = await runPowerShell([
      `$env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM = '${TEST_RUNTIME_SEAM}'`,
      `$env:LAUNDRY_TRUSTED_NPM_CMD = '${quote(trustedNpm)}'`,
      `$env:LAUNDRY_TRUSTED_TSX_ENTRY = '${quote(trustedTsx)}'`,
      `$env:PATH = '${quote(pathShadow)};' + $env:PATH`,
      `& '${quote(join(project, "scripts", "generate-missing-images.ps1"))}' -Date '${date}' -QaOnly -RootOverride '${quote(root)}'`,
      "exit $LASTEXITCODE"
    ].join("; "));

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(result.stderr).toContain("trusted allowlisted ffmpeg runtime could not be established");
    expect(await exists(ffmpegMarker)).toBe(false);
    expect(await exists(tsxMarker)).toBe(false);
    expect(await exists(join(root, "output", "visual-qa"))).toBe(false);
  });

  it("stops daily generation immediately after a child dirties protected source, before log, lock, Pages, or IndexNow", async () => {
    const root = await mkdtemp(join(tmpdir(), "daily-post-child-dirty-"));
    roots.push(root);
    const date = "2026-08-19";
    const runtimeCalls = join(root, "trusted-runtime-calls.log");
    const publicMarker = join(root, "unexpected-public-child.txt");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "logging.ts"), "export {};\n", "utf8");
    await writeJson(root, `data/content-calendar/${date}.json`, { date, slots: [] });
    await initAndCommit(root, ["src"]);
    const trustedNpm = await writeTrustedNpmShim();
    const trustedTsx = await writeTrustedTsxShim([
      'import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      `appendFileSync(${JSON.stringify(runtimeCalls)}, process.argv.slice(2).join(" ") + "\\n", "utf8");`,
      'if (process.argv.includes("src/logging.ts")) {',
      '  mkdirSync(join(process.cwd(), "src"), { recursive: true });',
      '  writeFileSync(join(process.cwd(), "src", "late-dirty.ts"), "export const dirty = true;\\n", "utf8");',
      '  console.log("CHILD_MUTATED_STDOUT");',
      '  console.log(JSON.stringify({ shouldRebuild: false }));',
      '} else {',
      `  writeFileSync(${JSON.stringify(publicMarker)}, process.argv.slice(2).join(" "), "utf8");`,
      '  process.exitCode = 92;',
      '}'
    ].join("\n"));

    const result = await runPowerShell([
      `$env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM = '${TEST_RUNTIME_SEAM}'`,
      `$env:LAUNDRY_TRUSTED_NPM_CMD = '${quote(trustedNpm)}'`,
      `$env:LAUNDRY_TRUSTED_TSX_ENTRY = '${quote(trustedTsx)}'`,
      "function global:Get-ScheduledTask { @() }",
      `& '${quote(join(project, "scripts", "daily-generate.ps1"))}' -Date '${date}' -RootOverride '${quote(root)}'`,
      "exit $LASTEXITCODE"
    ].join("; "));

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(result.stderr).toContain("BLOCKED production contract after calendar inspection");
    expect(await exists(join(root, "src", "late-dirty.ts"))).toBe(true);
    expect(await exists(publicMarker)).toBe(false);
    const calls = await readFile(runtimeCalls, "utf8");
    expect(calls).toContain("src/logging.ts --inspect-calendar");
    expect(calls).not.toMatch(/dayLock|generatePublicSite|publishPages|submitIndexNow|indexingPush/u);
    const logPath = join(root, "output", "daily-generate-logs", `${date}.log`);
    expect(await exists(logPath)).toBe(false);
  });

  it("does not convert a source-mutating image inventory child into image, log, or public-site evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "images-post-child-dirty-"));
    roots.push(root);
    const date = "2026-08-19";
    const runtimeCalls = join(root, "trusted-runtime-calls.log");
    const logPath = join(root, "output", "image-generation.log");
    const target = join(root, "docs", "assets", date, "slot-01.png");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "generateImage.ts"), "export {};\n", "utf8");
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { "generate-image-manifest": "tsx src/generateImage.ts" } }), "utf8");
    await writeJson(root, `data/image-prompts/${date}.json`, {
      items: [{ slot: 1, topic: "衣物送洗", target_path: `docs/assets/${date}/slot-01.png`, prompt: "a" }]
    });
    await mkdir(join(root, "output"), { recursive: true });
    await initAndCommit(root, ["src", "package.json"]);
    const trustedNpm = await writeTrustedNpmShim();
    const trustedTsx = await writeTrustedTsxShim([
      'import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      `appendFileSync(${JSON.stringify(runtimeCalls)}, process.argv.slice(2).join(" ") + "\\n", "utf8");`,
      'mkdirSync(join(process.cwd(), "src"), { recursive: true });',
      'writeFileSync(join(process.cwd(), "src", "late-dirty.ts"), "export const dirty = true;\\n", "utf8");',
      `console.log("Every image for ${date} was already present.");`
    ].join("\n"));

    const result = await runPowerShell([
      `$env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM = '${TEST_RUNTIME_SEAM}'`,
      `$env:LAUNDRY_TRUSTED_NPM_CMD = '${quote(trustedNpm)}'`,
      `$env:LAUNDRY_TRUSTED_TSX_ENTRY = '${quote(trustedTsx)}'`,
      `& '${quote(join(project, "scripts", "generate-missing-images.ps1"))}' -Date '${date}' -LogFile '${quote(logPath)}' -RootOverride '${quote(root)}'`,
      "exit $LASTEXITCODE"
    ].join("; "));

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(result.stderr).toContain("after image inventory");
    expect(await exists(join(root, "src", "late-dirty.ts"))).toBe(true);
    expect(await exists(target)).toBe(false);
    expect(await exists(logPath)).toBe(false);
    const calls = await readFile(runtimeCalls, "utf8");
    expect(calls).toContain("src/generateImage.ts --list-missing");
    expect(calls).not.toMatch(/markImageSource|generatePublicSite|validate-publishable/u);
  });
});
