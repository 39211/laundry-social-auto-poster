# A9 補發排程器 r2 交付結果

2026-10-30。r2 程式修正已落盤；**原生驗收尚未通過，不可據此註冊正式排程**。行為測試 108 個通過、0 失敗，原生殺樹驗證 1 個 BLOCKED，整體 exit 2。本環境也拒絕原生 `File.Replace` 與 ScheduledTasks CIM。正式腳本保留 r2 指定的三參數原子替換，替換失敗即停止發布。

**依 r2 指定的欄位排除規則，七筆真資料全部會被日期閘門 skipped。** 命中來自圖片／影片路徑、影片提示詞與媒體來源日期，詳見下表。沒有自行擴大排除欄位或修改 calendar。

本輪沒有 commit、stage、push、真實 npm 發布、排程註冊／停用、LINE／Meta 操作或 secrets 讀取；沒有修改 `src/*.ts`、A7 library 或 line-bot。`-Stop` 的停用動作只在測試程序內以 mock 執行。原 r1 報告保存於 `A9-evidence/r1-result-snapshot.md`，不作本輪驗收依據。

## 工作卡與檔案

| 欄位 | 本輪範圍 |
|---|---|
| Outcome | 依 A9 卡片末尾 r2 1–14 修正本機候選，補足行為測試、兩種日期變異與零寫入真資料預覽；分開呈現原生驗收限制。 |
| Owner / authority | 店主與 Claude 總指揮；僅此工作樹的本機實作與假 npm／DryRun 驗證。 |
| Maker | 本 Codex 工作階段，A9 相關檔案單一 writer。 |
| Checker | PowerShell 5.1、隔離假 npm、變異測試與唯讀 GPT strict-reviewer；同一模型家族，不宣稱跨家族驗收。 |
| Workspace | `C:\Users\cyc39\AI-Lanes\a9\repo` |
| Evidence | `docs-internal/cards/A9-evidence/r2-*`；原 r1 證據保留為歷史。 |

| 檔案 | 最終用途 |
|---|---|
| `scripts/backfill-publish.ps1` | PS 5.1／ASCII；每日最多一次嘗試、廣掃文字日期、原子隊列、600 秒 timeout、mutex 驗證、Stop／DryRun。 |
| `scripts/register-backfill-task.ps1` | 僅供後續驗收通過後由總指揮註冊；加入電池設定與逾第一個時段警告。 |
| `data/backfill-seed.json` | 可追蹤七筆初始資料；全為 pending，順序 10/26 s2 → 10/27 s1/s2 → 10/28 s1/s2 → 10/29 s1/s2。 |
| `data/.gitignore` | 保留原有規則並加入 `!backfill-seed.json`；根 `.gitignore` 已恢復 HEAD 對應內容與 CRLF，無 diff。 |
| `output/backfill/queue.json` | 執行時隊列，被既有 `output/` 規則忽略。真 repo 本輪沒有建立此檔；DryRun 在記憶體使用 seed。舊 `data/backfill-queue.json` 已移除。 |
| `test/ps-backfill-publish.smoke.ps1` | 真 calendar 結構 fixture、假 npm、排程 mock、故障與兩種變異測試；所有 `.ps1` 僅 ASCII。 |
| `test/fixtures/backfill-calendar-2026-10-27.json` | 從真 calendar 複製全部 keys、巢狀結構、陣列長度及 scalar types；字串換成假文字，保留測試日期及時區。 |
| `A9-evidence/r2-verify-dryruns.py` | 重跑真 repo 與七筆隔離 DryRun，記錄 SHA／mtime／零寫入及命中欄位；不呼叫發布分支。 |

## r2 修了什麼、哪些審查項沒採納與原因

