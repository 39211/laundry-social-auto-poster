# -*- coding: utf-8 -*-
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import tunnel_manager as tm
from a43_test_support import isolated_legacy_test

PY = sys.executable


class FakeResp:
    def __init__(self, data: bytes):
        self._data = data

    def read(self):
        return self._data


class FakeHttp:
    def __init__(self, get_endpoint):
        self.calls = []
        self.get_endpoint = get_endpoint
        outer = self

        class request:
            class Request:
                def __init__(self, url, data=None, headers=None, method=None):
                    self.full_url = url
                    self.data = data
                    self.headers = headers or {}
                    self.method = method

            @staticmethod
            def urlopen(req, timeout=None):
                method = (req.method or ("PUT" if req.data else "GET")).upper()
                outer.calls.append(
                    {
                        "method": method,
                        "url": req.full_url,
                        "data": req.data,
                        "has_auth": "Authorization" in (req.headers or {}),
                    }
                )
                if method == "PUT":
                    return FakeResp(b"{}")
                return FakeResp(json.dumps({"endpoint": outer.get_endpoint}).encode())

        self.request = request


def test_parse_none():
    assert tm.parse_tunnel_url("") == ""
    assert tm.parse_tunnel_url("no url here") == ""
    assert tm.parse_tunnel_url("http://foo.trycloudflare.com") == ""


def test_parse_first_of_two():
    text = (
        "| https://alpha-one.trycloudflare.com |\n"
        "| https://beta-two.trycloudflare.com |\n"
    )
    assert tm.parse_tunnel_url(text) == "https://alpha-one.trycloudflare.com"


def test_parse_boxed():
    text = "| https://featured-focus-murray-attachments.trycloudflare.com |"
    assert tm.parse_tunnel_url(text) == "https://featured-focus-murray-attachments.trycloudflare.com"


def test_set_webhook_ok():
    base = "https://alpha-one.trycloudflare.com"
    want = base + "/line/webhook"
    http = FakeHttp(get_endpoint=want)
    got = tm.set_webhook_endpoint(base, "dummy-token", http=http)
    assert got == want
    assert [c["method"] for c in http.calls] == ["PUT", "GET"]
    put = http.calls[0]
    assert put["url"] == tm.WEBHOOK_API
    body = json.loads(put["data"].decode())
    assert body == {"endpoint": want}
    assert put["has_auth"]


def test_set_webhook_mismatch():
    http = FakeHttp(get_endpoint="https://other.example/line/webhook")
    try:
        tm.set_webhook_endpoint("https://alpha-one.trycloudflare.com", "dummy-token", http=http)
    except RuntimeError as e:
        assert "mismatch" in str(e)
    else:
        raise AssertionError("expected mismatch")


