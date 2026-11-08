"""OPS-L1-12 offline evidence producer. Copies source, never customer data.

Run on the actual check date. The scheduled job may read allowlisted source
from its repo, but all tests run on a separate snapshot. Evidence is not
backdated and is not handset or production acceptance.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
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
DEFAULT_WORK_ROOT = Path("D:/AI-Lanes-work/level1-offline-checks")


def child(snapshot, script, arguments):
    """Outer guard also covers runner setup, before its own guard is installed."""
    snapshot = Path(snapshot).resolve()
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
        if event in ("open", "os.listdir", "os.scandir") and args and blocked(args[0]):
            raise PermissionError("OPS-L1-12: production access refused")
        # No network, including loopback; a test requiring sockets is incomplete.
        if event in ("socket.connect", "socket.getaddrinfo", "socket.bind"):
            raise PermissionError("OPS-L1-12: network refused")
        if event in ("subprocess.Popen", "os.system", "os.exec", "os.posix_spawn"):
            raise PermissionError("OPS-L1-12: unguarded child process refused")
    sys.addaudithook(audit)
    os.chdir(snapshot)
    sys.path.insert(0, str(snapshot / "line-bot"))
    sys.argv = [str(snapshot / script), *arguments]
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
    try:
        result = subprocess.run([sys.executable, "-B", "-X", "utf8", str(Path(__file__).resolve()),
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


def produce(root, out_root, now=None, work_root=DEFAULT_WORK_ROOT):
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
                                  "tests/golden/run_golden.py", "tests/golden/linebot_cases.json", "tests/golden/linebot.golden.json")]
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
    def bounded_check(script, args, label, timeout=90):
        remaining = RUN_BUDGET_SECONDS - (time.monotonic() - started)
        if remaining <= 0:
            return {"status": "no_data", "tests": 0, "failures": 0, "errors": 0, "skipped": 0,
                    "suite": label, "runner_error": "DailyBudgetExceeded"}
        return run_check(snapshot, script, args, logs, label, env, timeout=min(timeout, remaining))

    audit_rows = [bounded_check("line-bot/run_a2b_tests.py", ["tests." + name], name)
                  for name in ("test_audit_a_conv", "test_audit_a_quote")]
    print("copy_audit: " + combine(audit_rows)["status"], flush=True)
    golden = bounded_check("tests/golden/run_golden.py", ["check"], "golden", GOLDEN_TIMEOUT_SECONDS)
    print("golden: " + golden["status"], flush=True)
    full = []
    for module_name in discover_modules(snapshot / "line-bot"):
        if module_name in ("tests.test_audit_a_conv", "tests.test_audit_a_quote"):
            continue  # included exactly once below
        row = bounded_check("line-bot/run_a2b_tests.py", [module_name], module_name)
        full.append(row)
        print("line_full: {0} {1}".format(module_name, row["status"]), flush=True)
    handoff = next((r for r in full if r["suite"] == "test_handoff"), None)
    finished_at = now or datetime.now(TAIPEI)
    receipt = {"schema": "level1-offline-checks/v1", "date": started_at.astimezone(TAIPEI).date().isoformat(),
               "generated_at": finished_at.isoformat(timespec="seconds"), "offline": True,
               "started_at": started_at.isoformat(timespec="seconds"),
               "elapsed_seconds": round(time.monotonic() - started, 3),
               "golden_timeout_seconds": GOLDEN_TIMEOUT_SECONDS, "budget_seconds": RUN_BUDGET_SECONDS,
               "scope": "allowlisted repo source snapshot; not production or handset acceptance",
               "source_manifest": manifest, "snapshot": str(snapshot),
               "checks": {"copy_audit": combine(audit_rows), "golden": golden,
                          "line_full": combine(full + audit_rows), "handoff": combine([handoff] if handoff else [])}}
    path = ops / ("level1-checks-" + receipt["date"] + ".json")
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
    args = parser.parse_args(argv)
    produce(args.root, args.out_root, work_root=args.work_root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
