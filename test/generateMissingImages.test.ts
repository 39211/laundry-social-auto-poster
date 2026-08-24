import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PROD_SCRIPT = join(ROOT, "scripts", "generate-missing-images.ps1");
const SMOKE_SCRIPT = join(ROOT, "test", "ps-carousel-slot-items.smoke.ps1");

function carouselSlotItemsFunction(source: string): string {
  const match = source.match(/function Get-CarouselSlotItems[\s\S]*?\r?\n\}/);
  if (!match) throw new Error("Get-CarouselSlotItems not found");
  return match[0];
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

describe("Get-CarouselSlotItems PS-layer smoke (F20 fish-1)", () => {
  it("pins the production wrap to ToArray plus unary comma, not @($group)", async () => {
    const source = await readFile(PROD_SCRIPT, "utf8");
    const fn = carouselSlotItemsFunction(source);
    expect(fn).toMatch(/return\s+,\(\$group\.ToArray\(\)\)/);
    expect(fn).not.toMatch(/return\s+@\(\$group\)/);
  });

  it("invokes the production function in PS 5.1 and the pre-fix wrap still throws", () => {
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SMOKE_SCRIPT],
      { encoding: "utf8", cwd: ROOT, timeout: 30000 }
    );
    const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}${result.error ? String(result.error) : ""}`;
    expect(result.status, out).toBe(0);
    expect(out).toMatch(/EXTRACT_OK name=Get-CarouselSlotItems/);
    expect(out).toMatch(/RETURN_LINE=return ,\(\$group\.ToArray\(\)\)/);
    expect(out).toMatch(/BADWRAP_THREW=true/);
    expect(out).toMatch(/PROD_OK name=three count=3/);
    expect(out).toMatch(/PROD_OK name=one count=1/);
    expect(out).toMatch(/PROD_OK name=zero count=0/);
    expect(out).toMatch(/SMOKE_OK/);
    expect(out).not.toMatch(/PROD_THROW/);
    expect(out).not.toMatch(/BADWRAP_NO_THROW/);
  });
});
