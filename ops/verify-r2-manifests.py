"""Independent readback of r2 synthetic backups; writes one evidence JSON only."""

import argparse
import hashlib
import json
from pathlib import Path
import re


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--transcript", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    ops = Path(__file__).resolve().parent
    output = args.out.resolve()
    assert output.is_relative_to(ops / "evidence"), "Output outside ops/evidence"
    transcript = args.transcript.read_text(encoding="utf-16")
    run = re.search(r"A5_DRILL elapsedSeconds=([0-9.]+) root=(.+) realSchedulerWrites=0 livePathOperations=0", transcript)
    tests = re.search(r"A5_TEST_RESULT total=(\d+) passed=(\d+) failed=0", transcript)
    assert run and tests and tests[1] == tests[2], "No complete passing transcript"
    drill = Path(run[2]).resolve(strict=True)
    assert drill.is_relative_to(ops / "_tmp"), "Not a synthetic drill"
    cases = [
        ("r2-excluded-backup", 12, None),
        *[(f"r2-locked-{kind}-backup", 11, "IOException") for kind in ("data", "state", "local", "mdb", "tasks")],
        ("r2-denied-backup", 11, "UnauthorizedAccessException"),
        ("r2-late-lock", 11, "IOException"),
        ("r2-multiple-buffers", 12, None),
    ]
    checked = []
    total_bytes = 0
    for name, count, reason in cases:
        manifests = list((drill / name / "backups").glob("*/MANIFEST.json"))
        assert len(manifests) == 1, f"Expected one completed backup for {name}"
        directory = manifests[0].parent
        manifest = json.loads(manifests[0].read_text(encoding="utf-8-sig"))
        assert manifest["Status"] == "Complete"
        assert set(manifest["ExcludedFilePatterns"]) == {"*.lock", "*.pid", "*.tmp"}
        entries, skipped = manifest["Files"], manifest["Skipped"]
        assert len(entries) == count
        assert len(skipped) == (1 if reason else 0)
        if reason:
            assert skipped[0]["Reason"] == reason
            assert Path(skipped[0]["Path"]).resolve(strict=True).is_relative_to(drill / name)
        expected_payloads = set()
        for entry in entries:
            payload = (directory / entry["BackupPath"]).resolve(strict=True)
            source = Path(entry["SourcePath"]).resolve(strict=True)
            assert payload.is_relative_to(directory) and source.is_relative_to(drill / name)
            assert payload.suffix.casefold() not in (".lock", ".pid", ".tmp")
            data = payload.read_bytes()
            assert len(data) == entry["Size"]
            assert hashlib.sha256(data).hexdigest() == entry["Sha256"].lower()
            assert source.read_bytes() == data
            assert all(item["Path"].casefold() != entry["SourcePath"].casefold() for item in skipped)
            expected_payloads.add(payload)
            total_bytes += len(data)
        actual_payloads = {p.resolve(strict=True) for p in (directory / "payload").rglob("*") if p.is_file()}
        assert actual_payloads == expected_payloads, f"Unlisted or missing payloads: {name}"
        checked.append({"case": name, "files": count, "skipped": len(skipped), "manifest": str(manifests[0])})
    for name in ("r2-critical-.env-backup", "r2-critical-secrets-line.json-backup", "r2-destination-failure", "r2-source-changed"):
        assert not list((drill / name / "backups").glob("*/MANIFEST.json")), f"Unexpected completed failed backup: {name}"
    for name in ("r2-excluded-DryRun", *[f"r2-locked-{kind}-DryRun" for kind in ("data", "state", "local", "mdb", "tasks")], "r2-denied-DryRun"):
        assert not (drill / name / "backups").exists(), f"DryRun created a backup: {name}"
    report = {
        "status": "PASS", "synthetic_only": True, "formal_rto": "UNMEASURED",
        "pester_total": int(tests[1]), "drill_root": str(drill),
        "manifests_verified": len(checked), "payloads_verified": sum(c["files"] for c in checked),
        "bytes_verified": total_bytes, "skipped_records_verified": sum(c["skipped"] for c in checked),
        "unlisted_payloads": 0, "cases": checked,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=True))


if __name__ == "__main__":
    main()
