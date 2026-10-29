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
