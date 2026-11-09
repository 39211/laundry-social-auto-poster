"""OPS-L1-12: committed HEAD archive, native offline runners, sequential modules.

Only the dated receipt is written to the source/output repository. Tests use
their own isolation; the producer does not install or inject an audit hook.
"""
from __future__ import annotations

import argparse
import ast
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tarfile
import time
import uuid

TAIPEI = timezone(timedelta(hours=8))
ROOT = Path(__file__).resolve().parents[1]
GOLDEN_TIMEOUT_SECONDS = 300
RUN_BUDGET_SECONDS = 780  # Reserve two minutes of Day-Audit's 15-minute limit.
SMOKE_BUDGET_SECONDS = 25
SMOKE_MODULE = "test_bulky_days_1106"
OFFLINE_SITE_PACKAGES = Path("C:/Users/cyc39/AppData/Local/hermes/jarvis-memory/venv/Lib/site-packages")
DEFAULT_WORK_ROOT = Path("D:/AI-Lanes-work/level1-offline-checks")
# Same source set as verify_linebot_full.py, plus golden harness/fixtures.
ARCHIVE_PATHS = ("line-bot", "data", "shop-pc/fxwash/config/Memory.md", "tests/golden")

# Opt in to the native runner's existing runpy(__main__) branch without editing
# the archived runner. Its parent still owns temp creation/cleanup; its worker
# still installs synthetic data, offline_temp, Flask and filesystem/network guards.
SCRIPT_LAUNCHER = """
import subprocess
import sys
import run_a2b_tests as native

def launch(command, **options):
    worker = (
        "import sys; from pathlib import Path; import run_a2b_tests as native; "
        "native._SCRIPT_STYLE_MODULES += (sys.argv[1],); "
        "raise SystemExit(native._run_module(Path(sys.argv[2]), sys.argv[1]))"
    )
    return subprocess.run([sys.executable, '-B', '-X', 'utf8', '-c', worker,
                           sys.argv[1], command[-1]], **options)

raise SystemExit(native.main(launch_worker=launch))
"""


def no_data(reason):
    return dict(status="no_data", tests=0, failures=0, errors=0, skipped=0,
                failed_tests=[], runner_error=reason)


def parse_result(output, returncode, golden=False):
    """Nonzero exits fail; zero needs at least one executed, non-skipped case."""
    failed_tests = re.findall(r"^(?:FAIL|ERROR): (.+)$", output, re.M)
    failed_tests += re.findall(r"^(?:\[FAIL\]|FAIL)\s+(.+)$", output, re.M)
    failed_tests += re.findall(r"first differing case: (\S+)", output)
    counts = dict(failures=0, errors=0, skipped=0)
    if golden:
        match = re.search(r"OK: (\d+) cases byte-identical", output)
        tests = int(match[1]) if match else 0
    elif summaries := list(re.finditer(r"^Ran (\d+) tests? in[^\n]*", output, re.M)):
        # Nested runner tests can print inner summaries; use the outer, last one.
        match = summaries[-1]
        tests = int(match[1])
        summary = output[match.end():]
        counts = {k: int(m[1]) if (m := re.search(r"\b" + k + r"=(\d+)", summary)) else 0
                  for k in counts}
    else:
        passed = len(re.findall(r"^\s*(?:\[PASS\]|PASS\b|ok\b)", output, re.M))
        failed = len(re.findall(r"^\s*(?:\[FAIL\]|FAIL\b)", output, re.M))
        tests = passed + failed
        counts["failures"] = failed
    if returncode != 0:
        status = "fail"
        if not counts["failures"] and not counts["errors"]:
            counts["errors"] = 1
    elif counts["failures"] or counts["errors"]:
        status = "fail"
    else:
        status = "pass" if tests > counts["skipped"] else "no_data"
    return dict(status=status, tests=tests, **counts, failed_tests=failed_tests)


