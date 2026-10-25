import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const ROUND_DATE = "2026-10-28";

function powershellBin(): string {
  if (process.env.POWERSHELL_BIN) return process.env.POWERSHELL_BIN;
  if (process.platform === "win32") return "powershell.exe";
  const local = join(homedir(), ".local", "powershell", "pwsh");
  if (existsSync(local)) return local;
  return "pwsh";
}

function readLines(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

interface RoundResult {
  status: number | null;
  stdout: string;
  stderr: string;
  npmCalls: string[];
  docsWrites: number;
}

function runRound(kind: "images-only" | "images-ready" | "direct-site-fail", siteExit?: number): RoundResult {
  const root = mkdtempSync(join(tmpdir(), "one-docs-write-"));
  const scripts = join(root, "scripts");
  const docsLog = join(root, "docs-writes.log");
  const npmLog = join(root, "npm-calls.log");
  try {
    mkdirSync(join(root, "data", "image-prompts"), { recursive: true });
    mkdirSync(scripts, { recursive: true });
    writeFileSync(
      join(root, "data", "image-prompts", `${ROUND_DATE}.json`),
      JSON.stringify([
        { slot: 1, slide: 1, target_path: `docs/assets/${ROUND_DATE}/slot-01.png`, prompt: "a", topic: "towel" },
        { slot: 1, slide: 2, target_path: `docs/assets/${ROUND_DATE}/slot-01-b.png`, prompt: "b", topic: "towel" }
      ])
    );
    copyFileSync(join(ROOT, "scripts", "daily-generate.ps1"), join(scripts, "daily-generate.ps1"));
    copyFileSync(join(ROOT, "scripts", "generate-missing-images.ps1"), join(scripts, "generate-missing-images.ps1"));
    copyFileSync(join(ROOT, "test", "ps-one-docs-write.harness.ps1"), join(scripts, "round-harness.ps1"));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      APPDATA: root,
      USERPROFILE: root,
      ROUND_DATE,
      ROUND_KIND: kind,
      NPM_CALL_LOG: npmLog,
      DOCS_WRITE_LOG: docsLog
    };
    if (siteExit !== undefined) env.SITE_EXIT = String(siteExit);
    else delete env.SITE_EXIT;
    const result = spawnSync(
      powershellBin(),
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(scripts, "round-harness.ps1")],
      { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 30_000 }
    );
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: `${result.stderr ?? ""}${result.error ? `\n${String(result.error)}` : ""}`,
      npmCalls: readLines(npmLog),
      docsWrites: readLines(docsLog).length
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function detail(round: RoundResult): string {
  return [
    `status=${round.status}`,
    `docsWrites=${round.docsWrites}`,
    "NPM:",
    round.npmCalls.join("\n") || "(none)",
    "STDOUT:",
    round.stdout,
    "STDERR:",
    round.stderr
  ].join("\n");
}

describe("daily generate writes docs once per round", () => {
  it("images-only round writes docs once, and that write is the publish chain", () => {
    const round = runRound("images-only");
    const info = detail(round);
    const siteCalls = round.npmCalls.filter((call) => call.includes("generate-public-site"));
    const siteAt = round.npmCalls.findIndex((call) => call.includes("generate-public-site"));
    const lockAt = round.npmCalls.findIndex((call) => call.includes("day-lock"));
    expect(round.status, info).toBe(0);
    expect(round.docsWrites, info).toBe(1);
    expect(siteCalls, info).toHaveLength(1);
    expect(lockAt, info).toBeGreaterThanOrEqual(0);
    expect(siteAt, info).toBeGreaterThan(lockAt);
    expect(round.npmCalls.some((call) => call.includes("publish-pages")), info).toBe(true);
    expect(round.npmCalls.some((call) => call.includes("indexing-push")), info).toBe(true);
  });

  it("images-ready round still writes docs once", () => {
    const round = runRound("images-ready");
    const info = detail(round);
    expect(round.status, info).toBe(0);
    expect(round.docsWrites, info).toBe(1);
    expect(round.npmCalls.filter((call) => call.includes("generate-public-site")), info).toHaveLength(1);
    expect(round.npmCalls.some((call) => call.includes("publish-pages")), info).toBe(true);
  });

  it("a failed generate-public-site inside image backfill is not swallowed", () => {
    const round = runRound("direct-site-fail", 7);
    const info = detail(round);
    expect(round.status, info).toBe(7);
    expect(round.docsWrites, info).toBe(1);
    expect(round.npmCalls.some((call) => call.includes("validate-publishable-images")), info).toBe(false);
  });

  it("the Codex prompt for this round does not ask for another public site", () => {
    const daily = readFileSync(join(ROOT, "scripts", "daily-generate.ps1"), "utf8");
    const skill = readFileSync(join(ROOT, ".agents", "skills", "daily-automation", "SKILL.md"), "utf8");
    const promptAt = daily.indexOf("$prompt = @\"");
    const promptEnd = daily.indexOf("\"@", promptAt);
    expect(promptAt, daily).toBeGreaterThan(-1);
    expect(promptEnd, daily).toBeGreaterThan(promptAt);
    const prompt = daily.slice(promptAt, promptEnd);
    expect(prompt).not.toContain("refresh the public site");
    expect(prompt).toContain("Do not run npm run generate-public-site");
    expect(skill).not.toContain("8. Run `npm run generate-public-site`");
    expect(skill).toContain("Do not run `npm run generate-public-site`");
    expect(daily.match(/npm\.cmd run generate-public-site/g)).toEqual(["npm.cmd run generate-public-site"]);
  });
});
