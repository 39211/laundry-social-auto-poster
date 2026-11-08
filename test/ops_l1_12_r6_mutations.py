"""R6 mutants: actual script exits, empty modules, and removal of script mode."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    work = ROOT / "output/operations" / ("ops-l1-12-r6-mutations-" + uuid.uuid4().hex)
    files = ("scripts/level1_offline_checks.py", "test/test_level1_r6.py",
             "test/test_level1_r5.py", "test/ops_l1_python.py",
             "line-bot/run_a2b_tests.py", "line-bot/test-assets/offline_temp.py",
             "line-bot/test_linebot_fix_20260926.py")
    originals = {name: (ROOT / name).read_bytes() for name in files}
    for name, content in originals.items():
        dest = work / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(content)
    mutants = (
        ("M1_nonzero_script_pass", "passed = result.returncode == 0", "passed = True",
         "test_script_nonzero_makes_line_full_fail_with_log_tail"),
        ("M2_zero_tests_pass", 'tests > counts["skipped"]', 'tests >= counts["skipped"]',
         "test_empty_module_stays_no_data"),
        ("M3_script_mode_removed", "and has_script_entry(bot, module)", "and False",
         "test_script_exit_zero_runs_main_and_passes_one_case"),
    )
    runs = []

    def run(label):
        started = time.monotonic()
        result = subprocess.run([sys.executable, "-B", "-X", "utf8", "test/ops_l1_python.py", "test_level1_r6.py"],
                                cwd=work, env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"),
                                capture_output=True, text=True, encoding="utf-8", timeout=120)
        output = result.stdout + result.stderr
        log = work / (label + ".txt")
        log.write_text(output, encoding="utf-8")
        summaries = re.findall(r"^Ran (\d+) tests? in", output, re.M)
        row = dict(name=label, exit_code=result.returncode,
                   failures=re.findall(r"^FAIL: (\w+)", output, re.M),
                   errors=re.findall(r"^ERROR: (\w+)", output, re.M),
                   tests=int(summaries[-1]) if summaries else 0,
                   elapsed_seconds=round(time.monotonic() - started, 3), log=str(log))
        runs.append(row)
        return row

    proof = dict(task="OPS-L1-12 r6", runs=runs,
                 candidate_sha256={name: hashlib.sha256(content).hexdigest() for name, content in originals.items()})
    target = work / files[0]
    try:
        baseline = run("baseline")
        assert baseline["exit_code"] == 0 and baseline["tests"] >= 10, baseline
        print("baseline: GREEN", flush=True)
        for name, old, new, required in mutants:
            source = originals[files[0]].decode("utf-8")
            assert source.count(old) == 1, (name, source.count(old))
            try:
                target.write_text(source.replace(old, new), encoding="utf-8")
                row = run(name)
                row["mutant_sha256"] = hashlib.sha256(target.read_bytes()).hexdigest()
                assert row["exit_code"] == 1 and not row["errors"] and required in row["failures"], row
                print(name + ": RED " + required, flush=True)
            finally:
                target.write_bytes(originals[files[0]])
            row["restored_sha256"] = hashlib.sha256(target.read_bytes()).hexdigest()
            assert target.read_bytes() == originals[files[0]]
        restored = run("restored")
        assert restored["exit_code"] == 0 and restored["tests"] == baseline["tests"], restored
        proof["killed"] = sum(r["exit_code"] == 1 for r in runs)
    finally:
        target.write_bytes(originals[files[0]])
        proof["candidate_unchanged"] = all((ROOT / name).read_bytes() == content for name, content in originals.items())
        proof["copy_restored"] = all((work / name).read_bytes() == content for name, content in originals.items())
        (work / "proof.json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    assert proof["candidate_unchanged"] and proof["copy_restored"] and proof["killed"] == 3
    print("MUTANTS_KILLED=3 RESTORED_GREEN=true " + str(work / "proof.json"), flush=True)


if __name__ == "__main__":
    main()
