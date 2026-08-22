import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function runCarouselSlotSmoke(): { status: number; stdout: string; stderr: string } {
  const smoke = join(process.cwd(), "test", "carouselSlotItems.smoke.ps1");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", smoke],
    { encoding: "utf8", cwd: process.cwd() }
  );
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: `${result.stderr ?? ""}${result.error ? String(result.error) : ""}`
  };
}

function lastJsonLine(stdout: string): Record<string, unknown> {
  const line = stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) throw new Error("carousel slot smoke printed no JSON");
  return JSON.parse(line) as Record<string, unknown>;
}

describe("generate-missing-images inventory", () => {
  it("judges completeness from generate-image-manifest --list-missing, not a self-scan of the manifest", async () => {
    const source = await readFile(new URL("../scripts/generate-missing-images.ps1", import.meta.url), "utf8");
    expect(source).toContain("generate-image-manifest");
    expect(source).toContain("--list-missing");
    expect(source).toMatch(/--date \$Date/);
    expect(source).toContain("Every image for $Date was already present.");
    expect(source).not.toMatch(/if\s*\(\s*\$generated\s*-eq\s*0\s*\)[\s\S]{0,240}Every image/);
    expect(source).toContain("Inventory is the calendar");
  });

  it("runs carousel QA for already-complete slots and on -QaOnly", async () => {
    const source = await readFile(new URL("../scripts/generate-missing-images.ps1", import.meta.url), "utf8");
    expect(source).toContain("[switch]$QaOnly");
    expect(source).toContain("Ensure-CarouselVisualQa");
    expect(source).toContain("topic tempfile write failed");
    expect(source).toContain("visual-qa.json write failed");
    expect(source).toContain("slot-$pad.visual-qa.json");
    const qaOnly = source.indexOf("if ($QaOnly)");
    const ensureDef = source.indexOf("function Ensure-CarouselVisualQa");
    const ensureCall = source.lastIndexOf("Ensure-CarouselVisualQa $items");
    expect(qaOnly).toBeGreaterThan(-1);
    expect(ensureDef).toBeGreaterThan(-1);
    expect(ensureCall).toBeGreaterThan(qaOnly);
    expect(source).toContain("if (Test-Path -LiteralPath $qaPath) { continue }");
  });
});

describe("Get-CarouselSlotItems PS 5.1 smoke (F20 fish-1)", { timeout: 20000 }, () => {
  it("production return uses ToArray plus unary comma, not @($group)", async () => {
    const source = await readFile(new URL("../scripts/generate-missing-images.ps1", import.meta.url), "utf8");
    expect(source).toMatch(/function Get-CarouselSlotItems\(/);
    expect(source).toMatch(/return\s*,\(\s*\$group\.ToArray\(\)\s*\)/);
    expect(source).not.toMatch(/return\s+@\(\s*\$group\s*\)/);
  });

  it("executes the production function against PSCustomObjects on PS 5.1", () => {
    const result = runCarouselSlotSmoke();
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(lastJsonLine(result.stdout)).toEqual({
      ok: true,
      slot1_count: 3,
      slot2_count: 1,
      slot3_count: 0,
      slot2_is_array: true
    });
  });
});
