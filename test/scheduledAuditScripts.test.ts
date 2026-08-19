import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { writeDailyContent } from "../src/logging";
import type { DailySlot } from "../src/types";

const execFileAsync = promisify(execFile);
const project = process.cwd();
const roots: string[] = [];
const BUSINESS_YOUTUBE_CHANNEL_ID = "UCcVDFN7Ve-cD9duxRdM5VXQ";
const SYSTEM_GIT = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "cmd", "git.exe");
const TEST_NPM_SEAM = "allow-temp-npm-shim-v1";
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

async function writeJson(root: string, relativePath: string, value: unknown): Promise<void> {
  const path = join(root, ...relativePath.split("/"));
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeCleanGit(root: string): Promise<void> {
  await execFileAsync(SYSTEM_GIT, ["init", "--quiet"], { cwd: root });
}

async function commitProductionContractFixture(root: string, paths: string[]): Promise<void> {
  await execFileAsync(SYSTEM_GIT, ["add", "--", ...paths], { cwd: root });
  await execFileAsync(
    SYSTEM_GIT,
    ["-c", "user.name=Scheduled Fixture", "-c", "user.email=scheduled-fixture@example.test", "commit", "--quiet", "-m", "fixture contract"],
    { cwd: root }
  );
}

async function writeTrustedNpmShim(contents = "@echo off\r\nexit /b 0\r\n"): Promise<string> {
  const trustedRoot = await mkdtemp(join(tmpdir(), "trusted-laundry-npm-"));
  roots.push(trustedRoot);
  const executable = join(trustedRoot, "npm.cmd");
  await writeFile(executable, contents, "utf8");
  return executable;
}

async function writeTrustedCodexShim(contents = "@echo off\r\nexit /b 0\r\n"): Promise<string> {
  const trustedRoot = await mkdtemp(join(tmpdir(), "trusted-laundry-codex-"));
  roots.push(trustedRoot);
  const executable = join(trustedRoot, "codex.cmd");
  await writeFile(executable, contents, "utf8");
  return executable;
}

async function writeTrustedTsxShim(source?: string): Promise<string> {
  const trustedRoot = await mkdtemp(join(tmpdir(), "trusted-laundry-tsx-"));
  roots.push(trustedRoot);
  const executable = join(trustedRoot, "tsx.mjs");
  // The contract accepts this only under the temp-only test seam. It delegates
  // to the test checkout's installed TSX so fixtures still exercise the real
  // canonical bridge without ever teaching production to trust node_modules.
  const projectTsx = pathToFileURL(join(project, "node_modules", "tsx", "dist", "cli.mjs")).href;
  const entry = source ?? `process.chdir(${JSON.stringify(project)});\nawait import(${JSON.stringify(projectTsx)});\n`;
  await writeFile(executable, entry, "utf8");
  return executable;
}

async function writeMissingTrustedTsxShim(): Promise<string> {
  const trustedRoot = await mkdtemp(join(tmpdir(), "trusted-laundry-tsx-missing-"));
  roots.push(trustedRoot);
  // The temporary-production seam accepts this *only if the file exists*.
  // Returning the absent canonical leaf makes the trusted inspector
  // unavailable without falling back to a workspace loader.
  return join(trustedRoot, "tsx.mjs");
}

async function seedCanonicalPublicApproval(root: string, date = "2026-08-19"): Promise<DailySlot[]> {
  const slots = [1, 2].map((slot) => ({
    ...imageSlot(slot),
    local_image_path: `docs/assets/${date}/slot-${String(slot).padStart(2, "0")}.png`,
    public_image_url: `https://example.com/assets/${date}/slot-${String(slot).padStart(2, "0")}.png`
  }));
  const digests: Record<string, Record<string, string>> = {};
  for (const slot of slots) {
    const bytes = Buffer.from(`approved-image-${date}-${slot.slot}`, "utf8");
    const imagePath = join(root, ...slot.local_image_path.split("/"));
    await mkdir(join(imagePath, ".."), { recursive: true });
    await writeFile(imagePath, bytes);
    digests[String(slot.slot)] = {
      [slot.local_image_path]: createHash("sha256").update(bytes).digest("hex")
    };
  }
  await writeDailyContent(
    {
      date,
      timezone: "Asia/Taipei",
      generated_at: "2026-08-19T00:00:00.000Z",
      slots
    },
    root
  );
  await writeJson(
    root,
    `data/approved-log/${date}.json`,
    slots.flatMap((slot) => ["facebook", "instagram"].map((platform) => ({
      date,
      slot: slot.slot,
      platform,
      status: "approved",
      approved_by: "reviewer",
      created_at: "2026-08-19T01:00:00.000Z"
    })))
  );
  await writeJson(
    root,
    `data/approved-log/${date}.fingerprints.json`,
    Object.fromEntries(slots.map((slot) => [String(slot.slot), createHash("sha256").update(JSON.stringify(slot)).digest("hex")]))
  );
  await writeJson(root, `data/approved-log/${date}.image-digests.json`, digests);
  await writeCleanGit(root);
  return slots;
}

async function runPublicApprovalProbe(root: string, date = "2026-08-19"): Promise<{ ok: boolean; gaps: string[] }> {
  const quote = (value: string) => value.replace(/'/g, "''");
  const trustedTsx = await writeTrustedTsxShim();
  const command = [
    `$env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM = '${TEST_RUNTIME_SEAM}'`,
    `$env:LAUNDRY_TRUSTED_TSX_ENTRY = '${quote(trustedTsx)}'`,
    `. '${quote(join(project, "scripts", "_production-contract.ps1"))}'`,
    `$result = Test-PublicPublicationApproval -Root '${quote(root)}' -Date '${date}'`,
    "Write-Output ('PUBLIC_APPROVAL=' + ($result | ConvertTo-Json -Compress))"
  ].join("; ");
  const { stdout, stderr } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd: project });
  const line = stdout.split(/\r?\n/).find((value) => value.startsWith("PUBLIC_APPROVAL="));
  if (!line) throw new Error(`public-approval probe returned no verdict: ${stderr}\n${stdout}`);
  return JSON.parse(line.slice("PUBLIC_APPROVAL=".length)) as { ok: boolean; gaps: string[] };
}

function imageSlot(slot: number): DailySlot {
  return {
    slot,
    time: slot === 1 ? "11:30" : "20:30",
    category: "知識文",
    topic: `明日圖文 ${slot}`,
    media_type: "image",
    instagram_caption: "caption",
    facebook_caption: "caption",
    image_prompt: "image",
    local_image_path: `docs/assets/slot-${slot}.png`,
    public_image_url: `https://example.com/slot-${slot}.png`,
    visual_route: "shop-inspection",
    traffic_route: "object-proof",
    status: "pending"
  };
}

function plannedReelSlot(): DailySlot {
  return {
    ...imageSlot(3),
    time: "12:00",
    media_type: "reel",
    local_video_path: "docs/assets/tomorrow-reel.mp4",
    public_video_url: "https://example.com/tomorrow-reel.mp4",
    video_prompt: "one verified action"
  };
}

function qualifiedReelPost(
  platform: "facebook" | "instagram",
  date: string,
  slot: number,
  videoSha256: string
) {
  const postId = `${platform}-${date}-slot-${slot}`;
  return {
    date,
    slot,
    platform,
    status: "success",
    dry_run: false,
    attempts: 1,
    published_media_type: "reel",
    video_status: "published",
    video_sha256: videoSha256,
    post_id: postId,
    remote_reel_evidence: {
      remote_id: postId,
      permalink:
        platform === "instagram"
          ? `https://www.instagram.com/reel/${postId}/`
          : `https://www.facebook.com/reel/${postId}/`,
      verified_at: "2026-08-18T12:00:00.000Z",
      remote_media_type: "REELS",
      caption_exact_match: true
    },
    created_at: "2026-08-18T12:00:00.000Z"
  };
}

async function replaceSlotTwoPosts(root: string, slotTwoRows: unknown[]): Promise<void> {
  const date = "2026-08-18";
  const path = join(root, "data", "posted-log", `${date}.json`);
  const existing = JSON.parse(await readFile(path, "utf8")) as Array<{ slot?: unknown }>;
  await writeJson(root, `data/posted-log/${date}.json`, [...existing.filter((row) => row.slot !== 2), ...slotTwoRows]);
}

/**
 * A YouTube ledger row is not proof by itself.  This fixture writes the same
 * immutable source claim and completed read-back evidence required in
 * production, bound to the exact local MP4 and IG Reel identity.
 */
async function writeVerifiedYouTubeCompletion(root: string, date: string, videoId = "youtube-2") {
  const slot = 2;
  const localVideoPath = `docs/assets/${date}/slot-02.mp4`;
  const videoBytes = Buffer.from(`verified-short-${date}-slot-${slot}`, "utf8");
  const videoSha256 = createHash("sha256").update(videoBytes).digest("hex");
  const instagramPostId = `instagram-${date}-slot-${slot}`;
  const claimId = `claim-${date}-slot-${slot}`;

  const absoluteVideoPath = join(root, ...localVideoPath.split("/"));
  await mkdir(join(absoluteVideoPath, ".."), { recursive: true });
  await writeFile(absoluteVideoPath, videoBytes);
  await writeDailyContent(
    {
      date,
      timezone: "Asia/Taipei",
      generated_at: "2026-08-18T06:00:00.000Z",
      slots: [
        imageSlot(1),
        {
          ...imageSlot(slot),
          media_type: "reel",
          local_video_path: localVideoPath,
          public_video_url: `https://example.com/assets/${date}/slot-02.mp4`,
          video_prompt: "one verified action"
        }
      ]
    },
    root
  );
  await writeJson(root, `data/youtube-upload-claims/${date}/slot-02.json`, {
    version: 1,
    date,
    slot,
    claim_id: claimId,
    claimed_at: "2026-08-18T12:00:00.000Z",
    source: {
      local_video_path: localVideoPath,
      local_video_sha256: videoSha256,
      instagram_video_sha256: videoSha256,
      instagram_post_id: instagramPostId
    },
    channel: {
      expected_channel_id: BUSINESS_YOUTUBE_CHANNEL_ID,
      authorized_channel_id: BUSINESS_YOUTUBE_CHANNEL_ID
    }
  });
  await writeJson(root, `data/youtube-upload-evidence/${date}/slot-02.json`, {
    version: 1,
    date,
    slot,
    claim_id: claimId,
    state: "completed",
    recorded_at: "2026-08-18T15:00:00.000Z",
    remote_video_id: videoId,
    read_back_verified: true,
    channel: {
      expected_channel_id: BUSINESS_YOUTUBE_CHANNEL_ID,
      authorized_channel_id: BUSINESS_YOUTUBE_CHANNEL_ID
    }
  });
  return { instagramPostId, videoSha256 };
}

