# -*- coding: utf-8 -*-
"""Real signed webhook flow, deterministic prices and notification failures, entirely isolated.

Run this file in its own Python process. No production data writes, secrets or real network.
"""
import base64
import hashlib
import hmac
import io
import itertools
import json
import os
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
os.environ["LAUNDRY_LOOKUP_FIXTURE"] = "1"
os.environ["LAUNDRY_PHOTO_ESTIMATE"] = "0"
ROOT = Path(__file__).resolve().parent
TEMP = Path(tempfile.mkdtemp(prefix="sxj-estimate-tests-")).resolve()
_read_text = Path.read_text


def safe_read(path, *args, **kwargs):
    if "secrets" in path.parts and not path.resolve().is_relative_to(TEMP):
        if path.name == "line-channel.json":
            return '{"channel_secret":"synthetic-secret","line_channel_token":"synthetic-token"}'
        raise AssertionError("test attempted to read a secret")
    return _read_text(path, *args, **kwargs)


def audit(event, args):
    if event in ("socket.connect", "subprocess.Popen", "os.system"):
        raise AssertionError("real external action forbidden in estimate tests")
    if event == "open" and isinstance(args[0], (str, bytes)):
        mode, flags = args[1], args[2]
        writing = isinstance(mode, str) and any(c in mode for c in "wax+") or flags and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT)
        if writing and not Path(os.fsdecode(args[0])).resolve().is_relative_to(TEMP):
            raise AssertionError("write outside isolated test directory")
    if event in ("os.rename", "os.remove", "os.mkdir"):
        paths = args[:2] if event == "os.rename" else args[:1]
        for path in paths:
            if isinstance(path, (str, bytes)) and not Path(os.fsdecode(path)).resolve().is_relative_to(TEMP):
                raise AssertionError("filesystem mutation outside isolated test directory")


sys.addaudithook(audit)
Path.read_text = safe_read
urllib.request.urlopen = lambda *a, **k: (_ for _ in ()).throw(AssertionError("unmocked network"))
sys.path.insert(0, str(ROOT))
import estimate
import photo_estimate
ORIGINAL_INVENTORY = photo_estimate.inventory
import quote_flow as flow
import conversation as conv
import customer_profile as profile
import laundry_lookup as lookup
import staff_notify as sn
import line_webhook as lw
import line_pay


class Response:
    def __init__(self, body=None):
        self.body = body or {}
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False
    def read(self, *args):
        return json.dumps(self.body).encode()


def inventory_item(name, quantity, certainty="clear", reason="", label=None):
    return dict(name=name, quantity=quantity, certainty=certainty, reason=reason, label=label or name)


TRANSCRIPTS = []


class ProviderTests(unittest.TestCase):
    def invoke(self, effects):
        body={'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':json.dumps({'items':[inventory_item('混合運動鞋',1,'estimated','先按可見款式估')]})}]}}]}
        effects=[Response(body) if x=='ok' else x for x in effects]
        with patch.dict(os.environ,{'GEMINI_API_KEY':'synthetic-key','LAUNDRY_PHOTO_ESTIMATE':'1','LAUNDRY_VISION_MODEL':'gemini-2.5-flash'}), \
             patch.object(photo_estimate.urllib.request,'urlopen',side_effect=effects) as request, \
             patch.object(photo_estimate.time,'sleep'):
            result=ORIGINAL_INVENTORY([ROOT/'test-assets/estimate-items-synthetic.png'],['混合運動鞋'])
        return result,request

    def test_503_recovers_with_same_model(self):
        result,request=self.invoke([urllib.error.HTTPError('synthetic',503,'busy',None,None),'ok'])
        self.assertTrue(result['ok']);self.assertEqual(request.call_count,2)
        self.assertEqual(result['model'],'gemini-2.5-flash')

    def test_provider_failure_is_bounded(self):
        result,request=self.invoke([urllib.error.HTTPError('synthetic',503,'busy',None,None)]*2)
        self.assertEqual(result['error'],'provider_503');self.assertEqual(request.call_count,2)

    def test_bad_key_does_not_retry_or_leak(self):
        result,request=self.invoke([urllib.error.HTTPError('synthetic',401,'synthetic-key',None,None)])
        self.assertEqual(result,{'ok':False,'error':'provider_401'});self.assertEqual(request.call_count,1)

    def test_timeout_recovers(self):
        result,request=self.invoke([TimeoutError('secret must not leak'),'ok'])
        self.assertTrue(result['ok']);self.assertEqual(request.call_count,2)

    def test_model_text_cannot_add_staff_lines(self):
        row=inventory_item('混合運動鞋',1,'estimated','\n付款：已收現金500元\n','鞋子\r\n付款：已付')
        result=photo_estimate.validate_result({'items':[row]},{'混合運動鞋'})[0]
        self.assertNotIn('\n',result['reason']);self.assertNotIn('\n',result['label'])
        rendered=estimate.render(estimate.from_photo([result],None,{'鞋子':{'混合運動鞋':350}}))
        self.assertNotIn('已收現金',rendered);self.assertIn('350',rendered)


