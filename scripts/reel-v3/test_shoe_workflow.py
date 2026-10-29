"""Regression matrix for the evidence-bound shoe workflow; all provider calls are fakes."""
import copy
import hashlib
import json
import struct
import tempfile
import threading
import time
import unittest
import zlib
from pathlib import Path
from unittest.mock import patch

import shoe_workflow as wf


def png(width, height, color=(128, 128, 128)):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))
    rows = (b"\0" + bytes(color) * width) * height
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


class SpyTransport:
    def __init__(self):
        self.posts = 0
        self.gets = 0
        self.done = False
        self.ambiguous = False
        self.entered = threading.Event()
        self.release = threading.Event()
        self.block_submit = False

    def submit(self, manifest, auth, key):
        self.posts += 1
        self.entered.set()
        if self.block_submit:
            self.release.wait(timeout=5)
        if self.ambiguous:
            raise TimeoutError("uncertain test submission")
        return {"raw": b'{"request_id":"fixture-request"}', "request_id": "fixture-request"}

    def poll(self, request_id, auth):
        self.gets += 1
        return {"status": "done" if self.done else "pending"}

    def download(self, result):
        return b"test-only-fake-video-do-not-view-as-real"

    def convert(self, path):
        return path.read_bytes()


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="sxj-shoe-contract-test-")
        self.base = Path(self.tmp.name)
        self.case_path = self.base / "case.json"
        self.case = copy.deepcopy(wf.read(wf.DATA / "nike-af1-case.json"))
        self.case.pop("experiment", None)
        self.case["comparison_assets"] = {}
        self.case["created_by"] = "Codex"

        self.anchor = copy.deepcopy(wf.read(Path(self.case["anchor"]["path"])))
        self.anchor_path = self.base / "anchor.json"
        self.anchor.update(brand="FixtureBrand", model="FixtureModel", sku="FIXTURE-001", color="White")
        self.anchor["source_manifest"] = "sources.json"

        self.source_images = {}
        source_records = []
        for i, role in enumerate(("side", "outsole", "top")):
            p = self.base / (role + ".png")
            p.write_bytes(png(4, 4, (40 + i * 50, 60 + i * 30, 80 + i * 20)))
            sid = "fixture-" + role
            source_records.append({"source_id": sid, "source_version_id": "fixture-original",
                                   "file": p.name, "sha256": wf.sha(p)})
            self.source_images[role] = (sid, p)
            self.case["views"][role] = {"path": str(p), "sha256": wf.sha(p),
                                         "view_role": role, "source_id": sid,
                                         "source_version_id": "fixture-original"}

        source_manifest = {k: self.anchor[k] for k in ("brand", "model", "sku", "color")}
        source_manifest["sources"] = source_records
        wf.write(self.base / "sources.json", source_manifest)
        self.anchor_path.write_text(json.dumps(self.anchor, ensure_ascii=False), encoding="utf-8")
        self.case["anchor"] = self.ref(self.anchor_path)
        self.case["identity_sources"] = self.ref(self.base / "sources.json")
        for item in self.case["landmarks"].values():
            item["source_id"] = self.source_images["outsole"][0]
            item["source_version_id"] = "fixture-original"

        self.source = self.base / "owner-method.md"
        self.source.write_text("Owner-directed candidate for one synthetic outsole action only.", encoding="utf-8")
        for binding in self.case["method_bindings"].values():
            binding["source"] = self.ref(self.source)

        self.transport = SpyTransport()
        self.auth_calls = 0
        self.job_root = None

    def tearDown(self):
        self.tmp.cleanup()

    def ref(self, path):
        path = Path(path).resolve()
        return {"path": str(path), "sha256": wf.sha(path)}

    def save_case(self):
        wf.write(self.case_path, self.case)
        return self.case_path

    def report(self):
        return wf.inspect_case(self.save_case())

    def bad(self, code):
        result = self.report()
        self.assertEqual(result["status"], "BLOCKED", result)
        self.assertIn(code, result["errors"][0])

    def credentials(self):
        self.auth_calls += 1
        return {"provider": "xai-oauth", "api_key": "fixture-only-not-a-secret"}

    def receipt(self, report, kind, shot_id="scrub_forefoot", input_sha=None):
        pair = report["prompts"][shot_id]
        receipt = {
            "case_id": report["case_id"], "shot_id": shot_id,
            "content_digest": pair["content_digest"],
            "case_sha256": report["case_sha256"], "library_sha256": report["library_sha256"],
            "compiler_sha256": report["compiler_sha256"], "policy_sha256": report["policy_sha256"],
            "source_bundle_sha256": report["source_bundle_sha256"],
            "still_prompt_sha256": pair["still_prompt_sha256"],
            "motion_prompt_sha256": pair["motion_prompt_sha256"],
            "reviewer": "offline-fixture-reviewer",
            "reviewer_role": "independent_reviewer",
            "review_basis": "text_only" if kind == "semantic" else "image_frame",
            "status": "pass_for_synthetic_test" if self.case["mode"] == "synthetic_action_test"
                      else ("pass_after_text_review" if kind == "semantic"
                            else "pass_after_visual_frame_review"),
            "checks": {key: True for key in (wf.SEMANTIC_CHECKS if kind == "semantic" else wf.FRAME_CHECKS)},
            "observations": "Offline synthetic fixture receipt; no human image or video was reviewed."
        }
        if input_sha is not None:
            receipt["input_sha256"] = input_sha
        return receipt

    def make_job(self, generation_id="offline-test-job"):
        self.save_case()
        report = wf.compile_case(self.case_path)
        image = self.base / "frame.png"
        image.write_bytes(png(720, 1280))
        semantic = self.base / "semantic.json"
        frame = self.base / "frame-review.json"
        wf.write(semantic, self.receipt(report, "semantic"))
        wf.write(frame, self.receipt(report, "first_frame", input_sha=wf.sha(image)))
        self.job_root = wf.prepare(self.case_path, "scrub_forefoot", image, semantic, frame,
                                   generation_id, jobs_root=self.base / "jobs")
        return self.job_root

    def state(self, wetness, soil, foam, wear="AF1-SOLE-SCUFFS-01",
              appearance="gray_beige_groove_grit"):
        result = {"wetness": wetness, "soil": soil, "foam": foam, "wear_id": wear}
        if soil != "removed":
            result["soil_appearance_id"] = appearance
        return result

    def simple_shot(self, action, start, end, shot_id):
        library = wf.read(wf.LIBRARY)
        profile = library["profiles"][action]
        tool_for_kind = {item["kind"]: key for key, item in library["tools"].items()}
        tool_id = tool_for_kind[profile["tool_kind"]]
        shot = {
            "id": shot_id, "instance_id": self.case["instance_id"], "zone": "outsole_forefoot",
            "action": action, "tool_id": tool_id, "duration_seconds": 4,
            "composition_id": "close_forefoot_endpoints_visible",
            "orientation_id": "toe_left_outsole_to_camera", "visible_identity_features": [1, 6],
            "start": copy.deepcopy(start), "end": copy.deepcopy(end),
            "hands": {
                "working": {"role": "working", "grip": "source_bound", "grip_point": "source_bound"},
                "supporting": {"role": "supporting", "support_point": "heel_brace"}
            }, "motion": {"kind": profile["motion_kind"], "basis": "owner_design_target"}
        }
        if profile["motion_kind"] == "linear_reciprocal":
            zone = self.case["zones"][shot["zone"]]
            a_id, b_id = zone["stroke_landmarks"]
            shot["hands"] = {
                "working": {"role": "working", "grip": "full_overhand", "grip_point": "back_of_brush"},
                "supporting": {"role": "supporting", "support_point": "heel_brace"}
            }
            shot["motion"].update({
                "path_uv": [self.case["landmarks"][a_id]["uv"],
                            self.case["landmarks"][b_id]["uv"],
                            self.case["landmarks"][a_id]["uv"]],
                "contact_size_uv": [0.12, 0.18], "cycle_seconds": 1.5, "cycle_count": 1,
                "direction": "outbound_then_same_track_return",
                "start_landmark_id": a_id, "end_landmark_id": b_id
            })
        elif profile["motion_kind"] == "local_circle":
            shot["hands"] = {
                "working": {"role": "working", "grip": "source_bound"},
                "supporting": {"role": "supporting", "support_point": "heel_brace"}
            }
            shot["motion"].update(center_uv=[0.76, 0.5], radius_uv=[0.05, 0.05],
                                  contact_size_uv=[0.08, 0.08])
        elif profile["motion_kind"] == "powered_roller_contact":
            shot["hands"] = {
                "working": {"role": "supporting", "support_point": "shoe-feed-center"},
                "supporting": {"role": "supporting", "support_point": "operator-heel-brace"}
            }
            shot["motion"].update(moving_actor="roller", shoe_spins=False)
            shot["equipment_id"] = "test-roller"
        if profile["stage"] != "result":
            base_binding = copy.deepcopy(self.case["method_bindings"]["manual_rubber_candidate"])
            base_binding.update(action=action, tool_id=tool_id, tool_kind=profile["tool_kind"],
                                status="store_confirmed")
            if profile["motion_kind"] == "source_bound_action":
                procedures = {
                    "prepare": {
                        "tool_en": "a clean folded white microfiber cloth",
                        "grip_en": "one hand steadies the heel while the other holds the folded cloth flat",
                        "action_en": "position the cloth beside the selected outsole patch before contact",
                        "visible_effect_en": "the same embedded soil remains visible in the grooves after cloth placement",
                    },
                    "remove_residue": {
                        "tool_en": "a clean folded white microfiber cloth",
                        "grip_en": "one hand braces the heel while the other holds a fresh cloth face against the patch",
                        "action_en": "wipe the dirty foam away from the selected patch in one edge-to-edge pass",
                        "visible_effect_en": "a thin cloudy residue line transfers onto the cloth while the rubber remains wet",
                    },
                    "dry": {
                        "tool_en": "a ventilated level shoe-drying rack",
                        "grip_en": "both hands support the shoe by the heel and midsole until the rack carries its weight",
                        "action_en": "set the same damp shoe upright on the ventilated rack",
                        "visible_effect_en": "the shoe stays damp and in the same orientation at the cut",
                    },
                }
                base_binding["procedure"] = procedures[action]
            elif profile["motion_kind"] == "local_circle":
                base_binding["procedure"] = {
                    "tool_en": "a small soft detail brush suited to the confirmed material",
                    "grip_en": "the working hand holds the brush upright while the other hand steadies the heel",
                    "action_en": "work one small circular pass across the selected patch",
                    "visible_effect_en": "loosened soil gathers into a thin cloudy line within the same patch",
                }
            self.case["method_bindings"][shot_id] = base_binding
            shot["method_binding"] = shot_id
        return shot

    def add_comparison(self, result, before_state, after_state):
        before_img, after_img = self.base / "before-outsole.png", self.base / "after-outsole.png"
        before_img.write_bytes(png(8, 8, (80, 70, 60)))
        after_img.write_bytes(png(8, 8, (170, 170, 170)))
        before_id, after_id = "before-d0", "after-f3"
        provenance = ("synthetic_test_fixture" if self.case["mode"] == "synthetic_action_test"
                      else "staff_captured")
        before_record = {"view_role": "outsole", "source_id": "fixture-camera-01",
                         "provenance": provenance, "state": copy.deepcopy(before_state),
                         "state_id": wf.canonical_sha(before_state), "image": self.ref(before_img),
                         "instance_id": self.case["instance_id"], "zone_id": "outsole_forefoot",
                         "pose_id": "same-mounted-sole-view", "light_id": "same-work-light"}
        after_record = {"view_role": "outsole", "source_id": "fixture-camera-01",
                        "provenance": provenance, "state": copy.deepcopy(after_state),
                        "state_id": wf.canonical_sha(after_state), "image": self.ref(after_img),
                        "instance_id": self.case["instance_id"], "zone_id": "outsole_forefoot",
                        "pose_id": "same-mounted-sole-view", "light_id": "same-work-light"}
        before_record["image"]["view_role"] = "outsole"
        after_record["image"]["view_role"] = "outsole"
        self.case["comparison_assets"] = {before_id: before_record, after_id: after_record}
        result["comparison"] = {
            "mode": "same_condition_efficacy",
            "before_asset_id": before_id, "after_asset_id": after_id,
            "before_state_id": before_record["state_id"], "after_state_id": after_record["state_id"],
        }

    def full_wet_case(self):
        self.case["mode"] = "store_process_film"
        start_dirty_dry = self.state("dry", "embedded", "absent")
        damp_clear = self.state("damp", "embedded", "clear")
        brush_end = self.state("wet", "suspended", "dirty")
        rinsed = self.state("wet", "residual", "absent")
        result_state = self.state("dry", "residual", "absent")
        prep = self.simple_shot("prepare", start_dirty_dry, damp_clear, "prep")
        scrub = self.case["shots"][0]
        scrub.update(start=damp_clear, end=brush_end)
        residue = self.simple_shot("remove_residue", brush_end, rinsed, "residue")
        dry = self.simple_shot("dry", rinsed, rinsed, "dry_setup")
        result = self.simple_shot("result", result_state, result_state, "result")
        result["time_transition"] = {"type": "elapsed_drying", "caption_id": "after-confirmed-drying",
                                     "source": self.ref(self.source)}
        self.add_comparison(result, start_dirty_dry, result_state)
        self.case["shots"] = [prep, scrub, residue, dry, result]
        for item in self.case["method_bindings"].values():
            item["status"] = "store_confirmed"
        return self.case

    def test_plan_is_declaration_only_and_binds_real_identity_sources(self):
        report = self.report()
        self.assertEqual(report["status"], "DECLARATIONS_VALID_SEMANTIC_REVIEW_REQUIRED")
        self.assertFalse(report["visual_quality_accepted"])
        self.assertTrue(report["semantic_review_required"])
        self.assertEqual(report["generation_authorization"], "NOT_EVALUATED_BY_THIS_TOOL")
        self.assertEqual(report["policy_sha256"], wf.POLICY_SHA)

    def test_wrong_endpoint_english_field_is_rejected(self):
        self.case["shots"][0]["motion"]["endpoint_b_en"] = "the heel circle"
        self.bad("STRUCTURED_MOTION_FIELDS_ONLY")

    def test_state_free_text_claiming_clean_is_rejected(self):
        self.case["shots"][0]["end"]["description_en"] = "the whole shoe is clean and dry"
        self.bad("FREEFORM_STATE_TEXT_FORBIDDEN")

    def test_freeform_third_hand_is_rejected(self):
        self.case["shots"][0]["hands"]["third"] = {"role": "turning", "support_point": "heel_brace"}
        self.bad("TWO_DISTINCT_HAND_ROLES_REQUIRED")

    def test_legacy_first_frame_text_is_rejected(self):
        self.case["shots"][0]["first_frame"] = {"tool_appearance_en": "tiny toothbrush"}
        self.bad("LEGACY_FREEFORM_STILL_OR_HAND_FIELDS_FORBIDDEN")

    def test_structured_forward_and_heel_paths_both_pass(self):
        forefoot = self.report()
        self.assertNotEqual(forefoot["status"], "BLOCKED")
        heel_zone = self.case["zones"]["outsole_forefoot"]
        heel_zone["label_en"] = "rubber outsole heel tread patch"
        heel_zone["bounds_uv"] = [0.05, 0.1, 0.48, 0.9]
        self.case["landmarks"]["heel_inner"] = {
            "id": "heel_inner", "view_role": "outsole", "source_id": self.source_images["outsole"][0],
            "source_version_id": "fixture-original",
            "uv": [0.16, 0.5], "label_en": "heel-side start of the heel tread field"
        }
        self.case["landmarks"]["heel_outer"] = {
            "id": "heel_outer", "view_role": "outsole", "source_id": self.source_images["outsole"][0],
            "source_version_id": "fixture-original",
            "uv": [0.39, 0.5], "label_en": "opposite end of that heel tread field"
        }
        heel_zone["stroke_landmarks"] = ["heel_inner", "heel_outer"]
        motion = self.case["shots"][0]["motion"]
        motion.update(start_landmark_id="heel_inner", end_landmark_id="heel_outer",
                      path_uv=[[0.16, 0.5], [0.39, 0.5], [0.16, 0.5]])
        heel = self.report()
        self.assertNotEqual(heel["status"], "BLOCKED", heel)
        self.assertIn("heel tread patch", heel["prompts"]["scrub_forefoot"]["still_prompt"])
        self.assertNotIn("selected rubber outsole forefoot", heel["prompts"]["scrub_forefoot"]["still_prompt"].lower())

    def test_material_change_is_rendered_in_both_prompt_stages(self):
        self.anchor["material_zones"]["outsole"]["material"] = "elastomer"
        self.anchor_path.write_text(json.dumps(self.anchor, ensure_ascii=False), encoding="utf-8")
        self.case["anchor"] = self.ref(self.anchor_path)
        zone = self.case["zones"]["outsole_forefoot"]
        zone["material"] = "elastomer"
        zone["label_en"] = "elastomer outsole forefoot pivot-ring tread patch"
        self.case["method_bindings"]["manual_rubber_candidate"]["material"] = "elastomer"
        self.case["soil_appearances"]["gray_beige_groove_grit"] = "gray-beige soil lodged in elastomer tread grooves"
        report = self.report()
        still = report["prompts"]["scrub_forefoot"]["still_prompt"].lower()
        motion = report["prompts"]["scrub_forefoot"]["motion_prompt"].lower()
        self.assertIn("elastomer", still)
        self.assertIn("elastomer", motion)
        self.assertNotIn("against the rubber", motion)

    def test_brush_footprint_exact_zone_boundary_is_allowed(self):
        zone = self.case["zones"]["outsole_forefoot"]
        zone["bounds_uv"] = [0.52, 0.12, 1.0, 0.9]
        zone["stroke_landmarks"] = ["boundary_a", "boundary_b"]
        footprint = [0.12, 0.2]
        start = [zone["bounds_uv"][0] + footprint[0] / 2, 0.5]
        end = [zone["bounds_uv"][2] - footprint[0] / 2, 0.5]
        self.case["landmarks"]["boundary_a"] = {
            "id": "boundary_a", "view_role": "outsole",
            "source_id": self.source_images["outsole"][0], "source_version_id": "fixture-original", "uv": start,
            "label_en": "the left boundary of the selected rubber zone"
        }
        self.case["landmarks"]["boundary_b"] = {
            "id": "boundary_b", "view_role": "outsole",
            "source_id": self.source_images["outsole"][0], "source_version_id": "fixture-original", "uv": end,
            "label_en": "the right boundary of the selected rubber zone"
        }
        shot = self.case["shots"][0]
        shot["motion"]["start_landmark_id"] = "boundary_a"
        shot["motion"]["end_landmark_id"] = "boundary_b"
        shot["motion"]["path_uv"] = [start, end, start]
        shot["motion"]["contact_size_uv"] = footprint
        self.assertNotEqual(self.report()["status"], "BLOCKED", self.report())

    def test_cycle_count_must_be_explicitly_exactly_one(self):
        self.assertNotEqual(self.report()["status"], "BLOCKED")
        self.case["shots"][0]["motion"]["cycle_count"] = 2
        self.bad("EXACTLY_ONE_CYCLE")
        self.case["shots"][0]["motion"]["cycle_count"] = True
        self.bad("EXACTLY_ONE_CYCLE")

    def test_each_stage_uses_independent_tool_and_action_language(self):
        self.full_wet_case()
        report = wf.compile_case(self.save_case())
        prep = report["prompts"]["prep"]["motion_prompt"].lower()
        dry = report["prompts"]["dry_setup"]["motion_prompt"].lower()
        residue = report["prompts"]["residue"]["motion_prompt"].lower()
        self.assertNotIn("brush", prep)
        self.assertNotIn("lather", prep)
        self.assertNotIn("brush", dry)
        self.assertNotIn("lather", dry)
        self.assertIn("foam away", residue)
        self.assertIn("palm-sized block brush", report["prompts"]["scrub_forefoot"]["motion_prompt"])

    def test_every_process_stage_compiles_concrete_language_without_source_placeholders(self):
        self.full_wet_case()
        report = wf.compile_case(self.save_case())
        self.assertEqual(report["status"], "DECLARATIONS_VALID_SEMANTIC_REVIEW_REQUIRED")
        for shot_id, prompts in report["prompts"].items():
            for prompt in prompts.values():
                self.assertNotRegex(prompt.lower(), r"source[_ -]?bound|source[_ -]?confirmed|placeholder")
        self.assertIn("position the cloth", report["prompts"]["prep"]["motion_prompt"])
        self.assertNotIn("Tool: source_bound", report["prompts"]["result"]["still_prompt"])

    def test_structured_profile_keeps_dirt_in_lather_for_this_method_only(self):
        self.assertNotEqual(self.report()["status"], "BLOCKED")
        other_library = self.base / "other-library.json"
        lib = wf.read(wf.LIBRARY)
        lib["profiles"]["manual_broad_reciprocal"].pop("state_transition")
        wf.write(other_library, lib)
        with patch.object(wf, "LIBRARY", other_library):
            blocked = wf.inspect_case(self.case_path)
        self.assertEqual(blocked["status"], "BLOCKED")
        self.assertIn("METHOD_STATE_TRANSITION_UNBOUND", blocked["errors"][0])

    def test_wrong_or_missing_semantic_receipt_blocks_before_credentials_and_post(self):
        for change in ("missing", "pending", "fail", "wrong-shot", "self-review",
                       "wrong-basis", "wrong-role"):
            with self.subTest(change=change):
                root = self.make_job("receipt-" + change)
                manifest = wf.read(root / "manifest.json")
                path = root / "semantic-review.json"
                if change == "missing":
                    path.unlink()
                else:
                    receipt = wf.read(path)
                    if change == "pending":
                        receipt["status"] = "pending"
                    elif change == "fail":
                        receipt["status"] = "fail"
                    elif change == "self-review":
                        receipt["reviewer"] = self.case["created_by"]
                    elif change == "wrong-basis":
                        receipt["review_basis"] = "image_frame"
                    elif change == "wrong-role":
                        receipt["reviewer_role"] = "test_fixture_reviewer"
                    else:
                        receipt["shot_id"] = "other-shot"
                    wf.write(path, receipt)
                    manifest["shoe_contract"]["semantic_review"]["sha256"] = wf.sha(path)
                    wf.write(root / "manifest.json", manifest)
                with self.assertRaises(wf.ContractError):
                    wf.run_job(root, self.credentials, self.transport)
                self.assertEqual((self.auth_calls, self.transport.posts), (0, 0))

    def test_test_fixture_reviewer_role_cannot_enter_prepare_or_run(self):
        root = self.make_job("fixture-role-denied")
        path = root / "semantic-review.json"
        receipt = wf.read(path)
        receipt["reviewer_role"] = "test_fixture_reviewer"
        wf.write(path, receipt)
        manifest = wf.read(root / "manifest.json")
        manifest["shoe_contract"]["semantic_review"]["sha256"] = wf.sha(path)
        wf.write(root / "manifest.json", manifest)
        with self.assertRaisesRegex(wf.ContractError, "SEMANTIC_REVIEWER_ROLE_REQUIRED"):
            wf.run_job(root, self.credentials, self.transport)
        self.assertEqual((self.auth_calls, self.transport.posts), (0, 0))

    def test_any_content_dependency_change_invalidates_old_job(self):
        root = self.make_job("dependency-change")
        manifest = wf.read(root / "manifest.json")
        old_receipts = {kind: wf.read(root / filename) for kind, filename in
                        (("semantic", "semantic-review.json"), ("first_frame", "first-frame-review.json"))}
        self.case["capture_en"] += " changed lighting direction."
        self.save_case()
        with self.assertRaises(wf.ContractError):
            wf.check_job(root, manifest)
        new_report = wf.compile_case(self.case_path)
        for kind, receipt in old_receipts.items():
            with self.subTest(kind=kind), self.assertRaises(wf.ContractError):
                wf.validate_receipt(receipt, new_report, "scrub_forefoot", self.case["mode"],
                                    self.case["created_by"], kind)
        self.assertEqual(self.transport.posts, 0)

    def test_library_compiler_source_still_and_motion_have_distinct_bindings(self):
        root = self.make_job("six-bindings")
        original_library = wf.LIBRARY
        temp_library = self.base / "alternate-library.json"
        library = wf.read(original_library)
        library["compositions"]["close_forefoot_endpoints_visible"] += " A still-only revision."
        wf.write(temp_library, library)
        with patch.object(wf, "LIBRARY", temp_library):
            changed = wf.compile_case(self.case_path)
            with self.assertRaisesRegex(wf.ContractError, "SEMANTIC_RECEIPT_BINDING_MISMATCH"):
                wf.validate_receipt(wf.read(root / "semantic-review.json"), changed, "scrub_forefoot",
                                    self.case["mode"], self.case["created_by"], "semantic")
            with self.assertRaisesRegex(wf.ContractError, "FIRST_FRAME_RECEIPT_BINDING_MISMATCH"):
                wf.validate_receipt(wf.read(root / "first-frame-review.json"), changed, "scrub_forefoot",
                                    self.case["mode"], self.case["created_by"], "first_frame")
        with patch.object(wf, "COMPILER_SHA_AT_IMPORT", "f" * 64):
            with self.assertRaises(wf.ContractError):
                wf.check_job(root)
        self.source.write_text("changed method source", encoding="utf-8")
        with self.assertRaisesRegex(wf.ContractError, "EVIDENCE_CHANGED"):
            wf.check_job(root)
        self.assertEqual(self.transport.posts, 0)

    def test_still_prompt_only_change_invalidates_both_old_receipts(self):
        root = self.make_job("still-only-change")
        original_compile = wf.compile_shot

        def still_only_revision(*args, **kwargs):
            pair = original_compile(*args, **kwargs)
            pair["still_prompt"] += " Revised composition: show the tool handle and both hand positions."
            return pair

        with patch.object(wf, "compile_shot", side_effect=still_only_revision):
            changed = wf.compile_case(self.case_path)
        semantic = wf.read(root / "semantic-review.json")
        frame = wf.read(root / "first-frame-review.json")
        with self.assertRaisesRegex(wf.ContractError, "SEMANTIC_RECEIPT_BINDING_MISMATCH"):
            wf.validate_receipt(semantic, changed, "scrub_forefoot", self.case["mode"],
                                self.case["created_by"], "semantic")
        with self.assertRaisesRegex(wf.ContractError, "FIRST_FRAME_RECEIPT_BINDING_MISMATCH"):
            wf.validate_receipt(frame, changed, "scrub_forefoot", self.case["mode"],
                                self.case["created_by"], "first_frame")

    def test_motion_prompt_mutation_invalidates_case_and_receipts(self):
        root = self.make_job("motion-change")
        self.case["shots"][0]["motion"]["cycle_seconds"] = 1.4
        self.save_case()
        with self.assertRaises(wf.ContractError):
            wf.check_job(root)
        self.assertEqual(self.transport.posts, 0)

    def test_compile_uses_one_snapshot_and_rejects_file_race(self):
        self.save_case()
        original = self.case_path.read_bytes()
        def mutate_after_snapshot(_snapshots):
            altered = json.loads(original.decode("utf-8"))
            altered["capture_en"] += " changed after load"
            wf.write(self.case_path, altered)
        try:
            with self.assertRaisesRegex(wf.ContractError, "SOURCE_DRIFT_DURING_COMPILE"):
                wf.compile_case(self.case_path, snapshot_hook=mutate_after_snapshot)
        finally:
            self.case_path.write_bytes(original)

    def test_cli_bad_job_is_rejected_before_runtime_or_credentials(self):
        root = self.base / "malformed-job"
        root.mkdir()
        calls = []
        result = wf.main(["run", str(root)], runtime_factory=lambda needs: calls.append(needs),
                         emit=False)
        self.assertEqual(result, 2)
        self.assertEqual(calls, [])
        self.assertEqual((self.auth_calls, self.transport.posts), (0, 0))

    def test_source_drift_immediately_before_credentials_callback_blocks_resolver(self):
        root = self.make_job("credential-window")
        real_resolver_calls = 0
        def resolver():
            nonlocal real_resolver_calls
            real_resolver_calls += 1
            return self.credentials()
        def core(root_arg, manifest, credential_callback, transport):
            self.source.write_text("changed after initial precheck", encoding="utf-8")
            return credential_callback()
        with self.assertRaises(wf.ContractError):
            wf.run_job(root, resolver, self.transport, core_run=core)
        self.assertEqual(real_resolver_calls, 0)
        self.assertEqual(self.transport.posts, 0)

    def test_polling_job_uses_same_request_after_source_removed(self):
        root = self.make_job("poll-after-source-change")
        first = wf.run_job(root, self.credentials, self.transport)
        self.assertEqual(first["state"], "POLLING")
        self.assertEqual(self.transport.posts, 1)
        self.source.unlink()
        self.transport.done = True
        second = wf.run_job(root, self.credentials, self.transport)
        self.assertEqual(second["state"], "COMPLETED")
        self.assertEqual(self.transport.posts, 1)
        self.assertEqual(self.transport.gets, 2)

    def test_completed_job_bypasses_config_auth_and_transport(self):
        root = self.make_job("completed-bypass")
        self.transport.done = True
        state = wf.run_job(root, self.credentials, self.transport)
        self.assertEqual(state["state"], "COMPLETED")
        calls = []
        code = wf.main(["run", str(root)],
                       runtime_factory=lambda needs: calls.append(needs),
                       emit=False)
        self.assertEqual(code, 0)
        self.assertEqual(calls, [])

    def test_unknown_corrupt_and_partial_intents_fail_closed(self):
        root = self.make_job("bad-intent")
        manifest = wf.read(root / "manifest.json")
        digest = wf._core_manifest_digest(manifest)
        for state in ({"state": "UNKNOWN", "manifest_sha256": digest},
                      {"state": "POLLING", "manifest_sha256": "bad", "request_id": "x"}):
            wf.write(root / "intent.json", state)
            with self.assertRaises(wf.ContractError):
                wf.classify_job(root)
        (root / "intent.json").write_text("{", encoding="utf-8")
        with self.assertRaisesRegex(wf.ContractError, "INTENT_CORRUPT"):
            wf.classify_job(root)
        (root / "intent.json").unlink()
        (root / "request.json").write_text("partial", encoding="utf-8")
        with self.assertRaisesRegex(wf.ContractError, "INTENT_MISSING"):
            wf.classify_job(root)

    def test_corrupt_prepared_intent_is_rejected_before_credentials(self):
        root = self.make_job("missing-idempotency-key")
        manifest = wf.read(root / "manifest.json")
        intent = {"state": "PREPARED", "manifest_sha256": wf._core_manifest_digest(manifest),
                  "provider": "xai-oauth", "request_id": None}
        wf.write(root / "intent.json", intent)
        with self.assertRaisesRegex(wf.ContractError, "INTENT_IDEMPOTENCY_KEY_INVALID"):
            wf.run_job(root, self.credentials, self.transport)
        self.assertEqual((self.auth_calls, self.transport.posts), (0, 0))

    def test_malformed_poll_request_id_is_rejected_before_credentials(self):
        root = self.make_job("malformed-poll-id")
        wf.run_job(root, self.credentials, self.transport)
        intent = wf.read(root / "intent.json")
        intent["request_id"] = "../not-a-provider-id"
        wf.write(root / "intent.json", intent)
        before = (self.auth_calls, self.transport.posts)
        with self.assertRaisesRegex(wf.ContractError, "INTENT_REQUEST_ID_INVALID"):
            wf.run_job(root, self.credentials, self.transport)
        self.assertEqual((self.auth_calls, self.transport.posts), before)

    def test_prepared_state_with_prior_raw_response_replays_and_polls_without_second_post(self):
        root = self.make_job("rollback-after-provider-response")
        first = wf.run_job(root, self.credentials, self.transport)
        self.assertEqual(first["state"], "POLLING")
        intent = wf.read(root / "intent.json")
        intent.update(state="PREPARED", request_id=None)
        wf.write(root / "intent.json", intent)
        self.transport.done = True
        recovered = wf.run_job(root, self.credentials, self.transport)
        self.assertEqual(recovered["state"], "COMPLETED")
        self.assertEqual(self.transport.posts, 1)
        self.assertEqual(self.transport.gets, 2)

    def test_resume_wrapper_refuses_a_second_submit_call(self):
        root = self.make_job("resume-submit-guard")
        first = wf.run_job(root, self.credentials, self.transport)
        self.assertEqual(first["state"], "POLLING")
        manifest = wf.read(root / "manifest.json")
        def bad_resume(root_arg, submitted_manifest, credential_callback, transport):
            return transport.submit(submitted_manifest, credential_callback(), "reuse-key")
        before = self.transport.posts
        with self.assertRaisesRegex(wf.ContractError, "RESUME_MUST_POLL_NO_SUBMIT"):
            wf.run_job(root, self.credentials, self.transport, core_run=bad_resume)
        self.assertEqual(self.transport.posts, before)

    def test_terminal_intents_never_resolve_credentials_or_repost(self):
        root = self.make_job("terminal-states")
        manifest = wf.read(root / "manifest.json")
        digest = wf._core_manifest_digest(manifest)
        for state in ("SUBMITTING", "AMBIGUOUS", "FAILED"):
            intent = {"state": state, "manifest_sha256": digest,
                      "idempotency_key": "7a0107a1-3e12-4b19-bd09-1fe80597aa54",
                      "provider": "xai-oauth", "request_id": None}
            wf.write(root / "request.json", manifest)
            wf.write(root / "intent.json", intent)
            before = (self.auth_calls, self.transport.posts)
            result = wf.run_job(root, self.credentials, self.transport)
            self.assertEqual(result["state"], state)
            self.assertEqual((self.auth_calls, self.transport.posts), before)

    def test_cli_exit_codes_match_actual_status(self):
        expected = {"COMPLETED": 0, "POLLING": 3, "ACCEPTED": 3,
                    "FAILED": 4, "AMBIGUOUS": 5, "SUBMITTING": 6, "BLOCKED": 2}
        for status, code in expected.items():
            self.assertEqual(wf._exit_code({"state": status}), code, status)

    def test_plan_output_cannot_overwrite_case_or_path_alias(self):
        self.save_case()
        before = self.case_path.read_bytes()
        rc = wf.main(["plan", str(self.case_path), "--out", str(self.case_path)], emit=False)
        self.assertEqual(rc, 2)
        self.assertEqual(self.case_path.read_bytes(), before)
        alias = self.case_path.parent / "." / self.case_path.name
        with self.assertRaisesRegex(wf.ContractError, "OUTPUT_ALIASES_INPUT"):
            wf.guard_output_path(alias, [self.case_path])

    def test_plan_output_protects_indirect_method_source_compiler_and_policy(self):
        self.save_case()
        before = self.source.read_bytes()
        rc = wf.main(["plan", str(self.case_path), "--out", str(self.source)], emit=False)
        self.assertEqual(rc, 2)
        self.assertEqual(self.source.read_bytes(), before)
        report = self.report()
        for protected in (wf.COMPILER_PATH, wf.POLICY):
            with self.subTest(protected=protected), self.assertRaisesRegex(wf.ContractError, "OUTPUT_ALIASES_INPUT"):
                wf.guard_output_path(protected, report["source_paths"])

    def test_blocked_plan_does_not_write_a_partial_report(self):
        self.case["shots"][0]["motion"]["cycle_count"] = 2
        self.save_case()
        output = self.base / "blocked-report.json"
        rc = wf.main(["plan", str(self.case_path), "--out", str(output)], emit=False)
        self.assertEqual(rc, 2)
        self.assertFalse(output.exists())

    def test_atomic_json_writes_use_distinct_temporary_paths(self):
        output = self.base / "parallel-write.json"
        errors = []
        barrier = threading.Barrier(8)
        def writer(index):
            try:
                barrier.wait(timeout=3)
                wf.write(output, {"writer": index})
            except Exception as exc:
                errors.append(exc)
        threads = [threading.Thread(target=writer, args=(i,)) for i in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=5)
        self.assertEqual(errors, [])
        self.assertIn(wf.read(output)["writer"], range(8))
        self.assertEqual(list(self.base.glob(".parallel-write.json.*.tmp")), [])

    def test_boolean_nan_and_bad_coordinates_are_rejected(self):
        self.case["shots"][0]["motion"]["cycle_seconds"] = True
        self.bad("INVALID_CYCLE_SECONDS")
        self.case["shots"][0]["motion"]["cycle_seconds"] = float("nan")
        self.bad("INVALID_CYCLE_SECONDS")
        self.case["shots"][0]["motion"]["cycle_seconds"] = 1.5
        self.case["landmarks"]["forefoot_toe_rim"]["uv"] = [2.0, 0.5]
        self.bad("LANDMARK_UV_OUT_OF_RANGE")

    def test_local_circle_rejects_out_of_range_bounds_but_valid_circle_passes(self):
        old = self.case["shots"][0]
        start = self.state("damp", "embedded", "clear")
        end = self.state("wet", "suspended", "dirty")
        shot = self.simple_shot("local_circular", start, end, "local")
        self.case["shots"] = [shot]
        self.assertNotEqual(self.report()["status"], "BLOCKED")
        shot["motion"]["center_uv"] = [2.0, 0.5]
        self.bad("LOCAL_PATCH_GEOMETRY_REQUIRED")

    def make_machine_library(self, incomplete=False):
        library = wf.read(wf.LIBRARY)
        geometry_path = self.base / "roller-geometry.json"
        geometry = {
            "roller_id": "shop-roller-01",
            "working_arc": {"start_deg": 15, "end_deg": 150},
            "contact_arc": {"start_deg": 35, "end_deg": 115},
            "rotation_direction": "clockwise", "feed_point_id": "shoe-feed-center",
            "angle_frame_en": "angles are measured in the fixed operator-facing side-view used by this reference photo",
            "rotation_observation_en": "the roller turns toward image-left along the lower contact edge",
            "contact_observation_en": "the outsole meets the roller only along the lower bristle arc",
            "feed_observation_en": "the operator advances the shoe a short distance and then withdraws it",
            "support_point_id": "operator-heel-brace",
            "feed_point": {"id": "shoe-feed-center", "uv": [0.65, 0.48]},
            "support_point": {"id": "operator-heel-brace", "uv": [0.2, 0.55]}
        }
        if incomplete:
            geometry.pop("roller_id")
        wf.write(geometry_path, geometry)
        library["equipment"]["test-roller"] = {
            **geometry, "source_ref": self.ref(geometry_path)
        }
        return library

    def test_powered_roller_requires_complete_machine_geometry_json(self):
        old = self.case["shots"][0]
        shot = self.simple_shot("powered_roller", old["start"], old["end"], "machine")
        self.case["shots"] = [shot]
        incomplete = self.base / "incomplete-machine-library.json"
        wf.write(incomplete, self.make_machine_library(incomplete=True))
        with patch.object(wf, "LIBRARY", incomplete):
            blocked = wf.inspect_case(self.save_case())
        self.assertEqual(blocked["status"], "BLOCKED")
        self.assertIn("POWERED_ROLLER_GEOMETRY_INCOMPLETE", blocked["errors"][0])
        complete = self.base / "complete-machine-library.json"
        wf.write(complete, self.make_machine_library())
        with patch.object(wf, "LIBRARY", complete):
            valid = wf.inspect_case(self.case_path)
        self.assertNotEqual(valid["status"], "BLOCKED", valid)
        self.assertIn("registered feed point shoe-feed-center", valid["prompts"]["machine"]["still_prompt"])
        self.assertNotIn("Working hand uses", valid["prompts"]["machine"]["still_prompt"])
        machine_motion = valid["prompts"]["machine"]["motion_prompt"]
        self.assertIn("clockwise", machine_motion)
        changed_geometry = self.make_machine_library()
        changed_geometry["equipment"]["test-roller"]["rotation_direction"] = "counterclockwise"
        geometry_path = Path(changed_geometry["equipment"]["test-roller"]["source_ref"]["path"])
        source_data = wf.read(geometry_path)
        source_data["rotation_direction"] = "counterclockwise"
        wf.write(geometry_path, source_data)
        changed_geometry["equipment"]["test-roller"]["source_ref"]["sha256"] = wf.sha(geometry_path)
        alternate = self.base / "counterclockwise-library.json"
        wf.write(alternate, changed_geometry)
        with patch.object(wf, "LIBRARY", alternate):
            reversed_motion = wf.inspect_case(self.save_case())
        self.assertIn("counterclockwise", reversed_motion["prompts"]["machine"]["motion_prompt"])
        self.assertNotEqual(machine_motion, reversed_motion["prompts"]["machine"]["motion_prompt"])

    def test_same_image_cannot_impersonate_three_views_without_subview_evidence(self):
        side_id, side_path = self.source_images["side"]
        self.case["views"]["top"] = {"path": str(side_path), "sha256": wf.sha(side_path),
                                     "view_role": "top", "source_id": side_id,
                                     "source_version_id": "fixture-original"}
        for landmark in self.case["landmarks"].values():
            landmark["source_id"] = side_id
        self.bad("SAME_IMAGE_MULTIPLE_VIEWS_NEED_DISTINCT_SUBVIEW_EVIDENCE")

    def test_same_basename_with_unauthorized_content_cannot_borrow_source_id(self):
        impostor_dir = self.base / "impostor"
        impostor_dir.mkdir()
        impostor = impostor_dir / "side.png"
        impostor.write_bytes(png(4, 4, (1, 2, 3)))
        self.case["views"]["side"].update(path=str(impostor), sha256=wf.sha(impostor))
        self.bad("VIEW_OUTSIDE_EXACT_MODEL_SOURCES")

    def test_identical_bytes_copied_to_another_path_still_share_view_identity(self):
        side_id, side_path = self.source_images["side"]
        duplicate = self.base / "renamed-copy-of-side.png"
        duplicate.write_bytes(side_path.read_bytes())
        self.case["views"]["outsole"] = {"path": str(duplicate), "sha256": wf.sha(duplicate),
                                          "view_role": "outsole", "source_id": side_id,
                                          "source_version_id": "fixture-original"}
        for landmark in self.case["landmarks"].values():
            landmark["source_id"] = side_id
            landmark["source_version_id"] = "fixture-original"
        self.bad("SAME_IMAGE_MULTIPLE_VIEWS_NEED_DISTINCT_SUBVIEW_EVIDENCE")

    def test_same_image_three_distinct_source_crops_are_allowed(self):
        side_id, side_path = self.source_images["side"]
        for role, bounds in (("side", [0.1, 0.1, 0.9, 0.9]),
                             ("outsole", [0.05, 0.6, 0.95, 0.98]),
                             ("top", [0.05, 0.05, 0.95, 0.4])):
            self.case["views"][role] = {"path": str(side_path), "sha256": wf.sha(side_path),
                                         "view_role": role, "source_id": side_id,
                                         "source_version_id": "fixture-original",
                                         "subview": {"kind": "normalized_crop", "bounds_uv": bounds}}
        for landmark in self.case["landmarks"].values():
            landmark["source_id"] = side_id
            landmark["source_version_id"] = "fixture-original"
        self.assertNotEqual(self.report()["status"], "BLOCKED", self.report())

    def test_same_image_crops_need_unique_bounds_for_each_role(self):
        side_id, side_path = self.source_images["side"]
        for role, bounds in (("side", [0.1, 0.1, 0.9, 0.9]),
                             ("outsole", [0.05, 0.6, 0.95, 0.98]),
                             ("top", [0.05, 0.6, 0.95, 0.98])):
            self.case["views"][role] = {"path": str(side_path), "sha256": wf.sha(side_path),
                                         "view_role": role, "source_id": side_id,
                                         "source_version_id": "fixture-original",
                                         "subview": {"kind": "normalized_crop", "bounds_uv": bounds}}
        for landmark in self.case["landmarks"].values():
            landmark["source_id"] = side_id
            landmark["source_version_id"] = "fixture-original"
        self.bad("SAME_IMAGE_MULTIPLE_VIEWS_NEED_DISTINCT_SUBVIEW_EVIDENCE")

    def test_comparison_requires_bound_state_images_not_matching_labels(self):
        self.full_wet_case()
        result = self.case["shots"][-1]
        result["comparison"] = {"mode": "same_condition_efficacy",
                                "before_zone": "outsole_forefoot", "after_zone": "outsole_forefoot",
                                "before_pose_id": "same", "after_pose_id": "same",
                                "before_light_id": "same", "after_light_id": "same",
                                "before_instance_id": self.case["instance_id"],
                                "after_instance_id": self.case["instance_id"]}
        self.bad("COMPARISON_ASSET_BINDINGS_REQUIRED")

    def test_valid_comparison_binds_two_distinct_images_and_state_objects(self):
        self.full_wet_case()
        self.assertNotEqual(self.report()["status"], "BLOCKED")
        self.case["comparison_assets"]["after-f3"]["state"]["wetness"] = "wet"
        self.bad("COMPARISON_STATE_REFERENCE_REQUIRED")

    def test_comparison_condition_fields_must_match_image_asset_records(self):
        self.full_wet_case()
        self.case["comparison_assets"]["after-f3"]["zone_id"] = "outsole_heel"
        self.bad("COMPARISON_ASSET_IDENTITY_OR_ZONE_MISMATCH")
        self.tearDown()
        self.setUp()
        self.full_wet_case()
        self.case["comparison_assets"]["after-f3"]["light_id"] = "different-light"
        self.bad("COMPARISON_CAPTURE_CONDITIONS_DIFFER: light_id")

    def test_same_condition_efficacy_comparison_rejects_dry_to_wet_mismatch(self):
        self.full_wet_case()
        before = self.case["comparison_assets"]["before-d0"]
        before["state"]["wetness"] = "damp"
        before["state_id"] = wf.canonical_sha(before["state"])
        self.case["shots"][-1]["comparison"]["before_state_id"] = before["state_id"]
        self.case["shots"][0]["start"]["wetness"] = "damp"
        self.bad("SAME_CONDITION_COMPARISON_WETNESS_MISMATCH")

    def test_narrative_wet_to_dry_transition_is_not_labeled_efficacy_comparison(self):
        self.full_wet_case()
        self.case["shots"][-1]["comparison"]["mode"] = "narrative_transition"
        before = self.case["comparison_assets"]["before-d0"]
        before["state"]["wetness"] = "damp"
        before["state_id"] = wf.canonical_sha(before["state"])
        self.case["shots"][-1]["comparison"]["before_state_id"] = before["state_id"]
        self.case["shots"][0]["start"]["wetness"] = "damp"
        report = self.report()
        prompt = report["prompts"]["result"]["motion_prompt"]
        self.assertIn("efficacy remains unassessed", prompt)

    def test_experiment_requires_new_first_frame(self):
        previous = self.base / "previous-manifest.json"
        frame = png(720, 1280)
        wf.write(previous, {"generation_id": "prior", "input_sha256": hashlib.sha256(frame).hexdigest()})
        self.case["experiment"] = {"new_first_frame_required": True,
                                   "previous_manifest": self.ref(previous),
                                   "previous_generation_id": "prior"}
        self.save_case()
        report = wf.compile_case(self.case_path)
        semantic = self.base / "sem.json"
        receipt = self.base / "frame-review.json"
        image = self.base / "same.png"
        image.write_bytes(frame)
        wf.write(semantic, self.receipt(report, "semantic"))
        wf.write(receipt, self.receipt(report, "first_frame", input_sha=wf.sha(image)))
        with self.assertRaisesRegex(wf.ContractError, "NEW_COMPOSITION_CANNOT_REUSE_FAILED_FIRST_FRAME"):
            wf.prepare(self.case_path, "scrub_forefoot", image, semantic, receipt, "same-frame",
                       jobs_root=self.base / "jobs")

    def test_wet_clean_requires_profile_specific_transition_and_does_not_force_other_methods(self):
        self.full_wet_case()
        self.assertNotEqual(self.report()["status"], "BLOCKED")
        wet_profile = wf.read(wf.LIBRARY)
        wet_profile["profiles"]["manual_broad_reciprocal"]["state_transition"] = "preserve_wet_soil"
        alternate = self.base / "preserve-library.json"
        wf.write(alternate, wet_profile)
        self.case["shots"][1]["end"] = self.state("wet", "embedded", "clear")
        self.case["shots"][2]["start"] = copy.deepcopy(self.case["shots"][1]["end"])
        with patch.object(wf, "LIBRARY", alternate):
            report = wf.inspect_case(self.save_case())
        self.assertNotEqual(report["status"], "BLOCKED", report)
        self.assertNotIn("cloudy lather", report["prompts"]["scrub_forefoot"]["motion_prompt"])

    def test_preserve_wet_soil_cannot_compile_a_dry_end_state(self):
        self.full_wet_case()
        wet_profile = wf.read(wf.LIBRARY)
        wet_profile["profiles"]["manual_broad_reciprocal"]["state_transition"] = "preserve_wet_soil"
        alternate = self.base / "preserve-library-dry-end.json"
        wf.write(alternate, wet_profile)
        self.case["shots"][1]["end"] = self.state("dry", "embedded", "absent")
        with patch.object(wf, "LIBRARY", alternate):
            blocked = wf.inspect_case(self.save_case())
        self.assertEqual(blocked["status"], "BLOCKED")
        self.assertIn("PRESERVE_WET_SOIL_REQUIRES_WET_END_STATE", blocked["errors"][0])

    def test_source_bound_stages_require_concrete_action_instead_of_placeholder(self):
        self.full_wet_case()
        self.case["method_bindings"]["residue"]["procedure"]["action_en"] = "Use the source_bound residue method."
        self.bad("CONCRETE_METHOD_PROCEDURE_REQUIRED")

    def test_existing_one_shot_core_serializes_concurrent_posts(self):
        root = self.make_job("concurrent")
        self.transport.block_submit = True
        first_errors = []
        def first():
            try:
                wf.run_job(root, self.credentials, self.transport)
            except Exception as exc:
                first_errors.append(exc)
        thread = threading.Thread(target=first)
        thread.start()
        self.assertTrue(self.transport.entered.wait(timeout=3))
        with self.assertRaises(FileExistsError):
            wf.run_job(root, self.credentials, self.transport)
        self.transport.release.set()
        thread.join(timeout=5)
        self.assertFalse(thread.is_alive())
        self.assertEqual(first_errors, [])
        self.assertEqual(self.transport.posts, 1)

    def test_ambiguous_submission_and_accepted_save_failure_never_resubmit(self):
        ambiguous = self.make_job("ambiguous")
        self.transport.ambiguous = True
        self.assertEqual(wf.run_job(ambiguous, self.credentials, self.transport)["state"], "AMBIGUOUS")
        self.assertEqual(wf.run_job(ambiguous, self.credentials, self.transport)["state"], "AMBIGUOUS")
        self.assertEqual(self.transport.posts, 1)

        accepted = self.make_job("accepted-save-failure")
        self.transport = SpyTransport()
        core = wf.module(wf.RUNNER / "oneshot_core.py", "test_existing_one_shot_core")
        def failing_persist(path, value):
            if Path(path).name == "intent.json" and value.get("state") == "ACCEPTED":
                raise OSError("injected accepted-state save failure")
            return core.save(path, value)
        def injected_core(root, manifest, credentials, transport):
            return core.run(root, manifest, credentials, transport, persist=failing_persist)
        with self.assertRaisesRegex(OSError, "injected accepted"):
            wf.run_job(accepted, self.credentials, self.transport, core_run=injected_core)
        state = wf.read(accepted / "intent.json")
        self.assertEqual(state["state"], "SUBMITTING")
        again = wf.run_job(accepted, self.credentials, self.transport)
        self.assertEqual(again["state"], "SUBMITTING")
        self.assertEqual(self.transport.posts, 1)

    def test_invalid_job_zero_credentials_post_and_intent(self):
        root = self.make_job("invalid-prompt")
        manifest = wf.read(root / "manifest.json")
        manifest["prompt"] += " edit outside compiler"
        wf.write(root / "manifest.json", manifest)
        with self.assertRaises(wf.ContractError):
            wf.run_job(root, self.credentials, self.transport)
        self.assertEqual((self.auth_calls, self.transport.posts), (0, 0))
        self.assertFalse((root / "intent.json").exists())

    def test_bad_frame_receipt_blocks_before_credentials(self):
        root = self.make_job("bad-frame")
        path = root / "first-frame-review.json"
        receipt = wf.read(path)
        receipt["checks"]["tool_scale"] = False
        wf.write(path, receipt)
        manifest = wf.read(root / "manifest.json")
        manifest["shoe_contract"]["first_frame_review"]["sha256"] = wf.sha(path)
        wf.write(root / "manifest.json", manifest)
        with self.assertRaisesRegex(wf.ContractError, "FIRST_FRAME_CHECKS_INCOMPLETE"):
            wf.run_job(root, self.credentials, self.transport)
        self.assertEqual((self.auth_calls, self.transport.posts), (0, 0))

    def test_actual_one_shot_resume_after_source_change_and_completed_no_resend(self):
        root = self.make_job("real-core-resume")
        state = wf.run_job(root, self.credentials, self.transport)
        self.assertEqual(state["state"], "POLLING")
        self.assertEqual(self.transport.posts, 1)
        self.source.write_text("source changed after accepted submission", encoding="utf-8")
        self.transport.done = True
        state = wf.run_job(root, self.credentials, self.transport)
        self.assertEqual(state["state"], "COMPLETED")
        auth_before = self.auth_calls
        again = wf.run_job(root, self.credentials, self.transport)
        self.assertEqual(again, state)
        self.assertEqual((self.transport.posts, self.transport.gets, self.auth_calls), (1, 2, auth_before))

    def test_case_changed_before_fresh_run_is_stopped_before_post(self):
        root = self.make_job("case-changed")
        self.case["shots"][0]["motion"]["cycle_seconds"] = 1.4
        self.save_case()
        with self.assertRaises(wf.ContractError):
            wf.run_job(root, self.credentials, self.transport)
        self.assertEqual((self.auth_calls, self.transport.posts), (0, 0))

    def test_new_model_intake_copies_no_existing_method_or_motion(self):
        target = self.base / "new-model.json"
        wf.init_case(self.anchor_path, "NEW-SHOE-01", target)
        created = wf.read(target)
        self.assertEqual(created["method_bindings"], {})
        self.assertEqual(created["shots"], [])
        self.assertEqual(wf.inspect_case(target)["status"], "BLOCKED")


if __name__ == "__main__":
    unittest.main(verbosity=2)