async function fixture(
  reel: boolean,
  youtubeLog: unknown = [],
  postedDate = "2026-08-18",
  tomorrowReel = false,
  plannedCurrentReel = false
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "scheduled-audit-"));
  roots.push(root);
  const date = "2026-08-18";
  await writeJson(root, "data/business-profile.json", {
    youtube_url: `https://www.youtube.com/channel/${BUSINESS_YOUTUBE_CHANNEL_ID}`
  });
  await writeJson(root, `data/content-calendar/${date}.json`, {
    slots: [{ slot: 1 }, { slot: 2, ...(plannedCurrentReel ? { media_type: "reel" } : {}) }]
  });
  await writeDailyContent(
    {
      date: "2026-08-19",
      timezone: "Asia/Taipei",
      generated_at: "2026-08-18T06:00:00.000Z",
      slots: tomorrowReel ? [imageSlot(1), imageSlot(2), plannedReelSlot()] : [imageSlot(1), imageSlot(2)]
    },
    root
  );
  await writeJson(root, `data/approved-log/${date}.json`, []);
  await writeJson(root, `data/first-comments/${date}.json`, [
    { date, slot: 1, media_id: `instagram-${postedDate}-slot-1`, comment_id: "comment-1" },
    { date, slot: 2, media_id: `instagram-${postedDate}-slot-2`, comment_id: "comment-2" }
  ]);
  await writeJson(root, `data/youtube-log/${date}.json`, youtubeLog);
  const mediaType = reel ? "reel" : "image";
  const videoStatus = reel ? "published" : "VIDEO_DEFERRED";
  await writeJson(
    root,
    `data/posted-log/${date}.json`,
    [1, 2].flatMap((slot) =>
      ["facebook", "instagram"].map((platform) => ({
        date: postedDate,
        slot,
        platform,
        status: "success",
        dry_run: false,
        attempts: 1,
        published_media_type: slot === 2 ? mediaType : "image",
        video_status: slot === 2 ? videoStatus : "not_planned",
        post_id: `${platform}-${postedDate}-slot-${slot}`,
        ...(slot === 2 && reel && platform === "instagram"
          ? {
              video_sha256: "a".repeat(64),
              remote_reel_evidence: {
                remote_id: `instagram-${postedDate}-slot-2`,
                permalink: `https://www.instagram.com/reel/${postedDate}-slot-2/`,
                verified_at: "2026-08-18T12:00:00.000Z",
                remote_media_type: "REELS",
                caption_exact_match: true
              }
            }
          : {}),
        created_at: "2026-08-18T12:00:00.000Z"
      }))
    )
  );
  await writeCleanGit(root);
  return root;
}

