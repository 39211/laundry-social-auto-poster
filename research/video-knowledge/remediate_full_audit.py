#!/usr/bin/env python3
"""Apply the fail-closed full-audit disposition to the 150-unit registry.

This script does not promote evidence.  It separates sourced statements from
project decisions and keeps every unit candidate until an independent reviewer
has confirmed the repaired locator, version, region, and inference boundary.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent

QUARANTINE = {
    "EV-PROMO-0007", "EV-PROMO-0008", "EV-PROMO-0009", "EV-PROMO-0012",
    "EV-DRAMA-0004", "EV-DRAMA-0005", "EV-DRAMA-0006", "EV-DRAMA-0008",
    "EV-DRAMA-0009", "EV-DRAMA-0011", "EV-DIRECT-0007", "EV-DIRECT-0008",
    "EV-DIRECT-0009", "EV-DIRECT-0010", "EV-DIRECT-0011", "EV-DIRECT-0012",
    "EV-CAM-0006", "EV-CAM-0009", "EV-CAM-0015", "EV-POST-0004",
    "EV-POST-0005", "EV-POST-0006", "EV-POST-0011", "EV-POST-0015",
    "EV-GROK-0014", "EV-GAR-0007", "EV-GAR-0008", "EV-GAR-0009",
    "EV-GAR-0011", "EV-LEATHER-0003", "EV-LEATHER-0005",
    "EV-LEATHER-0009", "EV-META-0003", "EV-META-0008",
    "EV-META-0009", "EV-META-0012",
}


def digest(record: dict) -> str:
    payload = {key: value for key, value in record.items() if key != "record_sha256"}
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def main() -> None:
    registry = ROOT / "evidence.jsonl"
    rows = [json.loads(line) for line in registry.read_text(encoding="utf-8").splitlines() if line.strip()]

    for row in rows:
        evidence_id = row["evidence_id"]
        row["source_claim"] = row["atomic_claim"]
        row["project_gate"] = row["actionable_rule"]
        row["verification_status"] = "candidate"
        row["reviewer"] = "Sol full-audit fail-closed remediation"
        row["last_checked_at"] = "2026-07-20"
        if evidence_id in QUARANTINE:
            row["review_state"] = "quarantined_source_replacement_required"
            row["confidence"] = min(int(row["confidence"]), 49)
            row["inference_boundary"] = (
                "QUARANTINED: the cited source or direction did not substantiate the prior wording. "
                "The source_claim is not production authority and the project_gate must not be used "
                "until a replacement source and independent re-review pass."
            )
        else:
            row["review_state"] = "pending_locator_version_region_re_review"
            row["confidence"] = min(int(row["confidence"]), 69)
            row["inference_boundary"] = (
                "The source_claim reports only what the cited source supports. The project_gate is a "
                "separate proposed Sixiangjia production control, not a sourced fact, store SOP, legal "
                "conclusion, or proof of advertising effectiveness; independent re-review is pending."
            )

    by_id = {row["evidence_id"]: row for row in rows}

    # Correct the Netflix Traditional Chinese style-guide URL, but retain the
    # three units in quarantine until their exact rule locators are re-reviewed.
    zh_url = "https://partnerhelp.netflixstudios.com/hc/en-us/articles/215994807-Traditional-Chinese-Timed-Text-Style-Guide"
    for suffix in ("0004", "0005", "0006"):
        by_id[f"EV-POST-{suffix}"]["source_url"] = zh_url

    # Pin all BS.1770 records to the reviewed recommendation version.
    itu_url = "https://www.itu.int/rec/R-REC-BS.1770-5-202311-I"
    for suffix, locator in (
        ("0007", "Recommendation ITU-R BS.1770-5 (11/2023) > Annex 1 > objective multichannel loudness measurement algorithm."),
        ("0008", "Recommendation ITU-R BS.1770-5 (11/2023) > Annex 2 > true-peak audio level measurement."),
        ("0009", "Recommendation ITU-R BS.1770-5 (11/2023) > Annex 1 > channel weighting and summation."),
    ):
        row = by_id[f"EV-POST-{suffix}"]
        row["source_title"] = "Recommendation ITU-R BS.1770-5"
        row["source_url"] = itu_url
        row["published_at"] = "2023-11-22"
        row["published_at_reason"] = "ITU publication record marks BS.1770-5 approved 2023-11-22 and in force."
        row["platform_model_version"] = "ITU-R BS.1770-5 (11/2023)"
        row["source_locator"] = locator

    # Remove the reversed inference that LRA itself proves speech masking.  R128
    # defines programme loudness/leveling; short-form intelligibility is a local
    # listening-test gate, not a conclusion from this recommendation.
    post11 = by_id["EV-POST-0011"]
    post11["atomic_claim"] = "EBU R 128 defines programme loudness normalisation and permitted maximum true-peak level for programme interchange."
    post11["source_claim"] = post11["atomic_claim"]
    post11["actionable_rule"] = "Measure final programme loudness and true peak; assess 43.52-second speech intelligibility separately by encoded-phone listening tests."
    post11["project_gate"] = post11["actionable_rule"]
    post11["source_locator"] = "EBU R 128 v5 (2023), §§1-2 and requirements 1-4; LRA is not used here to infer short-form speech masking."
    post11["method_sample_metric"] = "Programme loudness and maximum permitted true-peak level; no short-form LRA inference."

    # Stream selection/mapping is documented by ffmpeg(1), not the filters page.
    post15 = by_id["EV-POST-0015"]
    post15["atomic_claim"] = "FFmpeg automatic stream selection and manual -map selection determine which streams enter each output file."
    post15["source_claim"] = post15["atomic_claim"]
    post15["actionable_rule"] = "Declare and verify output stream mapping separately for clean-master and subtitle-bearing deliverables."
    post15["project_gate"] = post15["actionable_rule"]
    post15["source_title"] = "FFmpeg documentation"
    post15["source_url"] = "https://ffmpeg.org/ffmpeg.html#Stream-selection"
    post15["source_locator"] = "ffmpeg Documentation > 4 Stream selection > 4.1 Description and 4.1.2 Manual stream selection."
    post15["method_sample_metric"] = "Automatic stream selection and -map manual stream selection."

    for row in rows:
        row["record_sha256"] = digest(row)

    registry.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) for row in rows) + "\n",
        encoding="utf-8",
    )

    # Keep the human-readable source index synchronized for URLs changed above.
    index_path = ROOT / "source-index.json"
    index_text = index_path.read_text(encoding="utf-8")
    index_text = index_text.replace(
        "https://partnerhelp.netflixstudios.com/hc/en-us/articles/215986007-Traditional-Chinese-Timed-Text-Style-Guide",
        zh_url,
    )
    index_text = index_text.replace(
        "https://ffmpeg.org/ffmpeg-filters.html",
        "https://ffmpeg.org/ffmpeg.html#Stream-selection",
        1,
    )
    index_path.write_text(index_text, encoding="utf-8")

    manifest_path = ROOT / "knowledge-pack-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["version"] = "0.3.0-evidence-150-full-audit-quarantine"
    manifest["accepted_count"] = 0
    manifest["candidate_count"] = len(rows)
    manifest["unique_source_url_count"] = len({row["source_url"] for row in rows})
    manifest["status"] = "cannot_ship_all_150_pending_independent_re_review"
    manifest["limitations"] = [
        "This is the first 150-unit milestone, not the 2500-unit target.",
        "All 150 units are candidate-only after complete two-reviewer audit; zero units are accepted.",
        "Thirty-six units are quarantined because their source, locator, or claim direction failed review.",
        "The remaining 114 units require exact locator, version, region, and source-claim/project-gate re-review.",
        "No T0 Sixiangjia private evidence or confirmed store SOP is included.",
        "No evidence may enter an agent qualification test or production decision until independent re-review passes.",
    ]
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
