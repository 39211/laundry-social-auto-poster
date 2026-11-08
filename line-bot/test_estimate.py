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
# V1-3: photo-model usage counts go to the isolated temp dir, never to the repo's data/.
os.environ["LAUNDRY_VISION_USAGE_DIR"] = str(TEMP / "vision-usage")
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

# T-2: the arithmetic below was written against data/prices.json of 2026-10-08. At import the bot
# aligns PRICES with the live eHank catalogue (price-align.json), which changes whenever the shop
# edits a price, so the tests use a frozen copy of only the items they mention (not the whole price
# list) and run as if the alignment were off.
FROZEN_PRICES = ROOT / "test-assets" / "prices-test-subset.json"
conv.PRICES.clear()
conv.PRICES.update(json.loads(FROZEN_PRICES.read_text(encoding="utf-8")))
conv.PRICE_LABELS.clear()
conv.PRICE_BASIS = "off"
conv.CATS.clear()
conv.CATS.update({k: v for k, v in conv.PRICES.items() if isinstance(v, dict)})
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


PHOTO_FIELD_DEFAULTS = dict(brand="", model="", material="", color="", stain="", craft="", question="")
PHOTO_PRICES = {
    "包包": {"名牌包": 1500, "背包": 600},
    "鞋子": {"名牌鞋": 600, "一般運動鞋": 250, "皮類運動鞋": 300, "混合運動鞋": 350},
    "寢具": {"棉被單人": 350, "棉被雙人": 500},
    "衣物": {"襯衫": 70},
}
TEXT_PRICES = {"衣物": {"襯衫": 70}, "鞋子": {"一般運動鞋": 250, "皮類運動鞋": 300, "混合運動鞋": 350}}


def inventory_item(name, quantity, certainty="clear", reason="", label=None, **fields):
    row = dict(name=name, quantity=quantity, certainty=certainty, reason=reason, label=label or name)
    row.update(PHOTO_FIELD_DEFAULTS)
    row.update(fields)
    return row


def photo_rows(*rows, prices=PHOTO_PRICES):
    return photo_estimate.validate_result({"items": list(rows)}, set(estimate.catalog(prices)))


def photo_render(*rows, prices=PHOTO_PRICES):
    draft = estimate.from_photo(photo_rows(*rows, prices=prices), None, prices)
    return draft, estimate.render(draft)


def text_line(name, quantity, max_quantity=None, unit="件", reason=""):
    return {"name": name, "quantity": quantity, "max_quantity": quantity if max_quantity is None else max_quantity,
            "unit": unit, "reason": reason, "source": "text"}


TRANSCRIPTS = []


