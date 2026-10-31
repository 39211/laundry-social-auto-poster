import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(__dirname, "..");
const script = join(repoRoot, "scripts", "hermes-image-gen.py");

// Stand-in for the hermes-agent tree: just the two modules the script imports.
// FAKE_XAI_ROUTE picks what resolve_xai_http_credentials() reports, and every
// provider.generate() call is appended to FAKE_GEN_LOG so a test can prove a
// refused route never reached the (billed) endpoint.
function fakeHermes(): string {
  const dir = mkdtempSync(join(tmpdir(), "fake-hermes-"));
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "plugins", "image_gen", "xai"), { recursive: true });
  for (const pkg of ["tools", "plugins", join("plugins", "image_gen")]) {
    writeFileSync(join(dir, pkg, "__init__.py"), "");
  }
  writeFileSync(
    join(dir, "tools", "xai_http.py"),
    [
      "import os",
      "def resolve_xai_http_credentials(**_kwargs):",
      "    route = os.environ['FAKE_XAI_ROUTE']",
      "    if route == 'missing':",
      "        return {'api_key': 'dummy-not-a-real-key'}",
      "    return {'provider': route, 'api_key': 'dummy-not-a-real-key'}"
    ].join("\n")
  );
  writeFileSync(
    join(dir, "plugins", "image_gen", "xai", "__init__.py"),
    [
      "import os",
      "class XAIImageGenProvider:",
      "    def is_available(self):",
      "        return True",
      "    def generate(self, prompt, **kwargs):",
      "        with open(os.environ['FAKE_GEN_LOG'], 'a', encoding='utf-8') as fh:",
      "            fh.write(prompt + '\\n')",
      "        return {'success': True, 'image': 'data:image/png;base64,AA=='}"
    ].join("\n")
  );
  return dir;
}

function runPython(args: string[], hermesDir: string, route: string, genLog: string) {
  try {
    const stdout = execFileSync("python", args, {
      cwd: repoRoot,
      env: { ...process.env, PYTHONPATH: hermesDir, FAKE_XAI_ROUTE: route, FAKE_GEN_LOG: genLog },
      encoding: "utf8"
    });
    return { status: 0, stdout };
  } catch (error) {
    const failed = error as { status: number; stdout: string };
    return { status: failed.status, stdout: failed.stdout };
  }
}

function generateOnce(route: string) {
  const hermesDir = fakeHermes();
  const genLog = join(hermesDir, "generate-calls.log");
  const code = [
    "import importlib.util, json",
    "from plugins.image_gen.xai import XAIImageGenProvider",
    `spec = importlib.util.spec_from_file_location('hermes_image_gen', r'${script}')`,
    "mod = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(mod)",
    "try:",
    "    ref = mod.generate_with_retry(XAIImageGenProvider(), 'test prompt')",
    "    print(json.dumps({'ok': True, 'ref': ref}))",
    "except RuntimeError as exc:",
    "    print(json.dumps({'ok': False, 'error': str(exc)}))"
  ].join("\n");
  const run = runPython(["-c", code], hermesDir, route, genLog);
  const lastLine = run.stdout.trim().split("\n").pop() ?? "";
  return {
    result: JSON.parse(lastLine) as { ok: boolean; ref?: string; error?: string },
    generateCalls: existsSync(genLog) ? readFileSync(genLog, "utf8").trim().split("\n").filter(Boolean).length : 0
  };
}

describe("hermes-image-gen subscription-only route", () => {
  it("generates through the xai-oauth subscription pool", () => {
    const { result, generateCalls } = generateOnce("xai-oauth");
    expect(result.ok).toBe(true);
    expect(generateCalls).toBe(1);
  });

  it("refuses the billed XAI_API_KEY fallback before calling the provider", () => {
    const { result, generateCalls } = generateOnce("xai");
    expect(result).toEqual({ ok: false, error: "non-OAuth xAI credential refused (route=xai)" });
    expect(generateCalls).toBe(0);
  });

  it("refuses a resolver that cannot say which route it picked", () => {
    const { result, generateCalls } = generateOnce("missing");
    expect(result).toEqual({ ok: false, error: "non-OAuth xAI credential refused (route=unknown)" });
    expect(generateCalls).toBe(0);
  });

  it("fails the whole run up front when the session starts on the billed route", () => {
    const hermesDir = fakeHermes();
    const genLog = join(hermesDir, "generate-calls.log");
    const planFile = join(hermesDir, "plan.json");
    const outFile = join(hermesDir, "result.json");
    writeFileSync(
      planFile,
      JSON.stringify({
        date: "2026-10-30",
        items: [
          {
            slot: 1,
            slide: 1,
            role: "hero",
            prompt: "test prompt",
            target_path: "docs/assets/2026-10-30/slot-01.png",
            public_image_url: "https://example.invalid/slot-01.png"
          }
        ]
      })
    );
    const run = runPython(
      [script, "--plan", planFile, "--out", outFile, "--root", hermesDir],
      hermesDir,
      "xai",
      genLog
    );
    expect(run.status).toBe(1);
    expect(JSON.parse(readFileSync(outFile, "utf8"))).toEqual({
      date: "2026-10-30",
      generated: [],
      failed: [{ slot: 0, reason: "non-OAuth xAI credential refused (route=xai)" }]
    });
    expect(existsSync(genLog)).toBe(false);
  });
});
