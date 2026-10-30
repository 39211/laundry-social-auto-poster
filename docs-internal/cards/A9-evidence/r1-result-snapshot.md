# A9 補發排程器交付結果

本機候選完成：兩支腳本、七筆初始隊列、43-case smoke、日期檢查變異與真資料 DryRun 已完成。所有發布測試使用假 npm；排程測試把所有 ScheduledTasks 命令替換為記憶體／檔案 mock，沒有真正註冊工作。

未 commit、stage、push、部署、發真貼文或操作 LINE／Meta，未讀取 secrets。未修改 `src/*.ts` 或 line-bot。初始七筆隊列仍全部為 `pending`。

## 工作卡與完成範圍

| 欄位 | 結果 |
|---|---|
| Outcome | 可由總指揮驗收的 A9 補發候選；每日只領取第一筆 pending，保護日期語意與已發布紀錄。 |
| Owner / authority | 店主與 Claude 總指揮；本輪僅本機實作與 fake／DryRun 驗證，未執行真實註冊或發布。 |
| Maker | 本 Codex 工作階段，A9 檔案唯一 writer。 |
| Checker | 原生 Windows PowerShell 5.1 測試、負向變異，以及另一個唯讀 GPT reviewer；同屬 GPT 家族，未宣稱跨家族確認。 |
| 工作目錄 | `C:\Users\cyc39\AI-Lanes\a9\repo` |
| 驗收證據 | 本目錄 `A9-evidence/`，各證據位置列於下表。 |

| 檔案 | 實作內容 |
|---|---|
| `scripts/backfill-publish.ps1` | PS 5.1、ASCII-only、`ErrorActionPreference=Stop`。每次只處理第一筆 pending；雙平台 live success 直接 done；遞迴掃描 caption／first comment 文字；日期字命中 skipped 並記錄命中字。 |
| 同上：發布與回讀 | 在 repo 根呼叫指定的 `NpmCommand`，只設定本程序的 `ALLOW_OFF_SCHEDULE_PUBLISH=true` 並於 finally 還原。非同步收集 stdout／stderr、記錄 exit code；輸出先遮罩再寫入 `output/backfill-logs/<執行當日>.log`。必須讀回雙平台 success 才能 done，失敗、uncertain 或缺紀錄均 failed，不自動重試。 |
| 同上：鎖與停止 | 若存在 A7 `_pipeline-lock.ps1`，使用 `Enter-PipelineMutex -Name sxj-publish -TimeoutSec 0` 與 finally release；忙碌時由 A7 記錄同一份 A9 日誌並 exit 75。隊列更新另以短暫 sidecar handle 鎖同步，Stop 在鎖內重讀；claim 僅能把 pending 改為本次 failed reservation，完成時核對 attempted_at，避免推翻 owner stop。 |
| 同上：DryRun / Stop | DryRun 只輸出選項與日期檢查，不寫隊列、log 或 sidecar；Stop 把所有當下 pending 改為 skipped，note 精確為 `owner stop`，保留其他狀態。兩者可合用預覽停止。 |
| `scripts/register-backfill-task.ps1` | 具 `-WhatIf`；已存在即 throw，不使用 Force 或先刪除。名稱 `Laundry-Backfill-1600`，current user、Interactive、Limited、15 分鐘、IgnoreNew。每日本機時間 16:00；StartBoundary 2026-10-31，EndBoundary 2026-11-07 00:00，因此最後一個觸發日為 11/06。本機時區唯讀確認為 `Taipei Standard Time`。 |
| `data/backfill-queue.json` | 卡片要求的七筆順序；status 全為 pending、note 空字串、attempted_at/result 為 null。 |
| `.gitignore` | 僅增加 `!data/backfill-queue.json`，避免原有 `data/*` 把要交付的初始隊列隱藏。 |
| `test/ps-backfill-publish.smoke.ps1` | 隔離假 repo、注入 `.ps1`／`.cmd` 假 npm；43 個案例及 `-MutateDateGuard` 負向變異。測試只清理自身已檢查路徑與 reparse point 的 temporary tree。 |

## 驗證結果

| 驗證 | 實際結果 | 證據 |
|---|---|---|
| 原生 Windows PowerShell 5.1 smoke | `SMOKE_OK cases=43 failures=0`，exit 0。 | `A9-evidence/smoke.txt` |
| 日期檢查變異 | 只在 temporary copy 把日期檢查結果改為空；`SMOKE_FAIL cases=43 failures=14`，exit 1。12 個日期詞案例、巢狀 first comment、DryRun 日期跳過案例均紅；原腳本 SHA-256 前後相同。 | `A9-evidence/date-guard-mutation.txt` |
| PS 5.1 parser / ASCII | 三支 `.ps1` 均 parse errors=0、non-ASCII bytes=0；實際版本 `5.1.26100.9711`。 | `A9-evidence/script-checks.json`，含各腳本 SHA-256 |
| 真 repo 預設入口 DryRun | 未帶 RootPath，選到 2026-10-26 slot 2；日期檢查 pass，exit 0；隊列、log 路徑不變，無 sidecar。 | `A9-evidence/real-repo-dryrun.txt` |
| 七筆真文案 | 以原腳本分別 DryRun 七個只含單筆隊列的隔離快照；全數 pass，每個快照檔案 SHA／mtime／檔案清單不變。 | `A9-evidence/all-seven-dryruns.txt`、`real-data-checks.json` |
| 程式複審 | Stop 競態與預設 RootPath 的必修均關閉；最新腳本沒有未關閉必修。 | `A9-evidence/review.txt` |
| 工作樹檢查 | `git diff --check` 通過；沒有 src 或 line-bot 改動，沒有提交或暫存。 | 本輪 git readback；A9 新檔列於本報告。 |

