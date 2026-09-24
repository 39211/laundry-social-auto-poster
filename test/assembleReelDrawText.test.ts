import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PROD_SCRIPT = join(ROOT, "scripts", "assemble-reel.ps1");
const SMOKE_SCRIPT = join(ROOT, "test", "ps-drawtext-colon.smoke.ps1");

/** Get-DrawText is the only function; slice to its closing brace. */
function drawTextFunction(source: string): string {
  const start = source.search(/function Get-DrawText\b/u);
  if (start < 0) throw new Error("Get-DrawText not found");
  const close = source.indexOf("\n}", start);
  if (close < 0) throw new Error("Get-DrawText closing brace not found");
  return source.slice(start, close + 2);
}

function lastJsonObject(stdout: string): Record<string, unknown> {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"));
  const line = lines.at(-1);
  if (!line) throw new Error(`drawtext smoke printed no JSON object\n${stdout}`);
  return JSON.parse(line) as Record<string, unknown>;
}

describe("Get-DrawText PS-layer smoke (F12 colon trap)", () => {
  it("pins fontsize and y to subexpressions, not $var:name scope syntax", async () => {
    const source = await readFile(PROD_SCRIPT, "utf8");
    const fn = drawTextFunction(source);
    expect(fn).toMatch(/function Get-DrawText\b/u);
    expect(fn).toMatch(/fontsize=\$\(\$size\):fontcolor/u);
    expect(fn).toMatch(/y=\$\(\$Y\):enable/u);
    expect(fn).not.toMatch(/fontsize=\$size:fontcolor/u);
    expect(fn).not.toMatch(/y=\$Y:enable/u);
    expect(fn).not.toMatch(/\$hookSize:fontcolor/u);
    expect(fn).not.toContain("ffmpeg");
    expect(fn).not.toContain("Get-DrawText -Text");
    expect(source).toContain("$MaxTextWidth = 648");
    // Call sites must actually use the function (A9: a green helper with no
    // caller is not coverage). Both two-act and three-act paths.
    expect(source).toMatch(/Get-DrawText -Text \$Hook -From 0 -To 2\.6 -Y 200/u);
    expect(source).toMatch(/Get-DrawText -Text \$Close /u);
    const hookCalls = source.split("Get-DrawText -Text $Hook").length - 1;
    const closeCalls = source.split("Get-DrawText -Text $Close").length - 1;
    expect(hookCalls).toBe(2);
    expect(closeCalls).toBe(2);
  });

  it.runIf(process.platform === "win32")(
    "invokes the production function; colon after a variable stays a literal colon",
    () => {
      const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SMOKE_SCRIPT],
        { encoding: "utf8", cwd: ROOT, timeout: 30000 }
      );
      const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}${result.error ? String(result.error) : ""}`;
      expect(result.status, out).toBe(0);
      expect(out).toMatch(/EXTRACT_OK name=Get-DrawText/u);
      expect(out).toMatch(/WRAP_OK=SUBEXPRESSION_COLON/u);
      expect(out).toMatch(/SMOKE_OK/u);
      expect(out).not.toMatch(/CASE_FAIL/u);
      expect(out).not.toMatch(/WRAP_FAIL/u);
      expect(lastJsonObject(out)).toEqual({
        ok: true,
        wrap: "subexpression_colon",
        fontsize_short: 52,
        fontsize_long: 43,
        colon_escaped: true,
        y_enable: true,
        empty_fontsize: false
      });
    },
    30000
  );
});
