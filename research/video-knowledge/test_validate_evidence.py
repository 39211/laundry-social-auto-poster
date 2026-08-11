#!/usr/bin/env python3
"""Negative/mutation tests for the fail-closed evidence validator."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parent
FILES = (
    "evidence.jsonl",
    "source-index.json",
    "source-url-validation.json",
    "knowledge-pack-manifest.json",
    "validate_evidence.py",
)


def run_validator(root: Path) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["EVIDENCE_VALIDATION_ROOT"] = str(root)
    return subprocess.run(
        [sys.executable, str(root / "validate_evidence.py"), "--allow-pending-double-review"],
        text=True,
        capture_output=True,
        check=False,
        env=env,
    )


def main() -> None:
    baseline = run_validator(ROOT)
    assert baseline.returncode == 2, baseline.stdout + baseline.stderr
    assert "PENDING_DIAGNOSTIC_ONLY" in baseline.stdout, baseline.stdout + baseline.stderr
    assert "VALIDATION_OK" not in baseline.stdout, baseline.stdout

    with tempfile.TemporaryDirectory(prefix="evidence-validator-mutation-") as temporary:
        temp_root = Path(temporary)
        for filename in FILES:
            shutil.copy2(ROOT / filename, temp_root / filename)

        registry = temp_root / "evidence.jsonl"
        rows = [json.loads(line) for line in registry.read_text(encoding="utf-8").splitlines() if line.strip()]
        assert all(row["verification_status"] == "candidate" for row in rows)
        manifest_path = temp_root / "knowledge-pack-manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["accepted_count"] = 1
        manifest["candidate_count"] = len(rows) - 1
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        candidate_miscount = run_validator(temp_root)
        candidate_output = candidate_miscount.stdout + candidate_miscount.stderr
        assert candidate_miscount.returncode == 1, candidate_output
        assert "accepted count differs from manifest" in candidate_output, candidate_output
        assert "VALIDATION_OK" not in candidate_output, candidate_output

        mutated_id = rows[0]["evidence_id"]
        rows[0]["verification_status"] = "accepted"
        registry.write_text(
            "\n".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) for row in rows) + "\n",
            encoding="utf-8",
        )

        mutated = run_validator(temp_root)
        combined = mutated.stdout + mutated.stderr
        assert mutated.returncode == 1, combined
        assert (
            f"accepted evidence lacks a corresponding independent PASS review: {mutated_id}" in combined
        ), combined
        assert "VALIDATION_OK" not in combined, combined
        assert "PENDING_DIAGNOSTIC_ONLY" not in combined, combined

    print("MUTATION_TEST_OK: unreviewed accepted evidence was rejected")
    print("CANDIDATE_COUNT_TEST_OK: candidates could not satisfy accepted_count")
    print("PENDING_MODE_TEST_OK: diagnostic mode exits 2 and never prints VALIDATION_OK")


if __name__ == "__main__":
    main()
