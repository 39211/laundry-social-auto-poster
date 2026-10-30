# A9 補發排程器 r3 交付結果

2026-10-30。**r3 掃描範圍已修正，七筆實際文案 DryRun 全部 `pass`、exit 0，來源、seed、queue 與 log 零寫入。** 只掃會發布的兩個 caption 與指定 slot 的 first-comment 文字；r2 的日期 regex 與其他發布保護保留。

修後行為 smoke **128 通過、0 失敗、1 個原生殺樹驗證 BLOCKED**，整體 exit 2。原生 `File.Replace` preflight 仍被環境拒絕，不能聲稱原生全綠或正式排程已可啟用。所有發布分支只用假 npm；沒有 commit、stage、push、真實 npm 發布、LINE／Meta、排程註冊／停用或 secrets 讀取。

## r3 修了什麼

| r3 要求 | 本輪落實 |
|---|---|
| 1：只掃實際發布文字 | `Get-CaptionStrings` 僅取 `facebook_caption`、`instagram_caption` 的字串值。新 `Get-FirstCommentStrings` 讀 `data/first-comments/<date>.json`，只取匹配 slot 的 `text`、`message`、`comment`、`comment_text` 字串；檔案或該 slot 不存在即略過。calendar 的其他欄位、內嵌 first_comments、留言 ID／時間戳／note 都不掃。 |
| 2：保留 r2 regex | 對修改前後的 regex 原文做換行正規化比較，結果相同；台灣日期用語與 ISO 日期分支均保留。兩個 caption 內的 ISO 日期與 hashtag 日期詞都有實際攔截案例。 |
| 3：重跑七筆 | 真 repo 預設入口跑一次，另外用七份單筆 seed 隔離預覽同一批真 calendar；共八次 exit 0／零寫入。七筆皆 pass，沒有命中字或欄位。四份 calendar 與正式樹相同 bytes。 |
| 4：smoke 與變異 | 加入內部路徑／video_prompt／effective_date 含日期、caption 乾淨仍 pass，以及 first comment「週末」skip；加驗其他 slot、只有 metadata、空陣列、壞 JSON、兩平台 caption 的 ISO／hashtag 與零寫入。保留其餘適用的 r2 行為測試；日期 guard、week regex 與 first-comment 掃描各有 temporary-copy 變異。 |
| 5：RESULT／不 commit | 本節與 `A9-evidence/r3-*` 是本輪交付；修改前 r2 報告另存 `A9-evidence/r2-result-snapshot.md`。未 commit。 |

實作只改 `scripts/backfill-publish.ps1`；測試改 `test/ps-backfill-publish.smoke.ps1`。新增的預覽／smoke runner、修改前快照、差異與檢查結果都在 `A9-evidence/r3-*`。registrar、seed、fixture、兩份既有 dirty 的規則檔，以及所有 `src/*.ts` 的修改前後 SHA 均相同，見 `r3-final-invariants.json`。

### First comment 結構與邊界

已讀 `src/firstComment.ts:18`、`:62`、`:88`、`:98`、`:105`，以及正式樹既有 `data/first-comments/2026-10-26.json`。實際結構是陣列，每列為 `date`、`slot`、`media_id`、`comment_id`、`created_at`，現有紀錄沒有保存留言內文。因此不能把日期／時間戳當留言文字；本輪只讀上述明確的文字欄位，有值才掃。測試以同一陣列結構加入假文字，沒有複製正式 ID 到測試。

本工作樹沒有 first-comments 目錄；正式樹 10/26 的紀錄只有 slot 1，不屬於第一筆補發的 slot 2；其餘三天沒有檔案。七個目標 slot 在兩邊皆沒有可用留言文字，已記錄各 slot 的有無、欄位名稱與筆數，見 `r3-dryrun-checks.json`，未輸出正式 ID。

發布 caption 的依據仍為 `src/postCurrentSlot.ts:469`／`:481` 的 `input.caption`；本輪沒有修改或執行 TS 發布程式。此掃描不重建 `commentTextFor` 或其他工具日後可能生成的文字；若之後實際文字變更，需重新 DryRun。

### r3 驗證結果

| 驗證 | 本輪實測 | 證據 |
|---|---|---|
| 修前失敗基線 | `SMOKE_FAIL cases=128 failures=23`，exit 1；重現內部欄位誤攔、first comment 漏掃等 r3 邊界。 | `r3-baseline-red.txt` |
| 修後行為 smoke（明確啟用既有原子 API 測試替身） | `SMOKE_BEHAVIOR_PARTIAL cases=128 failures=0 blocked=1 native_atomic_replace=NOT_VALIDATED`，exit 2；128 個通過，原生 taskkill 受限的一個驗證仍 BLOCKED。 | `r3-behavior-smoke.txt`／`.json` |
| 原生 smoke | `SMOKE_BLOCKED native File.Replace`，exit 2；三參數呼叫回 Access denied，未走發布分支。 | `r3-native-smoke.txt` |
| 拿掉整個日期 guard | `SMOKE_FAIL cases=125 failures=51`，預期 exit 1。 | `r3-date-guard-mutation.txt`／`.json` |
| 拿掉「本週／這週」regex 分支 | `SMOKE_FAIL cases=125 failures=2`，只有對應兩例紅燈，預期 exit 1。 | `r3-week-regex-mutation.txt`／`.json` |
| 拿掉 first-comment 掃描 | `SMOKE_FAIL cases=125 failures=9`，預期 exit 1；留言 skip／零寫入與壞 JSON 保護能抓到退化。 | `r3-first-comment-mutation.txt`／`.json` |
| 七筆實際文案與真 repo 預覽 | 八次 exit 0；七筆 pass；SHA／size／mtime 前後相同；runtime queue 未建立。 | `r3-real-repo-dryrun.txt`、`r3-all-seven-dryruns.txt`、`r3-dryrun-checks.json` |
| PS 5.1、ASCII、parser | `5.1.26100.9711`；publisher、registrar、smoke 三支腳本 non-ASCII bytes=0、parser errors=0。 | `r3-script-checks.json` |
| r2 保護與範圍 | regex 原文相同；registrar、seed、fixture、既有 dirty 檔及 `src/*.ts` SHA 保持；seed 七筆 pending；`git diff --check` 通過。 | `r3-regex-check.json`、`r3-implementation.diff`、`r3-final-invariants.json` |

