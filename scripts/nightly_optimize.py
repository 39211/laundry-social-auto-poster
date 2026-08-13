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


TODAY = date.today()
TOMORROW = TODAY + timedelta(days=1)
ds = TODAY.isoformat()
ts = TOMORROW.isoformat()


# --- 1. Tomorrow has to be ready tonight, not at 06:30 -----------------------
cal = load(f"data/content-calendar/{ts}.json")
if cal is None:
    add("HIGH", "明日備妥", f"{ts} 行事曆不存在",
        f"data/content-calendar/{ts}.json 缺檔",
        "06:30 會自動生成,但若隔天沒生成就是零內容;明早 07:30 必須確認")
else:
    slots = cal.get("slots", [])
    for s in slots:
        n = s.get("slot")
        img = f"docs/assets/{ts}/slot-{n:02d}.png"
        if not os.path.exists(img):
            add("HIGH", "明日備妥", f"slot {n} 主圖缺",
                f"{img} 不存在",
                f"跑 scripts/generate-missing-images.ps1 -Date {ts},產完親眼看圖")
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
if cal:
    for s in cal.get("slots", []):
        cap = s.get("instagram_caption", "") or ""
        miss = [
            name
            for name, pat in (
                ("價格線索", r"\$|元|參考價|起"),
                ("收送句", r"收送|到府|外送"),
                ("聯絡方式", r"LINE|line|0968"),
                ("提問", r"[??]"),
            )
            if not re.search(pat, cap)
        ]
        if miss:
            add("MED", "轉單要素", f"slot {s.get('slot')} 文案缺 {'、'.join(miss)}",
                f"data/content-calendar/{ts}.json",
                "補進文案;缺提問等於不邀請回覆,缺價格等於要對方多問一輪")


# --- 6. Did today leave a trace of learning? --------------------------------
opt = "output/daily-optimization-log.md"
if not os.path.exists(opt) or ds not in open(opt, encoding="utf-8").read():
    add("HIGH", "自我迭代", "今天沒有寫優化日誌",
        opt,
        "只看守不迭代等於沒做事。寫「改了什麼/為什麼/怎麼驗」")

try:
    changed = subprocess.run(
        ["git", "log", "--since", f"{ds} 00:00", "--name-only", "--pretty=format:"],
        capture_output=True, text=True, timeout=60,
    ).stdout
    if "ERROR-BOOK.md" not in changed:
        add("LOW", "自我迭代", "今天沒有新增踩坑紀錄",
            "git log 未見 ERROR-BOOK.md 變更",
            "沒踩到坑是可能的,但「查了超過 15 分鐘才搞懂的事」也算坑")
except (subprocess.SubprocessError, OSError):
    pass


# --- 7. A dead trigger looks exactly like a healthy one ----------------------
try:
    ps = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "Get-ScheduledTask | Where-Object {$_.TaskName -like 'Laundry*'} | "
         "ForEach-Object { $i=$_|Get-ScheduledTaskInfo; "
         "'{0}|{1}' -f $_.TaskName, $i.NextRunTime }"],
        capture_output=True, text=True, timeout=120,
    )
    for line in ps.stdout.strip().splitlines():
        if "|" in line:
            name, nxt = line.split("|", 1)
            if not nxt.strip():
                add("HIGH", "排程", f"{name.strip()} 沒有下次執行時間",
                    "NextRunTime 空白 = 永遠不會跑",
                    "重新註冊該排程(ERROR-BOOK D1)")
except (subprocess.SubprocessError, OSError):
    pass


# --- 8. Indexing is only useful if it is landing -----------------------------
idx = load(f"output/operations/indexing-push-{ds}.json")
if idx is None:
    add("MED", "索引", "今天沒有索引推送記錄",
        f"output/operations/indexing-push-{ds}.json 缺檔",
        "確認 06:30 Daily-Generate 有跑到 submit-indexnow")
else:
    if idx.get("indexnow_status") != 200:
        add("HIGH", "索引", f"IndexNow 回 {idx.get('indexnow_status')}",
            "非 200", "查 API key 與 sitemap")
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
posted = load(f"data/posted-log/{ds}.json", [])
posted = posted if isinstance(posted, list) else [posted]
live = {(e.get("slot"), e.get("platform")) for e in posted
        if e.get("status") in ("success", "posted") and not e.get("dry_run")}
if not live:
    add("HIGH", "今日發布", "今天一則都沒發出去",
        f"data/posted-log/{ds}.json 沒有任何 success/posted",
        "查排程 LastTaskResult;3221225786=行程被殺(多半是睡眠或關機)。"
        "確認 WakeToRun=True,並檢查是否有人整天關機")

try:
    ps = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "Get-ScheduledTask | Where-Object {$_.TaskName -in "
         "'Laundry-Daily-Generate','Laundry-Daily-Approve','Laundry-CatchUp-Publish'} | "
         "ForEach-Object { '{0}|{1}' -f $_.TaskName, $_.Settings.WakeToRun }"],
        capture_output=True, text=True, timeout=120,
    )
    for line in ps.stdout.strip().splitlines():
        if "|" in line:
            name, wake = line.split("|", 1)
            if wake.strip().lower() not in ("true", "$true"):
                add("HIGH", "排程", f"{name.strip()} 的 WakeToRun 是 False",
                    "機器睡著時排程不會叫醒它,整天會靜默不發",
                    "Set-ScheduledTask 把 WakeToRun 設為 True")
except (subprocess.SubprocessError, OSError):
    pass


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
