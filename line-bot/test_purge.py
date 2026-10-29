# -*- coding: utf-8 -*-
"""G7/G10/G11: purge backup exclusive-create, unreadable abort, JSON-map buckets."""
import io
import json
import sys
import tempfile
from contextlib import redirect_stdout
from datetime import datetime as real_datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import purge_test_rows as purge


class FrozenDate:
    @staticmethod
    def now():
        return real_datetime(2026, 9, 6, 12, 30, 45)


def _seed_empty_jsonl_and_sessions(tmp: Path) -> None:
    (tmp / "line-bookings.jsonl").write_text("", encoding="utf-8")
    (tmp / "staff-inbox.jsonl").write_text("", encoding="utf-8")
    (tmp / "line-sessions.json").write_text("{}", encoding="utf-8")


def test_g10_same_second_open_x():
    tmp = Path(tempfile.mkdtemp(prefix="purge-g10-"))
    (tmp / "line-bookings.jsonl").write_text(
        json.dumps({"uid": "Utest", "id": "B"}) + "\n",
        encoding="utf-8",
    )
    (tmp / "staff-inbox.jsonl").write_text("", encoding="utf-8")
    (tmp / "line-sessions.json").write_text("{}", encoding="utf-8")
    (tmp / "line-customer-bind.json").write_text("{}", encoding="utf-8")
    orig_dt = purge.datetime
    orig_choice = purge.random.choice
    purge.datetime = FrozenDate
    purge.random.choice = lambda seq: "a"
    try:
        p = purge.plan(tmp)
        backup1 = purge.apply(p, tmp)
        assert backup1.exists(), backup1
        first = backup1.read_text(encoding="utf-8")
        assert "Utest" in first
        live_after = (tmp / "line-bookings.jsonl").read_text(encoding="utf-8")
        p2 = purge.plan(tmp)
        try:
            purge.apply(p2, tmp)
            raise AssertionError("second apply should fail open(x)")
        except FileExistsError:
            pass
        assert backup1.read_text(encoding="utf-8") == first
        assert (tmp / "line-bookings.jsonl").read_text(encoding="utf-8") == live_after
        assert backup1.name == "line-test-rows-backup-20260906-123045-aaaa.json"
    finally:
        purge.datetime = orig_dt
        purge.random.choice = orig_choice


def test_g11_truncated_json_aborts():
    tmp = Path(tempfile.mkdtemp(prefix="purge-g11-"))
    _seed_empty_jsonl_and_sessions(tmp)
    live = tmp / "line-customer-bind.json"
    original = b'{"Uabc": "truncated'
    assert len(original) == 63 or len(original) > 0
    live.write_bytes(original)
    p = purge.plan(tmp)
    assert "line-customer-bind.json" in p["unreadable"], p
    try:
        purge.apply(p, tmp)
        raise AssertionError("apply should abort")
    except purge.UnreadableFile:
        pass
    assert live.read_bytes() == original
    assert list(tmp.glob("line-test-rows-backup-*.json")) == []
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = purge.main(["--apply", "--force"], data=tmp)
    assert rc != 0, rc
    assert live.read_bytes() == original
    assert list(tmp.glob("line-test-rows-backup-*.json")) == []
    out = buf.getvalue()
    assert "unreadable" in out
    assert "line-customer-bind.json" in out


def test_g7_json_map_no_uid_vs_suspect():
    tmp = Path(tempfile.mkdtemp(prefix="purge-g7-"))
    real = "U" + "ab" + "c" * 30
    short_u = "Utest"
    suspect = "not-a-uid"
    (tmp / "line-customer-bind.json").write_text(
        json.dumps({real: {"ok": 1}, short_u: {"x": 1}, suspect: {"y": 1}}),
        encoding="utf-8",
    )
    _seed_empty_jsonl_and_sessions(tmp)
    p = purge.plan(tmp)
    keep = p["json"]["line-customer-bind.json"]["keep"]
    move = p["json"]["line-customer-bind.json"]["move"]
    assert real in keep, keep
    assert short_u in keep, keep
    assert short_u in p["no_uid"]["line-customer-bind.json"]
    assert suspect in move, move
    assert suspect in p["suspect"]["line-customer-bind.json"]
    assert suspect not in keep
    buf = io.StringIO()
    with redirect_stdout(buf):
        purge.report(p)
    text = buf.getvalue()
    assert "no_uid:" in text
    assert "suspect:" in text
    assert short_u in text
    assert suspect in text
    backup = purge.apply(p, tmp)
    live = json.loads((tmp / "line-customer-bind.json").read_text(encoding="utf-8"))
    assert real in live and short_u in live
    assert suspect not in live
    dumped = json.loads(backup.read_text(encoding="utf-8"))
    assert suspect in dumped["files"]["line-customer-bind.json"]
    assert short_u not in dumped["files"]["line-customer-bind.json"]


if __name__ == "__main__":
    test_g10_same_second_open_x()
    test_g11_truncated_json_aborts()
    test_g7_json_map_no_uid_vs_suspect()
    print("PASS", 3)
