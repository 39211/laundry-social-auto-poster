# A8 結果：ai 電腦 line-bot 部署 runner

日期：2026-10-30。執行位置：`C:\Users\cyc39\AI-Lanes\integ\repo`。

**交付範圍為腳本與隔離測試；本次未執行現役部署。** 現役僅讀取使用者允許的 `line-bot/README-OPS.md` 與 `run_line_bot.ps1`，沒有呼叫現役 Stop／Start／Probe、LINE API 或排程工具，沒有 git commit。

## 開工卡與產物

| 欄位 | 本次範圍 |
| --- | --- |
| Outcome | 交付 A4-3 + A2-b 的可備份、驗證及回退 runner；隔離 Pester 驗收 |
| Owner | 店主；現場執行與部署判斷由 Claude 總指揮負責 |
| Maker | 本次 Codex 對話，單一 writer |
| Checker | Codex 自查、PowerShell parser、Pester 3.4.0；未另派獨立審查席 |
| Authority | 只新增本卡指定三檔；不部署、不改現役、不操作現役程序或排程、不 commit |
| 驗收證據 | 本文記錄的紅綠測試輸出、真實 Git 唯讀查詢及最終工作樹檢查 |

僅新增：

- `ops/deploy-ai-linebot.ps1`
- `ops/tests/DeployAiLinebot.Tests.ps1`
- `docs-internal/cards/A8-RESULT.md`

兩支 `.ps1` 採 ASCII 內容，可直接由 Windows PowerShell 5.1 讀取；沒有中文編碼依賴。

## 來源與清單

本次讀到的來源 HEAD：`ca9fea2efd526dd23163b3a79dc94e37b0c7ffd7`。透過 runner 的真實 `Invoke-AiGit` 邊界，唯讀確認以下指令取得 **32 個檔案**：

```powershell
git diff --name-only release/sxj-live-2026-10..integration/20261030 -- line-bot/
```

runner 每次執行都重新讀取此差異，不手抄名單，也不自行排除 README、既有 evidence 或 `test_mdb_pull.ps1`。若清單為空、來源檔不存在、路徑離開 `line-bot/` 或有重複路徑，預檢失敗。來源 HEAD 必須等於 `integration/20261030`；目標的 tracked 改動、untracked 程式／設定檔或即將被覆寫的 untracked 檔案會擋下並列出。

## 使用方式

以下均是供總指揮日後操作的書面範例，**本次未對現役執行**。

先預檢及列出計畫：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\ops\deploy-ai-linebot.ps1 `
  -Source 'C:\Users\cyc39\AI-Lanes\integ\repo' `
  -Target 'C:\Users\cyc39\Documents\New project 5' -DryRun
```

核准後部署，預設不註冊排程：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\ops\deploy-ai-linebot.ps1 `
  -Source 'C:\Users\cyc39\AI-Lanes\integ\repo' `
  -Target 'C:\Users\cyc39\Documents\New project 5'
```

只有總指揮確認要同時註冊排程時，才在部署命令加 `-RegisterTasks`。日夜交接註冊器會明確收到現役 Python 路徑，MDB 註冊器使用目標樹內的 pull script。

手動回退，將 `實際備份資料夾` 換成 log 印出的完整路徑；不必提供 Source：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\ops\deploy-ai-linebot.ps1 `
  -Target 'C:\Users\cyc39\Documents\New project 5' `
  -Rollback 'D:\AI-Lanes-work\_backups\ai-linebot\實際備份資料夾'
