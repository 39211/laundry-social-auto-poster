# 任務卡 A3-2:店機入庫/完工通知的五個缺口修補(不改對客文案)

總指揮:Claude(Cowork) 日期:2026-10-30 執行者:Codex(gpt-6.1-sol) 單一 writer:本卡
工作目錄(worktree):C:\Users\cyc39\AI-Lanes\a32\repo 分支 `feat/a3-2-shop-notify-hardening`
只能改 `shop-pc/fxwash/runtime/inbound_monitor.py`、新測試檔 `shop-pc/fxwash/runtime/test_inbound_monitor.py`、`shop-pc/DEPLOY-A3-2.md`、`docs-internal/cards/A3-2-RESULT.md`。不連店機、不呼叫真 LINE、不改 lookup/webhook/文案/shop.json。

## 依據:docs-internal/cards/A3-RESULT.md(先讀完)
店主拍板:通知文案與金額**保留不動**;綁定漏洞另案。本卡只修「發錯/漏發/重發」的機制。店機 Python 3.11 embedded,只有標準庫。

## 要修的五件事(每件一條以上紅→綠測試)
1. **push 失敗要重試、不丟事件**:`push_message()` 回傳 False 或例外時,事件進 `data/notify_outbox.jsonl`(append-only:ts、kind、dno/did、uid、attempts、last_error_type),下一輪先重送 outbox(最多 5 次,間隔依 attempts 遞增 6s/30s/2m/10m/1h),成功才標 done;去重集合只在「送達或放棄」後才更新。
2. **狀態檔原子寫入**:`monitor_state.json` 先寫 `.tmp` 再 `os.replace`;讀到毀損 JSON 時**不要**當成 `{}` 重建基線,改為 `STATE_CORRUPT` 停止推播並寫 log,保留毀損檔為 `.corrupt-<ts>`。
3. **首啟基線查詢失敗不得變成 "000000"**:基線查詢失敗 → 本輪不推播、下一輪再試;直到兩個基線都成功才開始正常掃描。
4. **完工判斷與查件一致**:完工條件改成與 `connectors/base.py:310–318` 相同:`Dater` 空 且(`Datei` 非空 **或** `State == "完工"`);去重鍵改 `(Dno, Did)`。
5. **mdb 讀失敗時不要卡在 mtime**:查詢失敗那輪不更新 `last_mtime`,讓下一輪重查;連續失敗 10 輪寫一行 log(不洗版)。

## 測試
- `test_inbound_monitor.py`(unittest,標準庫):用假 `run_query`、假 `push_message`、臨時目錄的 state/outbox;至少 12 條,先紅後綠,RESULT 附兩次原始輸出。
- 既有 `shop-pc/fxwash/tests/*.py` 仍全綠(用 `python -m unittest discover -s shop-pc/fxwash/tests`)。
- 變異:把 outbox 重送拿掉、把 os.replace 改回直接寫,各至少 1 條變紅。

## 交付
diff 摘要、紅綠原始輸出、`shop-pc/DEPLOY-A3-2.md`(比照 DEPLOY-A4-2.md:四檔、備份、停起 inbound_monitor、驗證、回退)、沒做到的事。
