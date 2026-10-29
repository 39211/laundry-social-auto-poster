"""Read-only independent SHA/size checks for the synthetic Pester roundtrip.

Only --out and its sibling manifest evidence files are written. No production
paths, PowerShell recovery helpers or native task APIs are used.
"""

import argparse
import hashlib
import json
from pathlib import Path
import re


def verify_snapshot(directory: Path, drill: Path, check_sources: bool) -> dict:
    directory = directory.resolve(strict=True)
    assert directory.is_relative_to(drill), "Snapshot outside the synthetic drill"
    manifest = json.loads((directory / "MANIFEST.json").read_text(encoding="utf-8-sig"))
    assert manifest["Status"] == "Complete" and manifest["SchemaVersion"] == 1
    entries = manifest["Files"]
    assert len(entries) == 12, f"Expected 12 entries, got {len(entries)}"
    seen = set()
    total = 0
    for entry in entries:
        payload = (directory / entry["BackupPath"]).resolve(strict=True)
        assert payload.is_relative_to(directory), "Payload escaped backup"
        assert str(payload).casefold() not in seen, "Duplicate payload"
        seen.add(str(payload).casefold())
        value = payload.read_bytes()
        assert len(value) == entry["Size"], "Payload size mismatch"
        assert hashlib.sha256(value).hexdigest() == entry["Sha256"].lower(), "Payload hash mismatch"
        if check_sources:
            source = Path(entry["SourcePath"]).resolve(strict=True)
            assert source.is_relative_to(drill), "Destination outside the synthetic drill"
            restored = source.read_bytes()
            assert len(restored) == entry["Size"], "Restored size mismatch"
            assert hashlib.sha256(restored).hexdigest() == entry["Sha256"].lower(), "Restored hash mismatch"
        total += len(value)
    return {"directory": str(directory), "count": len(entries), "bytes": total, "manifest": manifest}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--transcript", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    ops = Path(__file__).resolve().parent
    output = args.out.resolve()
    assert output.is_relative_to(ops / "evidence"), "Evidence output must stay under ops/evidence"
    transcript = args.transcript.read_text(encoding="utf-16")
    match = re.search(r"ROUNDTRIP backup=(.+) entries=12 SHA256_ALL_EQUAL=True preRestore=(.+)", transcript)
    run = re.search(r"A5_DRILL elapsedSeconds=([0-9.]+) root=(.+) realSchedulerWrites=0 livePathOperations=0", transcript)
    tests = re.search(r"A5_TEST_RESULT total=(\d+) passed=(\d+) failed=0", transcript)
    assert match and run and tests, "No complete passing roundtrip transcript"
    assert tests[1] == tests[2], "Pester counts disagree"
    drill = Path(run[2]).resolve(strict=True)
    assert drill.is_relative_to(ops / "_tmp"), "Drill outside the permitted temporary directory"
    backup = verify_snapshot(Path(match[1]), drill, check_sources=True)
    previous = verify_snapshot(Path(match[2]), drill, check_sources=False)
    report = {
        "status": "PASS",
        "synthetic_only": True,
        "formal_rto": "UNMEASURED",
        "pester_total": int(tests[1]),
        "pester_elapsed_seconds": float(run[1]),
        "drill_root": str(drill),
        "restored_files_verified": backup["count"],
        "restored_bytes_verified": backup["bytes"],
        "pre_restore_payloads_verified": previous["count"],
        "pre_restore_bytes_verified": previous["bytes"],
        "sha256_and_size_all_equal": True,
        "native_scheduler_writes": 0,
        "live_path_operations": 0,
        "backup_directory": backup["directory"],
        "pre_restore_directory": previous["directory"],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    for label, snapshot in (("roundtrip", backup), ("pre-restore", previous)):
        (output.parent / f"final-{label}-MANIFEST.json").write_text(
            json.dumps(snapshot["manifest"], ensure_ascii=True, indent=2) + "\n", encoding="utf-8"
        )
    print(json.dumps(report, ensure_ascii=True))


if __name__ == "__main__":
    main()