async function runObserve(
  script: string,
  root: string,
  nowOverride = "2026-08-18T22:50:00+08:00",
  options: { trustedTsx?: string } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  const quote = (value: string) => value.replace(/'/g, "''");
  const marker = join(root, "scheduled-task-called.txt");
  const trustedNpm = await writeTrustedNpmShim();
  const trustedTsx = options.trustedTsx ?? await writeTrustedTsxShim();
  const command = [
    `$global:observeScheduleMarker = '${quote(marker)}'`,
    `$env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM = '${TEST_RUNTIME_SEAM}'`,
    `$env:LAUNDRY_TRUSTED_NPM_CMD = '${quote(trustedNpm)}'`,
    `$env:LAUNDRY_TRUSTED_TSX_ENTRY = '${quote(trustedTsx)}'`,
    "function global:Get-ScheduledTask { [CmdletBinding()] param() @() }",
    "function global:Start-ScheduledTask { [CmdletBinding()] param([string]$TaskName) [IO.File]::WriteAllText($global:observeScheduleMarker, $TaskName) }",
    `& '${quote(join(project, "scripts", script))}' -RootOverride '${quote(root)}' -NowOverride '${quote(nowOverride)}' -ObserveOnly`,
    "exit $LASTEXITCODE"
  ].join("; ");
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    command
  ];
  try {
    const { stdout, stderr } = await execFileAsync("powershell.exe", args, { cwd: project });
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

async function runNormal(
  script: string,
  root: string,
  trustedNpmContents?: string,
  options: { trustedTsxSource?: string } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  const quote = (value: string) => value.replace(/'/g, "''");
  const trustedNpm = await writeTrustedNpmShim(trustedNpmContents);
  const trustedTsx = await writeTrustedTsxShim(options.trustedTsxSource);
  const command = [
    `$env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM = '${TEST_RUNTIME_SEAM}'`,
    `$env:LAUNDRY_TRUSTED_NPM_CMD = '${quote(trustedNpm)}'`,
    `$env:LAUNDRY_TRUSTED_TSX_ENTRY = '${quote(trustedTsx)}'`,
    // Keep normal-script fixtures hermetic: never consult the host's live
    // scheduler state while exercising a script's own local behavior.
    "function global:Get-ScheduledTask { [CmdletBinding()] param() @() }",
    `& '${quote(join(project, "scripts", script))}' -RootOverride '${quote(root)}' -NowOverride '2026-08-18T22:50:00+08:00'`,
    "exit $LASTEXITCODE"
  ].join("; ");
  try {
    const { stdout, stderr } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command
    ], { cwd: project });
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

async function runDailyGenerate(root: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const quote = (value: string) => value.replace(/'/g, "''");
  const taskEnableMarker = join(root, "scheduled-task-enabled.txt");
  const appData = join(root, "appdata");
  const trustedNpm = await writeTrustedNpmShim();
  const trustedCodex = await writeTrustedCodexShim();
  const trustedTsx = await writeTrustedTsxShim();
  const command = [
    // Always present a disabled Laundry task. It is an operator kill switch,
    // so the script must report and stop without invoking this mutation shim.
    `$global:dailyGenerateTaskEnableMarker = '${quote(taskEnableMarker)}'`,
    `$env:APPDATA = '${quote(appData)}'`,
    `$env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM = '${TEST_RUNTIME_SEAM}'`,
    `$env:LAUNDRY_TRUSTED_NPM_CMD = '${quote(trustedNpm)}'`,
    `$env:LAUNDRY_TRUSTED_CODEX_CMD = '${quote(trustedCodex)}'`,
    `$env:LAUNDRY_TRUSTED_TSX_ENTRY = '${quote(trustedTsx)}'`,
    "function global:Get-ScheduledTask { [CmdletBinding()] param() @([pscustomobject]@{ TaskName = 'Laundry-CatchUp-Publish'; State = 'Disabled' }) }",
    "function global:Enable-ScheduledTask { [CmdletBinding()] param([string]$TaskName) [IO.File]::AppendAllText($global:dailyGenerateTaskEnableMarker, $TaskName + [Environment]::NewLine) }",
    "function global:Unregister-ScheduledTask { [CmdletBinding()] param([string]$TaskName) [IO.File]::AppendAllText($global:dailyGenerateTaskEnableMarker, 'unregister:' + $TaskName + [Environment]::NewLine) }",
    "function global:Register-ScheduledTask { [CmdletBinding()] param([string]$TaskName) [IO.File]::AppendAllText($global:dailyGenerateTaskEnableMarker, 'register:' + $TaskName + [Environment]::NewLine) }",
    "function global:Start-ScheduledTask { [CmdletBinding()] param([string]$TaskName) [IO.File]::AppendAllText($global:dailyGenerateTaskEnableMarker, 'start:' + $TaskName + [Environment]::NewLine) }",
    `& '${quote(join(project, "scripts", "daily-generate.ps1"))}' -Date '2026-08-19' -RootOverride '${quote(root)}'`,
    "exit $LASTEXITCODE"
  ].join("; ");
  try {
    const { stdout, stderr } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command
    ], { cwd: project });
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

type ContractMode = "src" | "package" | "package-lock" | "unverifiable" | "runtime-shadow" | "media-shadow";

async function runContractBlockedEffector(
  script: string,
  root: string,
  mode: ContractMode
): Promise<{ code: number; stdout: string; stderr: string; taskMarker: string; npmMarker: string }> {
  const quote = (value: string) => value.replace(/'/g, "''");
  const taskMarker = join(root, "scheduled-side-effect.txt");
  const npmMarker = join(root, "npm-side-effect.txt");
  const trustedNpm = await writeTrustedNpmShim([
    "@echo off",
    `> "${npmMarker}" echo unexpected-npm`,
    "exit /b 0",
    ""
  ].join("\r\n"));
  const trustedTsx = await writeTrustedTsxShim();
  if (mode !== "unverifiable") {
    await writeCleanGit(root);
    if (mode === "runtime-shadow") {
      await writeFile(join(root, "node.exe"), [
        "@echo off",
        `> \"${npmMarker}\" echo forged-node-runtime`,
        "exit /b 0",
        ""
      ].join("\r\n"), "utf8");
    } else if (mode === "media-shadow") {
      await writeFile(join(root, "ffmpeg.exe"), [
        "@echo off",
        `> \"${npmMarker}\" echo forged-media-runtime`,
        "exit /b 0",
        ""
      ].join("\r\n"), "utf8");
    } else {
      const dirtyPath = mode === "src" ? "src/dirty-production.ts" : mode === "package" ? "package.json" : "package-lock.json";
      await writeJson(root, dirtyPath, { dirty: true });
    }
  }
  const invocation = script === "daily-generate.ps1" || script === "generate-missing-images.ps1"
    ? "-Date '2026-08-19'"
    : script === "regenerate-boutique-images.ps1" || script === "register-catchup-task.ps1"
      ? ""
      : "-NowOverride '2026-08-19T12:30:00+08:00'";
  const command = [
    `$global:contractTaskMarker = '${quote(taskMarker)}'`,
    `$env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM = '${TEST_RUNTIME_SEAM}'`,
    `$env:LAUNDRY_TRUSTED_NPM_CMD = '${quote(trustedNpm)}'`,
    `$env:LAUNDRY_TRUSTED_TSX_ENTRY = '${quote(trustedTsx)}'`,
    "function global:Get-ScheduledTask { [CmdletBinding()] param() [IO.File]::AppendAllText($global:contractTaskMarker, 'enumerate' + [Environment]::NewLine); @([pscustomobject]@{ TaskName = 'Laundry-CatchUp-Publish'; State = 'Disabled' }) }",
    "function global:Enable-ScheduledTask { [CmdletBinding()] param([string]$TaskName) [IO.File]::AppendAllText($global:contractTaskMarker, 'enable:' + $TaskName + [Environment]::NewLine) }",
    "function global:Start-ScheduledTask { [CmdletBinding()] param([string]$TaskName) [IO.File]::AppendAllText($global:contractTaskMarker, 'start:' + $TaskName + [Environment]::NewLine) }",
    "function global:Unregister-ScheduledTask { [CmdletBinding()] param([string]$TaskName) [IO.File]::AppendAllText($global:contractTaskMarker, 'unregister:' + $TaskName + [Environment]::NewLine) }",
    "function global:Register-ScheduledTask { [CmdletBinding()] param([string]$TaskName) [IO.File]::AppendAllText($global:contractTaskMarker, 'register:' + $TaskName + [Environment]::NewLine) }",
    "function global:schtasks { [CmdletBinding()] param([Parameter(ValueFromRemainingArguments = $true)]$Arguments) [IO.File]::AppendAllText($global:contractTaskMarker, 'schtasks:' + ($Arguments -join ' ') + [Environment]::NewLine) }",
    `& '${quote(join(project, "scripts", script))}' -RootOverride '${quote(root)}' ${invocation}`,
    "exit $LASTEXITCODE"
  ].join("; ");
  try {
    const { stdout, stderr } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command
    ], { cwd: project });
    return { code: 0, stdout, stderr, taskMarker, npmMarker };
  } catch (error) {
    const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof failure.code === "number" ? failure.code : -1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message,
      taskMarker,
      npmMarker
    };
  }
}

describe("scheduled audit scripts in observe-only mode", () => {
  it("does not call an image fallback in slot 2 a Reel or start a YouTube rescue", async () => {
    const root = await fixture(false);
    const result = await runObserve("watchdog-patrol.ps1", root);

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(0);
    expect(result.stdout).not.toContain("starting YouTube upload");
    expect(await exists(join(root, "output"))).toBe(false);
    expect(await exists(join(root, "scheduled-task-called.txt"))).toBe(false);
  });

  it("reports legacy Laundry-Publish-Sentinel in patrol mode without any scheduler mutation", async () => {
    const root = await fixture(false);
    const marker = join(root, "unexpected-scheduler-mutation.txt");
    const quote = (value: string) => value.replace(/'/g, "''");
    const trustedNpm = await writeTrustedNpmShim();
    const trustedTsx = await writeTrustedTsxShim();
    const command = [
      `$global:patrolLegacyMarker = '${quote(marker)}'`,
      `$env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM = '${TEST_RUNTIME_SEAM}'`,
      `$env:LAUNDRY_TRUSTED_NPM_CMD = '${quote(trustedNpm)}'`,
      `$env:LAUNDRY_TRUSTED_TSX_ENTRY = '${quote(trustedTsx)}'`,
      "function global:Get-ScheduledTask { [CmdletBinding()] param() [pscustomobject]@{ TaskName = 'Laundry-Publish-Sentinel'; State = 'Ready' } }",
      "function global:Enable-ScheduledTask { [IO.File]::AppendAllText($global:patrolLegacyMarker, 'enable' + [Environment]::NewLine) }",
      "function global:Unregister-ScheduledTask { [IO.File]::AppendAllText($global:patrolLegacyMarker, 'unregister' + [Environment]::NewLine) }",
      "function global:Register-ScheduledTask { [IO.File]::AppendAllText($global:patrolLegacyMarker, 'register' + [Environment]::NewLine) }",
      "function global:Start-ScheduledTask { [IO.File]::AppendAllText($global:patrolLegacyMarker, 'start' + [Environment]::NewLine) }",
      `& '${quote(join(project, "scripts", "watchdog-patrol.ps1"))}' -RootOverride '${quote(root)}' -NowOverride '2026-08-18T22:50:00+08:00' -ObserveOnly`,
      "exit $LASTEXITCODE"
    ].join("; ");
    let result: { code: number; stdout: string; stderr: string };
    try {
      const { stdout, stderr } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd: project });
      result = { code: 0, stdout, stderr };
    } catch (error) {
      const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
      result = {
        code: typeof failure.code === "number" ? failure.code : -1,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? failure.message
      };
    }

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(`${result.stderr}\n${result.stdout}`).toContain("legacy Laundry-Publish-Sentinel is present");
    expect(await exists(marker)).toBe(false);
  });

  it("reports an image fallback as no Reel gap and leaves the observed day green", async () => {
    const root = await fixture(false);
    const result = await runObserve("day-audit.ps1", root);

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(0);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      youtube: { expected_reel_slots: number[]; missing_reel_slots: number[] };
    };
    expect(report.ok).toBe(true);
    expect(report.youtube).toMatchObject({ expected_reel_slots: [], missing_reel_slots: [] });
    expect(await exists(join(root, "output"))).toBe(false);
    expect(await exists(join(root, "scheduled-task-called.txt"))).toBe(false);
  }, 30_000);

  it("treats live-looking rows without boolean dry_run or remote identity as a red data gap, not catch-up authority", async () => {
    const root = await fixture(false);
    const path = join(root, "data", "posted-log", "2026-08-18.json");
    const posted = JSON.parse(await readFile(path, "utf8")) as Array<Record<string, unknown>>;
    const facebook = posted.find((entry) => entry.slot === 2 && entry.platform === "facebook");
    const instagram = posted.find((entry) => entry.slot === 2 && entry.platform === "instagram");
    if (!facebook || !instagram) throw new Error("fixture must contain slot 2 FB/IG success rows");
    Reflect.deleteProperty(facebook, "dry_run");
    Reflect.deleteProperty(instagram, "post_id");
    await writeJson(root, "data/posted-log/2026-08-18.json", posted);

    const patrol = await runObserve("watchdog-patrol.ps1", root);
    expect(patrol.code, `${patrol.stderr}\n${patrol.stdout}`).toBe(1);
    expect(patrol.stdout).toContain("transport evidence data gap for slot(s) 2");
    expect(patrol.stdout).not.toContain("starting catch-up");
    expect(await exists(join(root, "scheduled-task-called.txt"))).toBe(false);
    expect(await exists(join(root, "output"))).toBe(false);

    const audit = await runObserve("day-audit.ps1", root);
    expect(audit.code, `${audit.stderr}\n${audit.stdout}`).toBe(1);
    const report = JSON.parse(audit.stdout) as {
      ok: boolean;
      missing_posts: number[];
      transport_evidence: {
        data_gap_slots: number[];
        gaps: Array<{ platform: string; reasons: string[] }>;
      };
    };
    expect(report.ok).toBe(false);
    expect(report.missing_posts).toEqual([2]);
    expect(report.transport_evidence.data_gap_slots).toEqual([2]);
    expect(report.transport_evidence.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ platform: "facebook", reasons: expect.arrayContaining(["dry_run is not boolean false"]) }),
      expect.objectContaining({ platform: "instagram", reasons: expect.arrayContaining(["post_id is missing or not trimmed"]) })
    ]));
    expect(await exists(join(root, "scheduled-task-called.txt"))).toBe(false);
    expect(await exists(join(root, "output"))).toBe(false);
  }, 30_000);

  it("keeps a calendar-declared image fallback red even when it carries an A/B label", async () => {
    const root = await fixture(false, [], "2026-08-18", false, true);
    const path = join(root, "data", "posted-log", "2026-08-18.json");
    const posted = JSON.parse(await readFile(path, "utf8")) as Array<Record<string, unknown>>;
    posted.filter((entry) => entry.slot === 2).forEach((entry) => {
      entry.ab_variant = "15s";
    });
    await writeJson(root, "data/posted-log/2026-08-18.json", posted);

    const result = await runObserve("day-audit.ps1", root);

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      planned_reels: {
        required_slots: number[];
        delivered_slots: number[];
        missing_planned_reels: number[];
        evidence_gaps: Array<{ slot: number; reasons: string[] }>;
      };
      youtube: { expected_reel_slots: number[]; missing_reel_slots: number[] };
    };
    expect(report.ok).toBe(false);
    expect(report.planned_reels).toMatchObject({
      required_slots: [2],
      delivered_slots: [],
      missing_planned_reels: [2]
    });
    expect(report.planned_reels.evidence_gaps[0]?.reasons.join(" ")).toContain("published media is not reel");
    // An image fallback produces no YouTube source candidate; that empty list
    // must not override the calendar's explicit Reel obligation.
    expect(report.youtube).toMatchObject({ expected_reel_slots: [], missing_reel_slots: [] });
    expect(await exists(join(root, "output"))).toBe(false);
    expect(await exists(join(root, "scheduled-task-called.txt"))).toBe(false);
  });

  it("keeps a planned Reel red when only Instagram has qualified remote evidence", async () => {
    const date = "2026-08-18";
    const root = await fixture(
      false,
      [{ date, slot: 2, video_id: "youtube-2", title: "slot 2", uploaded_at: "2026-08-18T15:00:00.000Z" }],
      date,
      false,
      true
    );
    const proof = await writeVerifiedYouTubeCompletion(root, date);
    await replaceSlotTwoPosts(root, [qualifiedReelPost("instagram", date, 2, proof.videoSha256), {
      date,
      slot: 2,
      platform: "facebook",
      status: "success",
      dry_run: false,
      attempts: 1,
      published_media_type: "image",
      video_status: "not_planned",
      post_id: `facebook-${date}-slot-2`,
      created_at: "2026-08-18T12:00:00.000Z"
    }]);

    const result = await runObserve("day-audit.ps1", root);

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      planned_reels: { missing_planned_reels: number[]; evidence_gaps: Array<{ reasons: string[] }> };
      youtube: { expected_reel_slots: number[]; uploaded_reel_slots: number[]; missing_reel_slots: number[] };
    };
    expect(report.ok).toBe(false);
    expect(report.planned_reels.missing_planned_reels).toEqual([2]);
    expect(report.planned_reels.evidence_gaps[0]?.reasons.join(" ")).toContain("facebook:");
    // YouTube can be fully reconciled from the qualified IG row, but cannot
    // make a one-platform Reel fulfil the calendar's dual-delivery contract.
    expect(report.youtube).toMatchObject({ expected_reel_slots: [2], uploaded_reel_slots: [2], missing_reel_slots: [] });
    expect(await exists(join(root, "output"))).toBe(false);
    expect(await exists(join(root, "scheduled-task-called.txt"))).toBe(false);
  });

  it.each([
    ["missing SHA-256", (facebook: ReturnType<typeof qualifiedReelPost>, instagram: ReturnType<typeof qualifiedReelPost>) => {
      facebook.video_sha256 = "not-a-sha";
    }],
    ["mismatched SHA-256", (facebook: ReturnType<typeof qualifiedReelPost>, instagram: ReturnType<typeof qualifiedReelPost>) => {
      facebook.video_sha256 = "b".repeat(64);
    }],
    ["missing remote evidence", (facebook: ReturnType<typeof qualifiedReelPost>, instagram: ReturnType<typeof qualifiedReelPost>) => {
      Reflect.deleteProperty(instagram, "remote_reel_evidence");
    }]
  ])("keeps a planned Reel red with %s", async (_kind, corrupt) => {
    const date = "2026-08-18";
    const root = await fixture(
      false,
      [{ date, slot: 2, video_id: "youtube-2", title: "slot 2", uploaded_at: "2026-08-18T15:00:00.000Z" }],
      date,
      false,
      true
    );
    const facebook = qualifiedReelPost("facebook", date, 2, "a".repeat(64));
    const instagram = qualifiedReelPost("instagram", date, 2, "a".repeat(64));
    corrupt(facebook, instagram);
    await replaceSlotTwoPosts(root, [facebook, instagram]);

    const result = await runObserve("day-audit.ps1", root);

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      planned_reels: { missing_planned_reels: number[]; evidence_gaps: Array<{ reasons: string[] }> };
    };
    expect(report.ok).toBe(false);
    expect(report.planned_reels.missing_planned_reels).toEqual([2]);
    expect(report.planned_reels.evidence_gaps[0]?.reasons).not.toHaveLength(0);
    expect(await exists(join(root, "output"))).toBe(false);
    expect(await exists(join(root, "scheduled-task-called.txt"))).toBe(false);
  });

  it("accepts only same-slot dual-Reel evidence with the same approved video SHA", async () => {
    const date = "2026-08-18";
    const root = await fixture(
      false,
      [{ date, slot: 2, video_id: "youtube-2", title: "slot 2", uploaded_at: "2026-08-18T15:00:00.000Z" }],
      date,
      false,
      true
    );
    const proof = await writeVerifiedYouTubeCompletion(root, date);
    await replaceSlotTwoPosts(root, [
      qualifiedReelPost("facebook", date, 2, proof.videoSha256),
      qualifiedReelPost("instagram", date, 2, proof.videoSha256)
    ]);

    const result = await runObserve("day-audit.ps1", root);

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(0);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      planned_reels: { required_slots: number[]; delivered_slots: number[]; missing_planned_reels: number[]; evidence_gaps: unknown[] };
      youtube: { expected_reel_slots: number[]; uploaded_reel_slots: number[]; missing_reel_slots: number[] };
    };
    expect(report.ok).toBe(true);
    expect(report.planned_reels).toMatchObject({
      required_slots: [2],
      delivered_slots: [2],
      missing_planned_reels: [],
      evidence_gaps: []
    });
    expect(report.youtube).toMatchObject({ expected_reel_slots: [2], uploaded_reel_slots: [2], missing_reel_slots: [] });
    expect(await exists(join(root, "output"))).toBe(false);
    expect(await exists(join(root, "scheduled-task-called.txt"))).toBe(false);
  });

  it.each([
    ["a duplicate same-day Facebook tuple", "2026-08-18"],
    ["a cross-date Facebook companion tuple", "2026-08-17"]
  ])("fails closed on %s instead of selecting an arbitrary completion row", async (_kind, companionDate) => {
    const date = "2026-08-18";
    const root = await fixture(
      false,
      [{ date, slot: 2, video_id: "youtube-2", title: "slot 2", uploaded_at: "2026-08-18T15:00:00.000Z" }],
      date,
      false,
      true
    );
    const proof = await writeVerifiedYouTubeCompletion(root, date);
    await replaceSlotTwoPosts(root, [
      qualifiedReelPost("facebook", date, 2, proof.videoSha256),
      qualifiedReelPost("instagram", date, 2, proof.videoSha256),
      qualifiedReelPost("facebook", companionDate, 2, proof.videoSha256)
    ]);

    const patrol = await runObserve("watchdog-patrol.ps1", root);
    expect(patrol.code, `${patrol.stderr}\n${patrol.stdout}`).toBe(1);
    expect(patrol.stdout).toContain("transport evidence data gap for slot(s) 2");
    expect(patrol.stdout).not.toContain("starting catch-up");
    expect(await exists(join(root, "scheduled-task-called.txt"))).toBe(false);
    expect(await exists(join(root, "output"))).toBe(false);

    const audit = await runObserve("day-audit.ps1", root);
    expect(audit.code, `${audit.stderr}\n${audit.stdout}`).toBe(1);
    const report = JSON.parse(audit.stdout) as {
      ok: boolean;
      missing_posts: number[];
      transport_evidence: { data_gap_slots: number[]; gaps: Array<{ platform: string; reasons: string[] }> };
      planned_reels: { missing_planned_reels: number[]; evidence_gaps: Array<{ reasons: string[] }> };
    };
    expect(report.ok).toBe(false);
    expect(report.missing_posts).toEqual([2]);
    expect(report.transport_evidence.data_gap_slots).toEqual([2]);
    expect(report.transport_evidence.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        platform: "facebook",
        reasons: expect.arrayContaining(["expected exactly one slot/platform tuple candidate, found 2"])
      })
    ]));
    expect(report.planned_reels.missing_planned_reels).toEqual([2]);
    expect(report.planned_reels.evidence_gaps[0]?.reasons.join(" ")).toContain("expected exactly one slot/platform tuple candidate, found 2");
    expect(await exists(join(root, "scheduled-task-called.txt"))).toBe(false);
    expect(await exists(join(root, "output"))).toBe(false);
  });

  it("treats a tampered stamped current calendar as an evidence gap and suppresses every rescue", async () => {
    const root = await fixture(false);
    const calendarPath = join(root, "data", "content-calendar", "2026-08-19.json");
    const calendar = JSON.parse(await readFile(calendarPath, "utf8")) as { slots: Array<Record<string, unknown>> };
    calendar.slots[0]!.topic = "tampered after the canonical stamp";
    await writeJson(root, "data/content-calendar/2026-08-19.json", calendar);

    const audit = await runObserve("day-audit.ps1", root, "2026-08-19T22:50:00+08:00");
    expect(audit.code, `${audit.stderr}\n${audit.stdout}`).toBe(1);
    const report = JSON.parse(audit.stdout) as {
      ok: boolean;
      calendar_integrity: { present: boolean; tampered: boolean; inspection_status: string };
      rescue_actions: string[];
    };
    expect(report.ok).toBe(false);
    expect(report.calendar_integrity).toMatchObject({ present: true, tampered: true, inspection_status: "tampered" });
    expect(report.rescue_actions).toContain("blocked all rescues because the current calendar integrity is tampered");
    expect(await exists(join(root, "scheduled-task-called.txt"))).toBe(false);
    expect(await exists(join(root, "output"))).toBe(false);

    const patrol = await runObserve("watchdog-patrol.ps1", root, "2026-08-19T22:50:00+08:00");
    expect(patrol.code, `${patrol.stderr}\n${patrol.stdout}`).toBe(1);
    expect(patrol.stdout).toContain("current calendar integrity is tampered");
    expect(await exists(join(root, "scheduled-task-called.txt"))).toBe(false);
    expect(await exists(join(root, "output"))).toBe(false);
  });

  it("reports a missing trusted calendar inspector as unverifiable without any rescue", async () => {
    const root = await fixture(false);
    const missingTrustedTsx = await writeMissingTrustedTsxShim();

    const audit = await runObserve("day-audit.ps1", root, "2026-08-18T22:50:00+08:00", { trustedTsx: missingTrustedTsx });
    expect(audit.code, `${audit.stderr}\n${audit.stdout}`).toBe(1);
    const report = JSON.parse(audit.stdout) as {
      ok: boolean;
      calendar_integrity: { present: boolean; tampered: boolean; inspection_status: string; error: string | null };
      rescue_actions: string[];
    };
    expect(report.ok).toBe(false);
    expect(report.calendar_integrity).toMatchObject({
      present: false,
      tampered: false,
      inspection_status: "unverifiable"
    });
    expect(report.calendar_integrity.error).toEqual(expect.any(String));
    expect(report.rescue_actions).toContain("blocked all rescues because current calendar integrity inspection is unverifiable");
    expect(await exists(join(root, "scheduled-task-called.txt"))).toBe(false);
    expect(await exists(join(root, "output"))).toBe(false);

    const patrol = await runObserve("watchdog-patrol.ps1", root, "2026-08-18T22:50:00+08:00", { trustedTsx: missingTrustedTsx });
    expect(patrol.code, `${patrol.stderr}\n${patrol.stdout}`).toBe(1);
    expect(patrol.stdout).toContain("current calendar integrity inspection is unverifiable");
    expect(patrol.stdout).not.toContain("current calendar integrity is tampered");
    expect(await exists(join(root, "scheduled-task-called.txt"))).toBe(false);
    expect(await exists(join(root, "output"))).toBe(false);
  });

  it("returns a nonzero semantic verdict and exact missing slot for an unmirrored live Reel", async () => {
    const root = await fixture(true);
    const result = await runObserve("day-audit.ps1", root);

    expect(result.code, result.stderr).toBe(1);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      youtube: { expected_reel_slots: number[]; missing_reel_slots: number[] };
      rescue_actions: string[];
    };
    expect(report.ok).toBe(false);
    expect(report.youtube).toMatchObject({ expected_reel_slots: [2], missing_reel_slots: [2] });
    expect(await exists(join(root, "output"))).toBe(false);
    expect(report.rescue_actions).toContain("would start YouTube upload for Reel slot(s) 2 (0/1)");
    expect(await exists(join(root, "scheduled-task-called.txt"))).toBe(false);
  }, 30_000);

  it("keeps an image fallback red when the YouTube log is malformed or mismatched", async () => {
    const root = await fixture(false, [
      {
        date: "2026-08-17",
        slot: 2,
        video_id: "stale-video",
        title: "wrong date",
        uploaded_at: "2026-08-17T12:00:00.000Z"
      }
    ]);
    const result = await runObserve("day-audit.ps1", root);

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      youtube: { expected_reel_slots: number[]; unexpected_youtube_slots: number[] };
    };
    expect(report.ok).toBe(false);
    expect(report.youtube).toMatchObject({ expected_reel_slots: [], unexpected_youtube_slots: [2] });
  });

  it("fails closed when an old IG Reel is copied into today's posted-log", async () => {
    const root = await fixture(true, [], "2026-08-17");
    const result = await runObserve("day-audit.ps1", root);

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    const report = JSON.parse(result.stdout) as { ok: boolean; youtube: { reconciliation: string; error: string } };
    expect(report.ok).toBe(false);
    expect(report.youtube.reconciliation).toBe("failed");
    expect(report.youtube.error).toContain("posted-log date mismatch");
  });

  it("fails closed when the YouTube ledger is not an array", async () => {
    const root = await fixture(false, { stale: true });
    const result = await runObserve("day-audit.ps1", root);

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    const report = JSON.parse(result.stdout) as { ok: boolean; youtube: { reconciliation: string; error: string } };
    expect(report.ok).toBe(false);
    expect(report.youtube.reconciliation).toBe("failed");
    expect(report.youtube.error).toContain("youtube-log must be a JSON array");
  });

  it("does not let an unexpected YouTube record block a separate missing Reel slot", async () => {
    const root = await fixture(true, [
      {
        date: "2026-08-17",
        slot: 1,
        video_id: "stale-video",
        title: "wrong date",
        uploaded_at: "2026-08-17T12:00:00.000Z"
      }
    ]);
    const result = await runObserve("youtube-upload.ps1", root);

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(result.stdout).toContain("will upload only missing qualified slot(s) and keep the day red");
    expect(result.stdout).toContain("would upload YouTube Short for qualified Reel slot 2");
    expect(await exists(join(root, "output"))).toBe(false);
  });

  it("fails closed on a preexisting old upload lock without invoking the Node uploader", async () => {
    const root = await fixture(true);
    const lock = join(root, "data", "run-locks", "youtube-upload.ps1.lock");
    const oldOwner = "preexisting-owner-marker";
    await mkdir(join(lock, ".."), { recursive: true });
    await writeFile(lock, oldOwner, "utf8");
    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(lock, oldTime, oldTime);
    const before = await stat(lock);

    // The normal path would invoke this explicitly trusted shim. Its absence
    // proves the fail-closed lock exits before the Node uploader.
    const uploaderCalled = join(root, "node-uploader-called.txt");
    const result = await runNormal(
      "youtube-upload.ps1",
      root,
      `@echo off\r\n> "${uploaderCalled}" echo invoked\r\nexit /b 0\r\n`
    );

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(result.stderr).toContain("single-flight lock already exists");
    expect(await readFile(lock, "utf8")).toBe(oldOwner);
    expect((await stat(lock)).mtimeMs).toBeCloseTo(before.mtimeMs, -1);
    expect(await exists(uploaderCalled)).toBe(false);
    expect(await exists(join(root, "output"))).toBe(false);
  });

  it("uses a kernel-owned delete-on-close handle instead of check-then-delete cleanup", async () => {
    const script = await readFile(join(project, "scripts", "youtube-upload.ps1"), "utf8");

    expect(script).toContain("[IO.FileShare]::None");
    expect(script).toContain("[IO.FileOptions]::DeleteOnClose");
    expect(script).toContain("$singleFlightStream.Dispose()");
    expect(script).not.toContain("Move-Item -LiteralPath $singleFlight");
    expect(script).not.toContain("[IO.File]::ReadAllText($singleFlight");
  });

  it("releases its exact kernel single-flight handle after a no-op run", async () => {
    const root = await fixture(false);
    const lock = join(root, "data", "run-locks", "youtube-upload.ps1.lock");

    const result = await runNormal("youtube-upload.ps1", root);

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(0);
    await expect(access(lock)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps tomorrow red when a calendar-declared Reel has no publishable evidence", async () => {
    const root = await fixture(false, [], "2026-08-18", true);
    const result = await runObserve("day-audit.ps1", root);

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    const report = JSON.parse(result.stdout) as {
      tomorrow: { reels: string; reel_readiness: { required_reel_slots: number[]; blocked_reels: unknown[] } };
    };
    expect(report.tomorrow.reels).toBe("blocked");
    expect(report.tomorrow.reel_readiness.required_reel_slots).toEqual([3]);
    expect(report.tomorrow.reel_readiness.blocked_reels).toHaveLength(1);
  });

  it("does not call a zero-exit skipped first-comment CLI a posted comment without reread evidence", async () => {
    const root = await fixture(false);
    const date = "2026-08-18";
    await writeJson(root, `data/first-comments/${date}.json`, [
      { date, slot: 1, media_id: "instagram-2026-08-18-slot-1", comment_id: "comment-1" }
    ]);
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        scripts: {
          "first-comment": "tsx src/firstComment.ts",
          "ga4-report": "tsx src/ga4Report.ts"
        }
      }),
      "utf8"
    );
    await writeFile(join(root, "src", "firstComment.ts"), "// checked fixture entry\n", "utf8");
    await writeFile(join(root, "src", "ga4Report.ts"), "// checked fixture entry\n", "utf8");
    await commitProductionContractFixture(root, ["package.json", "src"]);

    const trustedTsxSource = [
      "const args = process.argv.slice(2);",
      "if (args.includes('--eval')) { console.log(JSON.stringify({ present: true, tampered: false })); process.exit(0); }",
      "const joined = args.join(' ');",
      "if (/publishingReconciliation/i.test(joined)) {",
      "  console.log(JSON.stringify(args.includes('--reel-readiness') ? { status: 'not_planned', required_reel_slots: [], ready_reel_slots: [], blocked_reels: [] } : { expected_reel_slots: [], uploaded_reel_slots: [], missing_reel_slots: [], unexpected_youtube_slots: [] }));",
      "  process.exit(0);",
      "}",
      "if (/firstComment/i.test(joined)) { console.log(JSON.stringify({ slot: 2, skipped: 'dry run' })); process.exit(0); }",
      "process.exit(0);"
    ].join("\n");
    const result = await runNormal("day-audit.ps1", root, undefined, { trustedTsxSource });

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    const reportPath = join(root, "output", "day-reports", `${date}.json`);
    const report = JSON.parse((await readFile(reportPath, "utf8")).replace(/^\uFEFF/u, "")) as {
      ok: boolean;
      missing_comments: number[];
      rescue_actions: string[];
    };
    expect(report.ok).toBe(false);
    expect(report.missing_comments).toEqual([2]);
    expect(report.rescue_actions).toContain(
      "first-comment exited 0 but verified evidence is still missing for slot 2; not counted as posted"
    );
    expect(report.rescue_actions).not.toContain("posted first comments for slot 2");
  }, 30_000);

  it("makes the YouTube worker iterate canonical missing Reel slots rather than a fixed slot list", async () => {
    const script = await readFile(join(project, "scripts", "youtube-upload.ps1"), "utf8");
    const bridge = await readFile(join(project, "scripts", "_publishing-reconciliation.ps1"), "utf8");

    expect(script).toContain("foreach ($slotNumber in $missingReelSlots)");
    expect(script).not.toContain("foreach ($slotNumber in @(2, 3))");
    // Native stderr is deliberately captured, then split from stdout before
    // ConvertFrom-Json. A blanket ban on `2>&1` would reintroduce the opaque
    // nonzero failure this bridge was added to preserve.
    expect(bridge).toContain("$captured = @(Invoke-TrustedProductionTsx -Root $Root @arguments 2>&1)");
    expect(bridge).toContain("$stdout = @()");
    expect(bridge).toContain("$stderr = @()");
    expect(bridge).toContain("$result.Stdout | ConvertFrom-Json");
    expect(bridge).not.toContain("$captured | ConvertFrom-Json");
  });

  it("does not call a video_id-shaped uploader output a completed YouTube Short", async () => {
    const script = await readFile(join(project, "scripts", "youtube-upload.ps1"), "utf8");

    expect(script).toContain("--verify-completion");
    expect(script).toContain("verified completed YouTube Short");
    expect(script).toContain("$slotReconciliation.uploaded_reel_slots");
    expect(script).toContain("YouTube completion verified by canonical approval, immutable evidence, and reconciliation.");
    expect(script).not.toContain('if ($joined -match \'"video_id"\')');
    expect(script).not.toContain('Write-Log "Slot $slotNumber uploaded to YouTube."');
  });
});

