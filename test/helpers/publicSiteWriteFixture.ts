import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

export const FIXTURE_NOW = "2026-10-28T04:00:00.000Z";

/** Synthetic text inputs only; no production calendars, credentials or media. */
export async function writePublicSiteFixture(root: string, options: { approved?: boolean } = {}): Promise<void> {
  const data = join(root, "data");
  await mkdir(join(data, "content-calendar"), { recursive: true });
  await mkdir(join(data, "approved-log"), { recursive: true });
  await mkdir(join(root, "seo-overrides", "fixture"), { recursive: true });
  const profile = {
    name: "Fixture Laundry", google_business_profile_name: "Fixture Laundry", alternate_names: [],
    address: { "@type": "PostalAddress", postalCode: "000", addressRegion: "Fixture", addressLocality: "Fixture", streetAddress: "1 Test Road", addressCountry: "TW" },
    address_text: "1 Test Road", landmark: "Fixture", map_url: "https://example.invalid/map",
    google_maps_feature_id: "fixture", google_maps_cid: "fixture", google_place_id: null,
    facebook_url: "https://example.invalid/fb", facebook_share_url: "https://example.invalid/fb",
    instagram_url: "https://example.invalid/ig", line_url: "https://example.invalid/line", line_id: "fixture",
    telephone: "+886000000000", telephone_local: "0000000000", mobile_or_line: "0000000000", mobile_or_line_local: "0000000000",
    opening_hours_text: "Monday 09:00-17:00", opening_hours_schema: ["Mo 09:00-17:00"],
    opening_hours_specification: [{ "@type": "OpeningHoursSpecification", dayOfWeek: "Monday", opens: "09:00", closes: "17:00" }],
    holiday_hours_rule: { default_rule: "fixture", social_content_rule: "fixture", schema_rule: "fixture", major_holidays: [], overrides: [] },
    service_topics: ["Laundry"], source_notes: ["Synthetic fixture"], verification_status: {}
  };
  await writeFile(join(data, "business-profile.json"), JSON.stringify(profile));
  for (let day = 1; day <= 12; day += 1) {
    const date = `2026-10-${String(day).padStart(2, "0")}`;
    const slots = [1, 2].map((slot) => ({
      slot, time: slot === 1 ? "11:30" : "19:30", category: slot === 1 ? "knowledge" : "situation",
      topic: `Fixture ${day} ${slot}`, instagram_caption: "Fixture caption", facebook_caption: "Fixture caption",
      image_prompt: "fixture", visual_route: "shop-inspection", traffic_route: "object-proof",
      search_intent: "problem-diagnosis", target_queries: ["fixture"], evidence_type: "first-party-inspection",
      local_image_path: `docs/assets/${date}/slot-0${slot}.png`, public_image_url: "", status: "pending"
    }));
    await writeFile(join(data, "content-calendar", `${date}.json`), JSON.stringify({ date, timezone: "Asia/Taipei", generated_at: `${date}T00:00:00.000Z`, slots }));
    const approvals = slots.flatMap(({ slot }) => ["facebook", "instagram"].map((platform) => ({
      date, slot, platform, status: "approved", approved_by: "Fixture", note: "Synthetic", created_at: `${date}T01:00:00.000Z`
    })));
    await writeFile(join(data, "approved-log", `${date}.json`), JSON.stringify(options.approved === false ? [] : approvals));
  }
  for (let i = 0; i < 20; i += 1) {
    await writeFile(join(root, "seo-overrides", "fixture", `${i}.txt`), `fixture ${i}\n`);
  }
}


interface CliMetrics { active: number; max: number; writes: number; mutations: number; }

export async function runPublicSiteCli(root: string, args: string[], limit: string) {
  const probeRoot = await mkdtemp(join(tmpdir(), "site-write-cli-probe-"));
  try {
    const home = join(probeRoot, "profile");
    await mkdir(join(home, "AppData", "Roaming"), { recursive: true });
    const report = join(probeRoot, "metrics.json");
    const hook = join(probeRoot, "probe.mjs");
    await writeFile(hook, [
      'import fs from "node:fs/promises";',
      'import { writeFileSync } from "node:fs";',
      'import { resolve, sep } from "node:path";',
      'import { syncBuiltinESMExports } from "node:module";',
      'import http from "node:http"; import https from "node:https";',
      'const root = resolve(process.env.SITE_WRITE_PROBE_ROOT).toLowerCase();',
      'const inside = (path) => { const p = resolve(String(path)).toLowerCase(); return p === root || p.startsWith(root + sep); };',
      'const metrics = { active: 0, max: 0, writes: 0, mutations: 0 };',
      'for (const kind of ["writeFile", "copyFile", "mkdir", "rename", "unlink"]) {',
      '  const original = fs[kind];',
      '  fs[kind] = async (...args) => {',
      '    const target = args[kind === "copyFile" || kind === "rename" ? 1 : 0];',
      '    if (!inside(target)) return original(...args);',
      '    metrics.mutations += 1;',
      '    const write = kind === "writeFile" || kind === "copyFile";',
      '    if (write) { metrics.writes += 1; metrics.active += 1; metrics.max = Math.max(metrics.max, metrics.active); }',
      '    try { if (write) await new Promise((done) => setImmediate(done)); return await original(...args); }',
      '    finally { if (write) metrics.active -= 1; }',
      '  };',
      '}',
      'const denied = () => { throw new Error("Network disabled in public-site CLI fixture"); };',
      'globalThis.fetch = denied; http.request = denied; http.get = denied; https.request = denied; https.get = denied;',
      'syncBuiltinESMExports();',
      'process.on("exit", () => writeFileSync(process.env.SITE_WRITE_PROBE_REPORT, JSON.stringify(metrics)));'
    ].join("\n"));
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "ComSpec", "PATH", "Path", "PATHEXT",
      "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE"]) if (process.env[key] !== undefined) env[key] = process.env[key];
    Object.assign(env, {
      TEMP: probeRoot, TMP: probeRoot, USERPROFILE: home, HOME: home, APPDATA: join(home, "AppData", "Roaming"),
      PUBLIC_SITE_BASE_URL: "https://sixiangjialaundry.com", PUBLIC_IMAGE_BASE_URL: "https://example.invalid",
      PUBLIC_SITE_WRITE_CONCURRENCY: limit, DRY_RUN: "true", NO_COLOR: "1",
      SITE_WRITE_PROBE_ROOT: root, SITE_WRITE_PROBE_REPORT: report
    });
    const command = ["--import", "tsx", "--import", pathToFileURL(hook).href,
      join(process.cwd(), "src", "generatePublicSite.ts"), "--root", root, "--base-url", "https://sixiangjialaundry.com", ...args];
    const result = spawnSync(process.execPath, command, {
      cwd: process.cwd(), env, encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024
    });
    const metrics = existsSync(report) ? JSON.parse(await readFile(report, "utf8")) as CliMetrics : null;
    const receipt = { executable: process.execPath, args: command, cwd: process.cwd(), status: result.status, signal: result.signal,
      error: result.error ? String(result.error) : null, stdout: result.stdout, stderr: result.stderr, metrics };
    if (process.env.PUBLIC_SITE_CLI_RECEIPTS) await appendFile(process.env.PUBLIC_SITE_CLI_RECEIPTS, JSON.stringify(receipt) + "\n");
    return receipt;
  } finally {
    if (dirname(resolve(probeRoot)) !== resolve(tmpdir())) throw new Error("Refusing cleanup outside CLI test temp root");
    await rm(probeRoot, { recursive: true, force: true });
  }
}
