import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const project = process.cwd();
const DATE = "2026-08-19";
const roots: string[] = [];
const SYSTEM_GIT = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "cmd", "git.exe");
const TEST_RUNTIME_SEAM = "allow-temp-production-runtime-shims-v1";

async function writeJson(root: string, relative: string, value: unknown): Promise<void> {
  const path = join(root, ...relative.split("/"));
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function transport(slot: number, platform: "facebook" | "instagram", overrides: Record<string, unknown> = {}) {
  return {
    date: DATE,
    slot,
    platform,
    status: "success",
    dry_run: false,
    post_id: `${platform}-${slot}`,
    attempts: 1,
    created_at: "2026-08-19T03:30:00.000Z",
    ...overrides
  };
}

async function seed(root: string, posted: unknown[], slots = [1, 2]): Promise<void> {
  await execFileAsync(SYSTEM_GIT, ["init", "--quiet"], { cwd: root });
  await writeJson(root, "package.json", {
    scripts: {
      "day-lock": "tsx src/dayLock.ts",
      "heal-reel-slot": "tsx src/scheduleReel.ts --heal",
      "auto-approve": "tsx src/autoApprove.ts",
      "post-current-slot": "tsx src/postCurrentSlot.ts",
      "first-comment": "tsx src/firstComment.ts",
      "share-story": "tsx src/postStory.ts",
      "local-reach": "tsx src/localReach.ts"
    }
  });
  await mkdir(join(root, "src"), { recursive: true });
  for (const source of [
    "dayLock.ts",
    "scheduleReel.ts",
    "autoApprove.ts",
    "postCurrentSlot.ts",
    "firstComment.ts",
    "postStory.ts",
    "localReach.ts"
  ]) {
    await writeFile(join(root, "src", source), "\n", "utf8");
  }
  await execFileAsync(SYSTEM_GIT, ["add", "--", "package.json", "src"], { cwd: root });
  await execFileAsync(
    SYSTEM_GIT,
    [
      "-c", "user.name=Catchup Fixture",
      "-c", "user.email=catchup-fixture@example.test",
      "commit", "--quiet", "-m", "fixture runtime contract"
    ],
    { cwd: root }
  );
  await writeJson(root, `data/content-calendar/${DATE}.json`, { slots: slots.map((slot) => ({ slot })) });
  await writeJson(root, `data/approved-log/${DATE}.json`, slots.map((slot) => ({ slot })));
  await writeJson(root, `data/posted-log/${DATE}.json`, posted);
  // Keep focused catch-up tests inside their posting/follow-up surface. The
  // indexing record means a passing canonical release verdict does not also
  // trigger an unrelated IndexNow fixture path.
  await writeJson(root, `output/operations/indexing-push-${DATE}.json`, { fixture: true });
}

async function readCalls(path: string): Promise<string[]> {
  try {
    return (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

async function runCatchup(
  root: string,
  options: {
    dayLockProof?: boolean;
    nowOverride?: string;
    mutateAfterFirstComment?: boolean;
    dirtyContractAfterDayLock?: boolean;
    canonicalApproval?: boolean;
    postCurrentSlotSucceeds?: boolean;
  } = {}
): Promise<{ code: number; calls: string[]; stdout: string; stderr: string }> {
  const callsPath = join(root, "trusted-runtime-calls.txt");
  const trustedRoot = await mkdtemp(join(tmpdir(), "trusted-catchup-runtime-"));
  roots.push(trustedRoot);
  const trustedNpm = join(trustedRoot, "npm.cmd");
  const trustedTsx = join(trustedRoot, "tsx.mjs");
  const quote = (value: string) => value.replace(/'/g, "''");
  const dayLockProof = options.dayLockProof ?? true;
  const canonicalApproval = options.canonicalApproval ?? true;
  const postCurrentSlotSucceeds = options.postCurrentSlotSucceeds ?? false;
  const nowOverride = options.nowOverride ?? "2026-08-19T12:30:00+08:00";
  const lockOutput = dayLockProof
    ? "DAY_LOCK_VERIFIED date=2026-08-19 action=locked calendar_checksum=0123456789abcdef lock_checksum=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    : "mock ok";
  const healOutput = dayLockProof
    ? "DAY_LOCK_HEAL_VERIFIED date=2026-08-19 action=intact calendar_checksum=0123456789abcdef lock_checksum=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    : "mock ok";
  const mutationPath = join(root, "mutation-after-first-comment.json");
  if (options.mutateAfterFirstComment) {
    await writeJson(root, "mutation-after-first-comment.json", [
      transport(1, "facebook", { post_id: " facebook-1 " }),
      transport(1, "instagram")
    ]);
  }
  await writeFile(trustedNpm, "@echo off\r\nexit /b 0\r\n", "utf8");
  await writeFile(trustedTsx, [
    "import { appendFileSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    `const callsPath = ${JSON.stringify(callsPath)};`,
    `const fixtureRoot = ${JSON.stringify(root)};`,
    `const mutationPath = ${JSON.stringify(options.mutateAfterFirstComment ? mutationPath : "")};`,
    `const mutateContractAfterLock = ${JSON.stringify(options.dirtyContractAfterDayLock === true)};`,
    `const canonicalApproval = ${JSON.stringify(canonicalApproval)};`,
    `const postCurrentSlotSucceeds = ${JSON.stringify(postCurrentSlotSucceeds)};`,
    `const lockOutput = ${JSON.stringify(lockOutput)};`,
    `const healOutput = ${JSON.stringify(healOutput)};`,
    "const args = process.argv.slice(2);",
    "const entry = args[0] ?? '';",
    "appendFileSync(callsPath, `${entry === '--eval' ? '--eval public-approval' : args.join(' ')}\\n`, 'utf8');",
    "if (entry === '--eval') {",
    "  console.log(JSON.stringify(canonicalApproval ? { ok: true, date: '2026-08-19', gaps: [] } : { ok: false, date: '2026-08-19', gaps: ['fixture has no canonical public approval'] }));",
    "} else if (entry === 'src/dayLock.ts') {",
    "  if (args.includes('--heal')) console.log(healOutput);",
    "  else {",
    "    if (mutateContractAfterLock) {",
    "      mkdirSync(join(fixtureRoot, 'src'), { recursive: true });",
    "      writeFileSync(join(fixtureRoot, 'src', 'contract-drift.ts'), 'export const drift = true;\\n', 'utf8');",
    "    }",
    "    console.log(lockOutput);",
    "  }",
    "} else if (entry === 'src/postCurrentSlot.ts') {",
    "  if (postCurrentSlotSucceeds) console.log('simulated post success');",
    "  else {",
    "    console.error('simulated post failure');",
    "    process.exitCode = 1;",
    "  }",
    "} else if (entry === 'src/firstComment.ts' && mutationPath) {",
    `  copyFileSync(mutationPath, ${JSON.stringify(join(root, "data", "posted-log", `${DATE}.json`))});`,
    "  console.log('mock ok');",
    "} else {",
    "  console.log('mock ok');",
    "}",
    ""
  ].join("\n"), "utf8");
  const command = [
    `$env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM = '${TEST_RUNTIME_SEAM}'`,
    `$env:LAUNDRY_TRUSTED_NPM_CMD = '${quote(trustedNpm)}'`,
    `$env:LAUNDRY_TRUSTED_TSX_ENTRY = '${quote(trustedTsx)}'`,
    "function global:Get-ScheduledTask { @() }",
    `& '${quote(join(project, "scripts", "catchup-publish.ps1"))}' -RootOverride '${quote(root)}' -NowOverride '${nowOverride}'`,
    "exit $LASTEXITCODE"
  ].join("; ");
  try {
    const { stdout, stderr } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      { cwd: project }
    );
    return { code: 0, calls: await readCalls(callsPath), stdout, stderr };
  } catch (error) {
    const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof failure.code === "number" ? failure.code : -1,
      calls: await readCalls(callsPath),
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message
    };
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("catch-up strict transport follow-up gate", () => {
  it("does not treat zero-exit day-lock or heal text as authorization without both verified proofs", async () => {
    const root = await mkdtemp(join(tmpdir(), "catchup-day-lock-proof-"));
    roots.push(root);
    await seed(root, [transport(1, "facebook"), transport(1, "instagram")]);

    const result = await runCatchup(root, { dayLockProof: false });

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(result.calls.some((call) => call.includes("src/autoApprove.ts"))).toBe(false);
    expect(result.calls.some((call) => call.includes("src/submitIndexNow.ts"))).toBe(false);
    expect(result.calls.some((call) => call.includes("src/indexingPush.ts"))).toBe(false);
    expect(result.calls.some((call) => call.includes("src/generatePublicSite.ts"))).toBe(false);
    expect(result.calls.some((call) => call.includes("src/publishPages.ts"))).toBe(false);
    expect(result.calls.some((call) => call.includes("src/postCurrentSlot.ts"))).toBe(false);
  });

  it("fails closed before day-lock heal when the executable contract changes mid-run", async () => {
    const root = await mkdtemp(join(tmpdir(), "catchup-contract-drift-"));
    roots.push(root);
    await seed(root, [transport(1, "facebook"), transport(1, "instagram")]);

    const result = await runCatchup(root, { dirtyContractAfterDayLock: true });

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(result.stderr).toContain("BLOCKED production contract before day-lock heal");
    expect(result.calls).toEqual([`src/dayLock.ts --date ${DATE}`]);
  });

  it("blocks an incomplete canonical approval before post, auto-approval, or later public/external paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "catchup-canonical-approval-block-"));
    roots.push(root);
    await seed(root, []);

    const result = await runCatchup(root, { canonicalApproval: false });

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(result.calls).toContain("--eval public-approval");
    for (const forbidden of [
      "src/autoApprove.ts",
      "src/submitIndexNow.ts",
      "src/indexingPush.ts",
      "src/generatePublicSite.ts",
      "src/publishPages.ts",
      "src/postCurrentSlot.ts",
      "src/firstComment.ts",
      "src/postStory.ts",
      "src/localReach.ts"
    ]) {
      expect(result.calls.some((call) => call.includes(forbidden)), result.calls.join("\n")).toBe(false);
    }
  });

  it("requires a passing canonical verdict immediately before a mocked due post", async () => {
    const root = await mkdtemp(join(tmpdir(), "catchup-canonical-approval-green-"));
    roots.push(root);
    await seed(root, []);

    const result = await runCatchup(root, { canonicalApproval: true, postCurrentSlotSucceeds: true });

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(0);
    const postIndex = result.calls.findIndex((call) => call.includes("src/postCurrentSlot.ts --slot 1"));
    const approvalIndexes = result.calls
      .map((call, index) => (call === "--eval public-approval" ? index : -1))
      .filter((index) => index >= 0);
    expect(postIndex, result.calls.join("\n")).toBeGreaterThan(-1);
    expect(approvalIndexes.some((index) => index < postIndex), result.calls.join("\n")).toBe(true);
    expect(result.calls.some((call) => call.includes("src/autoApprove.ts"))).toBe(false);
  });

  it("does not invoke first-comment or Story commands after a nonzero post with malformed transport evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "catchup-strict-bad-row-"));
    roots.push(root);
    const badFacebook = transport(1, "facebook");
    Reflect.deleteProperty(badFacebook, "dry_run");
    await seed(root, [badFacebook, transport(1, "instagram")]);

    const result = await runCatchup(root);

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(result.calls.some((call) => call.includes("src/postCurrentSlot.ts --slot 1")), result.calls.join("\n")).toBe(true);
    expect(result.calls.some((call) => call.includes("src/firstComment.ts"))).toBe(false);
    expect(result.calls.some((call) => call.includes("src/postStory.ts"))).toBe(false);
  });

  it("keeps a different fully qualified slot eligible while a bad tuple is blocked", async () => {
    const root = await mkdtemp(join(tmpdir(), "catchup-strict-independent-"));
    roots.push(root);
    const badFacebook = transport(1, "facebook");
    Reflect.deleteProperty(badFacebook, "dry_run");
    await seed(root, [
      badFacebook,
      transport(1, "instagram"),
      transport(2, "facebook"),
      transport(2, "instagram")
    ]);

    const result = await runCatchup(root);

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(result.calls.some((call) => call.includes(`src/firstComment.ts --date ${DATE} --slot 2`)), result.calls.join("\n")).toBe(true);
    expect(result.calls.some((call) => call.includes(`src/postStory.ts --date ${DATE} --slot 2`))).toBe(true);
    expect(result.calls.some((call) => call.includes("src/firstComment.ts") && call.includes("--slot 1"))).toBe(false);
    expect(result.calls.some((call) => call.includes("src/postStory.ts") && call.includes("--slot 1"))).toBe(false);
  });

  it.each([
    ["a missing dry_run boolean", () => {
      const facebook = transport(1, "facebook");
      Reflect.deleteProperty(facebook, "dry_run");
      return [facebook, transport(1, "instagram")];
    }],
    ["a cross-date success-looking row", () => [
      transport(1, "facebook", { date: "2026-08-18" }),
      transport(1, "instagram")
    ]],
    ["an untrimmed remote ID", () => [
      transport(1, "facebook", { post_id: " facebook-1 " }),
      transport(1, "instagram")
    ]],
    ["duplicate slot/platform candidates", () => [
      transport(1, "facebook"),
      transport(1, "facebook", { post_id: "facebook-1-duplicate" }),
      transport(1, "instagram")
    ]]
  ])("keeps stale slot 1 as an evidence-gap alert for %s", async (_label, badRows) => {
    const root = await mkdtemp(join(tmpdir(), "catchup-stale-gap-"));
    roots.push(root);
    await seed(root, [
      ...badRows(),
      transport(3, "facebook"),
      transport(3, "instagram")
    ], [1, 2, 3]);

    const result = await runCatchup(root, { nowOverride: "2026-08-19T17:00:00+08:00" });
    const log = await readFile(join(root, "output", "catch-up-logs", `${DATE}.log`), "utf8");

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(0);
    expect(result.calls.some((call) => call.includes("src/postCurrentSlot.ts"))).toBe(false);
    expect(log).toContain("Slot 1 stale transport evidence gap; treating it as unverified/unposted:");
  });

  it("suppresses a stale-slot alert only for strict same-date dual-platform transport", async () => {
    const root = await mkdtemp(join(tmpdir(), "catchup-stale-qualified-"));
    roots.push(root);
    await seed(root, [
      transport(1, "facebook"),
      transport(1, "instagram"),
      transport(3, "facebook"),
      transport(3, "instagram")
    ], [1, 2, 3]);

    const result = await runCatchup(root, { nowOverride: "2026-08-19T17:00:00+08:00" });
    const log = await readFile(join(root, "output", "catch-up-logs", `${DATE}.log`), "utf8");

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(0);
    expect(log).not.toContain("Slot 1 stale transport evidence gap");
  });

  it("rechecks strict transport evidence immediately before Story after first-comment", async () => {
    const root = await mkdtemp(join(tmpdir(), "catchup-followup-recheck-"));
    roots.push(root);
    await seed(root, [transport(1, "facebook"), transport(1, "instagram")]);

    const result = await runCatchup(root, { mutateAfterFirstComment: true });
    const log = await readFile(join(root, "output", "catch-up-logs", `${DATE}.log`), "utf8");

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(0);
    expect(result.calls.some((call) => call.includes(`src/firstComment.ts --date ${DATE} --slot 1`)), result.calls.join("\n")).toBe(true);
    expect(result.calls.some((call) => call.includes("src/postStory.ts"))).toBe(false);
    expect(log).toContain("Slot 1 transport evidence changed before share-story; blocking follow-up:");
  });
});
