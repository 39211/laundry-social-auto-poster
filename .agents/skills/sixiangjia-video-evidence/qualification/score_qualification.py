#!/usr/bin/env python3
"""Deterministically score a blinded specialist qualification response."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[3]
REGISTRY = PROJECT / "research" / "video-knowledge" / "evidence.jsonl"
LIVE_MANIFEST = PROJECT / "research" / "video-knowledge" / "knowledge-pack-manifest.json"
POLICY_REFS = {"POLICY:SKILL", "POLICY:SOURCE", "POLICY:RUBRIC", "PACK:MANIFEST"}
INDEPENDENT_PASS_STATES = {"independent_pass", "independent_review_pass", "accepted_independent_pass"}


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def normalize(value: str):
    return re.sub(r"\s+", "", value.casefold())


def citation_sets(double_review_path: Path):
    known = set(POLICY_REFS)
    eligible = set(POLICY_REFS)
    records = {}
    if REGISTRY.exists():
        for line in REGISTRY.read_text(encoding="utf-8").splitlines():
            if line.strip():
                record = json.loads(line)
                evidence_id = record["evidence_id"]
                known.add(evidence_id)
                records[evidence_id] = record
    review_error = None
    reviews = {}
    try:
        for line in double_review_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                review = json.loads(line)
                reviews.setdefault(review.get("evidence_id"), []).append(review)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        review_error = f"{type(exc).__name__}: {exc}"
    if review_error is None:
        for evidence_id, record in records.items():
            verification = str(record.get("verification_status", "")).casefold()
            review_state = str(record.get("review_state", "")).casefold()
            primary = str(record.get("reviewer", "")).strip()
            evidence_reviews = reviews.get(evidence_id, [])
            valid_reviews = [
                review for review in evidence_reviews
                if str(review.get("verdict", "")).casefold() == "pass"
                and review.get("independent") is True
                and str(review.get("reviewer", "")).strip()
                and primary
                and str(review.get("reviewer", "")).strip().casefold() != primary.casefold()
            ]
            all_pass = bool(evidence_reviews) and len(valid_reviews) == len(evidence_reviews)
            if verification == "accepted" and review_state in INDEPENDENT_PASS_STATES and all_pass:
                eligible.add(evidence_id)
    return known, eligible, review_error


def score(response_path: Path):
    bank = load_json(ROOT / "question-bank.v1.json")
    answer_key = load_json(ROOT / "answer-key.v1.json")
    response = load_json(response_path)
    live_manifest_error = None
    try:
        live_manifest = load_json(LIVE_MANIFEST)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        live_manifest = {}
        live_manifest_error = f"{type(exc).__name__}: {exc}"
    role = response.get("role")
    supplied_pack = response.get("knowledge_pack_version")
    expected_pack = bank["knowledge_pack_version"]
    items = bank["roles"].get(role, {}).get("questions")
    if not items:
        raise ValueError(f"unknown role: {role!r}")
    answers = response.get("answers", {})
    double_review_value = live_manifest.get("double_review")
    double_review_path = None
    if isinstance(double_review_value, str) and double_review_value.strip():
        manifest_dir = LIVE_MANIFEST.resolve().parent
        candidate_path = (manifest_dir / double_review_value).resolve()
        if candidate_path.parent == manifest_dir:
            double_review_path = candidate_path
    if double_review_path is None:
        double_review_path = LIVE_MANIFEST.resolve().parent / "__invalid_double_review_path__"
    known, eligible, double_review_error = citation_sets(double_review_path)
    invented = sorted({c for value in answers.values() for c in value.get("citations", []) if c not in known})
    ineligible = sorted({c for value in answers.values() for c in value.get("citations", []) if c in known and c not in eligible})
    details = []
    missing_citation = []
    failed_safety = []
    for item in items:
        qid = item["id"]
        rubric = answer_key["items"][qid]
        entry = answers.get(qid, {})
        text = normalize(str(entry.get("answer", "")))
        citations = set(entry.get("citations", []))
        if not citations:
            missing_citation.append(qid)
        groups = rubric["required_groups"]
        matched = [any(normalize(term) in text for term in group) for group in groups]
        forbidden = [term for term in rubric["forbidden_terms"] if normalize(term) in text]
        citation_ok = bool(citations.intersection(rubric["allowed_citations"]).intersection(eligible))
        passed = bool(groups) and all(matched) and not forbidden and citation_ok
        if rubric["safety_critical"] and not passed:
            failed_safety.append(qid)
        details.append({
            "id": qid,
            "section": item["section"],
            "passed": passed,
            "matched_groups": sum(matched),
            "required_groups": len(groups),
            "citation_ok": citation_ok,
            "forbidden_hits": forbidden,
        })
    passed_count = sum(1 for d in details if d["passed"])
    overall = passed_count / len(details)
    auto_fail = []
    if supplied_pack != expected_pack:
        auto_fail.append("knowledge_pack_version_mismatch")
    live_version = live_manifest.get("version")
    if live_manifest_error is not None:
        auto_fail.append("live_manifest_unavailable")
    if double_review_error is not None:
        auto_fail.append("double_review_ledger_unavailable")
    if live_version != expected_pack:
        auto_fail.append("live_pack_version_mismatch")
    live_status = str(live_manifest.get("status", ""))
    live_status_normalized = live_status.casefold()
    accepted_count = int(live_manifest.get("accepted_count", 0))
    eligible_evidence_count = len(eligible - POLICY_REFS)
    if accepted_count <= 0:
        auto_fail.append("live_pack_has_zero_accepted_evidence")
    if accepted_count != eligible_evidence_count:
        auto_fail.append("live_accepted_evidence_mismatch")
    if "quarantine" in live_status_normalized or "pending" in live_status_normalized:
        auto_fail.append("live_pack_status_not_qualification_ready")
    if invented:
        auto_fail.append("invented_or_unknown_citations")
    if ineligible:
        auto_fail.append("candidate_or_unreviewed_citations")
    if missing_citation:
        auto_fail.append("traceability_below_100_percent")
    if failed_safety:
        auto_fail.append("safety_critical_failure")
    if overall < 0.90:
        auto_fail.append("overall_below_90_percent")
    return {
        "schema_version": "1.0",
        "qualification_version": bank["qualification_version"],
        "role": role,
        "knowledge_pack_version": supplied_pack,
        "expected_knowledge_pack_version": expected_pack,
        "live_pack": {
            "manifest_available": live_manifest_error is None,
            "manifest_error": live_manifest_error,
            "double_review_path": str(double_review_path),
            "double_review_error": double_review_error,
            "version": live_version,
            "status": live_status,
            "accepted_count": accepted_count,
            "eligible_evidence_count": eligible_evidence_count,
            "candidate_count": int(live_manifest.get("candidate_count", 0)),
            "qualification_gate_open": live_manifest_error is None and double_review_error is None and live_version == expected_pack and accepted_count > 0 and accepted_count == eligible_evidence_count and "quarantine" not in live_status_normalized and "pending" not in live_status_normalized,
        },
        "qualified": not auto_fail,
        "score": {"passed": passed_count, "total": len(details), "overall_percent": round(overall * 100, 2)},
        "automatic_failures": auto_fail,
        "invented_or_unknown_citations": invented,
        "candidate_or_unreviewed_citations": ineligible,
        "missing_citation_items": missing_citation,
        "failed_safety_items": failed_safety,
        "details": details,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("response", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        result = score(args.response)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"qualification scorer error: {exc}", file=sys.stderr)
        return 2
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0 if result["qualified"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
