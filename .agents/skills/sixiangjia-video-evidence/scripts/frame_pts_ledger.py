#!/usr/bin/env python3
"""Extract every source video frame and write reproducible PTS ledgers.

The tool deliberately does not infer creative PASS/FAIL from pixels.  Optional
human-reviewed annotations can be bound to an exact source hash and projected
onto the frame ledger, which makes known failures durable regression fixtures.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shutil
import subprocess
import sys
from fractions import Fraction
from pathlib import Path
from typing import Any


LEDGER_FIELDS = (
    "clip_id",
    "frame_index",
    "frame_number",
    "pts",
    "pts_time",
    "duration_pts",
    "duration_time",
    "key_frame",
    "pict_type",
    "image_path",
    "image_sha256",
    "issue_ids",
)

CREATIVE_DECISIONS = frozenset({"accepted", "rejected", "manual_review_required"})
SHA256_PATTERN = re.compile(r"^[0-9A-F]{64}$")


class LedgerError(RuntimeError):
    """Raised when the source or extracted evidence is not internally valid."""


def _run_json(command: list[str]) -> dict[str, Any]:
    completed = subprocess.run(
        command, check=False, capture_output=True, text=True, encoding="utf-8"
    )
    if completed.returncode:
        raise LedgerError(
            f"Command failed ({completed.returncode}): {' '.join(command)}\n"
            f"{completed.stderr.strip()}"
        )
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise LedgerError(f"Command returned invalid JSON: {' '.join(command)}") from exc


def _run(command: list[str]) -> None:
    completed = subprocess.run(
        command, check=False, capture_output=True, text=True, encoding="utf-8"
    )
    if completed.returncode:
        raise LedgerError(
            f"Command failed ({completed.returncode}): {' '.join(command)}\n"
            f"{completed.stderr.strip()}"
        )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def _fraction(value: str, field: str) -> Fraction:
    try:
        result = Fraction(value)
    except (ValueError, ZeroDivisionError) as exc:
        raise LedgerError(f"Invalid {field}: {value!r}") from exc
    if result <= 0:
        raise LedgerError(f"Invalid {field}: {value!r}")
    return result


def _find_repo_root(start: Path) -> Path | None:
    resolved = start.resolve()
    candidates = (resolved, *resolved.parents)
    return next((candidate for candidate in candidates if (candidate / ".git").exists()), None)


def probe_source(input_path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    probe = _run_json(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            str(input_path),
        ]
    )
    video_streams = [
        stream
        for stream in probe.get("streams", [])
        if stream.get("codec_type") == "video"
        and not stream.get("disposition", {}).get("attached_pic", 0)
    ]
    if not video_streams:
        raise LedgerError("No non-attached video stream found")
    stream = video_streams[0]
    stream_index = int(stream["index"])
    frames_probe = _run_json(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            str(stream_index),
            "-show_frames",
            "-show_entries",
            (
                "frame=media_type,stream_index,key_frame,pts,pts_time,"
                "best_effort_timestamp,best_effort_timestamp_time,"
                "pkt_duration,pkt_duration_time,pict_type"
            ),
            "-of",
            "json",
            str(input_path),
        ]
    )
    frames = [
        frame
        for frame in frames_probe.get("frames", [])
        if frame.get("media_type") == "video"
    ]
    if not frames:
        raise LedgerError("ffprobe decoded no video frames")
    return {"probe": probe, "stream": stream}, frames


def load_annotations(path: Path | None, clip_hash: str, frame_count: int) -> dict[str, Any]:
    if path is None:
        return {"expected_decision": "manual_review_required", "issues": []}
    data = json.loads(path.read_text(encoding="utf-8"))
    if "clip_sha256" not in data or not str(data["clip_sha256"]).strip():
        raise LedgerError("Annotation clip_sha256 is required")
    expected_hash = str(data["clip_sha256"]).strip().upper()
    if not SHA256_PATTERN.fullmatch(expected_hash):
        raise LedgerError("Annotation clip_sha256 must be 64 hexadecimal characters")
    if expected_hash != clip_hash:
        raise LedgerError(
            f"Annotation source hash mismatch: expected {expected_hash}, got {clip_hash}"
        )
    decision = data.get("expected_decision")
    if decision not in CREATIVE_DECISIONS:
        allowed = ", ".join(sorted(CREATIVE_DECISIONS))
        raise LedgerError(
            f"Annotation expected_decision must be one of: {allowed}; got {decision!r}"
        )
    issues = data.get("issues", [])
    seen_ids: set[str] = set()
    for issue in issues:
        issue_id = issue.get("id")
        if not issue_id or issue_id in seen_ids:
            raise LedgerError(f"Annotation issue id is missing or duplicated: {issue_id!r}")
        seen_ids.add(issue_id)
        start = int(issue["start_frame"])
        end = int(issue["end_frame"])
        if start < 0 or end < start or end >= frame_count:
            raise LedgerError(
                f"Issue {issue_id} range {start}..{end} outside 0..{frame_count - 1}"
            )
    return data


def build_ledger(
    input_path: Path,
    output_dir: Path,
    clip_id: str,
    expected_fps: Fraction,
    annotations_path: Path | None,
) -> dict[str, Any]:
    if not input_path.is_file():
        raise LedgerError(f"Input does not exist: {input_path}")
    if not shutil.which("ffprobe") or not shutil.which("ffmpeg"):
        raise LedgerError("ffprobe and ffmpeg must be available on PATH")

    source, probed_frames = probe_source(input_path)
    stream = source["stream"]
    avg_fps = _fraction(stream.get("avg_frame_rate", "0/0"), "avg_frame_rate")
    nominal_fps = _fraction(stream.get("r_frame_rate", "0/0"), "r_frame_rate")
    if avg_fps != expected_fps or nominal_fps != expected_fps:
        raise LedgerError(
            f"Expected exact {expected_fps} fps, got avg={avg_fps}, nominal={nominal_fps}"
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    frames_dir = output_dir / "frames"
    if frames_dir.exists():
        shutil.rmtree(frames_dir)
    frames_dir.mkdir()
    _run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(input_path),
            "-map",
            f"0:{stream['index']}",
            "-fps_mode",
            "passthrough",
            "-start_number",
            "0",
            str(frames_dir / "frame-%06d.png"),
        ]
    )
    images = sorted(frames_dir.glob("frame-*.png"))
    if len(images) != len(probed_frames):
        raise LedgerError(
            f"Extracted/probed frame mismatch: {len(images)} != {len(probed_frames)}"
        )

    source_hash = sha256_file(input_path)
    annotations = load_annotations(annotations_path, source_hash, len(images))
    time_base = Fraction(stream["time_base"])
    issue_by_frame: dict[int, list[str]] = {index: [] for index in range(len(images))}
    for issue in annotations.get("issues", []):
        for boundary in ("start", "end"):
            frame_index = int(issue[f"{boundary}_frame"])
            declared_pts = issue.get(f"{boundary}_pts_time")
            if declared_pts is not None:
                frame_pts = probed_frames[frame_index].get(
                    "pts", probed_frames[frame_index].get("best_effort_timestamp")
                )
                actual_pts = Fraction(int(frame_pts)) * time_base
                if Fraction(str(declared_pts)) != actual_pts:
                    raise LedgerError(
                        f"Issue {issue['id']} {boundary} PTS mismatch: "
                        f"declared {declared_pts}, actual {float(actual_pts):.6f}"
                    )
        for index in range(int(issue["start_frame"]), int(issue["end_frame"]) + 1):
            issue_by_frame[index].append(str(issue["id"]))

    rows: list[dict[str, Any]] = []
    previous_pts_time: Fraction | None = None
    expected_delta = Fraction(1, expected_fps)
    pts_anomalies: list[dict[str, Any]] = []
    for index, (frame, image) in enumerate(zip(probed_frames, images, strict=True)):
        pts = frame.get("pts", frame.get("best_effort_timestamp"))
        pts_time_text = frame.get(
            "pts_time", frame.get("best_effort_timestamp_time")
        )
        if pts is None or pts_time_text is None:
            raise LedgerError(f"Frame {index} has no PTS")
        # ffprobe renders pts_time to six decimal places.  Derive the exact
        # rational time from integer PTS and stream time_base so ordinary CFR
        # cadence is not falsely reported as jitter.
        pts_time = Fraction(int(pts)) * time_base
        if previous_pts_time is not None:
            delta = pts_time - previous_pts_time
            if delta != expected_delta:
                pts_anomalies.append(
                    {
                        "frame_index": index,
                        "previous_pts_time": float(previous_pts_time),
                        "pts_time": float(pts_time),
                        "delta": float(delta),
                        "expected_delta": float(expected_delta),
                    }
                )
            if delta <= 0:
                raise LedgerError(f"Non-monotonic PTS at frame {index}")
        previous_pts_time = pts_time
        relative_image = image.relative_to(output_dir).as_posix()
        rows.append(
            {
                "clip_id": clip_id,
                "frame_index": index,
                "frame_number": index + 1,
                "pts": int(pts),
                "pts_time": f"{float(pts_time):.6f}",
                "duration_pts": frame.get("pkt_duration", ""),
                "duration_time": frame.get("pkt_duration_time", ""),
                "key_frame": int(frame.get("key_frame", 0)),
                "pict_type": frame.get("pict_type", ""),
                "image_path": relative_image,
                "image_sha256": sha256_file(image),
                "issue_ids": ";".join(issue_by_frame[index]),
            }
        )

    jsonl_path = output_dir / "frame-ledger.jsonl"
    jsonl_path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
    )
    csv_path = output_dir / "frame-ledger.csv"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=LEDGER_FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    issue_count = sum(bool(row["issue_ids"]) for row in rows)
    technical_status = "fail" if pts_anomalies else "pass"
    repo_root = _find_repo_root(input_path.parent)
    input_repo_relative_path = None
    if repo_root is not None:
        try:
            input_repo_relative_path = input_path.resolve().relative_to(repo_root).as_posix()
        except ValueError:
            input_repo_relative_path = None
    summary = {
        "schema_version": "1.1.0",
        "tool": "frame_pts_ledger.py",
        "clip_id": clip_id,
        "input_argument": input_path.as_posix(),
        "input_path": str(input_path.resolve()),
        "repo_root": str(repo_root) if repo_root is not None else None,
        "input_repo_relative_path": input_repo_relative_path,
        "input_sha256": source_hash,
        "knowledge_pack_version": "0.1.0-audit-baseline",
        "knowledge_cutoff_date": "2026-07-20",
        "source_ids": [],
        "review_role": "technical_full_frame_evidence",
        "forbidden_claims": [
            "contact sheet is full-frame proof",
            "manual annotation is automated visual detection",
            "technical validation proves creative acceptance",
        ],
        "stream_index": int(stream["index"]),
        "codec": stream.get("codec_name"),
        "width": int(stream["width"]),
        "height": int(stream["height"]),
        "avg_frame_rate": stream["avg_frame_rate"],
        "nominal_frame_rate": stream["r_frame_rate"],
        "time_base": stream["time_base"],
        "frame_count": len(rows),
        "first_pts_time": rows[0]["pts_time"],
        "last_pts_time": rows[-1]["pts_time"],
        "pts_anomaly_count": len(pts_anomalies),
        "pts_anomalies": pts_anomalies,
        "annotation_file": str(annotations_path.resolve()) if annotations_path else None,
        "expected_decision": annotations.get(
            "expected_decision", "manual_review_required"
        ),
        "annotated_issue_count": len(annotations.get("issues", [])),
        "annotated_frame_count": issue_count,
        "issues": annotations.get("issues", []),
        "technical_status": technical_status,
        "creative_status": annotations.get(
            "expected_decision", "manual_review_required"
        ),
    }
    (output_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return summary


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract every source frame and write JSONL/CSV PTS ledgers."
    )
    parser.add_argument("input", type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--clip-id")
    parser.add_argument("--expected-fps", default="24")
    parser.add_argument("--annotations", type=Path)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        summary = build_ledger(
            input_path=args.input,
            output_dir=args.output_dir,
            clip_id=args.clip_id or args.input.stem,
            expected_fps=_fraction(args.expected_fps, "expected_fps"),
            annotations_path=args.annotations,
        )
    except (LedgerError, OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary["technical_status"] == "pass" else 3


if __name__ == "__main__":
    raise SystemExit(main())