| r2 | 實作與證據重點 |
|---|---|
| 1 | 主流程與 mutex 後皆讀取整份隊列；當天已有 done／failed 的 attempted_at 即 exit 0。claim 的 sidecar critical section 再查一次，避免 A7 不存在時兩個呼叫跨過每日限制。 |
| 2 | `NpmTimeoutSec` 預設 600，測試可縮為 5。逾時對本次建立的 PID 呼叫 `taskkill /PID <pid> /T /F`，再 `WaitForExit(30000)`；stdout／stderr 各用 `Wait(30000)`，未關閉即記 sentinel。timeout 一律 exit_code=-1／failed，即使 posted-log 已雙成功也不標 done。taskkill 錯誤被捕捉，寫明 kill unconfirmed，保留 -1，交總指揮對帳。 |
| 3 | dot-source 包 try；確認 Enter 存在且有 Name／TimeoutSec、Exit 存在且有 Mutex，否則 exit 1。null 或任一 bool、Enter throw 都 exit 75，沒有 npm 呼叫。真 A7 契約與 SHA 見下一節。 |
| 4 | sidecar 鎖內寫 `.tmp` → 讀回 `ConvertFrom-Json` 驗證 → `[IO.File]::Replace($tmp, $queuePath, $queuePath + '.bak')`。沒有原地覆寫備援；原生替換權限失敗會留下可檢查的 tmp 並阻止發布。 |
| 5 | 新增禮拜一至日／天、週末／周末、上／下週／周、今晚／今早／明早／明晚／後天／前天、月日／號／号、全形斜線、十月、萬聖；保留原有今天／今日等與 ISO 日期。來源以 Unicode escapes 維持 ASCII。 |
| 6 | IDictionary 與 PSCustomObject 都排除 `^(slot|date|time|id|.*url.*|image.*|asset.*)$`，其他字串包含巢狀欄位、陣列、hashtag 一律掃描。發布文字沒有 runtime footer，詳見下一節。 |
| 7 | while 迴圈依序略過日期 skip／已雙成功；這兩種結果 attempted_at 留空，不消耗當天。mutex 後才發現雙成功也會 release 後繼續。 |
| 8 | `dry_run` 的 bool true 或字串 true 才當預演；字串 false 當 live 紀錄。 |
| 9 | 裸 token 遮罩加入 `\bIG[A-Z]{2}[A-Za-z0-9_-]{20,}`；假 IGQV／IGAA／EA／sk token 與原有敏感行遮罩均有案例。 |
| 10 | registrar 加 `-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`；超過 2026-10-31 16:00 警告。保留 current user／Interactive／Limited／15 分／IgnoreNew、七天邊界、WhatIf、既有同名拒絕與窗口結束拒絕。 |
| 11 | publisher 的 Console encoding 設定已用 try/catch 保護；registrar 原本沒有此設定，未新增。smoke 與假 npm 也使用 try/catch。 |
| 12 | 首次非 DryRun 從 seed 複製至 runtime queue；初始化也先驗證 tmp，再同目錄 Move。Stop 在鎖內改 pending 為 skipped／owner stop，並嘗試停用 `Laundry-Backfill-1600`；停用失敗只記 log。壞隊列時仍進入 Stop 的 finally 嘗試停用。 |
| 13 | 已補同日第二次、逾時、mutex false／true／null／throw／缺參數／載入錯誤、壞 JSON、字串 dry_run、真 schema、hashtag、裸 IG 遮罩、guard 與 regex 變異。**原生全綠條件仍未達成**：本環境 File.Replace 與 taskkill 被拒絕；測試替身與原生限制分開記錄。 |
| 14 | 本節逐項記錄 r2、實際驗證與未完成限制；未 commit。 |

**r2 1–14 沒有刻意不採納的程式項目；第 13 項原生驗收受限，不能標為完成。** `-UseAtomicReplaceShim` 只替換 temporary copy 的原子 API 呼叫以驗證其他行為，正式腳本沒有替身或非原子 fallback。原生 smoke 預設會在 File.Replace preflight 失敗時 exit 2，不能用替身的通過結果代替註冊門檻。

r1 額外建議的 OCR／圖片人工核對、Sentinel 規則調整與外部告警未納入本輪：r2 沒有要求新增這些操作，本次也未取得正式環境修改／外部發訊授權。圖片、登入／睡眠錯過時段、Sentinel 舊日期資料解讀與部分平台成功後的對帳，保留給總指揮在 go-live 前驗收。

## 真 A7 契約與 runtime 發布文字核對

已讀本工作樹及 `C:\Users\cyc39\laundry-repo\scripts\_pipeline-lock.ps1`，兩份 SHA-256 相同：`D1403CD6E9DFC00545B78A62406464006186B29CD0866BFC28B69D48B9CBDF9B`。

```powershell
# scripts/_pipeline-lock.ps1:57
function Enter-PipelineMutex {
    [CmdletBinding()]
    param(
        [string]$Name = 'sxj-publish',
        [ValidateRange(0, 2147483)][int]$TimeoutSec = 600
    )
    # Success returns System.Threading.Mutex; busy/unavailable exits 75.
}
# scripts/_pipeline-lock.ps1:87
function Exit-PipelineMutex {
    [CmdletBinding()]
    param([AllowNull()][Threading.Mutex]$Mutex)
}
```

真 A7 沒有覆寫 A9 的 Write-Log／Read-Queue 等名稱；其 Write-PipelineLog 會沿用呼叫端 Write-Log。這是讀取實際程式的核對，未取得正式發布的共用 mutex，也未呼叫 stale git-lock 清理函式。

