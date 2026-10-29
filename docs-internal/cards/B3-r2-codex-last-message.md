**B3 r2 已完成，僅修改指定三檔。** 使用真實 data 以 `--dry-run` 重產的 **2026-W43** YT 列為：

| 平台 | 上傳 | 預定公開 | 已確認公開 |
| --- | ---: | ---: | --- |
| YT | 1 | 4 | 未知（已確認 0；4 筆待確認） |

「已確認 0」是本機台帳的確認數；四筆公開結果仍未知，不能解讀成四支都沒有公開。

修改與證據：

- [weekly-report.py](/C:/Users/cyc39/AI-Lanes/integ/repo/scripts/weekly-report.py:164)：YT 僅取 `youtube-log`，分別按 `uploaded_at`、`scheduled_publish_at`、`video_status=published` 加有效 `published_at` 計算；缺公開時間保留未知。以獨立三欄小表呈現，FB／IG／TikTok 原列不變。
- [test_weekly_report.py](/C:/Users/cyc39/AI-Lanes/integ/repo/test/test_weekly_report.py:103)：新增三組 YT 案例，涵蓋分週、去重、台北週界及公開狀態／時間條件。**先紅：23 項、10 個失敗（含子案例）；修正後：23 項全通過。**
- [B3-RESULT.md 的 r2 段](/C:/Users/cyc39/AI-Lanes/integ/repo/docs-internal/cards/B3-RESULT.md:177)：已貼入上述 YT 列、重跑命令、測試結果及來源指紋。

真實樣本共 **55 行**。另段原始資料加總與 YT 各欄一致；FB／IG／TikTok 三列與修改前逐字一致；正式 data 的 **2,573 檔**集合、SHA-256、大小及修改時間指紋前後一致。`git diff --check` 通過。

全庫 `npm.cmd test` 因工作樹缺少 `vitest` 而受阻，未宣稱全庫通過。未 stage、commit、註冊排程或修改正式資料。九格留痕缺項 4／9：依本輪「只改三檔」限制，未另寫 Vault，證據集中於 B3-RESULT.md。