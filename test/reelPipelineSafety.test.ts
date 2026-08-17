import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const extractFrames = readFileSync(join(root, "scripts", "extract-reel-frames.ps1"), "utf8");
const burnSubs = readFileSync(join(root, "scripts", "burn-narration-subs.ps1"), "utf8");
const assembleReel = readFileSync(join(root, "scripts", "assemble-reel.ps1"), "utf8");
const produceNext = readFileSync(join(root, "scripts", "produce-next-reel.ps1"), "utf8");

describe("extract-reel-frames failure contract", () => {
  it("clears the old frames directory before extracting", () => {
    expect(extractFrames).toMatch(/if \(Test-Path \$dir\) \{[\s\S]{0,120}Remove-Item \$dir/u);
  });

  it("checks ffmpeg LASTEXITCODE and does not treat leftover PNGs as success", () => {
    expect(extractFrames).toMatch(/\$LASTEXITCODE -ne 0/u);
    expect(extractFrames).not.toMatch(/2>&1 \| Out-Null/u);
    expect(extractFrames).toContain('name = "1-hook"');
    expect(extractFrames).toContain("$($p.name).png");
  });
});

describe("burn-narration-subs failure contract", () => {
  it("checks ffmpeg LASTEXITCODE and uses a unique or pre-deleted tmp", () => {
    expect(burnSubs).toMatch(/\$LASTEXITCODE -ne 0/u);
    expect(burnSubs).toMatch(/subs-tmp/u);
    expect(burnSubs).toMatch(/Remove-Item \$tmpOut|subs-tmp-\$PID|subs-tmp-\$\{?PID/u);
  });

  it("re-extracts frames when the burned marker is present but frames are missing", () => {
    expect(burnSubs).toMatch(/already burned[\s\S]{0,800}extract-reel-frames/u);
  });
});

describe("assembly failure contract", () => {
  it("does not keep a pre-existing assemble-reel mp4 as the new output", () => {
    expect(assembleReel).toMatch(/Remove-Item \$out -Force/u);
    expect(assembleReel).toMatch(/\$LASTEXITCODE -ne 0/u);
    expect(assembleReel).toMatch(/LastWriteTime/u);
  });

  it("does not keep a pre-existing treated-assembly mp4 as the new output", () => {
    expect(produceNext).toMatch(/Remove-Item \$OutPath -Force/u);
    expect(produceNext).toMatch(/Treated assembly[\s\S]{0,200}\$LASTEXITCODE/u);
    expect(produceNext).toMatch(/Get-Content \$ffLog -Tail 5 -Encoding utf8/u);
  });
});