`src/postCurrentSlot.ts:469`／`:481` 直接把 `slot.facebook_caption`／`slot.instagram_caption` 放入 PostInput。下游 `src/postFacebook.ts:93`、`:158`、`:243` 與 `src/postInstagram.ts:204`、`:298`、`:351` 直接送出 `input.caption`，沒有追加 footer、模板、hashtags 或 first comment。沒有改動這些 TS。廣掃仍照 r2 要求包含尚未由這條路徑發布的字串欄位，因此會攔到素材路徑及來源文字。

## 驗證結果

| 驗證 | 實際結果 | 證據 |
|---|---|---|
| r2 修前失敗基線 | `SMOKE_FAIL cases=52 failures=10`／exit 1；重現同日第二次發布與漏判九種日期文字。 | `r2-baseline-red.txt` |
| 原生 smoke | `SMOKE_BLOCKED native File.Replace`／exit 2，因 Access denied 停在 preflight。 | `r2-native-smoke.txt` |
| 明確啟用原子 API 測試替身的行為測試 | `SMOKE_BEHAVIOR_PARTIAL cases=108 failures=0 blocked=1 native_atomic_replace=NOT_VALIDATED`／exit 2。108 個通過；taskkill 樹終止被原生權限拒絕，沒有把自然退出當成 kill 證據。 | `r2-behavior-smoke.txt` |
| 日期 guard 變異 | temporary copy 移除日期檢查呼叫：`SMOKE_FAIL cases=105 failures=47`，預期 exit 1；正本 SHA 前後相同。 | `r2-date-guard-mutation.txt` |
| `[本這]週` regex 分支變異 | 只拔掉對應分支：`SMOKE_FAIL cases=105 failures=2`，僅「本週／這週」案例預期紅燈，exit 1；正本 SHA 前後相同。 | `r2-week-regex-mutation.txt` |
| PS 5.1／ASCII／parser | 三支腳本均 non-ASCII bytes=0、parser errors=0；最終 SHA 見證據。 | `r2-script-checks.json` |
| 真 repo／七筆 DryRun | 八次 exit 0，隊列／log／seed／calendar 等前後 fingerprint 相同；四份 calendar 與正式樹同 bytes。 | `r2-real-repo-dryrun.txt`、`r2-all-seven-dryruns.txt`、`r2-dryrun-checks.json` |
| 真 schema fixture | keys、巢狀結構、陣列長度及 scalar types 由真檔複製；只替換字串為假文字。 | `r2-fixture-source.json`、測試 fixture |
| 原生 CIM | New-ScheduledTaskTrigger 回 HRESULT 0x80041003／Access denied，沒有建立或註冊工作；registrar 的設定、晚註冊警告等只用 mock 驗證。 | `r2-native-cim.json` |
| 程式唯讀複審 | 最終 RESULT、兩份變異、腳本 hash／ASCII、DryRun 欄位與 helper 邊界均已讀回，未發現新增必修程式缺陷；原生驗收未通，因此正式啟用不放行。 | `r2-review.md` |
| 隊列／版本控制邊界 | seed 七筆全 pending 且順序正確；真 runtime 與舊 queue 均不存在，根 `.gitignore` 無 diff，`git diff --check` 通過；沒有 src／line-bot diff。 | `r2-final-invariants.json`、本輪 git readback |

Smoke 涵蓋 queue 推進與 backup、每日 guard、skip／already-done 不消耗天數、mutex 後重查、stop-before-claim／stop-during-attempt、空／壞 JSON、字串 dry_run、單平台與歷史失敗紀錄、深層文字／hashtag、所有新增日期詞、裸 IG token、5 秒 timeout 的 -1／failed／不重試、繼承 stdout pipe 的 30 秒上限，以及 mock registrar。部分成功案例使用的假 npm 模擬 TS `hasRecordedPost` 跳過 FB 的行為，不能當作真平台實測。

可複跑命令如下；**第一個原生命令通過之前，不可註冊**。所有測試 npm 都是假指令。

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/ps-backfill-publish.smoke.ps1
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/ps-backfill-publish.smoke.ps1 -UseAtomicReplaceShim
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/ps-backfill-publish.smoke.ps1 -UseAtomicReplaceShim -MutateDateGuard
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/ps-backfill-publish.smoke.ps1 -UseAtomicReplaceShim -MutateWeekRegex
```

後兩個命令預期 exit 1；它們只修改 temporary copy，正本 SHA 前後已核對相同。變異模式略過逾時／繼承 pipe 的三個行為案例與一個原生 kill 驗證，因此共 105 個案例。替身模式明確標示不驗證原生原子性，遇原生 kill 受阻時保留 exit 2。初次補測的 harness exit 傳遞與 JSON array fixture 問題已修正，初次紅燈保留於 `r2-behavior-initial-red.txt`。

## 真 repo DryRun 與七筆日期結果

未修改腳本、預設 RootPath 的實際命令：

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/backfill-publish.ps1 -DryRun -NpmCommand __A9_NO_REAL_NPM__
```

