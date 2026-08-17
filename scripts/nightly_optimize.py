"""Nightly self-audit: find tomorrow's problems tonight.

Runs after the 22:50 settlement. The settlement answers "did today ship?";
this answers "what is already broken about the days ahead, and what did we
learn today that nobody wrote down?"

Every check here exists because something once went wrong silently. A check
that cannot fail is not a check, so each one is written to produce a finding
on the exact condition that bit us before -- an empty plan window, a topic
that repeats, a lock that disagrees with the calendar, a caption missing the
one line that turns a reader into a message.

Output: output/nightly-optimize/<date>.json  (machine-readable findings)
        output/nightly-optimize/<date>.md    (what a human should act on)
Exit code is always 0 -- this reports, it does not gate.
"""

import json
import os
import re
import subprocess
import sys
from datetime import date, datetime, timedelta

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

findings = []


def add(severity, area, what, evidence, fix):
    findings.append(
        {"severity": severity, "area": area, "what": what, "evidence": evidence, "fix": fix}
    )


def load(path, default=None):
    try:
        with open(path, encoding="utf-8-sig") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return default


def run(argv, timeout=120):
    """Read a child process as UTF-8 no matter what the console codepage says.

    `text=True` decodes with the locale codec, which is cp950 here. On
    2026-08-14 the scheduled-task probe below hit a byte cp950 cannot represent
    and raised UnicodeDecodeError -- which is not a SubprocessError, so it was
    not caught, and the script died at check 7. Checks 8, 9 and 10 never ran,
    and check 10 is the one that asks whether today actually published. The
    guard written after three silent zero-publish days was itself silently
    dead. Returns "" on any failure so one broken probe cannot take the rest
    of the audit with it.
    """
    try:
        out = subprocess.run(
            argv, capture_output=True, timeout=timeout,
            encoding="utf-8", errors="replace",
        ).stdout
        return out or ""
    except (subprocess.SubprocessError, OSError, ValueError):
        return ""


# --- nightly-check helpers ---
# Imported by test/nightlyChecks.test.ts via the markers. Keep these pure:
# they are how we prove a quiet night stays quiet, and a broken night lights.
URL_RE = re.compile(r"https?://\S+", re.I)
PRICE_RE = re.compile(r"\$[0-9]+|[0-9]+元|參考價|[0-9]+起")
PICKUP_RE = re.compile(r"收送|到府|外送")
CONTACT_RE = re.compile(r"LINE|line|0968")
QUESTION_RE = re.compile(r"[?？]")
PRIMARY_SLOTS = {1, 2}
CONVERSION_FIELDS = ("收送句", "價格線索", "提問", "聯絡方式")


def strip_caption_urls(text):
    return URL_RE.sub("", text or "")


def caption_has(name, text):
    raw = text or ""
    if name == "提問":
        return bool(QUESTION_RE.search(strip_caption_urls(raw)))
    if name == "價格線索":
        return bool(PRICE_RE.search(raw))
    if name == "收送句":
        return bool(PICKUP_RE.search(raw))
    if name == "聯絡方式":
        return bool(CONTACT_RE.search(raw))
    return False


def primary_captions(cal):
    if not cal:
        return []
    out = []
    for slot in cal.get("slots") or []:
        if slot.get("slot") in PRIMARY_SLOTS:
            out.append(slot.get("instagram_caption") or "")
    return out


def generator_lacks(name, *cals):
    """True only when every primary caption on every given day lacks `name`.

    One healthy day (or a missing calendar) is not a generator defect.
    Two consecutive generated days all missing the same field is.
    """
    days = [primary_captions(cal) for cal in cals]
    if len(days) < 2 or any(len(caps) == 0 for caps in days):
        return False
    return all(not caption_has(name, cap) for caps in days for cap in caps)


def conversion_generator_findings(yesterday_cal, today_cal, yesterday, today):
    rows = []
    labels = {
        "收送句": "產生器沒寫收送",
        "價格線索": "產生器沒寫價格線索",
        "提問": "產生器沒寫提問",
        "聯絡方式": "產生器沒寫聯絡方式",
    }
    for name in CONVERSION_FIELDS:
        if generator_lacks(name, yesterday_cal, today_cal):
            rows.append({
                "severity": "MED",
                "area": "轉單要素",
                "what": labels[name],
                "evidence": (
                    f"data/content-calendar/{yesterday}.json 與 {today}.json "
                    f"的 slot 1/2 連續兩天缺 {name}"
                ),
                "fix": "修 src/contentPlan.ts 文案模板;06:30 generate 會覆寫明天草稿,不要手補明天曆",
            })
    return rows


