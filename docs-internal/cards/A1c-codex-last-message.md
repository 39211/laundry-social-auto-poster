A1-c 已完成，**只變更指定四檔；沒有 commit、執行上傳或修改現役。**

- [scripts/youtube-upload.ps1](/C:/Users/cyc39/AI-Lanes/integ/repo/scripts/youtube-upload.ps1:72)：抽出 `Test-LiveReelPostedEntry`、`Test-LiveReelHasSlot`，slot loop 改用 helper；保留 assign-then-wrap、Instagram、success／posted、reel 與 dry-run 判斷語意。
- [PS smoke](/C:/Users/cyc39/AI-Lanes/integ/repo/test/ps-youtube-live-reel.smoke.ps1:146)：先從現役來源原樣複製，再新增一個等價測例，以改前 inline predicate 對照新 helper。
- [youtubeUpload.test.ts](/C:/Users/cyc39/AI-Lanes/integ/repo/test/youtubeUpload.test.ts:27)：原樣複製，內容未改。
- [A1c-RESULT.md](/C:/Users/cyc39/AI-Lanes/integ/repo/docs-internal/cards/A1c-RESULT.md:1)：已記錄實作、紅綠燈、等價驗證與完整性證據。

實測結果：

| 檢查 | 結果 |
| --- | --- |
| 改前 smoke | **紅燈**，原生退出碼 **2**：`Test-LiveReelPostedEntry not found` |
| 改後 smoke | **綠燈**，原生退出碼 **0**；原有 **14/14** 測例通過 |
| 新增等價測例 | **6 組合成 posted-log 樣本、100 次比較、0 差異** |
| PS AST／差異檢查 | 兩份 PS 語法錯誤 **0**；`git diff --check` 通過 |

**本 worktree 未安裝 Vitest，依指示只跑 PS smoke**，未安裝依賴，也不宣稱 TS 測試已實跑通過。

交卷時確認 Git status 恰為指定四檔、staged diff 為空、HEAD 未變；現役三份讀取來源的 SHA-256、大小與修改時間均未變。九格缺項只有第 9 格的 Vault 回存：依本次四檔寫入限制，留痕集中在結果卡。

