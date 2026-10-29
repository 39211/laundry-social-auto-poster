# -*- coding: utf-8 -*-
"""20260926 隔離、重複通知與六類照片估價。只讀寫 _sandbox_repo，不連網。"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

_SANDBOX = Path(os.environ.get("LAUNDRY_REPO_ROOT", ""))
_NORM = str(_SANDBOX).replace("\\", "/").rstrip("/").lower()
if not _NORM.endswith("/_sandbox_repo") or "laundry-repo" in _NORM or "fxwash" in _NORM:
    raise RuntimeError("LAUNDRY_REPO_ROOT must be this workspace _sandbox_repo before import")

os.environ["LAUNDRY_LOOKUP_FIXTURE"] = "1"
os.environ["LAUNDRY_PHOTO_ESTIMATE"] = "0"


def _no_net(*_a, **_k):
    raise RuntimeError("network disabled")


def _install_flask_shim():
    """本機沒有 flask 且禁止連網時，只提供測試客戶端。已安裝則用真正的 flask。"""
    try:
        import flask  # noqa: F401
        return
    except ImportError:
        pass
    import types

    mod = types.ModuleType("flask")

    class _Request:
        def __init__(self):
            self.headers = {}
            self.args = {}
            self.host = "127.0.0.1"
            self._data = b""

        def get_data(self):
            return self._data

        def get_json(self, silent=False):
            try:
                if not self._data:
                    return None
                return json.loads(self._data.decode("utf-8"))
            except Exception:
                if silent:
                    return None
                raise

    req = _Request()

    class _App:
        def __init__(self, *args, **kwargs):
            self._routes = {}

        def _dec(self, rule, methods):
            def deco(fn):
                for method in methods:
                    self._routes[(method, rule)] = fn
                return fn
            return deco

        def get(self, rule):
            return self._dec(rule, ("GET",))

        def post(self, rule):
            return self._dec(rule, ("POST",))

        def before_request(self, fn):
            return fn

        def test_client(self):
            app = self

            class _Client:
                def post(self, path, data=b"", content_type="", headers=None):
                    req.headers = headers or {}
                    req._data = data if isinstance(data, bytes) else str(data).encode()
                    result = app._routes[("POST", path)]()
                    status = result[1] if isinstance(result, tuple) else 200

                    class _Resp:
                        status_code = status

                    return _Resp()

            return _Client()

    def abort(code=400):
        raise RuntimeError("abort %s" % code)

    def jsonify(obj=None, **kwargs):
        return obj if not kwargs else kwargs

    def send_file(*args, **kwargs):
        return args[0] if args else ""

    mod.Flask = _App
    mod.abort = abort
    mod.jsonify = jsonify
    mod.request = req
    mod.send_file = send_file
    sys.modules["flask"] = mod


urllib.request.urlopen = _no_net
_install_flask_shim()
sys.path.insert(0, str(Path(__file__).resolve().parent))

import conversation as conv  # noqa: E402
import customer_profile as cprof  # noqa: E402
import estimate  # noqa: E402
import laundry_lookup as L  # noqa: E402
import line_pay  # noqa: E402
import line_webhook as lw  # noqa: E402
import photo_estimate as pe  # noqa: E402
import purge_test_rows  # noqa: E402
import quote_flow  # noqa: E402
import staff_notify as sn  # noqa: E402
import staff_server  # noqa: E402

HERE = Path(__file__).resolve().parent
LIVE_REPO = "C:/Users/cyc39/laundry-repo"
SIX = ("皮鞋", "名牌鞋", "高跟鞋", "精品長大衣", "特殊皮衣", "特殊類名牌包")

_REPO_DEFAULT = (
    "conversation.py",
    "staff_notify.py",
    "laundry_lookup.py",
    "line_webhook.py",
    "customer_profile.py",
    "line_pay.py",
)
_ELSE_DEFAULT = {
    "quote_flow.py": f"{LIVE_REPO}/data/photos",
    "staff_server.py": f"{LIVE_REPO}/data/photos",
    "purge_test_rows.py": f"{LIVE_REPO}/data",
    "preview_chat.py": f"{LIVE_REPO}/line-bot/previews",
}


def test_item0_default_repo_strings_unchanged():
    for name in _REPO_DEFAULT:
        text = (HERE / name).read_text(encoding="utf-8")
        needle = f'os.environ.get("LAUNDRY_REPO_ROOT", r"{LIVE_REPO}")'
        assert text.count(needle) == 1, name
    for name, suffix in _ELSE_DEFAULT.items():
        text = (HERE / name).read_text(encoding="utf-8")
        needle = f'else Path(r"{suffix}")'
        assert text.count(needle) == 1, (name, needle)


def test_item0_import_uses_sandbox_not_live():
    sandbox = _SANDBOX.resolve()
    assert conv.REPO.resolve() == sandbox
    assert sn.REPO.resolve() == sandbox
    assert L.REPO.resolve() == sandbox
    assert lw.REPO.resolve() == sandbox
    assert cprof.REPO.resolve() == sandbox
    assert line_pay.REPO.resolve() == sandbox
    assert quote_flow.PHOTOS_ROOT.resolve() == (sandbox / "data" / "photos")
    assert lw.PHOTOS_ROOT.resolve() == (sandbox / "data" / "photos")
    assert staff_server.PHOTOS_ROOT.resolve() == (sandbox / "data" / "photos")
    assert purge_test_rows.DATA.resolve() == (sandbox / "data")
    for label, path in (
        ("conv", conv.REPO),
        ("photos", quote_flow.PHOTOS_ROOT),
        ("data", purge_test_rows.DATA),
    ):
        text = str(path).replace("\\", "/").lower()
        assert "laundry-repo" not in text, label
        assert "fxwash" not in text, label


def _arm(push):
    urllib.request.urlopen = _no_net
    sn.urllib.request.urlopen = _no_net
    sn._beep = lambda: None
    sn.guest_name = lambda uid: "客人"
    sn.push_group = push
    lw.reply = lambda reply_token, messages: True
    sn.INBOX.parent.mkdir(parents=True, exist_ok=True)
    sn.INBOX.write_text("", encoding="utf-8")
    if conv.SESS.exists():
        conv.SESS.unlink()


def _post(events):
    body = json.dumps({"events": events}, ensure_ascii=False).encode()
    sig = base64.b64encode(hmac.new(lw.SECRET, body, hashlib.sha256).digest()).decode()
    return lw.app.test_client().post(
        "/line/webhook",
        data=body,
        content_type="application/json",
        headers={"X-Line-Signature": sig},
    )


def _pay_event(event_id: str, uid: str, token: str):
    return {
        "type": "message",
        "webhookEventId": event_id,
        "replyToken": token,
        "source": {"type": "user", "userId": uid},
        "message": {"type": "text", "id": "m-" + event_id, "text": "我已付款"},
    }


def test_same_event_redelivery_pushes_group_once():
    calls = []

    def push(row):
        calls.append(row.get("kind"))
        return True

    _arm(push)
    first = _post([_pay_event("evt-pay-dup", "Upaydup0001", "r-pay-1")])
    second = _post([_pay_event("evt-pay-dup", "Upaydup0001", "r-pay-2")])
    assert first.status_code == 200, first.status_code
    assert second.status_code == 200, second.status_code
    assert len(calls) == 1, calls


def test_failed_retry_then_redelivery_does_not_push_again():
    calls = []

    def push(row):
        calls.append(row.get("kind"))
        return len(calls) >= 2

    _arm(push)
    first = _post([_pay_event("evt-pay-retry", "Upayretry001", "r-pay-r1")])
    second = _post([_pay_event("evt-pay-retry", "Upayretry001", "r-pay-r2")])
    assert first.status_code == 200, first.status_code
    assert second.status_code == 200, second.status_code
    assert calls == ["payment_check", "ask"], calls


def test_first_group_push_failure_is_retried():
    calls = []

    def push(row):
        calls.append(row.get("kind"))
        return False

    _arm(push)
    res = _post([_pay_event("evt-pay-fail", "Upayfail0001", "r-pay-fail")])
    assert res.status_code == 200, res.status_code
    assert len(calls) >= 2, calls


def _photo_prices():
    return {
        "鞋子": {"皮鞋": 320, "名牌鞋": 480, "高跟鞋": 300, "一般運動鞋": 180},
        "包包": {"特殊類名牌包": 980, "一般包": 220, "名牌包": 680},
        "外套": {"精品長大衣": 880, "長大衣": 300, "短大衣": 200},
        "皮革": {"特殊皮衣": 1600, "皮衣": 1200},
    }


def test_six_high_price_photo_classes_stay_estimated_without_exact_total():
    prices = _photo_prices()
    names = set(SIX)
    for name in SIX:
        rows = pe.validate_result(
            {"items": [{"name": name, "label": name, "quantity": 1, "certainty": "clear", "reason": "清楚"}]},
            names,
        )
        assert rows[0]["certainty"] == "estimated", (name, rows)
        draft = estimate.from_photo(rows, None, prices)
        text = estimate.render(draft)
        assert draft.get("confirmed_total") is None, (name, draft.get("confirmed_total"), text)
        assert draft.get("total") is None, (name, text)
        assert "這批預估" not in text, (name, text)
        assert not re.search(r"元＝\d", text), (name, text)


def test_hint_downgrades_name_absent_from_the_set():
    name = "新款皮鞋"
    assert name not in pe.PHOTO_HIGH_RISK_NAMES
    assert any(hint in name for hint in pe._HIGH_RISK_HINTS)
    for item in SIX:
        assert any(hint in item for hint in pe._HIGH_RISK_HINTS), item
    rows = pe.validate_result(
        {"items": [{"name": name, "label": name, "quantity": 1, "certainty": "clear", "reason": "清楚"}]},
        {name},
    )
    assert rows[0]["certainty"] == "estimated", rows


def _selected(names: list[str]) -> list:
    fns = [obj for name, obj in globals().items() if name.startswith("test_") and callable(obj)]
    fns.sort(key=lambda fn: fn.__name__)
    if not names:
        return fns
    return [fn for fn in fns if any(part in fn.__name__ for part in names)]


if __name__ == "__main__":
    import traceback

    chosen = _selected(sys.argv[1:])
    passed = failed = 0
    for fn in chosen:
        try:
            fn()
            passed += 1
            print("PASS", fn.__name__)
        except Exception:
            failed += 1
            print("FAIL", fn.__name__)
            traceback.print_exc()
    print(f"collected={len(chosen)} passed={passed} failed={failed} skipped=0")
    sys.exit(1 if failed else 0)