class ProviderTests(unittest.TestCase):
    def invoke(self, effects, env=None):
        body={'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':json.dumps({'items':[inventory_item('混合運動鞋',1,'estimated','先按可見款式估')]})}]}}]}
        effects=[Response(body) if x=='ok' else x for x in effects]
        settings={'GEMINI_API_KEY':'synthetic-key','LAUNDRY_PHOTO_ESTIMATE':'1','LAUNDRY_VISION_MODEL':'gemini-2.5-flash'}
        settings.update(env or {})
        with patch.dict(os.environ,settings), \
             patch.object(photo_estimate.urllib.request,'urlopen',side_effect=effects) as request, \
             patch.object(photo_estimate.time,'sleep'):
            result=ORIGINAL_INVENTORY([ROOT/'test-assets/estimate-items-synthetic.png'],['混合運動鞋'])
        return result,request

    def test_503_recovers_with_fallback_model(self):
        # 10/31 night: gemini-2.5-flash answered 429 (free-tier 5/min) and 503; the retry goes
        # to the fallback model in plain JSON mode (flash-lite rejects SCHEMA with HTTP 400).
        # 11/05: 2.5-flash itself also uses plain JSON with thinking off, the shape that answered
        # in production on 11/02.
        result,request=self.invoke([urllib.error.HTTPError('synthetic',503,'busy',None,None),'ok'])
        self.assertTrue(result['ok']);self.assertEqual(request.call_count,2)
        self.assertEqual(result['model'],'gemini-2.5-flash-lite')
        first,second=[call.args[0] for call in request.call_args_list]
        self.assertIn('/models/gemini-2.5-flash:',first.full_url)
        self.assertIn('/models/gemini-2.5-flash-lite:',second.full_url)
        self.assertNotIn('responseJsonSchema',json.loads(first.data)['generationConfig'])
        self.assertEqual(json.loads(first.data)['generationConfig'].get('thinkingConfig'),{'thinkingBudget':0})
        self.assertNotIn('responseJsonSchema',json.loads(second.data)['generationConfig'])

    def invoke_default_chain(self, effects):
        body={'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':json.dumps({'items':[inventory_item('混合運動鞋',1,'estimated','先按可見款式估')]})}]}}]}
        effects=[Response(body) if x=='ok' else x for x in effects]
        env={k:v for k,v in os.environ.items() if k not in ('LAUNDRY_VISION_MODEL','LAUNDRY_VISION_FALLBACK_MODEL')}
        env.update({'GEMINI_API_KEY':'synthetic-key','LAUNDRY_PHOTO_ESTIMATE':'1'})
        with patch.dict(os.environ,env,clear=True), \
             patch.object(photo_estimate.urllib.request,'urlopen',side_effect=effects) as request, \
             patch.object(photo_estimate.time,'sleep'):
            result=ORIGINAL_INVENTORY([ROOT/'test-assets/estimate-items-synthetic.png'],['混合運動鞋'])
        return result,request

    def test_default_chain_puts_proven_model_first(self):
        # Unpinned production path: 2.5-flash first (flash-latest timed out on every production photo);
        # each free-tier model has its own quota, so a 429 moves on to the next model.
        quota=urllib.error.HTTPError('synthetic',429,'quota',None,None)
        result,request=self.invoke_default_chain([quota,quota,'ok'])
        self.assertTrue(result['ok']);self.assertEqual(request.call_count,3)
        urls=[call.args[0].full_url for call in request.call_args_list]
        self.assertIn('/models/gemini-2.5-flash:',urls[0])
        self.assertIn('/models/gemini-flash-latest:',urls[1])
        self.assertIn('/models/gemini-flash-lite-latest:',urls[2])
        self.assertEqual(result['model'],'gemini-flash-lite-latest')
        first=json.loads(request.call_args_list[0].args[0].data)['generationConfig']
        # 2.5-flash keeps the shape that answered in production: plain JSON, thinking off.
        self.assertNotIn('responseJsonSchema',first)
        self.assertEqual(first.get('thinkingConfig'),{'thinkingBudget':0})
        self.assertNotIn('responseJsonSchema',json.loads(request.call_args_list[2].args[0].data)['generationConfig'])

    def test_default_chain_is_bounded_to_three_calls(self):
        busy=urllib.error.HTTPError('synthetic',503,'busy',None,None)
        result,request=self.invoke_default_chain([busy]*5)
        self.assertEqual(result,{'ok':False,'error':'provider_503'});self.assertEqual(request.call_count,3)

    def test_schema_400_moves_to_next_model(self):
        bad=urllib.error.HTTPError('synthetic',400,'schema too many states',None,None)
        result,request=self.invoke_default_chain([bad,'ok'])
        self.assertTrue(result['ok']);self.assertEqual(result['model'],'gemini-flash-latest')

    def test_429_quota_also_uses_fallback(self):
        result,request=self.invoke([urllib.error.HTTPError('synthetic',429,'quota',None,None),'ok'])
        self.assertTrue(result['ok']);self.assertEqual(result['model'],'gemini-2.5-flash-lite')

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

    def test_prompt_uses_rules_part_of_knowledge_only(self):
        folder = TEMP / 'knowledge-rules'
        folder.mkdir(exist_ok=True)
        (folder / 'Memory.md').write_text('# 鞋類\n- 合成規則甲：麂皮手工刷洗\n## 📝 動態紀錄\n- 合成紀錄乙：不能送出\n', encoding='utf-8')
        (folder / 'Clothing_Memory.md').write_text('# 衣物\n- 合成規則丙：兩條褲管是褲子\n## 📝 動態紀錄\n- 合成紀錄丁\n', encoding='utf-8')
        with patch.dict(os.environ, {'LAUNDRY_VISION_KNOWLEDGE_DIR': str(folder)}):
            prompt = photo_estimate.build_prompt(['襯衫', '名牌包'])
        for kept in ('合成規則甲', '合成規則丙', '不評論真偽', '品名：襯衫、名牌包', '分類提示'):
            self.assertIn(kept, prompt)
        for dropped in ('合成紀錄乙', '合成紀錄丁', '📝'):
            self.assertNotIn(dropped, prompt)
        result, request = self.invoke(['ok'], {'LAUNDRY_VISION_KNOWLEDGE_DIR': str(folder)})
        self.assertTrue(result['ok'])
        sent = json.loads(request.call_args[0][0].data)['contents'][0]['parts'][0]['text']
        self.assertIn('合成規則甲', sent)
        self.assertNotIn('合成紀錄乙', sent)

    def test_missing_knowledge_dir_still_works(self):
        missing = TEMP / 'no-such-knowledge-dir'
        with patch.dict(os.environ, {'LAUNDRY_VISION_KNOWLEDGE_DIR': str(missing)}):
            prompt = photo_estimate.build_prompt(['襯衫'])
        self.assertNotIn('門市知識規則', prompt)
        self.assertIn('品名：襯衫', prompt)
        result, request = self.invoke(['ok'], {'LAUNDRY_VISION_KNOWLEDGE_DIR': str(missing)})
        self.assertTrue(result['ok']); self.assertEqual(request.call_count, 1)

    def test_new_fields_required_by_schema(self):
        required = photo_estimate.SCHEMA['properties']['items']['items']['required']
        names = {'襯衫'}
        for field in ('brand', 'model', 'material', 'color', 'stain', 'craft', 'question'):
            with self.subTest(field=field):
                self.assertIn(field, required)
                row = inventory_item('襯衫', 1)
                del row[field]
                with self.assertRaises(ValueError):
                    photo_estimate.validate_result({'items': [row]}, names)
                row = inventory_item('襯衫', 1)
                row[field] = None
                with self.assertRaises(ValueError):
                    photo_estimate.validate_result({'items': [row]}, names)

    def test_price_url_phone_payment_removed_from_text(self):
        row = inventory_item('襯衫', 1, craft='領口會先酵素預浸，加強費用200元',
                             question='要加強去漬嗎？請匯款到帳戶', stain='領口黃漬，詳見 https://evil.example.com')
        item = photo_rows(row)[0]
        self.assertEqual(item['craft'], '領口會先酵素預浸')
        self.assertEqual(item['question'], '要加強去漬嗎？')
        self.assertEqual(item['stain'], '領口黃漬')
        cases = {'NT$300 加強處理': '', '請打0912345678詢問': '', '詳見 www.example.com': '',
                 '可以先付款': '', '$ 50 加購': '', '低溫柔洗，三百元': '低溫柔洗', '已付現金': ''}
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(photo_rows(inventory_item('襯衫', 1, craft=text, question=text))[0]['craft'], expected)
                self.assertEqual(photo_rows(inventory_item('襯衫', 1, craft=text, question=text))[0]['question'], expected)
        self.assertEqual(photo_rows(inventory_item('襯衫', 1, brand='**LV**'))[0]['brand'], 'LV')

    def test_field_length_limits(self):
        long = '甲' * 200
        item = photo_rows(inventory_item('襯衫', 1, brand=long, model=long, material=long, color=long,
                                         stain=long, craft=long, question=long))[0]
        limits = {'brand': 40, 'model': 40, 'material': 40, 'color': 20, 'stain': 80, 'craft': 80, 'question': 50}
        for field, limit in limits.items():
            self.assertEqual(len(item[field]), limit, field)

    def test_merge_keeps_first_non_empty_fields(self):
        merged = photo_rows(inventory_item('襯衫', 1, craft='低溫柔洗'),
                            inventory_item('襯衫', 1, brand='Uniqlo', craft='整燙'))
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]['quantity'], 2)
        self.assertEqual(merged[0]['brand'], 'Uniqlo')
        self.assertEqual(merged[0]['craft'], '低溫柔洗')