describe("daily generation dirty-worktree gate", () => {
  it.each([
    ["src\\dirty-production.ts", "export const dirty = true;\n"],
    ["package.json", "{\"private\":true}\n"],
    ["package-lock.json", "{\"lockfileVersion\":3}\n"],
    [".agents\\skills\\daily-automation\\SKILL.md", "malicious runtime instruction\n"]
  ])("blocks dirty %s even when a malicious root git.cmd claims clean", async (dirtyEntry, dirtyContents) => {
    const root = await mkdtemp(join(tmpdir(), "daily-generate-dirty-"));
    roots.push(root);
    const gitShimMarker = join(root, "malicious-git-shim-invoked.txt");

    await writeCleanGit(root);
    const dirtyPath = join(root, ...dirtyEntry.split("\\"));
    await mkdir(join(dirtyPath, ".."), { recursive: true });
    await writeFile(dirtyPath, dirtyContents, "utf8");
    await writeFile(join(root, "git.cmd"), [
      "@echo off",
      `> "${gitShimMarker}" echo forged-clean-contract`,
      "exit /b 0",
      ""
    ].join("\r\n"), "utf8");
    const result = await runDailyGenerate(root);

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(await exists(gitShimMarker)).toBe(false);
    expect(await exists(join(root, "scheduled-task-enabled.txt"))).toBe(false);
    expect(await exists(join(root, "output"))).toBe(false);
  });

  it("blocks an unverifiable production worktree before npm, Pages, or indexing", async () => {
    const root = await mkdtemp(join(tmpdir(), "daily-generate-unverifiable-"));
    roots.push(root);

    await writeFile(join(root, "git.cmd"), [
      "@echo off",
      "rem A root shim must not turn this non-repository into a verified contract.",
      "exit /b 0",
      ""
    ].join("\r\n"), "utf8");
    const result = await runDailyGenerate(root);

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(await exists(join(root, "scheduled-task-enabled.txt"))).toBe(false);
    expect(await exists(join(root, "output"))).toBe(false);
  });

  it("rejects a root-local npm.cmd before it can shadow the trusted executor", async () => {
    const root = await mkdtemp(join(tmpdir(), "daily-generate-malicious-npm-"));
    roots.push(root);
    const marker = join(root, "malicious-npm-shim-invoked.txt");
    await writeCleanGit(root);
    await writeFile(join(root, "npm.cmd"), [
      "@echo off",
      `> "${marker}" echo forged-npm`,
      "exit /b 0",
      ""
    ].join("\r\n"), "utf8");

    const result = await runDailyGenerate(root);

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(await exists(marker)).toBe(false);
    expect(await exists(join(root, "scheduled-task-enabled.txt"))).toBe(false);
    expect(await exists(join(root, "output"))).toBe(false);
  });

  it("rejects a root-local codex.cmd before it can re-arm tasks or run a generator", async () => {
    const root = await mkdtemp(join(tmpdir(), "daily-generate-malicious-codex-"));
    roots.push(root);
    const marker = join(root, "malicious-codex-shim-invoked.txt");
    await writeCleanGit(root);
    await writeFile(join(root, "codex.cmd"), [
      "@echo off",
      `> \"${marker}\" echo forged-codex`,
      "exit /b 0",
      ""
    ].join("\r\n"), "utf8");

    const result = await runDailyGenerate(root);

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(await exists(marker)).toBe(false);
    expect(await exists(join(root, "scheduled-task-enabled.txt"))).toBe(false);
    expect(await exists(join(root, "output"))).toBe(false);
  });

  it("rejects an inherited npm override without the explicit temporary test seam", async () => {
    const root = await mkdtemp(join(tmpdir(), "daily-generate-untrusted-npm-env-"));
    roots.push(root);
    const marker = join(root, "untrusted-npm-env-invoked.txt");
    const appData = join(root, "appdata");
    const untrustedNpm = await writeTrustedNpmShim([
      "@echo off",
      `> "${marker}" echo forged-npm-env`,
      "exit /b 0",
      ""
    ].join("\r\n"));
    await writeCleanGit(root);
    const quote = (value: string) => value.replace(/'/g, "''");
    const command = [
      `$env:APPDATA = '${quote(appData)}'`,
      `$env:LAUNDRY_TRUSTED_NPM_CMD = '${quote(untrustedNpm)}'`,
      `& '${quote(join(project, "scripts", "daily-generate.ps1"))}' -Date '2026-08-19' -RootOverride '${quote(root)}'`,
      "exit $LASTEXITCODE"
    ].join("; ");
    let result: { code: number; stdout: string; stderr: string };
    try {
      const { stdout, stderr } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd: project });
      result = { code: 0, stdout, stderr };
    } catch (error) {
      const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
      result = {
        code: typeof failure.code === "number" ? failure.code : -1,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? failure.message
      };
    }

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(await exists(marker)).toBe(false);
    expect(await exists(join(root, "scheduled-task-enabled.txt"))).toBe(false);
    expect(await exists(join(root, "output"))).toBe(false);
  });

  it("rejects a test-seam npm shim located inside the fixture workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "daily-generate-nested-npm-shim-"));
    roots.push(root);
    const marker = join(root, "nested-npm-shim-invoked.txt");
    const nestedNpm = join(root, "tools", "npm.cmd");
    await writeCleanGit(root);
    await mkdir(join(root, "tools"), { recursive: true });
    await writeFile(nestedNpm, [
      "@echo off",
      `> "${marker}" echo forged-nested-npm`,
      "exit /b 0",
      ""
    ].join("\r\n"), "utf8");
    const quote = (value: string) => value.replace(/'/g, "''");
    const command = [
      `$env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM = '${TEST_NPM_SEAM}'`,
      `$env:LAUNDRY_TRUSTED_NPM_CMD = '${quote(nestedNpm)}'`,
      `& '${quote(join(project, "scripts", "daily-generate.ps1"))}' -Date '2026-08-19' -RootOverride '${quote(root)}'`,
      "exit $LASTEXITCODE"
    ].join("; ");
    let result: { code: number; stdout: string; stderr: string };
    try {
      const { stdout, stderr } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd: project });
      result = { code: 0, stdout, stderr };
    } catch (error) {
      const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
      result = {
        code: typeof failure.code === "number" ? failure.code : -1,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? failure.message
      };
    }

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(await exists(marker)).toBe(false);
    expect(await exists(join(root, "output"))).toBe(false);
  });

  it("rejects an inherited Git override instead of resolving an arbitrary executable", async () => {
    const root = await mkdtemp(join(tmpdir(), "daily-generate-untrusted-git-env-"));
    const shimRoot = await mkdtemp(join(tmpdir(), "untrusted-laundry-git-"));
    roots.push(root, shimRoot);
    const marker = join(root, "untrusted-git-env-invoked.txt");
    const untrustedGit = join(shimRoot, "git.exe");
    await writeCleanGit(root);
    await writeFile(untrustedGit, [
      "@echo off",
      `> "${marker}" echo forged-git-env`,
      "exit /b 0",
      ""
    ].join("\r\n"), "utf8");
    const quote = (value: string) => value.replace(/'/g, "''");
    const command = [
      `$env:LAUNDRY_TRUSTED_GIT_CMD = '${quote(untrustedGit)}'`,
      `& '${quote(join(project, "scripts", "daily-generate.ps1"))}' -Date '2026-08-19' -RootOverride '${quote(root)}'`,
      "exit $LASTEXITCODE"
    ].join("; ");
    let result: { code: number; stdout: string; stderr: string };
    try {
      const { stdout, stderr } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd: project });
      result = { code: 0, stdout, stderr };
    } catch (error) {
      const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
      result = {
        code: typeof failure.code === "number" ? failure.code : -1,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? failure.message
      };
    }

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(await exists(marker)).toBe(false);
    expect(await exists(join(root, "output"))).toBe(false);
  });

  it("treats a disabled Laundry task as a fail-closed kill switch without re-enabling it", async () => {
    const root = await mkdtemp(join(tmpdir(), "daily-generate-clean-"));
    roots.push(root);

    await writeCleanGit(root);
    const result = await runDailyGenerate(root);

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(result.stderr).toContain("BLOCKED scheduler kill switch");
    expect(await exists(join(root, "scheduled-task-enabled.txt"))).toBe(false);
  });
});

