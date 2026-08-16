import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

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
});