def test_reader_drains_after_url():
    """F2: after the URL line, child still writes >20_000 bytes and must exit by itself."""
    tmp = Path(tempfile.mkdtemp(prefix="tm-drain-"))
    tm.LOG_PATH = tmp / "tunnel.log"
    child = tmp / "child.py"
    child.write_text(
        "import sys\n"
        "sys.stdout.write('| https://keep-drain.trycloudflare.com |\\n')\n"
        "sys.stdout.flush()\n"
        "chunk = 'Z' * 1000\n"
        "for i in range(25):\n"
        "    sys.stdout.write(chunk + '\\n')\n"
        "    sys.stdout.flush()\n"
        "sys.stdout.write('TAIL_MARKER_OK\\n')\n"
        "sys.stdout.flush()\n",
        encoding="utf-8",
    )
    proc = subprocess.Popen(
        [PY, "-u", str(child)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    url = tm._wait_for_url(proc, timeout=30.0)
    try:
        rc = proc.wait(timeout=20)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)
        raise AssertionError("child blocked (pipe full); reader returned early")
    t = getattr(proc, "_reader_thread", None)
    if t is not None:
        t.join(timeout=5)
    proc.stdout.close()
    assert url == "https://keep-drain.trycloudflare.com", url
    assert rc == 0, rc
    log = tm.LOG_PATH.read_text(encoding="utf-8")
    assert "keep-drain.trycloudflare.com" in log
    assert "TAIL_MARKER_OK" in log
    after = log.split("keep-drain.trycloudflare.com", 1)[1]
    assert "TAIL_MARKER_OK" in after


def test_webhook_retries_then_pending():
    # F4: 1 immediate try + 3 retries at 2/5/10; then pending
    sleeps = []
    n = {"c": 0}

    def boom(base_url, token, http=None, **kwargs):
        n["c"] += 1
        raise urllib.error.HTTPError(
            tm.WEBHOOK_API, 503, "unavailable", None, io.BytesIO()
        )

    orig = tm.set_webhook_endpoint
    tm.set_webhook_endpoint = boom
    tm.PENDING_WEBHOOK["base_url"] = ""
    try:
        ok = tm._set_webhook_with_retries(
            "https://retry.trycloudflare.com", "dummy", sleep=sleeps.append
        )
        assert ok is False
        assert sleeps == [2, 5, 10], sleeps
        assert n["c"] == 4, n["c"]
        tmp = Path(tempfile.mkdtemp(prefix="tm-pub-"))
        orig_base = tm.PUBLIC_BASE
        orig_log = tm.LOG_PATH
        tm.PUBLIC_BASE = tmp / "public_base.txt"
        tm.LOG_PATH = tmp / "tunnel.log"
        tm._publish("https://retry.trycloudflare.com", "dummy", sleep=lambda s: None)
        assert tm.PENDING_WEBHOOK["base_url"] == "https://retry.trycloudflare.com"
        log = tm.LOG_PATH.read_text(encoding="utf-8")
        assert "status=503" in log
        assert "dummy" not in log
        tm.PUBLIC_BASE = orig_base
        tm.LOG_PATH = orig_log
    finally:
        tm.set_webhook_endpoint = orig
        tm.PENDING_WEBHOOK["base_url"] = ""


def test_no_timeout_kills_process():
    # F5: 90s miss must not return 2 from main
    src = Path(__file__).resolve().parent.joinpath("tunnel_manager.py").read_text(encoding="utf-8")
    assert "return 2" not in src
    assert "START_BACKOFFS" in src
    assert "KeyboardInterrupt" in src


def test_log_rotate():
    # F15
    tmp = Path(tempfile.mkdtemp(prefix="tm-rot-"))
    orig = tm.LOG_PATH
    tm.LOG_PATH = tmp / "tunnel.log"
    tm.LOG_PATH.write_bytes(b"x" * (2 * 1024 * 1024 + 50))
    tm._log("after-rotate")
    assert (tmp / "tunnel.log.1").exists()
    text = tm.LOG_PATH.read_text(encoding="utf-8")
    assert "after-rotate" in text
    assert tm.LOG_PATH.stat().st_size < 1024
    tm.LOG_PATH = orig


def test_g3_utf8_replace_and_reader_survives():
    src = Path(__file__).resolve().parent.joinpath("tunnel_manager.py").read_text(encoding="utf-8")
    start = src[src.index("def _start_cloudflared") : src.index("def _spawn_reader")]
    assert 'encoding="utf-8"' in start
    assert 'errors="replace"' in start
    assert "except Exception" in src[src.index("def reader") : src.index("t = threading.Thread")]
    tmp = Path(tempfile.mkdtemp(prefix="tm-g3-"))
    orig = tm.LOG_PATH
    tm.LOG_PATH = tmp / "tunnel.log"
    child = tmp / "child.py"
    child.write_text(
        "import sys\n"
        "sys.stdout.buffer.write(b'| https://g3-utf8.trycloudflare.com |\\n')\n"
        "sys.stdout.buffer.write(b'\\xff\\xfe not ascii\\n')\n"
        "sys.stdout.buffer.write(b'TAIL_G3\\n')\n"
        "sys.stdout.buffer.flush()\n",
        encoding="utf-8",
    )
    proc = subprocess.Popen(
        [PY, "-u", str(child)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    url = tm._wait_for_url(proc, timeout=30.0)
    try:
        rc = proc.wait(timeout=20)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)
        raise AssertionError("child blocked; reader died")
    proc._reader_thread.join(timeout=5)
    proc.stdout.close()
    tm.LOG_PATH = orig
    assert url == "https://g3-utf8.trycloudflare.com", url
    assert rc == 0, rc
    log = (tmp / "tunnel.log").read_text(encoding="utf-8")
    assert "TAIL_G3" in log


def test_g17_timeout_log_distinguishes_exit():
    src = Path(__file__).resolve().parent.joinpath("tunnel_manager.py").read_text(encoding="utf-8")
    assert "cloudflared exited before publishing a url rc=" in src
    assert "no tunnel url within 90s" in src
    main = src[src.index("def main") :]
    assert main.index("proc.poll()") < main.index("no tunnel url within 90s")


# ---- A4-5: health-based restart of a live-but-dead cloudflared ----

A45_FAIL_LINES = (
    "2025-10-31T08:30:00Z ERR failed to serve tunnel connection "
    'error="control stream encountered a failure while serving" connIndex=0 event=0',
    "2025-10-31T08:30:00Z ERR Serve tunnel error "
    'error="control stream encountered a failure while serving" connIndex=0 event=0',
)
A45_REGISTERED = "2025-10-31T08:31:00Z INF Registered tunnel connection connIndex=0 event=0"
A45_UNRELATED = (
    "2025-10-31T08:30:05Z INF Retrying connection in up to 1m4s connIndex=0 event=0",
    "2025-10-31T08:30:06Z WRN Some unrelated warning connIndex=0",
    "2025-10-31T08:30:07Z INF Starting metrics server",
)


class A45FakeProc:
    def __init__(self):
        self._health = tm.TunnelHealth()
        self.returncode = None
        self.killed = 0

    def poll(self):
        return self.returncode

    def kill(self):
        self.killed += 1
        self.returncode = -9

    def wait(self, timeout=None):
        return self.returncode


def _a45_isolate():
    tmp = Path(tempfile.mkdtemp(prefix="tm-a45-"))
    saved = {name: getattr(tm, name) for name in ("LOG_PATH", "EVENTS_PATH", "PUBLIC_BASE")}
    tm.LOG_PATH = tmp / "tunnel.log"
    tm.EVENTS_PATH = tmp / "tunnel_events.jsonl"
    tm.PUBLIC_BASE = tmp / "public_base.txt"
    return saved


def _a45_restore(saved):
    for name, value in saved.items():
        setattr(tm, name, value)


def _a45_events():
    if not tm.EVENTS_PATH.exists():
        return []
    return [json.loads(x) for x in tm.EVENTS_PATH.read_text(encoding="utf-8").splitlines() if x]


def _a45_fail_for(health, start, seconds, step=10):
    t = start
    i = 0
    while t <= start + seconds:
        health.observe(A45_FAIL_LINES[i % len(A45_FAIL_LINES)], t)
        t += step
        i += 1


def test_a45_179_no_restart_180_restart():
    h = tm.TunnelHealth()
    _a45_fail_for(h, 1000.0, 170)
    assert tm.should_restart_unhealthy(h, 1179.0, None) is False
    assert tm.should_restart_unhealthy(h, 1180.0, None) is True
    assert int(h.failing_seconds(1180.0)) == 180


def test_a45_registration_resets_clock():
    h = tm.TunnelHealth()
    _a45_fail_for(h, 1000.0, 90)
    h.observe(A45_REGISTERED, 1100.0)
    assert h.failing_seconds(1100.0) == 0.0
    _a45_fail_for(h, 1150.0, 150)
    assert tm.should_restart_unhealthy(h, 1280.0, None) is False
    assert int(h.failing_seconds(1280.0)) == 130
    assert tm.should_restart_unhealthy(h, 1329.0, None) is False
    assert tm.should_restart_unhealthy(h, 1330.0, None) is True


def test_a45_unrelated_lines_neither_fail_nor_reset():
    h = tm.TunnelHealth()
    for i, line in enumerate(A45_UNRELATED):
        assert tm.classify_tunnel_line(line) == ""
        h.observe(line, 1000.0 + i)
    assert h.failing_seconds(5000.0) == 0.0
    assert tm.should_restart_unhealthy(h, 5000.0, None) is False
    h.observe(A45_FAIL_LINES[0], 2000.0)
    for i, line in enumerate(A45_UNRELATED):
        h.observe(line, 2100.0 + i)
    assert tm.should_restart_unhealthy(h, 2179.0, None) is False
    assert tm.should_restart_unhealthy(h, 2180.0, None) is True
    assert tm.classify_tunnel_line(A45_REGISTERED) == "healthy"
    for line in A45_FAIL_LINES:
        assert tm.classify_tunnel_line(line) == "failing"


def test_a45_min_gap_between_restarts():
    assert tm.UNHEALTHY_RESTART_SECONDS == 180
    assert tm.UNHEALTHY_RESTART_MIN_GAP_SECONDS == 600
    h = tm.TunnelHealth()
    h.observe(A45_FAIL_LINES[0], 1000.0)
    assert tm.should_restart_unhealthy(h, 1180.0, None) is True
    assert tm.should_restart_unhealthy(h, 1779.0, 1180.0) is False
    assert tm.should_restart_unhealthy(h, 1780.0, 1180.0) is True
    saved = _a45_isolate()
    try:
        state = {"last_restart_at": None}
        p1 = A45FakeProc()
        p1._health.observe(A45_FAIL_LINES[0], 1000.0)
        assert tm._restart_if_unhealthy(p1, "https://old-dead.trycloudflare.com", state, 1180.0)
        p2 = A45FakeProc()
        p2._health.observe(A45_FAIL_LINES[1], 1200.0)
        assert not tm._restart_if_unhealthy(p2, "https://b.trycloudflare.com", state, 1779.0)
        assert p2.killed == 0
        assert tm._restart_if_unhealthy(p2, "https://b.trycloudflare.com", state, 1780.0)
        assert p2.killed == 1
        events = [e for e in _a45_events() if e["event"] == "tunnel_unhealthy_restart"]
        assert len(events) == 2, events
        assert events[0]["old_url"] == "https://old-dead.trycloudflare.com"
        assert events[0]["new_url"] == ""
        assert events[0]["failing_seconds"] == 180
    finally:
        _a45_restore(saved)


def _a45_run_main(window):
    """Drive main() with fakes: proc1 fails for 180 s, proc2 starts, then stop."""
    url1 = "https://old-dead.trycloudflare.com"
    url2 = "https://new-live.trycloudflare.com"
    clock = {"t": 1000.0}
    procs = []
    sleeps = []
    put_calls = []

    def fake_start():
        p = A45FakeProc()
        p._health.observe(A45_FAIL_LINES[0], clock["t"])
        procs.append(p)
        return p

    def fake_wait(proc, timeout=90.0):
        return url1 if len(procs) == 1 else url2

    def fake_sleep(seconds):
        sleeps.append(seconds)
        clock["t"] += seconds
        if len(procs) >= 2:
            raise KeyboardInterrupt

    def fake_set(base_url, token, http=None, **kwargs):
        put_calls.append(base_url)
        return base_url + "/line/webhook"

    saved = _a45_isolate()
    patched = {name: getattr(tm, name) for name in (
        "_load_token", "_start_cloudflared", "_wait_for_url",
        "registration_window", "set_webhook_endpoint")}
    tm._load_token = lambda: "dummy-token"
    tm._start_cloudflared = fake_start
    tm._wait_for_url = fake_wait
    tm.registration_window = lambda: window
    tm.set_webhook_endpoint = fake_set
    tm.PENDING_WEBHOOK["base_url"] = ""
    try:
        rc = tm.main(sleep=fake_sleep, clock=lambda: clock["t"])
        return rc, procs, sleeps, put_calls, _a45_events(), url1, url2
    finally:
        for name, value in patched.items():
            setattr(tm, name, value)
        tm.PENDING_WEBHOOK["base_url"] = ""
        _a45_restore(saved)


def test_a45_main_restart_day_never_puts():
    rc, procs, sleeps, put_calls, events, url1, url2 = _a45_run_main("day")
    assert rc == 0
    assert len(procs) == 2, len(procs)
    assert procs[0].killed == 1
    assert sleeps == [60, 60, 60, 60], sleeps
    assert put_calls == [], put_calls
    restarts = [e for e in events if e["event"] == "tunnel_unhealthy_restart"]
    assert len(restarts) == 1, restarts
    assert restarts[0]["old_url"] == url1
    assert restarts[0]["new_url"] == ""
    assert restarts[0]["failing_seconds"] == 180
    tunnel = [e for e in events if e["event"] == "tunnel_url"]
    assert tunnel[-1]["old_url"] == url1 and tunnel[-1]["new_url"] == url2
    skipped = [e for e in events if e["event"] == "skipped_day"]
    assert [e["new_url"] for e in skipped] == [url1 + "/line/webhook", url2 + "/line/webhook"]


def test_a45_main_restart_night_puts_new_url():
    rc, procs, sleeps, put_calls, events, url1, url2 = _a45_run_main("night")
    assert rc == 0
    assert procs[0].killed == 1
    assert put_calls == [url1, url2], put_calls
    assert len([e for e in events if e["event"] == "tunnel_unhealthy_restart"]) == 1
    assert not [e for e in events if e["event"] == "skipped_day"]


for _name, _test in list(globals().items()):
    if _name.startswith("test_") and callable(_test):
        globals()[_name] = isolated_legacy_test(_test)


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(
        unittest.FunctionTestCase(function)
        for name, function in globals().items()
        if name.startswith("test_") and callable(function)
    )


if __name__ == "__main__":
    unittest.main()
