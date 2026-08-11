#!/usr/bin/env python3
"""Fail-closed consistency checks for the Sixiangjia evidence pack."""

from __future__ import annotations

import argparse
import collections
import json
import os
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(os.environ.get("EVIDENCE_VALIDATION_ROOT", Path(__file__).resolve().parent))
REQUIRED = {
    "evidence_id", "domain", "subdomain", "atomic_claim", "actionable_rule",
    "source_title", "source_url", "source_type", "source_tier", "author_org",
    "published_at", "retrieved_at", "canonical_id", "platform_model_version",
    "region_language", "method_sample_metric", "limitations", "conflicts",
    "applicability_to_sixiangjia", "confidence", "verification_status",
    "reviewer", "last_checked_at", "supersedes", "superseded_by", "tags",
    "published_at_reason", "content_sha256_reason", "source_locator",
    "source_locator_type", "inference_boundary", "review_state",
    "source_claim", "project_gate",
}


def jsonl(path: Path) -> list[dict]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--allow-pending-double-review", action="store_true")
    args = parser.parse_args()

    rows = jsonl(ROOT / "evidence.jsonl")
    manifest = json.loads((ROOT / "knowledge-pack-manifest.json").read_text(encoding="utf-8"))
    url_checks = json.loads((ROOT / "source-url-validation.json").read_text(encoding="utf-8"))
    errors: list[str] = []

    if len(rows) != manifest["accepted_count"] + manifest["candidate_count"]:
        errors.append("registry count differs from manifest")
    for index, row in enumerate(rows, 1):
        missing = REQUIRED - row.keys()
        if missing:
            errors.append(f"line {index} missing {sorted(missing)}")
        if urlparse(row["source_url"]).scheme != "https":
            errors.append(f"line {index} source_url is not https")
        if row["verification_status"] == "accepted" and row["source_tier"] not in {"T0", "T1", "T2"}:
            errors.append(f"line {index} accepted tier is {row['source_tier']}")
        if row["source_tier"] in {"T3", "T4"} and row["verification_status"] != "candidate":
            errors.append(f"line {index} T3/T4 must remain candidate")
        if row["published_at"] is None and not row["published_at_reason"].strip():
            errors.append(f"line {index} null published_at lacks reason")
        if row.get("content_sha256") is None and not row["content_sha256_reason"].strip():
            errors.append(f"line {index} null content_sha256 lacks reason")
        if not row["source_locator"].strip() or not row["source_locator_type"].strip():
            errors.append(f"line {index} lacks a source locator")
        if not row["limitations"].strip() or not row["conflicts"].strip():
            errors.append(f"line {index} lacks limitations/conflicts")
        if not row["source_claim"].strip() or not row["project_gate"].strip():
            errors.append(f"line {index} lacks source_claim/project_gate separation")
        if row["review_state"].startswith("quarantined_") and row["verification_status"] == "accepted":
            errors.append(f"line {index} quarantined evidence remains accepted")

    for field in ("evidence_id", "canonical_id"):
        values = [row[field] for row in rows]
        if len(values) != len(set(values)):
            errors.append(f"duplicate {field}")
    claims = [row["atomic_claim"].strip().casefold() for row in rows]
    if len(claims) != len(set(claims)):
        errors.append("duplicate atomic_claim")

    domains = collections.Counter(row["domain"] for row in rows)
    tiers = collections.Counter(row["source_tier"] for row in rows)
    statuses = collections.Counter(row["verification_status"] for row in rows)
    expected_tiers = {k: v for k, v in manifest["source_tier_counts"].items() if v}
    if dict(tiers) != expected_tiers:
        errors.append(f"tier counts differ: registry={dict(tiers)} manifest={expected_tiers}")
    if dict(domains) != manifest["domain_counts"]:
        errors.append("domain counts differ from manifest")
    if statuses.get("accepted", 0) != manifest["accepted_count"]:
        errors.append("accepted count differs from manifest")
    if statuses.get("candidate", 0) != manifest["candidate_count"]:
        errors.append("candidate count differs from manifest")

    source_urls = {row["source_url"] for row in rows}
    source_index = json.loads((ROOT / "source-index.json").read_text(encoding="utf-8"))
    indexed_urls = {
        source[2]
        for domain in source_index["domains"]
        for source in domain["sources"]
    }
    if source_urls != indexed_urls:
        errors.append("source-index URL set differs from registry URL set")
    if manifest["unique_source_url_count"] != len(source_urls):
        errors.append("unique source URL count differs from manifest")
    checked_urls = {item["url"] for item in url_checks}
    if source_urls != checked_urls:
        errors.append("URL-validation set differs from registry URL set")
    for item in url_checks:
        manual_ok = item.get("manual_verification", {}).get("status") == "approved"
        if not item.get("ok") and not manual_ok:
            errors.append(f"URL failed without approved manual verification: {item['url']}")

    review_path = ROOT / "double-review.jsonl"
    reviews = jsonl(review_path) if review_path.exists() else []
    allowed_verdicts = {"PASS", "CONDITIONAL", "FAIL"}
    reviewed_ids = {row.get("evidence_id") for row in reviews if row.get("verdict") in allowed_verdicts}
    reviews_by_id: dict[str, list[dict]] = collections.defaultdict(list)
    for review in reviews:
        verdict = review.get("verdict")
        evidence_id = review.get("evidence_id")
        reviews_by_id[evidence_id].append(review)
        registry_row = next((row for row in rows if row["evidence_id"] == evidence_id), None)
        if verdict not in allowed_verdicts:
            errors.append(f"invalid double-review verdict for {evidence_id}: {verdict}")
        if registry_row and verdict == "FAIL" and registry_row["verification_status"] == "accepted":
            errors.append(f"failed evidence remains accepted: {evidence_id}")
        if registry_row and verdict == "CONDITIONAL" and registry_row["review_state"] == "primary_review_complete":
            errors.append(f"conditional evidence lacks pending re-review state: {evidence_id}")

    # Acceptance is an item-level gate.  A global review sample cannot clear an
    # unreviewed record, and a candidate is never promoted by counting alone.
    for row in rows:
        if row["verification_status"] != "accepted":
            continue
        independent_passes = []
        for review in reviews_by_id.get(row["evidence_id"], []):
            reviewer_identity = review.get("reviewer_id") or review.get("reviewer")
            if (
                review.get("verdict") == "PASS"
                and review.get("independent") is True
                and isinstance(reviewer_identity, str)
                and reviewer_identity.strip()
                and reviewer_identity.strip() != row.get("reviewer", "").strip()
            ):
                independent_passes.append(review)
        if not independent_passes:
            errors.append(
                "accepted evidence lacks a corresponding independent PASS review: "
                f"{row['evidence_id']}"
            )
    if not args.allow_pending_double_review and len(reviewed_ids) < 15:
        errors.append(f"independent double review incomplete: {len(reviewed_ids)}/15")
    if not args.allow_pending_double_review and any(row.get("verdict") != "PASS" for row in reviews):
        errors.append("independent double review contains non-PASS verdicts")
    if not reviewed_ids.issubset({row["evidence_id"] for row in rows}):
        errors.append("double review references an unknown evidence_id")

    summary = {
        "rows": len(rows),
        "statuses": dict(statuses),
        "tiers": dict(tiers),
        "domains": dict(domains),
        "unique_ids": len({row["evidence_id"] for row in rows}),
        "unique_canonical_ids": len({row["canonical_id"] for row in rows}),
        "unique_source_urls": len(source_urls),
        "url_ok": sum(bool(item.get("ok")) for item in url_checks),
        "url_blocked_403": sum(item.get("status") == 403 for item in url_checks),
        "url_manual_approved": sum(item.get("manual_verification", {}).get("status") == "approved" for item in url_checks),
        "double_reviewed": len(reviewed_ids),
    }
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    if errors:
        raise SystemExit("VALIDATION_FAILED: " + "; ".join(errors))
    if args.allow_pending_double_review:
        print("PENDING_DIAGNOSTIC_ONLY")
        raise SystemExit(2)
    print("VALIDATION_OK")


if __name__ == "__main__":
    main()