describe("mutable scheduled effectors require a clean executable contract", () => {
  const effectors = [
    "daily-generate.ps1",
    "daily-approve.ps1",
    "catchup-publish.ps1",
    "youtube-upload.ps1",
    "watchdog-patrol.ps1",
    "produce-next-reel.ps1",
    "day-audit.ps1",
    "weekly-review.ps1",
    "regenerate-boutique-images.ps1",
    "register-catchup-task.ps1",
    "generate-missing-images.ps1"
  ];

  async function assertBlockedContract(mode: ContractMode) {
    for (const script of effectors) {
      const root = await mkdtemp(join(tmpdir(), `contract-${mode}-${script.replace(/\.ps1$/, "")}-`));
      roots.push(root);
      const result = await runContractBlockedEffector(script, root, mode);

      expect(result.code, `${script}/${mode}: ${result.stderr}\n${result.stdout}`).toBe(1);
      expect(await exists(result.taskMarker), `${script}/${mode} unexpectedly touched Task Scheduler`).toBe(false);
      expect(await exists(result.npmMarker), `${script}/${mode} unexpectedly invoked npm`).toBe(false);
      expect(await exists(join(root, "data", "run-locks")), `${script}/${mode} unexpectedly created a run lock`).toBe(false);
      expect(await exists(join(root, "output")), `${script}/${mode} unexpectedly wrote output state`).toBe(false);
    }
  }

  it("blocks dirty source before any task, lock, npm, network, or publish side effect", async () => {
    await assertBlockedContract("src");
  }, 30_000);

  it("blocks a dirty package manifest before any task, lock, npm, network, or publish side effect", async () => {
    await assertBlockedContract("package");
  }, 30_000);

  it("blocks a dirty lockfile before any task, lock, npm, network, or publish side effect", async () => {
    await assertBlockedContract("package-lock");
  }, 30_000);

  it("blocks an unverifiable Git contract before any task, lock, npm, network, or publish side effect", async () => {
    await assertBlockedContract("unverifiable");
  }, 30_000);

  it("blocks a workspace node.exe shadow before any scheduled effector can use a runtime or mutate state", async () => {
    await assertBlockedContract("runtime-shadow");
  }, 30_000);

  it("blocks a workspace ffmpeg.exe shadow before Reel production can create its lock or invoke a media runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "contract-media-shadow-reel-"));
    roots.push(root);
    const result = await runContractBlockedEffector("produce-next-reel.ps1", root, "media-shadow");

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(await exists(result.taskMarker)).toBe(false);
    expect(await exists(result.npmMarker)).toBe(false);
    expect(await exists(join(root, "data", "run-locks"))).toBe(false);
    expect(await exists(join(root, "output"))).toBe(false);
  }, 30_000);

  it("does not accept absent media or paid-generator paths as production runtimes", async () => {
    const root = await mkdtemp(join(tmpdir(), "contract-media-runtime-missing-"));
    roots.push(root);
    const quote = (value: string) => value.replace(/'/g, "''");
    const command = [
      `. '${quote(join(project, "scripts", "_production-contract.ps1"))}'`,
      `$result = [ordered]@{ ffmpeg = [bool](Resolve-TrustedProductionFfmpegExecutable -Root '${quote(root)}'); ffprobe = [bool](Resolve-TrustedProductionFfprobeExecutable -Root '${quote(root)}'); python = [bool](Resolve-TrustedProductionPythonExecutable -Root '${quote(root)}'); paid = [bool](Resolve-TrustedProductionGenerateShotScript -Root '${quote(root)}') }`,
      "Write-Output ('MEDIA_RUNTIME=' + ($result | ConvertTo-Json -Compress))"
    ].join("; ");
    const { stdout, stderr } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd: project });
    const line = stdout.split(/\r?\n/).find((value) => value.startsWith("MEDIA_RUNTIME="));
    if (!line) throw new Error(`media runtime probe returned no verdict: ${stderr}\n${stdout}`);
    expect(JSON.parse(line.slice("MEDIA_RUNTIME=".length))).toEqual({ ffmpeg: false, ffprobe: false, python: false, paid: false });
  });

  it("manually registers only the approved Laundry task set after a verified clean contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "register-catchup-clean-"));
    roots.push(root);
    const marker = join(root, "scheduled-registration.log");
    await writeCleanGit(root);
    const quote = (value: string) => value.replace(/'/g, "''");
    const trustedTsx = await writeTrustedTsxShim();
    const command = [
      `$global:registrationMarker = '${quote(marker)}'`,
      `$env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM = '${TEST_RUNTIME_SEAM}'`,
      `$env:LAUNDRY_TRUSTED_TSX_ENTRY = '${quote(trustedTsx)}'`,
      "function global:New-ScheduledTaskAction { [CmdletBinding()] param([string]$Execute, [string]$Argument, [string]$WorkingDirectory) [IO.File]::AppendAllText($global:registrationMarker, 'action:' + $Execute + [Environment]::NewLine); [pscustomobject]@{} }",
      "function global:New-ScheduledTaskTrigger { [CmdletBinding()] param([switch]$Daily, [switch]$Once, [object]$At, [TimeSpan]$RepetitionInterval, [TimeSpan]$RepetitionDuration) [pscustomobject]@{ Repetition = $null } }",
      "function global:New-ScheduledTaskSettingsSet { [CmdletBinding()] param([switch]$StartWhenAvailable, [switch]$AllowStartIfOnBatteries, [switch]$DontStopIfGoingOnBatteries, [TimeSpan]$ExecutionTimeLimit, [string]$MultipleInstances) [pscustomobject]@{} }",
      "function global:Unregister-ScheduledTask { [CmdletBinding()] param([string]$TaskName, [switch]$Confirm) [IO.File]::AppendAllText($global:registrationMarker, 'unregister:' + $TaskName + [Environment]::NewLine) }",
      "function global:Register-ScheduledTask { [CmdletBinding()] param([string]$TaskName, [object]$Action, [object[]]$Trigger, [object]$Settings, [string]$Description) [IO.File]::AppendAllText($global:registrationMarker, 'register:' + $TaskName + [Environment]::NewLine) }",
      "function global:Get-ScheduledTask { [CmdletBinding()] param() @() }",
      "function global:schtasks { [CmdletBinding()] param([Parameter(ValueFromRemainingArguments = $true)]$Arguments) [IO.File]::AppendAllText($global:registrationMarker, 'schtasks:' + ($Arguments -join ' ') + [Environment]::NewLine) }",
      `& '${quote(join(project, "scripts", "register-catchup-task.ps1"))}' -RootOverride '${quote(root)}'`,
      "exit $LASTEXITCODE"
    ].join("; ");
    let result: { code: number; stdout: string; stderr: string };
    try {
      const { stdout, stderr } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd: project });
      result = { code: 0, stdout, stderr };
    } catch (error) {
      const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
      result = {
        code: typeof failure.code === "number" ? failure.code : -1,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? failure.message
      };
    }

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(0);
    const calls = await readFile(marker, "utf8");
    const trustedPowerShell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    expect(calls.toLowerCase()).toContain(`action:${trustedPowerShell}`.toLowerCase());
    expect(calls.match(/^unregister:Laundry-/gm)).toHaveLength(8);
    expect(calls.match(/^register:Laundry-/gm)).toHaveLength(8);
    const registered = Array.from(calls.matchAll(/^register:(Laundry-[^\r\n]+)/gm), (match) => match[1]).sort();
    expect(registered).toEqual([
      "Laundry-CatchUp-Publish",
      "Laundry-Daily-Approve",
      "Laundry-Daily-Generate",
      "Laundry-Day-Audit",
      "Laundry-Reel-Production",
      "Laundry-Watchdog-Patrol",
      "Laundry-Weekly-Review",
      "Laundry-YouTube-Upload"
    ]);
    expect(calls).not.toContain("Laundry-Publish-Sentinel");
    expect(calls).not.toContain("schtasks:");
  });

  it("rejects legacy Laundry-Publish-Sentinel before manual registration can mutate any task", async () => {
    const root = await mkdtemp(join(tmpdir(), "register-catchup-legacy-sentinel-"));
    roots.push(root);
    const marker = join(root, "unexpected-scheduler-mutation.txt");
    await writeCleanGit(root);
    const quote = (value: string) => value.replace(/'/g, "''");
    const trustedTsx = await writeTrustedTsxShim();
    const command = [
      `$global:legacySentinelMarker = '${quote(marker)}'`,
      `$env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM = '${TEST_RUNTIME_SEAM}'`,
      `$env:LAUNDRY_TRUSTED_TSX_ENTRY = '${quote(trustedTsx)}'`,
      "function global:Get-ScheduledTask { [CmdletBinding()] param() [pscustomobject]@{ TaskName = 'Laundry-Publish-Sentinel'; State = 'Ready' } }",
      "function global:Enable-ScheduledTask { [IO.File]::AppendAllText($global:legacySentinelMarker, 'enable' + [Environment]::NewLine) }",
      "function global:Unregister-ScheduledTask { [IO.File]::AppendAllText($global:legacySentinelMarker, 'unregister' + [Environment]::NewLine) }",
      "function global:Register-ScheduledTask { [IO.File]::AppendAllText($global:legacySentinelMarker, 'register' + [Environment]::NewLine) }",
      "function global:Start-ScheduledTask { [IO.File]::AppendAllText($global:legacySentinelMarker, 'start' + [Environment]::NewLine) }",
      `& '${quote(join(project, "scripts", "register-catchup-task.ps1"))}' -RootOverride '${quote(root)}'`,
      "exit $LASTEXITCODE"
    ].join("; ");
    let result: { code: number; stdout: string; stderr: string };
    try {
      const { stdout, stderr } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd: project });
      result = { code: 0, stdout, stderr };
    } catch (error) {
      const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
      result = {
        code: typeof failure.code === "number" ? failure.code : -1,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? failure.message
      };
    }

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(result.stderr).toContain("legacy Laundry-Publish-Sentinel is present");
    expect(await exists(marker)).toBe(false);
  });

  it("reports a null NextRunTime without invoking manual registration or any task mutation", async () => {
    const root = await mkdtemp(join(tmpdir(), "watchdog-null-next-run-"));
    roots.push(root);
    const marker = join(root, "unexpected-scheduler-mutation.txt");
    await writeCleanGit(root);
    const quote = (value: string) => value.replace(/'/g, "''");
    const trustedNpm = await writeTrustedNpmShim();
    const trustedTsx = await writeTrustedTsxShim();
    const command = [
      `$global:nullNextRunMarker = '${quote(marker)}'`,
      `$env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM = '${TEST_RUNTIME_SEAM}'`,
      `$env:LAUNDRY_TRUSTED_NPM_CMD = '${quote(trustedNpm)}'`,
      `$env:LAUNDRY_TRUSTED_TSX_ENTRY = '${quote(trustedTsx)}'`,
      "function global:Get-ScheduledTask { [CmdletBinding()] param() [pscustomobject]@{ TaskName = 'Laundry-Watchdog-Patrol'; State = 'Ready' } }",
      "function global:Get-ScheduledTaskInfo { [CmdletBinding()] param([string]$TaskName) [pscustomobject]@{ NextRunTime = $null } }",
      "function global:Enable-ScheduledTask { [IO.File]::AppendAllText($global:nullNextRunMarker, 'enable' + [Environment]::NewLine) }",
      "function global:Unregister-ScheduledTask { [IO.File]::AppendAllText($global:nullNextRunMarker, 'unregister' + [Environment]::NewLine) }",
      "function global:Register-ScheduledTask { [IO.File]::AppendAllText($global:nullNextRunMarker, 'register' + [Environment]::NewLine) }",
      "function global:Start-ScheduledTask { [IO.File]::AppendAllText($global:nullNextRunMarker, 'start' + [Environment]::NewLine) }",
      `& '${quote(join(project, "scripts", "watchdog-patrol.ps1"))}' -RootOverride '${quote(root)}' -NowOverride '2026-08-19T12:30:00+08:00'`,
      "exit $LASTEXITCODE"
    ].join("; ");
    let result: { code: number; stdout: string; stderr: string };
    try {
      const { stdout, stderr } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd: project });
      result = { code: 0, stdout, stderr };
    } catch (error) {
      const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
      result = {
        code: typeof failure.code === "number" ? failure.code : -1,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? failure.message
      };
    }

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(result.stderr).toContain("empty or unverifiable NextRunTime");
    expect(await exists(marker)).toBe(false);
  });

  it("rejects a workspace powershell.exe shadow before task registration reaches any scheduler shim", async () => {
    const root = await mkdtemp(join(tmpdir(), "register-catchup-powershell-shadow-"));
    roots.push(root);
    const marker = join(root, "malicious-powershell-shim-invoked.txt");
    await writeCleanGit(root);
    await writeFile(join(root, "powershell.exe"), [
      "@echo off",
      `> \"${marker}\" echo forged-powershell`,
      "exit /b 0",
      ""
    ].join("\r\n"), "utf8");

    const result = await runContractBlockedEffector("register-catchup-task.ps1", root, "unverifiable");

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(await exists(marker)).toBe(false);
    expect(await exists(result.taskMarker)).toBe(false);
    expect(await exists(result.npmMarker)).toBe(false);
  });
});