def run_process(command, *, cwd, env, timeout):
    """Run the native runner directly; stop its owned process tree on timeout."""
    options = ({"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt"
               else {"start_new_session": True})
    with subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          text=True, encoding="utf-8", errors="replace", **options) as process:
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired as exc:
            # Only this Popen PID and its descendants; never kill by image name.
            if os.name == "nt":
                try:
                    stopped = subprocess.run(["taskkill.exe", "/PID", str(process.pid), "/T", "/F"],
                                             capture_output=True, timeout=5)
                    if stopped.returncode != 0:
                        raise RuntimeError(stopped.stderr.decode(errors="replace").strip())
                except (OSError, subprocess.SubprocessError, RuntimeError) as cleanup:
                    if process.poll() is None:
                        process.kill()
                    raise RuntimeError("ProcessTreeCleanupFailed: " + str(cleanup)) from exc
            else:
                os.killpg(process.pid, signal.SIGKILL)
            try:
                stdout, stderr = process.communicate(timeout=5)
            except subprocess.TimeoutExpired as cleanup:
                process.kill()
                raise RuntimeError("ProcessTreeCleanupFailed") from cleanup
            raise subprocess.TimeoutExpired(command, timeout, stdout, stderr) from exc
        return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)


def run_check(snapshot, script, args, logs, label, env, timeout=90, *, script_mode=False):
    started = time.monotonic()
    runner = snapshot / script
    try:
        if not runner.is_file():
            raise FileNotFoundError(script)
        # Match trunk: basename module, cwd=line-bot, both import dirs on PYTHONPATH.
        native_args = [args[0].split(".")[-1]] if script == "line-bot/run_a2b_tests.py" else args
        command = [sys.executable, "-B", "-X", "utf8", str(runner), *native_args]
        if script_mode:
            command = [sys.executable, "-B", "-X", "utf8", "-c", SCRIPT_LAUNCHER, *native_args]
        result = run_process(command,
                             cwd=runner.parent, env=env, timeout=timeout)
        output = result.stdout + result.stderr
        if script_mode:
            passed = result.returncode == 0
            row = dict(status="pass" if passed else "fail", tests=1, failures=0,
                       errors=0 if passed else 1, skipped=0, failed_tests=[])
        else:
            row = parse_result(output, result.returncode, script.startswith("tests/golden/"))
        row["exit_code"] = result.returncode
        if row["status"] == "fail" and not row["failed_tests"]:
            row["failure_detail"] = "No test name reported; see module log."
    except (OSError, subprocess.TimeoutExpired, RuntimeError) as exc:
        parts = (exc.stdout, exc.stderr) if isinstance(exc, subprocess.TimeoutExpired) else ()
        output = "".join(p.decode("utf-8", errors="replace") if isinstance(p, bytes) else p or "" for p in parts)
        output += "\nRunner unavailable: " + type(exc).__name__
        if isinstance(exc, RuntimeError):
            output += " " + str(exc)
        row = no_data(type(exc).__name__)
        if isinstance(exc, RuntimeError):
            row["runner_error"] = "ProcessTreeCleanupFailed"
        if script_mode and isinstance(exc, (subprocess.TimeoutExpired, RuntimeError)):
            row.update(status="fail", tests=1, errors=1)
    if script_mode:
        row["execution_mode"] = "script"
        if row["status"] == "fail":
            row["failure_detail"] = "\n".join(output.splitlines()[-20:])[-4000:]
    log = logs / (label.replace("/", "_") + (".script" if script_mode else "") + ".txt")
    log.write_text(output, encoding="utf-8")
    return {**row, "log": str(log), "suite": label, "timeout_seconds": timeout,
            "elapsed_seconds": round(time.monotonic() - started, 3)}


def combine(rows):
    status = "fail" if any(r["status"] == "fail" for r in rows) else "no_data" if not rows or any(r["status"] != "pass" for r in rows) else "pass"
    return {"status": status, **{k: sum(r[k] for r in rows) for k in ("tests", "failures", "errors", "skipped")}, "suites": rows}


def discover_modules(bot):
    """Same corpus and order as the verified trunk script."""
    return (sorted(p.stem for p in bot.glob("test_*.py")) +
            sorted("tests." + p.stem for p in (bot / "tests").glob("test_*.py")))


