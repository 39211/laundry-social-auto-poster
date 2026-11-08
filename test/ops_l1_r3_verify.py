"""OPS-L1-10-r3 offline evidence runner. Writes only this worktree."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "reports"
BEFORE = ROOT / "output/operations/ops-l1-r3-before"
FIXTURES = ROOT / "output/operations/ops-l1-r3-fixtures"
PYTHON = "C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe"
TS_FILES = ["publishRecovery", "scheduleAhead", "scheduleAhead.reconcile", "facebookLostAlert",
            "postCurrentSlot", "postCurrentSlot.unrecordedPublish", "publishGuards",
            "loggingConcurrency", "retry", "postCurrentSlot.allDue", "publishSentinel", "publishTimeGate"]
WRAPPER_PATTERN = r"^(?!.*(?:covers due, posted, retry, process and task-registration gates|invokes production helpers)).*$"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(name, data):
    (REPORTS / f"ops-l1-10-r3-{name}.json").write_text(
        json.dumps(data, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")


def environment():
    FIXTURES.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.update(TEMP=str(FIXTURES), TMP=str(FIXTURES), PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8")
    return env


def run(name, command, cwd=ROOT, json_result=False):
    path = REPORTS / f"ops-l1-10-r3-{name}.txt"
    with path.open("wb") as output:
        child = subprocess.run(command, cwd=cwd, env=environment(), stdout=output,
                               stderr=subprocess.STDOUT, timeout=900)
    record = {"name": name, "command": command, "cwd": str(cwd), "exit_code": child.returncode,
              "log": str(path.relative_to(ROOT)), "at": datetime.now(timezone.utc).isoformat()}
    if json_result:
        data = json.loads((REPORTS / f"ops-l1-10-r3-{name}.json").read_text(encoding="utf-8"))
        record.update(passed=data["numPassedTests"], failed=data["numFailedTests"],
                      skipped=data["numPendingTests"], total=data["numTotalTests"],
                      failed_cases=[case["fullName"] for suite in data["testResults"]
                                    for case in suite["assertionResults"] if case["status"] == "failed"])
    else:
        text = path.read_text(encoding="utf-8", errors="replace")
        record.update(case_ok=text.count("CASE_OK"), case_fail=text.count("CASE_FAIL"), tail=text[-1400:])
    print(json.dumps(record, ensure_ascii=True), flush=True)
    return record


def ts_command(name, files, pattern=None):
    result = ["node", "--import", "./test/helpers/opsBootstrap.mjs",
              str(ROOT / "node_modules/vitest/vitest.mjs"), "run", "--config", "test/ops-l1-offline.config.ts",
              "--configLoader", "native", "--pool", "threads", "--maxWorkers", "1"]
    result += [f"test/{file}.test.ts" for file in files]
    if pattern:
        result += ["--testNamePattern", pattern]
    return result + ["--reporter=json", "--outputFile=" + str(REPORTS / f"ops-l1-10-r3-{name}.json")]


def snapshot():
    BEFORE.mkdir(parents=True, exist_ok=False)
    paths = sorted([*ROOT.glob("src/**/*.ts"), *ROOT.glob("test/**/*.ts")])
    paths += [ROOT / p for p in ["package.json", "test/helpers/opsBootstrap.mjs"]]
    files = []
    for path in paths:
        rel = path.relative_to(ROOT)
        target = BEFORE / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
        files.append({"path": rel.as_posix(), "sha256": digest(path)})
    status = subprocess.run(["git", "status", "--short"], cwd=ROOT, capture_output=True, check=True)
    save("baseline-manifest", {"files": files, "status": status.stdout.decode("utf-8"), "copy": str(BEFORE)})
    print("SNAPSHOT_OK " + str(BEFORE), flush=True)


def finalize():
    read = lambda name: json.loads((REPORTS / f"ops-l1-10-r3-{name}.json").read_text(encoding="utf-8"))
    baseline, green, regression, red = [read(name + "-ts") for name in ("baseline", "green", "regression", "red")]
    assert (baseline["numPassedTests"], baseline["numFailedTests"], baseline["numPendingTests"]) == (192, 0, 2)
    assert (green["numPassedTests"], green["numFailedTests"]) == (34, 0)
    assert (regression["numPassedTests"], regression["numFailedTests"], regression["numPendingTests"]) == (226, 0, 2)
    assert (red["numPassedTests"], red["numFailedTests"]) == (7, 27)
    failed = lambda data: sorted(case["fullName"] for suite in data["testResults"]
                                 for case in suite["assertionResults"] if case["status"] == "failed")
    wrappers, old_wrappers = read("node-ps-wrappers"), read("node-ps-wrappers-baseline")
    assert wrappers["numFailedTests"] == old_wrappers["numFailedTests"] == 8
    assert failed(wrappers) == failed(old_wrappers)
    mutation = read("mutations")
    assert mutation["candidate_unchanged"] and len(mutation["mutations"]) == 7
    assert mutation["runs"][-1]["passed"] == 73 and mutation["runs"][-1]["failed"] == 0
    checks = read("checks")
    known_blocks = []
    for check in checks:
        if check["name"] == "backfill-publish":
            assert check["exit_code"] == 2 and "SMOKE_BLOCKED native File.Replace:" in check["tail"] and "Access to the path is denied" in check["tail"]
            known_blocks.append(check["name"])
        elif check["name"] == "backfill-publish-shim":
            assert check["exit_code"] == 2 and "cases=135 failures=0 blocked=1" in check["tail"], check
            known_blocks.append(check["name"])
        else:
            assert check["exit_code"] == 0 and check["case_fail"] == 0, check
    assert [check["case_ok"] for check in checks if check["name"] in (
        "publish-recovery-gate", "publish-sentinel-live-slots", "publish-time-gate", "catchup-publish-due-slots")] == [1, 66, 11, 13]
    assert "Ran 81 tests" in checks[0]["tail"] and "OK" in checks[0]["tail"]
    initial = read("baseline-manifest")
    changed = [entry["path"] for entry in initial["files"] if digest(ROOT / entry["path"]) != entry["sha256"]]
    expected = ["src/publishRecovery.ts", "src/scheduleAhead.ts", "src/postCurrentSlot.ts", "test/publishRecovery.test.ts"]
    assert set(changed) == set(expected), changed
    r2 = json.loads((REPORTS / "ops-l1-10-r2-manifest.json").read_text(encoding="utf-8"))
    preserved = [{"path": entry["path"], "matches_r2": digest(ROOT / entry["path"]) == entry["final_sha256"]}
                 for entry in r2["r1_file_comparison"] if entry["path"] not in expected]
    assert all(entry["matches_r2"] for entry in preserved), preserved
    staged = subprocess.run(["git", "diff", "--cached", "--name-only"], cwd=ROOT, capture_output=True, check=True)
    assert not staged.stdout.strip(), "Unexpected staged work"
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    assert head == "cc0f3ced0876425cbffb835dc5bf193606ce9629"
    groups = {}
    for label, data in (("old", red), ("new", green)):
        groups[label] = {}
        for number in range(1, 5):
            cases = [case for suite in data["testResults"] for case in suite["assertionResults"] if f"r3 F{number}:" in case["title"]]
            groups[label][str(number)] = {"passed": sum(case["status"] == "passed" for case in cases),
                                          "failed": sum(case["status"] == "failed" for case in cases)}
    paths = expected + ["test/publishRecovery.r3.test.ts", "test/ops_l1_r3_verify.py", "test/ops_l1_r3_mutations.py",
                        "reports/ops-l1-10-r3.md", "reports/ops-l1-10-r3-delta.patch"]
    for name in paths:
        if name.endswith(".patch"):
            continue  # Unified diff context intentionally prefixes blank lines with a space.
        lines = (ROOT / name).read_text(encoding="utf-8").splitlines()
        assert all(line == line.rstrip() for line in lines), "Trailing whitespace: " + name
    save("manifest", {"task": "OPS-L1-10-r3", "at": datetime.now(timezone.utc).isoformat(), "head": head,
                      "status": "OFFLINE_CANDIDATE_PENDING_CLAUDE_REVIEW_WITH_KNOWN_ENVIRONMENT_BLOCKS",
                      "staged": False, "groups": groups, "unchanged_r2_files": preserved,
                      "candidate_unchanged_by_mutations": True, "mutants_killed": 7,
                      "known_environment_blocks": known_blocks, "unchanged_wrapper_failures": failed(wrappers),
                      "files": [{"path": name, "sha256": digest(ROOT / name)} for name in paths],
                      "checks": checks})
    print("FINAL_VERIFIED new_product_failures=0 known_wrapper_failures=8 backfill_blocked=true staged=false", flush=True)


if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "snapshot":
        snapshot()
    elif mode == "finalize":
        finalize()
    elif mode in ("baseline", "red", "green", "regression"):
        names = TS_FILES if mode == "baseline" else ["publishRecovery.r3"]
        cwd = BEFORE if mode in ("baseline", "red") else ROOT
        if mode == "red":
            # Reproduce old-red after the candidate has been fixed, without
            # ever reverting or mutating the candidate's production files.
            shutil.copyfile(ROOT / "test/publishRecovery.r3.test.ts", BEFORE / "test/publishRecovery.r3.test.ts")
        if mode == "regression":
            names = TS_FILES + ["publishRecovery.r3"]
        label = mode + "-ts"
        result = run(label, ts_command(label, names, WRAPPER_PATTERN if mode in ("baseline", "regression") else None),
                     cwd=cwd, json_result=True)
        save(mode + "-check", result)
        sys.exit(result["exit_code"])
    elif mode in ("wrappers", "wrappers-baseline"):
        name = "node-ps-wrappers" + ("-baseline" if mode.endswith("-baseline") else "")
        cwd = ROOT
        if mode.endswith("-baseline"):
            # Runtime/test TS is the frozen r2 snapshot. These unchanged PS
            # dependencies are copied locally; no production tree is involved.
            for pattern in ("scripts/*.ps1", "test/*.smoke.ps1"):
                for source in ROOT.glob(pattern):
                    target = BEFORE / source.relative_to(ROOT)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source, target)
            cwd = BEFORE
        pattern = "covers due, posted, retry, process and task-registration gates|invokes production helpers|catchup-publish posted-log checks"
        result = run(name, ts_command(name, ["publishSentinel", "publishTimeGate", "catchup-posted-log"], pattern), cwd=cwd, json_result=True)
        save("wrapper-check" + ("-baseline" if mode.endswith("-baseline") else ""), result)
        sys.exit(result["exit_code"])
    elif mode == "checks":
        checks = []
        checks.append(run("python", [PYTHON, "-B", "-X", "utf8", "test/ops_l1_python.py",
                                     "test_level1_gates.py", "test_weekly_report*.py", "test_publish_recovery_reports.py"]))
        for name in ["publish-recovery-gate", "publish-sentinel-live-slots", "publish-time-gate", "catchup-publish-due-slots",
                     "backfill-publish", "backfill-publish-shim"]:
            script = name.removesuffix("-shim")
            command = ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
                       f"test/ps-{script}.smoke.ps1"]
            if name.endswith("-shim"):
                command += ["-UseAtomicReplaceShim"]
            checks.append(run(name, command))
        checks.append(run("typecheck", ["node", "node_modules/typescript/bin/tsc", "--noEmit", "--pretty", "false"]))
        checks.append(run("diff-check", ["git", "diff", "--check"]))
        save("checks", checks)
        unexpected = []
        for check in checks:
            if check["name"] == "backfill-publish":
                known_block = check["exit_code"] == 2 and "SMOKE_BLOCKED native File.Replace:" in check["tail"] and "Access to the path is denied" in check["tail"]
            elif check["name"] == "backfill-publish-shim":
                known_block = check["exit_code"] == 2 and "failures=0" in check["tail"] and "blocked=1" in check["tail"]
            else:
                known_block = False
            if check["exit_code"] != 0 and not known_block:
                unexpected.append(check["name"])
        save("check-status", {"unexpected_failures": unexpected, "all_checks_passed": all(check["exit_code"] == 0 for check in checks)})
        sys.exit(bool(unexpected))
    else:
        raise SystemExit("Unknown verification mode: " + mode)