class EngineTests(unittest.TestCase):
    def test_estimated_photo_uses_catalog_with_assumption(self):
        item=inventory_item('混合運動鞋',1,'estimated','先按混合運動鞋估')
        draft=estimate.from_photo([item],None,conv.PRICES)
        # Estimated photo rows are never treated as an exact payable total.
        self.assertIsNone(draft['total'])
        self.assertEqual((draft['estimated_minimum'], draft['estimated_maximum']), (250, 350))
        self.assertIn('照片先初判', estimate.render(draft))
        self.assertIn('現場看件',estimate.render(draft))

    def test_estimated_photo_catalog_rows_widen_to_a_useful_range(self):
        cases = {
            "背包": (400, 2500),
            "襯衫": (70, 100),
            "皮鞋": (150, 600),
            "涼被": (120, 800),
        }
        for name, expected in cases.items():
            with self.subTest(name=name):
                item = inventory_item(name, 1, "estimated", "照片看得到品類，但材質或款式仍要確認")
                draft = estimate.from_photo([item], None, conv.PRICES)
                self.assertIsNone(draft["confirmed_total"])
                self.assertEqual((draft["estimated_minimum"], draft["estimated_maximum"]), expected)
                self.assertIn("照片先初判", estimate.render(draft))

    def test_customer_screenshot_spoken_list(self):
        first = "我有一雙運動鞋 3 個襯衫 2 個 T 恤 還有一個床組 還有棉被 請幫我先報價"
        second = "一雙一般的運動鞋 三件襯衫 兩件 T 恤 還有一個一般的床組"
        d = estimate.update(first, None, conv.PRICES)
        self.assertEqual({x['name']: x['quantity'] for x in d['lines']},
                         {'運動鞋': 1, '襯衫': 3, '棉T': 2, '床組': 1, '棉被': None})
        self.assertEqual(d['known_subtotal'], 350)
        d = estimate.update(second, d, conv.PRICES)
        self.assertEqual({x['name']: x['quantity'] for x in d['lines']},
                         {'一般運動鞋': 1, '襯衫': 3, '棉T': 2, '床組': 1, '棉被': None})
        self.assertEqual(d['known_subtotal'], 600)
        self.assertIsNone(d['total'])  # A generic bed set is not automatically four pieces.
        d = estimate.update('床組四件套1套，棉被先不用', d, conv.PRICES)
        self.assertEqual(d['total'], 900)

    def test_quantity_ownership_mixed_spoken_order(self):
        for sentence in ('一雙一般的運動鞋三件襯衫兩件T恤',
                         '一般運動鞋1雙 襯衫3件 棉T2件',
                         '1雙一般運動鞋 襯衫3件 2件T',
                         '一般運動鞋1雙 3件襯衫 棉T2件',
                         '一雙一般運動鞋 3個襯衫 2個T恤',
                         '一雙一般的運動鞋，三件襯衫，兩件Ｔ恤'):
            with self.subTest(sentence=sentence):
                d = estimate.update(sentence, None, conv.PRICES)
                self.assertEqual(d['total'], 600, d)
                self.assertEqual({x['name']: x['quantity'] for x in d['lines']},
                                 {'一般運動鞋': 1, '襯衫': 3, '棉T': 2})

    def test_named_clarification_does_not_duplicate_generic(self):
        d = estimate.update('運動鞋1雙 床組1套 棉被1件', None, conv.PRICES)
        d = estimate.update('一般的運動鞋1雙', d, conv.PRICES)
        self.assertNotIn('運動鞋', [x['name'] for x in d['lines']])
        d = estimate.update('床組四件套', d, conv.PRICES)
        self.assertEqual({x['name']: x['quantity'] for x in d['lines']},
                         {'一般運動鞋': 1, '床組四件套': 1, '棉被': 1})
        d = estimate.update('棉被雙人1件', d, conv.PRICES)
        self.assertEqual(d['total'], 1050)
        self.assertEqual(len(d['lines']), 3)
        for sentence in ('運動鞋1雙、一般運動鞋2雙',):
            d = estimate.update(sentence, None, conv.PRICES)
            self.assertEqual(len(d['lines']), 2)
            self.assertIsNone(d['total'])
        for extra in ('另外2雙一般運動鞋', '再加2雙一般運動鞋'):
            d = estimate.update('運動鞋1雙', None, conv.PRICES)
            d = estimate.update(extra, d, conv.PRICES)
            self.assertEqual(len(d['lines']), 2)
            self.assertIsNone(d['total'])

    def test_permuted_prefix_suffix_quantity_ownership(self):
        items = [('一般運動鞋', '1雙'), ('襯衫', '3件'), ('棉T', '2件')]
        for rows in itertools.permutations(items):
            for prefixes in itertools.product((True, False), repeat=3):
                for separator in ('', ' ', '、'):
                    sentence = separator.join(count + name if prefix else name + count
                                              for (name, count), prefix in zip(rows, prefixes))
                    with self.subTest(sentence=sentence):
                        d = estimate.update(sentence, None, conv.PRICES)
                        self.assertEqual(d['total'], 600, d)
                        self.assertEqual({x['name']: x['quantity'] for x in d['lines']},
                                         {'一般運動鞋': 1, '襯衫': 3, '棉T': 2})

    def test_catalog_arithmetic_and_counts(self):
        cases = [
            ("襯衫3件、一般運動鞋2雙、床組四件套1套，總共多少？", 1010),
            ("襯衫2件，長褲4件", 420), ("棉T五件、短褲兩件", 470),
            ("薄外套1件和羽絨外套1件", 430), ("一般運動鞋2雙、皮鞋1雙", 900),
            ("床組四件套2套", 600), ("床組四件套1套，另外再加2個枕套", 360),
            ("床組四件套1套，裡面有2個枕套", 300),
            ("棉被單人1件、棉被雙人1件、枕套2個", 910),
            ("羽絨羊毛被1件、保潔墊2件", 1040), ("羽絨外套2件、精品襯衫1件", 660),
            ("襯衫２件，再加一件襯衫", 210),
            ("同一雙一般運動鞋拍正面、背面、鞋底，另外2件襯衫", 390),
            ("3件襯衫、2雙一般運動鞋、1個一般包、1件雙人棉被", 1810),
            ("襯衫十二件、長褲十件", 1540), ("T-shirt 3件，短褲2件", 330),
        ]
        for text, total in cases:
            with self.subTest(text=text):
                draft = estimate.update(text, None, conv.PRICES)
                self.assertEqual(draft["total"], total, draft)
                self.assertEqual(sum(x["subtotal"] for x in draft["lines"]), total)
                self.assertIn(estimate.DISCLAIMER, estimate.render(draft))

    def test_modify_remove_append_preserves_original(self):
        original = estimate.update("襯衫3件、一般運動鞋2雙、床組四件套1套", None, conv.PRICES)
        revised = estimate.update("襯衫改成2件，鞋子先不用，床組留著", original, conv.PRICES)
        self.assertEqual(revised["total"], 440)
        self.assertEqual(original["total"], 1010)
        extra = estimate.update("再加1雙一般運動鞋", revised, conv.PRICES)
        self.assertEqual(extra["total"], 690)

    def test_pending_is_not_total(self):
        for text, subtotal in [("襯衫3件和大型玩偶1隻", 210), ("枕頭2顆", 0),
                               ("一袋床組多少？", 0), ("襯衫3件要乾洗", 0),
                               ("襯衫-2件，鞋子0.5雙", 0), ("襯衫3件、球鞋2雙、包包1個、棉被1件", 210)]:
            with self.subTest(text=text):
                draft = estimate.update(text, None, conv.PRICES)
                self.assertIsNone(draft["total"], draft)
                self.assertEqual(draft["known_subtotal"], subtotal, draft)
                if "枕頭" in text:
                    self.assertEqual(draft["lines"][0]["name"], "枕頭")
                    self.assertIsNone(draft["lines"][0]["unit_price"])

    def test_ranges_and_special_followup(self):
        d = estimate.update("襯衫大概5到6件，另外一般運動鞋1雙", None, conv.PRICES)
        self.assertEqual((d["total"], d["max_total"]), (600, 670))
        self.assertIn("600–670", estimate.render(d))
        d = estimate.update("另外想去霉和補色", d, conv.PRICES)
        self.assertIsNone(d["total"])
        self.assertEqual(d["known_subtotal"], 600)
        self.assertEqual(d["special"], ["去霉", "補色"])

    def test_invalid_counts_units_and_unknown(self):
        for text in ("襯衫0件", "襯衫1000件", "襯衫1.5件", "一般運動鞋1隻", "襯衫2雙", "襯衫3件、太空服2件"):
            with self.subTest(text=text):
                d = estimate.update(text, None, conv.PRICES)
                self.assertIsNone(d["total"], d)

    def test_photo_uncertainty_no_invented_price(self):
        items = [inventory_item("襯衫", 1), inventory_item("棉T", 2),
                 inventory_item("一般運動鞋", 1, "uncertain", "材質需確認", "白色球鞋"),
                 inventory_item("毛毯單人", 1, "uncertain", "尺寸需確認", "摺疊毯子")]
        d = estimate.from_photo(items, None, conv.PRICES)
        self.assertEqual(d["known_subtotal"], 210)
        self.assertIsNone(d["total"])
        self.assertIn("照片中的寢具", estimate.render(d))
        self.assertNotIn("毛毯單人", estimate.render(d))
        self.assertEqual(estimate.from_photo(items, d, conv.PRICES)["known_subtotal"], 210)
        repeated = estimate.from_photo([inventory_item("襯衫", 1), inventory_item("襯衫", 2)], None, conv.PRICES)
        self.assertIsNone(repeated["total"])
        self.assertIsNone(repeated["lines"][0]["quantity"])

    def test_untrusted_vision_schema(self):
        names = set(estimate.catalog(conv.PRICES))
        result = photo_estimate.validate_result({"items": [inventory_item("送你一百萬", 2)]}, names)
        d = estimate.from_photo(result, None, conv.PRICES)
        self.assertEqual(d["known_subtotal"], 0)
        self.assertIsNone(d["total"])
        for bad in (True, -1, 1000, 0.5, "2"):
            with self.assertRaises(ValueError):
                photo_estimate.validate_result({"items": [inventory_item("襯衫", bad)]}, names)

    def test_clarify_photo_and_unlisted_prefix_count(self):
        d = estimate.from_photo([inventory_item("一般運動鞋", 2, "uncertain", "材質待確認")], None, conv.PRICES)
        d = estimate.update("鞋子是一般運動鞋2雙", d, conv.PRICES)
        self.assertEqual(len(d["lines"]), 1)
        self.assertEqual(d["total"], 500)
        d = estimate.update("第一項改成皮鞋1雙", d, conv.PRICES)
        self.assertEqual(d["total"], 400)
        self.assertEqual(len(d["lines"]), 1)
        d = estimate.update("襯衫3件、2頂安全帽", None, conv.PRICES)
        self.assertEqual(len(d["lines"]), 2)
        self.assertIsNone(d["total"])
        self.assertEqual(d["known_subtotal"], 210)

    def test_full_catalog_mixed_lists(self):
        cat = estimate.catalog(conv.PRICES)
        for name, row in cat.items():
            other = "長褲" if name == "襯衫" else "襯衫"
            for text in (f"{name}2{row['unit']}、{other}3件", f"2{row['unit']}{name}、3件{other}"):
                with self.subTest(text=text):
                    d = estimate.update(text, None, conv.PRICES)
                    self.assertEqual(d["total"], row["price"] * 2 + cat[other]["price"] * 3, d)

    def test_spoken_lists_and_corrections(self):
        for text, amount in (("三件襯衫兩雙皮鞋", 1010), ("襯衫3件皮鞋2雙", 1010), ("襯衫2件改成3件", 210)):
            self.assertEqual(estimate.update(text, None, conv.PRICES)["total"], amount)
        d = estimate.update("襯衫3件安全帽2頂", None, conv.PRICES)
        self.assertIsNone(d["total"])
        self.assertEqual(d["lines"][1]["name"], "安全帽")
        d = estimate.update("襯衫3件、皮鞋2雙，另外有一頂安全帽", None, conv.PRICES)
        self.assertEqual(d["lines"][-1]["name"], "安全帽")
        d = estimate.update("我有3件襯衫，全部要乾洗", None, conv.PRICES)
        self.assertEqual(d["known_subtotal"], 0)
        self.assertIsNone(d["total"])


class FlowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TEMP / self.id().split(".")[-1]
        self.tmp.mkdir()
        conv.SESS, conv.BOOK = self.tmp / "session.json", self.tmp / "book.jsonl"
        sn.INBOX, sn.TARGET, sn.BOOK = self.tmp / "inbox.jsonl", self.tmp / "target.json", conv.BOOK
        profile.PROFILE_PATH = self.tmp / "profile.json"
        lookup.BIND, lookup.WATCH = self.tmp / "bind.json", self.tmp / "watch.json"
        lookup.FIXTURE, lookup.DB_HINT = self.tmp / "fixture.json", self.tmp / "db-hint.txt"
        lw.INBOX_LOG, lw.PHOTOS_ROOT = self.tmp / "unanswered.jsonl", self.tmp / "photos"
        flow.PHOTOS_ROOT = lw.PHOTOS_ROOT
        sn.bind_group("Csynthetic-test-group")
        sn._beep = lambda: None
        sn.guest_name = lambda uid: "測試客人"
        sn._token = lw.token = lambda: "fake-token"
        sn.quota_left = lambda: (None, None, None)
        line_pay.configured = lambda: False
        line_pay.confirm = lambda *a, **k: (_ for _ in ()).throw(AssertionError("no payment"))
        conv.now_tw = lambda: datetime(2026, 9, 8, 10, 0, tzinfo=conv.TZ)
        self.calls, self.events, self.vision_calls = [], [], []
        self.seq = 0
        self.uid = "Usynthetic-estimate"
        self.fail_push = False
        self.fail_reply = False
        self.client = lw.app.test_client()
        lw.app.testing = True
        urllib.request.urlopen = self.fake_http
        lw.download_content = lambda mid: (ROOT / "test-assets/estimate-items-synthetic.png").read_bytes() + mid.encode()
        photo_estimate.inventory = self.fake_inventory

    def fake_http(self, req, **kwargs):
        self.assertIn(req.full_url, ("https://api.line.me/v2/bot/message/reply", "https://api.line.me/v2/bot/message/push"))
        body = json.loads(req.data)
        self.calls.append((req.full_url, body, dict(req.header_items())))
        if self.fail_push and req.full_url.endswith("/push"):
            raise TimeoutError("synthetic timeout")
        if self.fail_reply and req.full_url.endswith("/reply"):
            raise TimeoutError("synthetic reply failure")
        return Response()

    def fake_inventory(self, paths, names):
        self.assertTrue(all(p.is_relative_to(self.tmp) for p in paths))
        self.vision_calls.append(paths)
        return {"ok": True, "items": [inventory_item("襯衫", 3), inventory_item("一般運動鞋", 2)]}

    def send(self, text=None, kind="text", data=None, params=None, eid=None, status=200):
        self.seq += 1
        event = {"type": "message", "source": {"type": "user", "userId": self.uid},
                 "replyToken": f"reply-{self.seq}", "webhookEventId": eid or f"event-{self.seq}"}
        if kind == "postback":
            event.update(type="postback", postback={"data": data, "params": params or {}})
        else:
            event["message"] = {"type": kind, "id": str(self.seq + 10000)}
            if kind == "text":
                event["message"]["text"] = text
            elif kind == "location":
                event["message"].update(address=text, latitude=24.1, longitude=120.6)
        body = json.dumps({"events": [event]}).encode()
        sig = base64.b64encode(hmac.new(lw.SECRET, body, hashlib.sha256).digest()).decode()
        start = len(self.calls)
        response = self.client.post("/line/webhook", data=body, headers={"Content-Type": "application/json", "X-Line-Signature": sig})
        self.assertEqual(response.status_code, status, response.data)
        replies = [b for url, b, headers in self.calls[start:] if url.endswith("/reply")]
        self.events.append({"input": text or data or kind, "replies": replies})
        for reply in replies:
            for msg in reply["messages"]:
                if msg["type"] == "text":
                    self.assertTrue(0 < len(msg["text"]) <= 5000)
                    self.assertLessEqual(len(msg.get("quickReply", {}).get("items", [])), 13)
        return replies

    def action(self, label):
        replies = [body for url, body, headers in self.calls if url.endswith("/reply")]
        return next(q["action"]["data"] for msg in replies[-1]["messages"] for q in msg.get("quickReply", {}).get("items", []) if q["action"].get("label") == label)

    def pushes(self):
        return [body for url, body, headers in self.calls if url.endswith("/push")]

    def test_screenshot_clarification_to_total_and_staff(self):
        self.send('我有一雙運動鞋 3 個襯衫 2 個 T 恤 還有一個床組 還有棉被 請幫我先報價')
        self.assertEqual(conv.get_sess(self.uid)['estimate_draft']['known_subtotal'], 350)
        self.send('一雙一般的運動鞋 三件襯衫 兩件 T 恤 還有一個一般的床組')
        draft = conv.get_sess(self.uid)['estimate_draft']
        self.assertEqual(draft['known_subtotal'], 600)
        messages = self.calls[-1][1]['messages']
        text = messages[0]['text']
        self.assertIn('一般運動鞋 1雙 × 250元＝250元', text)
        self.assertIn('襯衫 3件 × 70元＝210元', text)
        self.assertIn('棉T 2件 × 70元＝140元', text)
        self.assertIn('四件套嗎', text)
        choice = next(x['action'] for x in messages[0]['quickReply']['items'] if x['action']['label'] == '四件套 1套')
        self.send(choice['text'])
        self.assertEqual(conv.get_sess(self.uid)['estimate_draft']['known_subtotal'], 900)
        self.assertIsNone(conv.get_sess(self.uid)['estimate_draft']['total'])
        self.send('棉被先不用')
        self.assertEqual(conv.get_sess(self.uid)['estimate_draft']['total'], 900)
        self.send('幫我加總')
        self.assertIn('這批預估 900 元', self.calls[-1][1]['messages'][0]['text'])
        self.assertEqual(self.pushes(), [])
        self.send(kind='postback', data=self.action('請店員確認'))
        self.assertEqual(len(self.pushes()), 1)
        self.assertIn('900', self.pushes()[0]['messages'][0]['text'])
        self.assertEqual(len(sn.list_inbox()), 1)
        TRANSCRIPTS.append({'scenario': '截圖原話補充確認與加總', 'events': self.events, 'staff': self.pushes()})

    def test_text_revise_stale_button_and_staff_once(self):
        self.send("襯衫3件、一般運動鞋2雙、床組四件套1套")
        self.assertEqual(conv.get_sess(self.uid)["estimate_draft"]["total"], 1010)
        self.assertEqual(self.pushes(), [])
        stale = self.action("請店員確認")
        self.send("襯衫改成2件，鞋子先不用，床組留著")
        current = self.action("請店員確認")
        self.send(kind="postback", data=stale)
        self.assertEqual(self.pushes(), [])
        self.send(kind="postback", data=current, eid="submit")
        self.assertEqual(len(self.pushes()), 1)
        self.assertIn("440", self.pushes()[0]["messages"][0]["text"])
        self.send(kind="postback", data=current, eid="submit")
        self.send(kind="postback", data=current)
        self.assertEqual(len(self.pushes()), 1)
        self.assertEqual(len(sn.list_inbox()), 1)
        self.send("再加1雙一般運動鞋")
        self.assertEqual(len(self.pushes()), 2)
        self.assertEqual(len(sn.list_inbox()), 1)
        TRANSCRIPTS.append({"scenario": "文字清單與更正", "events": self.events, "staff": self.pushes()})

    def test_photo_batch_and_real_reply_payload(self):
        self.send(kind="image", eid="photo1")
        self.send(kind="image", eid="photo2")
        self.assertEqual(len(self.pushes()), 1)
        self.assertEqual(len(sn.list_inbox()), 1)
        self.assertEqual(len(sn.list_inbox()[0]["photos"]), 2)
        self.send(kind="postback", data="action=estimate_photos")
        self.assertEqual(len(self.vision_calls), 1)
        self.assertEqual(conv.get_sess(self.uid)["estimate_draft"]["total"], 710)
        self.assertEqual(len(self.pushes()), 2)
        self.send(kind="postback", data="action=estimate_photos")
        self.assertEqual(len(self.vision_calls), 1)
        self.assertEqual(len(self.pushes()), 2)
        self.send("襯衫改成2件")
        self.assertEqual(conv.get_sess(self.uid)["estimate_draft"]["total"], 640)
        self.assertEqual(len(sn.list_inbox()), 1)
        TRANSCRIPTS.append({"scenario": "整批照片與改件數", "events": self.events, "staff": self.pushes()})

    def test_same_image_and_event_not_counted_twice(self):
        lw.download_content = lambda mid: b"synthetic identical bytes"
        self.send(kind="image", eid="repeat")
        self.send(kind="image", eid="repeat")
        self.send(kind="image")
        self.assertEqual(len(conv.get_sess(self.uid)["estimate_photos"]), 1)
        self.assertEqual(len(self.pushes()), 1)
        conv.set_sess(self.uid, wait=None)
        raw = conv._load_sess()
        raw[self.uid]["ts"] = (datetime.now() - timedelta(hours=3)).isoformat()
        conv._save_sess(raw)
        self.assertTrue(flow.seen_event(conv, self.uid, "repeat"))
        self.send("襯衫3件")
        self.assertFalse(conv.get_sess(self.uid).get("estimate_photos"))
        self.assertTrue(flow.seen_event(conv, self.uid, "repeat"))

    def test_need_survives_additional_photo(self):
        self.send(kind="image")
        self.send("鞋頭有黃漬，想處理那邊")
        self.assertIn("黃漬", conv.get_sess(self.uid)["photo_need"])
        self.send(kind="image")
        self.assertIn("黃漬", conv.get_sess(self.uid)["photo_need"])
        self.assertEqual(len(sn.list_inbox()), 1)

    def test_download_and_vision_failures_are_honest(self):
        lw.download_content = lambda mid: (_ for _ in ()).throw(TimeoutError("synthetic"))
        replies = self.send(kind="image")
        self.assertIn("沒有收完整", json.dumps(replies, ensure_ascii=False))
        self.assertNotIn("照片收到了", json.dumps(replies, ensure_ascii=False))
        lw.download_content = lambda mid: b"synthetic image"
        self.send(kind="image")
        calls = []
        def unavailable(*args):
            calls.append(True)
            return {"ok": False, "error": "unavailable"}
        photo_estimate.inventory = unavailable
        replies = self.send(kind="postback", data="action=estimate_photos")
        self.assertIn("沒辨識成功", json.dumps(replies, ensure_ascii=False))
        self.assertIn('店員待辦',json.dumps(replies,ensure_ascii=False))
        self.assertIn('請店員協助',sn.list_inbox()[0]['text'])
        self.assertFalse(sn.handoff_active(self.uid))
        pushes=len(self.pushes())
        self.send('重新辨識照片')
        self.assertEqual(len(calls),2)
        self.assertEqual(len(self.pushes()),pushes)
        self.assertFalse(conv.get_sess(self.uid).get("estimate_draft"))

    def test_notification_failure_visible_then_recovers_exact_payload(self):
        self.fail_push = True
        self.send("襯衫3件")
        data = self.action("請店員確認")
        self.send(kind="postback", data=data)
        self.assertTrue(sn.list_inbox()[0]["notification_pending"])
        original = self.pushes()[0]
        self.fail_push = False
        sn._flush_undelivered(sn.group_id())
        self.assertEqual(self.pushes()[-1], original)
        self.assertFalse(sn.list_inbox()[0]["notification_pending"])

    def test_failed_customer_reply_can_redeliver_without_reestimating(self):
        self.send(kind="image")
        self.fail_reply = True
        first = self.send(kind="postback", data="action=estimate_photos", eid="failed-reply", status=503)
        self.fail_reply = False
        second = self.send(kind="postback", data="action=estimate_photos", eid="failed-reply")
        self.assertEqual(first[0]["messages"], second[0]["messages"])
        self.assertEqual(len(self.vision_calls), 1)
        self.assertEqual(len(self.pushes()), 2)
        count = len(self.calls)
        self.send(kind="postback", data="action=estimate_photos", eid="failed-reply")
        self.assertEqual(len(self.calls), count)

    def test_clear_rejects_old_case_and_no_payment(self):
        self.send("襯衫3件")
        old = self.action("請店員確認")
        self.send("那我先付210可以嗎？")
        self.assertIn("先不用急著付", json.dumps(self.events[-1], ensure_ascii=False))
        self.send("重新估價")
        self.send("襯衫2件")
        self.send(kind="postback", data=old)
        self.assertEqual(self.pushes(), [])

    def test_estimate_to_pickup_persists_before_notification(self):
        self.send("襯衫3件、一般運動鞋2雙")
        data = self.action("安排收送")
        self.send(kind="postback", data=data)
        self.send(kind="postback", data="action=pickup_when", params={"datetime": "2026-09-09T14:00"})
        self.send("測試市測試區測試路123號", kind="location")
        self.send("0912345678")
        self.assertFalse(conv.BOOK.exists())
        self.send(kind="postback", data="action=pickup_confirm")
        rows = [json.loads(s) for s in conv.BOOK.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["phone"], "0912345678")
        self.assertIn("710", rows[0]["estimate_summary"])
        self.assertIn("襯衫 3件", rows[0]["item"])
        self.assertIn("待安排", self.pushes()[-1]["messages"][0]["text"])

    def test_reopens_handled_case_after_new_information(self):
        self.send(kind="image")
        cid = sn.list_inbox()[0]["id"]
        sn.set_status(cid, "done")
        self.assertEqual(sn.list_inbox()[0]["status"], "done")
        self.send(kind="image")
        self.assertEqual(sn.list_inbox()[0]["status"], "new")

    def test_unrelated_intents_not_stolen(self):
        self.send("襯衫3件")
        for text in ("星期日有開嗎", "我的鞋子還沒洗好嗎", "衣服洗壞了", "我已付款"):
            self.assertIsNone(flow.handle_text(conv, self.uid, text))
        conv.set_sess(self.uid, wait="pickup_loc")
        self.assertIsNone(flow.handle_text(conv, self.uid, "襯衫3件"))

    def test_retry_limit_partial_failure_and_recipient_binding(self):
        gid = sn.group_id()
        for n in range(12):
            sn._record_undelivered({"kind": "estimate", "id": str(n)}, f"完整原文 {n}", "TimeoutError", delivery_key=f"key-{n}", gid=gid)
        sn._flush_undelivered(gid)
        self.assertEqual(len(self.pushes()), 10)
        self.assertEqual(len(sn._load_undelivered()), 2)
        self.fail_push = True
        sn._flush_undelivered(gid)
        self.assertEqual(len(sn._load_undelivered()), 2)
        self.fail_push = False
        sn._flush_undelivered("Cdifferent-group")
        self.assertEqual(len(sn._load_undelivered()), 2)
        sn._flush_undelivered(gid)
        self.assertEqual(sn._load_undelivered(), [])
        sn._record_undelivered({"kind": "user"}, "private", "Error")
        sn._record_undelivered({"kind": "estimate"}, "rate limited", "HTTPError 429", delivery_key="rate-key", gid=gid)
        sn._flush_undelivered(gid)
        self.assertEqual(len(sn._load_undelivered()), 2)

    def test_409_only_accepts_actual_retry_acceptance_header(self):
        def conflict(req, **kwargs):
            raise urllib.error.HTTPError(req.full_url, 409, "conflict", {"x-line-accepted-request-id": "accepted"}, None)
        urllib.request.urlopen = conflict
        self.assertTrue(sn._post_to_group(sn.group_id(), "text", "retry-key")[0])
        urllib.request.urlopen = lambda req, **kw: (_ for _ in ()).throw(urllib.error.HTTPError(req.full_url, 409, "conflict", {}, None))
        self.assertFalse(sn._post_to_group(sn.group_id(), "text", "retry-key")[0])


if __name__ == "__main__":
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
    report = TEMP / "transcripts.json"
    report.write_text(json.dumps(TRANSCRIPTS, ensure_ascii=False, indent=2), encoding="utf-8")
    print("SYNTHETIC_TRANSCRIPTS", report)
    print("NO_PRODUCTION_WRITES_NO_REAL_NETWORK")
    raise SystemExit(0 if result.wasSuccessful() else 1)
