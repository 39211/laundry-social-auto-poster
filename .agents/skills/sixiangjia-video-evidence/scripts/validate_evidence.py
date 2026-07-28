#!/usr/bin/env python3
import argparse
import json
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

REQUIRED = {
    "evidence_id", "domain", "subdomain", "atomic_claim", "actionable_rule",
    "source_title", "source_url", "source_type", "source_tier", "author_org",
    "published_at", "retrieved_at", "canonical_id", "limitations",
    "applicability_to_sixiangjia", "confidence", "verification_status",
    "reviewer", "last_checked_at"
}
TIERS = {"T0", "T1", "T2", "T3", "T4", "T5"}
STATUSES = {"candidate", "accepted", "quarantined", "superseded", "rejected"}

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("registry", type=Path)
    args = parser.parse_args()
    errors, ids, canonicals, domains, tiers, statuses = [], set(), set(), Counter(), Counter(), Counter()
    for number, raw in enumerate(args.registry.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip():
            continue
        try:
            item = json.loads(raw)
        except json.JSONDecodeError as exc:
            errors.append(f"line {number}: invalid JSON: {exc}")
            continue
        missing = sorted(REQUIRED - item.keys())
        if missing:
            errors.append(f"line {number}: missing {', '.join(missing)}")
        evidence_id = item.get("evidence_id")
        if evidence_id in ids:
            errors.append(f"line {number}: duplicate evidence_id {evidence_id}")
        ids.add(evidence_id)
        canonical = item.get("canonical_id")
        if canonical and canonical in canonicals:
            errors.append(f"line {number}: duplicate canonical_id {canonical}")
        if canonical:
            canonicals.add(canonical)
        tier, status = item.get("source_tier"), item.get("verification_status")
        if tier not in TIERS:
            errors.append(f"line {number}: invalid source_tier {tier}")
        if status not in STATUSES:
            errors.append(f"line {number}: invalid verification_status {status}")
        confidence = item.get("confidence")
        if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 100:
            errors.append(f"line {number}: confidence must be 0..100")
        url = item.get("source_url", "")
        if urlparse(url).scheme not in {"http", "https"}:
            errors.append(f"line {number}: invalid source_url")
        if status == "accepted" and tier in {"T4", "T5"}:
            errors.append(f"line {number}: {tier} cannot be accepted without primary corroboration record")
        domains[item.get("domain", "missing")] += 1
        tiers[tier] += 1
        statuses[status] += 1
    summary = {"records": len(ids), "domains": domains, "tiers": tiers, "statuses": statuses, "errors": errors}
    print(json.dumps(summary, ensure_ascii=False, indent=2, default=dict))
    return 1 if errors else 0

if __name__ == "__main__":
    raise SystemExit(main())