describe("watchdog kill-switch observation", () => {
  it("reports a disabled task and never calls the enable shim", async () => {
    const root = await mkdtemp(join(tmpdir(), "watchdog-late-dirty-"));
    roots.push(root);
    await writeCleanGit(root);
    const marker = join(root, "unexpected-task-enable.txt");
    const trustedNpm = await writeTrustedNpmShim();
    const trustedTsx = await writeTrustedTsxShim();
    const quote = (value: string) => value.replace(/'/g, "''");
    const command = [
      `$env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM = '${TEST_RUNTIME_SEAM}'`,
      `$env:LAUNDRY_TRUSTED_NPM_CMD = '${quote(trustedNpm)}'`,
      `$env:LAUNDRY_TRUSTED_TSX_ENTRY = '${quote(trustedTsx)}'`,
      `$root = '${quote(root)}'`,
      "$ProductionContractVerified = $true",
      "$WatchdogObserveOnly = $false",
      `. '${quote(join(project, "scripts", "_production-contract.ps1"))}'`,
      `$global:watchdogLateTaskMarker = '${quote(marker)}'`,
      "function global:Get-ScheduledTask { [CmdletBinding()] param() @([pscustomobject]@{ TaskName = 'Laundry-CatchUp-Publish'; State = 'Disabled' }) }",
      "function global:Enable-ScheduledTask { [CmdletBinding()] param([string]$TaskName) [IO.File]::AppendAllText($global:watchdogLateTaskMarker, $TaskName + [Environment]::NewLine) }",
      `. '${quote(join(project, "scripts", "_watchdog.ps1"))}'`,
      "if (Test-Path -LiteralPath $global:watchdogLateTaskMarker) { exit 2 }",
      "exit 0"
    ].join("; ");
    let result: { code: number; stdout: string; stderr: string };
    try {
      const { stdout, stderr } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd: project });
      result = { code: 0, stdout, stderr };
    } catch (error) {
      const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
      result = {
        code: typeof failure.code === "number" ? failure.code : -1,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? failure.message
      };
    }

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(result.stderr).toContain("operator kill switch is active");
    expect(await exists(marker)).toBe(false);
  });
});

