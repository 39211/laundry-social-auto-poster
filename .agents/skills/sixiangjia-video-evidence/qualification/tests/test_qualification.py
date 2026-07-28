import hashlib
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
import sys


QUAL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(QUAL))
import score_qualification as scorer  # noqa: E402
from score_qualification import score  # noqa: E402


class QualificationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bank = json.loads((QUAL / "question-bank.v1.json").read_text(encoding="utf-8"))
        cls.key = json.loads((QUAL / "answer-key.v1.json").read_text(encoding="utf-8"))

    def response(self, role):
        answers = {}
        for item in self.bank["roles"][role]["questions"]:
            rubric = self.key["items"][item["id"]]
            answers[item["id"]] = {
                "answer": "；".join(group[0] for group in rubric["required_groups"]),
                "citations": [rubric["allowed_citations"][0]],
            }
        return {"agent_id": "test", "role": role, "knowledge_pack_version": self.bank["knowledge_pack_version"], "answers": answers}

    def run_score(self, payload):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "response.json"
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            return score(path)

    def test_every_role_has_required_sections(self):
        self.assertEqual(len(self.bank["roles"]), 10)
        for role in self.bank["roles"].values():
            counts = {name: 0 for name in ("blind", "scenario", "adversarial")}
            for item in role["questions"]:
                counts[item["section"]] += 1
            self.assertEqual(counts, {"blind": 20, "scenario": 5, "adversarial": 5})

    def test_screenplay_starts_with_dramatic_elements(self):
        prompts = [q["prompt"] for q in self.bank["roles"]["screenplay_dramaturgy"]["questions"][:9]]
        for term in ("人物", "處境", "慾望", "阻礙", "衝突", "情緒轉折", "決定性行動", "結局", "品牌行動"):
            self.assertTrue(any(term in prompt for prompt in prompts), term)

    def test_perfect_response_is_blocked_by_quarantined_live_pack(self):
        result = self.run_score(self.response("screenplay_dramaturgy"))
        self.assertFalse(result["qualified"])
        self.assertEqual(result["live_pack"]["accepted_count"], 0)
        self.assertEqual(result["live_pack"]["eligible_evidence_count"], 0)
        self.assertFalse(result["live_pack"]["qualification_gate_open"])
        self.assertIn("live_pack_has_zero_accepted_evidence", result["automatic_failures"])
        self.assertIn("live_pack_status_not_qualification_ready", result["automatic_failures"])
        self.assertIn("candidate_or_unreviewed_citations", result["automatic_failures"])
        self.assertIn("double_review_ledger_unavailable", result["automatic_failures"])

    def test_candidate_and_non_independent_evidence_are_not_eligible(self):
        records = [
            {"evidence_id": "EV-CANDIDATE", "verification_status": "candidate", "review_state": "pending", "reviewer": "primary"},
            {"evidence_id": "EV-NONINDEPENDENT", "verification_status": "accepted", "review_state": "author_pass", "reviewer": "primary"},
            {"evidence_id": "EV-ELIGIBLE", "verification_status": "accepted", "review_state": "independent_pass", "reviewer": "primary"},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            registry = Path(tmp) / "evidence.jsonl"
            double_review = Path(tmp) / "double-review.jsonl"
            registry.write_text("\n".join(json.dumps(record) for record in records) + "\n", encoding="utf-8")
            double_review.write_text(json.dumps({"evidence_id": "EV-ELIGIBLE", "verdict": "PASS", "independent": True, "reviewer": "secondary"}) + "\n", encoding="utf-8")
            with patch.object(scorer, "REGISTRY", registry):
                known, eligible, error = scorer.citation_sets(double_review)
        self.assertIsNone(error)
        self.assertTrue({"EV-CANDIDATE", "EV-NONINDEPENDENT", "EV-ELIGIBLE"}.issubset(known))
        self.assertNotIn("EV-CANDIDATE", eligible)
        self.assertNotIn("EV-NONINDEPENDENT", eligible)
        self.assertIn("EV-ELIGIBLE", eligible)

    def test_accepted_label_without_distinct_double_reviewer_is_not_eligible(self):
        record = {"evidence_id": "EV-LABEL-ONLY", "verification_status": "accepted", "review_state": "independent_pass", "reviewer": "same-reviewer"}
        with tempfile.TemporaryDirectory() as tmp:
            registry = Path(tmp) / "evidence.jsonl"
            double_review = Path(tmp) / "double-review.jsonl"
            registry.write_text(json.dumps(record) + "\n", encoding="utf-8")
            double_review.write_text(json.dumps({"evidence_id": "EV-LABEL-ONLY", "verdict": "PASS", "independent": True, "reviewer": "same-reviewer"}) + "\n", encoding="utf-8")
            with patch.object(scorer, "REGISTRY", registry):
                _, eligible, error = scorer.citation_sets(double_review)
        self.assertIsNone(error)
        self.assertNotIn("EV-LABEL-ONLY", eligible)

    def test_invalid_double_review_variants_are_not_eligible(self):
        invalid_reviews = [
            {"verdict": "FAIL", "independent": True, "reviewer": "secondary"},
            {"verdict": "PASS", "independent": False, "reviewer": "secondary"},
            {"verdict": "PASS", "independent": True, "reviewer": ""},
            {"verdict": "PASS", "independent": True, "reviewer": "primary"},
        ]
        record = {"evidence_id": "EV-INVALID-REVIEW", "verification_status": "accepted", "review_state": "independent_pass", "reviewer": "primary"}
        for review in invalid_reviews:
            with self.subTest(review=review), tempfile.TemporaryDirectory() as tmp:
                registry = Path(tmp) / "evidence.jsonl"
                double_review = Path(tmp) / "double-review.jsonl"
                registry.write_text(json.dumps(record) + "\n", encoding="utf-8")
                review_payload = {"evidence_id": "EV-INVALID-REVIEW", **review}
                double_review.write_text(json.dumps(review_payload) + "\n", encoding="utf-8")
                with patch.object(scorer, "REGISTRY", registry):
                    _, eligible, error = scorer.citation_sets(double_review)
                self.assertIsNone(error)
                self.assertNotIn("EV-INVALID-REVIEW", eligible)

    def test_missing_or_malformed_double_review_ledger_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "missing.jsonl"
            _, eligible, missing_error = scorer.citation_sets(missing)
            self.assertIsNotNone(missing_error)
            self.assertEqual(eligible, scorer.POLICY_REFS)
            malformed = Path(tmp) / "malformed.jsonl"
            malformed.write_text("{", encoding="utf-8")
            _, eligible, malformed_error = scorer.citation_sets(malformed)
            self.assertIsNotNone(malformed_error)
            self.assertEqual(eligible, scorer.POLICY_REFS)

    def test_manifest_selected_missing_double_review_auto_fails(self):
        payload = self.response("research_evidence")
        with tempfile.TemporaryDirectory() as tmp:
            response_path = Path(tmp) / "response.json"
            response_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            manifest = Path(tmp) / "knowledge-pack-manifest.json"
            manifest.write_text(json.dumps({
                "version": self.bank["knowledge_pack_version"],
                "accepted_count": 0,
                "candidate_count": 150,
                "status": "pending",
                "double_review": "missing-ledger.jsonl"
            }), encoding="utf-8")
            with patch.object(scorer, "LIVE_MANIFEST", manifest):
                result = scorer.score(response_path)
        self.assertFalse(result["qualified"])
        self.assertIn("double_review_ledger_unavailable", result["automatic_failures"])
        self.assertFalse(result["live_pack"]["qualification_gate_open"])

    def test_invented_citation_auto_fails(self):
        payload = self.response("research_evidence")
        first = next(iter(payload["answers"].values()))
        first["citations"].append("EV-INVENTED-9999")
        result = self.run_score(payload)
        self.assertFalse(result["qualified"])
        self.assertIn("invented_or_unknown_citations", result["automatic_failures"])

    def test_missing_citation_auto_fails(self):
        payload = self.response("camera_lighting")
        first = next(iter(payload["answers"].values()))
        first["citations"] = []
        result = self.run_score(payload)
        self.assertFalse(result["qualified"])
        self.assertIn("traceability_below_100_percent", result["automatic_failures"])

    def test_failed_safety_item_auto_fails(self):
        payload = self.response("grok_video_technology")
        safety = next(q for q in self.bank["roles"]["grok_video_technology"]["questions"] if q["safety_critical"])
        payload["answers"][safety["id"]]["answer"] = "錯誤"
        result = self.run_score(payload)
        self.assertFalse(result["qualified"])
        self.assertIn(safety["id"], result["failed_safety_items"])

    def test_below_ninety_percent_fails(self):
        payload = self.response("edit_tts_subtitles_audio")
        for q in self.bank["roles"]["edit_tts_subtitles_audio"]["questions"][:4]:
            if not q["safety_critical"]:
                payload["answers"][q["id"]]["answer"] = "錯誤"
        # Force four non-safety misses regardless of ordering.
        changed = 0
        for q in self.bank["roles"]["edit_tts_subtitles_audio"]["questions"]:
            if not q["safety_critical"] and changed < 4:
                payload["answers"][q["id"]]["answer"] = "錯誤"
                changed += 1
        result = self.run_score(payload)
        self.assertFalse(result["qualified"])
        self.assertIn("overall_below_90_percent", result["automatic_failures"])

    def test_manifest_hashes_match(self):
        manifest = json.loads((QUAL / "manifest.json").read_text(encoding="utf-8"))
        for name, expected in manifest["artifacts"].items():
            actual = hashlib.sha256((QUAL / name).read_bytes()).hexdigest()
            self.assertEqual(actual, expected)

    def test_all_evidence_citations_exist_in_registry(self):
        project = QUAL.parents[3]
        registry_path = project / "research" / "video-knowledge" / "evidence.jsonl"
        registry_ids = {
            json.loads(line)["evidence_id"]
            for line in registry_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        }
        cited_ids = {
            citation
            for rubric in self.key["items"].values()
            for citation in rubric["allowed_citations"]
            if citation.startswith("EV-")
        }
        self.assertTrue(cited_ids)
        self.assertEqual(cited_ids - registry_ids, set())

    def test_pack_version_matches_live_manifest(self):
        project = QUAL.parents[3]
        live = json.loads((project / "research" / "video-knowledge" / "knowledge-pack-manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(self.bank["knowledge_pack_version"], live["version"])

    def test_live_manifest_version_drift_auto_fails(self):
        payload = self.response("research_evidence")
        with tempfile.TemporaryDirectory() as tmp:
            response_path = Path(tmp) / "response.json"
            response_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            drift_manifest = Path(tmp) / "knowledge-pack-manifest.json"
            drift_manifest.write_text(json.dumps({
                "version": "9.9.9-drift",
                "accepted_count": 150,
                "candidate_count": 0,
                "status": "ready"
            }), encoding="utf-8")
            with patch.object(scorer, "LIVE_MANIFEST", drift_manifest):
                result = scorer.score(response_path)
        self.assertFalse(result["qualified"])
        self.assertIn("live_pack_version_mismatch", result["automatic_failures"])
        self.assertIn("live_accepted_evidence_mismatch", result["automatic_failures"])
        self.assertFalse(result["live_pack"]["qualification_gate_open"])

    def test_missing_live_manifest_auto_fails(self):
        payload = self.response("research_evidence")
        with tempfile.TemporaryDirectory() as tmp:
            response_path = Path(tmp) / "response.json"
            response_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            missing_manifest = Path(tmp) / "missing" / "knowledge-pack-manifest.json"
            with patch.object(scorer, "LIVE_MANIFEST", missing_manifest):
                result = scorer.score(response_path)
        self.assertFalse(result["qualified"])
        self.assertIn("live_manifest_unavailable", result["automatic_failures"])
        self.assertIn("live_pack_version_mismatch", result["automatic_failures"])
        self.assertFalse(result["live_pack"]["manifest_available"])
        self.assertFalse(result["live_pack"]["qualification_gate_open"])


if __name__ == "__main__":
    unittest.main()
