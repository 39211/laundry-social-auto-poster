"""OPS-L1-12 offline evidence producer. Copies source, never customer data.

Run on the actual check date. The scheduled job may read allowlisted source
from its repo, but all tests run on a separate snapshot. Evidence is not
backdated and is not handset or production acceptance.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import sys
import time
import uuid

TAIPEI = timezone(timedelta(hours=8))
ROOT = Path(__file__).resolve().parents[1]
GOLDEN_TIMEOUT_SECONDS = 300
RUN_BUDGET_SECONDS = 600  # Leave room in Laundry-Day-Audit's existing 15-min limit.
SMOKE_BUDGET_SECONDS = 25  # Reserve five seconds for receipt/cleanup overhead.
SMOKE_MODULE = "test_bulky_days_1106"
# Same existing test dependency used by collab/trunk/verify_linebot_full.py.
# Read-only fallback, no installation and no production application imports.
OFFLINE_SITE_PACKAGES = Path("C:/Users/cyc39/AppData/Local/hermes/jarvis-memory/venv/Lib/site-packages")
DEFAULT_WORK_ROOT = Path("D:/AI-Lanes-work/level1-offline-checks")


def child(snapshot, script, arguments):
    """Outer guard also covers runner setup, before its own guard is installed."""
    snapshot = Path(snapshot).resolve()
    runner = snapshot / "line-bot/run_a2b_tests.py"
    producer = snapshot / "scripts/level1_offline_checks.py"
    if script not in ("line-bot/run_a2b_tests.py", "tests/golden/run_golden.py"):
        raise ValueError("OPS-L1-12: unknown runner")
    is_parent = script == "line-bot/run_a2b_tests.py" and len(arguments) == 1
    is_worker = script == "line-bot/run_a2b_tests.py" and len(arguments) == 3 and arguments[0] == "--worker"
    module = arguments[0] if is_parent else arguments[1] if is_worker else None
    if module is not None and (not re.fullmatch(r"(?:tests\.)?test_[a-zA-Z0-9_]+", module)
                               or not (snapshot / "line-bot" / (module.replace(".", "/") + ".py")).is_file()):
        raise ValueError("OPS-L1-12: unknown test module")
    if not (is_parent or is_worker or script == "tests/golden/run_golden.py" and arguments == ["check"]):
        raise ValueError("OPS-L1-12: unexpected runner arguments")

    def owned_temp(value):
        path = Path(value).absolute()
        token = path.name.removeprefix(".a2b-test-tmp-")
        if (path.parent != runner.parent or not re.fullmatch(r"[0-9a-f]{32}", token)
                or path.is_symlink() or path.is_junction() or path.resolve() != path
                or (path / ".a2b-owner").read_text(encoding="ascii") != token):
            raise ValueError("OPS-L1-12: unowned worker temp directory")
        return str(path)

    if is_worker:
        owned_temp(arguments[2])
    pending_launch = None
    protected = [Path(p).resolve() for p in (
        "C:/fxwash", "C:/Users/cyc39/laundry-repo", "C:/Users/cyc39/Documents/New project 5")]

    def blocked(path):
        if not isinstance(path, (str, bytes, os.PathLike)):
            return False
        try:
            candidate = Path(os.fsdecode(path)).resolve()
            return any(candidate == p or candidate.is_relative_to(p) for p in protected)
        except (OSError, ValueError):
            return True

    # Tests that merely probe a legacy path see absence, without reading it.
    for name in ("exists", "is_file", "is_dir"):
        original = getattr(Path, name)
        def probe(path, *args, _original=original, **kwargs):
            return False if blocked(path) else _original(path, *args, **kwargs)
        setattr(Path, name, probe)

    def audit(event, args):
        nonlocal pending_launch
        if event in ("open", "os.listdir", "os.scandir") and args and blocked(args[0]):
            raise PermissionError("OPS-L1-12: production access refused")
        writes = {"os.mkdir": (0,), "os.remove": (0,), "os.rmdir": (0,), "os.rename": (0, 1),
                  "os.chmod": (0,), "os.truncate": (0,), "os.utime": (0,),
                  "os.link": (0, 1), "os.symlink": (0, 1)}.get(event, ())
        if event == "open" and len(args) > 2:
            mode, flags = args[1:3]
            if (isinstance(mode, str) and any(c in mode for c in "wax+")) or (
                    isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND)):
                writes = (0,)
        for index in writes:
            if index < len(args) and isinstance(args[index], (str, bytes, os.PathLike)):
                path = Path(os.fsdecode(args[index])).resolve()
                if not path.is_relative_to(snapshot.parent) or blocked(path):
                    raise PermissionError("OPS-L1-12: write outside isolated workspace refused")
        # No network, including loopback; a test requiring sockets is incomplete.
        if event in ("socket.connect", "socket.getaddrinfo", "socket.bind", "socket.sendto",
                     "socket.sendmsg", "socket.gethostbyname", "socket.gethostbyaddr"):
            raise PermissionError("OPS-L1-12: network refused")
        if event in ("subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn", "os.startfile", "os.fork"):
            # One exact launch, armed only by the producer-owned callback. The
            # worker starts this producer again and gets a fresh, unarmed guard.
            if event == "subprocess.Popen" and pending_launch is not None and args == pending_launch:
                pending_launch = None
                return
            raise PermissionError("OPS-L1-12: unguarded child process refused")
    sys.addaudithook(audit)
    os.chdir(snapshot)
    sys.path.insert(0, str(snapshot / "line-bot"))
    if script == "line-bot/run_a2b_tests.py" and importlib.util.find_spec("flask") is None:
        if (OFFLINE_SITE_PACKAGES / "flask/__init__.py").is_file():
            sys.path.append(str(OFFLINE_SITE_PACKAGES))
    sys.argv = [str(snapshot / script), *arguments]
    if is_parent:
        def launch_worker(command, *, check=False):
            nonlocal pending_launch
            if (check is not False or len(command) != 8 or command[:7] !=
                    [sys.executable, "-B", "-X", "utf8", str(runner), "--worker", module]):
                raise PermissionError("OPS-L1-12: unexpected worker command")
            temp = owned_temp(command[7])
            wrapped = [sys.executable, "-B", "-X", "utf8", str(producer), "--child", str(snapshot),
                       script, "--worker", module, temp]
            env = dict(os.environ)
            # Popen's Windows audit event contains the quoted command line.
            pending_launch = (sys.executable, subprocess.list2cmdline(wrapped) if os.name == "nt" else wrapped,
                              str(snapshot), env)
            remaining = float(env["OPS_L1_DEADLINE"]) - time.monotonic() - 3
            if remaining <= 0:
                pending_launch = None
                raise subprocess.TimeoutExpired(wrapped, 0)
            try:
                return subprocess.run(wrapped, executable=sys.executable, cwd=str(snapshot),
                                      env=env, check=False, timeout=remaining)
            finally:
                pending_launch = None
        namespace = runpy.run_path(str(runner), run_name="_ops_l1_runner")
        raise SystemExit(namespace["main"](launch_worker=launch_worker))
    runpy.run_path(str(snapshot / script), run_name="__main__")


def parse_result(output, returncode, golden=False):
    if golden:
        match = re.search(r"OK: (\d+) cases byte-identical", output)
        return {"status": "pass" if returncode == 0 and match else "fail" if returncode == 1 else "no_data",
                "tests": int(match[1]) if match else 0, "failures": int(returncode == 1), "errors": 0, "skipped": 0}
    match = re.search(r"Ran (\d+) tests? in", output)
    if match:
        tests = int(match[1])
        counts = {key: int(m[1]) if (m := re.search(r"\b" + key + r"=(\d+)", output)) else 0
                  for key in ("failures", "errors", "skipped")}
        passed = returncode == 0 and re.search(r"^OK(?:\s|$)", output, re.M) and tests and not any(counts.values())
        return {"status": "pass" if passed else "fail" if counts["failures"] or counts["errors"] else "no_data",
                "tests": tests, **counts}
    # The existing two script-style modules report [PASS]/[FAIL] per case.
    passed = len(re.findall(r"\[PASS\]|^PASS\b|^\s*ok\b", output, re.M))
    failed = len(re.findall(r"\[FAIL\]|^FAIL\b", output, re.M))
    return {"status": "pass" if returncode == 0 and passed and not failed else "fail" if failed else "no_data",
            "tests": passed + failed, "failures": failed, "errors": int(returncode != 0 and not failed), "skipped": 0}


def run_check(snapshot, script, args, logs, label, env, timeout=90):
    started = time.monotonic()
    env = dict(env, OPS_L1_DEADLINE=str(started + timeout))
    try:
        result = subprocess.run([sys.executable, "-B", "-X", "utf8", str(snapshot / "scripts/level1_offline_checks.py"),
                                 "--child", str(snapshot), script, *args],
                                cwd=snapshot, env=env, capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=timeout)
        output = result.stdout + result.stderr
        row = parse_result(output, result.returncode, script.startswith("tests/golden/"))
        row["exit_code"] = result.returncode
    except (OSError, subprocess.TimeoutExpired) as exc:
        # Keep synthetic partial output to distinguish timeouts from assertions.
        parts = (exc.stdout, exc.stderr) if isinstance(exc, subprocess.TimeoutExpired) else ()
        output = "".join(p.decode("utf-8", errors="replace") if isinstance(p, bytes) else p or "" for p in parts)
        output += "\nRunner unavailable: " + type(exc).__name__
        row = {"status": "no_data", "tests": 0, "failures": 0, "errors": 0, "skipped": 0}
        row["runner_error"] = type(exc).__name__
    log = logs / (label.replace("/", "_") + ".txt")
    log.write_text(output, encoding="utf-8")
    return {**row, "log": str(log), "suite": label, "timeout_seconds": timeout,
            "elapsed_seconds": round(time.monotonic() - started, 3)}


def combine(rows):
    status = "fail" if any(r["status"] == "fail" for r in rows) else "no_data" if not rows or any(r["status"] != "pass" for r in rows) else "pass"
    return {"status": status, **{k: sum(r[k] for r in rows) for k in ("tests", "failures", "errors", "skipped")}, "suites": rows}


def discover_modules(bot):
    """Nested regression suites are part of the full LINE test corpus too."""
    return [".".join(p.relative_to(bot).with_suffix("").parts)
            for p in sorted(Path(bot).rglob("test_*.py"))
            if not any(part.startswith(".") or part == "__pycache__" for part in p.relative_to(bot).parts)]


def produce(root, out_root, now=None, work_root=DEFAULT_WORK_ROOT, smoke=False):
    started_at = now or datetime.now(TAIPEI)
    started = time.monotonic()
    root, out_root = Path(root).resolve(), Path(out_root).resolve()
    work_root = Path(work_root).resolve()
    # The parent copies code only. Children cannot read the live repo or POS.
    forbidden = [Path(p).resolve() for p in ("C:/Users/cyc39/laundry-repo", "C:/Users/cyc39/Documents/New project 5", "C:/fxwash")]
    pos = forbidden[-1]
    if any(p == pos or p.is_relative_to(pos) for p in (root, out_root)):
        raise ValueError("POS cannot be a source or output root")
    if any(work_root == p or work_root.is_relative_to(p) for p in forbidden):
        raise ValueError("Test workspace must be outside production and POS")
    if work_root.drive.upper() == "D:" and not all(Path(p).is_dir() for p in ("D:/C-moved", "D:/AI-Lanes-work")):
        raise ValueError("D: workspace unavailable; no fallback to C:")
    ops = out_root / "output/operations"
    ops.mkdir(parents=True, exist_ok=True)
    work = work_root / ("ops-l1-12-offline-" + uuid.uuid4().hex)
    snapshot = work / "snapshot"
    logs = work / "logs"
    logs.mkdir(parents=True)
    sources = list((root / "line-bot").rglob("*.py")) + list((root / "line-bot").glob("*.ps1"))
    sources += list((root / "line-bot/test-assets").glob("*"))
    sources += [root / p for p in ("line-bot/handover.json", "data/prices.json", "data/business-profile.json",
                                  "scripts/level1_offline_checks.py", "tests/golden/run_golden.py",
                                  "tests/golden/linebot_cases.json", "tests/golden/linebot.golden.json")]
    manifest = {}
    for source in sorted(set(sources)):
        if not source.is_file() or source.is_symlink() or source.stat().st_size > 2_000_000:
            continue
        rel = source.relative_to(root)
        if any(p.startswith(".") or p == "__pycache__" for p in rel.parts):
            continue
        target = snapshot / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        content = source.read_bytes()
        target.write_bytes(content)
        manifest[rel.as_posix()] = hashlib.sha256(content).hexdigest()
    # Strip inherited credentials and runtime routing; retain ordinary OS vars.
    env = {k: v for k, v in os.environ.items() if not any(s in k.upper() for s in
           ("TOKEN", "SECRET", "PASSWORD", "COOKIE", "API_KEY", "LAUNDRY", "SXJ_"))}
    env.update(PYTHONDONTWRITEBYTECODE="1", PYTHONHASHSEED="0", PYTHONUTF8="1",
               LOCALAPPDATA=str(work / "localappdata"), TEMP=str(work), TMP=str(work))
    budget = SMOKE_BUDGET_SECONDS if smoke else RUN_BUDGET_SECONDS
    def bounded_check(script, args, label, timeout=90):
        remaining = budget - (time.monotonic() - started)
        if remaining <= 0:
            return {"status": "no_data", "tests": 0, "failures": 0, "errors": 0, "skipped": 0,
                    "suite": label, "runner_error": "DailyBudgetExceeded"}
        return run_check(snapshot, script, args, logs, label, env, timeout=min(timeout, remaining))

    audit_rows = [bounded_check("line-bot/run_a2b_tests.py", ["tests." + name], name)
                  for name in ("test_audit_a_conv", "test_audit_a_quote")]
    print("copy_audit: " + combine(audit_rows)["status"], flush=True)
    golden = ({"status": "no_data", "tests": 0, "failures": 0, "errors": 0, "skipped": 0,
               "reason": "not run in smoke mode"} if smoke else
              bounded_check("tests/golden/run_golden.py", ["check"], "golden", GOLDEN_TIMEOUT_SECONDS))
    print("golden: " + golden["status"], flush=True)
    full = []
    modules = ["test_handoff", SMOKE_MODULE] if smoke else discover_modules(snapshot / "line-bot")
    for module_name in modules:
        if module_name in ("tests.test_audit_a_conv", "tests.test_audit_a_quote"):
            continue  # included exactly once below
        row = bounded_check("line-bot/run_a2b_tests.py", [module_name], module_name)
        full.append(row)
        print("line_full: {0} {1}".format(module_name, row["status"]), flush=True)
    handoff = next((r for r in full if r["suite"] == "test_handoff"), None)
    finished_at = now or datetime.now(TAIPEI)
    receipt = {"schema": "level1-offline-smoke/v1" if smoke else "level1-offline-checks/v1",
               "mode": "smoke" if smoke else "full", "date": started_at.astimezone(TAIPEI).date().isoformat(),
               "generated_at": finished_at.isoformat(timespec="seconds"), "offline": True,
               "started_at": started_at.isoformat(timespec="seconds"),
               "elapsed_seconds": round(time.monotonic() - started, 3),
               "golden_timeout_seconds": GOLDEN_TIMEOUT_SECONDS, "budget_seconds": budget,
               "scope": "allowlisted repo source snapshot; not production or handset acceptance",
               "flask_fallback": str(OFFLINE_SITE_PACKAGES),
               "source_manifest": manifest, "snapshot": str(snapshot),
               "checks": {"copy_audit": combine(audit_rows), "golden": golden,
                          "line_full": combine([r for r in full if r["suite"] == SMOKE_MODULE] if smoke else full + audit_rows),
                          "handoff": combine([handoff] if handoff else [])}}
    path = ops / (("level1-smoke-" if smoke else "level1-checks-") + receipt["date"] + ".json")
    path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("evidence: " + str(path), flush=True)
    return path


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] == "--child":
        child(argv[1], argv[2], argv[3:])
        return 0
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
