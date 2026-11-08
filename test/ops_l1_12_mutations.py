"""Kill OPS-L1-12's seven required mutants in task-owned copies, then restore."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    work = ROOT / "output/operations" / ("ops-l1-12-mutations-" + uuid.uuid4().hex)
    files = ("scripts/level1_gates.py", "scripts/publish_recovery_report.py", "line-bot/tunnel_manager.py",
             "test/ops_l1_python.py", "test/test_level1_gates.py", "test/test_level1_checklist.py")
    for name in files:
        path = work / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes((ROOT / name).read_bytes())
    original = (ROOT / files[0]).read_bytes()
    source = original.decode("utf-8")
    target = work / files[0]
    mutants = (
        ("missing_is_pass", 'return {**_result(status, reason, **details), "evidence":',
         'return {**_result("pass" if status == "no_data" else status, reason, **details), "evidence":',
         "test_all_missing_is_no_data_and_11_not_ready"),
        ("restart_can_pass", 'return _gate("not_ready", "尚未上線：', 'return _gate("pass", "尚未上線：',
         "test_11_never_passes_with_any_receipt"),
        ("no_data_does_not_break_streak", 'all(_check_status(evaluation, key) in ("pass", "not_applicable")',
         'all(_check_status(evaluation, key) in ("pass", "not_applicable", "no_data")',
         "test_no_data_breaks_streak"),
        ("transfer_is_unanswered", "answered = replied + staff", "answered = replied",
         "test_02_transfer_is_answered_and_gap_fails"),
        ("nightly_one_minute_only", "on_time = opening <= stamp <= closing",
         "on_time = (stamp.hour, stamp.minute) == (23, 40)", "test_12_nightly_window_and_missing_report"),
        ("no_failure_is_no_data", 'return _gate("not_applicable", "當日 posted-log',
         'return _gate("no_data", "當日 posted-log', "test_10_no_failures_is_not_applicable"),
        ("service_gap_sixty_minutes", "SERVICE_GAP_SECONDS = 5 * 60", "SERVICE_GAP_SECONDS = 60 * 60",
         "test_01_records_pass_gap_fail_and_sparse_no_data"),
    )
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONUTF8="1")
    runs = []
    def run(label):
        result = subprocess.run([sys.executable, "-B", "-X", "utf8", "test/ops_l1_python.py", "test_level1_checklist.py"],
                                cwd=work, env=env, capture_output=True, text=True, encoding="utf-8", timeout=120)
        output = result.stdout + result.stderr
        (work / (label + ".txt")).write_text(output, encoding="utf-8")
        failed = re.findall(r"^FAIL: (\w+) \(([^)]+)\)", output, re.M)
        return {"name": label, "exit_code": result.returncode,
                "assertion_failures": [owner if owner.endswith("." + name) else owner + "." + name for name, owner in failed],
                "error_count": len(re.findall(r"^ERROR:", output, re.M)), "log": str(work / (label + ".txt"))}
    try:
        baseline = run("baseline")
        runs.append(baseline)
        assert baseline["exit_code"] == 0, baseline
        for label, old, new, required in mutants:
            assert source.count(old) == 1, (label, source.count(old))
            target.write_text(source.replace(old, new, 1), encoding="utf-8", newline="")
            row = run(label)
            row["mutant_sha256"] = hashlib.sha256(target.read_bytes()).hexdigest()
            runs.append(row)
            assert row["exit_code"] == 1 and row["error_count"] == 0, row
            assert any(name.endswith("." + required) for name in row["assertion_failures"]), row
            print(label + ": RED " + required, flush=True)
            target.write_bytes(original)
    finally:
        target.write_bytes(original)
        proof = {"runs": runs, "original_sha256": hashlib.sha256(original).hexdigest(),
                 "runner_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                 "candidate_unchanged": (ROOT / files[0]).read_bytes() == original,
                 "copy_restored": target.read_bytes() == original}
        (work / "proof.json").write_text(json.dumps(proof, ensure_ascii=False, indent=2), encoding="utf-8")
    restored = run("restored")
    proof["runs"].append(restored)
    (work / "proof.json").write_text(json.dumps(proof, ensure_ascii=False, indent=2), encoding="utf-8")
    assert restored["exit_code"] == 0 and proof["candidate_unchanged"] and proof["copy_restored"], proof
    print("MUTANTS_KILLED={0} RESTORED_GREEN=true {1}".format(len(mutants), work / "proof.json"), flush=True)


if __name__ == "__main__":
    main()
