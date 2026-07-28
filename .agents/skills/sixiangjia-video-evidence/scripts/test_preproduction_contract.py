from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("validate_preproduction_contract.py")
SPEC = importlib.util.spec_from_file_location("validate_preproduction_contract", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PreproductionContractTests(unittest.TestCase):
    def test_accountable_column_accepts_a_and_a_slash_r(self) -> None:
        cells = ["G3", "SCRIPT_LOCK", "A/R", "C", "I"]
        self.assertEqual(MODULE.accountable_columns(cells), [2])

    def test_accountable_column_rejects_multiple_owners(self) -> None:
        cells = ["G3", "SCRIPT_LOCK", "A/R", "A", "I"]
        self.assertEqual(MODULE.accountable_columns(cells), [2, 3])

    def test_duplicate_raci_gate_is_rejected(self) -> None:
        markdown = "| G8b | token | A/R | I | I | I | I | I | I | I | I | I |\n" * 2
        with self.assertRaisesRegex(ValueError, "duplicate RACI gate"):
            MODULE.parse_raci_rows(markdown)

    def test_short_raci_row_has_wrong_width(self) -> None:
        rows = MODULE.parse_raci_rows("| G3 | token | A/R | I |\n")
        errors = MODULE.validate_raci_rows(rows)
        self.assertIn("G3 must contain 12 columns; got 4", errors)

    def test_issued_generation_token_is_detected_from_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            authorization_dir = root / "authorizations"
            authorization_dir.mkdir()
            token_path = authorization_dir / "video-generation.json"
            token_path.write_text(
                json.dumps({"token_type": "video_generation", "status": "issued"}),
                encoding="utf-8",
            )
            tokens = {
                "script_lock": None,
                "first_frame_render": None,
                "shot_plan_lock": None,
                "video_generation": "authorizations/video-generation.json",
            }
            errors, issued = MODULE.inspect_authorization_tokens(root, tokens, authorization_dir)
            self.assertEqual(errors, [])
            self.assertIn("video_generation", issued)

    def test_unregistered_token_file_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            authorization_dir = root / "authorizations"
            authorization_dir.mkdir()
            (authorization_dir / "rogue.json").write_text("{}", encoding="utf-8")
            tokens = {key: None for key in ("script_lock", "first_frame_render", "shot_plan_lock", "video_generation")}
            errors, _ = MODULE.inspect_authorization_tokens(root, tokens, authorization_dir)
            self.assertIn("unregistered authorization artifact: rogue.json", errors)

    def test_nested_unregistered_token_file_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            authorization_dir = root / "authorizations"
            nested = authorization_dir / "nested"
            nested.mkdir(parents=True)
            (nested / "rogue.json").write_text("{}", encoding="utf-8")
            tokens = {key: None for key in ("script_lock", "first_frame_render", "shot_plan_lock", "video_generation")}
            errors, _ = MODULE.inspect_authorization_tokens(root, tokens, authorization_dir)
            self.assertIn("unregistered authorization artifact: rogue.json", errors)

    def test_video_generation_requires_all_prior_tokens(self) -> None:
        errors, authorized = MODULE.evaluate_generation_authorization(
            Path.cwd(), {"video_generation": "unused.json"}
        )
        self.assertFalse(authorized)
        self.assertIn("video generation token is missing prerequisites", errors[0])

    def test_first_frame_token_requires_pass(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            first_frame = root / "first-frame.json"
            first_frame.write_text(json.dumps({"qa_status": "fail"}), encoding="utf-8")
            issued = {
                "script_lock": "unused-script.json",
                "first_frame_render": "first-frame.json",
                "shot_plan_lock": "unused-plan.json",
                "video_generation": "unused-video.json",
            }
            errors, authorized = MODULE.evaluate_generation_authorization(root, issued)
            self.assertFalse(authorized)
            self.assertEqual(errors, ["first-frame authorization token lacks qa_status=pass"])

    def test_live_repository_contract_passes(self) -> None:
        repo_root = Path(__file__).resolve().parents[4]
        result = MODULE.validate(repo_root)
        self.assertEqual(result["status"], "pass", result["errors"])
        self.assertFalse(result["generation_authorized"])
        self.assertEqual(result["issued_tokens"], [])
        self.assertEqual(result["raci_gate_count"], 18)
        self.assertEqual(result["raci_gate_count"], 18)


if __name__ == "__main__":
    unittest.main()
