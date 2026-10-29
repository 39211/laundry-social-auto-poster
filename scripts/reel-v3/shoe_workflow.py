"""Evidence-bound shoe workflow compiler and guarded adapter.

This module validates declarations and source bindings. It does not validate pixels,
care expertise, production authorization, generated motion, or publication approval.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import types
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data/anchors/shoes/workflow-v1"
LIBRARY = DATA / "action-library.json"
RUNNER = Path("C:/Users/cyc39/AI-Lanes/_commander/scratch/two-reference-videos-20260922/runner")
POLICY = Path("C:/Users/cyc39/AI-Lanes/_commander/scratch/shoe-reset-preproduction-20260921/production-720p-v1/runner/text_policy.py"
)
POLICY_SHA = "7c2df72dae2ce8b6ad564b9707a4189a2e210fb3b7821405ec2c9c6a12617e7c"
SCHEMA_VERSION = 2
FRAME_CHECKS = ("exact_shoe", "same_work_zone", "tool_scale", "grip", "support",
                "stroke_endpoints_visible", "initial_soil", "ordinary_lighting")
SEMANTIC_CHECKS = ("shoe_identity", "zone_and_landmarks", "tool_and_grip",
                   "single_action_cycle", "stage_and_state", "source_scope")
KNOWN_INTENTS = {"PREPARED", "SUBMITTING", "AMBIGUOUS", "FAILED",
                 "ACCEPTED", "POLLING", "COMPLETED"}
TERMINAL_NO_WORK = {"SUBMITTING", "AMBIGUOUS", "FAILED", "COMPLETED"}
LEGACY_PROMPT_FIELDS = {
    "endpoint_a_en", "endpoint_b_en", "support_en", "contact_en", "effect_en",
    "shoe_orientation_en", "tool_appearance_en", "grip_en", "description_en",
    "action_en", "working_area_en", "support_point_en",
}
_WRITE_LOCK = threading.RLock()

# Captured when Python imports this exact module. The compiler checks that the
# on-disk bytes still match before returning a plan, instead of hashing a later
# compiler revision and attributing it to already-running code.
COMPILER_PATH = Path(__file__).resolve()
COMPILER_BYTES_AT_IMPORT = COMPILER_PATH.read_bytes()
COMPILER_SHA_AT_IMPORT = hashlib.sha256(COMPILER_BYTES_AT_IMPORT).hexdigest()


class ContractError(ValueError):
    pass


class Snapshots:
    """One byte snapshot per resolved path; parsing and hashing use the same bytes."""
    def __init__(self):
        self._raw: dict[str, bytes] = {}

    def bytes(self, path: str | Path, expected_sha256: str | None = None) -> bytes:
        p = Path(path).resolve()
        key = str(p)
        if key not in self._raw:
            try:
                self._raw[key] = p.read_bytes()
            except OSError as exc:
                raise ContractError("EVIDENCE_MISSING: " + p.name) from exc
        raw = self._raw[key]
        digest = hashlib.sha256(raw).hexdigest()
        if expected_sha256 is not None:
            require(digest == expected_sha256, "EVIDENCE_CHANGED: " + p.name)
        return raw

    def sha256(self, path: str | Path) -> str:
        return hashlib.sha256(self.bytes(path)).hexdigest()

    def json(self, path: str | Path, expected_sha256: str | None = None) -> Any:
        raw = self.bytes(path, expected_sha256)
        try:
            return json.loads(raw.decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ContractError("INVALID_JSON: " + Path(path).name) from exc

    def stable(self) -> None:
        for name, raw in self._raw.items():
            try:
                current = Path(name).read_bytes()
            except OSError as exc:
                raise ContractError("SOURCE_DRIFT_DURING_COMPILE: " + Path(name).name) from exc
            require(current == raw, "SOURCE_DRIFT_DURING_COMPILE: " + Path(name).name)


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    with _WRITE_LOCK:
        fd, tmp_name = tempfile.mkstemp(prefix="." + path.name + ".", suffix=".tmp", dir=path.parent)
        tmp = Path(tmp_name)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(tmp, path)
        finally:
            try:
                tmp.unlink()
            except FileNotFoundError:
                pass


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def require(ok, reason):
    if not ok:
        raise ContractError(reason)


def finite_number(value, reason, low=None, high=None, low_open=False):
    require(type(value) in (int, float) and math.isfinite(value), reason)
    if low is not None:
        require(value > low if low_open else value >= low, reason)
    if high is not None:
        require(value <= high, reason)
    return float(value)


def canonical_sha(value):
    raw = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def load_policy(snapshots: Snapshots):
    raw = snapshots.bytes(POLICY, POLICY_SHA)
    # Execute the exact bytes whose hash is in the report.
    value = types.ModuleType("shoe_frozen_text_policy_snapshot")
    value.__file__ = str(POLICY)
    exec(compile(raw, str(POLICY), "exec"), value.__dict__)
    return value, hashlib.sha256(raw).hexdigest()


def evidence(ref, base, snapshots: Snapshots, required_role=None):
    require(isinstance(ref, dict) and ref.get("path") and ref.get("sha256"),
            "EVIDENCE_MISSING: file and SHA required")
    p = Path(ref["path"])
    if not p.is_absolute():
        p = Path(base) / p
    p = p.resolve()
    snapshots.bytes(p, ref["sha256"])
    if required_role:
        require(ref.get("view_role") == required_role, "VIEW_ROLE_MISMATCH: " + required_role)
    return p


def _source_records(sources):
    records = {}
    for item in sources.get("sources", []):
        sid = item.get("source_id") or item.get("asset_id")
        require(isinstance(sid, str) and sid and sid not in records, "SOURCE_ID_MISSING_OR_DUPLICATE")
        require(isinstance(item.get("source_version_id"), str) and item["source_version_id"],
                "SOURCE_VERSION_ID_REQUIRED: " + sid)
        if item.get("high_resolution"):
            require(isinstance(item["high_resolution"].get("source_version_id"), str) and
                    item["high_resolution"]["source_version_id"],
                    "SOURCE_VERSION_ID_REQUIRED: " + sid)
        records[sid] = item
    return records


def bind_anchor(case, base, snapshots: Snapshots):
    path = evidence(case["anchor"], base, snapshots)
    anchor = snapshots.json(path, case["anchor"]["sha256"])
    require(anchor.get("id") == case["anchor_id"], "ANCHOR_ID_MISMATCH")
    require(case.get("instance_id"), "ONE_WORKING_SHOE_INSTANCE_REQUIRED")
    level = anchor.get("identity_level", "exact_model")
    require(level in ("exact_model", "owner_photo_instance"), "IDENTITY_LEVEL_UNRESOLVED")
    if level == "exact_model":
        require(all(anchor.get(k) for k in ("brand", "model", "sku", "color")),
                "EXACT_MODEL_UNRESOLVED: preserve unknown brand spelling; research before binding")
    else:
        require(anchor.get("display_name") and anchor.get("color"), "OWNER_PHOTO_OBJECT_LABEL_REQUIRED")

    source_path = evidence(case["identity_sources"], base, snapshots)
    require(source_path == (path.parent / anchor["source_manifest"]).resolve(), "SOURCE_MANIFEST_MISMATCH")
    sources = snapshots.json(source_path, case["identity_sources"]["sha256"])
    require(all(anchor.get(k) == sources.get(k) for k in ("brand", "model", "sku", "color")),
            "MIXED_MODEL_OR_COLOR")
    if level == "owner_photo_instance":
        require(sources.get("provenance") == "owner_supplied_photos" and
                sources.get("anchor_id") == anchor["id"], "OWNER_PHOTO_SOURCE_BINDING_REQUIRED")

    records = _source_records(sources)
    verified = {}
    for sid, source in records.items():
        versions = [source]
        if source.get("high_resolution"):
            versions.append({**source["high_resolution"], "source_id": sid})
        for version in versions:
            filename = version.get("file")
            digest = version.get("sha256")
            version_id = version.get("source_version_id")
            require(filename and digest, "SOURCE_FILE_BINDING_REQUIRED: " + sid)
            require(isinstance(version_id, str) and version_id,
                    "SOURCE_VERSION_ID_REQUIRED: " + sid)
            img = evidence({"path": filename, "sha256": digest}, source_path.parent, snapshots)
            verified[(sid, version_id, digest)] = {"path": img, "source_id": sid,
                                                   "version_id": version_id, "sha256": digest}

    views = case.get("views", {})
    require(set(views) >= {"side", "outsole", "top"}, "THREE_ROLE_BOUND_VIEWS_REQUIRED")
    used: dict[str, list[str]] = {}
    for role in ("side", "outsole", "top"):
        view = views[role]
        require(isinstance(view, dict) and view.get("view_role") == role, "VIEW_ROLE_MISMATCH: " + role)
        sid = view.get("source_id")
        require(sid in records, "VIEW_SOURCE_ID_UNKNOWN: " + role)
        p = evidence(view, base, snapshots, required_role=role)
        version_id = view.get("source_version_id")
        digest = view.get("sha256")
        require((sid, version_id, digest) in verified,
                "VIEW_OUTSIDE_EXACT_MODEL_SOURCES: " + role)
        require(view.get("source_id") == records[sid].get("source_id", records[sid].get("asset_id")),
                "VIEW_SOURCE_ID_VERSION_MISMATCH: " + role)
        fingerprint = digest.lower()
        if fingerprint in used:
            current_crop = view.get("subview")
            require(isinstance(current_crop, dict) and
                    current_crop.get("kind") == "normalized_crop" and
                    valid_crop(current_crop.get("bounds_uv")),
                    "SAME_IMAGE_MULTIPLE_VIEWS_NEED_DISTINCT_SUBVIEW_EVIDENCE")
            for prior_role in used[fingerprint]:
                prior_crop = views[prior_role].get("subview")
                require(isinstance(prior_crop, dict) and
                        prior_crop.get("kind") == "normalized_crop" and
                        valid_crop(prior_crop.get("bounds_uv")) and
                        current_crop.get("bounds_uv") != prior_crop.get("bounds_uv"),
                        "SAME_IMAGE_MULTIPLE_VIEWS_NEED_DISTINCT_SUBVIEW_EVIDENCE")
            used[fingerprint].append(role)
        else:
            used[fingerprint] = [role]

    require(anchor.get("identity_features"), "SHOE_LANDMARKS_REQUIRED")
    return anchor, records, source_path


def valid_crop(bounds):
    if not isinstance(bounds, list) or len(bounds) != 4:
        return False
    try:
        values = [finite_number(x, "INVALID_SUBVIEW_CROP", 0, 1) for x in bounds]
    except ContractError:
        return False
    return values[0] < values[2] and values[1] < values[3]


def validate_landmarks(case, source_records):
    landmarks = case.get("landmarks")
    require(isinstance(landmarks, dict) and landmarks, "SOURCE_BOUND_LANDMARKS_REQUIRED")
    for landmark_id, item in landmarks.items():
        require(item.get("id") == landmark_id, "LANDMARK_ID_MISMATCH")
        role, sid = item.get("view_role"), item.get("source_id")
        require(role in case["views"] and case["views"][role]["source_id"] == sid and sid in source_records and
                item.get("source_version_id") == case["views"][role].get("source_version_id"),
                "LANDMARK_SOURCE_ROLE_MISMATCH: " + landmark_id)
        uv = item.get("uv")
        require(isinstance(uv, list) and len(uv) == 2, "LANDMARK_UV_REQUIRED: " + landmark_id)
        for coord in uv:
            finite_number(coord, "LANDMARK_UV_OUT_OF_RANGE", 0, 1)
        require(isinstance(item.get("label_en"), str) and item["label_en"].strip(),
                "LANDMARK_LABEL_REQUIRED: " + landmark_id)


def validate_zone(zone_id, zone, anchor):
    require(zone.get("component") in anchor.get("material_zones", {}), "COMPONENT_UNBOUND")
    material = zone.get("material")
    require(isinstance(material, str) and material.lower() not in ("unknown", "tbd", "unconfirmed"),
            "MATERIAL_UNRESOLVED")
    require(material == anchor["material_zones"][zone["component"]]["material"], "MATERIAL_ZONE_MISMATCH")
    require(isinstance(zone.get("label_en"), str) and zone["label_en"].strip(), "ZONE_LABEL_REQUIRED")
    bounds = zone.get("bounds_uv")
    require(isinstance(bounds, list) and len(bounds) == 4, "INVALID_ZONE_BOUNDS")
    for n in bounds:
        finite_number(n, "INVALID_ZONE_BOUNDS", 0, 1)
    require(bounds[0] < bounds[2] and bounds[1] < bounds[3], "INVALID_ZONE_BOUNDS")
    endpoints = zone.get("stroke_landmarks")
    require(isinstance(endpoints, list) and len(endpoints) == 2 and endpoints[0] != endpoints[1],
            "ZONE_ENDPOINT_LANDMARKS_REQUIRED")
    require(all(isinstance(x, str) and x for x in endpoints), "ZONE_ENDPOINT_LANDMARKS_REQUIRED")
    return bounds


def state_rules(stage, start, end, profile):
    allowed = {"wetness", "soil", "foam", "wear_id", "soil_appearance_id"}
    for state in (start, end):
        require(isinstance(state, dict) and set(state) <= allowed, "FREEFORM_STATE_TEXT_FORBIDDEN")
        require(state.get("wetness") in ("dry", "damp", "wet"), "WETNESS_UNKNOWN")
        require(state.get("soil") in ("embedded", "suspended", "residual", "removed"), "SOIL_STATE_UNKNOWN")
        require(state.get("foam") in ("absent", "clear", "dirty"), "FOAM_STATE_UNKNOWN")
        require(isinstance(state.get("wear_id"), str) and state["wear_id"], "WEAR_REFERENCE_REQUIRED")
        if state["soil"] != "removed":
            require(isinstance(state.get("soil_appearance_id"), str) and state["soil_appearance_id"],
                    "SOIL_APPEARANCE_REFERENCE_REQUIRED")
    require(start["wear_id"] == end["wear_id"], "WEAR_CANNOT_BE_WASHED_AWAY")
    transition = profile.get("state_transition")
    if stage == "prepare":
        require(start["soil"] == end["soil"] and start["wear_id"] == end["wear_id"],
                "PREPARATION_CANNOT_COMPLETE_CLEANING")
        require(end["foam"] in ("absent", "clear"), "PREPARATION_CANNOT_CREATE_DIRTY_LATHER")
    elif stage == "wet_clean":
        require(start["soil"] in ("embedded", "suspended", "residual") and start["wetness"] != "dry",
                "WET_CLEAN_REQUIRES_VISIBLE_SOIL_AND_ESTABLISHED_WET_CONTACT")
        require(transition in ("soil_to_dirty_lather", "preserve_wet_soil"), "METHOD_STATE_TRANSITION_UNBOUND")
        if transition == "soil_to_dirty_lather":
            require(end["soil"] == "suspended" and end["foam"] == "dirty" and end["wetness"] == "wet",
                    "PROFILE_REQUIRES_SOIL_IN_DIRTY_LATHER")
        else:
            require(end["wetness"] == "wet", "PRESERVE_WET_SOIL_REQUIRES_WET_END_STATE")
            require(end["soil"] == start["soil"] and
                    end.get("soil_appearance_id") == start.get("soil_appearance_id"),
                    "PRESERVE_WET_SOIL_CANNOT_CLAIM_SOIL_TRANSITION")
    elif stage == "dry_clean":
        require(start["wetness"] == end["wetness"] == "dry" and
                start["foam"] == end["foam"] == "absent", "DRY_METHOD_CANNOT_INHERIT_WET_FOAM")
        require(transition == "dry_surface_to_residual" and end["soil"] in ("residual", "embedded"),
                "DRY_METHOD_TRANSITION_UNBOUND")
    elif stage == "residue":
        accepted = profile.get("accepts_start_foam")
        require(accepted and start["foam"] in accepted, "RESIDUE_START_STATE_UNBOUND")
        require(end["foam"] == "absent" and end["wetness"] in ("wet", "damp"),
                "RESIDUE_REMOVAL_IS_NOT_INSTANT_DRYING")
        require(end["soil"] in ("embedded", "residual", "suspended"), "RESIDUE_STATE_UNBOUND")
    elif stage == "dry":
        require(start["wetness"] != "dry" and start["foam"] == end["foam"] == "absent" and
                start["soil"] == end["soil"] and start["wear_id"] == end["wear_id"] and
                start["soil_appearance_id"] == end["soil_appearance_id"],
                "DRYING_SETUP_IS_NOT_INSTANT_DRYING")
        require(start["wetness"] == end["wetness"], "DRYING_SETUP_CANNOT_CLAIM_COMPLETION")
    elif stage == "result":
        require(start == end and end["wetness"] == "dry" and end["foam"] == "absent",
                "RESULT_REQUIRES_STABLE_DRY_STATE")


def validate_motion(shot, profile, zone, landmarks, library):
    motion = shot["motion"]
    require(not (set(motion) & LEGACY_PROMPT_FIELDS), "STRUCTURED_MOTION_FIELDS_ONLY")
    require(motion.get("kind") == profile["motion_kind"], "WRONG_MOTION_FAMILY")
    require(motion.get("basis") in ("owner_design_target", "observed_reference"), "MOTION_BASIS_REQUIRED")
    tool_id = shot.get("tool_id")
    tool = library.get("tools", {}).get(tool_id)
    require(tool is not None and tool.get("kind") == profile.get("tool_kind"), "TOOL_REGISTRY_OR_FAMILY_MISMATCH")
    hands = shot.get("hands")
    require(isinstance(hands, dict), "STRUCTURED_HANDS_REQUIRED")
    if motion["kind"] == "linear_reciprocal":
        require(set(hands) == {"working", "supporting"}, "TWO_DISTINCT_HAND_ROLES_REQUIRED")
        path = motion.get("path_uv")
        footprint = motion.get("contact_size_uv")
        require(isinstance(path, list) and len(path) == 3 and path[0] == path[2] and path[0] != path[1],
                "COMPLETE_A_B_A_CYCLE_REQUIRED")
        require(type(motion.get("cycle_count")) is int and motion["cycle_count"] == 1,
                "EXACTLY_ONE_CYCLE_REQUIRED")
        require(motion.get("direction") == "outbound_then_same_track_return", "RECIPROCAL_DIRECTION_REQUIRED")
        secs = finite_number(motion.get("cycle_seconds"), "INVALID_CYCLE_SECONDS", 0, shot["duration_seconds"], True)
        bounds = zone["bounds_uv"]
        require(isinstance(footprint, list) and len(footprint) == 2, "BRUSH_CONTACT_SIZE_REQUIRED")
        for size in footprint:
            finite_number(size, "BRUSH_CONTACT_SIZE_REQUIRED", 0, 1, True)
        for point in path:
            require(isinstance(point, list) and len(point) == 2, "INVALID_STROKE_POINT")
            for coord in point:
                finite_number(coord, "INVALID_STROKE_POINT", 0, 1)
            require(all(bounds[d] + footprint[d] / 2 <= point[d] <= bounds[d + 2] - footprint[d] / 2
                        for d in (0, 1)), "BRUSH_FOOTPRINT_OUTSIDE_WORK_ZONE")
        start_id, end_id = motion.get("start_landmark_id"), motion.get("end_landmark_id")
        expected_ids = zone["stroke_landmarks"]
        require([start_id, end_id] == expected_ids, "STROKE_LANDMARKS_DO_NOT_MATCH_ZONE")
        for point, landmark_id in ((path[0], start_id), (path[1], end_id)):
            expected = landmarks[landmark_id]["uv"]
            require(all(abs(point[d] - expected[d]) < 1e-6 for d in (0, 1)),
                    "STROKE_PATH_DIFFERS_FROM_BOUND_LANDMARK")
        delta = [abs(path[1][d] - path[0][d]) for d in (0, 1)]
        axis = 0 if delta[0] >= delta[1] else 1
        require(delta[1-axis] < 1e-6, "SINGLE_SHOE_RELATIVE_AXIS_REQUIRED")
        require(delta[axis] >= footprint[axis], "BROAD_TRAVEL_REQUIRED_NOT_TINY_POLISHING")
        require(tool.get("scale") == "palm_sized" and tool.get("form") == "rectangular_block" and
                tool.get("contact_face") == "continuous_bristle_face", "PALM_BLOCK_TOOL_REQUIRED")
        require(set(hands) == {"working", "supporting"}, "TWO_DISTINCT_HAND_ROLES_REQUIRED")
        require(hands.get("working", {}).get("grip") == tool.get("grip") == "full_overhand" and
                hands.get("working", {}).get("grip_point") == tool.get("grip_point") and
                hands.get("supporting", {}).get("support_point") in library.get("support_points", {}),
                "STRUCTURED_GRIP_AND_SUPPORT_REQUIRED")
        require(math.isfinite(secs), "INVALID_CYCLE_SECONDS")
    elif motion["kind"] == "local_circle":
        center, radius, footprint = motion.get("center_uv"), motion.get("radius_uv"), motion.get("contact_size_uv")
        require(isinstance(center, list) and len(center) == 2 and isinstance(radius, list) and len(radius) == 2,
                "LOCAL_PATCH_GEOMETRY_REQUIRED")
        require(isinstance(footprint, list) and len(footprint) == 2, "LOCAL_TOOL_CONTACT_SIZE_REQUIRED")
        bounds = zone["bounds_uv"]
        for d in (0, 1):
            finite_number(center[d], "LOCAL_PATCH_GEOMETRY_REQUIRED", 0, 1)
            finite_number(radius[d], "LOCAL_PATCH_GEOMETRY_REQUIRED", 0, 1, True)
            finite_number(footprint[d], "LOCAL_TOOL_CONTACT_SIZE_REQUIRED", 0, 1, True)
            require(bounds[d] <= center[d] - radius[d] - footprint[d] / 2 and
                    center[d] + radius[d] + footprint[d] / 2 <= bounds[d + 2],
                    "CIRCLE_OUTSIDE_LOCAL_PATCH")
        require(set(hands) == {"working", "supporting"}, "TWO_DISTINCT_HAND_ROLES_REQUIRED")
    elif motion["kind"] == "powered_roller_contact":
        require(set(hands) == {"working", "supporting"} and
                all(hands[k].get("role") == "supporting" for k in hands),
                "MACHINE_REQUIRES_TWO_SUPPORT_HANDS")
        require(motion.get("moving_actor") == "roller" and motion.get("shoe_spins") is False,
                "ROLLER_ROTATES_SHOE_IS_SUPPORTED")
        equipment_id = shot.get("equipment_id")
        equipment = library.get("equipment", {}).get(equipment_id)
        require(equipment is not None, "STORE_EQUIPMENT_ANCHOR_REQUIRED")
        required = ("roller_id", "working_arc", "contact_arc", "rotation_direction",
                    "feed_point_id", "support_point_id", "angle_frame_en",
                    "rotation_observation_en", "contact_observation_en", "feed_observation_en")
        require(all(equipment.get(k) for k in required), "POWERED_ROLLER_GEOMETRY_INCOMPLETE")
        require(isinstance(equipment["roller_id"], str) and
                isinstance(equipment["feed_point_id"], str) and
                isinstance(equipment["support_point_id"], str), "POWERED_ROLLER_GEOMETRY_INCOMPLETE")
        require(equipment["rotation_direction"] in ("clockwise", "counterclockwise"),
                "POWERED_ROLLER_GEOMETRY_INCOMPLETE")
        for key in ("angle_frame_en", "rotation_observation_en", "contact_observation_en", "feed_observation_en"):
            _concrete_phrase(equipment[key], "POWERED_ROLLER_GEOMETRY_INCOMPLETE")
        require(equipment.get("source_ref"), "POWERED_ROLLER_SOURCE_REQUIRED")
        for arc_key in ("working_arc", "contact_arc"):
            arc = equipment[arc_key]
            require(isinstance(arc, dict) and set(arc) == {"start_deg", "end_deg"},
                    "POWERED_ROLLER_GEOMETRY_INCOMPLETE")
            start = finite_number(arc["start_deg"], "POWERED_ROLLER_GEOMETRY_INCOMPLETE", -360, 360)
            end = finite_number(arc["end_deg"], "POWERED_ROLLER_GEOMETRY_INCOMPLETE", -360, 360)
            require(start != end, "POWERED_ROLLER_GEOMETRY_INCOMPLETE")
        for point_key, point_id_key in (("feed_point", "feed_point_id"),
                                        ("support_point", "support_point_id")):
            point = equipment.get(point_key)
            require(isinstance(point, dict) and point.get("id") == equipment[point_id_key] and
                    isinstance(point.get("uv"), list) and len(point["uv"]) == 2,
                    "POWERED_ROLLER_GEOMETRY_INCOMPLETE")
            for coord in point["uv"]:
                finite_number(coord, "POWERED_ROLLER_GEOMETRY_INCOMPLETE", 0, 1)
        require(hands["working"].get("support_point") == equipment["feed_point_id"] and
                hands["supporting"].get("support_point") == equipment["support_point_id"],
                "POWERED_ROLLER_HAND_POINTS_UNBOUND")
        require(equipment.get("source_ref"), "POWERED_ROLLER_SOURCE_REQUIRED")
        require(equipment["working_arc"] != equipment["contact_arc"], "POWERED_ROLLER_ARC_BINDING_INVALID")
    elif motion["kind"] != "source_bound_action":
        raise ContractError("UNKNOWN_MOTION_KIND")
    return tool


def _state_prompt(state, case):
    soil_appearance = ""
    if state["soil"] != "removed":
        soil_appearance = case["soil_appearances"][state["soil_appearance_id"]]
    wear = case.get("wear_marks", {}).get(state["wear_id"])
    require(isinstance(wear, dict) and wear.get("label_en"), "WEAR_APPEARANCE_REFERENCE_REQUIRED")
    wet = {"dry": "dry", "damp": "damp with a visible moisture film", "wet": "wet with surface water"}[state["wetness"]]
    soil = {
        "embedded": "embedded soil remains in the material texture",
        "suspended": "loosened soil is suspended in the liquid",
        "residual": "residual soil remains on the treated surface",
        "removed": "the recorded visible soil has been removed",
    }[state["soil"]]
    foam = {"absent": "foam is absent", "clear": "clear foam is visible",
            "dirty": "cloudy soil-bearing foam is visible"}[state["foam"]]
    return f"Surface state: {wet}; {soil_appearance}; {soil}; {foam}; existing wear mark remains visible: {wear['label_en']}."


_PLACEHOLDER_RE = re.compile(r"\b(?:source[_ -]?bound|source[_ -]?confirmed|tbd|todo|unresolved|placeholder|fill[_ -]?me)\b", re.I)


def _concrete_phrase(value, reason):
    require(isinstance(value, str) and len(value.strip()) >= 12 and not _PLACEHOLDER_RE.search(value), reason)
    return value.strip()


def _render_composition(template, zone):
    require(isinstance(template, str) and "{zone_label}" in template,
            "ZONE_AWARE_COMPOSITION_TEMPLATE_REQUIRED")
    rendered = template.format(zone_label=zone["label_en"], material=zone["material"],
                               component=zone["component"])
    require("{" not in rendered and "}" not in rendered, "UNRESOLVED_COMPOSITION_TOKEN")
    return rendered


def _method_procedure(binding, shot_id):
    procedure = binding.get("procedure") if isinstance(binding, dict) else None
    require(isinstance(procedure, dict), "CONCRETE_METHOD_PROCEDURE_REQUIRED: " + shot_id)
    return {key: _concrete_phrase(procedure.get(key), "CONCRETE_METHOD_PROCEDURE_REQUIRED: " + shot_id)
            for key in ("tool_en", "grip_en", "action_en", "visible_effect_en")}


def compile_shot(case, anchor, shot, profile, landmarks, library, policy, method_binding=None):
    zone = case["zones"][shot["zone"]]
    start, end, motion = shot["start"], shot["end"], shot["motion"]
    tool = library["tools"][shot["tool_id"]]
    identity = (f"{anchor['brand']} {anchor['model']} {anchor['sku']}"
                if anchor.get("identity_level", "exact_model") == "exact_model" else anchor["display_name"])
    landmark_labels = [landmarks[x]["label_en"] for x in zone["stroke_landmarks"]]
    composition_template = library["compositions"].get(shot.get("composition_id"))
    orientation = library["orientations"].get(shot.get("orientation_id"))
    require(composition_template and orientation, "COMPOSITION_ORIENTATION_UNBOUND")
    composition = _render_composition(composition_template, zone)
    procedure = None
    if profile["stage"] in ("prepare", "dry_clean", "residue", "dry") or motion["kind"] == "local_circle":
        procedure = _method_procedure(method_binding, shot["id"])
    if motion["kind"] == "powered_roller_contact":
        equipment = library["equipment"][shot["equipment_id"]]
        machine_description = (f"Machine: fixed {tool['form']} with a {tool['contact_face']}; "
                               f"equipment anchor {equipment['roller_id']}; rotation {equipment['rotation_direction']}; "
                               f"working arc {equipment['working_arc']['start_deg']:g} to "
                               f"{equipment['working_arc']['end_deg']:g} degrees and contact arc "
                               f"{equipment['contact_arc']['start_deg']:g} to "
                               f"{equipment['contact_arc']['end_deg']:g} degrees, measured {equipment['angle_frame_en']}. "
                               f"Observed rotation: {equipment['rotation_observation_en']} "
                               f"Observed loaded contact: {equipment['contact_observation_en']} "
                               f"Observed shoe feed: {equipment['feed_observation_en']}. ")
        hand_description = (
            f"Both hands stabilize and feed the shoe: leading hand at registered feed point "
            f"{equipment['feed_point_id']} with view coordinate {equipment['feed_point']['uv']}; "
            f"supporting hand braces at registered point {equipment['support_point_id']} "
            f"with view coordinate {equipment['support_point']['uv']}. "
        )
    else:
        if profile["stage"] == "result":
            machine_description = ""
            hand_description = ""
        elif procedure is None:
            machine_description = (f"Tool: {tool['scale']} {tool['form']} with {tool['contact_face']}. ")
            hand_description = (
                f"The working hand holds the tool in a {tool['grip']} grip at {tool['grip_point']}; "
                f"{library['support_points'][shot['hands']['supporting']['support_point']]}. "
            )
        else:
            machine_description = f"Method tool: {procedure['tool_en']}. "
            hand_description = f"Hand placement: {procedure['grip_en']}. "
    still = (
        f"{case['capture_en']} One {identity} in {anchor['color']}. Preserve the attached source shoe geometry "
        f"and these identity features: {'; '.join(anchor['identity_features'][i] for i in shot['visible_identity_features'])}. "
        f"Working area: {landmark_labels[0]} through {landmark_labels[1]} inside {zone['label_en']} "
        f"({zone['component']} made of {zone['material']}). "
        f"{composition} Shoe orientation: {orientation}. "
        f"{machine_description}{hand_description}"
        f"Initial {_state_prompt(start, case)}"
    )
    if motion["kind"] == "linear_reciprocal":
        a, b = landmark_labels
        action = (
            f"Perform exactly one complete cycle: the working hand drives the single palm-sized block brush "
            f"from {a} to {b}, then returns once along that same shoe-relative path to {a}. "
            f"Reverse only at the two visible endpoints. Complete the out-and-return in about "
            f"{motion['cycle_seconds']:g} seconds. Keep the supporting hand at its bound brace point. "
            f"The continuous bristle face stays compressed against the {zone['material']} through both directions and flexes "
            f"at the turn."
        )
    elif motion["kind"] == "local_circle":
        action = (
            f"{procedure['action_en']} Follow the registered circular path only within {zone['label_en']}. "
            f"Visible contact consequence: {procedure['visible_effect_en']}"
        )
    elif motion["kind"] == "powered_roller_contact":
        action = (
            f"The fixed powered roller turns {library['equipment'][shot['equipment_id']]['rotation_direction']} "
            f"within the measured contact arc; the operator supports the shoe at both registered points and "
            f"feeds only the selected {zone['label_en']} patch into the rotating bristles."
        )
    elif procedure is not None:
        effect_label = "Visible contact consequence" if profile["stage"] == "wet_clean" else "Visible method effect"
        action = f"{procedure['action_en']} {effect_label}: {procedure['visible_effect_en']}"
    else:
        action = {
            "result": "Inspect the same shoe instance and treated patch at the bound comparison view.",
        }.get(shot["action"])
        require(action is not None, "ACTION_RENDER_TEMPLATE_MISSING")
    transition_text = {
        "soil_to_dirty_lather": "Loosened soil moves from the contacted grooves into cloudy lather while visible residue remains.",
        "preserve_wet_soil": "This method test records the same wet working patch before and after the stroke, with embedded soil retained in the grooves.",
        "dry_surface_to_residual": "The source-bound dry method releases visible soil while preserving remaining marks.",
    }.get(profile.get("state_transition"), "")
    if profile["stage"] == "prepare":
        motion_text = f"{action} End state: {_state_prompt(end, case)}"
    elif profile["stage"] == "wet_clean":
        motion_text = f"{action} {transition_text} End state: {_state_prompt(end, case)}"
    elif profile["stage"] == "residue":
        motion_text = f"{action} Keep the same shoe zone in view. End state: {_state_prompt(end, case)}"
    elif profile["stage"] == "dry":
        motion_text = f"{action} Placement only; the shoe remains damp at the cut. End state remains: {_state_prompt(end, case)}"
    elif profile["stage"] == "dry_clean":
        motion_text = f"{action} End state: {_state_prompt(end, case)}"
    elif profile["stage"] == "result":
        mode = shot.get("comparison", {}).get("mode")
        comparison_claim = ("Matched-condition same-zone inspection." if mode == "same_condition_efficacy" else
                            "Narrative transition; capture conditions differ; efficacy remains unassessed.")
        motion_text = (f"Inspect the same treated patch and recorded wear at the captured comparison view. "
                       f"{comparison_claim} End state: {_state_prompt(end, case)}")
    else:
        motion_text = f"{action} {transition_text} End state: {_state_prompt(end, case)}"
    motion_prompt = motion_text + " Camera is not moving."
    for name, prompt in (("still_prompt", still), ("motion_prompt", motion_prompt)):
        require(not policy.violations(name, prompt), "SOURCE_GUARD_FAILED: " + name)
    return {"still_prompt": still, "motion_prompt": motion_prompt}


def compile_case(case_path: str | Path, snapshot_hook: Callable | None = None):
    case_path = Path(case_path).resolve()
    snapshots = Snapshots()
    case = snapshots.json(case_path)
    lib = snapshots.json(LIBRARY)
    require(case.get("schema_version") == SCHEMA_VERSION, "UNKNOWN_SCHEMA")
    require(case.get("mode") in ("synthetic_action_test", "store_process_film"), "MODE_REQUIRED")
    require(isinstance(case.get("capture_en"), str) and case["capture_en"], "CAPTURE_PROFILE_REQUIRED")
    anchor, source_records, source_manifest_path = bind_anchor(case, case_path.parent, snapshots)
    validate_landmarks(case, source_records)
    policy, policy_sha = load_policy(snapshots)
    require(case.get("shots"), "SHOT_PLAN_REQUIRED")
    require(case["mode"] != "synthetic_action_test" or len(case["shots"]) == 1,
            "ACTION_TEST_IS_ONE_SHOT_NOT_A_FULL_FILM")
    require(COMPILER_PATH.read_bytes() == COMPILER_BYTES_AT_IMPORT, "COMPILER_DRIFT_FROM_LOADED_VERSION")
    ids, routes, stages, previous, outputs = set(), set(), [], None, {}
    require(isinstance(case.get("zones"), dict), "ZONES_REQUIRED")
    for zone_id, zone in case["zones"].items():
        validate_zone(zone_id, zone, anchor)
        for landmark_id in zone["stroke_landmarks"]:
            require(landmark_id in case["landmarks"], "ZONE_LANDMARK_MISSING")
            uv = case["landmarks"][landmark_id]["uv"]
            bounds = zone["bounds_uv"]
            require(bounds[0] <= uv[0] <= bounds[2] and bounds[1] <= uv[1] <= bounds[3],
                    "ZONE_LANDMARK_OUTSIDE_BOUNDS")
    for shot in case["shots"]:
        require(isinstance(shot.get("id"), str) and shot["id"] not in ids, "DUPLICATE_SHOT_ID")
        ids.add(shot["id"])
        require("first_frame" not in shot and "hand_roles" not in shot,
                "LEGACY_FREEFORM_STILL_OR_HAND_FIELDS_FORBIDDEN")
        require(shot.get("instance_id") == case["instance_id"], "WORKING_SHOE_SWAPPED")
        require(shot.get("zone") in case["zones"], "WORK_ZONE_UNBOUND")
        zone = case["zones"][shot["zone"]]
        profile = lib["profiles"].get(shot.get("action"))
        require(profile is not None, "ACTION_PROFILE_UNKNOWN")
        require(type(shot.get("duration_seconds")) is int and shot["duration_seconds"] == 4,
                "EXISTING_ROUTE_IS_FOUR_SECONDS_ONLY")
        binding = None
        if profile["stage"] != "result":
            binding = case.get("method_bindings", {}).get(shot.get("method_binding"))
            require(isinstance(binding, dict), "METHOD_BINDING_REQUIRED")
            require(binding.get("anchor_id") == anchor["id"] and binding.get("zone") == shot["zone"] and
                    binding.get("material") == zone["material"] and binding.get("action") == shot["action"],
                    "METHOD_NOT_BOUND_TO_THIS_SHOE_ZONE_AND_MATERIAL")
            require(binding.get("status") in ("owner_directed_candidate", "store_confirmed"),
                    "METHOD_SOURCE_UNCONFIRMED")
            evidence(binding["source"], case_path.parent, snapshots)
            if case["mode"] == "store_process_film":
                require(binding["status"] == "store_confirmed", "STORE_METHOD_NOT_CONFIRMED")
            require(binding.get("tool_id") == shot.get("tool_id"), "TOOL_BINDING_MISMATCH")
            require(binding.get("tool_kind") == profile.get("tool_kind"), "TOOL_FAMILY_MISMATCH")
        if shot.get("motion", {}).get("basis") == "observed_reference":
            evidence(shot["motion"]["reference"], case_path.parent, snapshots)
            start_s = finite_number(shot["motion"].get("reference_start_s"), "REFERENCE_INTERVAL_REQUIRED", 0)
            end_s = finite_number(shot["motion"].get("reference_end_s"), "REFERENCE_INTERVAL_REQUIRED", 0, low_open=True)
            require(end_s > start_s, "REFERENCE_INTERVAL_REQUIRED")
            if shot["motion"]["kind"] == "linear_reciprocal":
                require(abs(end_s - start_s - shot["motion"]["cycle_seconds"]) < 0.05,
                        "MEASURED_CYCLE_DIFFERS_FROM_REFERENCE_INTERVAL")
        if profile["motion_kind"] == "powered_roller_contact":
            equipment = lib.get("equipment", {}).get(shot.get("equipment_id"), {})
            require(equipment, "STORE_EQUIPMENT_ANCHOR_REQUIRED")
            equipment_path = evidence(equipment["source_ref"], case_path.parent, snapshots)
            equipment_source = snapshots.json(equipment_path, equipment["source_ref"]["sha256"])
            for key in ("roller_id", "working_arc", "contact_arc", "rotation_direction",
                        "feed_point_id", "support_point_id", "feed_point", "support_point",
                        "angle_frame_en", "rotation_observation_en", "contact_observation_en",
                        "feed_observation_en"):
                require(equipment_source.get(key) == equipment.get(key),
                        "POWERED_ROLLER_SOURCE_BINDING_MISMATCH")
        state_rules(profile["stage"], shot["start"], shot["end"], profile)
        tool = validate_motion(shot, profile, zone, case["landmarks"], lib)
        if previous:
            require(previous["zone"] == shot["zone"], "TREATED_ZONE_CHANGED")
            if previous["end"] != shot["start"]:
                gap = shot.get("time_transition", {})
                require(gap.get("type") == "elapsed_drying" and stages[-1] == "dry" and
                        profile["stage"] == "result" and gap.get("caption_id"), "STATE_JUMP_BETWEEN_SHOTS")
                evidence(gap["source"], case_path.parent, snapshots)
                require(previous["end"]["wetness"] != "dry" and shot["start"]["wetness"] == "dry" and
                        all(previous["end"][k] == shot["start"][k] for k in ("soil", "foam", "wear_id",
                                                                                "soil_appearance_id")),
                        "TIME_ELLIPSIS_CANNOT_CLEAN_OR_CHANGE_SHOE")
            routes.add(profile.get("family")) if profile["stage"] in ("wet_clean", "dry_clean") else None
        if profile["stage"] == "result":
            validate_comparison(shot, case, zone, case_path.parent, snapshots)
        indices = shot.get("visible_identity_features")
        require(isinstance(indices, list) and indices and all(type(i) is int and
                0 <= i < len(anchor["identity_features"]) for i in indices),
                "VISIBLE_IDENTITY_LANDMARKS_REQUIRED")
        require(shot.get("tool_id") in lib.get("tools", {}), "TOOL_REGISTRY_OR_FAMILY_MISMATCH")
        require(shot.get("orientation_id") in lib.get("orientations", {}) and
                shot.get("composition_id") in lib.get("compositions", {}), "COMPOSITION_ORIENTATION_UNBOUND")
        outputs[shot["id"]] = compile_shot(case, anchor, shot, profile, case["landmarks"], lib, policy, binding)
        stages.append(profile["stage"])
        previous = shot
    require(len(routes) <= 1, "DO_NOT_STACK_HAND_MACHINE_AND_LOCAL_ROUTES")
    if case["mode"] == "store_process_film":
        require(stages[0] == "prepare" and stages[-1] == "result", "PROCESS_REQUIRES_PREPARATION_AND_RESULT")
        require(any(s in stages for s in ("wet_clean", "dry_clean")), "CLEANING_ACTION_MISSING")
        require(stages.count("result") == 1, "RESULT_ONLY_AT_END")
        rank = {"prepare": 0, "wet_clean": 1, "dry_clean": 1, "residue": 2, "dry": 3, "result": 4}
        require([rank[s] for s in stages] == sorted(rank[s] for s in stages), "PROCESS_STAGE_ORDER_WRONG")
        for i, stage in enumerate(stages):
            if stage == "wet_clean":
                require("residue" in stages[i + 1:] and "dry" in stages[i + 1:],
                        "WET_ROUTE_NEEDS_RESIDUE_AND_DRYING")
            if stage == "dry":
                require("residue" in stages[:i], "DRYING_BEFORE_RESIDUE_REMOVAL")

    if snapshot_hook:
        snapshot_hook(snapshots)
    snapshots.stable()
    require(COMPILER_PATH.read_bytes() == COMPILER_BYTES_AT_IMPORT, "COMPILER_DRIFT_DURING_COMPILE")
    source_bundle = sorted(
        ({"path": path, "sha256": hashlib.sha256(raw).hexdigest()} for path, raw in snapshots._raw.items()),
        key=lambda x: x["path"],
    )
    source_bundle_sha = canonical_sha(source_bundle)
    case_sha = snapshots.sha256(case_path)
    library_sha = snapshots.sha256(LIBRARY)
    prompts, content_digests = {}, {}
    for shot_id, pair in outputs.items():
        payload = {
            "case_id": case["case_id"], "shot_id": shot_id, "case_sha256": case_sha,
            "library_sha256": library_sha, "compiler_sha256": COMPILER_SHA_AT_IMPORT,
            "policy_sha256": policy_sha, "source_bundle_sha256": source_bundle_sha,
            "still_prompt_sha256": hashlib.sha256(pair["still_prompt"].encode()).hexdigest(),
            "motion_prompt_sha256": hashlib.sha256(pair["motion_prompt"].encode()).hexdigest(),
        }
        content_digests[shot_id] = canonical_sha(payload)
        prompts[shot_id] = {**pair, "content_digest": content_digests[shot_id], **payload}
    return {
        "schema_version": SCHEMA_VERSION, "status": "DECLARATIONS_VALID_SEMANTIC_REVIEW_REQUIRED",
        "case_path": str(case_path), "case_id": case["case_id"], "case_sha256": case_sha,
        "library_path": str(LIBRARY.resolve()), "library_sha256": library_sha,
        "compiler_sha256": COMPILER_SHA_AT_IMPORT, "policy_sha256": policy_sha,
        "source_bundle_sha256": source_bundle_sha, "source_bundle": source_bundle,
        "source_paths": sorted({str(case_path), str(LIBRARY.resolve()), str(COMPILER_PATH), str(POLICY.resolve()),
                                 *[x["path"] for x in source_bundle]}),
        "anchor_id": anchor["id"], "instance_id": case["instance_id"],
        "prompts": prompts, "content_digests": content_digests,
        "semantic_review_required": True, "generation_authorization": "NOT_EVALUATED_BY_THIS_TOOL",
        "visual_quality_accepted": False,
        "runtime_scope": "new shoe_workflow entry only; legacy runners unchanged",
        "limitations": ["Coordinates are QA/design targets, not provider trajectory control.",
                        "Source bindings check provenance, not professional material eligibility.",
                        "Receipts are declared attestations, not cryptographic reviewer identity.",
                        "First-frame review and raw-speed video/frame review remain separate."]
    }


def validate_comparison(shot, case, zone, base, snapshots):
    comparison = shot.get("comparison")
    require(isinstance(comparison, dict), "COMPARISON_ASSET_BINDINGS_REQUIRED")
    require(comparison.get("mode") in ("same_condition_efficacy", "narrative_transition"),
            "COMPARISON_MODE_REQUIRED")
    assets = case.get("comparison_assets", {})
    before = assets.get(comparison.get("before_asset_id"))
    after = assets.get(comparison.get("after_asset_id"))
    require(isinstance(before, dict) and isinstance(after, dict), "COMPARISON_ASSET_BINDINGS_REQUIRED")
    for asset in (before, after):
        require(asset.get("view_role") == "outsole", "COMPARISON_VIEW_ROLE_REQUIRED")
        require(isinstance(asset.get("source_id"), str) and asset["source_id"] and
                asset.get("provenance") in ("owner_supplied_capture", "staff_captured",
                                             "synthetic_test_fixture"),
                "COMPARISON_ASSET_PROVENANCE_REQUIRED")
        require(asset.get("instance_id") == case["instance_id"] and asset.get("zone_id") == shot["zone"],
                "COMPARISON_ASSET_IDENTITY_OR_ZONE_MISMATCH")
        for key in ("pose_id", "light_id"):
            require(isinstance(asset.get(key), str) and asset[key],
                    "COMPARISON_CAPTURE_CONDITIONS_REQUIRED: " + key)
        if case.get("mode") == "store_process_film":
            require(asset["provenance"] in ("owner_supplied_capture", "staff_captured"),
                    "PRODUCTION_COMPARISON_NEEDS_CAPTURE_SOURCE")
        evidence(asset["image"], base, snapshots, "outsole")
        require(isinstance(asset.get("state"), dict) and asset.get("state_id") == canonical_sha(asset["state"]),
                "COMPARISON_STATE_REFERENCE_REQUIRED")
    require(before["state_id"] == comparison.get("before_state_id") and
            after["state_id"] == comparison.get("after_state_id"), "COMPARISON_STATE_BINDING_MISMATCH")
    require(before["image"]["sha256"] != after["image"]["sha256"], "COMPARISON_MUST_BIND_DISTINCT_STATE_ASSETS")
    require(after["state"] == shot["start"], "COMPARISON_AFTER_STATE_MISMATCH")
    require(before["state"] != after["state"], "COMPARISON_STATE_MUST_CHANGE")
    require(before["state"] == case["shots"][0]["start"], "COMPARISON_BEFORE_STATE_MISMATCH")
    require(before["instance_id"] == after["instance_id"] == case["instance_id"], "COMPARISON_SHOE_SWAPPED")
    require(before["zone_id"] == after["zone_id"] == shot["zone"], "RESULT_NOT_SAME_TREATED_ZONE")
    if comparison["mode"] == "same_condition_efficacy":
        for key in ("pose_id", "light_id"):
            require(before[key] == after[key], "COMPARISON_CAPTURE_CONDITIONS_DIFFER: " + key)
        require(before["state"].get("wetness") == after["state"].get("wetness"),
                "SAME_CONDITION_COMPARISON_WETNESS_MISMATCH")


def validate_receipt(receipt, report, shot_id, mode, producer_id, kind):
    require(isinstance(receipt, dict), kind.upper() + "_RECEIPT_REQUIRED")
    pair = report["prompts"].get(shot_id)
    require(pair is not None, "SHOT_ID_UNKNOWN")
    binding = {
        "case_id": report["case_id"], "shot_id": shot_id,
        "content_digest": pair["content_digest"],
        "case_sha256": report["case_sha256"], "library_sha256": report["library_sha256"],
        "compiler_sha256": report["compiler_sha256"], "policy_sha256": report["policy_sha256"],
        "source_bundle_sha256": report["source_bundle_sha256"],
        "still_prompt_sha256": pair["still_prompt_sha256"],
        "motion_prompt_sha256": pair["motion_prompt_sha256"],
    }
    for key, expected in binding.items():
        require(receipt.get(key) == expected, kind.upper() + "_RECEIPT_BINDING_MISMATCH: " + key)
    expected_basis = "text_only" if kind == "semantic" else "image_frame"
    require(receipt.get("review_basis") == expected_basis, kind.upper() + "_REVIEW_BASIS_REQUIRED")
    reviewer = receipt.get("reviewer")
    require(isinstance(reviewer, str) and reviewer.strip() and reviewer != producer_id,
            kind.upper() + "_INDEPENDENT_REVIEWER_REQUIRED")
    allowed_roles = ("owner", "independent_reviewer")
    require(receipt.get("reviewer_role") in allowed_roles, kind.upper() + "_REVIEWER_ROLE_REQUIRED")
    expected_status = ("pass_for_synthetic_test" if mode == "synthetic_action_test" else
                       "pass_after_text_review" if kind == "semantic" else "pass_after_visual_frame_review")
    require(receipt.get("status") == expected_status,
            kind.upper() + "_REVIEW_PENDING_OR_FAILED")
    checks = receipt.get("checks", {})
    required = SEMANTIC_CHECKS if kind == "semantic" else FRAME_CHECKS
    require(all(checks.get(key) is True for key in required), kind.upper() + "_CHECKS_INCOMPLETE")
    observations = receipt.get("observations")
    require((isinstance(observations, str) and observations.strip()) or
            (isinstance(observations, list) and observations and all(isinstance(x, str) and x.strip()
                                                                      for x in observations)),
            kind.upper() + "_OBSERVATIONS_REQUIRED")


def init_case(anchor_path, instance_id, output):
    """Create empty intake; it intentionally contains no inherited method or action."""
    anchor_path, output = Path(anchor_path).resolve(), Path(output).resolve()
    require(not output.exists(), "INTAKE_EXISTS_DO_NOT_OVERWRITE")
    snapshots = Snapshots()
    anchor = snapshots.json(anchor_path)
    source = anchor_path.parent / anchor["source_manifest"]
    guard_output_path(output, [anchor_path, source, LIBRARY])
    case = {
        "schema_version": SCHEMA_VERSION, "case_id": instance_id, "mode": "synthetic_action_test",
        "created_by": "Codex", "anchor_id": anchor["id"],
        "anchor": {"path": str(anchor_path), "sha256": snapshots.sha256(anchor_path)},
        "identity_sources": {"path": str(source.resolve()), "sha256": snapshots.sha256(source)},
        "instance_id": instance_id,
        "views": {key: None for key in ("side", "outsole", "top")},
        "capture_en": "", "zones": {}, "landmarks": {}, "soil_appearances": {}, "wear_marks": {},
        "method_bindings": {}, "shots": [], "publication_authorized": False,
        "intake_status": "Bind model views, landmarks, treated region, source-specific method and state receipts."
    }
    write(output, case)
    return {"status": "INTAKE_CREATED_NOT_READY_FOR_GENERATION", "path": str(output)}


def inspect_case(path):
    try:
        return compile_case(path)
    except (ContractError, KeyError, TypeError, ValueError, IndexError, OSError) as exc:
        return {"status": "BLOCKED", "errors": [str(exc)], "generation_authorization": "NOT_EVALUATED_BY_THIS_TOOL",
                "visual_quality_accepted": False}


def _core_manifest_digest(manifest):
    return hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()


def classify_job(root):
    root = Path(root).resolve()
    state_path = root / "intent.json"
    if not state_path.exists():
        suspicious = ("request.json", "submit-response.raw", "writer.lock", "provider-result.json",
                      "download.raw", "final-video.mp4")
        require(not any((root / name).exists() for name in suspicious),
                "INTENT_MISSING_WITH_EXISTING_JOB_ARTIFACTS_RECONCILE")
        return None
    try:
        state = read(state_path)
    except (OSError, ValueError) as exc:
        raise ContractError("INTENT_CORRUPT_RECONCILE_IN_PLACE") from exc
    require(isinstance(state, dict) and state.get("state") in KNOWN_INTENTS, "INTENT_UNKNOWN_STATE_REJECTED")
    require(state.get("provider") == "xai-oauth", "INTENT_PROVIDER_MISMATCH")
    key = state.get("idempotency_key")
    require(isinstance(key, str) and re.fullmatch(
        r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", key),
        "INTENT_IDEMPOTENCY_KEY_INVALID")
    digest = state.get("manifest_sha256")
    require(isinstance(digest, str) and re.fullmatch(r"[a-f0-9]{64}", digest),
            "INTENT_MANIFEST_BINDING_CORRUPT")
    manifest = read(root / "manifest.json")
    require(_core_manifest_digest(manifest) == digest, "INTENT_MANIFEST_BINDING_MISMATCH")
    if state["state"] in ("ACCEPTED", "POLLING", "COMPLETED"):
        require(isinstance(state.get("request_id"), str) and
                re.fullmatch(r"[A-Za-z0-9_-]+", state["request_id"]), "INTENT_REQUEST_ID_INVALID")
    if state["state"] == "PREPARED":
        require(state.get("request_id") in (None, ""), "PREPARED_INTENT_HAS_REQUEST_ID")
        response_path = root / "submit-response.raw"
        if response_path.exists():
            request_path = root / "request.json"
            require(request_path.exists() and _core_manifest_digest(read(request_path)) == digest,
                    "PREPARED_RESPONSE_EVIDENCE_REQUIRES_IN_PLACE_RECONCILIATION")
            try:
                prior = json.loads(response_path.read_bytes().decode("utf-8-sig"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ContractError("PREPARED_RESPONSE_EVIDENCE_REQUIRES_IN_PLACE_RECONCILIATION") from exc
            prior_id = prior.get("request_id") if isinstance(prior, dict) else None
            require(isinstance(prior_id, str) and re.fullmatch(r"[A-Za-z0-9_-]+", prior_id),
                    "PREPARED_RESPONSE_EVIDENCE_REQUIRES_IN_PLACE_RECONCILIATION")
            state["_replay_submit_response"] = True
            state["_replay_request_id"] = prior_id
    if state["state"] in ("SUBMITTING", "ACCEPTED", "POLLING", "COMPLETED"):
        request_path = root / "request.json"
        require(request_path.exists() and _core_manifest_digest(read(request_path)) == digest,
                "INTENT_REQUEST_MANIFEST_MISMATCH")
    if state["state"] in ("ACCEPTED", "POLLING", "COMPLETED"):
        response_path = root / "submit-response.raw"
        require(response_path.exists(), "INTENT_SUBMISSION_RESPONSE_MISSING_RECONCILE")
        try:
            prior = json.loads(response_path.read_bytes().decode("utf-8-sig"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ContractError("INTENT_SUBMISSION_RESPONSE_CORRUPT_RECONCILE") from exc
        prior_id = prior.get("request_id") if isinstance(prior, dict) else None
        require(prior_id == state["request_id"], "INTENT_REQUEST_ID_RESPONSE_MISMATCH")
    return state


def validate_png_file(path, expected_sha):
    path = Path(path).resolve()
    raw = path.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == expected_sha, "FIRST_FRAME_MISMATCH")
    require(len(raw) >= 33 and raw[:8] == b"\x89PNG\r\n\x1a\n" and raw[12:16] == b"IHDR" and
            struct.unpack(">II", raw[16:24]) == (720, 1280), "EXACT_RATIO_720_FIRST_FRAME_REQUIRED")
    probe = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"],
                           capture_output=True, timeout=30)
    require(probe.returncode == 0 and not probe.stderr.strip(), "FIRST_FRAME_DECODE_FAILED")
    require(path.read_bytes() == raw, "FIRST_FRAME_DRIFT_DURING_DECODE")
    return raw


def check_job(root, manifest=None):
    root = Path(root).resolve()
    m = manifest if manifest is not None else read(root / "manifest.json")
    binding = m["shoe_contract"]
    report = compile_case(binding["case_path"])
    case_snapshots = Snapshots()
    case_data = case_snapshots.json(binding["case_path"], binding["case_sha256"])
    require(report["case_sha256"] == binding["case_sha256"], "CASE_CHANGED")
    for field in ("library_sha256", "compiler_sha256", "policy_sha256", "source_bundle_sha256"):
        require(report[field] == binding[field], "CONTENT_BINDING_CHANGED: " + field)
    require(m.get("shoe_anchor_id") == report["anchor_id"] and
            m.get("instance_id") == report["instance_id"], "JOB_ANCHOR_OR_INSTANCE_MISMATCH")
    shot_id = binding["shot_id"]
    pair = report["prompts"].get(shot_id)
    require(pair is not None, "SHOT_ID_UNKNOWN")
    require(m.get("prompt") == pair["motion_prompt"] and
            m.get("still_prompt_sha256") == pair["still_prompt_sha256"] and
            m.get("motion_prompt_sha256") == pair["motion_prompt_sha256"] and
            m.get("content_digest") == pair["content_digest"], "PROMPT_OR_CONTENT_DIFFERS_FROM_BOUND_SHOT")
    require((m.get("provider"), m.get("allow_api_key_fallback"), m.get("resolution"),
             m.get("duration_seconds"), m.get("aspect_ratio")) == ("xai-oauth", False, "720p", 4, "9:16"),
            "ONLY_EXISTING_SUBSCRIPTION_ROUTE_ALLOWED")
    semantic_snapshots = Snapshots()
    semantic_path = evidence(binding["semantic_review"], root, semantic_snapshots)
    semantic = semantic_snapshots.json(semantic_path, binding["semantic_review"]["sha256"])
    validate_receipt(semantic, report, shot_id, case_data["mode"],
                     case_data.get("created_by", "Codex"), "semantic")
    image = (root / m["input_image"]).resolve()
    require(image.is_relative_to(root), "FIRST_FRAME_OUTSIDE_JOB_ROOT")
    validate_png_file(image, m["input_sha256"])
    require(m.get("input_sha256") == binding["first_frame_review"].get("input_sha256"),
            "FIRST_FRAME_REVIEW_IMAGE_BINDING_MISMATCH")
    frame_snapshots = Snapshots()
    frame_receipt_path = evidence(binding["first_frame_review"], root, frame_snapshots)
    frame_receipt = frame_snapshots.json(frame_receipt_path, binding["first_frame_review"]["sha256"])
    validate_receipt(frame_receipt, report, shot_id, case_data["mode"],
                     case_data.get("created_by", "Codex"), "first_frame")
    require(frame_receipt.get("input_sha256") == m["input_sha256"], "FIRST_FRAME_REVIEW_IMAGE_BINDING_MISMATCH")
    experiment = case_data.get("experiment", {})
    if experiment.get("new_first_frame_required"):
        old_path = evidence(experiment["previous_manifest"], Path(binding["case_path"]).parent, Snapshots())
        old = read(old_path)
        require(old.get("generation_id") == experiment.get("previous_generation_id"),
                "PREVIOUS_EXPERIMENT_MISMATCH")
        require(m["input_sha256"] != old.get("input_sha256"),
                "NEW_COMPOSITION_CANNOT_REUSE_FAILED_FIRST_FRAME")
    for snapshots in (case_snapshots, semantic_snapshots, frame_snapshots):
        snapshots.stable()
    return {"status": "PREFLIGHT_VALID_NOT_VISUAL_OR_OWNER_APPROVAL",
            "case_sha256": report["case_sha256"], "input_sha256": m["input_sha256"],
            "content_digest": pair["content_digest"], "visual_quality_accepted": False}


def guard_output_path(output, inputs):
    output = Path(output).resolve()
    for item in inputs:
        if not item:
            continue
        source = Path(item).resolve()
        same = output == source
        if output.exists() and source.exists():
            try:
                same = same or os.path.samefile(output, source)
            except OSError:
                pass
        require(not same, "OUTPUT_ALIASES_INPUT_REFUSED: " + source.name)
    return output


def prepare(case_path, shot_id, image, semantic_receipt, frame_receipt, generation_id, jobs_root=DATA / "jobs"):
    require(re.fullmatch(r"[a-z0-9][a-z0-9-]{2,100}", generation_id), "INVALID_GENERATION_ID")
    report = compile_case(case_path)
    require(shot_id in report["prompts"], "SHOT_ID_UNKNOWN")
    case_snapshots = Snapshots()
    case = case_snapshots.json(case_path, report["case_sha256"])
    semantic_snapshots, frame_snapshots = Snapshots(), Snapshots()
    semantic = semantic_snapshots.json(semantic_receipt)
    frame = frame_snapshots.json(frame_receipt)
    pair = report["prompts"][shot_id]
    validate_receipt(semantic, report, shot_id, case["mode"], case.get("created_by", "Codex"), "semantic")
    input_bytes = Path(image).resolve().read_bytes()
    image_sha = hashlib.sha256(input_bytes).hexdigest()
    require(frame.get("input_sha256") == image_sha, "FIRST_FRAME_REVIEW_IMAGE_BINDING_MISMATCH")
    validate_receipt(frame, report, shot_id, case["mode"], case.get("created_by", "Codex"), "first_frame")
    for snapshots in (case_snapshots, semantic_snapshots, frame_snapshots):
        snapshots.stable()
    require(Path(image).resolve().read_bytes() == input_bytes, "FIRST_FRAME_DRIFT_DURING_PREPARE")
    root = Path(jobs_root).resolve() / generation_id
    guard_output_path(root / "manifest.json", [case_path, LIBRARY, image, semantic_receipt, frame_receipt])
    require(not root.exists(), "JOB_EXISTS_RECONCILE_IN_PLACE_NEVER_RECREATE")
    root.mkdir(parents=True)
    (root / "first-frame.png").write_bytes(input_bytes)
    write(root / "semantic-review.json", semantic)
    write(root / "first-frame-review.json", frame)
    manifest = {
        "generation_id": generation_id, "provider": "xai-oauth", "allow_api_key_fallback": False,
        "input_image": "first-frame.png", "input_sha256": image_sha,
        "duration_seconds": 4, "aspect_ratio": "9:16", "resolution": "720p",
        "prompt": pair["motion_prompt"], "still_prompt_sha256": pair["still_prompt_sha256"],
        "motion_prompt_sha256": pair["motion_prompt_sha256"], "content_digest": pair["content_digest"],
        "shoe_anchor_id": report["anchor_id"], "instance_id": report["instance_id"],
        "owner_accepted": False, "publication_authorized": False,
        "shoe_contract": {
            "case_path": report["case_path"], "case_sha256": report["case_sha256"],
            "library_sha256": report["library_sha256"], "compiler_sha256": report["compiler_sha256"],
            "policy_sha256": report["policy_sha256"], "source_bundle_sha256": report["source_bundle_sha256"],
            "shot_id": shot_id,
            "semantic_review": {"path": "semantic-review.json", "sha256": sha(root / "semantic-review.json")},
            "first_frame_review": {"path": "first-frame-review.json",
                                   "sha256": sha(root / "first-frame-review.json"),
                                   "input_sha256": image_sha},
        },
    }
    write(root / "manifest.json", manifest)
    write(root / "preflight.json", check_job(root, manifest))
    return root


def run_job(root, credentials, transport, core_run=None):
    """New PREPARED jobs are rechecked before credentials and before POST.

    Accepted jobs use the original immutable intent/manifest to poll; terminal
    states are returned by the original core without credentials or transport.
    """
    root = Path(root).resolve()
    manifest_path = root / "manifest.json"
    manifest_bytes = manifest_path.read_bytes()
    try:
        manifest = json.loads(manifest_bytes.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ContractError("MANIFEST_CORRUPT") from exc
    state = classify_job(root)
    require(manifest_path.read_bytes() == manifest_bytes, "MANIFEST_DRIFT_DURING_CLASSIFY")
    if state is None or state["state"] == "PREPARED":
        check_job(root, manifest)
        fresh = True
    else:
        fresh = False
    replay_submit_response = bool(state and state.get("_replay_submit_response"))
    if core_run is None:
        core_run = module(RUNNER / "oneshot_core.py", "shoe_existing_oneshot").run
    require(manifest_path.read_bytes() == manifest_bytes, "MANIFEST_DRIFT_BEFORE_RUN")

    def guarded_credentials():
        if fresh:
            require(manifest_path.read_bytes() == manifest_bytes, "MANIFEST_DRIFT_BEFORE_CREDENTIALS")
            check_job(root, manifest)
            require(manifest_path.read_bytes() == manifest_bytes, "MANIFEST_DRIFT_BEFORE_CREDENTIALS")
        return credentials()

    class BoundTransport:
        def __getattr__(self, key):
            if transport is None:
                raise ContractError("TRANSPORT_NOT_INITIALIZED_FOR_TERMINAL_JOB")
            return getattr(transport, key)

        def submit(self, submitted_manifest, auth, key):
            if replay_submit_response:
                require(fresh and key == state.get("idempotency_key"),
                        "PRIOR_RESPONSE_REPLAY_BINDING_MISMATCH")
                response_path = root / "submit-response.raw"
                try:
                    raw = response_path.read_bytes()
                    cached = json.loads(raw.decode("utf-8-sig"))
                except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                    raise ContractError("PRIOR_RESPONSE_REPLAY_CORRUPT") from exc
                require(cached.get("request_id") == state.get("_replay_request_id"),
                        "PRIOR_RESPONSE_REPLAY_REQUEST_MISMATCH")
                safe_headers_path = root / "response-headers.json"
                safe_headers = read(safe_headers_path) if safe_headers_path.exists() else {}
                # Replay the saved acceptance body into the original state core; never POST again.
                return {"raw": raw, "status_code": 200, "request_id": cached["request_id"],
                        "safe_headers": safe_headers}
            require(fresh, "RESUME_MUST_POLL_NO_SUBMIT")
            if fresh:
                require(manifest_path.read_bytes() == manifest_bytes, "MANIFEST_DRIFT_BEFORE_POST")
                check_job(root, submitted_manifest)
                require(manifest_path.read_bytes() == manifest_bytes, "MANIFEST_DRIFT_BEFORE_POST")
            return transport.submit(submitted_manifest, auth, key)

    return core_run(root, manifest, guarded_credentials, BoundTransport())


def _default_runtime(needs_toolset):
    import httpx
    import yaml
    os.environ["HERMES_HOME"] = "C:/Users/cyc39/AppData/Local/hermes"
    if needs_toolset:
        config_path = Path(os.environ["HERMES_HOME"]) / "config.yaml"
        config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
        require("video_gen" in config.get("platform_toolsets", {}).get("cli", []),
                "HERMES_VIDEO_TOOLSET_NOT_READY")
    oauth = module(RUNNER / "oauth_transport.py", "shoe_existing_oauth")
    client = httpx.Client(transport=httpx.HTTPTransport(retries=0), trust_env=False, follow_redirects=False)
    return oauth.oauth_credentials, oauth.OAuthTransport, client, client.close


def _exit_code(result):
    state = result.get("state", result.get("status"))
    return {"COMPLETED": 0, "PREPARED": 0, "PREFLIGHT_VALID_NOT_VISUAL_OR_OWNER_APPROVAL": 0,
            "DECLARATIONS_VALID_SEMANTIC_REVIEW_REQUIRED": 0,
            "INTAKE_CREATED_NOT_READY_FOR_GENERATION": 0,
            "POLLING": 3, "ACCEPTED": 3, "FAILED": 4,
            "AMBIGUOUS": 5, "SUBMITTING": 6, "BLOCKED": 2}.get(state, 2)


def main(argv=None, *, runtime_factory=None, core_run=None, emit=True):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)
    intake = sub.add_parser("init")
    intake.add_argument("anchor", type=Path)
    intake.add_argument("--instance-id", required=True)
    intake.add_argument("--out", type=Path, required=True)
    plan = sub.add_parser("plan")
    plan.add_argument("case", type=Path)
    plan.add_argument("--out", type=Path)
    p = sub.add_parser("prepare")
    p.add_argument("case", type=Path)
    p.add_argument("--shot", required=True)
    p.add_argument("--first-frame", type=Path, required=True)
    p.add_argument("--semantic-review", type=Path, required=True)
    p.add_argument("--review", type=Path, required=True)
    p.add_argument("--generation-id", required=True)
    for name in ("check-job", "run"):
        sub.add_parser(name).add_argument("job", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.cmd == "init":
            result = init_case(args.anchor, args.instance_id, args.out)
        elif args.cmd == "plan":
            report = inspect_case(args.case)
            if args.out:
                require(report.get("status") != "BLOCKED", "PLAN_BLOCKED_NO_REPORT_WRITE")
                inputs = report.get("source_paths")
                require(isinstance(inputs, list) and inputs, "PLAN_DEPENDENCY_MANIFEST_REQUIRED")
                guard_output_path(args.out, inputs)
                write(args.out, report)
            result = report
        elif args.cmd == "prepare":
            result = {"state": "PREPARED", "job": str(prepare(args.case, args.shot, args.first_frame,
                                                              args.semantic_review, args.review, args.generation_id))}
        elif args.cmd == "check-job":
            result = check_job(args.job)
        else:
            root = args.job.resolve()
            state = classify_job(root)
            if state is None or state["state"] == "PREPARED":
                # Full content and receipts pass before settings or OAuth modules load.
                check_job(root)
                needs_toolset = True
            elif state["state"] in ("ACCEPTED", "POLLING"):
                # Resume uses the existing immutable manifest/request ID; toolset config is irrelevant.
                needs_toolset = False
            else:
                # Existing terminal states are read by the original core without config, auth, or transport.
                result = run_job(root, lambda: (_ for _ in ()).throw(
                    ContractError("TERMINAL_JOB_MUST_NOT_RESOLVE_CREDENTIALS")), None, core_run)
                if emit:
                    print(json.dumps(result, ensure_ascii=False, indent=2))
                return _exit_code(result)
            factory = runtime_factory or _default_runtime
            credentials, transport_type, client, close = factory(needs_toolset)
            try:
                transport = transport_type(root, client)
                result = run_job(root, credentials, transport, core_run)
            finally:
                close()
        if emit:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        return _exit_code(result)
    except (ContractError, KeyError, TypeError, ValueError, IndexError, OSError, subprocess.SubprocessError) as exc:
        result = {"status": "BLOCKED", "error": str(exc)}
        if emit:
            print(json.dumps(result, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
