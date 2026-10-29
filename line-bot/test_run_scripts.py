# -*- coding: utf-8 -*-
"""F1/F6/F7/F10-F13: launch quoting, watchdog scripts, purge safety."""
import io
import json
import os
import socket
import subprocess
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import purge_test_rows as purge

HERE = Path(__file__).resolve().parent
RUN_PS1 = HERE / "run_line_bot.ps1"
INSTALL_PS1 = HERE / "install_task.ps1"
VENV_PY = r"C:\Users\cyc39\AppData\Local\hermes\jarvis-memory\venv\Scripts\python.exe"
POWERSHELL = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
MARKER = "LAUNCH_MARKER_OK"


def extract_ps_function(src: str, name: str) -> str:
    needle = "function " + name
    start = src.index(needle)
    i = src.index("{", start)
    depth = 0
    for j in range(i, len(src)):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                return src[start : j + 1]
    raise AssertionError("function not closed: " + name)


def test_ps1_ascii():
    for path in (RUN_PS1, INSTALL_PS1):
        path.read_bytes().decode("ascii")


def test_f1_source_has_extra_quotes():
    src = RUN_PS1.read_text(encoding="ascii")
    fn = extract_ps_function(src, "Get-LaunchArg")
    # r1 was /c `"$Py`"; F1 wraps with an extra pair of quotes: /c `"`"$Py`"
    extra = "/c " + "`" + '"' + "`" + '"' + "$Py"
    assert extra in fn, fn


def test_f1_launch_in_spaced_path():
    """F1 live run: Start-Process cmd with the production Get-LaunchArg form."""
    src = RUN_PS1.read_text(encoding="ascii")
    fn = extract_ps_function(src, "Get-LaunchArg")
    base = Path(tempfile.mkdtemp(prefix="f1-"))
    spaced = base / "a b"
    spaced.mkdir()
    script = spaced / "hello.py"
    log = spaced / "out.log"
    script.write_text("print(%r)\n" % MARKER, encoding="ascii")
    driver = spaced / "driver.ps1"
    # ASCII driver that uses the extracted production function
    body = (
        "$ErrorActionPreference = 'Stop'\r\n"
        + fn
        + "\r\n"
        + "$Py = '%s'\r\n" % VENV_PY.replace("'", "''")
        + "$Script = '%s'\r\n" % str(script).replace("'", "''")
        + "$Log = '%s'\r\n" % str(log).replace("'", "''")
        + "$Work = '%s'\r\n" % str(spaced).replace("'", "''")
        + "$arg = Get-LaunchArg -Py $Py -Script $Script -Log $Log\r\n"
        + "$p = Start-Process -FilePath \"$env:SystemRoot\\System32\\cmd.exe\" "
        + "-ArgumentList $arg -WorkingDirectory $Work -WindowStyle Hidden -PassThru -Wait\r\n"
        + "Write-Output ('cmd_exit=' + $p.ExitCode)\r\n"
        + "exit $p.ExitCode\r\n"
    )
    driver.write_bytes(body.encode("ascii"))
    r = subprocess.run(
        [POWERSHELL, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(driver)],
        capture_output=True,
        timeout=60,
    )
    out = (r.stdout or b"").decode("ascii", "replace")
    err = (r.stderr or b"").decode("ascii", "replace")
    assert r.returncode == 0, (r.returncode, out, err)
    assert log.exists(), (out, err, list(spaced.iterdir()))
    text = log.read_text(encoding="utf-8", errors="replace")
    assert MARKER in text, text
    assert "cmd_exit=0" in out, out