def ready_chain_breaks(line):
    """Parse Generate-task probe `state|wake|next`. One list, one finding."""
    line = (line or "").strip()
    if not line:
        return ["排程探測空"]
    state, wake, nxt = (line.split("|") + ["", "", ""])[:3]
    broken = []
    if state == "MISSING":
        broken.append("排程不在")
    if state != "MISSING" and not nxt.strip():
        broken.append("觸發器沒有下次")
    if state != "MISSING" and wake.strip().lower() not in ("true", "$true"):
        broken.append("叫不醒")
    return broken


def today_image_path(day, slot_n):
    return f"docs/assets/{day}/slot-{int(slot_n):02d}.png"


def today_image_fix(day):
    return (
        f"先 invalidate 失效舊圖,再 npm run generate-image-manifest -- --date {day} "
        f"重生 manifest,再跑 scripts/generate-missing-images.ps1 -Date {day} 補產,產完親眼看圖"
    )


def opt_log_severity(has_log, has_success_post, has_git):
    if has_log:
        return None
    if not has_success_post and not has_git:
        return "HIGH"
    return "MED"


# --- end helpers ---

TODAY = date.today()
TOMORROW = TODAY + timedelta(days=1)
ds = TODAY.isoformat()
ts = TOMORROW.isoformat()


# --- 1. Tomorrow has to be ready tonight, not at 06:30 -----------------------
cal = load(f"data/content-calendar/{ts}.json")
# MERGE 1a/1b/1c: one 明日就緒鏈. Tomorrow's calendar is often still missing
# at 23:10; that is normal. What protects the morning is that Generate is
# registered, has a next run, and can wake the machine.
gen = run(["powershell", "-NoProfile", "-Command",
           "$t = Get-ScheduledTask -TaskName 'Laundry-Daily-Generate' -ErrorAction SilentlyContinue; "
           "if ($t) { $i = $t | Get-ScheduledTaskInfo; "
           "'{0}|{1}|{2}' -f $t.State, $t.Settings.WakeToRun, $i.NextRunTime } else { 'MISSING||' }"])
line = gen.strip().splitlines()[0] if gen.strip() else ""
chain_breaks = ready_chain_breaks(line)
if chain_breaks:
    state, wake, nxt = (line.split("|") + ["", "", ""])[:3] if line else ("", "", "")
    add("HIGH", "明日備妥", f"明日就緒鏈斷了:{'、'.join(chain_breaks)}",
        f"Laundry-Daily-Generate state={state} WakeToRun={wake} NextRunTime='{nxt.strip()}'",
        "確認排程在、NextRunTime 非空、WakeToRun=True;缺一則明天 06:30 生不出來(ERROR-BOOK D1/B9)")

# REWRITE 1d: at 23:10 today's images must already exist (06:30 has run).
# Tomorrow's PNGs are not supposed to exist yet (ERROR-BOOK A7/B9).
# Fix keeps the W-A7B invalidate chain; only the date is today, not tomorrow.
today_cal = load(f"data/content-calendar/{ds}.json")
if today_cal:
    for s in today_cal.get("slots", []):
        n = s.get("slot")
        img = today_image_path(ds, n)
        if not os.path.exists(img):
            add("HIGH", "明日備妥", f"slot {n} 主圖缺",
                f"{img} 不存在",
                today_image_fix(ds))

# KEEP 1e
if cal:
    slots = cal.get("slots", [])
    lock = load(f"data/day-locks/{ts}.json")
    if lock:
        lt = (lock.get("slot1") or {}).get("topic")
        ct = next((s.get("topic") for s in slots if s.get("slot") == 1), None)
        if lt and ct and lt != ct:
            add("HIGH", "明日備妥", "day-lock 與行事曆主題不一致",
                f"鎖={lt} / 曆={ct}",
                "heal 會拿鎖覆蓋行事曆。刪鎖→改→驗圖→重鎖(ERROR-BOOK A3)")