```

`-Rollback` 不接受 `-DryRun` 或 `-RegisterTasks` 混用。回退會先檢查 manifest 的 Target、路徑、重複項及所有備份 SHA，再停止程序。手動回退若遇到部署後另行編輯的檔案會停止，保留該編輯；不會把它當成本次新增檔直接刪掉。

## runner 行為

1. 非 DryRun 在 `D:\AI-Lanes-work\_backups\ai-linebot\deploy-<timestamp>.log` 留下預檢、失敗與各階段結果。D 槽兩個指定目錄必須存在；C 槽不足 1 GB 時擋下寫入。D 槽或 log 無法使用時會失敗並在主控台說明。
2. 備份目標將被覆寫的原檔到 `<timestamp>\payload\line-bot\...`，逐檔 SHA 回讀；`MANIFEST.json` 保存來源 HEAD、目標、來源 SHA、原檔 SHA，以及原先不存在的檔案狀態。備份完整驗證後才停服務。
3. 呼叫目標 `run_line_bot.ps1 -Stop`，再列舉 CommandLine 屬於目標 line-bot 的 python／cloudflared。現役兩個已知別名都納入；排除 `$PID`，逐一重新核對 PID 的 CommandLine 與 CreationDate 後才 `Stop-Process -Id`。等待 3 秒，8791／8792 必須沒有 listener，且沒有殘留目標程序。
4. 按動態 Git 清單複製；每個來源檔與目標原檔先比對預檢 SHA，複製後再次比對來源 SHA。拒絕巢狀 junction／symlink、路徑穿越及非檔案目的地。
5. 在目標 `line-bot/` 使用 README-OPS 指定的 Python，依序執行：

   ```text
   -B -X utf8 -m unittest test_tunnel_manager test_day_night_handover
   -B -X utf8 run_a2b_tests.py test_mdb_freshness
   -B -X utf8 run_a2b_tests.py test_arrival_notify
   ```

6. 測試紅燈或後續驗收失敗會自動以本次備份回退；復原原檔 SHA，移除本次新增、原先不存在的精確檔案，保留其他檔案。然後 Start、等待 10 秒、Probe；原部署仍 exit 1。回退失敗會另外記錄 `ROLLBACK FAILED` 與備份路徑。
7. 正常啟動也採 Start → 等待 10 秒 → Probe，要求 Probe exit 0，再獨立 GET healthz。A8 的要求較現役 launcher 嚴格：healthz 的 `ok <pid>` 必須直接等於新的 `line_webhook.pid`，不接受僅為子程序的 PID。
8. 記錄啟動前事件檔 byte offset，只看本次啟動後新增、時間有效的事件。白天要求 `skipped_day`、沒有 PUT 嘗試，且 LINE GET endpoint 的 HTTPS Host 是 `lhr.life` 或其子網域；夜間要求新的 PUT 200／verify match 事件，GET endpoint 必須精確等於 AI endpoint。兩者都要求 active。驗證程式只 GET，憑證不印出。
9. 所有服務／測試／註冊 helper 在無視窗子程序中執行、讀取 exit code。每個 helper 最長 90 秒，整次部署使用 210 秒預算，出錯時另給回退 120 秒。逾時只終止本次建立的精確 helper；不按映像檔名終止程序。
10. `-DryRun` 只執行預檢、列出複製與備份清單，以及會停的 PID／程序名稱；**不建立目錄、備份、manifest 或 log，不執行 Python／HTTP／服務／排程動作**。Git 使用 `--no-optional-locks`，避免 status 更新目標 index。

## Pester 證據

環境：Windows PowerShell 5.1，機上 Pester 3.4.0。Target、Source、備份及 runtime 都位於 Pester TestDrive。假 `run_line_bot.ps1` 實際記錄 Stop／Start／Probe 參數並模擬 Probe exit 0／1；程序清單、Stop-Process、listener、HTTP 及 Python 是假邊界。任務註冊案例只執行 TestDrive 裡的假腳本。

測試命令（僅此 PowerShell 程序套用 Bypass，不改全域執行政策）：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
$r = Invoke-Pester -Script 'ops/tests/DeployAiLinebot.Tests.ps1' -PassThru -Quiet 6>$null
$r | Select-Object TotalCount, PassedCount, FailedCount, SkippedCount
if ($r.FailedCount -gt 0 -or $r.TotalCount -eq 0) { exit 1 }
```

紅綠紀錄：

