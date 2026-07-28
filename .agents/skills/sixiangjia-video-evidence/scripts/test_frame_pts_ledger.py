from __future__ import annotations

import importlib.util
import io
import json
import tempfile
import unittest
from fractions import Fraction
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).with_name("frame_pts_ledger.py")
SPEC = importlib.util.spec_from_file_location("frame_pts_ledger", SCRIPT)
assert SPEC and SPEC.loader
ledger = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ledger)


class FramePtsLedgerTests(unittest.TestCase):
    def test_annotation_hash_and_range_are_enforced(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = root / "fixture.json"
            fixture.write_text(
                json.dumps(
                    {
                        "clip_sha256": "A" * 64,
                        "expected_decision": "rejected",
                        "issues": [
                            {"id": "contact", "start_frame": 4, "end_frame": 7}
                        ],
                    }
                ),
                encoding="utf-8",
            )
            loaded = ledger.load_annotations(fixture, "A" * 64, 10)
            self.assertEqual(loaded["expected_decision"], "rejected")
            with self.assertRaises(ledger.LedgerError):
                ledger.load_annotations(fixture, "B" * 64, 10)
            fixture.write_text(
                json.dumps(
                    {
                        "clip_sha256": "A" * 64,
                        "issues": [
                            {"id": "contact", "start_frame": 4, "end_frame": 10}
                        ],
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaises(ledger.LedgerError):
                ledger.load_annotations(fixture, "A" * 64, 10)

    def test_annotation_requires_hash_and_known_decision(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            fixture = Path(temporary) / "fixture.json"
            fixture.write_text(
                json.dumps(
                    {
                        "expected_decision": "rejected",
                        "issues": [],
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ledger.LedgerError, "clip_sha256 is required"):
                ledger.load_annotations(fixture, "A" * 64, 10)

            fixture.write_text(
                json.dumps(
                    {
                        "clip_sha256": "A" * 64,
                        "expected_decision": "looks_good",
                        "issues": [],
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ledger.LedgerError, "expected_decision"):
                ledger.load_annotations(fixture, "A" * 64, 10)

    def test_exact_24fps_is_required(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "clip.mp4"
            source.write_bytes(b"fixture")
            stream = {
                "index": 0,
                "codec_name": "h264",
                "width": 720,
                "height": 1280,
                "avg_frame_rate": "30/1",
                "r_frame_rate": "30/1",
                "time_base": "1/90000",
            }
            with mock.patch.object(
                ledger, "probe_source", return_value=({"stream": stream}, [{}])
            ), mock.patch.object(ledger.shutil, "which", return_value="tool"):
                with self.assertRaisesRegex(ledger.LedgerError, "Expected exact 24"):
                    ledger.build_ledger(
                        source, root / "out", "clip", Fraction(24, 1), None
                    )

    def test_irregular_pts_at_nominal_24fps_is_technical_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "clip.mp4"
            output = root / "out"
            source.write_bytes(b"fixture")
            stream = {
                "index": 0,
                "codec_name": "h264",
                "width": 720,
                "height": 1280,
                "avg_frame_rate": "24/1",
                "r_frame_rate": "24/1",
                "time_base": "1/24",
            }
            frames = [
                {"media_type": "video", "pts": 0, "pts_time": "0.000000"},
                {"media_type": "video", "pts": 1, "pts_time": "0.041667"},
                {"media_type": "video", "pts": 3, "pts_time": "0.125000"},
            ]

            def fake_extract(_command: list[str]) -> None:
                frames_dir = output / "frames"
                frames_dir.mkdir(parents=True, exist_ok=True)
                for index in range(3):
                    (frames_dir / f"frame-{index:06d}.png").write_bytes(
                        f"frame-{index}".encode()
                    )

            with mock.patch.object(
                ledger,
                "probe_source",
                return_value=({"stream": stream}, frames),
            ), mock.patch.object(
                ledger.shutil, "which", return_value="tool"
            ), mock.patch.object(ledger, "_run", side_effect=fake_extract):
                summary = ledger.build_ledger(
                    source, output, "clip", Fraction(24, 1), None
                )

            self.assertEqual(summary["pts_anomaly_count"], 1)
            self.assertEqual(summary["technical_status"], "fail")

    def test_cli_is_nonzero_for_technical_failure(self) -> None:
        with mock.patch.object(
            ledger, "build_ledger", return_value={"technical_status": "fail"}
        ), mock.patch("sys.stdout", new_callable=io.StringIO):
            exit_code = ledger.main(["clip.mp4", "--output-dir", "out"])
        self.assertNotEqual(exit_code, 0)


class RealRegressionFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.workspace = SCRIPT.parents[4]
        cls.eval_root = (
            cls.workspace
            / "video-production/runs/2026-07-19-multi-object-brand-film-v1/evals"
        )

    def test_both_brush_contact_failures_remain_rejected(self) -> None:
        index = json.loads(
            (self.eval_root / "brush-contact-regression-index.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(index["case_count"], 2)
        for case in index["cases"]:
            annotation = json.loads(
                (self.eval_root / case["annotation"]).read_text(encoding="utf-8")
            )
            summary = json.loads(
                (self.eval_root / case["summary"]).read_text(encoding="utf-8")
            )
            rows = [
                json.loads(line)
                for line in (self.eval_root / case["ledger"]).read_text(
                    encoding="utf-8"
                ).splitlines()
            ]
            self.assertEqual(annotation["expected_decision"], "rejected")
            self.assertEqual(summary["creative_status"], "rejected")
            self.assertEqual(summary["technical_status"], "pass")
            self.assertEqual(summary["input_sha256"], annotation["clip_sha256"])
            self.assertEqual(summary["frame_count"], 145)
            self.assertEqual(len(rows), 145)
            self.assertEqual(summary["pts_anomaly_count"], 0)
            self.assertTrue(summary["input_repo_relative_path"].startswith("video-production/"))
            marked = {row["frame_index"] for row in rows if row["issue_ids"]}
            expected = set()
            for issue in annotation["issues"]:
                self.assertEqual(issue["type"], "prohibited_tool_object_contact")
                expected.update(range(issue["start_frame"], issue["end_frame"] + 1))
            self.assertEqual(marked, expected)


if __name__ == "__main__":
    unittest.main()
