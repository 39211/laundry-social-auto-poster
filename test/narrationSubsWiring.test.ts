import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Publish-side lesson from the 2026-08-15 review (grok MUTATION_2): a module
// with green unit tests and no caller proves nothing — deleting the call left
// everything green. These tests read the production scripts themselves, so
// unwiring the subtitle burn turns red here even though every module test
// still passes.

const root = join(__dirname, "..");
const produceNextReel = readFileSync(join(root, "scripts", "produce-next-reel.ps1"), "utf8");
const assembleReel = readFileSync(join(root, "scripts", "assemble-reel.ps1"), "utf8");
const burnScript = readFileSync(join(root, "scripts", "burn-narration-subs.ps1"), "utf8");

describe("subtitle burn wiring", () => {
  it("assemble-reel burns narration subtitles with its own 500ms delay", () => {
    // The guard condition is part of the assertion: mutation testing showed
    // that matching only the call line stays green when the guard is turned
    // into `if ($false)` — the call text still exists, dead.
    expect(assembleReel).toMatch(
      /if \(\$hasNarration -and \$NarrationText\.Trim\(\)\) \{[\s\S]{0,300}burn-narration-subs\.ps1"\) -ReelPath \$out[\s\S]{0,200}-NarrationText \$NarrationText -TtsFile \$NarrationFile -DelayMs 500/u
    );
  });

  it("the treated assembly burns with the delay that assembly actually applied", () => {
    expect(produceNextReel).toMatch(
      /if \(\$hasNarration -and \$NarrationText -and \$NarrationText\.Trim\(\)\) \{[\s\S]{0,300}burn-narration-subs\.ps1"\) -ReelPath \$OutPath[\s\S]{0,200}-NarrationText \$NarrationText -TtsFile \$NarrationFile -DelayMs \$narrDelayMs/u
    );
  });

  it("every assemble-reel call site passes the narration text alongside the file", () => {
    const calls = produceNextReel.split(/assemble-reel\.ps1"\)/u).slice(1);
    expect(calls.length).toBe(4);
    for (const call of calls) {
      expect(call.slice(0, 500)).toContain("-NarrationText");
    }
  });

  it("the treated call site passes the treated narration, which matches the treated TTS", () => {
    expect(produceNextReel).toMatch(
      /Invoke-TreatedAssembly -ConceptId[\s\S]{0,300}-NarrationFile \$ttsTreated -NarrationText \$treatedNarrationText/u
    );
  });

  it("the burn script generates through the tested module and burns from inside the reel directory", () => {
    // The CLI is the only ASS author; a relative filename dodges the Windows
    // drive-letter trap in ffmpeg's ass filter.
    expect(burnScript).toContain("src\\reelSubtitlesCli.ts");
    expect(burnScript).toContain('ass=$baseName.ass');
    expect(burnScript).toMatch(/"-c:a",\s*"copy"/u);
  });

  it("the CLI writes ASS through temp-plus-rename, not a raw overwrite", () => {
    const cli = readFileSync(join(root, "src", "reelSubtitlesCli.ts"), "utf8");
    expect(cli).toContain("renameSync(tempPath, outPath)");
    expect(cli).not.toMatch(/writeFileSync\(outPath,\s*ass/u);
  });

  it("every burned reel gets story frames extracted for the eyes-on acceptance pass", () => {
    expect(burnScript).toMatch(/extract-reel-frames\.ps1"\) -ReelPath \$ReelPath/u);
  });

  it("does not skip frame extraction when a burned marker exists without frames", () => {
    expect(burnScript).toMatch(/already burned[\s\S]{0,800}extract-reel-frames/u);
  });

  it("the burn script degrades without blocking publishing, but leaves a visible marker", () => {
    expect(burnScript).toMatch(/burned\s*=\s*\$false/u);
    expect(burnScript).toMatch(/catch \{[\s\S]*exit 0/u);
    expect(burnScript).toContain('"$ReelPath.subs.json"');
  });
});

describe("reelSubtitlesCli end to end", () => {
  it("writes a portrait ASS file from a narration file and real durations", () => {
    const dir = mkdtempSync(join(tmpdir(), "reel-subs-"));
    const narrationFile = join(dir, "narration.txt");
    const outPath = join(dir, "out.ass");
    writeFileSync(
      narrationFile,
      "那是手腕的油脂日積月累壓進纖維裡，不是表面的髒。整件下水才會勻，只搓袖口反而會留下一圈更深的印子。",
      "utf8"
    );
    const stdout = execSync(
      `npx tsx "${join(root, "src", "reelSubtitlesCli.ts")}" --narration-file "${narrationFile}" --audio-seconds 9.312 --delay-ms 500 --video-seconds 14.0 --out "${outPath}"`,
      { cwd: root, encoding: "utf8" }
    );
    expect(stdout).toContain("cues=4");
    const ass = readFileSync(outPath, "utf8");
    expect(ass).toContain("PlayResX: 720");
    expect(ass).toContain("PlayResY: 1280");
    expect((ass.match(/^Dialogue:/gmu) ?? []).length).toBe(4);
    expect(ass).toContain("Dialogue: 0,0:00:00.50,");
  }, 30000);
});
