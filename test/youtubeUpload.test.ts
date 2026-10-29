import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PROD_SCRIPT = join(ROOT, "scripts", "youtube-upload.ps1");
const SMOKE_SCRIPT = join(ROOT, "test", "ps-youtube-live-reel.smoke.ps1");

function functionSlice(source: string, name: string): string {
  const start = source.search(new RegExp(`function ${name}\\b`, "u"));
  if (start < 0) throw new Error(`${name} not found`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

function lastJsonObject(stdout: string): Record<string, unknown> {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"));
  const line = lines.at(-1);
  if (!line) throw new Error(`youtube-upload live-reel smoke printed no JSON object\n${stdout}`);
  return JSON.parse(line) as Record<string, unknown>;
}

describe("youtube-upload live Reel predicate (F20 fish-1 sister wrap)", () => {
  it("pins assign-then-wrap and routes the slot loop through the pure helpers", async () => {
    const source = await readFile(PROD_SCRIPT, "utf8");
    const entry = functionSlice(source, "Test-LiveReelPostedEntry");
    const hasSlot = functionSlice(source, "Test-LiveReelHasSlot");
    expect(entry).toMatch(/function Test-LiveReelPostedEntry\b/u);
    expect(entry).toContain('if ($Entry.dry_run) { return $false }');
    expect(entry).toContain('@("success", "posted") -notcontains $status');
    expect(entry).toContain('[string]$Entry.published_media_type -eq "reel"');
    expect(entry).toContain('[string]$Entry.platform -ne "instagram"');
    expect(hasSlot).toMatch(/function Test-LiveReelHasSlot\b/u);
    expect(hasSlot).toContain("Test-LiveReelPostedEntry $_ $Slot");
    expect(hasSlot).toContain("@($Entries)");
    expect(source).toMatch(
      /\$postedParsed = Get-Content \$postedPath -Raw -Encoding utf8 \| ConvertFrom-Json/u
    );
    expect(source).toContain("Test-LiveReelHasSlot $postedParsed $slotNumber");
    expect(source).not.toMatch(/@\(\s*Get-Content \$postedPath[\s\S]{0,80}ConvertFrom-Json\s*\)/u);
    expect(source).not.toMatch(
      /\$reelLive = @\(\$posted \| Where-Object \{\s*\$_\.slot -eq \$slotNumber/u
    );
  });

  it.runIf(process.platform === "win32")(
    "invokes production helpers: live IG reel counts, dry_run/facebook/image do not",
    () => {
      const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SMOKE_SCRIPT],
        { encoding: "utf8", cwd: ROOT, timeout: 30000 }
      );
      const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}${result.error ? String(result.error) : ""}`;
      expect(result.status, out).toBe(0);
      expect(out).toMatch(/EXTRACT_OK name=Test-LiveReelPostedEntry/u);
      expect(out).toMatch(/EXTRACT_OK name=Test-LiveReelHasSlot/u);
      expect(out).toMatch(/WRAP_OK=ASSIGN_THEN_WRAP/u);
      expect(out).toMatch(/CASE_OK name=ig-reel-success-s3/u);
      expect(out).toMatch(/CASE_OK name=ig-reel-posted-s2/u);
      expect(out).toMatch(/CASE_OK name=dry-run-success/u);
      expect(out).toMatch(/CASE_OK name=facebook-reel/u);
      expect(out).toMatch(/CASE_OK name=ig-image/u);
      expect(out).toMatch(/CASE_OK name=mixed-array-s3/u);
      expect(out).toMatch(/CASE_OK name=mixed-array-s2-dry/u);
      expect(out).toMatch(/CASE_OK name=single-object-s2/u);
      expect(out).toMatch(/SMOKE_OK/u);
      expect(out).not.toMatch(/CASE_FAIL/u);
      expect(out).not.toMatch(/WRAP_FAIL/u);
      expect(lastJsonObject(out)).toEqual({
        ok: true,
        wrap: "assign_then_wrap",
        ig_reel_success: true,
        dry_run_counts: false,
        facebook_counts: false,
        image_counts: false,
        mixed_array_slot3: true,
        mixed_array_slot2_dry: false,
        single_object_slot2: true
      });
    },
    30000
  );
});