def test_f6_recursive_stop_source():
    src = RUN_PS1.read_text(encoding="ascii")
    assert "function Get-DescendantIds" in src
    assert "ParentProcessId=" in src
    stop = extract_ps_function(src, "Stop-Tracked")
    assert "Get-DescendantIds" in stop
    assert "function Test-CmdMatches" in src
    # G14: live process tree, not a tautology on the "never by image name" comment
    match_fn = extract_ps_function(src, "Test-CmdMatches")
    desc_fn = extract_ps_function(src, "Get-DescendantIds")
    base = Path(tempfile.mkdtemp(prefix="f6-stop-"))
    logs = base / "logs"
    logs.mkdir()
    parent_py = base / "fake_svc.py"
    child_py = base / "fake_svc_child.py"
    child_py.write_text("import time\ntime.sleep(120)\n", encoding="ascii")
    parent_py.write_text(
        "import os, subprocess, sys, time\n"
        "here = os.path.dirname(os.path.abspath(__file__))\n"
        "child = os.path.join(here, 'fake_svc_child.py')\n"
        "p = subprocess.Popen([sys.executable, child])\n"
        "open(os.path.join(here, 'child.pid'), 'w').write(str(p.pid))\n"
        "time.sleep(120)\n",
        encoding="ascii",
    )
    driver = base / "driver.ps1"
    body = (
        "$ErrorActionPreference = 'Stop'\r\n"
        "$Root = '%s'\r\n" % str(base).replace("'", "''")
        + "$LogDir = '%s'\r\n" % str(logs).replace("'", "''")
        + "$Py = '%s'\r\n" % VENV_PY.replace("'", "''")
        + desc_fn
        + "\r\n"
        + match_fn
        + "\r\n"
        + stop
        + "\r\n"
        + "$scriptPath = Join-Path $Root 'fake_svc.py'\r\n"
        + "$p = Start-Process -FilePath $Py -ArgumentList '-u', $scriptPath "
        + "-WorkingDirectory $Root -WindowStyle Hidden -PassThru\r\n"
        + "Set-Content -Path (Join-Path $LogDir 'fake_svc.pid') -Value ([string]$p.Id) -Encoding ASCII\r\n"
        + "$deadline = (Get-Date).AddSeconds(15)\r\n"
        + "while (-not (Test-Path (Join-Path $Root 'child.pid'))) {\r\n"
        + "  if ((Get-Date) -gt $deadline) { throw 'child.pid missing' }\r\n"
        + "  Start-Sleep -Milliseconds 200\r\n"
        + "}\r\n"
        + "Start-Sleep -Seconds 1\r\n"
        + "$childId = [int]((Get-Content (Join-Path $Root 'child.pid') | Select-Object -First 1).Trim())\r\n"
        + "Write-Output ('parent=' + $p.Id + ' child=' + $childId)\r\n"
        + "$result = Stop-Tracked -Name 'fake_svc'\r\n"
        + "Write-Output $result\r\n"
        + "Start-Sleep -Seconds 1\r\n"
        + "$parentAlive = [bool](Get-Process -Id $p.Id -ErrorAction SilentlyContinue)\r\n"
        + "$childAlive = [bool](Get-Process -Id $childId -ErrorAction SilentlyContinue)\r\n"
        + "Write-Output ('parentAlive=' + $parentAlive + ' childAlive=' + $childAlive)\r\n"
        + "if ($parentAlive -or $childAlive) { exit 1 }\r\n"
        + "exit 0\r\n"
    )
    driver.write_bytes(body.encode("ascii"))
    r = subprocess.run(
        [POWERSHELL, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(driver)],
        capture_output=True,
        timeout=60,
    )
    out = (r.stdout or b"").decode("ascii", "replace")
    err = (r.stderr or b"").decode("ascii", "replace")
    if r.returncode != 0:
        for extra in (r.stdout, r.stderr):
            pass
        try:
            child_pid_path = base / "child.pid"
            parent_pid = None
            if (logs / "fake_svc.pid").exists():
                parent_pid = (logs / "fake_svc.pid").read_text(encoding="ascii").strip()
            child_pid = child_pid_path.read_text(encoding="ascii").strip() if child_pid_path.exists() else ""
            for pid in (parent_pid, child_pid):
                if pid:
                    subprocess.run(
                        ["taskkill", "/PID", str(pid), "/T", "/F"],
                        capture_output=True,
                        timeout=10,
                    )
        except Exception:
            pass
    assert r.returncode == 0, (r.returncode, out, err)
    assert "parentAlive=False" in out, out
    assert "childAlive=False" in out, out
    assert "result=ok" in out, out


def test_f7_idempotent_and_probe_source():
    src = RUN_PS1.read_text(encoding="ascii")
    assert "[switch]$Probe" in src
    start = extract_ps_function(src, "Start-Tracked")
    assert "Test-TrackedAlive" in start
    assert "skip" in start
    inst = INSTALL_PS1.read_text(encoding="ascii")
    assert "-RestartCount" not in inst
    assert "AtLogOn" in inst
    assert "Minutes 5" in inst
    assert "[TimeSpan]::MaxValue" not in inst
    assert "Days 3650" in inst
    assert "IgnoreNew" in inst
    assert "[switch]$Stop" in src
    assert "mutually exclusive" in src
    start = extract_ps_function(src, "Start-Tracked")
    assert "Start-Process -FilePath $Python" in start
    assert "RedirectStandardOutput" in start
    assert "RedirectStandardError" in start
    assert "start failed" in start
    assert "cmd.exe" not in start
    assert "5MB" in src
    stop_block = src[src.index("if ($Stop)") :]
    assert stop_block.index("tunnel_manager") < stop_block.index("staff_server")
    assert stop_block.index("staff_server") < stop_block.index("line_webhook")


