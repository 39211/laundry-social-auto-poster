"""Offline OPS-L1-10b checks; all small evidence/fixtures stay in this worktree."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports/ops-l1-10b-r1"
FIXTURES = ROOT / "output/operations/ops-l1-10b-fixtures"
PYTHON = "C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe"
REGRESSION = ["publishRecovery", "scheduleAhead", "scheduleAhead.reconcile", "facebookLostAlert",
              "postCurrentSlot", "postCurrentSlot.unrecordedPublish", "publishGuards", "loggingConcurrency",
              "retry", "postCurrentSlot.allDue", "publishSentinel", "publishTimeGate", "publishRecovery.r3"]
WRAPPER_PATTERN = r"^(?!.*(?:covers due, posted, retry, process and task-registration gates|invokes production helpers)).*$"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(name, data):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / (name + ".json")).write_text(json.dumps(data, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")


def command(name, files, pattern=None):
    result = ["node", "--import", "./test/helpers/opsBootstrap.mjs", str(ROOT / "node_modules/vitest/vitest.mjs"),
              "run", "--config", "test/ops-l1-offline.config.ts", "--configLoader", "native", "--pool", "threads", "--maxWorkers", "1"]
    result += [f"test/{file}.test.ts" for file in files]
    if pattern:
        result += ["--testNamePattern", pattern]
    return result + ["--reporter=json", "--outputFile=" + str(OUT / (name + ".json"))]


def run(name, cmd, cwd=ROOT, ts=False):
    OUT.mkdir(parents=True, exist_ok=True)
    FIXTURES.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.update(TEMP=str(FIXTURES), TMP=str(FIXTURES), PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8")
    log = OUT / (name + ".txt")
    with log.open("wb") as output:
        result = subprocess.run(cmd, cwd=cwd, env=env, stdout=output, stderr=subprocess.STDOUT, timeout=600)
    record = {"name": name, "command": cmd, "cwd": str(cwd), "exit_code": result.returncode,
              "at": datetime.now(timezone.utc).isoformat(), "log": str(log.relative_to(ROOT))}
    if ts:
        data = json.loads((OUT / (name + ".json")).read_text(encoding="utf-8"))
        record.update(passed=data["numPassedTests"], failed=data["numFailedTests"], skipped=data["numPendingTests"],
                      failures=[case for suite in data["testResults"] for case in suite["assertionResults"] if case["status"] == "failed"])
    else:
        record["tail"] = log.read_text(encoding="utf-8", errors="replace")[-2500:]
    save(name + "-check", record)
    print(json.dumps({key: value for key, value in record.items() if key != "failures"}, ensure_ascii=True), flush=True)
    return record


def finalize():
    read = lambda name: json.loads((OUT / (name + ".json")).read_text(encoding="utf-8"))
    for name, expected in [("backfill", 39), ("original34", 34), ("regression", 226), ("restored-green", 112)]:
        result = read(name)
        assert (result["numPassedTests"], result["numFailedTests"]) == (expected, 0), name
    assert read("regression")["numPendingTests"] == 2
    for name, count in [("python81", 81), ("python-backfill", 2)]:
        result = read(name + "-check")
        assert result["exit_code"] == 0 and f"Ran {count} tests" in result["tail"] and "OK" in result["tail"], name
    for name in ("tsc", "backfill-flag", "restored-flag", "publish-recovery-gate", "publish-sentinel-live-slots", "publish-time-gate", "catchup-publish-due-slots"):
        assert read(name + "-check")["exit_code"] == 0, name
    smoke_counts = {}
    for name, count in [("publish-recovery-gate", 1), ("publish-sentinel-live-slots", 66), ("publish-time-gate", 11), ("catchup-publish-due-slots", 13)]:
        text = (OUT / (name + ".txt")).read_text(encoding="utf-8")
        assert text.count("CASE_OK") == count and "CASE_FAIL" not in text, name
        smoke_counts[name] = count
    blocked = read("backfill-publish-check")
    assert blocked["exit_code"] == 2 and "SMOKE_BLOCKED native File.Replace:" in blocked["tail"] and "Access to the path is denied" in blocked["tail"]
    proof = read("mutations")
    assert proof["candidate_unchanged"] and len(proof["mutations"]) == 11
    assert all(item["result"]["exit_code"] == 1 for item in proof["mutations"])
    assert "needs_manual:outside_same_day_window" in proof["baseline"]["failures"][0]["failureMessages"][0]
    for item in proof["restoration"]:
        assert digest(ROOT / item["path"]) == item["original_sha256"] == item["candidate_sha256"] == item["restored_sha256"], item["path"]
    message = (OUT / "COMMIT_MESSAGE.txt").read_text(encoding="utf-8").splitlines()
    assert message[-2:] == ["Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
                           "Claude-Session: https://claude.ai/code/session_01MEMrUQbxofj3681QMgaYf8"]
    files = ["src/publishRecovery.ts", "src/postCurrentSlot.ts", "scripts/backfill-publish.ps1", "scripts/publish_recovery_report.py",
             "test/ps-backfill-publish.smoke.ps1", "test/ps-backfill-flag.smoke.ps1", "test/publishRecovery.backfill.test.ts",
             "test/test_backfill_recovery_reports.py", "test/ops_l1_10b_verify.py", "test/ops_l1_10b_mutations.py"]
    def git(*args):
        return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, check=True).stdout.decode("utf-8").strip()
    assert git("rev-parse", "HEAD") == "cbf5e126b13a32a00e998217d373b4de72ea5aa4"
    assert not git("diff", "--cached", "--name-only")
    assert not git("diff", "--name-only", "--", "package.json", "package-lock.json")
    git("diff", "--check")
    for name in files + ["reports/ops-l1-10b-r1/README.md", "reports/ops-l1-10b-r1/COMMIT_MESSAGE.txt"]:
        assert all(line == line.rstrip() for line in (ROOT / name).read_text(encoding="utf-8-sig").splitlines()), name
    artifact_paths = [path for path in OUT.iterdir() if path.is_file() and path.name not in ("manifest.json", "candidate.patch")]
    # Reviewable patch also includes the six new/updated test files; no index writes.
    import difflib
    patches = []
    for name in files:
        before = subprocess.run(["git", "show", "cbf5e126:" + name], cwd=ROOT, capture_output=True)
        assert before.returncode in (0, 128)
        old = before.stdout.decode("utf-8").splitlines(keepends=True) if before.returncode == 0 else []
        new = (ROOT / name).read_text(encoding="utf-8").splitlines(keepends=True)
        patches.append("diff --git a/" + name + " b/" + name + "\n")
        patches.extend(difflib.unified_diff(old, new, fromfile="a/" + name if old else "/dev/null", tofile="b/" + name))
    (OUT / "candidate.patch").write_text("".join(patches), encoding="utf-8", newline="")
    artifacts = [{"path": path.relative_to(ROOT).as_posix(), "sha256": digest(path)} for path in sorted(artifact_paths)]
    artifacts.append({"path": "reports/ops-l1-10b-r1/candidate.patch", "sha256": digest(OUT / "candidate.patch")})
    manifest = {"task": "OPS-L1-10b r1", "at": datetime.now(timezone.utc).isoformat(),
                "status": "OFFLINE_CANDIDATE_PENDING_COMMANDER_REVIEW", "branch": git("branch", "--show-current"),
                "base": git("rev-parse", "HEAD"), "committed": False, "staged": False,
                "git_index": git("rev-parse", "--git-path", "index"), "commit_message": "reports/ops-l1-10b-r1/COMMIT_MESSAGE.txt",
                "tests": {"backfill": 39, "original_r3": 34, "regression": 226, "regression_existing_exclusions": 2,
                          "python_original": 81, "python_backfill_reports": 2, "tsc_exit": 0,
                          "mutants_red": 11, "restored_tests": 112, "restored_flag": True, "smoke_counts": smoke_counts},
                "limitations": ["full backfill smoke blocked by sandbox File.Replace", "no production or platform validation",
                                "Git metadata read-only; commit message saved", "Vault writeback pending commander"],
                "files": [{"path": name, "sha256": digest(ROOT / name)} for name in files], "artifacts": artifacts,
                "unchanged_candidate_after_mutations": True}
    save("manifest", manifest)
    print("FINAL_VERIFIED backfill=39 regression=226 python=81+2 mutants=11 restored=112 tsc=0", flush=True)
    return {"exit_code": 0}


if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "finalize":
        result = finalize()
    elif mode in ("backfill", "original34", "regression"):
        files = {"backfill": ["publishRecovery.backfill"], "original34": ["publishRecovery.r3"], "regression": REGRESSION}[mode]
        result = run(mode, command(mode, files, WRAPPER_PATTERN if mode == "regression" else None), ts=True)
    elif mode in ("python81", "python-backfill"):
        files = ["test_level1_gates.py", "test_weekly_report*.py", "test_publish_recovery_reports.py"] if mode == "python81" else ["test_backfill_recovery_reports.py"]
        result = run(mode, [PYTHON, "-B", "-X", "utf8", "test/ops_l1_python.py", *files])
    elif mode == "tsc":
        result = run(mode, ["node", "node_modules/typescript/bin/tsc", "--noEmit", "--pretty", "false"])
    elif mode in ("backfill-flag", "backfill-publish", "publish-recovery-gate", "publish-sentinel-live-slots", "publish-time-gate", "catchup-publish-due-slots"):
        result = run(mode, ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", f"test/ps-{mode}.smoke.ps1"])
    else:
        raise SystemExit("Unknown mode: " + mode)
    sys.exit(result["exit_code"])
