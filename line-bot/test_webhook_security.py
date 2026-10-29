# -*- coding: utf-8 -*-
"""R6: public app has no /staff*; staff app Host-gates; webhook sig required."""
import base64
import hashlib
import hmac
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_line_flows as flows

flows.install_isolation(fixture=True)

from line_webhook import SECRET, app as public_app
from staff_server import app as staff_app


def test_public_staff_gone():
    c = public_app.test_client()
    assert c.get("/staff").status_code == 404
    assert c.get("/staff/api").status_code == 404
    assert c.post("/staff/notify", json={"uid": "x"}).status_code == 404
    assert c.post("/staff/done", json={"id": "x"}).status_code == 404
    rules = {r.rule for r in public_app.url_map.iter_rules()}
    assert "/staff" not in rules
    assert "/static/<path:filename>" not in rules
    assert "/line/webhook" in rules
    assert "/healthz" in rules


def test_webhook_sig():
    c = public_app.test_client()
    body = b'{"events":[]}'
    r = c.post("/line/webhook", data=body, content_type="application/json")
    assert r.status_code == 403, r.status_code
    r2 = c.post(
        "/line/webhook",
        data=body,
        content_type="application/json",
        headers={"X-Line-Signature": "AAAA"},
    )
    assert r2.status_code == 403, r2.status_code
    # G14: positive case -- valid HMAC must 200 (else a constant-False verifier stays green)
    mac = hmac.new(SECRET, body, hashlib.sha256).digest()
    good = base64.b64encode(mac).decode()
    r3 = c.post(
        "/line/webhook",
        data=body,
        content_type="application/json",
        headers={"X-Line-Signature": good},
    )
    assert r3.status_code == 200, r3.status_code


def test_healthz():
    c = public_app.test_client()
    r = c.get("/healthz")
    assert r.status_code == 200
    # G6: body is "ok <pid>" so Probe can detect a foreign listener
    assert r.data == ("ok " + str(os.getpid())).encode("ascii"), r.data


def test_img_traversal():
    c = public_app.test_client()
    r = c.get("/img/../line_webhook.py")
    blob = r.data.decode("utf-8", "replace") if r.data else ""
    assert "verify_signature" not in blob
    assert "channel_secret" not in blob
    assert r.status_code in (404, 400, 308, 301)
    r2 = c.get("/img/line_webhook.py")
    blob2 = r2.data.decode("utf-8", "replace") if r2.data else ""
    assert "def verify_signature" not in blob2
    assert r2.status_code == 404


def test_staff_host_guard():
    c = staff_app.test_client()
    ok = c.get("/staff/api", headers={"Host": "127.0.0.1:8792"})
    assert ok.status_code == 200, ok.status_code
    bad = c.get("/staff/api", headers={"Host": "abc.trycloudflare.com"})
    assert bad.status_code == 403, bad.status_code


def test_pay_confirm_nonfinite():
    # F16: inf/nan/negative must not 500; treated as 0
    import line_pay

    seen = []
    orig = line_pay.confirm

    def fake(tid, amt):
        seen.append(amt)
        return {"ok": True}

    line_pay.confirm = fake
    try:
        c = public_app.test_client()
        r = c.get("/pay/confirm?transactionId=123&amount=inf")
        assert r.status_code != 500, r.status_code
        assert r.status_code == 200, r.status_code
        r2 = c.get("/pay/confirm?transactionId=123&amount=-3")
        assert r2.status_code == 200, r2.status_code
        r3 = c.get("/pay/confirm?transactionId=123&amount=nan")
        assert r3.status_code == 200, r3.status_code
        assert seen == [0, 0, 0], seen
    finally:
        line_pay.confirm = orig


def test_pay_confirm_bad_tid():
    # G13: non-digit transactionId must 400 without calling confirm
    import line_pay

    seen = []
    orig = line_pay.confirm

    def fake(tid, amt):
        seen.append((tid, amt))
        return {"ok": True}

    line_pay.confirm = fake
    try:
        c = public_app.test_client()
        for tid in ("t1", "12/../x", "abc", "1" * 33):
            r = c.get("/pay/confirm?transactionId=" + tid + "&amount=10")
            assert r.status_code == 400, (tid, r.status_code)
        r_empty = c.get("/pay/confirm?amount=10")
        assert r_empty.status_code == 400, r_empty.status_code
        assert seen == [], seen
        r_ok = c.get("/pay/confirm?transactionId=123&amount=10")
        assert r_ok.status_code == 200, r_ok.status_code
        assert seen == [("123", 10)], seen
    finally:
        line_pay.confirm = orig


if __name__ == "__main__":
    test_public_staff_gone()
    test_webhook_sig()
    test_healthz()
    test_img_traversal()
    test_staff_host_guard()
    test_pay_confirm_nonfinite()
    test_pay_confirm_bad_tid()
    print("PASS", 7)
