# -*- coding: utf-8 -*-
"""Regression cases for the object-canon guard, after the two-seat review.

Every case ships dummy .png files so gen_still short-circuits on "exists" and
nothing is generated -- an earlier run of this kind quietly burned two real
image generations.
"""
import io, sys, json, shutil, subprocess, pathlib
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

REPO = pathlib.Path(r"C:\Users\cyc39\laundry-repo")
SCRATCH = REPO / "output" / "operations" / "canon-guard-cases"
SRC_JOB = REPO / "output" / "reel-v3" / "2026-09-17" / "job.json"
BASE = json.loads(SRC_JOB.read_text(encoding="utf-8"))


def build(name, mutate, stills_present):
    d = SCRATCH / name
    if d.exists():
        shutil.rmtree(d)
    d.mkdir(parents=True)
    job = json.loads(json.dumps(BASE))
    mutate(job)
    (d / "job.json").write_text(json.dumps(job, ensure_ascii=False, indent=1), encoding="utf-8")
    for anchor in job["anchor_plan"]:
        (d / f"{anchor}.txt").write_text("placeholder prompt\n", encoding="utf-8")
        if anchor in stills_present:
            (d / f"{anchor}.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 64)
    return d


def run(d):
    p = subprocess.run(
        [sys.executable, str(REPO / "scripts" / "reel-v3" / "produce_day.py"), str(d), "--stills-only"],
        capture_output=True, text=True, errors="replace", cwd=str(REPO),
        env={**__import__("os").environ, "PYTHONIOENCODING": "utf-8"})
    return (p.stdout or "") + (p.stderr or "")


ALL = [f"shot-{i:02d}-anchor" for i in range(1, 7)]
CASES = []


# 1. The original defect: 2026-09-17's own plan, canon declared, nothing else changed.
def m1(job):
    job["object_canon"] = "shot-01-anchor.png"


CASES.append(("A 原始事故重播(canon 宣告,plan 不動)", m1, ALL, "FAIL shot-03-anchor"))


# 2. An object close-up AFTER the canon that omits it -- the hole kimi found.
def m2(job):
    job["object_canon"] = "shot-01-anchor.png"
    job["anchor_plan"]["shot-02-anchor"] = {"refs": ["none"], "generator": "agy", "who": "object"}


CASES.append(("B 物件特寫鏡漏掛正本(kimi 抓到的洞)", m2, ALL, "FAIL shot-02-anchor"))


# 3. A character shot BEFORE the canon -- must NOT be blocked (gemini's finding).
def m3(job):
    job["object_canon"] = "shot-03-anchor.png"
    job["anchor_plan"]["shot-01-anchor"] = {"refs": ["master-sheet"], "generator": "agy", "who": "master"}
    job["anchor_plan"]["shot-02-anchor"] = {"refs": ["master-sheet"], "generator": "agy", "who": "master"}
    job["anchor_plan"]["shot-03-anchor"] = {"refs": ["none"], "generator": "agy", "who": "customer"}
    for n in ("shot-04-anchor", "shot-05-anchor", "shot-06-anchor"):
        job["anchor_plan"][n] = {"refs": ["master-sheet", "shot-03-anchor.png"], "generator": "agy", "who": "master"}


CASES.append(("C 正本之前的人物鏡不得被誤擋(gemini 抓到的)", m3, ALL, None))


# 4. refs: [] must not explode.
def m4(job):
    job.pop("object_canon", None)
    job["anchor_plan"]["shot-01-anchor"] = {"refs": [], "generator": "agy", "who": "customer"}


CASES.append(("D refs: [] 合法空清單不得 KeyError", m4, ALL, None))


# 5. object_canon naming an anchor that does not exist must fail loudly.
def m5(job):
    job["object_canon"] = "shot-99-anchor.png"


CASES.append(("E object_canon 指向不存在的 anchor 要明確報錯", m5, ALL, "names no entry in anchor_plan"))

fails = 0
for label, mutate, stills, expect in CASES:
    d = build(label.split()[0], mutate, stills)
    out = run(d)
    if expect is None:
        ok = ("FAIL " not in out) and ("Traceback" not in out)
        detail = "沒有任何 FAIL / Traceback" if ok else out.strip()[-220:]
    else:
        ok = expect in out
        detail = ("命中「%s」" % expect) if ok else out.strip()[-220:]
    print("%-46s %s  %s" % (label, "PASS" if ok else "**FAIL**", detail))
    if not ok:
        fails += 1

print()
print("結果:%d/%d 通過" % (len(CASES) - fails, len(CASES)))
sys.exit(1 if fails else 0)
