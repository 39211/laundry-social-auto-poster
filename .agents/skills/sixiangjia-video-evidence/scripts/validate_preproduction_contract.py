#!/usr/bin/env python3
"""Fail-closed validation for the Sixiangjia preproduction control plane."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


EXPECTED_ACCOUNTABLE_COLUMN = {
    "G0": 2,
    "G1": 9,
    "G2": 3,
    "G3": 2,
    "G4": 4,
    "G5": 5,
    "G6a": 6,
    "G6b": 2,
    "G6c": 10,
    "G6d": 11,
    "G7a": 4,
    "G7b": 2,
    "G8a": 10,
    "G8b": 2,
    "G9": 10,
    "G10": 11,
    "G11": 8,
    "G12": 2,
}


def _load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def parse_raci_rows(markdown: str) -> dict[str, list[str]]:
    rows: dict[str, list[str]] = {}
    for raw_line in markdown.splitlines():
        line = raw_line.strip()
        if not line.startswith("| G"):
            continue
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        gate = cells[0]
        if gate in rows:
            raise ValueError(f"duplicate RACI gate: {gate}")
        rows[gate] = cells
    return rows


def accountable_columns(cells: list[str]) -> list[int]:
    return [
        index
        for index, value in enumerate(cells)
        if value == "A" or value.startswith("A/") or value.endswith("/A")
    ]


def validate_raci_rows(raci_rows: dict[str, list[str]]) -> list[str]:
    errors: list[str] = []
    if set(raci_rows) != set(EXPECTED_ACCOUNTABLE_COLUMN):
        missing = sorted(set(EXPECTED_ACCOUNTABLE_COLUMN) - set(raci_rows))
        extra = sorted(set(raci_rows) - set(EXPECTED_ACCOUNTABLE_COLUMN))
        errors.append(f"RACI gate set mismatch; missing={missing}, extra={extra}")
    for gate, expected_column in EXPECTED_ACCOUNTABLE_COLUMN.items():
        cells = raci_rows.get(gate)
        if cells is None:
            continue
        if len(cells) != 12:
            errors.append(f"{gate} must contain 12 columns; got {len(cells)}")
            continue
        accountable = accountable_columns(cells)
        if accountable != [expected_column]:
            errors.append(
                f"{gate} must have one accountable owner at column {expected_column}; got {accountable}"
            )
    return errors


def inspect_authorization_tokens(
    repo_root: Path, tokens: Any, authorization_dir: Path
) -> tuple[list[str], dict[str, str]]:
    errors: list[str] = []
    issued_tokens: dict[str, str] = {}
    token_keys = ("script_lock", "first_frame_render", "shot_plan_lock", "video_generation")
    if not isinstance(tokens, dict) or set(tokens) != set(token_keys):
        return ["authorization token registry is missing or malformed"], issued_tokens
    for token_key in token_keys:
        token_path = tokens.get(token_key)
        if token_path is None:
            continue
        if not isinstance(token_path, str) or not (repo_root / token_path).is_file():
            errors.append(f"authorization token path is invalid: {token_key}")
            continue
        token = _load_json(repo_root / token_path)
        if token.get("token_type") != token_key or token.get("status") != "issued":
            errors.append(f"authorization token content is invalid: {token_key}")
            continue
        issued_tokens[token_key] = token_path
    if authorization_dir.is_dir():
        referenced = {(repo_root / value).resolve() for value in issued_tokens.values()}
        for token_file in authorization_dir.rglob("*.json"):
            if token_file.resolve() not in referenced:
                errors.append(f"unregistered authorization artifact: {token_file.name}")
    return errors, issued_tokens


def evaluate_generation_authorization(
    repo_root: Path, issued_tokens: dict[str, str]
) -> tuple[list[str], bool]:
    if "video_generation" not in issued_tokens:
        return [], False
    prerequisites = ("script_lock", "first_frame_render", "shot_plan_lock")
    missing_prerequisites = [key for key in prerequisites if key not in issued_tokens]
    if missing_prerequisites:
        return [f"video generation token is missing prerequisites: {missing_prerequisites}"], False
    first_frame = _load_json(repo_root / issued_tokens["first_frame_render"])
    if first_frame.get("qa_status") != "pass":
        return ["first-frame authorization token lacks qa_status=pass"], False
    return [], True


def validate(repo_root: Path) -> dict[str, Any]:
    errors: list[str] = []
    agents_dir = repo_root / ".agents"
    skill_dir = agents_dir / "skills" / "sixiangjia-video-evidence"
    team_path = agents_dir / "sixiangjia-team-manifest.json"
    qualification_path = skill_dir / "qualification" / "manifest.json"
    raci_path = (
        repo_root
        / "video-production"
        / "runs"
        / "2026-07-19-multi-object-brand-film-v1"
        / "29-production-team-raci-and-gates.md"
    )

    team = _load_json(team_path)
    qualification = _load_json(qualification_path)
    live_pack = qualification["knowledge_pack"]["version"]
    if team.get("knowledge_pack") != live_pack:
        errors.append("team knowledge_pack does not match the live qualification manifest")

    if qualification.get("qualification_availability", {}).get("professional_approval_allowed") is not False:
        errors.append("quarantined qualification manifest must not allow professional approval")
    if team.get("professional_approval_allowed") is not False:
        errors.append("team manifest must fail closed while the knowledge pack is quarantined")

    required_roles = team.get("roles", [])
    if len(required_roles) != 11 or len(set(required_roles)) != 11:
        errors.append("team manifest must contain exactly 11 unique production roles")
    if team.get("single_writer_rule") != "Only sixiangjia-screenwriter may directly change screenplay text.":
        errors.append("single screenplay writer rule is missing or changed")
    if team.get("single_gate_owner") != "Only sixiangjia-creative-producer may issue script lock and generation tokens.":
        errors.append("single token owner rule is missing or changed")

    active_paths: dict[str, Path] = {}
    for key in ("current_screenplay", "current_director_treatment", "active_artifact_contract"):
        relative = team.get(key)
        if not relative or not (repo_root / relative).is_file():
            errors.append(f"active artifact is missing: {key}")
        elif relative:
            active_paths[key] = repo_root / relative

    state = team.get("current_state", "")
    for required in ("G1=blocked_not_passed", "G2=blocked_not_passed", "no video generation", "no release"):
        if required not in state:
            errors.append(f"current_state lacks fail-closed marker: {required}")

    try:
        raci_rows = parse_raci_rows(raci_path.read_text(encoding="utf-8"))
    except ValueError as exc:
        errors.append(str(exc))
        raci_rows = {}
    errors.extend(validate_raci_rows(raci_rows))

    research_audit = team.get("research_audit", {})
    audit_relative = research_audit.get("audit_path")
    if not audit_relative or not (repo_root / audit_relative).is_file():
        errors.append("research audit artifact is missing")
    if research_audit.get("confirmed_direct") != 30:
        errors.append("confirmed direct count must match the current strict audit: 30")
    if research_audit.get("confirmed_direct_executed") != 4:
        errors.append("confirmed executed count must match the current independent audit: 4")
    if research_audit.get("confirmed_direct_runnable") != 19:
        errors.append("confirmed runnable count must match the current strict audit: 19")
    if research_audit.get("confirmed_direct_preproduction") != 7:
        errors.append("confirmed preproduction count must match the current strict audit: 7")
    category_total = sum(
        research_audit.get(key, -1000)
        for key in (
            "confirmed_direct_executed",
            "confirmed_direct_runnable",
            "confirmed_direct_preproduction",
        )
    )
    if category_total != research_audit.get("confirmed_direct"):
        errors.append("direct category counts must sum to confirmed_direct")
    active_contract = active_paths.get("active_artifact_contract")
    if active_contract:
        contract_text = active_contract.read_text(encoding="utf-8")
        if "20–21" in contract_text or "20-21" in contract_text:
            errors.append("active contract contains the withdrawn direct count")
        for marker in ("30個direct", "4個executed", "19個runnable", "7個preproduction"):
            if marker not in contract_text:
                errors.append(f"active contract lacks research audit marker: {marker}")

    token_errors, issued_tokens = inspect_authorization_tokens(
        repo_root, team.get("authorization_tokens"), raci_path.parent / "authorizations"
    )
    errors.extend(token_errors)
    generation_errors, generation_authorized = evaluate_generation_authorization(
        repo_root, issued_tokens
    )
    errors.extend(generation_errors)
    if generation_authorized and "no video generation" in state:
        errors.append("video generation token conflicts with the fail-closed current_state")

    return {
        "status": "pass" if not errors else "fail",
        "error_count": len(errors),
        "errors": errors,
        "knowledge_pack": live_pack,
        "raci_gate_count": len(raci_rows),
        "active_screenplay": team.get("current_screenplay"),
        "issued_tokens": sorted(issued_tokens),
        "generation_authorized": generation_authorized,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = validate(args.repo_root.resolve())
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"preproduction_contract={result['status']} errors={result['error_count']}")
        for error in result["errors"]:
            print(f"- {error}")
    return 0 if result["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
