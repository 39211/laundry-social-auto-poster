# -*- coding: utf-8 -*-
"""G12: set_status appends; concurrent push_inbox rows are not dropped."""
import json
import sys
import tempfile
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import staff_notify as sn
import staff_server as ss


def test_g12_interleaved_append():
    tmp = Path(tempfile.mkdtemp(prefix="inbox-g12-"))
    orig = sn.INBOX
    orig_beep = sn._beep
    orig_pg = sn.push_group
    sn.INBOX = tmp / "staff-inbox.jsonl"
    sn._beep = lambda: None
    sn.push_group = lambda row: None
    try:
        sn.push_inbox("book", {"id": "A", "name": "n1", "item": "shirt"})
        _ = sn.INBOX.read_text(encoding="utf-8")
        sn.push_inbox("book", {"id": "B", "name": "n2", "item": "pants"})
        sn.set_status("A", "done")
        rows = sn.list_inbox()
        by_id = {r["id"]: r for r in rows}
        assert "A" in by_id and "B" in by_id, rows
        assert by_id["A"]["status"] == "done", by_id["A"]
        assert by_id["B"]["status"] == "new", by_id["B"]
        assert all(r.get("kind") != "status" for r in rows), rows
        raw = sn.INBOX.read_text(encoding="utf-8")
        assert '"kind": "status"' in raw or '"kind":"status"' in raw
        assert "B" in raw
    finally:
        sn.INBOX = orig
        sn._beep = orig_beep
        sn.push_group = orig_pg


def test_g12_legacy_status_field_still_shown():
    tmp = Path(tempfile.mkdtemp(prefix="inbox-g12-old-"))
    orig = sn.INBOX
    sn.INBOX = tmp / "staff-inbox.jsonl"
    try:
        sn.INBOX.write_text(
            json.dumps({"kind": "book", "id": "C", "status": "done", "name": "old"})
            + "\n"
            + json.dumps({"kind": "book", "id": "D", "status": "new", "name": "fresh"})
            + "\n",
            encoding="utf-8",
        )
        rows = sn.list_inbox()
        by_id = {r["id"]: r for r in rows}
        assert by_id["C"]["status"] == "done"
        assert by_id["D"]["status"] == "new"
        sn.set_status("D", "done")
        rows2 = sn.list_inbox()
        by_id2 = {r["id"]: r for r in rows2}
        assert by_id2["C"]["status"] == "done"
        assert by_id2["D"]["status"] == "done"
        assert all(r.get("kind") != "status" for r in rows2)
    finally:
        sn.INBOX = orig


def _ok_urlopen(captured):
    def fake_urlopen(req, timeout=10):
        data = req.data if hasattr(req, "data") else b""
        if isinstance(data, (bytes, bytearray)):
            captured.append(data.decode("utf-8"))
        elif data:
            captured.append(str(data))

        class _R:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return b"{}"

        return _R()

    return fake_urlopen


def _push_bodies(captured):
    out = []
    for raw in captured:
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            continue
        msgs = body.get("messages") or []
        if msgs:
            out.append(msgs[0].get("text") or "")
    return out


def _isolate_push():
    tmp = Path(tempfile.mkdtemp(prefix="inbox-n2-"))
    orig = {
        "INBOX": sn.INBOX,
        "TARGET": sn.TARGET,
        "_token": sn._token,
        "urlopen": urllib.request.urlopen,
        "quota_left": sn.quota_left,
    }
    sn.INBOX = tmp / "staff-inbox.jsonl"
    sn.TARGET = tmp / "staff-target.json"
    sn.bind_group("Cfake-n2-group-id-00000000000001")
    sn._token = lambda: "SECRET_TOKEN_VALUE_SHOULD_NOT_APPEAR"
    sn.quota_left = lambda: (None, None, None)
    return tmp, orig


def _restore_push(orig):
    sn.INBOX = orig["INBOX"]
    sn.TARGET = orig["TARGET"]
    sn._token = orig["_token"]
    urllib.request.urlopen = orig["urlopen"]
    sn.quota_left = orig["quota_left"]


