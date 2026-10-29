# 任務卡 A2:POS 資料同步與新鮮度(bot 端先做)

總指揮:Claude(Cowork) 日期:2026-10-29 執行者:Codex(gpt-6.1-sol) 前置:A1 完成(在 `release/sxj-live-2026-10` 上開 `feat/a2-data-freshness`)
repo:C:\Users\cyc39\Documents\New project 5

## 目的
LINE 查件/估價回覆現在讀 `C:/FXwash/eHank.mdb` 本機副本,副本停在 2026-10-17 20:00。客人會拿到舊狀態。第一段先讓 bot「知道並說出」資料多舊;第二段(另一張卡)才做店裡電腦 → 本機的自動同步。

## 這一段的範圍(bot 端,可改)
- `line-bot/laundry_lookup.py`:讀 mdb 時一併取 `eHank.mdb` 的 mtime,回傳 `data_as_of`(ISO 字串)與 `stale: bool`(超過 60 分鐘算 stale;閾值放常數,可被環境變數 `LAUNDRY_FRESH_MINUTES` 覆蓋)
- `line-bot/conversation.py` / `quote_flow.py` 裡產生查件與估價回覆的地方:回覆尾行加「資料時間 MM/DD HH:MM」;stale 時改為「資料可能不是最新(MM/DD HH:MM),已請店員確認」,並且把這筆寫進 `data/staff-inbox.jsonl` 當 `query` 類待辦(沿用既有格式)
- `line-bot/arrival_notify.py`:讀到 stale 快照時一律 `READ_FAIL_HOLD`,不發(即使之後開 live)
- 對應測試:`test_ehank_snapshot.py`、`test_conversation.py`、`test_arrival_notify.py` 加案例;先紅後綠,RESULT 附紅綠兩次原始輸出
禁止:改 mdb、改價目邏輯、改 LINE 設定、重啟現役 bot(改完只跑測試,重啟由總指揮排)

## 驗收
- `python -X utf8 -m pytest line-bot -q` 全綠;把 `data_as_of` 判斷拿掉時至少 3 條新測試變紅(附證據)
- 用一份 mtime 改成 2 小時前的 fixture mdb 跑 preview_chat,回覆含「資料可能不是最新」
- 用 mtime 為現在的 fixture,回覆含「資料時間」且不含「不是最新」

## 交付(docs-internal/cards/A2-RESULT.md)
- diff 摘要、測試紅綠原始輸出、新增環境變數說明、重啟現役 bot 需要的指令(給總指揮,不要自己跑)

## 停止條件
- 現有測試在你改之前就有紅的 → 先回報,不要順手修
- 需要改回覆格式以外的對話邏輯才能加尾行