class PhotoRenderTests(unittest.TestCase):
    def test_brand_shown_only_when_provided(self):
        draft, text = photo_render(inventory_item('名牌包', 1, 'estimated', '看得到包款', label='咖啡色手提包'))
        self.assertNotIn('LV', text); self.assertNotIn('Louis', text)
        self.assertIn('咖啡色手提包', text)
        draft, text = photo_render(inventory_item('名牌包', 1, 'estimated', '看得到老花', label='咖啡色手提包',
                                                  brand='LV', model='Monogram Speedy', material='塗層帆布、真皮把手'))
        self.assertEqual(text.split('\n')[0],
                         '這個是 LV Monogram Speedy（塗層帆布、真皮把手），門市分類【名牌包】，清洗費用 1,500 元，約 14 天。')

    def test_luxury_bag_uses_catalogue_price(self):
        draft, text = photo_render(inventory_item('名牌包', 1, 'estimated', '看得到經典老花', brand='LV'))
        self.assertEqual(draft['total'], 1500)
        self.assertEqual((draft['estimated_minimum'], draft['estimated_maximum']), (1500, 1500))
        self.assertNotIn('先抓', text)
        self.assertNotIn('estimate_assumption', '') if not draft['lines'][0]['estimate_assumption'] else self.fail()

    def test_uncertain_still_a_range(self):
        draft, text = photo_render(inventory_item('一般運動鞋', 1, 'uncertain', '材質看不清楚'))
        self.assertIsNone(draft['confirmed_total'])
        self.assertEqual((draft['estimated_minimum'], draft['estimated_maximum']), (250, 350))
        self.assertIn('先抓 250–350 元', text)

    def test_quantity_written_per_unit(self):
        draft, text = photo_render(inventory_item('名牌鞋', 2, 'estimated', '', brand='Gucci', model='Ace'))
        self.assertEqual(text.split('\n')[0],
                         '這 2 雙是 Gucci Ace，門市分類【名牌鞋】，清洗費用每雙 600 元 × 2 雙＝1,200 元，約 7 天。')

    def test_turnaround_per_group(self):
        for name, days in (('名牌鞋', '7 天'), ('一般運動鞋', '7 天'), ('名牌包', '14 天'), ('背包', '14 天'),
                           ('棉被雙人', '10–14 天'), ('襯衫', '5–7 天')):
            with self.subTest(name=name):
                draft, text = photo_render(inventory_item(name, 1, 'clear'))
                self.assertIn(f'約 {days}。', text)
                self.assertEqual(estimate.photo_turnaround(name, estimate.catalog(PHOTO_PRICES)[name]['category']), days)

    def test_photo_only_render_shape(self):
        draft, text = photo_render(
            inventory_item('名牌包', 1, 'estimated', '', brand='LV', stain='提把邊角磨損',
                           craft='會用皮革專用清潔再上保養乳', question='包內有筆痕嗎'),
            inventory_item('一般運動鞋', 2, 'uncertain', '材質看不清楚'),
            inventory_item('棉被雙人', None, 'uncertain', '尺寸要確認'))
        rows = text.split('\n')
        self.assertLessEqual(len(rows), 8)
        self.assertNotIn(estimate.DISCLAIMER, text)
        self.assertEqual(rows[-1], '實際以到店看件為準。')
        for detail in ('照片看到提把邊角磨損', '會用皮革專用清潔再上保養乳', '可以補拍洗標或材質標示嗎？'):
            self.assertIn(detail, text)
        self.assertNotIn('包內有筆痕嗎', text)  # r2: missing evidence gets the one question.
        self.assertNotIn('*', text)
        draft, text = photo_render(inventory_item('名牌包', 1, 'estimated'),
                                   inventory_item('名牌鞋', 2, 'clear'),
                                   inventory_item('襯衫', 1, 'clear'))
        self.assertEqual(draft['total'], 2770)
        self.assertIn('這批合計 2,770 元。', text)
        self.assertLessEqual(len(text.split('\n')), 8)
        self.assertNotIn(estimate.DISCLAIMER, text)
        self.assertTrue(text.endswith('實際以到店看件為準。'))

    def test_mixed_text_and_photo_keeps_existing_render(self):
        photo = estimate.from_photo(photo_rows(inventory_item('名牌包', 1, 'estimated')), None, PHOTO_PRICES)
        mixed = estimate.update('襯衫3件', photo, PHOTO_PRICES)
        self.assertEqual({x['source'] for x in mixed['lines']}, {'photo', 'text'})
        text = estimate.render(mixed)
        self.assertIn(estimate.DISCLAIMER, text)
        self.assertNotIn('實際以到店看件為準。', text)

    def test_text_render_is_byte_identical(self):
        opening = '幫你算好了，先按一般水洗價：'
        cases = [
            ([text_line('襯衫', 3), text_line('一般運動鞋', 2, unit='雙')], [],
             '\n'.join([opening, '', '襯衫 3件 × 70元＝210元', '一般運動鞋 2雙 × 250元＝500元', '',
                        '這批預估 710 元。', '', estimate.DISCLAIMER])),
            ([text_line('襯衫', 2), text_line('運動鞋', 1, unit='雙', reason='請確認一般、皮類或混合運動鞋'),
              text_line('枕頭', None, unit='顆', reason='枕頭本體不是枕套，請補洗標或交店員看件')], [],
             '\n'.join([opening, '', '襯衫 2件 × 70元＝140元', '', '這批先抓約 390–490 元。',
                        '已確認品項小計 140 元。', '', '還有幾項先用區間抓：運動鞋 1雙：先抓 250–350 元。', '',
                        '還沒加進去：枕頭（件數還沒說）。',
                        '運動鞋是一般、皮類還是混合材質？可以按下面選；不確定就拍給我們看。', '', estimate.DISCLAIMER])),
            ([text_line('襯衫', 5, 6)], ['去霉'],
             '\n'.join([opening, '', '襯衫 5–6件 × 70元＝350–420元', '', '這批先抓約 350–420 元。',
                        '已確認品項小計 350 元。', '另外待評估：去霉，尚未加計。', '', estimate.DISCLAIMER])),
        ]
        with patch.object(estimate, '_estimate_basis', lambda: 'off'), \
             patch.object(estimate, '_adopted_label', lambda name: ''):
            for lines, special, expected in cases:
                with self.subTest(first=lines[0]['name'], count=len(lines)):
                    draft = estimate.price({'lines': lines, 'special': special, 'revision': 1, 'source': 'text'}, TEXT_PRICES)
                    self.assertEqual(estimate.render(draft), expected)


