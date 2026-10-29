**五項通知機制已修補，新增 26 條測試全數通過；A3-2 整卡仍有「既有回歸全綠」門檻未達成。** 原始 HEAD 也有相同兩項失敗，已在 RESULT 留下對照證據，未越過四檔範圍補其他檔案。

本次加入按事件與收件人保存的 append-only outbox、五次遞增間隔重送、原子狀態保存、毀損狀態停止推播、兩項首啟基線成功後才啟用、`(Dno, Did)` 完工去重，以及 MDB 查詢失敗後重查相同 mtime。通知文字與金額均保留。

交付四檔：

- [inbound_monitor.py](C:/Users/cyc39/AI-Lanes/a32/repo/shop-pc/fxwash/runtime/inbound_monitor.py:98)：五項機制修補及舊狀態遷移。
- [test_inbound_monitor.py](C:/Users/cyc39/AI-Lanes/a32/repo/shop-pc/fxwash/runtime/test_inbound_monitor.py:143)：26 條標準庫離線測試。
- [DEPLOY-A3-2.md](C:/Users/cyc39/AI-Lanes/a32/repo/shop-pc/DEPLOY-A3-2.md:1)：交付、備份、精確停起 monitor、驗證與回退程序。
- [A3-2-RESULT.md](C:/Users/cyc39/AI-Lanes/a32/repo/docs-internal/cards/A3-2-RESULT.md:1)：差異、SHA-256、紅綠及變異原始輸出、既有失敗與限制。

| 驗證 | 結果 |
|---|---|
| 修補前相同 26 條測試 | 22 failures、0 errors，五項缺口均有紅燈 |
| 修補後／`-I -S` 標準庫隔離模式 | 各 26/26 通過 |
| 移除 outbox 重送、移除 `os.replace` | 各有指定測試變紅，兩項變異均被抓到 |
| 既有回歸／原始 HEAD 對照 | 各 27/29 通過，相同兩項失敗 |
| Python 3.11 語法、`git diff --check`、變更範圍 | 通過；Git 變更恰為卡列四檔 |

既有兩項失敗是：

1. `test_install_creates_clean_instance_and_refuses_overwrite`：快照缺少預期的 `fxwash/Install.ps1`。
2. `test_pack_product_kit_zip_excludes_real_secrets`：打包缺少 `secrets/line-channel.json.example`。

全程使用指定 Python，**未 stage、commit、連店機或呼叫 API**。尚未實跑店機 Python 3.11 embedded、部署／回退或驗證客戶手機收訊。

另有測試初期 ACL 錯誤留下的空暫存目錄：repo 內 26 個、系統 Temp 內 26 個；在寫入測試資料前即失敗，清除亦遭權限拒絕，已明列於 RESULT。

九格缺：第 9 格的 Vault 回寫受本次四檔範圍與沙箱限制，開工卡、驗證及交接均已保存在 RESULT；Claude 總指揮的獨立驗收尚未執行。