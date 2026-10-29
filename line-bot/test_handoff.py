# -*- coding: utf-8 -*-
"""WP05A: human handoff is persistent, deduplicated, and reply-suppressing."""
from __future__ import annotations

import base64
import hashlib
import hmac
import importlib
import json
import tempfile
from pathlib import Path

import line_webhook as lw
import staff_notify as sn
import staff_server as ss


def _patch_store():
    tmp = Path(tempfile.mkdtemp(prefix="handoff-wp05-"))
    original = {
        "INBOX": sn.INBOX,
        "TARGET": sn.TARGET,
        "_beep": sn._beep,
        "push_group": sn.push_group,
        "PHOTOS_ROOT": lw.PHOTOS_ROOT,
        "download_content": lw.download_content,
        "reply": lw.reply,
    }
    sn.INBOX = tmp / "staff-inbox.jsonl"
    sn.TARGET = tmp / "staff-target.json"
    sn._beep = lambda: None
    sn.push_group = lambda _row: True
    lw.PHOTOS_ROOT = tmp / "photos"
    lw.download_content = lambda _message_id: b"\xff\xd8\xff\x00synthetic-photo"
    return tmp, original


def _restore_store(original):
    sn.INBOX = original["INBOX"]
    sn.TARGET = original["TARGET"]
    sn._beep = original["_beep"]
    sn.push_group = original["push_group"]
    lw.PHOTOS_ROOT = original["PHOTOS_ROOT"]
    lw.download_content = original["download_content"]
    lw.reply = original["reply"]