Smoke 包含：每次一筆、下一筆推進、雙 success 不呼叫 npm、dry_run success 不視為 live、所有指定日期字、巢狀 first comment、DryRun 零寫入、非零 npm exit、零 exit 但缺紀錄／單平台／uncertain、既有 uncertain、stderr、posted-log 優先判定、空隊列、Stop 與 Stop 預覽、Stop 與 claim 的交錯、進行中的嘗試完成後保留 Stop、mutex exit 75 與失敗後 release、壞 JSON、token 遮罩，以及四個只用 mock 的註冊器案例。

測試先觀察主腳本不存在時的紅燈（`tdd-red.txt`），之後實測修正兩個 PS 5.1 差異：JSON array 須先賦值才展開；RootPath 預設值須進入 script body 後才由 PSScriptRoot 推導。直接執行預設入口的原始失敗輸出保存在 `default-root-red.txt`。隊列保存也移除本環境拒絕的 metadata replacement API，改用 exclusive handle 寫入與 flush；寫入失敗會阻止發布。

複跑命令（發布仍全部為 fake）：

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/ps-backfill-publish.smoke.ps1
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/ps-backfill-publish.smoke.ps1 -MutateDateGuard
```

第二個命令預期 exit 1；它不修改原腳本。

## 真 repo DryRun

本工作樹沒有這四天的日曆與 posted-log。為完成卡片指定的真資料 DryRun，只讀 `C:\Users\cyc39\laundry-repo` 的四份 content-calendar 與現存的 `2026-10-26` posted-log，將相同 bytes 複製到本工作樹原本缺少、被 gitignore 的相對路徑。10/27–10/29 的 posted-log 在來源與工作樹都不存在。沒有讀 approval、`.env` 或任何 secrets。

來源 SHA-256／size／mtime 的前後核對及七筆日期結果在 `A9-evidence/real-data-checks.json`。真來源全部不變；快照不列入 commit 候選。DryRun 使用不可執行的 NpmCommand 名稱，避免任何真 npm 呼叫。

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/backfill-publish.ps1 -DryRun -NpmCommand __A9_NO_REAL_NPM__
```

實際輸出：

```text
date=2026-10-26 slot=2 date_check=pass hits=
DryRun action=publish
EXIT_CODE=0
QUEUE_AND_LOG_PATHS_UNCHANGED=true
QUEUE_SIDECAR_EXISTS=false
DEFAULT_ROOT_ENTRY_POINT=true
```

`action=publish` 只表示這次預覽在日期閘門後會走發布分支，本輪沒有發布。

## 七筆文案日期字結果

每筆均掃描 `facebook_caption` 與 `instagram_caption`；這七筆快照沒有 first comment 欄位，巢狀 first comment 的掃描能力另由 smoke 驗證。腳本也保守攔截其他月份的月／日、ISO 日期與「周」的寫法。

| 隊列順序 | 原日期 | Slot | 日期字檢查 | 命中字 | 是否因日期字 skipped |
|---|---|---|---|---|---|
| 1 | 2026-10-26 | 2 | pass | 無 | 否 |
| 2 | 2026-10-27 | 1 | pass | 無 | 否 |
| 3 | 2026-10-27 | 2 | pass | 無 | 否 |
| 4 | 2026-10-28 | 1 | pass | 無 | 否 |
| 5 | 2026-10-28 | 2 | pass | 無 | 否 |
| 6 | 2026-10-29 | 1 | pass | 無 | 否 |
| 7 | 2026-10-29 | 2 | pass | 無 | 否 |

## 剩餘風險與交接

- 未部署、未真實註冊，也未實測 Meta API、公開貼文、媒體網址或審核閘門；不得把本機通過當作七篇已補發。總指揮須在正式樹驗收與部署後才註冊。
- Interactive 需要該使用者登入；沒有設定 StartWhenAvailable、WakeToRun 或自動重試。睡眠、未登入或 16:00 mutex 忙碌可能留下 pending；七天 EndBoundary 後不會繼續觸發，剩餘項目交總指揮決定。
- `-Stop` 中止尚未 claim 的 pending；已 claim 的單筆可能正在執行，無法由 Stop 撤銷。Stop 返回前已把該筆改為 skipped 時，條件更新會阻止它再被領取。進行中的嘗試結束後不會覆蓋其他筆的 owner stop。
- 呼叫 npm 前先持久記為 failed reservation。15 分鐘到期、程序中斷、uncertain 或部分成功後，該筆不會自動重試；總指揮應以真實平台與 posted-log 對帳，不能直接把 failed 改回 pending。
- 隊列更新有短暫 sidecar 鎖與 exclusive write／flush；`.lock` 留在磁碟上屬正常，鎖的所有權取決於 OS handle。若儲存故障導致 JSON 不完整，後續執行會拒絕發布並須人工修復，不宣稱具斷電原子性。
- 本工作階段可寫範圍只有此工作樹，無法寫入外部 Vault 的 task_summary。可回寫摘要如下；由總指揮完成 Vault 留痕與正式環境驗收。本輪未對 Vault 追加工作紀錄。

```text
VAULT_WRITEBACK|project=sixiangjia|summary=A9 local backfill scheduler candidate complete; PowerShell 5.1 ASCII scripts, seven pending entries; smoke 43/43; date-guard mutant fails 14/43 as expected; seven real-caption DryRuns pass with zero writes. No commit, real npm publish, scheduler registration, LINE, Meta, or secrets access. Files and evidence: docs-internal/cards/A9-RESULT.md and A9-evidence/. Commander owns deployment, registration, live reconciliation, and Vault task_summary.
```