實際輸出（`A9-evidence/r2-real-repo-dryrun.txt`）：

```text
date=2026-10-26 slot=2 date_check=skip hits=2026-10-26
DryRun action=skip
EXIT_CODE=0
QUEUE_AND_LOG_PATHS_UNCHANGED=true
RUNTIME_QUEUE_EXISTS=false
DEFAULT_ROOT_ENTRY_POINT=true
```

四份本機 calendar 與正式樹相同 bytes；來源未改。真 repo 及七份單筆 seed 隔離預覽皆 exit 0／零寫入。SHA／size／mtime、原始輸出與命中欄位在 `r2-dryrun-checks.json`，人讀輸出在 `r2-all-seven-dryruns.txt`。

| 順序 | 日期 | Slot | 判定 | 命中字 | 命中欄位 |
|---|---|---|---|---|---|
| 1 | 2026-10-26 | 2 | skip | `2026-10-26` | `local_image_path` |
| 2 | 2026-10-27 | 1 | skip | `2026-10-27`、`2026-08-05`、`2026-07-29` | `local_image_path`、carousel 內同名欄位、`local_video_path`、`video_prompt`、`video_candidate.grok_motion_prompt`、`media_package.effective_date` |
| 3 | 2026-10-27 | 2 | skip | `2026-10-27` | `local_image_path` |
| 4 | 2026-10-28 | 1 | skip | `2026-10-28`、`2026-08-05` | `local_image_path`、carousel 內同名欄位、`local_video_path`、`video_prompt`、`video_candidate.grok_motion_prompt` |
| 5 | 2026-10-28 | 2 | skip | `2026-10-28` | `local_image_path` |
| 6 | 2026-10-29 | 1 | skip | `2026-10-29`、`2026-08-05`、`2026-07-29` | 同 10/27 slot 1 |
| 7 | 2026-10-29 | 2 | skip | `2026-10-29` | `local_image_path` |

`image*` 是欄位前綴排除，`local_image_path` 並不符合；`effective_date` 也不等於排除的 `date`。這是嚴格套用 r2 規則的實際結果。本輪沒把七筆真正改為 skipped：seed 仍七筆 pending、真 runtime queue 尚不存在。如果直接採用這些資料執行正式腳本，在原子 API 可用的環境會依 while 一次標完七筆 skipped，沒有 npm 發布嘗試。

## 未完成事項與交接

- 本環境無法完成原生 File.Replace／程序樹終止與 ScheduledTasks CIM 驗收；正式註冊仍須受阻。總指揮應在可執行這些原生 API 的環境跑不帶替身的 smoke，再決定註冊；本輪不執行 registrar。
- 七筆全 skip 的規則與資料結果須由總指揮／店主處置。未自行放寬欄位規則或重寫／刪除來源資料；廣掃沒有驗收圖片、時序語意或真發布閘門。
- Stop 保護 pending；已 claim 的單筆可能已達遠端 commit point，無法用 Stop 撤回。timeout／部分成功／uncertain 必須人工對帳，failed 不會自動重試。
- Interactive 仍需使用者登入；睡眠、離線、mutex 忙碌或七天窗口結束可能留下 pending。本輪未更動排程策略、Sentinel 或告警。
- 外部 Vault 不在本工作階段可寫範圍，沒有執行其寫入工具。安全摘要留在此可檢查交付，由總指揮回寫 task_summary／handoff。九格的外部留痕尚缺，不能寫九格全數完成。

```text
VAULT_WRITEBACK|project=sixiangjia|summary=A9 r2 code candidate updated; native acceptance BLOCKED by sandbox File.Replace, ScheduledTasks CIM and taskkill permissions. Daily guard, atomic runtime queue with tracked seed, expanded date/string scan, timeout and mutex/Stop protections implemented. Seven actual-data DryRuns exit 0 with zero writes, but all seven would skip under exact r2 exclusions due media-path/provenance dates. No commit, real npm publish, scheduler registration/disable, LINE/Meta or secrets access. See docs-internal/cards/A9-RESULT.md and A9-evidence/r2-* for final counts and remaining gates. Commander owns native validation, rule/data decision, registration and Vault writeback.
```

API 語意已核對 Microsoft 官方 [File.Replace](https://learn.microsoft.com/en-us/dotnet/api/system.io.file.replace?view=netframework-4.8.1)、[Task.Wait(Int32)](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.task.wait?view=netframework-4.8.1)、[ScheduledTask settings](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset?view=windowsserver2025-ps)；本機實測權限失敗仍是本輪驗收依據。
