# -*- coding: utf-8 -*-
"""Offline LINE-ACK evidence runner. Reuses A2b isolation; needs no pytest.

Mutants are compiled inside A2b's actual test worker through an import loader.
Product files are never overwritten. A2b's owning parent retains its normal
cleanup and production/network guards.
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
import subprocess
import sys
import time
import unittest

HERE = Path(__file__).resolve().parent
SOURCES = ("line_event_log.py", "line_reply_state.py", "line_webhook.py", "quote_flow.py", "conversation.py", "staff_notify.py",
           "reply_hints.py", "test_reply_hints.py")
MUTATIONS = {
    "no_correlation": ("line_event_log", "WebhookTests.test_five_deliveries_are_three_correlated_events"),
    "empty_token_accepted": ("line_webhook", "WebhookTests.test_empty_token_is_not_accepted_and_keeps_cache"),
    "unlocked_mark": ("quote_flow", "AtomicMarkTests.test_parallel_marks_preserve_both_acceptances_and_remove_both_caches"),
    "log_failure_propagates": ("line_event_log", "WebhookTests.test_log_write_failure_does_not_break_customer_reply"),
    "unknown_503": ("line_webhook", "WebhookTests.test_unknown_is_acked_and_never_resends_cached_reply"),
    "redelivery_4xx_503": ("line_webhook", "WebhookTests.test_all_4xx_and_redelivery_failures_are_acked_and_lost"),
    "no_retry_cap": ("line_reply_state", "WebhookTests.test_first_network_failure_requests_one_retry_then_acks_even_without_redelivery_flag"),
    "no_event_boundary": ("line_webhook", "WebhookTests.test_unexpected_handler_error_is_logged_acked_and_batch_continues"),
    "accepted_hint_error_becomes_unknown": ("line_webhook", "WebhookTests.test_hint_write_error_after_acceptance_does_not_resend_or_claim_hint"),
    "clear_unknown_pending": ("line_webhook", "WebhookTests.test_unexpected_transport_error_keeps_pending_and_never_replays"),
    "hints_opening_shift": ("reply_hints", "HintTests.test_independent_markers_reset_at_next_open"),
    "hints_calendar_rest": ("reply_hints", "HintTests.test_n608_fixed_rest_table_uses_current_2000_close"),
    "hints_drop_other_customers": ("reply_hints", "HintTests.test_successful_write_prunes_only_records_older_than_fourteen_days"),
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
    elif mutation in ("unknown_503", "redelivery_4xx_503"):
        old = '''    eligible = (span.reply_result == "failed" and span.reply_failure in ("network", "line_5xx")
                and not span.redelivered)'''
        extra = ('span.reply_result == "unknown"' if mutation == "unknown_503" else
                 '(span.redelivered and span.reply_failure == "line_4xx")')
        new = old + '\n    eligible = eligible or ' + extra
    elif mutation == "no_retry_cap":
        old = '    return bool(event_ref) and _create_once(_marker(repo, event_ref, "retry"))'
        new = '''    if not event_ref:
        return False
    path = _marker(repo, event_ref, "retry")
    path.unlink(missing_ok=True)
    return _create_once(path)'''
    elif mutation == "unlocked_mark":
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
    elif mutation == "no_event_boundary":
        old = '''                try:
                    _handle_event(ev, span)
                except Exception as exc:
                    _event_error(span, exc)'''
        new = '                _handle_event(ev, span)'
    elif mutation == "accepted_hint_error_becomes_unknown":
        old = '            if attempted and span.reply_result not in ("accepted", "unknown"):'
        new = '            if attempted and span.reply_result != "unknown":'
    elif mutation == "clear_unknown_pending":
        old = '''            if span.reply_result != "unknown":
                try:
                    reply_state.finish(span.trace.repo, span.event_ref)'''
        new = '''            if True:
                try:
                    reply_state.finish(span.trace.repo, span.event_ref)'''
    elif mutation == "hints_opening_shift":
        old = 'openings.append(day.replace(hour=hour, minute=minute'
        new = 'openings.append(day.replace(hour=hour + 1, minute=minute'
    elif mutation == "hints_calendar_rest":
        old = 'rest = following.isoformat() if following'
        new = 'rest = now.date().isoformat() if following'
    elif mutation == "hints_drop_other_customers":
        old = 'data[uid] = {**(data.get(uid) or {}), **marks}'
        new = 'data = {uid: {**(data.get(uid) or {}), **marks}}'
    else:
        raise ValueError("unknown mutation")
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


def worker(module_name, tmp_root, mutation):
    if mutation:
        loader = MutationLoader(mutation)
        sys.meta_path.insert(0, loader)
        original = unittest.defaultTestLoader.loadTestsFromModule

        def selected(module, *args, **kwargs):
            if module.__name__ == module_name:
                return unittest.defaultTestLoader.loadTestsFromName(loader.test, module)
            return original(module, *args, **kwargs)

        unittest.defaultTestLoader.loadTestsFromModule = selected
    import run_a2b_tests
    return run_a2b_tests._run_module(Path(tmp_root), module_name)


def child(module_name, mutation):
    # fa6fa981 moved module execution into --worker. Inject there, not in this
    # parent where an import loader would be silently lost on subprocess spawn.
    runner = HERE / "run_a2b_tests.py"
    tree = ast.parse(runner.read_text(encoding="utf-8-sig"))
    main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main")
    calls = [n for n in ast.walk(main) if isinstance(n, ast.Call)
             and isinstance(n.func, ast.Attribute) and isinstance(n.func.value, ast.Name)
             and n.func.value.id == "subprocess" and n.func.attr == "run"]
    if len(calls) != 1 or not isinstance(calls[0].args[0], ast.List):
        raise RuntimeError("A2b worker entry changed; refusing ineffective mutation")
    argv = calls[0].args[0].elts
    if len(argv) != 8 or not isinstance(argv[5], ast.Constant) or argv[5].value != "--worker":
        raise RuntimeError("A2b worker arguments changed; refusing ineffective mutation")
    argv[4] = ast.Constant(str(Path(__file__).resolve()))
    if mutation:
        argv.extend([ast.Constant("--mutation"), ast.Constant(mutation)])
    ast.fix_missing_locations(tree)
    sys.argv = [str(runner), module_name]
    namespace = dict(__name__="__main__", __file__=str(runner))
    exec(compile(tree, str(runner), "exec"), namespace)


def run_one(module, output, *, label=None, mutation=None):
    env = os.environ.copy()
    paths = [str(HERE), str(HERE / "tests")]
    flask_site = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local")) / "hermes/jarvis-memory/venv/Lib/site-packages"
    if (flask_site / "flask/__init__.py").is_file():
        paths.append(str(flask_site))
    env.update(PYTHONDONTWRITEBYTECODE="1", LAUNDRY_LINE_EVENTS="off", LAUNDRY_LINE_USAGE="off",
               LAUNDRY_AI_CHAT="off", PYTHONPATH=os.pathsep.join(paths))
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
    row = {"module": module, "exit": code, "seconds": round(time.monotonic() - started, 3),
           "failures": re.findall(r"^(?:FAIL|ERROR): (.+)$", log, re.M),
           "cases": [int(n) for n in re.findall(r"Ran (\d+) tests?", log)]}
    print(json.dumps(row, ensure_ascii=True), flush=True)
    return row


def fingerprints():
    return {name: hashlib.sha256((HERE / name).read_bytes()).hexdigest() for name in SOURCES}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--child", help=argparse.SUPPRESS)
    parser.add_argument("--worker", nargs=2, help=argparse.SUPPRESS)
    parser.add_argument("--mutation", choices=MUTATIONS, help=argparse.SUPPRESS)
    parser.add_argument("--full", action="store_true", help="run the existing suite too")
    parser.add_argument("--suite-only", action="store_true", help="only the existing suite (for the frozen base)")
    parser.add_argument("--output", type=Path, default=HERE / ".lineack-evidence")
    args = parser.parse_args()
    if args.worker:
        return worker(*args.worker, args.mutation)
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
        report["hints_green_before"] = run_one("test_reply_hints", output, label="hints-green-before")
        report["mutations"] = []
        for mutation, (product, name) in MUTATIONS.items():
            module = "test_reply_hints" if product == "reply_hints" else "test_line_ack"
            row = run_one(module, output, label=mutation, mutation=mutation)
            # Require this specific test's assertion failure, not an unrelated
            # import/setup error which merely happened to exit nonzero.
            target = name.rsplit(".", 1)[-1]
            log = (output / f"{mutation}.log").read_text(encoding="utf-8")
            killed = (row["exit"] == 1 and row["cases"] == [1]
                      and f"FAIL: {target} (" in log and "ERROR:" not in log)
            row.update(mutation=mutation, target_test=name, killed=killed)
            report["mutations"].append(row)
        report["green_restored"] = run_one("test_line_ack", output, label="task-green-restored")
        report["hints_green_restored"] = run_one("test_reply_hints", output, label="hints-green-restored")
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
        if (any(report[k]["exit"] for k in ("green_before", "green_restored", "hints_green_before", "hints_green_restored"))
                or not report["sources_unchanged"] or not all(r["killed"] for r in report["mutations"])):
            return 1
    return 1 if any(r["exit"] for r in report["suite"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