describe("daily generation rechecks its executable contract after Codex", () => {
  it("blocks a generator-created source change before validation, lock, Pages, IndexNow, or task side effects", async () => {
    const root = await mkdtemp(join(tmpdir(), "daily-generate-late-dirty-"));
    roots.push(root);
    const npmMarker = join(root, "unexpected-npm.txt");
    await writeCleanGit(root);
    const trustedNpm = await writeTrustedNpmShim([
      "@echo off",
      `> "${npmMarker}" echo unexpected-npm`,
      "exit /b 0",
      ""
    ].join("\r\n"));
    const trustedTsx = await writeTrustedTsxShim();
    const trustedCodex = await writeTrustedCodexShim([
      "@echo off",
      "if not exist \"%CD%\\src\" mkdir \"%CD%\\src\"",
      "> \"%CD%\\src\\late-dirty.ts\" echo dirty",
      "echo CODEX_LATE_DIRTY_STDOUT",
      "exit /b 0",
      ""
    ].join("\r\n"));

    const quote = (value: string) => value.replace(/'/g, "''");
    const command = [
      `$env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM = '${TEST_RUNTIME_SEAM}'`,
      `$env:LAUNDRY_TRUSTED_NPM_CMD = '${quote(trustedNpm)}'`,
      `$env:LAUNDRY_TRUSTED_TSX_ENTRY = '${quote(trustedTsx)}'`,
      `$env:LAUNDRY_TRUSTED_CODEX_CMD = '${quote(trustedCodex)}'`,
      "function global:Get-ScheduledTask { [CmdletBinding()] param() @() }",
      `& '${quote(join(project, "scripts", "daily-generate.ps1"))}' -Date '2026-08-19' -RootOverride '${quote(root)}'`,
      "exit $LASTEXITCODE"
    ].join("; ");
    let result: { code: number; stdout: string; stderr: string };
    try {
      const { stdout, stderr } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd: project });
      result = { code: 0, stdout, stderr };
    } catch (error) {
      const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
      result = {
        code: typeof failure.code === "number" ? failure.code : -1,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? failure.message
      };
    }

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(result.stderr).toContain("BLOCKED production contract after Codex generation");
    expect(await exists(npmMarker)).toBe(false);
    expect(await exists(join(root, "data", "run-locks"))).toBe(false);
    const log = await readFile(join(root, "output", "daily-generate-logs", "2026-08-19.log"), "utf8");
    expect(log).not.toContain("CODEX_LATE_DIRTY_STDOUT");
  });

  it("does not invoke Pages or IndexNow when day-lock exits zero without a verified lock verdict", async () => {
    const root = await mkdtemp(join(tmpdir(), "daily-generate-lock-semantic-failure-"));
    roots.push(root);
    const scriptHost = await mkdtemp(join(tmpdir(), "daily-generate-lock-script-host-"));
    roots.push(scriptHost);
    const scripts = join(scriptHost, "scripts");
    const npmCalls = join(root, "npm-calls.log");
    const remoteMarker = join(root, "unexpected-remote-publish.txt");
    await mkdir(join(root, "data", "content-calendar"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(scripts, { recursive: true });
    await writeFile(join(root, "data", "content-calendar", "2026-08-19.json"), "{}\n", "utf8");
    await writeFile(join(root, "src", "generateImage.ts"), "", "utf8");
    await writeFile(join(root, "src", "dayLock.ts"), "", "utf8");
    await writeFile(join(root, "package.json"), JSON.stringify({
      scripts: {
        "validate-publishable-images": "tsx src/generateImage.ts --validate-publishable",
        "day-lock": "tsx src/dayLock.ts"
      }
    }), "utf8");
    await writeCleanGit(root);
    await commitProductionContractFixture(root, ["package.json", "src"]);
    const trustedNpm = await writeTrustedNpmShim([
      "@echo off",
      `>> \"${npmCalls}\" echo %*`,
      "if /I \"%~2\"==\"validate-publishable-images\" exit /b 0",
      "if /I \"%~2\"==\"day-lock\" (",
      "  echo day-lock: rejected",
      "  exit /b 0",
      ")",
      "if /I \"%~2\"==\"generate-public-site\" > \"" + remoteMarker + "\" echo unexpected-generate",
      "if /I \"%~2\"==\"publish-pages\" > \"" + remoteMarker + "\" echo unexpected-pages",
      "if /I \"%~2\"==\"submit-indexnow\" > \"" + remoteMarker + "\" echo unexpected-indexnow",
      "if /I \"%~2\"==\"indexing-push\" > \"" + remoteMarker + "\" echo unexpected-indexing-audit",
      "exit /b 0",
      ""
    ].join("\r\n"));
    await writeFile(join(scripts, "daily-generate.ps1"), await readFile(join(project, "scripts", "daily-generate.ps1"), "utf8"), "utf8");
    await writeFile(join(scripts, "_production-contract.ps1"), await readFile(join(project, "scripts", "_production-contract.ps1"), "utf8"), "utf8");
    await writeFile(join(scripts, "generate-missing-images.ps1"), "param([string]$Date, [string]$LogFile, [switch]$QaOnly, [switch]$SkipPublicSite, [string]$RootOverride)\n", "utf8");

    const quote = (value: string) => value.replace(/'/g, "''");
    const trustedTsx = await writeTrustedTsxShim([
      "import { appendFileSync } from 'node:fs';",
      `appendFileSync(${JSON.stringify(npmCalls)}, process.argv.slice(2).join(' ') + '\\n');`,
      "if (process.argv.includes('src/dayLock.ts')) console.log('day-lock: rejected');",
      "else console.log(JSON.stringify({ shouldRebuild: false }));",
      ""
    ].join("\n"));
    const command = [
      "function global:Get-ScheduledTask { [CmdletBinding()] param() @() }",
      `$env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM = '${TEST_RUNTIME_SEAM}'`,
      `$env:LAUNDRY_TRUSTED_NPM_CMD = '${quote(trustedNpm)}'`,
      `$env:LAUNDRY_TRUSTED_TSX_ENTRY = '${quote(trustedTsx)}'`,
      `& '${quote(join(scripts, "daily-generate.ps1"))}' -Date '2026-08-19' -RootOverride '${quote(root)}'`,
      "exit $LASTEXITCODE"
    ].join("; ");
    let result: { code: number; stdout: string; stderr: string };
    try {
      const { stdout, stderr } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd: project });
      result = { code: 0, stdout, stderr };
    } catch (error) {
      const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
      result = {
        code: typeof failure.code === "number" ? failure.code : -1,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? failure.message
      };
    }

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    if (!(await exists(npmCalls))) throw new Error(`missing trusted TSX call log: ${result.stderr}\n${result.stdout}`);
    const calls = await readFile(npmCalls, "utf8");
    expect(calls).toContain("src/dayLock.ts --date 2026-08-19");
    expect(calls).not.toContain("src/generatePublicSite.ts");
    expect(calls).not.toContain("src/publishPages.ts");
    expect(calls).not.toContain("src/submitIndexNow.ts");
    expect(calls).not.toContain("src/indexingPush.ts");
    expect(await exists(remoteMarker)).toBe(false);
  });

  it("keeps a locally complete current day off Pages and IndexNow until canonical two-platform approval exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "daily-generate-no-public-approval-"));
    roots.push(root);
    const runtimeCalls = join(root, "trusted-runtime-calls.log");
    const remoteMarker = join(root, "unexpected-public-effect.txt");
    await writeDailyContent(
      {
        date: "2026-08-19",
        timezone: "Asia/Taipei",
        generated_at: "2026-08-19T00:00:00.000Z",
        slots: [imageSlot(1), imageSlot(2)]
      },
      root
    );
    await mkdir(join(root, "src"), { recursive: true });
    for (const source of [
      "logging.ts",
      "generateImage.ts",
      "dayLock.ts",
      "generatePublicSite.ts",
      "publishPages.ts",
      "submitIndexNow.ts",
      "indexingPush.ts"
    ]) {
      await writeFile(join(root, "src", source), "\n", "utf8");
    }
    await writeFile(join(root, "package.json"), JSON.stringify({
      scripts: {
        "validate-publishable-images": "tsx src/generateImage.ts --validate-publishable",
        "day-lock": "tsx src/dayLock.ts",
        "generate-public-site": "tsx src/generatePublicSite.ts",
        "publish-pages": "tsx src/publishPages.ts",
        "submit-indexnow": "tsx src/submitIndexNow.ts",
        "indexing-push": "tsx src/indexingPush.ts"
      }
    }), "utf8");
    await writeCleanGit(root);
    await commitProductionContractFixture(root, ["package.json", "src"]);
    const trustedNpm = await writeTrustedNpmShim();
    const quote = (value: string) => value.replace(/'/g, "''");
    const trustedTsx = await writeTrustedTsxShim([
      "import { appendFileSync, writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "const entry = args[0] ?? '';",
      "const label = entry === '--eval' ? '--eval public-approval' : args.join(' ');",
      `appendFileSync(${JSON.stringify(runtimeCalls)}, label + '\\n', 'utf8');`,
      "if (entry === '--eval') {",
      "  console.log(JSON.stringify({ ok: false, reason: 'fixture lacks canonical two-platform approval', slots: [], gaps: ['fixture lacks canonical two-platform approval'] }));",
      "} else if (entry === 'src/logging.ts') {",
      "  console.log(JSON.stringify({ shouldRebuild: false }));",
      "} else if (entry === 'src/dayLock.ts') {",
      "  console.log('DAY_LOCK_VERIFIED date=2026-08-19 action=locked calendar_checksum=0123456789abcdef lock_checksum=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');",
      "} else if (entry === 'src/generateImage.ts') {",
      "  // Semantic fixture: validation succeeded, so the public-approval gate is exercised next.",
      "} else if (['src/generatePublicSite.ts', 'src/publishPages.ts', 'src/submitIndexNow.ts', 'src/indexingPush.ts'].includes(entry)) {",
      `  writeFileSync(${JSON.stringify(remoteMarker)}, entry + '\\n', 'utf8');`,
      "  process.exitCode = 99;",
      "} else {",
      "  console.error(`unexpected trusted runtime entry: ${entry}`);",
      "  process.exitCode = 98;",
      "}",
      ""
    ].join("\n"));
    const command = [
      `$env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM = '${TEST_RUNTIME_SEAM}'`,
      `$env:LAUNDRY_TRUSTED_NPM_CMD = '${quote(trustedNpm)}'`,
      `$env:LAUNDRY_TRUSTED_TSX_ENTRY = '${quote(trustedTsx)}'`,
      "function global:Get-ScheduledTask { [CmdletBinding()] param() @() }",
      `& '${quote(join(project, "scripts", "daily-generate.ps1"))}' -Date '2026-08-19' -RootOverride '${quote(root)}'`,
      "exit $LASTEXITCODE"
    ].join("; ");
    let result: { code: number; stdout: string; stderr: string };
    try {
      const { stdout, stderr } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd: project });
      result = { code: 0, stdout, stderr };
    } catch (error) {
      const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
      result = { code: typeof failure.code === "number" ? failure.code : -1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? failure.message };
    }

    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(result.stderr).toContain("BLOCKED public publication before public-site generation: fixture lacks canonical two-platform approval.");
    if (!(await exists(runtimeCalls))) throw new Error(`missing trusted runtime call log: ${result.stderr}\n${result.stdout}`);
    const calls = await readFile(runtimeCalls, "utf8");
    expect(calls).toContain("src/dayLock.ts --date 2026-08-19");
    expect(calls).not.toContain("src/generatePublicSite.ts");
    expect(calls).not.toContain("src/publishPages.ts");
    expect(calls).not.toContain("src/submitIndexNow.ts");
    expect(calls).not.toContain("src/indexingPush.ts");
    expect(await exists(remoteMarker)).toBe(false);
  });

  it("rejects a canonically re-written calendar after approval because the immutable slot fingerprint no longer matches", async () => {
    const root = await mkdtemp(join(tmpdir(), "public-approval-calendar-rewrite-"));
    roots.push(root);
    const slots = await seedCanonicalPublicApproval(root);

    const before = await runPublicApprovalProbe(root);
    expect(before).toMatchObject({ ok: true, gaps: [] });

    await writeDailyContent(
      {
        date: "2026-08-19",
        timezone: "Asia/Taipei",
        generated_at: "2026-08-19T02:00:00.000Z",
        slots: [{ ...slots[0]!, topic: "rewritten after approval" }, slots[1]!]
      },
      root
    );

    const after = await runPublicApprovalProbe(root);
    expect(after.ok).toBe(false);
    expect(after.gaps.join("\n")).toContain("fingerprint mismatch");
  });

  it("requires semantic day-lock success before Publish-Site can reach Pages or IndexNow", async () => {
    const script = await readFile(join(project, "scripts", "daily-generate.ps1"), "utf8");

    expect(script).toContain("$lockSucceeded");
    expect(script).toContain("if ($lockExit -ne 0 -or -not $lockSucceeded)");
    expect(script).toContain("$script:dayLockVerified = $true");
    expect(script).toContain("if (-not $script:dayLockVerified)");
    expect(script).toContain("if ((Lock-Day) -and (Publish-Site))");
    expect(script).toContain("if (-not (Lock-Day)) { exit 1 }");
  });
});
