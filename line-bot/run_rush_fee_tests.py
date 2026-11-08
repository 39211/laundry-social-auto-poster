# -*- coding: utf-8 -*-
"""RUSH r1 mutation proof. Reuse the existing offline A2b/LINE-ACK runner.

Mutate only the imported conversation module in a disposable worker. Product
files remain unchanged; a red result must be the named assertion, not an error.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.abc
import importlib.util
import json
from pathlib import Path
import sys
import unittest

import run_line_ack_tests as runner

HERE = Path(__file__).resolve().parent
TEST_MODULE = "test_rush_fee_1108"
NOTICE = "急件可能另計費用，由店員報價。"
MUTATIONS = {
    "removed": "test_saved_and_unsaved_wording_is_only_appended",
    "duplicated": "test_saved_and_unsaved_wording_is_only_appended",
    "non_rush": "test_non_rush_replies_have_no_notice",
}


class MutationLoader(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def __init__(self, mutation):
        self.source = (HERE / "conversation.py").read_text(encoding="utf-8-sig")
        if mutation in ("removed", "duplicated"):
            old = f'_RUSH_FEE_NOTICE = "{NOTICE}"'
            new = f'_RUSH_FEE_NOTICE = "{NOTICE * (2 if mutation == "duplicated" else 0)}"'
        else:
            old = 'def wash_ask() -> list[dict]:\n    return say(\n        "好。",'
            new = 'def wash_ask() -> list[dict]:\n    return say(\n        "好。" + _RUSH_FEE_NOTICE,'
        if self.source.count(old) != 1:
            raise RuntimeError("mutation target changed")
        self.source = self.source.replace(old, new)

    def find_spec(self, fullname, path=None, target=None):
        if fullname == "conversation":
            return importlib.util.spec_from_loader(fullname, self)

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = str(HERE / "conversation.py")
        exec(compile(self.source, module.__file__, "exec"), module.__dict__)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--child", help=argparse.SUPPRESS)
    parser.add_argument("--worker", nargs=2, help=argparse.SUPPRESS)
    parser.add_argument("--mutation", choices=MUTATIONS, help=argparse.SUPPRESS)
    parser.add_argument("--extras-only", action="store_true", help="run script-style suites and LINE-ACK omitted by the legacy sweep")
    parser.add_argument("--output", type=Path, default=HERE / ".rush-r1-evidence/mutations")
    args = parser.parse_args()
    # The existing runner forwards its own __file__ into the actual worker.
    runner.__file__ = __file__
    if args.child:
        runner.child(args.child, args.mutation)
        return 0
    if args.worker:
        if args.mutation:
            sys.meta_path.insert(0, MutationLoader(args.mutation))
            original = unittest.defaultTestLoader.loadTestsFromModule

            def selected(module, *a, **kw):
                if module.__name__ == TEST_MODULE:
                    return unittest.defaultTestLoader.loadTestsFromName(
                        "RushFeeTests." + MUTATIONS[args.mutation], module)
                return original(module, *a, **kw)

            unittest.defaultTestLoader.loadTestsFromModule = selected
        import run_a2b_tests
        run_a2b_tests._SCRIPT_STYLE_MODULES += ("test_customer_questions", "test_isolation")
        return run_a2b_tests._run_module(Path(args.worker[1]), args.worker[0])
    output = args.output.resolve()
    if not output.is_relative_to(HERE):
        raise ValueError("evidence must stay in this line-bot worktree")
    output.mkdir(parents=True, exist_ok=True)
    if args.extras_only:
        rows = [runner.run_one(name, output) for name in
                ("test_customer_questions", "test_isolation", "test_line_ack")]
        (output / "extras.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
        return int(any(row["exit"] for row in rows))
    source = HERE / "conversation.py"
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    report = {"source_before": before, "green_before": runner.run_one(TEST_MODULE, output, label="green-before")}
    report["mutations"] = []
    for mutation, target in MUTATIONS.items():
        row = runner.run_one(TEST_MODULE, output, label=mutation, mutation=mutation)
        log = (output / f"{mutation}.log").read_text(encoding="utf-8")
        row.update(mutation=mutation, target=target,
                   killed=row["exit"] == 1 and row["cases"] == [1]
                   and f"FAIL: {target} (" in log and "ERROR:" not in log)
        report["mutations"].append(row)
    report["green_restored"] = runner.run_one(TEST_MODULE, output, label="green-restored")
    report["source_after"] = hashlib.sha256(source.read_bytes()).hexdigest()
    report["source_unchanged"] = before == report["source_after"]
    (output / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return int(not (report["source_unchanged"] and all(r["killed"] for r in report["mutations"])
                   and report["green_before"]["exit"] == report["green_restored"]["exit"] == 0))


if __name__ == "__main__":
    raise SystemExit(main())
