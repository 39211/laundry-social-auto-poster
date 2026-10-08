import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readScript(name: string): string {
  return readFileSync(join(ROOT, "scripts", name), "utf8");
}

function codexExecLines(source: string): string[] {
  return [...source.matchAll(/& \$codex exec\b[^\r\n]*/gu)].map((match) => match[0]);
}

describe("image route is GPT Codex only", () => {
  it("R1 generate-missing-images passes -m on every codex exec and has no Google image fallback", () => {
    const source = readScript("generate-missing-images.ps1");
    const calls = codexExecLines(source);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).toMatch(/& \$codex exec\s+-m\b/u);
    }
    expect(source.toLowerCase()).not.toContain("agy");
    expect(source).not.toContain("Invoke-AgyImageFallback");
    expect(source).not.toContain("google-agy-image");
  });

  it("R2 daily-generate passes -m on every codex exec", () => {
    const source = readScript("daily-generate.ps1");
    const calls = codexExecLines(source);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).toMatch(/& \$codex exec\s+-m\b/u);
    }
  });

  it("R3 schedule-ahead-daily logs missing images and does not call Grok", () => {
    const source = readScript("schedule-ahead-daily.ps1");
    expect(source).not.toContain("hermes-image-gen.py");
    expect(source).not.toContain("grok-imagine-image");
    expect(source).toContain("IMAGE-MISSING");
    expect(source).toContain("image-missing");
  });

  it("R5 Get-LaundryCodexModel defaults, honors override, and trims blank", () => {
    const env = { ...process.env };
    delete env.LAUNDRY_CODEX_MODEL;
    const result = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(ROOT, "test", "ps-codex-model.smoke.ps1")
      ],
      { encoding: "utf8", cwd: ROOT, timeout: 30000, env }
    );
    const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}${result.error ? String(result.error) : ""}`;
    expect(result.status, out).toBe(0);
    const line = out
      .split(/\r?\n/u)
      .map((row) => row.trim())
      .filter((row) => row.startsWith("{") && row.endsWith("}"))
      .at(-1);
    expect(line, out).toBeTruthy();
    expect(JSON.parse(line ?? "{}")).toEqual({
      "generate-missing-images.ps1": {
        unset: "gpt-5.6-luna",
        "gpt-6-sol": "gpt-6-sol",
        blank: "gpt-5.6-luna"
      },
      "daily-generate.ps1": {
        unset: "gpt-5.6-luna",
        "gpt-6-sol": "gpt-6-sol",
        blank: "gpt-5.6-luna"
      }
    });
  }, 30000);
});
