"""Run one isolated smoke mode and retain its exact output and source hashes."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = Path(__file__).resolve().parent
MODES = {
    "behavior-smoke": ["-UseAtomicReplaceShim"],
    "date-guard-mutation": ["-UseAtomicReplaceShim", "-MutateDateGuard"],
    "week-regex-mutation": ["-UseAtomicReplaceShim", "-MutateWeekRegex"],
    "first-comment-mutation": ["-UseAtomicReplaceShim", "-MutateFirstCommentGuard"],
}
mode = sys.argv[1]
args = MODES[mode]
source = ROOT / "scripts/backfill-publish.ps1"
before = hashlib.sha256(source.read_bytes()).hexdigest()
process = subprocess.run([
    "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", str(ROOT / "test/ps-backfill-publish.smoke.ps1"), *args,
], cwd=ROOT, capture_output=True, timeout=900)
output = process.stdout.decode("utf-8-sig", errors="replace") + process.stderr.decode("utf-8-sig", errors="replace")
after = hashlib.sha256(source.read_bytes()).hexdigest()
report = {"mode": mode, "exit_code": process.returncode, "arguments": args,
          "summary": [line for line in output.splitlines() if line.startswith("SMOKE_")],
          "passed": [line for line in output.splitlines() if line.startswith("CASE_OK")],
          "failed": [line for line in output.splitlines() if line.startswith("CASE_FAIL")],
          "blocked": [line for line in output.splitlines() if line.startswith("CASE_BLOCKED")],
          "source_before": before, "source_after": after, "source_unchanged": before == after}
(EVIDENCE / ("r3-" + mode + ".txt")).write_text(
    output + "\nEXIT_CODE=" + str(process.returncode) + "\nSOURCE_UNCHANGED=" + str(before == after).lower() + "\n", encoding="utf-8")
(EVIDENCE / ("r3-" + mode + ".json")).write_text(json.dumps(report, ensure_ascii=True, indent=2) + "\n", encoding="ascii")
print(json.dumps({key: value if key not in ("passed", "failed") else len(value)
                  for key, value in report.items()}, ensure_ascii=True))
assert before == after
if "mutation" in mode:
    assert process.returncode == 1 and report["failed"]
else:
    assert process.returncode in (0, 2) and not report["failed"] and report["summary"]
