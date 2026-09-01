import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("GSC collector exposure-review handoff", () => {
  it("propagates a failed reader to the reviewer instead of reusing a previous same-day pass", async () => {
    const script = await readFile(join(process.cwd(), "scripts", "gsc-collect.ps1"), "utf8");

    expect(script).toContain("if (-not $analyticsHealthy -or -not $inspectionHealthy)");
    expect(script).toContain('$reviewCommand += " --force-block"');
    expect(script).toContain('cmd /c "$reviewCommand 2>&1"');
  });
});
