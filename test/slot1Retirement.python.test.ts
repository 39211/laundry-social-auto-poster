import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateDailyContent } from "../src/generateDailyContent";
import { writeJsonAtomic } from "../src/logging";
import { slot1Root, slot1Date as date } from "./helpers/slot1RetirementHarness";

const cwd = process.cwd(), python = "C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe";
let root: string;
function py(code: string) {
  const result = spawnSync(python, ["-B", "-X", "utf8", "-c", code, cwd, root], { cwd: root, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 45000, windowsHide: true });
  expect(result.status, `${result.stdout}\n${result.stderr}\n${result.error ?? ""}`).toBe(0);
  return { value: JSON.parse(result.stdout), stderr: result.stderr };
}
const head = `import ast,json,sys,os,warnings,subprocess,importlib.util
from pathlib import Path
from datetime import date,datetime,timedelta,timezone
from unittest.mock import patch
repo,root=map(Path,sys.argv[1:])
sys.path.insert(0,str(repo/'scripts'))
from slot_retirements import active_calendar,retired_slots,_retired_slots
`;
beforeEach(async () => { root = await slot1Root(); vi.stubEnv("PROJECT_ROOT", root); vi.stubEnv("PUBLIC_SITE_BASE_URL", "https://example.invalid"); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe("slot 1 Python audits offline", () => {
  it.each(["failure", "timeout", "invalid-output"])("R2 node %s transport failure leaves historical work unchanged and blocks slots 1+2", mode => {
    const result = py(`${head}
effect={'failure':OSError('offline'),'timeout':subprocess.TimeoutExpired('offline',20),'invalid-output':None}[${JSON.stringify(mode)}]
kwargs={'side_effect':effect} if effect else {'return_value':subprocess.CompletedProcess([],0,'{}','')}
with patch('slot_retirements.subprocess.run',**kwargs), warnings.catch_warnings(record=True) as messages:
    _retired_slots.cache_clear()
    rows={day:list(retired_slots(root,day)) for day in ['2026-11-15','2026-11-15T15:59:59Z','2026-11-16','2026-11-15T16:00:00Z']}
print(json.dumps({'rows':rows,'warnings':[str(m.message) for m in messages]}))`);
    expect(result.value.rows).toEqual({ "2026-11-15": [], "2026-11-15T15:59:59Z": [], "2026-11-16": [1, 2], "2026-11-15T16:00:00Z": [1, 2] });
    expect(result.value.warnings).toHaveLength(1); expect(result.value.warnings[0]).toContain("fail closed");
  });
  it.each(["valid", "missing", "broken"])("R2 real CLI %s policy projects both retired daily slots out of old Python calendars", async mode => {
    if (mode === "missing") await unlink(join(root, "src/slot-retirements.json"));
    if (mode === "broken") await writeFile(join(root, "src/slot-retirements.json"), "{broken");
    const result = py(`${head}
cal={'slots':[{'slot':1},{'slot':2},{'slot':3}]}
print(json.dumps({'before':active_calendar(cal,root,'2026-11-15')['slots'],'after':active_calendar(cal,root,'2026-11-16')['slots']}))`);
    expect(result.value).toEqual({ before: [{ slot: 1 }, { slot: 2 }, { slot: 3 }], after: [{ slot: 3 }] });
    if (mode !== "valid") expect(result.stderr).toContain("fail closed"); else expect(result.stderr).toBe("");
  }, 45000);
  it("R3 nightly production image, day-lock, runway and repetition blocks accept zero slots and ignore retired slot-1 plans", async () => {
    await generateDailyContent({ root, date });
    const result = py(`${head}
source=repo/'scripts/nightly_optimize.py'
tree=ast.parse(source.read_text(encoding='utf-8-sig'))
findings=[]
cal=active_calendar(json.loads((root/'data/content-calendar/${date}.json').read_text(encoding='utf-8')),root,'${date}')
scope={'ROOT':str(root),'ds':'${date}','ts':'2026-11-17','TODAY':date(2026,11,16),'date':date,'timedelta':timedelta,'os':os,'retired_slots':retired_slots,'today_cal':cal,'cal':cal,'slots':[],'plan':{'${date}':'repeat','2026-11-17':'repeat'},'recent':{},'today_image_path':lambda d,n:str(root/f'image-{n}'),'today_image_fix':lambda d:'offline','load':lambda path,*args: [{'date':'2027-01-01'}] if 'ab-test' in path else None,'add':lambda *args:findings.append(args)}
selected=[]
for n in tree.body:
    if isinstance(n,ast.If) and isinstance(n.test,ast.Name) and n.test.id in ('today_cal','cal'): selected.append(n)
    if isinstance(n,ast.For) and isinstance(n.target,ast.Tuple) and 'path' in ast.unparse(n.target): selected.append(n)
    if isinstance(n,ast.For) and isinstance(n.target,ast.Name) and n.target.id=='i' and ast.unparse(n.iter)=='range(-7, 8)': selected.append(n)
    if isinstance(n,ast.For) and ast.unparse(n.target)=='(topic, days)' and ast.unparse(n.iter)=='recent.items()': selected.append(n)
exec(compile(ast.Module(body=selected,type_ignores=[]),str(source),'exec'),scope)
print(json.dumps({'findings':findings,'recent':scope['recent'],'blocks':len(selected)}))`);
    expect(result.value).toEqual({ findings: [], recent: {}, blocks: 5 }); expect(result.stderr).toBe("");
  }, 45000);
  it("R3 weekly publication ledger, level-1 checklist and daily progress accept a feature-only date", async () => {
    await generateDailyContent({ root, date });
    await writeJsonAtomic(join(root, `output/day-reports/${date}.json`), { date, ok: true, expected_slots: [], slots: { 1: { facebook: false, instagram: false }, 2: { facebook: false, instagram: false }, 3: { facebook: false, instagram: false } }, missing_posts: [] });
    await writeJsonAtomic(join(root, `data/feature-posted-log/${date}.json`), [{ date, slug: "offline", platform: "facebook", status: "success", at: `${date}T06:00:00Z`, post_id: "offline" }]);
    const result = py(`${head}
import level1_gates as lg
policy={'status':'active','start_date':'2026-01-01','end_date':'2027-01-01','platforms':['facebook','instagram'],'slots':[{'slot':1,'time':'11:30'},{'slot':2,'time':'20:30'}]}
posts=lg._evaluate_posts(date(2026,11,16),policy,root/'data/posted-log/${date}.json')
os.environ['DAILY_PROGRESS_ROOT']=str(root)
import daily_progress as dp
spec=importlib.util.spec_from_file_location('offline_weekly',repo/'scripts/weekly-report.py');weekly=importlib.util.module_from_spec(spec);sys.modules[spec.name]=weekly;spec.loader.exec_module(weekly)
reader=weekly.Reader();start=datetime(2026,11,16,tzinfo=timezone(timedelta(hours=8)));end=start+timedelta(days=7)
metrics=weekly.publication_metrics(root/'data',start,end,end,reader)
print(json.dumps({'posts':posts,'published':dp.metrics_for('${date}')['published_all_slots'],'weekly_fb_published':len(metrics[0]['facebook']['published'])},default=str))`);
    expect(result.value.posts.status).toBe("not_required"); expect(result.value.published).toBe(true); expect(result.value.weekly_fb_published).toBe(1); expect(result.stderr).toBe("");
  }, 45000);
});
