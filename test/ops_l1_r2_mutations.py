"""Offline mutation proof in a task-owned source copy; never edit the candidate."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import uuid


ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "reports"
COPY = ROOT / "output" / "operations" / ("ops-l1-r2-mutation-" + uuid.uuid4().hex)
COPY.mkdir(parents=True)
SOURCE = ROOT / "src" / "publishRecovery.ts"
TEST = ROOT / "test" / "publishRecovery.test.ts"
source_bytes = SOURCE.read_bytes()
test_bytes = TEST.read_bytes()
sha = lambda value: hashlib.sha256(value).hexdigest()

for path in (ROOT / "src").rglob("*.ts"):
    target = COPY / path.relative_to(ROOT)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, target)
for name in ("package.json", "test/publishRecovery.test.ts", "test/ops-l1-offline.config.ts",
             "test/helpers/opsOffline.ts", "test/helpers/opsBootstrap.mjs"):
    target = COPY / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / name, target)

source = source_bytes.decode("utf-8")
tail = '(!failure && scheduledFailure !== undefined) || /commit point|response lost|may already be live/i.test(error)'
start = source.index('    if (!/Missing or invalid image file/i.test(error) && (failure?.status === "uncertain" ||')
end = source.index(' reason = "ambiguous_commit";', start) + len(' reason = "ambiguous_commit";')
guard = source[start:end]
assert source.count(tail) == 1
partial = source.replace(tail, "false")
disabled = source[:start] + '    if (false) reason = "ambiguous_commit";' + source[end:]
copied_source = COPY / "src" / "publishRecovery.ts"
copied_test = COPY / "test" / "publishRecovery.test.ts"

# Reconstruct the r1 tests and verify the exact r1 hash for the diagnostic control.
tests = test_bytes.decode("utf-8")
new_start = tests.index('  it.each([\n    ["response lost", "HTTP 503 Service Unavailable; response lost"],')
new_end = tests.index('  it.each([null, false, 0, ""])', new_start)
old_tests = (tests[:new_start] + tests[new_end:]).encode("utf-8")
r1 = json.loads((REPORTS / "ops-l1-10-r1-manifest.json").read_text(encoding="utf-8-sig"))
r1_test_sha = next(item["sha256"] for item in r1["files"] if item["path"] == "test/publishRecovery.test.ts")
assert sha(old_tests) == r1_test_sha, "Reconstructed r1 tests differ from the r1 artifact"

env = os.environ.copy()
fixtures = COPY / "output" / "operations" / "ops-l1-fixtures"
fixtures.mkdir(parents=True)
env.update(TEMP=str(fixtures), TMP=str(fixtures))
command = ["node", "--import", "./test/helpers/opsBootstrap.mjs",
           str(ROOT / "node_modules" / "vitest" / "vitest.mjs"), "run",
           "--config", "test/ops-l1-offline.config.ts", "--configLoader", "native",
           "--pool", "threads", "--maxWorkers", "1", "test/publishRecovery.test.ts"]
results = []


def run(label, expected_passed, expected_failed, pattern=None):
    output = REPORTS / ("ops-l1-10-r2-" + label + ".json")
    args = command + (["--testNamePattern", pattern] if pattern else [])
    args += ["--reporter=json", "--outputFile=" + str(output)]
    with (REPORTS / ("ops-l1-10-r2-" + label + ".txt")).open("w", encoding="utf-8") as log:
        child = subprocess.run(args, cwd=COPY, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=180)
    data = json.loads(output.read_text(encoding="utf-8"))
    assertions = [case for suite in data["testResults"] for case in suite["assertionResults"]]
    failed = [case for case in assertions if case["status"] == "failed"]
    record = {"label": label, "command": args, "cwd": str(COPY), "exit_code": child.returncode,
              "passed": data["numPassedTests"], "failed": data["numFailedTests"],
              "pending": data["numPendingTests"], "source_sha256": sha(copied_source.read_bytes()),
              "cases": [{"name": case["title"], "status": case["status"],
                         "failureMessages": case.get("failureMessages", [])} for case in assertions]}
    results.append(record)
    assert child.returncode == (1 if expected_failed else 0), record
    assert (data["numPassedTests"], data["numFailedTests"]) == (expected_passed, expected_failed), record
    assert len(failed) == expected_failed, "Collection error is not a killed mutant"
    for case in failed:
        assert re.search(r"expected \[ ['\"]facebook['\"] \] to deeply equal \[\]", "\n".join(case["failureMessages"])), "Failure did not observe an unwanted Facebook send"
    if pattern:
        expected = {"r2 a:": "failed" if label == "mutation-all" else "passed",
                    "r2 b:": "failed", "r2 c:": "passed", "r2 regex:": "failed"}
        for prefix, status in expected.items():
            matches = [case for case in assertions if case["title"].startswith(prefix)]
            assert len(matches) == (3 if prefix == "r2 a:" else 1), (prefix, matches)
            assert all(case["status"] == status for case in matches), (prefix, matches)
    print(json.dumps({"label": label, "passed": record["passed"], "failed": record["failed"],
                      "pending": record["pending"], "exit_code": child.returncode}), flush=True)


try:
    copied_source.write_bytes(partial.encode("utf-8"))
    copied_test.write_bytes(old_tests)
    run("r1-literal-mutation-control", 33, 0)
    copied_test.write_bytes(test_bytes)
    run("mutation-tail", 4, 2, "r2 (?:a|b|c|regex):")
    copied_source.write_bytes(disabled.encode("utf-8"))
    run("mutation-all", 1, 5, "r2 (?:a|b|c|regex):")
finally:
    copied_source.write_bytes(source_bytes)
    copied_test.write_bytes(test_bytes)
    restoration = {"candidate_source_before": sha(source_bytes), "candidate_source_after": sha(SOURCE.read_bytes()),
                   "copy_source_restored": sha(copied_source.read_bytes()),
                   "candidate_test_before": sha(test_bytes), "candidate_test_after": sha(TEST.read_bytes()),
                   "r1_test_sha256": r1_test_sha, "reconstructed_r1_test_sha256": sha(old_tests)}
    restoration["source_identical"] = len({restoration[key] for key in (
        "candidate_source_before", "candidate_source_after", "copy_source_restored")}) == 1
    restoration["test_identical"] = restoration["candidate_test_before"] == restoration["candidate_test_after"]
    proof = {"task": "OPS-L1-10-r2", "created_at": datetime.now(timezone.utc).isoformat(),
             "copy": str(COPY), "original_guard": guard,
             "tail_mutation": {"before": tail, "after": "false"},
             "full_mutation": {"before": guard, "after": '    if (false) reason = "ambiguous_commit";'},
             "runs": results, "restoration": restoration}
    (REPORTS / "ops-l1-10-r2-mutations.json").write_text(json.dumps(proof, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    assert restoration["source_identical"] and restoration["test_identical"], restoration
    print("RESTORED_SHA256=" + restoration["copy_source_restored"], flush=True)

run("restored-copy-green", 39, 0)
proof["runs"] = results
(REPORTS / "ops-l1-10-r2-mutations.json").write_text(json.dumps(proof, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