class EngineTests(unittest.TestCase):
    def test_estimated_photo_uses_single_catalog_price(self):
        cat = estimate.catalog(conv.PRICES)
        item = inventory_item('混合運動鞋', 1, 'estimated', '先按混合運動鞋估')
        draft = estimate.from_photo([item], None, conv.PRICES)
        unit = cat['混合運動鞋']['price']
        # The amount is the catalogue row's price, never a model number.
        self.assertEqual(draft['total'], unit)
        self.assertEqual((draft['estimated_minimum'], draft['estimated_maximum']), (unit, unit))
        self.assertEqual(draft['lines'][0]['estimate_assumption'], '')
        text = estimate.render(draft)
        self.assertIn(f'清洗費用 {unit:,} 元', text)
        self.assertIn('約 7 天', text)
        self.assertNotIn('照片先初判', text)
        self.assertTrue(text.endswith('實際以到店看件為準。'))
        self.assertNotIn(estimate.DISCLAIMER, text)

    def test_estimated_photo_catalog_rows_get_their_catalog_price(self):
        cat = estimate.catalog(conv.PRICES)
        for name in ("背包", "襯衫", "皮鞋", "涼被"):
            if name not in cat:
                continue
            with self.subTest(name=name):
                item = inventory_item(name, 1, "estimated", "照片看得到品類，但材質或款式仍要確認")
                draft = estimate.from_photo([item], None, conv.PRICES)
                price = cat[name]["price"]
                self.assertEqual(draft["confirmed_total"], price)
                self.assertEqual((draft["estimated_minimum"], draft["estimated_maximum"]), (price, price))
                self.assertNotIn("先抓", estimate.render(draft))

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
        self.send(kind="postback", data="action=pickup_when", params={"datetime": "2026-09-09T18:30"})  # 週三晚上
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
