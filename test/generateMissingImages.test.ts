import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PROD_SCRIPT = join(ROOT, "scripts", "generate-missing-images.ps1");
const SMOKE_SCRIPT = join(ROOT, "test", "ps-carousel-slot-items.smoke.ps1");

/** Slice by the next top-level `function`, not the first `}`. The body has a foreach. */
function carouselSlotItemsFunction(source: string): string {
  const start = source.search(/function Get-CarouselSlotItems\b/u);
  if (start < 0) throw new Error("Get-CarouselSlotItems not found");
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

function lastJsonObject(stdout: string): Record<string, unknown> {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"));
  const line = lines.at(-1);
  if (!line) throw new Error(`carousel slot smoke printed no JSON object\n${stdout}`);
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

describe("Get-CarouselSlotItems PS-layer smoke (F20 fish-1)", () => {
  it("pins the production wrap to ToArray plus unary comma, not @($group)", async () => {
    const source = await readFile(PROD_SCRIPT, "utf8");
    const fn = carouselSlotItemsFunction(source);
    expect(fn).toMatch(/function Get-CarouselSlotItems\(/u);
    expect(fn).toMatch(/return\s+,\(\s*\$group\.ToArray\(\)\s*\)/u);
    expect(fn).not.toMatch(/return\s+@\(\s*\$group\s*\)/u);
    // Body contains a foreach `}`; slicing to the next function keeps the return.
    expect(fn).toContain("06:30 first flight died here");
    expect(fn).not.toContain("function Test-CarouselSlotComplete");
  });

  it.runIf(process.platform === "win32")(
    "invokes the production function; one-item slots stay arrays (CI-safe teeth)",
    () => {
      const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SMOKE_SCRIPT],
        { encoding: "utf8", cwd: ROOT, timeout: 30000 }
      );
      const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}${result.error ? String(result.error) : ""}`;
      expect(result.status, out).toBe(0);
      expect(out).toMatch(/EXTRACT_OK name=Get-CarouselSlotItems/u);
      expect(out).toMatch(/WRAP_OK=TOARRAY_COMMA/u);
      expect(out).toMatch(/PROD_OK name=three count=3 is_array=True/u);
      expect(out).toMatch(/PROD_OK name=one count=1 is_array=True/u);
      expect(out).toMatch(/PROD_OK name=zero count=0 is_array=True/u);
      expect(out).toMatch(/SMOKE_OK/u);
      expect(out).not.toMatch(/PROD_THROW/u);
      expect(out).not.toMatch(/WRAP_FAIL/u);
      expect(lastJsonObject(out)).toEqual({
        ok: true,
        wrap: "toarray_comma",
        host_list_wrap_bug: expect.any(Boolean),
        slot1_count: 3,
        slot1_is_array: true,
        slot2_count: 1,
        slot2_is_array: true,
        slot3_count: 0,
        slot3_is_array: true
      });
    },
    30000
  );
});
