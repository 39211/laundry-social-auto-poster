# -*- coding: utf-8 -*-
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
shop_root = Path(r"C:\LaundryStores\fxwash")
sys.path.insert(0, str(shop_root))

from runtime.chat_service import generate_chat_reply
from config import dialog_corpus

queries = [
    "我羽絨衣自己丟洗衣機洗完，整件裡面的毛結成一球一坨的，還有救嗎？",
    "衣服沾到立可白跟口香糖怎麼辦？",
    "我家貓咪尿在厚棉被上，味道超重可以洗掉嗎？",
    "這件衣服洗標寫不能水洗也不能乾洗，你們能洗嗎？",
    "你們是稱重還是算件的？洗好可以先放你們那邊一個月嗎？",
    "我的衣服好了沒？",
    "你們回答好官方喔，根本是機器人吧",
]

print("=" * 60)
print(f"Total phrases in Dialog Corpus: {dialog_corpus.get_total_phrase_count()} across {len(dialog_corpus.CORPUS)} categories")
print("=" * 60)

for q in queries:
    print(f"\n[顧客詢問] {q}")
    matched_intent = dialog_corpus.match_intent(q)
    corpus_reply = dialog_corpus.get_human_reply(q)
    ai_reply = generate_chat_reply(q, shop_root)
    print(f"[意圖分類] {matched_intent}")
    print(f"[Corpus 詞庫備援回覆] {corpus_reply}")
    print(f"[AI 線上專員引導式回覆] {ai_reply}")
    print("-" * 60)
