A5 r2 已完成，**完整 Pester 51／51 通過**。只修改 `ops/` 與指定兩份文件；未做 git commit，未對現役路徑執行正式備份。

- [backup-sxj-live.ps1](/C:/Users/cyc39/AI-Lanes/a5/repo/ops/backup-sxj-live.ps1:16)：預設在開檔前排除 `*.lock`、`*.pid`、`*.tmp`；DryRun 與正式模式均印出 `A5_BACKUP skipped=N`，並回傳 `SkippedCount`。
- [Recovery.Common.ps1](/C:/Users/cyc39/AI-Lanes/a5/repo/ops/Recovery.Common.ps1:82)：一般來源讀取遇到 `IOException`／`UnauthorizedAccessException` 時繼續，正式備份將 `Path`、`Reason` 寫入 MANIFEST 的 `Skipped`；DryRun 提供記憶體中的預覽清單，維持零檔案寫入。`secrets/` 與 `.env` 讀不到仍失敗 exit `1`。另涵蓋清單建立後才被鎖住的情況，略過檔案不會留下半成品 payload。
- [Recovery.Tests.ps1](/C:/Users/cyc39/AI-Lanes/a5/repo/ops/tests/Recovery.Tests.ps1:454)：加入 FileStream／FileShare.None 真實獨占鎖測試，並保留目的地寫入失敗、來源內容異動仍須中止的驗證。

| 驗證 | 結果 |
|---|---|
| 修正前，r2 初始 21 項 | **5 通過／16 失敗**，exit `1` |
| 修正後，同組 21 項 | **21／21 通過**，exit `0` |
| 完整維運回歸，含追加串流測試 | **51／51 通過**，exit `0` |
| PowerShell 解析 | 7 份腳本，**0 錯誤** |
| Python 獨立讀回 | **9 份 MANIFEST、101 個 payload、7 筆 skipped** 核對通過；SHA／大小一致，未列出的 payload 為 **0** |

原始證據：[紅燈輸出](/C:/Users/cyc39/AI-Lanes/a5/repo/ops/evidence/r2-red.txt)、[綠燈輸出](/C:/Users/cyc39/AI-Lanes/a5/repo/ops/evidence/r2-green.txt)、[完整 51 項輸出](/C:/Users/cyc39/AI-Lanes/a5/repo/ops/evidence/r2-full-pester.txt)、[Python 讀回](/C:/Users/cyc39/AI-Lanes/a5/repo/ops/evidence/r2-independent-readback.json)。

[RUNBOOK r2](/C:/Users/cyc39/AI-Lanes/a5/repo/docs-internal/RUNBOOK-RECOVERY.md:20) 與 [A5-RESULT r2](/C:/Users/cyc39/AI-Lanes/a5/repo/docs-internal/cards/A5-RESULT.md:9) 已更新。文件明示：**`Verified=True` 仍可能帶有 skipped，還原前須檢查清單**；MDB 被略過時，該包無法還原 MDB。

鎖定案例使用真實 FileStream；UnauthorizedAccess 採讀取邊界注入驗證，因沙箱禁止修改 DACL。本輪為隔離合成驗證，現役備份與正式 RTO 未在本輪量測。