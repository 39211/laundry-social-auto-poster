import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeDailyContent } from "../src/logging";
import { publishPagesAssets } from "../src/publishPages";
import type { DailySlot } from "../src/types";
import { hashVideoPrompt } from "../src/videoRunFreshness";

const SYSTEM_GIT = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "cmd", "git.exe");
const gitAvailable = (() => {
  try {
    execFileSync(SYSTEM_GIT, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

function git(root: string, args: string[]): string {
  return execFileSync(SYSTEM_GIT, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
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

function publicApprovalSlot(date: string, slot: number): DailySlot {
  return {
    slot,
    time: slot === 1 ? "11:30" : "20:30",
    category: "知識文",
    topic: `公開核准測試 ${slot}`,
    media_type: "image",
    instagram_caption: `instagram ${slot}`,
    facebook_caption: `facebook ${slot}`,
    image_prompt: `image ${slot}`,
    local_image_path: `docs/assets/${date}/slot-${String(slot).padStart(2, "0")}.png`,
    public_image_url: `https://39211.github.io/assets/${date}/slot-${String(slot).padStart(2, "0")}.png`,
    visual_route: "shop-inspection",
    traffic_route: "object-proof",
    status: "pending"
  };
}

async function seedCanonicalPublicApproval(root: string, date: string, options: { withApprovedVideo?: boolean } = {}): Promise<DailySlot[]> {
  const slots = [publicApprovalSlot(date, 1), publicApprovalSlot(date, 2)];
  if (options.withApprovedVideo) {
    slots.push({
      ...publicApprovalSlot(date, 3),
      time: "12:00",
      media_type: "reel",
      video_prompt: "one verified action",
      local_video_path: `docs/assets/${date}/slot-03.mp4`,
      public_video_url: `https://39211.github.io/assets/${date}/slot-03.mp4`
    });
  }
  const digests: Record<string, Record<string, string>> = {};
  for (const slot of slots) {
    const imagePath = join(root, ...slot.local_image_path.split("/"));
    const bytes = Buffer.from(`approved-image-${date}-${slot.slot}`, "utf8");
    mkdirSync(join(imagePath, ".."), { recursive: true });
    writeFileSync(imagePath, bytes);
    digests[String(slot.slot)] = {
      [slot.local_image_path]: createHash("sha256").update(bytes).digest("hex")
    };
  }
  await writeDailyContent(
    {
      date,
      timezone: "Asia/Taipei",
      generated_at: "2026-05-15T00:00:00.000Z",
      slots
    },
    root
  );
  const approvalDirectory = join(root, "data", "approved-log");
  mkdirSync(approvalDirectory, { recursive: true });
  writeFileSync(
    join(approvalDirectory, `${date}.json`),
    `${JSON.stringify(
      slots.flatMap((slot) =>
        (["facebook", "instagram"] as const).map((platform) => ({
          date,
          slot: slot.slot,
          platform,
          status: "approved",
          approved_by: "reviewer",
          created_at: "2026-05-15T01:00:00.000Z"
        }))
      )
    )}\n`,
    "utf8"
  );
  const fingerprints = Object.fromEntries(
    slots.map((slot) => [String(slot.slot), createHash("sha256").update(JSON.stringify(slot)).digest("hex")])
  );
  writeFileSync(join(approvalDirectory, `${date}.fingerprints.json`), `${JSON.stringify(fingerprints)}\n`, "utf8");
  writeFileSync(join(approvalDirectory, `${date}.image-digests.json`), `${JSON.stringify(digests)}\n`, "utf8");
  const videoSlot = slots.find((slot) => slot.local_video_path);
  if (videoSlot?.local_video_path && videoSlot.video_prompt) {
    const videoBytes = Buffer.from(`approved-video-${date}-${videoSlot.slot}`, "utf8");
    const videoPath = join(root, ...videoSlot.local_video_path.split("/"));
    mkdirSync(join(videoPath, ".."), { recursive: true });
    writeFileSync(videoPath, videoBytes);
    const videoSha256 = createHash("sha256").update(videoBytes).digest("hex");
    const videoSourcesDirectory = join(root, "data", "video-sources");
    const videoReviewsDirectory = join(root, "data", "video-reviews");
    mkdirSync(videoSourcesDirectory, { recursive: true });
    mkdirSync(videoReviewsDirectory, { recursive: true });
    writeFileSync(
      join(videoSourcesDirectory, `${date}.json`),
      `${JSON.stringify([
        {
          date,
          slot: videoSlot.slot,
          source: "grok-imagine-video",
          model: "grok-imagine-video",
          video_path: videoSlot.local_video_path,
          request_id: "request-approved-video",
          duration_seconds: 10,
          width: 1080,
          height: 1920,
          frame_rate: 30,
          video_codec: "h264"
        }
      ])}\n`,
      "utf8"
    );
    writeFileSync(
      join(videoReviewsDirectory, `${date}.json`),
      `${JSON.stringify([
        {
          date,
          slot: videoSlot.slot,
          video_path: videoSlot.local_video_path,
          video_sha256: videoSha256,
          prompt_hash: hashVideoPrompt(videoSlot.video_prompt),
          review_round: 1,
          full_decode: "pass",
          all_frame_physics_review: "pass",
          grok_review: "pass",
          sol_review: "pass",
          separate_zh_tw_tts_review: "pass",
          generated_clip_audio_used: false,
          status: "approved",
          reviewed_at: "2026-05-15T01:00:00.000Z"
        }
      ])}\n`,
      "utf8"
    );
  }
  return slots;
}

describe("publishPagesAssets", () => {
  const gitIt = gitAvailable ? it : it.skip;

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  gitIt("rejects a workspace-local git.cmd without invoking it", async () => {
    const { root } = makeGitRepo();
    const marker = join(root, "malicious-git-shim-invoked.txt");
    writeFileSync(join(root, "git.cmd"), `@echo off\r\n> "${marker}" echo forged-publish\r\nexit /b 0\r\n`, "utf8");

    await expect(publishPagesAssets("2026-05-15", root)).rejects.toThrow("workspace-local git.cmd");
    expect(existsSync(marker)).toBe(false);
  });

  gitIt("uses an empty controlled hooks path and bypasses a malicious local pre-commit hook", async () => {
    const { root } = makeGitRepo();
    const date = "2026-05-15";
    const hookDirectory = join(root, "malicious-hooks");
    const hookSentinel = join(root, "malicious-pre-commit-ran.txt");
    mkdirSync(hookDirectory, { recursive: true });
    writeFileSync(
      join(hookDirectory, "pre-commit"),
      "#!/bin/sh\necho compromised > malicious-pre-commit-ran.txt\nexit 1\n",
      "utf8"
    );
    chmodSync(join(hookDirectory, "pre-commit"), 0o755);
    git(root, ["config", "core.hooksPath", hookDirectory]);

    // Prove this fixture hook actually executes under an ordinary Git commit;
    // an absent sentinel alone would not establish the regression boundary.
    writeFileSync(join(root, "hook-probe.txt"), "probe\n", "utf8");
    git(root, ["add", "hook-probe.txt"]);
    expect(() => git(root, ["commit", "-m", "prove malicious hook"])).toThrow();
    expect(existsSync(hookSentinel)).toBe(true);
    git(root, ["reset"]);
    rmSync(hookSentinel, { force: true });

    await seedCanonicalPublicApproval(root, date);
    writeFileSync(join(root, "docs", "index.html"), "<!doctype html><title>approved</title>\n", "utf8");

    await expect(publishPagesAssets(date, root)).resolves.toContain("Published GitHub Pages assets");
    expect(existsSync(hookSentinel)).toBe(false);
  });

  gitIt("rejects hostile inherited Git overrides before source or mirror Git actions", async () => {
    const { root, origin } = makeGitRepo();
    const { origin: rootPagesOrigin } = makeGitRepo();
    const date = "2026-05-15";
    await seedCanonicalPublicApproval(root, date);
    writeFileSync(join(root, "docs", "index.html"), "<!doctype html><title>approved</title>\n", "utf8");
    const localHead = git(root, ["rev-parse", "HEAD"]);
    const remoteHead = git(origin, ["rev-parse", "main"]);
    const mirrorHead = git(rootPagesOrigin, ["rev-parse", "main"]);
    const hostileOverrides = [
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_SYSTEM",
      "GIT_EXEC_PATH",
      "GIT_CONFIG_COUNT",
      "GIT_SSH_COMMAND"
    ];

    for (const name of hostileOverrides) {
      vi.stubEnv(name, `hostile-${name}`);
      try {
        await expect(publishPagesAssets(date, root, rootPagesOrigin)).rejects.toThrow(
          `inherited Git override(s): ${name}`
        );
      } finally {
        vi.unstubAllEnvs();
      }

      expect(git(root, ["rev-parse", "HEAD"])).toBe(localHead);
      expect(git(origin, ["rev-parse", "main"])).toBe(remoteHead);
      expect(git(rootPagesOrigin, ["rev-parse", "main"])).toBe(mirrorHead);
      expect(git(root, ["diff", "--cached", "--name-only"])).toBe("");
    }
  });

  gitIt("rejects an unapproved day before it can stage, commit, or push Pages files", async () => {
    const { root, origin } = makeGitRepo();
    const date = "2026-05-15";
    mkdirSync(join(root, "docs", "assets", date), { recursive: true });
    writeFileSync(join(root, "docs", "index.html"), "<!doctype html><title>unapproved</title>\n");
    writeFileSync(join(root, "docs", "assets", date, "slot-01.png"), "unapproved image");
    const localHead = git(root, ["rev-parse", "HEAD"]);
    const remoteHead = git(origin, ["rev-parse", "main"]);

    await expect(publishPagesAssets(date, root)).rejects.toThrow(/Canonical public approval is required/);

    expect(git(root, ["rev-parse", "HEAD"])).toBe(localHead);
    expect(git(origin, ["rev-parse", "main"])).toBe(remoteHead);
    expect(git(root, ["diff", "--cached", "--name-only"])).toBe("");
  });

  gitIt("rejects tampered or fingerprint-mismatched approval evidence before Pages commit", async () => {
    const { root, origin } = makeGitRepo();
    const date = "2026-05-15";
    await seedCanonicalPublicApproval(root, date);
    writeFileSync(join(root, "docs", "index.html"), "<!doctype html><title>approved-looking</title>\n");
    const localHead = git(root, ["rev-parse", "HEAD"]);
    const remoteHead = git(origin, ["rev-parse", "main"]);

    const calendarPath = join(root, "data", "content-calendar", `${date}.json`);
    const tampered = JSON.parse(readFileSync(calendarPath, "utf8")) as { slots: Array<{ topic: string }> };
    tampered.slots[0]!.topic = "changed after approval";
    writeFileSync(calendarPath, `${JSON.stringify(tampered)}\n`, "utf8");
    await expect(publishPagesAssets(date, root)).rejects.toThrow(/integrity\/tamper inspection/);

    await seedCanonicalPublicApproval(root, date);
    const fingerprintsPath = join(root, "data", "approved-log", `${date}.fingerprints.json`);
    const fingerprints = JSON.parse(readFileSync(fingerprintsPath, "utf8")) as Record<string, string>;
    fingerprints["1"] = "0".repeat(64);
    writeFileSync(fingerprintsPath, `${JSON.stringify(fingerprints)}\n`, "utf8");
    await expect(publishPagesAssets(date, root)).rejects.toThrow(/fingerprint mismatch/);

    expect(git(root, ["rev-parse", "HEAD"])).toBe(localHead);
    expect(git(origin, ["rev-parse", "main"])).toBe(remoteHead);
    expect(git(root, ["diff", "--cached", "--name-only"])).toBe("");
  });

  gitIt("rejects a reviewed Reel whose local MP4 was replaced before Pages commit", async () => {
    const { root, origin } = makeGitRepo();
    const date = "2026-05-15";
    const slots = await seedCanonicalPublicApproval(root, date, { withApprovedVideo: true });
    const reel = slots.find((slot) => slot.slot === 3);
    if (!reel?.local_video_path) throw new Error("video fixture must include a Reel path");
    writeFileSync(join(root, "docs", "index.html"), "<!doctype html><title>video proof</title>\n");
    await expect(publishPagesAssets(date, root)).resolves.toContain("Published GitHub Pages assets");
    writeFileSync(join(root, ...reel.local_video_path.split("/")), "replaced-video-bytes", "utf8");
    const localHead = git(root, ["rev-parse", "HEAD"]);
    const remoteHead = git(origin, ["rev-parse", "main"]);

    await expect(publishPagesAssets(date, root)).rejects.toThrow(/Reviewed video file changed after approval/);

    expect(git(root, ["rev-parse", "HEAD"])).toBe(localHead);
    expect(git(origin, ["rev-parse", "main"])).toBe(remoteHead);
    expect(git(root, ["diff", "--cached", "--name-only"])).toBe("");
  });

  gitIt("does not commit .env when publishing Pages assets", async () => {
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

    await seedCanonicalPublicApproval(root, date);
    const result = await publishPagesAssets(date, root);
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

  gitIt("mirrors docs contents to a root Pages repository", async () => {
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

    await seedCanonicalPublicApproval(root, date);
    const result = await publishPagesAssets(date, root, rootPagesOrigin);
    const mirrorTree = git(rootPagesOrigin, ["ls-tree", "-r", "main", "--name-only"]);

    expect(result).toContain("Mirrored public site to root Pages repo");
    expect(mirrorTree).toContain("index.html");
    expect(mirrorTree).toContain(`content-calendar/${date}.json`);
    expect(mirrorTree).toContain(`assets/${date}/slot-01.png`);
    expect(mirrorTree).not.toContain("docs/index.html");
    expect(mirrorTree).not.toContain(".env");
  }, 45000);

  gitIt("publishes approved post article pages alongside the rest of the SEO assets", async () => {
    const { root } = makeGitRepo();
    const date = "2026-05-15";

    mkdirSync(join(root, "docs", "assets", date), { recursive: true });
    mkdirSync(join(root, "docs", "content-calendar"), { recursive: true });
    mkdirSync(join(root, "docs", "posts"), { recursive: true });
    writeFileSync(join(root, "docs", "index.html"), "<!doctype html><title>ok</title>\n");
    writeFileSync(join(root, "docs", "content-calendar", `${date}.json`), '{"slots":[]}\n');
    writeFileSync(join(root, "docs", "assets", date, "slot-01.png"), "fake image");
    writeFileSync(join(root, "docs", "posts", `${date}-slot-01.html`), "<!doctype html><title>post</title>\n");
    writeFileSync(join(root, "docs", "posts", `${date}-slot-02.html`), "<!doctype html><title>post-2</title>\n");

    await seedCanonicalPublicApproval(root, date);
    const result = await publishPagesAssets(date, root);
    const tree = git(root, ["ls-tree", "-r", "HEAD", "--name-only"]);

    expect(result).toContain("Published GitHub Pages assets");
    expect(tree).toContain(`docs/posts/${date}-slot-01.html`);
    expect(tree).toContain(`docs/posts/${date}-slot-02.html`);
  }, 15000);

  gitIt("refuses to publish text files that look like they contain secrets", async () => {
    const { root } = makeGitRepo();
    const date = "2026-05-15";

    mkdirSync(join(root, "docs", "assets", date), { recursive: true });
    mkdirSync(join(root, "docs", "content-calendar"), { recursive: true });
    writeFileSync(join(root, "docs", "index.html"), "<!doctype html><title>ok</title>\n");
    writeFileSync(join(root, "docs", "content-calendar", `${date}.json`), '{"META_ACCESS_TOKEN":"EAA-secret"}\n');
    writeFileSync(join(root, "docs", "assets", date, "slot-01.png"), "fake image");

    await seedCanonicalPublicApproval(root, date);
    await expect(publishPagesAssets(date, root)).rejects.toThrow("possible secret");
  }, 15000);

  gitIt("catches a bare token pasted into content, with no variable name beside it", async () => {
    // The named-key patterns never fire on the realistic leak: a raw token
    // that ended up inside a caption or feed. Only the bare-value regexes
    // catch that, and they had no positive case at all.
    const { root } = makeGitRepo();
    const date = "2026-05-15";

    mkdirSync(join(root, "docs", "assets", date), { recursive: true });
    mkdirSync(join(root, "docs", "content-calendar"), { recursive: true });
    writeFileSync(join(root, "docs", "index.html"), "<!doctype html><title>ok</title>\n");
    writeFileSync(join(root, "docs", "assets", date, "slot-01.png"), "fake image");
    writeFileSync(
      join(root, "docs", "content-calendar", `${date}.json`),
      `{"caption":"contact us EAA${"a1B2".repeat(8)} thanks"}\n`
    );

    await seedCanonicalPublicApproval(root, date);
    await expect(publishPagesAssets(date, root)).rejects.toThrow("possible secret");
  }, 15000);

  gitIt("scans xml and jsonl publish targets too", async () => {
    // sitemap.xml and llms.jsonl are in the publish list but were not in the
    // text-file extension list, so they shipped unscanned.
    const { root } = makeGitRepo();
    const date = "2026-05-15";

    mkdirSync(join(root, "docs", "assets", date), { recursive: true });
    mkdirSync(join(root, "docs", "content-calendar"), { recursive: true });
    writeFileSync(join(root, "docs", "index.html"), "<!doctype html><title>ok</title>\n");
    writeFileSync(join(root, "docs", "content-calendar", `${date}.json`), '{"slots":[]}\n');
    writeFileSync(join(root, "docs", "assets", date, "slot-01.png"), "fake image");
    writeFileSync(join(root, "docs", "sitemap.xml"), `<urlset>sk-${"x".repeat(24)}</urlset>\n`);

    await seedCanonicalPublicApproval(root, date);
    await expect(publishPagesAssets(date, root)).rejects.toThrow("possible secret");
  }, 15000);
});
