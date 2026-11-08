# -*- coding: utf-8 -*-
"""Offline LINE-ACK evidence runner. Reuses A2b isolation; needs no pytest.

Mutants are compiled in child processes through an import loader. Product files
are never overwritten. The parent cleans only the child-reported A2b temp tree:
test_estimate installs an audit guard which forbids A2b's outer-tree cleanup.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import importlib.abc
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import unittest

HERE = Path(__file__).resolve().parent
SOURCES = ("line_event_log.py", "line_webhook.py", "quote_flow.py", "conversation.py", "staff_notify.py")
MUTATIONS = {
    "no_correlation": ("line_event_log", "WebhookTests.test_five_deliveries_are_three_correlated_events"),
    "empty_token_accepted": ("line_webhook", "WebhookTests.test_empty_token_is_not_accepted_and_keeps_cache"),
    "unlocked_mark": ("quote_flow", "AtomicMarkTests.test_parallel_marks_preserve_both_acceptances_and_remove_both_caches"),
    "log_failure_propagates": ("line_event_log", "WebhookTests.test_log_write_failure_does_not_break_customer_reply"),
}


def mutated_source(module, mutation):
    source = (HERE / f"{module}.py").read_text(encoding="utf-8-sig")
    if mutation == "no_correlation":
        old = 'self.event_ref = hmac.new(request_trace.key, raw, hashlib.sha256).hexdigest() if raw else ""'
        new = 'self.event_ref = ""'
    elif mutation == "empty_token_accepted":
        old = 'if not messages or not reply_token:\n        return False'
        new = 'if not messages or not reply_token:\n        return True'
    elif mutation == "log_failure_propagates":
        old = '''        try:
            _append_records(log_dir(), self.received_at.date(), records)
        except Exception as exc:
            _warn(exc)'''
        new = '        _append_records(log_dir(), self.received_at.date(), records)'
    else:
        tree = ast.parse(source)
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "mark_reply_accepted")
        lines = source.splitlines(keepends=True)
        old = "".join(lines[node.lineno - 1:node.end_lineno])
        new = '''def mark_reply_accepted(conv, uid, event_id):
    row = conv._load_sess().get(uid) or {}
    accepted = list(row.get("estimate_reply_accepted") or [])
    replies = dict(row.get("estimate_replies") or {})
    replies.pop(event_id, None)
    conv.set_sess(uid, estimate_reply_accepted=(accepted + [event_id])[-100:], estimate_replies=replies)
'''
    if source.count(old) != 1:
        raise RuntimeError("mutation target changed; refusing an ineffective mutant")
    return source.replace(old, new)


class MutationLoader(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def __init__(self, mutation):
        self.module, self.test = MUTATIONS[mutation]
        self.source = mutated_source(self.module, mutation)

    def find_spec(self, fullname, path=None, target=None):
        if fullname == self.module:
            return importlib.util.spec_from_loader(fullname, self, origin=str(HERE / f"{fullname}.py"))

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = str(HERE / f"{self.module}.py")
        exec(compile(self.source, module.__file__, "exec"), module.__dict__)


def child(module_name, mutation):
    if mutation:
        loader = MutationLoader(mutation)
        sys.meta_path.insert(0, loader)
        original = unittest.defaultTestLoader.loadTestsFromModule

        def selected(module, *args, **kwargs):
            if module.__name__ == "test_line_ack":
                return unittest.defaultTestLoader.loadTestsFromName(loader.test, module)
            return original(module, *args, **kwargs)

        unittest.defaultTestLoader.loadTestsFromModule = selected
    # Keep A2b's production/network guards, real Flask when installed, fake keys,
    # synthetic fixture and inherited temp ACL. Only defer its final cleanup.
    runner = HERE / "run_a2b_tests.py"
    tree = ast.parse(runner.read_text(encoding="utf-8-sig"))
    cleanup = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_remove_tree")
    cleanup.body = ast.parse('print("ACK_TEST_TMP|" + str(path), flush=True)').body
    ast.fix_missing_locations(tree)
    sys.argv = [str(runner), module_name]
    sys.modules["__main__"].__file__ = str(runner)
    namespace = dict(__name__="__main__", __file__=str(runner))
    exec(compile(tree, str(runner), "exec"), namespace)


def run_one(module, output, *, label=None, mutation=None):
    env = os.environ.copy()
    env.update(PYTHONDONTWRITEBYTECODE="1", LAUNDRY_LINE_EVENTS="off", LAUNDRY_LINE_USAGE="off",
               LAUNDRY_AI_CHAT="off", PYTHONPATH=str(HERE / "tests"))
    # Windows Python may have no tzdata package. Reuse installed, local TZif
    # data; do not install packages or change the machine's timezone/settings.
    zoneinfo = Path(sys.prefix) / "Lib/site-packages/pytz/zoneinfo"
    if zoneinfo.is_dir() and not env.get("PYTHONTZPATH"):
        env["PYTHONTZPATH"] = str(zoneinfo)
    command = [sys.executable, "-B", "-X", "utf8", str(Path(__file__).resolve()), "--child", module]
    if mutation:
        command += ["--mutation", mutation]
    started = time.monotonic()
    try:
        proc = subprocess.run(command, cwd=HERE, env=env, capture_output=True, timeout=180)
        code, raw = proc.returncode, proc.stdout + proc.stderr
    except subprocess.TimeoutExpired as exc:
        code, raw = 124, (exc.stdout or b"") + (exc.stderr or b"")
    log = raw.decode("utf-8", "replace")
    (output / f"{label or module}.log").write_text(log, encoding="utf-8")
    for line in log.splitlines():
        if line.startswith("ACK_TEST_TMP|"):
            path = Path(line.split("|", 1)[1]).resolve()
            if path.parent != HERE or not path.name.startswith(".a2b-test-tmp-") or path.is_symlink():
                raise RuntimeError("refusing cleanup outside child-owned A2b tree")
            if not getattr(path.lstat(), "st_file_attributes", 0) & 0x400:
                shutil.rmtree(path, ignore_errors=True)
    row = {"module": module, "exit": code, "seconds": round(time.monotonic() - started, 3),
           "failures": re.findall(r"^(?:FAIL|ERROR): (.+)$", log, re.M)}
    print(json.dumps(row, ensure_ascii=True), flush=True)
    return row


def fingerprints():
    return {name: hashlib.sha256((HERE / name).read_bytes()).hexdigest() for name in SOURCES}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--child", help=argparse.SUPPRESS)
    parser.add_argument("--mutation", choices=MUTATIONS, help=argparse.SUPPRESS)
    parser.add_argument("--full", action="store_true", help="run the existing suite too")
    parser.add_argument("--suite-only", action="store_true", help="only the existing suite (for the frozen base)")
    parser.add_argument("--output", type=Path, default=HERE / ".lineack-evidence")
    args = parser.parse_args()
    if args.child:
        child(args.child, args.mutation)
        return 0
    output = args.output.resolve()
    if not output.is_relative_to(HERE):
        raise ValueError("test evidence must stay inside this line-bot tree")
    output.mkdir(parents=True, exist_ok=True)
    before = fingerprints() if not args.suite_only else {}
    report = {"python": sys.executable, "sources_before": before, "suite": []}
    if not args.suite_only:
        report["green_before"] = run_one("test_line_ack", output, label="task-green-before")
        report["mutations"] = []
        for mutation, (_, name) in MUTATIONS.items():
            row = run_one("test_line_ack", output, label=mutation, mutation=mutation)
            row.update(mutation=mutation, target_test=name, killed=row["exit"] == 1 and bool(row["failures"]))
            report["mutations"].append(row)
        report["green_restored"] = run_one("test_line_ack", output, label="task-green-restored")
        report["sources_after"] = fingerprints()
        report["sources_unchanged"] = before == report["sources_after"]
    if args.full or args.suite_only:
        files = sorted(HERE.glob("test_*.py")) + sorted((HERE / "tests").glob("test_*.py"))
        for path in files:
            if path.stem != "test_line_ack":
                row = run_one(path.stem, output)
                row["path"] = str(path.relative_to(HERE))
                report["suite"].append(row)
                (output / "results.json").write_text(json.dumps(report, ensure_ascii=True, indent=2), encoding="utf-8")
    (output / "results.json").write_text(json.dumps(report, ensure_ascii=True, indent=2), encoding="utf-8")
    if not args.suite_only:
        if report["green_before"]["exit"] or report["green_restored"]["exit"] or not report["sources_unchanged"] or not all(r["killed"] for r in report["mutations"]):
            return 1
    return 1 if any(r["exit"] for r in report["suite"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