# --- 2. Plans must outrun the production window ------------------------------
for path, label, need in (
    ("data/slot1-plan.json", "每日主題表", 14),
    ("data/ab-test-plan.json", "影片排程表", 14),
):
    data = load(path)
    if not data:
        add("HIGH", "計畫殘量", f"{label} 讀不到", path, "檢查檔案是否損毀")
        continue
    dates = sorted(data.keys()) if isinstance(data, dict) else sorted(r["date"] for r in data)
    last = date.fromisoformat(dates[-1])
    left = (last - TODAY).days
    if left < need:
        add("HIGH" if left < 7 else "MED", "計畫殘量",
            f"{label}只剩 {left} 天",
            f"{path} 最後一天 {dates[-1]}",
            f"續寫到至少 {(TODAY + timedelta(days=need)).isoformat()};排到期末生產線會安靜空轉(ERROR-BOOK F3)")


# --- 3. The shop's main line must actually appear ----------------------------
plan = load("data/slot1-plan.json", {})
window = [(TODAY + timedelta(days=i)).isoformat() for i in range(1, 8)]
shoe = re.compile(r"鞋|靴|勃肯|拖鞋")
hit = [d for d in window if d in plan and shoe.search(plan[d])]
if len(hit) < 4:
    add("HIGH", "主力覆蓋", f"未來 7 天只有 {len(hit)} 天有鞋主題",
        f"命中 {hit}",
        "老闆明講小月鞋量掉、要每天有鞋。改 data/slot1-plan.json 補足")


# --- 4. Repetition is invisible until the audience feels it ------------------
recent = {}
for i in range(-7, 8):
    d = (TODAY + timedelta(days=i)).isoformat()
    if d in plan:
        recent.setdefault(plan[d], []).append(d)
for topic, days in recent.items():
    if len(days) > 1:
        add("MED", "重複", f"主題「{topic}」在 15 天內出現 {len(days)} 次",
            f"{days}", "換掉其中一天;7 天重複閘只擋已發布的,擋不了計畫表裡的排重")


# --- 5. Captions that inform but never ask -----------------------------------
# Don't nag tomorrow's draft: 06:30 overwrites it. If the generator template
# omitted a conversion field two days running, say so once and point at the
# template. Question marks are tested after stripping URLs; price no longer
# treats a bare 起 (關不起來) as a price cue.
yesterday = (TODAY - timedelta(days=1)).isoformat()
yday_cal = load(f"data/content-calendar/{yesterday}.json")
copy_today = today_cal if today_cal is not None else load(f"data/content-calendar/{ds}.json")
for row in conversion_generator_findings(yday_cal, copy_today, yesterday, ds):
    add(row["severity"], row["area"], row["what"], row["evidence"], row["fix"])


# --- 6. Did today leave a trace of learning? --------------------------------
# REWRITE 6a: missing log is MED unless the day also posted nothing and
# committed nothing. DROP 6b: a quiet ERROR-BOOK day is a good day.
opt = "output/daily-optimization-log.md"
try:
    has_opt_log = os.path.exists(opt) and ds in open(opt, encoding="utf-8").read()
except OSError:
    has_opt_log = False
posted_today = load(f"data/posted-log/{ds}.json", [])
if not isinstance(posted_today, list):
    posted_today = [posted_today]
has_success_post = any(
    isinstance(entry, dict)
    and entry.get("status") in ("success", "posted")
    and not entry.get("dry_run")
    for entry in posted_today
)
git_today = run(
    ["git", "log", "--since", f"{ds} 00:00", "--pretty=format:%H", "-n", "1"],
    timeout=60,
).strip()
opt_sev = opt_log_severity(has_opt_log, has_success_post, bool(git_today))
if opt_sev:
    opt_evidence = opt
    opt_fix = "只看守不迭代等於沒做事。寫「改了什麼/為什麼/怎麼驗」"
    if opt_sev == "HIGH":
        opt_evidence = f"{opt};posted-log 無 success 且 git log 空白"
        opt_fix = "當天沒發布、沒 commit、沒日誌=真的沒做事。寫「改了什麼/為什麼/怎麼驗」"
    add(opt_sev, "自我迭代", "今天沒有寫優化日誌", opt_evidence, opt_fix)