def test_f7_probe_runs_without_starting():
    # -Command + quoted path: -File splits on spaces in some hosts
    cmd = "& '" + str(RUN_PS1).replace("'", "''") + "' -Probe; exit $LASTEXITCODE"
    r = subprocess.run(
        [POWERSHELL, "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd],
        capture_output=True,
        timeout=20,
    )
    out = (r.stdout or b"").decode("ascii", "replace") + (r.stderr or b"").decode("ascii", "replace")
    assert r.returncode in (0, 1), (r.returncode, out)
    assert "line_webhook" in out, out
    assert "staff_server" in out, out
    assert "tunnel_manager" in out, out
    assert "healthz" in out, out
    match_fn = extract_ps_function(RUN_PS1.read_text(encoding="ascii"), "Test-CmdMatches")
    assert "$Root" in match_fn
    assert "test_" in match_fn


def test_p1_healthz_pid_match_tree():
    """P2: live tree for Test-HealthzPidMatch -- self / descendant / unrelated."""
    src = RUN_PS1.read_text(encoding="ascii")
    desc_fn = extract_ps_function(src, "Get-DescendantIds")
    match_fn = extract_ps_function(src, "Test-HealthzPidMatch")
    base = Path(tempfile.mkdtemp(prefix="p1-hz-"))
    child_py = base / "child.py"
    parent_py = base / "parent.py"
    child_py.write_text("import time\ntime.sleep(120)\n", encoding="ascii")
    parent_py.write_text(
        "import os, subprocess, sys, time\n"
        "here = os.path.dirname(os.path.abspath(__file__))\n"
        "child = os.path.join(here, 'child.py')\n"
        "p = subprocess.Popen([sys.executable, child])\n"
        "open(os.path.join(here, 'child.pid'), 'w').write(str(p.pid))\n"
        "time.sleep(120)\n",
        encoding="ascii",
    )
    driver = base / "driver.ps1"
    body = (
        "$ErrorActionPreference = 'Stop'\r\n"
        "$Root = '%s'\r\n" % str(base).replace("'", "''")
        + "$Py = '%s'\r\n" % VENV_PY.replace("'", "''")
        + desc_fn
        + "\r\n"
        + match_fn
        + "\r\n"
        + "$scriptPath = Join-Path $Root 'parent.py'\r\n"
        + "$p = Start-Process -FilePath $Py -ArgumentList '-u', $scriptPath "
        + "-WorkingDirectory $Root -WindowStyle Hidden -PassThru\r\n"
        + "$deadline = (Get-Date).AddSeconds(15)\r\n"
        + "while (-not (Test-Path (Join-Path $Root 'child.pid'))) {\r\n"
        + "  if ((Get-Date) -gt $deadline) { throw 'child.pid missing' }\r\n"
        + "  Start-Sleep -Milliseconds 200\r\n"
        + "}\r\n"
        + "Start-Sleep -Seconds 1\r\n"
        + "$childId = [int]((Get-Content (Join-Path $Root 'child.pid') | Select-Object -First 1).Trim())\r\n"
        + "$tracked = [int]$p.Id\r\n"
        + "$unrelated = [int]$PID\r\n"
        + "if ($unrelated -eq $tracked -or $unrelated -eq $childId) { $unrelated = 999999 }\r\n"
        + "$a = Test-HealthzPidMatch -ReportedPid $tracked -TrackedPid $tracked\r\n"
        + "$b = Test-HealthzPidMatch -ReportedPid $childId -TrackedPid $tracked\r\n"
        + "$c = Test-HealthzPidMatch -ReportedPid $unrelated -TrackedPid $tracked\r\n"
        + "Write-Output ('parent=' + $tracked + ' child=' + $childId + ' unrelated=' + $unrelated)\r\n"
        + "Write-Output ('a=' + $a)\r\n"
        + "Write-Output ('b=' + $b)\r\n"
        + "Write-Output ('c=' + $c)\r\n"
        + "Stop-Process -Id $childId -Force -ErrorAction SilentlyContinue\r\n"
        + "Stop-Process -Id $tracked -Force -ErrorAction SilentlyContinue\r\n"
        + "$kids = Get-DescendantIds -RootId $tracked\r\n"
        + "if ($kids) {\r\n"
        + "  foreach ($k in $kids) { Stop-Process -Id $k -Force -ErrorAction SilentlyContinue }\r\n"
        + "}\r\n"
        + "if ($a -ne $true) { exit 11 }\r\n"
        + "if ($b -ne $true) { exit 12 }\r\n"
        + "if ($c -ne $false) { exit 13 }\r\n"
        + "exit 0\r\n"
    )
    driver.write_bytes(body.encode("ascii"))
    r = subprocess.run(
        [POWERSHELL, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(driver)],
        capture_output=True,
        timeout=60,
    )
    out = (r.stdout or b"").decode("ascii", "replace")
    err = (r.stderr or b"").decode("ascii", "replace")
    try:
        child_pid_path = base / "child.pid"
        parent_pid = None
        child_pid = child_pid_path.read_text(encoding="ascii").strip() if child_pid_path.exists() else ""
        for line in out.splitlines():
            if line.startswith("parent="):
                parent_pid = line.split()[0].split("=", 1)[-1]
        for pid in (parent_pid, child_pid):
            if pid:
                subprocess.run(
                    ["taskkill", "/PID", str(pid), "/T", "/F"],
                    capture_output=True,
                    timeout=10,
                )
    except Exception:
        pass
    assert r.returncode == 0, (r.returncode, out, err)
    assert "a=True" in out, out
    assert "b=True" in out, out
    assert "c=False" in out, out


def test_purge_flags():
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = purge.main(["--apply", "--dry-run"])
    assert rc == 2
    assert "cannot be used together" in buf.getvalue()
    with redirect_stdout(io.StringIO()):
        rc2 = purge.main([])
    assert rc2 == 0


def test_purge_uid_rules():
    assert purge.is_test_uid("U" + "a" * 32) is False
    assert purge.is_test_uid("U" + "AB" + "c" * 30) is False  # mixed case hex
    assert purge.is_test_uid("Utest") is True
    assert purge.is_test_uid("?") is True
    tmp = Path(tempfile.mkdtemp(prefix="purge-"))
    real = "U" + "abcdef" + "0" * 26
    upper = "U" + "ABCDEF" + "1" * 26
    (tmp / "line-bookings.jsonl").write_text(
        json.dumps({"uid": real, "id": "A"}) + "\n"
        + json.dumps({"uid": upper, "id": "U1"}) + "\n"
        + json.dumps({"uid": "Utest", "id": "B"}) + "\n"
        + json.dumps({"id": "C", "text": "no uid field"}) + "\n",
        encoding="utf-8",
    )
    (tmp / "staff-inbox.jsonl").write_text("", encoding="utf-8")
    (tmp / "line-sessions.json").write_text("{}", encoding="utf-8")
    (tmp / "line-customer-bind.json").write_text("{}", encoding="utf-8")
    p = purge.plan(tmp)
    moved = p["jsonl"]["line-bookings.jsonl"]["move"]
    assert [row["id"] for row in moved] == ["B"], moved
    nous = p["no_uid"]["line-bookings.jsonl"]
    assert [row["id"] for row in nous] == ["C"], nous
    backup = purge.apply(p, tmp)
    assert backup.exists()
    json.loads(backup.read_text(encoding="utf-8"))
    live = (tmp / "line-bookings.jsonl").read_text(encoding="utf-8")
    assert real in live and upper in live
    assert "Utest" not in live
    assert "no uid field" in live


def test_purge_backup_before_replace_source():
    src = (HERE / "purge_test_rows.py").read_text(encoding="utf-8")
    apply_fn = src[src.index("def apply") : src.index("def main")]
    assert "fsync" in apply_fn
    assert "json.loads(backup" in apply_fn
    assert apply_fn.index("fsync") < apply_fn.index("_atomic_write")
    assert apply_fn.index("json.loads(backup") < apply_fn.index("_atomic_write")


def test_purge_apply_refuses_when_busy():
    orig = purge.bot_ports_busy
    purge.bot_ports_busy = lambda: True
    try:
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = purge.main(["--apply"])
        assert rc == 2
        assert "請先停止 bot 再跑" in buf.getvalue()
    finally:
        purge.bot_ports_busy = orig


def test_port_listening_ephemeral():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    s.listen(1)
    port = s.getsockname()[1]
    try:
        assert port not in (8791, 8792)
        assert purge._port_listening(port) is True
    finally:
        s.close()
    assert purge._port_listening(port) is False


if __name__ == "__main__":
    test_ps1_ascii()
    test_f1_source_has_extra_quotes()
    test_f1_launch_in_spaced_path()
    test_f6_recursive_stop_source()
    test_f7_idempotent_and_probe_source()
    test_f7_probe_runs_without_starting()
    test_p1_healthz_pid_match_tree()
    test_purge_flags()
    test_purge_uid_rules()
    test_purge_backup_before_replace_source()
    test_purge_apply_refuses_when_busy()
    test_port_listening_ephemeral()
    print("PASS", 12)
