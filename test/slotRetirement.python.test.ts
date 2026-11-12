import { spawnSync } from "node:child_process";
import { readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => { vi.stubEnv("PUBLIC_SITE_BASE_URL", "https://example.invalid"); });
import { retirementRoot, seedRetirementCalendar } from "./helpers/slotRetirementHarness";
let root: string;
const cwd = process.cwd();
const probe = `
import ast,json,os,sys
from pathlib import Path
repo,root,date=map(str,sys.argv[1:])
sys.path.insert(0,str(Path(repo)/'scripts'))
from slot_retirements import active_calendar
raw=json.loads((Path(root)/'data/content-calendar'/f'{date}.json').read_text(encoding='utf-8-sig'))
calendar=active_calendar(raw,root,date)
source=Path(repo)/'scripts/nightly_optimize.py'
tree=ast.parse(source.read_text(encoding='utf-8-sig'))
block=next(n for n in tree.body if isinstance(n,ast.If) and isinstance(n.test,ast.Name) and n.test.id=='today_cal')
findings=[]
scope={'today_cal':calendar,'ds':date,'os':os,'today_image_path':lambda d,n:str(Path(root)/f'image-{n}'),'today_image_fix':lambda d:'fixture-fix','add':lambda *args:findings.append(args)}
exec(compile(ast.Module(body=[block],type_ignores=[]),str(source),'exec'),scope)
print(json.dumps({'slots':[s['slot'] for s in calendar['slots']],'findings':findings},ensure_ascii=True))
`;
function run(date: string) {
  const result = spawnSync("C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe", ["-B", "-X", "utf8", "-c", probe, cwd, root, date], { cwd, encoding: "utf8", timeout: 30000, windowsHide: true });
  expect(result.status, `${result.stdout}\n${result.stderr}\n${result.error ?? ""}`).toBe(0);
  return { ...JSON.parse(result.stdout) as { slots: number[]; findings: string[][] }, stderr: result.stderr };
}
beforeEach(async () => {
  root = await retirementRoot();
  await seedRetirementCalendar(root, "2026-11-15"); await seedRetirementCalendar(root, "2026-11-16");
  await writeFile(join(root, "image-1"), "fixture image");
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
describe("nightly audit uses the shared retirement reader", () => {
  it("keeps old missing-image behavior on November 15 but emits no slot 2 HIGH on November 16", async () => {
    const before = run("2026-11-15"); expect(before.slots).toEqual([1, 2]); expect(before.findings).toHaveLength(1);
    const after = run("2026-11-16"); expect(after.slots).toEqual([1]); expect(after.findings).toEqual([]);
    expect(await readFile(join(cwd, "scripts/nightly_optimize.py"), "utf8")).toContain('today_cal = active_calendar(load(');
  }, 30000);
  it.each(["missing", "broken"])("fails closed for %s for both daily slots", async mode => {
    if (mode === "missing") await unlink(join(root, "src/slot-retirements.json"));
    else await writeFile(join(root, "src/slot-retirements.json"), "broken");
    const result = run("2026-11-16"); expect(result.slots).toEqual([]); expect(result.findings).toEqual([]); expect(result.stderr).toContain("fail closed");
  }, 30000);
});
