# -*- coding: utf-8 -*-
"""自然客服問句回歸：每句都要回答或給出下一個可執行動作。"""
from __future__ import annotations

import traceback

import test_conversation as base

conv = base.conv


CASES = [
    ("送洗要預約嗎", "faq", ("不用預約",)),
    ("洗衣要先預約嗎", "faq", ("到府收送",)),
    ("一定要預約嗎", "faq", ("不用預約",)),
    ("可以到府嗎", "pickup", ("方便",)),
    ("你們有外送嗎", "pickup", ("方便",)),
    ("到府怎麼約", "pickup", ("方便",)),
    ("收送免費嗎", "pickup_info", ("不先亂報",)),
    ("到府收送要錢嗎", "pickup_info", ("地址",)),
    ("哪一區可以收", "pickup_info", ("時段",)),
    ("今天有開嗎", "hours_day", ("現在有開",)),
    ("幾點關門", "hours_day", ("20:00",)),
    ("禮拜天開嗎", "hours_day", ("公休",)),
    ("哪一天公休", "hours_day", ("公休",)),
    ("你們店在哪", "location", ("地址",)),
    ("怎麼走", "location", ("導航",)),
    ("有沒有停車", "location", ("停車",)),
    ("電話幾號", "phone", ("04-2452-7411",)),
    ("怎麼聯絡", "phone", ("04-2452-7411",)),
    ("照片可以估價嗎", "photo_quote", ("拍",)),
    ("拍照估價可以嗎", "photo_quote", ("拍",)),
    ("傳照片可以嗎", "photo_quote", ("整件",)),
    ("照片報價怎麼算", "photo_quote", ("拍",)),
    ("通常幾天可以拿", "faq", ("5–7 天",)),
    ("幾天拿得到", "faq", ("5–7 天",)),
    ("何時可以取", "faq", ("5–7 天",)),
    ("會縮水嗎", "photo_quote", ("洗標",)),
    ("會變形嗎", "photo_quote", ("材質",)),
    ("污漬洗得掉嗎", "photo_quote", ("近拍",)),
    ("油漬洗得掉嗎", "photo_quote", ("近拍",)),
    ("咖啡漬可以嗎", "photo_quote", ("近拍",)),
    ("洗不乾淨怎麼辦", "complaint", ("店裡處理",)),
    ("衣服洗壞了", "complaint", ("店裡處理",)),
    ("少一件怎麼辦", "complaint", ("洗衣單號",)),
    ("拿錯衣服了", "complaint", ("急的話",)),
    ("付款方式有哪些", "pay", ("LINE Pay",)),
    ("怎麼付款", "pay", ("確認金額",)),
    ("可以刷卡嗎", "pay", ("現金",)),
    ("可以現金嗎", "pay", ("預估價先不用付",)),
    ("要發票嗎", "pay", ("店員",)),
    ("有集點嗎", "shop_question", ("不在 LINE",)),
    ("有會員優惠嗎", "shop_question", ("店裡確認",)),
    ("你們賣洗衣精嗎", "shop_question", ("亂說有",)),
    ("有烘衣服務嗎", "shop_question", ("轉給店裡",)),
    ("我要查我的單", "query", ("手機",)),
    ("查我的衣服好了嗎", "query", ("手機",)),
    ("洗衣進度可以查嗎", "query", ("手機",)),
    ("送洗進度", "query", ("手機",)),
    ("我的衣服好了嗎", "query", ("手機",)),
    ("不確定能不能洗", "photo_quote", ("洗標",)),
    ("洗標看不懂怎麼辦", "photo_quote", ("拍整件",)),
    ("送洗前要注意什麼", "pre_wash", ("現場報價",)),
    ("名牌衣服敢洗嗎", "concern", ("看過再收",)),
]


def main() -> int:
    base.setup_tmp()
    base.freeze_now("2026-09-05T13:00")
    failures = []
    for i, (text, expected_intent, needles) in enumerate(CASES, 1):
        uid = f"Unatural{i:03d}"
        try:
            msgs, meta = conv.handle_ex(uid, text)
            base.check_struct(msgs, text)
            blob = base.flatten(msgs)
            if meta.get("intent") != expected_intent:
                raise AssertionError(f"intent={meta.get('intent')!r}, want={expected_intent!r}; {blob}")
            for needle in needles:
                if needle not in blob:
                    raise AssertionError(f"missing {needle!r}: {blob}")
            print(f"PASS {i:02d} {text} -> {expected_intent}")
        except Exception:
            failures.append(f"{i:02d} {text}\n{traceback.format_exc()}")
            print(f"FAIL {i:02d} {text}")
    if failures:
        print("FAILURES:")
        print("\n".join(failures))
        return 1
    print(f"RESULT PASS={len(CASES)} FAIL=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