```text
初版 RED（尚未新增 runner；測試專用 missing-feature stand-in 回 99）
Total: 24  Passed: 0   Failed: 24
失敗原因：預期 runner 回 0 或 1，實際為功能缺少的 99。

初版 GREEN
Total: 24  Passed: 24  Failed: 0

補強 RED（失敗預檢應留 log；手動回退應保護後續編輯）
Total: 26  Passed: 24  Failed: 2
retains a failed preflight in the deployment log without backing up or stopping
preserves later local edits instead of deleting them during explicit Rollback

最終 GREEN（含 TestDrive 外 native 執行的封鎖）
Total: 26  Passed: 26  Failed: 0  Skipped: 0
TimeSeconds: 37.01
Failures: []
```

初次載入測試曾被本機預設執行政策阻擋；改用程序級 Bypass 後才計入上述 RED，沒有變更使用者／機器層級政策。0-test 篩選執行不列為通過證據。

涵蓋 dirty／untracked 擋下、來源不存在、Source=Target、動態清單與 manifest SHA、DryRun 全樹零寫入、離線測試失敗回退、三項 Python 呼叫、精確 PID 範圍、listener 殘留、Probe 非零、healthz PID 不符、白天 endpoint 與 PUT 證據、夜間成功與 mismatch、預設不註冊／明確才註冊、手動回退、備份損壞、manifest 路徑穿越、錯誤 Target、後續編輯保護與參數衝突。

## 仍由總指揮現場判斷

- 決定部署時段、確認來源 HEAD、現役 dirty 狀態、D 槽備份與現役 Python 可用。本次未即時查現役程序；卡上列出的 PID 是卡片提供的背景，runner 會重新列舉，沒有硬編碼那些 PID。
- 選擇剛跑完 watchdog 的維護窗口並監看完成時間。腳本不停用排程；210 秒預算不代表能證明避開所有每 5 分鐘觸發或保證含回退在內都小於 5 分鐘。watchdog 可能重新起程序時，須由總指揮處理現場競態。
- 確認預期的店機 URL 與日夜窗口。事件缺失、事件檔截斷、跨日夜邊界或 LINE GET 不符會失敗／回退；本機假環境通過不能證明現役 LINE 收發與店機／手機流程已驗收。
- A8 要求 healthz PID 直接相等；若現役 venv launcher 正常使用子程序 PID，runner 仍會擋下。不可把現役 Probe 的放寬規則當成 A8 已通過。
- 決定是否加 `-RegisterTasks`。註冊器內部的時區、權限、既有任務衝突仍由其原有檢查處理。若部分排程已註冊後另一項失敗，檔案會嘗試回退，但排程不會自動刪除或還原；log 會明示需檢查部分註冊，避免宣稱整體已復原。
- 自動回退若因殘留 listener、權限、備份 SHA 或舊版健康檢查失敗，會保持 exit 1 並列出備份路徑，需要總指揮介入。

## 範圍驗證與留痕

最終回讀：兩支腳本 PowerShell AST parser 都是 0 errors；使用不存在的 Source／Target 跑真正 CLI 的 `-DryRun`，確認 exit 1。真實 Git helper 唯讀取得上述 HEAD 與 32 檔清單。三檔逐行檢查沒有尾端空白。

`git diff --name-only` 與 `git diff --cached --name-only` 都是空，`git status --short --untracked-files=all` 僅列出三檔：

```text
?? docs-internal/cards/A8-RESULT.md
?? ops/deploy-ai-linebot.ps1
?? ops/tests/DeployAiLinebot.Tests.ps1
```

未修改任何既有 tracked 檔案，未 stage／commit／push。依使用者本次「只新增三檔」的更窄範圍，沒有另寫 Vault 筆記、task_summary、圖譜或額外證據檔；本檔同時保存本次任務摘要與續作限制。現役部署、現役 Python 測試、真實 LINE GET／收發及真實排程註冊都未在本次執行或驗收。
