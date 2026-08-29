import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const produceSrc = readFileSync(join(root, "scripts", "produce-next-reel.ps1"), "utf8");

// F39 / ERROR-BOOK 2026-08-29: the clip generator used to live outside the
// repository (Documents/Codex/.../copx) and its manifest template lived under
// output/. A disk cleanup deleted both, and every production run died silently
// before the scheduling and review-record sections -- noon reels degraded to
// image posts for three days with posted-log still saying success. These tests
// pin the repaired shape: generation runs through a repo-tracked script, and
// no run-time dependency lives in a purgeable location.
describe("F39 hermes clip generation wiring", () => {
  it("routes clip generation through the repo-tracked hermes wrapper", () => {
    expect(produceSrc).toContain('scripts\\generate-clip-hermes.ps1');
    expect(existsSync(join(root, "scripts", "generate-clip-hermes.ps1"))).toBe(true);
    expect(existsSync(join(root, "scripts", "gen_clip_hermes.py"))).toBe(true);
  });

  it("no longer reads its manifest template from purgeable output/", () => {
    expect(produceSrc).not.toContain("white-shoe-yellowing-before.json");
  });

  it("no longer calls the deleted metered copx generator", () => {
    // Pin the call shape, not the word: prose may mention copx when telling
    // the story of why it is gone, but no invocation of it may remain.
    expect(produceSrc).not.toContain("generate-shot.ps1");
    expect(produceSrc).not.toContain("ConfirmPaidRun");
    expect(produceSrc).not.toMatch(/Codex\\2026-06-30/);
  });

  it("keeps the per-shot manifest as a self-contained literal with the generation parameters", () => {
    // The manifest is provenance for scheduleReel's video-sources record; the
    // parameters that used to ride the July template must survive in-script.
    for (const field of ["duration_seconds", "aspect_ratio", "resolution", "generation_id", "source_shot_id"]) {
      expect(produceSrc, `manifest literal is missing ${field}`).toContain(field);
    }
  });

  it("wrapper delegates to the hermes venv python, not system python", () => {
    const wrapper = readFileSync(join(root, "scripts", "generate-clip-hermes.ps1"), "utf8");
    expect(wrapper).toContain("hermes-agent\\venv\\Scripts\\python.exe");
    expect(wrapper).toContain("gen_clip_hermes.py");
  });

  it("python generator remuxes to video-only so the assembler's [0:v] matches one stream", () => {
    const py = readFileSync(join(root, "scripts", "gen_clip_hermes.py"), "utf8");
    expect(py).toContain('"-map", "0:v:0"');
    expect(py).toContain("run_xai_video_generation");
  });
});