def _push_group_text(row: dict) -> str:
    captured = []
    tmp, orig = _isolate_push()
    urllib.request.urlopen = _ok_urlopen(captured)
    try:
        sn.push_group(row)
    finally:
        _restore_push(orig)
    texts = _push_bodies(captured)
    assert texts, "push_group sent nothing"
    return texts[0]


def test_n2_photo_not_booking():
    text = _push_group_text({"kind": "photo", "name": "測試客", "item": "", "text": "客人傳了照片"})
    assert "新預約" not in text, text
    assert "照片詢問" in text, text
    assert "需求：" in text, text
    assert "照片：" in text, text
    text2 = _push_group_text({"kind": "photo", "name": "測試客", "need": "局部髒污"})
    assert "新預約" not in text2, text2
    assert "照片詢問" in text2, text2
    assert "需求：局部髒污" in text2, text2


def test_x4_photo_need_followup():
    text = _push_group_text(
        {"kind": "photo_need", "name": "測試客", "need": "鞋帶那邊發黃"}
    )
    assert "需求有補充" in text, text
    assert "測試客" in text, text
    assert "需求：鞋帶那邊發黃" in text, text
    assert "新預約" not in text, text


def test_n2_unknown_kind_not_booking():
    text = _push_group_text({"kind": "weird", "name": "測試客", "text": "hello"})
    assert "客人有新需求" in text, text
    assert "hello" in text, text
    assert "新預約" not in text, text


def test_n3_query_keeps_item():
    text = _push_group_text(
        {
            "kind": "query",
            "name": "測試客",
            "phone": "0912345678",
            "text": "0912345678",
            "item": "鞋子",
        }
    )
    assert "客人查件" in text, text
    assert "0912345678" in text, text
    assert "鞋子" in text, text
    assert "電話" in text, text
    assert "品項" in text, text


def test_p6_pickup_group_has_phone():
    text = _push_group_text(
        {
            "kind": "pickup",
            "id": "W09081400abcd",
            "slot": "明天下午（14:00–18:00）",
            "when": "2026-09-09T14:00",
            "address": "台中市西屯區青海路二段365號",
            "phone": "0912345678",
            "item": "",
            "name": "測試客",
        }
    )
    assert "收送申請｜待安排" in text, text
    assert "案件：W09081400abcd" in text, text
    assert "時段：明天下午（14:00–18:00）" in text, text
    assert "地址：台中市西屯區青海路二段365號" in text, text
    assert "電話：0912345678" in text, text
    assert "品項：待補" in text, text
    assert "客人：測試客" in text, text
    assert "09xx" not in text, text


def test_q4_pickup_group_marks_missing():
    text = _push_group_text(
        {
            "kind": "pickup",
            "id": "W09081500miss",
            "slot": "",
            "when": "",
            "address": "台中市西屯區文華路100號",
            "phone": "",
            "item": "",
            "name": "測試客",
        }
    )
    assert "待補資料" in text, text
    assert "請從官方LINE補齊資料" in text and "電話確認" not in text, text
    assert "時段：待補" in text, text
    assert "電話：待補" in text, text
    assert "文華路" in text, text


def test_p6_pickup_item_followup():
    text = _push_group_text(
        {"kind": "pickup_item", "id": "W09081400abcd", "item": "衣服", "name": "測試客"}
    )
    assert "收送品項有補充" in text, text
    assert "案件：W09081400abcd" in text, text
    assert "品項：衣服" in text, text


