已依任務卡完成**日夜切換候選版，46／46 個離線測試通過，未做 git commit**。變更都在指定的 `line-bot/` 與 `docs-internal/cards/A4-3-RESULT.md`。

- **白天店機優先**：10:00–20:00 只更新 `public_base.txt`，不向 LINE 登記；夜間重試若跨過 10:00，也會停止並清除 pending。
- **修正網址誤抓**：只接受 cloudflared 成功公告的 URL 列，拒絕 `api.trycloudflare.com`、錯誤訊息中的網址及不合法的網域後綴／路徑。
- **夜間交接與驗證**：新增 `night_handover.py`；已登記 AI 端點就略過，不同才 PUT，並 GET 讀回比對，失敗依 2／5／10 秒重試。支援完全離線的 `--dry-run` 與只讀的 `--status`，並加入 JSONL 事件紀錄。
- **排程腳本已備妥**：依設定計算接手時間，預設每日 20:05；只完成腳本與語法解析，沒有執行或註冊。

驗證包含**新增 35 項及既有 11 項測試**、Python 語法、PowerShell 語法解析、離線 CLI smoke，以及 `git diff --check`。完整紅綠原始輸出、既有測試調整理由、排程用法與部署步驟都已寫入：

[A4-3-RESULT.md](C:/Users/cyc39/AI-Lanes/a43/repo/docs-internal/cards/A4-3-RESULT.md)

本次未操作現役目錄、重啟現役程序、呼叫真 LINE API 或部署；現役切換與實際收件仍待總指揮驗收。另有首次基線測試建立的空臨時目錄因 sandbox ACL 無法刪除，位置與原因已記在 RESULT，未繞過權限限制。