def has_script_entry(bot, module):
    """Inspect the same basename the native runner imports; never import here."""
    name = module.split(".")[-1] + ".py"
    path = bot / name
    if not path.is_file():
        path = bot / "tests" / name
    try:
        tree = ast.parse(path.read_text(encoding="utf-8-sig"))
    except (OSError, SyntaxError, UnicodeError):
        return False
    for node in tree.body:
        if not isinstance(node, ast.If) or not isinstance(node.test, ast.Compare):
            continue
        test = node.test
        if len(test.ops) != 1 or not isinstance(test.ops[0], ast.Eq):
            continue
        pair = (test.left, test.comparators[0])
        if any(isinstance(a, ast.Name) and a.id == "__name__" and
               isinstance(b, ast.Constant) and b.value == "__main__"
               for a, b in (pair, pair[::-1])):
            return True
    return False


def create_snapshot(root, snapshot, timeout):
    """Freeze HEAD once; archive ignores dirty tracked and untracked files."""
    deadline = time.monotonic() + timeout
    head = subprocess.run(["git", "rev-parse", "--verify", "HEAD^{commit}"], cwd=root,
                          check=True, capture_output=True, text=True, timeout=timeout).stdout.strip()
    archive = snapshot.parent / "source.tar"
    snapshot.mkdir()
    with archive.open("wb") as stream:
        subprocess.run(["git", "archive", "--format=tar", head, *ARCHIVE_PATHS], cwd=root,
                       stdout=stream, stderr=subprocess.PIPE, check=True,
                       timeout=max(0.01, deadline - time.monotonic()))
    with tarfile.open(archive) as source:
        if any(not (m.isfile() or m.isdir()) for m in source.getmembers()):
            raise ValueError("Snapshot contains a link or special file")
        source.extractall(snapshot, filter="data")
    archive.unlink()
    manifest = {p.relative_to(snapshot).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in sorted(snapshot.rglob("*")) if p.is_file()}
    return head, manifest


def check_paths(root, out_root, work_root, receipt):
    protected = [Path(p).resolve() for p in
                 ("C:/Users/cyc39/laundry-repo", "C:/Users/cyc39/Documents/New project 5", "C:/fxwash")]
    pos = protected[-1]
    if any(p == pos or p.is_relative_to(pos) for p in (root, out_root)):
        raise ValueError("POS cannot be a source or output root")
    if any(work_root == p or work_root.is_relative_to(p) for p in [root, out_root, *protected]):
        raise ValueError("Test workspace must be outside source, output, production and POS")
    for production in protected:
        if out_root.is_relative_to(production) and out_root != production:
            raise ValueError("Production output must be its root, not a runtime subfolder")
    if receipt.resolve() != receipt:
        raise ValueError("Receipt path must not be redirected")
    if work_root.drive.upper() == "D:" and not all(Path(p).is_dir() for p in ("D:/C-moved", "D:/AI-Lanes-work")):
        raise ValueError("D: workspace unavailable; no fallback to C:")