def test_n4_photo_route():
    tmp = Path(tempfile.mkdtemp(prefix="staff-n4-"))
    # PHOTOS_ROOT = tmp/data/photos so /photo/../../secrets/... maps to tmp/secrets
    photos = tmp / "data" / "photos"
    photos.mkdir(parents=True)
    secrets = tmp / "secrets"
    secrets.mkdir()
    jpg = photos / "ok.jpg"
    jpg.write_bytes(b"\xff\xd8\xfffakejpeg")
    png = photos / "ok.png"
    png.write_bytes(b"\x89PNG\r\nfakepng")
    txt = photos / "x.txt"
    txt.write_text("not-an-image", encoding="utf-8")
    leak = secrets / "line-channel.json"
    leak.write_text('{"marker":"leaked-secret"}', encoding="utf-8")
    leak_jpg = secrets / "leak.jpg"
    leak_jpg.write_bytes(b"\xff\xd8\xffLEAKJPG")
    orig = ss.PHOTOS_ROOT
    ss.PHOTOS_ROOT = photos
    c = ss.app.test_client()
    host = {"Host": "127.0.0.1:8792"}
    try:
        ok = c.get("/photo/ok.jpg", headers=host)
        assert ok.status_code == 200, ok.status_code
        assert ok.data == jpg.read_bytes()
        ok2 = c.get("/photo/ok.png", headers=host)
        assert ok2.status_code == 200, ok2.status_code
        bad_txt = c.get("/photo/x.txt", headers=host)
        assert bad_txt.status_code == 404, bad_txt.status_code
        trav = c.get("/photo/../../secrets/line-channel.json", headers=host)
        assert trav.status_code == 404, (trav.status_code, trav.data)
        assert b"leaked-secret" not in (trav.data or b"")
        trav_jpg = c.get("/photo/../../secrets/leak.jpg", headers=host)
        assert trav_jpg.status_code == 404, (trav_jpg.status_code, trav_jpg.data)
        assert b"LEAKJPG" not in (trav_jpg.data or b"")
        missing = c.get("/photo/nope.jpg", headers=host)
        assert missing.status_code == 404, missing.status_code
    finally:
        ss.PHOTOS_ROOT = orig


def _pickup_row(**kw):
    row = {
        "kind": "pickup",
        "id": "W09081400c1xx",
        "slot": "明天下午（14:00–18:00）",
        "when": "2026-09-09T14:00",
        "address": "台中市西屯區青海路二段365號",
        "phone": "0912345678",
        "item": "衣服",
        "name": "測試客",
    }
    row.update(kw)
    return row


def test_c1_push_failure_records():
    tmp, orig = _isolate_push()

    def boom(*_a, **_k):
        raise RuntimeError("net down")

    urllib.request.urlopen = boom
    try:
        ok = sn.push_group(_pickup_row())
        assert ok is False
        path = tmp / "undelivered.jsonl"
        assert path.exists(), path
        rec = json.loads(path.read_text(encoding="utf-8").splitlines()[0])
        blob = json.dumps(rec, ensure_ascii=False)
        assert "SECRET_TOKEN_VALUE_SHOULD_NOT_APPEAR" not in blob, blob
        assert "Cfake-n2-group-id-00000000000001" not in blob, blob
        assert "0912345678" not in blob, blob
        assert "青海路" not in blob, blob
        assert rec.get("kind") == "pickup"
        assert rec.get("id") == "W09081400c1xx"
        assert "RuntimeError" in (rec.get("error") or "")
    finally:
        _restore_push(orig)


def test_c1_http_status_in_error():
    tmp, orig = _isolate_push()

    def boom(*_a, **_k):
        raise urllib.request.HTTPError(
            "https://api.line.me/v2/bot/message/push", 429, "Too Many", hdrs=None, fp=None
        )

    urllib.request.urlopen = boom
    try:
        ok = sn.push_group(_pickup_row(id="W429"))
        assert ok is False
        rec = json.loads((tmp / "undelivered.jsonl").read_text(encoding="utf-8").splitlines()[0])
        assert "429" in (rec.get("error") or ""), rec
        assert "HTTPError" in (rec.get("error") or ""), rec
    finally:
        _restore_push(orig)


def test_c1_retry_summary_then_clear():
    tmp, orig = _isolate_push()
    urllib.request.urlopen = lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("fail"))
    try:
        assert sn.push_group(_pickup_row(id="Wfail1")) is False
        assert (tmp / "undelivered.jsonl").exists()
        captured = []
        urllib.request.urlopen = _ok_urlopen(captured)
        ok = sn.push_group(_pickup_row(id="Wok1", item="衣服"))
        assert ok is True
        texts = _push_bodies(captured)
        assert texts, captured
        assert texts[0] == sn._compose_group_text(_pickup_row(id="Wfail1")), texts[0]
        assert "Wfail1" in texts[0], texts[0]
        assert any("收送申請" in t for t in texts), texts
        path = tmp / "undelivered.jsonl"
        leftover = path.read_text(encoding="utf-8").strip() if path.exists() else ""
        assert sn._load_undelivered() == [], leftover
        assert "delivery_ack" in leftover, leftover
    finally:
        _restore_push(orig)


