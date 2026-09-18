import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("GA4 collector AI traffic handoff", () => {
  it("collects the read-only AI view and preserves unmeasured on missing OAuth", async () => {
    const script = await readFile(join(process.cwd(), "scripts", "ga4-collect.ps1"), "utf8");

    expect(script).toContain('npm.cmd run ga4-ai-traffic -- --date $date --no-fail');
    expect(script).toContain('"ga4-ai-traffic exited $exitAi; organic and AI traffic remain unmeasured."');
    expect(script).toContain('"ga4-ai-traffic reported unmeasured; no zero was recorded."');
  });
});