def produce(root, out_root, now=None, work_root=DEFAULT_WORK_ROOT, smoke=False):
    started_at = now or datetime.now(TAIPEI)
    started = time.monotonic()
    root, out_root, work_root = (Path(p).resolve() for p in (root, out_root, work_root))
    date = started_at.astimezone(TAIPEI).date().isoformat()
    path = out_root / "output/operations" / (("level1-smoke-" if smoke else "level1-checks-") + date + ".json")
    check_paths(root, out_root, work_root, path)
    work = work_root / ("ops-l1-12-offline-" + uuid.uuid4().hex)
    snapshot, logs = work / "snapshot", work / "logs"
    logs.mkdir(parents=True)
    budget = SMOKE_BUDGET_SECONDS if smoke else RUN_BUDGET_SECONDS
    head, manifest, setup_error = None, {}, None
    try:
        head, manifest = create_snapshot(root, snapshot, min(60, budget))
    except (OSError, subprocess.SubprocessError, ValueError, tarfile.TarError) as exc:
        setup_error = "SnapshotUnavailable:" + type(exc).__name__
        (logs / "snapshot.txt").write_text(setup_error, encoding="utf-8")

    # Strip inherited credentials and live routing, retain ordinary OS variables.
    env = {k: v for k, v in os.environ.items() if not any(s in k.upper() for s in
           ("TOKEN", "SECRET", "PASSWORD", "COOKIE", "API_KEY", "LAUNDRY", "SXJ_", "A2B_", "OPS_L1_"))
           and k.upper() not in ("PYTHONPATH", "PYTHONHOME")}
    bot = snapshot / "line-bot"
    env.update(PYTHONDONTWRITEBYTECODE="1", PYTHONHASHSEED="0", PYTHONUTF8="1", LAUNDRY_AI_CHAT="off",
               PYTHONPATH=os.pathsep.join(map(str, (bot, bot / "tests", OFFLINE_SITE_PACKAGES))),
               LOCALAPPDATA=str(work / "localappdata"), TEMP=str(work), TMP=str(work))
    halted = None

    def bounded_check(script, args, label, timeout=90, *, script_mode=False):
        nonlocal halted
        remaining = budget - (time.monotonic() - started)
        if setup_error or halted or remaining <= 0 or timeout <= 0:
            return {**no_data(setup_error or halted or "DailyBudgetExceeded"), "suite": label}
        options = {"script_mode": True} if script_mode else {}
        row = run_check(snapshot, script, args, logs, label, env, timeout=min(timeout, remaining), **options)
        if row.get("runner_error") == "ProcessTreeCleanupFailed":
            halted = "ProcessTreeCleanupFailed"
        return row

    audit_rows = [bounded_check("line-bot/run_a2b_tests.py", ["tests." + name], "tests." + name)
                  for name in ("test_audit_a_conv", "test_audit_a_quote")]
    print("copy_audit: " + combine(audit_rows)["status"], flush=True)
    golden = (no_data("not run in smoke mode") if smoke else
              bounded_check("tests/golden/run_golden.py", ["check"], "golden", GOLDEN_TIMEOUT_SECONDS))
    print("golden: " + golden["status"], flush=True)
    full = []
    modules = ["test_handoff", SMOKE_MODULE] if smoke else discover_modules(bot)
    for module in modules:
        if module in ("tests.test_audit_a_conv", "tests.test_audit_a_quote"):
            continue
        module_started = time.monotonic()
        row = bounded_check("line-bot/run_a2b_tests.py", [module], module)
        if (row["status"] == "no_data" and row["tests"] == 0 and row.get("exit_code") == 0
                and has_script_entry(bot, module)):
            discovery = row
            row = bounded_check("line-bot/run_a2b_tests.py", [module], module,
                                timeout=90 - (time.monotonic() - module_started), script_mode=True)
            row["discovery"] = discovery
            row["elapsed_seconds"] = round(time.monotonic() - module_started, 3)
        full.append(row)
        print("line_full: {0} {1}".format(module, row["status"]), flush=True)
    handoff = next((r for r in full if r["suite"] == "test_handoff"), None)
    finished_at = now or datetime.now(TAIPEI)
    receipt = {"schema": "level1-offline-smoke/v1" if smoke else "level1-offline-checks/v1",
               "mode": "smoke" if smoke else "full", "date": date,
               "generated_at": finished_at.isoformat(timespec="seconds"), "offline": True,
               "started_at": started_at.isoformat(timespec="seconds"),
               "elapsed_seconds": round(time.monotonic() - started, 3),
               "golden_timeout_seconds": GOLDEN_TIMEOUT_SECONDS, "budget_seconds": budget,
               "scope": "committed HEAD git archive; native runner; sequential; not production or handset acceptance",
               "flask_fallback": str(OFFLINE_SITE_PACKAGES), "source_head": head,
               "source_manifest": manifest, "snapshot": str(snapshot), "snapshot_error": setup_error,
               "checks": {"copy_audit": combine(audit_rows), "golden": golden,
                          "line_full": combine([r for r in full if r["suite"] == SMOKE_MODULE] if smoke else full + audit_rows),
                          "handoff": combine([handoff] if handoff else [])}}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("evidence: " + str(path), flush=True)
    return path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--out-root", type=Path, default=ROOT)
    parser.add_argument("--work-root", type=Path, default=DEFAULT_WORK_ROOT,
                        help="isolated snapshots and logs (default: D:/AI-Lanes-work/level1-offline-checks)")
    parser.add_argument("--smoke", action="store_true", help="copy audit + handoff + one module; separate non-daily receipt")
    args = parser.parse_args(argv)
    path = produce(args.root, args.out_root, work_root=args.work_root, smoke=args.smoke)
    if args.smoke:
        rows = json.loads(path.read_text(encoding="utf-8"))["checks"]
        return 0 if all(rows[k]["status"] == "pass" for k in ("copy_audit", "handoff", "line_full")) else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