# --- 7. A dead trigger looks exactly like a healthy one ----------------------
tasks = run(["powershell", "-NoProfile", "-Command",
             "Get-ScheduledTask | Where-Object {$_.TaskName -like 'Laundry*'} | "
             "ForEach-Object { $i=$_|Get-ScheduledTaskInfo; "
             "'{0}|{1}' -f $_.TaskName, $i.NextRunTime }"])
seen_tasks = 0
for line in tasks.strip().splitlines():
    if "|" in line:
        seen_tasks += 1
        name, nxt = line.split("|", 1)
        if not nxt.strip():
            add("HIGH", "排程", f"{name.strip()} 沒有下次執行時間",
                "NextRunTime 空白 = 永遠不會跑",
                "重新註冊該排程(ERROR-BOOK D1)")
# Silence from this probe is not the same as "all triggers healthy": it is the
# shape the crash took. Say so rather than letting an empty result read as a
# clean bill of health.
if seen_tasks == 0:
    add("HIGH", "排程", "查不到任何 Laundry-* 排程",
        "PowerShell 探測沒有回傳任何一行",
        "可能是排程真的不見了,也可能是探測本身壞了 —— 兩種都要人工看一次")


# --- 8. Indexing is only useful if it is landing -----------------------------
idx = load(f"output/operations/indexing-push-{ds}.json")
if idx is None:
    add("MED", "索引", "今天沒有索引推送記錄",
        f"output/operations/indexing-push-{ds}.json 缺檔",
        "確認 06:30 Daily-Generate 有跑到 submit-indexnow")
else:
    # IndexNow 協定裡 202 = 已受理(key 驗證中),與 200 同為成功;
    # 2026-08-17 網域剛切換當晚,把正常的 202 誤標成 HIGH。
    if idx.get("indexnow_status") not in (200, 202):
        add("HIGH", "索引", f"IndexNow 回 {idx.get('indexnow_status')}",
            "非 200/202", "查 API key 與 sitemap")
    thin = idx.get("thin_pages") or []
    if thin:
        add("MED", "索引", f"{len(thin)} 頁內容過薄",
            f"{thin[:5]}", "補實質內容,不要湊字數")


# --- 9. The measurement point itself must be verified alive ------------------
# A false P0 on 08-12 claimed no page loads gtag; live checks disproved it.
# The durable version of that alarm is checking the real page nightly: if the
# redirect page ever ships without its analytics tag, line_click silently
# stops firing and every later audit misreads the zero.
try:
    import urllib.request
    req = urllib.request.Request(
        "https://39211.github.io/go/line.html", headers={"User-Agent": "Mozilla/5.0"}
    )
    page = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", errors="replace")
    if "googletagmanager.com/gtag/js" not in page or "line_click" not in page:
        add("HIGH", "量測", "線上 go/line.html 缺 gtag 或 line_click 事件",
            "頁面抓回後字串不含 gtag/line_click",
            "檢查 PUBLIC_GA4_MEASUREMENT_ID 與 publish-pages;量測斷了,之後所有 0 都不可判讀")
except OSError:
    add("LOW", "量測", "無法抓取線上 go/line.html(網路?)",
        "urllib 逾時或連線失敗", "隔天自檢會再試;連續多天失敗才需要人工看")


# --- 10. Did the day actually publish, and can the machine wake to do it? ----
# 2026-08-12 and 08-13 published nothing at all. No code failed: the machine
# was asleep, every task had WakeToRun=False, and StartWhenAvailable quietly
# deferred the whole day until it woke at 23:40 -- by which time the publish
# windows had closed. Nothing in this audit noticed, because it only ever
# checked tomorrow's readiness, never whether today shipped.
# A brake nobody can see is its own outage. The owner's pause stops approval and
# publishing on purpose, which is right -- but a pause left on for a week looks
# exactly like a pipeline that quietly died, and the whole point of check 10 is
# to tell those apart.
# The mid-clip A/B was scheduled for 08-12..14, all three arms failed to run,
# and the plan simply sat there pointing at past dates. Production falls back to
# the untreated layout silently in that state, so an experiment can die without
# anyone noticing it never started.
mt = load("data/mid-treatment-plan.json", {})
if isinstance(mt, dict):
    arms = [k for k in mt if not k.startswith("_")]
    future_arms = [k for k in arms if k >= ds]
    if arms and not future_arms:
        add("MED", "影片實驗", "中段治療計畫只剩過去的日期,實驗不會再跑",
            f"data/mid-treatment-plan.json 最後一天是 {max(arms)}",
            "確認實驗結束了沒;沒跑完就往後重排,不要把沒跑過當成沒效果")