def _post(client, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    sig = base64.b64encode(hmac.new(lw.SECRET, body, hashlib.sha256).digest()).decode()
    return client.post(
        "/line/webhook",
        data=body,
        content_type="application/json",
        headers={"X-Line-Signature": sig},
    )


def test_handoff_state_claim_release_and_event_dedup():
    tmp, original = _patch_store()
    try:
        uid = "Uhandoff-state"
        sn.push_inbox(
            "photo_need",
            {
                "id": "EST-H1",
                "case_id": "EST-H1",
                "event_id": "photo-need-1",
                "uid": uid,
                "text": "照片辨識沒有足夠把握",
            },
            notify=False,
        )
        assert sn.handoff_state(uid)["state"] == "HANDOFF_PENDING"
        assert ss.app.test_client().post(
            "/staff/claim",
            json={"id": "EST-H1", "actor": "店員甲"},
            headers={"Host": "127.0.0.1:8792"},
        ).json["ok"]
        assert sn.handoff_state(uid)["state"] == "HUMAN_ACTIVE"

        first = sn.record_handoff_message(
            uid, "EST-H1", "evt-1", "message", text="我還有一雙鞋"
        )
        second = sn.record_handoff_message(
            uid, "EST-H1", "evt-1", "message", text="我還有一雙鞋"
        )
        assert first.get("saved") and not first.get("duplicate")
        assert second.get("duplicate") is True
        raw = [
            json.loads(line)
            for line in sn.INBOX.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        assert sum(row.get("kind") == "human_message" for row in raw) == 1
        card = next(row for row in sn.list_inbox() if row.get("case_id") == "EST-H1")
        assert card["message_count"] == 2, card
        assert card["handoff_state"] == "HUMAN_ACTIVE", card

        # Existing staff UI's "已處理／已接待" action is the explicit release.
        done = ss.app.test_client().post(
            "/staff/done",
            json={"id": "EST-H1"},
            headers={"Host": "127.0.0.1:8792"},
        )
        assert done.status_code == 200 and done.json["ok"]
        assert sn.handoff_state(uid)["state"] == "BOT_ACTIVE"
        card2 = next(row for row in sn.list_inbox() if row.get("case_id") == "EST-H1")
        assert card2["status"] == "done", card2

        # The append-only state remains readable after a module reload.
        importlib.reload(sn)
        sn.INBOX = tmp / "staff-inbox.jsonl"
        assert sn.handoff_state(uid)["state"] == "BOT_ACTIVE"
    finally:
        _restore_store(original)


def test_webhook_handoff_stops_ai_records_all_event_types_and_resumes():
    tmp, original = _patch_store()
    try:
        uid = "Uhandoff-webhook"
        sn.push_inbox(
            "photo_need",
            {
                "id": "EST-H2",
                "case_id": "EST-H2",
                "event_id": "photo-need-2",
                "uid": uid,
                "text": "請店員看照片",
            },
            notify=False,
        )
        assert sn.handoff_active(uid)
        calls = []
        original_handle_ex = lw.conv.handle_ex
        original_handle_postback = lw.conv.handle_postback
        lw.conv.handle_ex = lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("AI must be suppressed during human handoff")
        )
        lw.conv.handle_postback = lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("AI must be suppressed during human handoff")
        )
        lw.reply = lambda _token, messages: calls.append(messages) or True
        client = lw.app.test_client()
        events = [
            {
                "type": "message",
                "webhookEventId": "handoff-text",
                "replyToken": "rt-text",
                "source": {"type": "user", "userId": uid},
                "message": {"type": "text", "id": "m-text", "text": "我還有一雙鞋"},
            },
            {
                "type": "postback",
                "webhookEventId": "handoff-postback",
                "replyToken": "rt-pb",
                "source": {"type": "user", "userId": uid},
                "postback": {"data": "action=price"},
            },
            {
                "type": "message",
                "webhookEventId": "handoff-image",
                "replyToken": "rt-image",
                "source": {"type": "user", "userId": uid},
                "message": {"type": "image", "id": "m-image"},
            },
            {
                "type": "message",
                "webhookEventId": "handoff-location",
                "replyToken": "rt-location",
                "source": {"type": "user", "userId": uid},
                "message": {
                    "type": "location",
                    "id": "m-location",
                    "address": "台中市西屯區測試路1號",
                    "title": "測試位置",
                },
            },
        ]
        for event in events:
            response = _post(client, {"events": [event]})
            assert response.status_code == 200, response.data
        # LINE redelivery of the same event must not add a second record.
        assert _post(client, {"events": [events[0]]}).status_code == 200
        assert calls == [], calls

        rows = [
            json.loads(line)
            for line in sn.INBOX.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        messages = [row for row in rows if row.get("kind") == "human_message"]
        assert len(messages) == 4, messages
        assert {row.get("event_type") for row in messages} == {"message", "postback"}
        # Both text and location are message events; image and postback are
        # still distinct records even though LINE uses the same outer type.
        assert any(row.get("photo") for row in messages)
        assert any(row.get("address") for row in messages)
        assert list((tmp / "photos").rglob("m-image.jpg")), "photo was not retained"
        assert sn.handoff_state(uid)["state"] == "HANDOFF_PENDING"

        assert sn.release_handoff("EST-H2", actor="店員甲")
        # A redelivery after release is still the same captured event; it must
        # not wake the bot or create a second case.
        assert _post(client, {"events": [events[0]]}).status_code == 200
        assert calls == [], calls
        lw.conv.handle_ex = lambda *args, **kwargs: (
            [{"type": "text", "text": "人工已解除，我來幫你看。"}],
            {"intent": "ack", "notify_staff": False, "staff_pushed": False},
        )
        response = _post(
            client,
            {
                "events": [
                    {
                        "type": "message",
                        "webhookEventId": "after-release",
                        "replyToken": "rt-release",
                        "source": {"type": "user", "userId": uid},
                        "message": {"type": "text", "id": "m-release", "text": "謝謝"},
                    }
                ]
            },
        )
        assert response.status_code == 200
        assert calls == [[{"type": "text", "text": "人工已解除，我來幫你看。"}]], calls
    finally:
        lw.conv.handle_ex = original_handle_ex
        lw.conv.handle_postback = original_handle_postback
        _restore_store(original)


if __name__ == "__main__":
    test_handoff_state_claim_release_and_event_dedup()
    test_webhook_handoff_stops_ai_records_all_event_types_and_resumes()
    print("PASS", 2)