def test_c1_push_user_records_failure():
    tmp, orig = _isolate_push()
    urllib.request.urlopen = lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("user fail"))
    try:
        ok = sn.push_user("Uguest", "可以取了。")
        assert ok is False
        rec = json.loads((tmp / "undelivered.jsonl").read_text(encoding="utf-8").splitlines()[0])
        blob = json.dumps(rec, ensure_ascii=False)
        assert rec.get("kind") == "user"
        assert "RuntimeError" in (rec.get("error") or "")
        assert "Uguest" not in blob
        assert "SECRET_TOKEN_VALUE_SHOULD_NOT_APPEAR" not in blob
    finally:
        _restore_push(orig)


def test_c1_mutation_no_record_turns_red():
    orig_rec = sn._record_undelivered
    sn._record_undelivered = lambda *_a, **_k: None
    try:
        red = False
        try:
            test_c1_push_failure_records()
        except AssertionError:
            red = True
        assert red
    finally:
        sn._record_undelivered = orig_rec


def test_c2_quota_warn_once_and_none():
    tmp, orig = _isolate_push()
    captured = []
    urllib.request.urlopen = _ok_urlopen(captured)
    sn.quota_left = lambda: (200, 175, 25)
    try:
        assert sn.push_group(_pickup_row(id="Wq1")) is True
        texts = _push_bodies(captured)
        warns = [t for t in texts if "額度剩" in t]
        assert len(warns) == 1, texts
        assert "剩 25 則" in warns[0], warns[0]
        assert "門市電腦" in warns[0] and "127.0.0.1" not in warns[0], warns[0]
        warned = json.loads((tmp / "quota-warned.json").read_text(encoding="utf-8"))
        assert warned.get("month") == sn._quota_month()
        captured.clear()
        assert sn.push_group(_pickup_row(id="Wq2")) is True
        texts2 = _push_bodies(captured)
        assert not any("額度剩" in t for t in texts2), texts2
        captured.clear()
        sn.quota_left = lambda: (None, None, None)
        (tmp / "quota-warned.json").unlink()
        assert sn.push_group(_pickup_row(id="Wq3")) is True
        texts3 = _push_bodies(captured)
        assert not any("額度" in t for t in texts3), texts3
    finally:
        _restore_push(orig)


def test_c2_mutation_warn_every_time_turns_red():
    orig_fn = sn._quota_warned_this_month
    sn._quota_warned_this_month = lambda: False
    try:
        red = False
        try:
            test_c2_quota_warn_once_and_none()
        except AssertionError:
            red = True
        assert red
    finally:
        sn._quota_warned_this_month = orig_fn


def test_c3_push_text_item_and_later_see():
    text = _push_group_text(_pickup_row(item="衣服"))
    assert "品項：衣服" in text, text
    assert "等客人回" not in text, text
    assert "⚠" not in text, text
    later = _push_group_text(_pickup_row(item="到時再看"))
    assert "品項：到時再看" in later, later
    assert "等客人回" not in later, later
    assert "⚠" not in later, later


if __name__ == "__main__":
    test_g12_interleaved_append()
    test_g12_legacy_status_field_still_shown()
    test_n2_photo_not_booking()
    test_x4_photo_need_followup()
    test_n2_unknown_kind_not_booking()
    test_n3_query_keeps_item()
    test_p6_pickup_group_has_phone()
    test_q4_pickup_group_marks_missing()
    test_p6_pickup_item_followup()
    test_n4_photo_route()
    test_c1_push_failure_records()
    test_c1_http_status_in_error()
    test_c1_retry_summary_then_clear()
    test_c1_push_user_records_failure()
    test_c1_mutation_no_record_turns_red()
    test_c2_quota_warn_once_and_none()
    test_c2_mutation_warn_every_time_turns_red()
    test_c3_push_text_item_and_later_see()
    print("PASS", 18)
