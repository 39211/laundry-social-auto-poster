# -*- coding: utf-8 -*-
"""A-WEBHOOK-2: push_group must not hold _IO_LOCK during network I/O. No network: post is faked."""
import shutil
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

LINE_BOT = Path(__file__).resolve().parents[1]
if str(LINE_BOT) not in sys.path:
    sys.path.insert(0, str(LINE_BOT))

import staff_notify  # noqa: E402


class PushLockTest(unittest.TestCase):
    def setUp(self):
        tmp = Path(tempfile.mkdtemp(prefix="staff-push-lock-"))
        self.addCleanup(shutil.rmtree, tmp, True)
        for target, value in (
            ("INBOX", tmp / "data" / "staff-inbox.jsonl"),
            ("TARGET", tmp / "data" / "staff-target.json"),
            ("SECRETS", tmp / "secrets" / "line-channel.json"),
            ("group_id", lambda: "Cgroup-test"),
            ("_maybe_quota_warn", lambda gid: None),
        ):
            patcher = mock.patch.object(staff_notify, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_push_group_leaves_file_lock_free_during_network(self):
        seen = {}

        def fake_post(gid, text, retry_key=""):
            got = {}

            def probe():
                got["ok"] = staff_notify._IO_LOCK.acquire(timeout=1)
                if got["ok"]:
                    staff_notify._IO_LOCK.release()

            t = threading.Thread(target=probe)
            t.start()
            t.join(5)
            seen["io_lock_free"] = got.get("ok")
            return True, ""

        with mock.patch.object(staff_notify, "_post_to_group", fake_post):
            ok = staff_notify.push_group({"kind": "ask", "id": "Qtest", "text": "test", "event_id": "ev-test-1"})
        self.assertTrue(ok)
        self.assertTrue(seen["io_lock_free"])


    def test_delivery_ack_is_appended_while_holding_file_lock(self):
        """The retry path acks with its own append; it must take _IO_LOCK like every other writer."""
        staff_notify._record_undelivered(
            {"kind": "ask", "id": "Qack"}, "hello", "HTTPError 500", delivery_key="key-ack-1", gid="Cgroup-test"
        )
        self.assertEqual(len(staff_notify._load_undelivered()), 1)
        real = staff_notify._undelivered_path()
        held = []

        class SpyPath:
            def __getattr__(self, name):
                return getattr(real, name)

            def open(self, mode="r", *args, **kwargs):
                if "a" in mode:
                    got = {}

                    def probe():
                        got["free"] = staff_notify._IO_LOCK.acquire(timeout=0.3)
                        if got["free"]:
                            staff_notify._IO_LOCK.release()

                    t = threading.Thread(target=probe)
                    t.start()
                    t.join(5)
                    held.append(not got.get("free"))  # another thread cannot take it => we hold it
                return real.open(mode, *args, **kwargs)

        with mock.patch.object(staff_notify, "_undelivered_path", lambda: SpyPath()), \
                mock.patch.object(staff_notify, "_post_to_group", lambda gid, text, retry_key="": (True, "")):
            staff_notify._flush_undelivered("Cgroup-test")
        self.assertEqual(held, [True])
        self.assertEqual(staff_notify._load_undelivered(), [])  # ack landed


if __name__ == "__main__":
    unittest.main()