pause = load("data/PAUSED.json")
if pause is not None:
    since = str(pause.get("since", ""))[:10] if isinstance(pause, dict) else ""
    reason = pause.get("reason", "(未寫原因)") if isinstance(pause, dict) else "(無法解析)"
    held_days = 0
    try:
        held_days = (TODAY - date.fromisoformat(since)).days
    except ValueError:
        held_days = 99
    add(
        "HIGH" if held_days >= 1 else "MED",
        "人工暫停",
        f"發布被人工暫停中(已 {held_days} 天):{reason}",
        "data/PAUSED.json 存在;核准與發布都會拒絕",
        "確認還要不要停;要恢復就跑 npm run pause -- --clear",
    )

posted = load(f"data/posted-log/{ds}.json", [])
posted = posted if isinstance(posted, list) else [posted]
live = {(e.get("slot"), e.get("platform")) for e in posted
        if e.get("status") in ("success", "posted") and not e.get("dry_run")}
# Scheduled for 23:10, after every publish window has closed. Run by hand at
# 02:00 it would flag a day that has simply not happened yet -- and a check that
# cries wolf when you run it manually is a check you learn to scroll past.
too_early_to_judge = datetime.now().hour < 21
if not live and pause is None and not too_early_to_judge:
    add("HIGH", "今日發布", "今天一則都沒發出去",
        f"data/posted-log/{ds}.json 沒有任何 success/posted",
        "查排程 LastTaskResult;3221225786=行程被殺(多半是睡眠或關機)。"
        "確認 WakeToRun=True,並檢查是否有人整天關機")

wake_probe = run(["powershell", "-NoProfile", "-Command",
                  "Get-ScheduledTask | Where-Object {$_.TaskName -in "
                  "'Laundry-Daily-Generate','Laundry-Daily-Approve','Laundry-CatchUp-Publish'} | "
                  "ForEach-Object { '{0}|{1}' -f $_.TaskName, $_.Settings.WakeToRun }"])
seen_wake = 0
for line in wake_probe.strip().splitlines():
    if "|" in line:
        seen_wake += 1
        name, wake = line.split("|", 1)
        if wake.strip().lower() not in ("true", "$true"):
            add("HIGH", "排程", f"{name.strip()} 的 WakeToRun 是 False",
                "機器睡著時排程不會叫醒它,整天會靜默不發",
                "Set-ScheduledTask 把 WakeToRun 設為 True")
if seen_wake == 0:
    add("HIGH", "排程", "查不到三個關鍵排程的 WakeToRun 設定",
        "PowerShell 探測沒有回傳任何一行",
        "這是防止整天靜默的最後一道檢查,查不到就等於沒檢查 —— 人工確認一次")


# --- Report ------------------------------------------------------------------
os.makedirs("output/nightly-optimize", exist_ok=True)
rank = {"HIGH": 0, "MED": 1, "LOW": 2}
findings.sort(key=lambda f: rank.get(f["severity"], 3))
report = {
    "date": ds,
    "generated_at": datetime.now().isoformat(timespec="seconds"),
    "total": len(findings),
    "high": sum(1 for f in findings if f["severity"] == "HIGH"),
    "findings": findings,
}
with open(f"output/nightly-optimize/{ds}.json", "w", encoding="utf-8") as fh:
    json.dump(report, fh, ensure_ascii=False, indent=1)

lines = [f"# 每晚自檢 {ds}", "", f"發現 {len(findings)} 項(HIGH {report['high']})", ""]
if not findings:
    lines.append("八項檢查全過。明日備妥、計畫殘量、主力覆蓋、重複、轉單要素、自我迭代、排程、索引。")
for f in findings:
    lines += [
        f"## [{f['severity']}] {f['area']}:{f['what']}",
        f"證據:{f['evidence']}",
        f"修法:{f['fix']}",
        "",
    ]
with open(f"output/nightly-optimize/{ds}.md", "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines))

print(f"NIGHTLY_OPTIMIZE {ds}: {len(findings)} findings ({report['high']} HIGH)")
for f in findings:
    print(f"  [{f['severity']}] {f['area']}: {f['what']}")
