#!/usr/bin/env python3
"""Check the anchor registry against what is actually on disk.

Anchors are the one thing in this pipeline that silently poisons everything
downstream. Every generation command carries the line "if the written
description and an attached photograph disagree, the photograph wins", so a
defective anchor cannot be corrected by any amount of prompt text -- on
2026-09-15 that was traced as the reason three films running rendered cotton
canvas as crazed leather. The only fix is to replace the anchor and regenerate
everything that referenced it, which is why used_by is recorded.

So this refuses quietly-wrong states:
  * an approved anchor whose file is missing
  * an approved anchor with no used_by, which means nobody knows what replacing
    it would break
  * a deprecated anchor still being referenced by a live reference-map
  * a wanted/blocked anchor that has somehow acquired a path

Usage:
  check_anchors.py                      check the registry
  check_anchors.py --maps <dir> [...]   also check reference-maps for dead anchors
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "data" / "anchors" / "registry.json"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--maps", nargs="*", default=[],
                    help="reference-map.json files to check for deprecated anchors")
    args = ap.parse_args()

    reg = json.loads(io.open(REGISTRY, encoding="utf-8").read())["anchors"]
    problems: list[str] = []

    by_status: dict[str, int] = {}
    print(f"{'anchor':18} {'status':11} {'kind':7} file")
    for name, a in reg.items():
        status = a.get("status", "?")
        by_status[status] = by_status.get(status, 0) + 1
        path = a.get("path")
        mark = ""
        if status == "approved":
            if not path:
                problems.append(f"{name}: approved but has no path")
                mark = "  <- NO PATH"
            elif not (ROOT / path).exists():
                problems.append(f"{name}: approved but the file is missing: {path}")
                mark = "  <- FILE MISSING"
            if not a.get("used_by"):
                problems.append(f"{name}: approved with no used_by, so nobody knows what "
                                f"replacing it would break")
                mark += "  <- NO used_by"
        elif status in ("wanted", "blocked") and path:
            problems.append(f"{name}: status {status} but carries a path; either it exists "
                            f"(approve it) or it does not (clear the path)")
            mark = "  <- PATH ON A NON-EXISTENT ANCHOR"
        elif status == "deprecated" and path and not (ROOT / path).exists():
            mark = "  (file already gone)"
        print(f"{name:18} {status:11} {a.get('kind','?'):7} {path or '-'}{mark}")

    # A deprecated anchor still wired into a live film is the dangerous case.
    deprecated = {n for n, a in reg.items() if a.get("status") == "deprecated"}
    dep_paths = {a["path"] for a in reg.values() if a.get("status") == "deprecated" and a.get("path")}
    for m in args.maps:
        p = Path(m)
        if not p.exists():
            continue
        data = json.loads(io.open(p, encoding="utf-8").read())
        for key, val in (data.get("_anchors") or {}).items():
            if key in deprecated or val in dep_paths:
                problems.append(f"{p}: still points at deprecated anchor {key} ({val})")

    print()
    print("  " + "  ".join(f"{k}={v}" for k, v in sorted(by_status.items())))
    print()
    if problems:
        print(f"{len(problems)} problem(s):")
        for x in problems:
            print("  -", x)
        return 1
    print("registry is consistent with what is on disk")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
