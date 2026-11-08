"""R4: kill blanket deny, blanket allow, and removed-content-comparison mutants."""
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
    work = ROOT / "output/operations" / ("ops-l1-12-r4-mutations-" + uuid.uuid4().hex)
    files = ("scripts/level1_offline_checks.py", "line-bot/run_a2b_tests.py",
             "tests/golden/run_golden.py", "line-bot/test-assets/offline_temp.py",
             "line-bot/test_linebot_fix_20260926.py", "data/prices.json", "data/business-profile.json",
             "test/test_level1_r4.py", "test/ops_l1_python.py")
    originals = {name: (ROOT / name).read_bytes() for name in files}
    for name, content in originals.items():
        target = work / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    mutants = (
        ("deny_all_children", "scripts/level1_offline_checks.py",
         'if event == "subprocess.Popen" and pending_launch is not None and args == pending_launch:',
         'if False:', "test_producer_runner_subprocess_is_allowed"),
        ("allow_all_children", "scripts/level1_offline_checks.py",
         'raise PermissionError("OPS-L1-12: unguarded child process refused")',
         'return', "test_arbitrary_subprocess_is_refused_inside_worker"),
        ("remove_content_comparison", "tests/golden/run_golden.py",
         'if actual_content == expected_content:', 'if True:',
         "test_customer_reply_byte_difference_still_fails"),
    )
    runs = []
    def run(label):
        result = subprocess.run([sys.executable, "-B", "-X", "utf8", "test/ops_l1_python.py", "test_level1_r4.py"],
                                cwd=work, env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"),
                                capture_output=True, text=True, encoding="utf-8", timeout=90)
        output = result.stdout + result.stderr
        log = work / (label + ".txt")
        log.write_text(output, encoding="utf-8")
        row = dict(name=label, exit_code=result.returncode, log=str(log),
                   failures=re.findall(r"^FAIL: (\w+)", output, re.M),
                   errors=re.findall(r"^ERROR: (\w+)", output, re.M),
                   tests=int(re.search(r"Ran (\d+) tests?", output)[1]))
        runs.append(row)
        return row

    proof = {"task": "OPS-L1-12 r4", "runs": runs, "expected_mutants": len(mutants),
             "candidate_sha256": {n: hashlib.sha256(b).hexdigest() for n, b in originals.items()}}
    try:
        assert run("baseline")["exit_code"] == 0, runs
        for label, name, old, new, required in mutants:
            source = originals[name].decode("utf-8")
            assert source.count(old) == 1, (label, source.count(old))
            target = work / name
            target.write_text(source.replace(old, new), encoding="utf-8")
            row = run(label)
            row["mutant_sha256"] = hashlib.sha256(target.read_bytes()).hexdigest()
            assert row["exit_code"] == 1 and not row["errors"] and required in row["failures"], row
            print(label + ": RED " + required, flush=True)
            target.write_bytes(originals[name])
    finally:
        for name, original in originals.items():
            (work / name).write_bytes(original)
        proof["candidate_unchanged"] = all((ROOT / n).read_bytes() == b for n, b in originals.items())
        proof["copy_restored"] = all((work / n).read_bytes() == b for n, b in originals.items())
        (work / "proof.json").write_text(json.dumps(proof, indent=2), encoding="utf-8")
    restored = run("restored")
    proof["killed"] = sum(r["exit_code"] == 1 for r in runs)
    (work / "proof.json").write_text(json.dumps(proof, indent=2), encoding="utf-8")
    assert restored["exit_code"] == 0 and proof["candidate_unchanged"] and proof["copy_restored"], proof
    print("MUTANTS_KILLED=3 RESTORED_GREEN=true " + str(work / "proof.json"), flush=True)


if __name__ == "__main__":
    main()
