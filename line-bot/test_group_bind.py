# -*- coding: utf-8 -*-
"""G1: group bind requires a one-shot token; join and 櫃台 never bind."""
import base64
import hashlib
import hmac
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_line_flows as flows

flows.install_isolation(fixture=True)

import line_webhook as lw
import staff_notify as sn
from line_webhook import SECRET, app


def _sig(body: bytes) -> str:
    mac = hmac.new(SECRET, body, hashlib.sha256).digest()
    return base64.b64encode(mac).decode()


def _post(body: bytes):
    c = app.test_client()
    return c.post(
        "/line/webhook",
        data=body,
        content_type="application/json",
        headers={"X-Line-Signature": _sig(body)},
    )


def _join_body(gid: str) -> bytes:
    return json.dumps(
        {
            "events": [
                {
                    "type": "join",
                    "replyToken": "r-join",
                    "source": {"type": "group", "groupId": gid},
                }
            ]
        }
    ).encode()


def _text_body(gid: str, text: str) -> bytes:
    return json.dumps(
        {
            "events": [
                {
                    "type": "message",
                    "replyToken": "r-msg",
                    "source": {"type": "group", "groupId": gid},
                    "message": {"type": "text", "text": text},
                }
            ]
        }
    ).encode()


class _BindProbe:
    def __init__(self, token_path: Path | None):
        self.bound = []
        self.replies = []
        self._orig_path = lw.BIND_TOKEN_FILE
        self._orig_bind = sn.bind_group
        self._orig_reply = lw.reply
        lw.BIND_TOKEN_FILE = token_path or Path(
            tempfile.mkdtemp(prefix="g1-missing-")
        ) / "staff-bind-token.txt"
        sn.bind_group = lambda gid: self.bound.append(gid)
        lw.reply = lambda rt, msgs: self.replies.append({"rt": rt, "msgs": msgs})

    def close(self):
        lw.BIND_TOKEN_FILE = self._orig_path
        sn.bind_group = self._orig_bind
        lw.reply = self._orig_reply


def test_join_does_not_bind():
    token_dir = Path(tempfile.mkdtemp(prefix="g1-join-"))
    token_path = token_dir / "staff-bind-token.txt"
    token_path.write_text("secret-bind-token-aaaa\n", encoding="utf-8")
    probe = _BindProbe(token_path)
    try:
        r = _post(_join_body("Gjoin0001"))
        assert r.status_code == 200, r.status_code
        assert probe.bound == [], probe.bound
        assert probe.replies == [], probe.replies
    finally:
        probe.close()


def test_counter_text_does_not_bind():
    token_dir = Path(tempfile.mkdtemp(prefix="g1-counter-"))
    token_path = token_dir / "staff-bind-token.txt"
    token_path.write_text("secret-bind-token-bbbb\n", encoding="utf-8")
    probe = _BindProbe(token_path)
    try:
        for text in ("櫃台", "綁定櫃台", "員工群"):
            r = _post(_text_body("Gcounter0001", text))
            assert r.status_code == 200, (text, r.status_code)
        assert probe.bound == [], probe.bound
        assert probe.replies == [], probe.replies
    finally:
        probe.close()


def test_missing_token_file_does_not_bind_or_reply():
    probe = _BindProbe(None)
    try:
        assert not lw.BIND_TOKEN_FILE.exists()
        r = _post(_text_body("Gmissing0001", "櫃台"))
        assert r.status_code == 200, r.status_code
        assert probe.bound == [], probe.bound
        assert probe.replies == [], probe.replies
        r2 = _post(_text_body("Gmissing0001", "secret-bind-token-cccc"))
        assert r2.status_code == 200, r2.status_code
        assert probe.bound == [], probe.bound
        assert probe.replies == [], probe.replies
    finally:
        probe.close()


def test_correct_token_binds_once():
    token_dir = Path(tempfile.mkdtemp(prefix="g1-ok-"))
    token_path = token_dir / "staff-bind-token.txt"
    token_path.write_text("  secret-bind-token-dddd  \n", encoding="utf-8")
    probe = _BindProbe(token_path)
    try:
        r = _post(_text_body("Gstaff0001", "secret-bind-token-dddd"))
        assert r.status_code == 200, r.status_code
        assert probe.bound == ["Gstaff0001"], probe.bound
        assert len(probe.replies) == 1, probe.replies
        msgs = probe.replies[0]["msgs"]
        assert msgs[0]["text"] == "好，之後預約會打到這個群。"
        blob = json.dumps(probe.replies, ensure_ascii=False)
        assert "secret-bind-token-dddd" not in blob
        r2 = _post(_text_body("Gstaff0001", "wrong-token"))
        assert r2.status_code == 200, r2.status_code
        assert probe.bound == ["Gstaff0001"], probe.bound
        assert len(probe.replies) == 1, probe.replies
    finally:
        probe.close()


if __name__ == "__main__":
    test_join_does_not_bind()
    test_counter_text_does_not_bind()
    test_missing_token_file_does_not_bind_or_reply()
    test_correct_token_binds_once()
    print("PASS", 4)
