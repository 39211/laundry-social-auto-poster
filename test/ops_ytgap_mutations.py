"""Offline mutation proof. Mutate a private copy, restore bytes, then rerun green."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    "scripts/day-audit.ps1",
    "scripts/youtube-upload.ps1",
    "scripts/lib/live-reel.ps1",
    "test/ps-day-audit-reel-count.smoke.ps1",
    "test/ps-youtube-live-reel.smoke.ps1",
)
AUDIT = FILES[3]
UPLOAD = FILES[4]


def main():
    work = ROOT / "output/operations" / ("ops-ytgap-mutations-" + uuid.uuid4().hex)
    original = {name: (ROOT / name).read_bytes() for name in FILES}
    for name, content in original.items():
        target = work / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    runs = []
    proof = {"task": "OPS-YTGAP-r1", "runs": runs, "expected_mutants": 3,
             "original_sha256": {name: hashlib.sha256(content).hexdigest()
                                 for name, content in original.items()}}

    def run(label, script):
        command = ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script]
        result = subprocess.run(command, cwd=work, capture_output=True, timeout=90,
                                text=True, encoding="utf-8", errors="replace", env=dict(os.environ))
        output = result.stdout + result.stderr
        log = work / (label + ".txt")
        log.write_text(output, encoding="utf-8")
        row = {"name": label, "command": command, "exit_code": result.returncode,
               "passed_cases": len(re.findall(r"^CASE_OK ", output, re.M)),
               "failed_cases": re.findall(r"^CASE_FAIL (.+)$", output, re.M),
               "smoke_ok": "SMOKE_OK" in output, "log": str(log)}
        runs.append(row)
        print(f"{label}: exit={row['exit_code']} passed={row['passed_cases']} failed={len(row['failed_cases'])}", flush=True)
        return row

    mutants = (
        ("M1_ig_slot_is_reel", FILES[0],
         '$liveReels = @(@(2, 3) | Where-Object { Test-LiveReelHasSlot $posted $_ }).Count',
         '$liveReels = @($liveIgSlots | Where-Object { $_ -in 2, 3 }).Count',
         AUDIT, "name=image-no-youtube-gap reason=live_reels got=1 expected=0"),
        ("M2_predicate_always_true", FILES[2],
         '    if ($null -eq $Entry) { return $false }',
         '    return $true\n    if ($null -eq $Entry) { return $false }',
         UPLOAD, "name=ig-image got=True expect=False"),
        ("M3_audit_only_schedules", FILES[0],
         '    if (-not $AuditOnly) {\n        Start-ScheduledTask',
         '    if ($true) {\n        Start-ScheduledTask',
         AUDIT, "name=reel-missing-upload reason=AuditOnly side effects"),
    )
    try:
        for label, script in (("baseline_audit", AUDIT), ("baseline_uploader", UPLOAD)):
            row = run(label, script)
            assert row["exit_code"] == 0 and row["smoke_ok"] and not row["failed_cases"], row
        for label, name, old, new, script, expected_failure in mutants:
            target = work / name
            source = original[name].decode("utf-8-sig").replace("\r\n", "\n")
            assert source.count(old) == 1, (label, "mutation anchor missing/ambiguous")
            try:
                target.write_text(source.replace(old, new, 1), encoding="utf-8-sig", newline="")
                row = run(label, script)
                row["mutant_sha256"] = hashlib.sha256(target.read_bytes()).hexdigest()
                assert row["exit_code"] == 1 and not row["smoke_ok"], row
                assert any(expected_failure in failure for failure in row["failed_cases"]), row
                row["killed_by"] = expected_failure
            finally:
                target.write_bytes(original[name])
                assert target.read_bytes() == original[name]
                if runs and runs[-1]["name"] == label:
                    runs[-1]["restored_sha256"] = hashlib.sha256(target.read_bytes()).hexdigest()
        for label, script in (("restored_audit", AUDIT), ("restored_uploader", UPLOAD)):
            row = run(label, script)
            assert row["exit_code"] == 0 and row["smoke_ok"] and not row["failed_cases"], row
        proof["mutants_killed"] = sum("killed_by" in row for row in runs)
    finally:
        for name, content in original.items():
            (work / name).write_bytes(content)
        proof["candidate_unchanged"] = all((ROOT / name).read_bytes() == content for name, content in original.items())
        proof["copy_restored"] = all((work / name).read_bytes() == content for name, content in original.items())
        proof["runner_sha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        (work / "proof.json").write_text(json.dumps(proof, ensure_ascii=False, indent=2), encoding="utf-8")
    assert proof["candidate_unchanged"] and proof["copy_restored"] and proof["mutants_killed"] == 3, proof
    print(f"MUTANTS_KILLED=3 RESTORED_GREEN=true PROOF={work / 'proof.json'}", flush=True)


if __name__ == "__main__":
    main()