變異只改 temporary copy，三次皆核對正式 publisher SHA 前後相同。變異模式依既有測試規則略過耗時的 timeout／繼承 pipe 測試，因此各有 125 個 assert；完整行為模式仍保留這些案例。原先掃任意 calendar 字串的 r2 測試，依 r3 改為驗證「不掃」；hashtag 攔截移到實際 caption 內驗證，其他每日限額、mutex、Stop、timeout、queue、redaction、registrar 等測試保留。

正式腳本沒有非原子備援；`-UseAtomicReplaceShim` 只作用於 temporary copy，不能拿它取代原生原子性或殺樹驗收。本輪以實際 PS 行為、變異與手動 diff 檢查為 checker，沒有另派獨立／跨家族 reviewer，也沒有重跑不覆蓋本次 PS 變更的 TS 測試套件。

### r3 真 repo DryRun 與七筆表

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/backfill-publish.ps1 -DryRun -NpmCommand __A9_NO_REAL_NPM__
```

```text
date=2026-10-26 slot=2 date_check=pass hits=
DryRun action=publish
EXIT_CODE=0
QUEUE_AND_LOG_PATHS_UNCHANGED=true
RUNTIME_QUEUE_EXISTS=false
DEFAULT_ROOT_ENTRY_POINT=true
```

`action=publish` 是 DryRun 的預測文字；沒有執行發布。

| 順序 | 日期 | Slot | 判定 | 命中字 | 命中欄位 |
|---|---|---|---|---|---|
| 1 | 2026-10-26 | 2 | pass | 無 | 無 |
| 2 | 2026-10-27 | 1 | pass | 無 | 無 |
| 3 | 2026-10-27 | 2 | pass | 無 | 無 |
| 4 | 2026-10-28 | 1 | pass | 無 | 無 |
| 5 | 2026-10-28 | 2 | pass | 無 | 無 |
| 6 | 2026-10-29 | 1 | pass | 無 | 無 |
| 7 | 2026-10-29 | 2 | pass | 無 | 無 |

可複跑的本機命令：

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/ps-backfill-publish.smoke.ps1
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/ps-backfill-publish.smoke.ps1 -UseAtomicReplaceShim
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/ps-backfill-publish.smoke.ps1 -UseAtomicReplaceShim -MutateDateGuard
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/ps-backfill-publish.smoke.ps1 -UseAtomicReplaceShim -MutateWeekRegex
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/ps-backfill-publish.smoke.ps1 -UseAtomicReplaceShim -MutateFirstCommentGuard
```

後三項預期 exit 1。預覽另可執行 `A9-evidence/r3-verify-dryruns.py`，smoke runner 為 `A9-evidence/r3-run-smoke.py`；runner 會在 JSON／TXT 明列內層 smoke exit code。

### r3 交接與限制

- r3 程式與日期範圍驗證完成；**原生全綠仍未達成**。總指揮須在有對應權限的環境跑不帶替身的 smoke，驗過 File.Replace 與 taskkill 樹終止後再判斷是否註冊。本輪未操作真正的 ScheduledTasks；r2 的 CIM 限制沒有重新探測，不作本輪已驗事實。
- 現在七筆不會因內部日期誤判 skip；seed 仍七筆 pending，沒有真 runtime queue，沒有真正補發。日期閘門沒有驗收圖片內文字或圖像時序語意，沿用 r2 的此項邊界。
- Stop、timeout／uncertain 對帳、Interactive 登入／睡眠、七日窗口等原有 r2 限制保留。
- 外部 Vault 不在本工作階段可寫範圍，未執行越界寫入。開工卡、完整結果與安全摘要已留於本工作樹；由總指揮回寫 Vault。九格缺第 9 格的外部 task_summary 留痕。

```text
VAULT_WRITEBACK|project=sixiangjia|summary=A9 r3 scan narrowed to facebook_caption, instagram_caption and selected-slot first-comment text. R2 date regex unchanged. Eight actual-data previews exit 0 with zero input/queue/log writes; all seven queued slots pass, seed remains pending. Behavior smoke 128 passed, 0 failed, 1 native kill-tree check BLOCKED, inner exit 2. Native File.Replace preflight still Access denied. Three temporary-copy mutants killed: date guard 51 failures, week regex 2, first-comment scan 9; publisher SHA unchanged. No commit/stage/push, real npm publisher, task registration/disable, LINE/Meta, TS changes or secrets access. Current evidence: docs-internal/cards/A9-RESULT.md and A9-evidence/r3-*. Commander owns native acceptance, independent review if required, registration and Vault writeback.
```

---

## r2 歷史原文（以下結果由上方 r3 現況取代）

以下保留 r2 交付內容供對照；其中「七筆全 skip／廣掃字串」是修前歷史，現行行為與驗證以本檔上方 r3 段為準。完整未改快照見 `A9-evidence/r2-result-snapshot.md`。

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
