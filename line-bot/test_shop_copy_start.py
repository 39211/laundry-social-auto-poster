# -*- coding: utf-8 -*-
"""11/11: run_line_bot.ps1 Start-ShopCopy keeps the shop copy up (logon + every 5 min).

Runs the production function against a fake shop-copy tree on a free port:
gate on LAUNDRY_TUNNEL_ORIGIN_PORT, start when nothing listens, keep old logs,
and never start a second copy while one is listening.
"""
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_run_scripts import POWERSHELL, RUN_PS1, extract_ps_function  # noqa: E402

FAKE_SERVER = (
    "import sys, http.server\n"
    "port = int(sys.argv[1])\n"
    "http.server.HTTPServer(('127.0.0.1', port), http.server.SimpleHTTPRequestHandler).serve_forever()\n"
)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    assert port not in (8791, 8792, 18791)
    return port


def listening(port):
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


class ShopCopyStartTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "copy"
        (self.root / "runtime").mkdir(parents=True)
        (self.root / "logs").mkdir()
        (self.root / "runtime" / "webhook_server.py").write_text(FAKE_SERVER, encoding="ascii")
        (self.root / "logs" / "webhook_server.log").write_text("previous night log\n", encoding="ascii")
        self.port = free_port()
        self.started = []

    def tearDown(self):
        for pid in self.started:
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
        time.sleep(0.5)
        self.tmp.cleanup()

    def call(self, tunnel_port):
        fn = extract_ps_function(RUN_PS1.read_text(encoding="ascii"), "Start-ShopCopy")
        driver = Path(self.tmp.name) / "driver.ps1"
        body = (fn + "\r\n"
                + "$env:LAUNDRY_TUNNEL_ORIGIN_PORT = '" + str(tunnel_port) + "'\r\n"
                + "Start-ShopCopy -CopyRoot '" + str(self.root) + "' -Port " + str(self.port)
                + " -Py '" + sys.executable + "'\r\n")
        driver.write_bytes(body.encode("ascii"))
        # Output goes to a file, not a pipe: the started copy inherits handles and never exits,
        # so a pipe would never reach EOF.
        outf = Path(self.tmp.name) / ("driver-%d.out" % len(self.started))
        with open(outf, "wb") as fh:
            subprocess.run([POWERSHELL, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(driver)],
                           stdin=subprocess.DEVNULL, stdout=fh, stderr=subprocess.STDOUT, timeout=60)
        out = outf.read_bytes().decode("ascii", "replace").strip()
        m = re.search(r"started pid=(\d+)", out)
        if m:
            self.started.append(int(m.group(1)))
        return out

    def wait_listening(self):
        for _ in range(40):
            if listening(self.port):
                return True
            time.sleep(0.25)
        return False

    def test_skips_when_tunnel_not_on_shop_copy(self):
        out = self.call(8791)
        self.assertIn("shop_copy skip", out)
        time.sleep(1.5)
        self.assertFalse(listening(self.port))
        self.assertEqual(self.started, [])

    def test_starts_keeps_old_log_and_never_starts_twice(self):
        out = self.call(self.port)
        self.assertIn("shop_copy started pid=", out)
        self.assertTrue(self.wait_listening(), "shop copy did not come up")
        kept = [p.name for p in (self.root / "logs").iterdir()
                if re.fullmatch(r"webhook_server\.\d{8}-\d{6}\.log", p.name)]
        self.assertEqual(len(kept), 1)
        self.assertEqual((self.root / "logs" / kept[0]).read_text(encoding="ascii"), "previous night log\n")
        again = self.call(self.port)
        self.assertIn("shop_copy alive pid=", again)
        self.assertEqual(len(self.started), 1)

    def test_missing_tree_is_reported_not_started(self):
        (self.root / "runtime" / "webhook_server.py").unlink()
        out = self.call(self.port)
        self.assertIn("shop_copy missing", out)
        self.assertEqual(self.started, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
