# A5 結果：本地合成演練完成，正式復原時間未量測

- 日期：2026-10-30（Asia/Taipei）。
- 使用者要求：讀取並遵循 `docs-internal/cards/A5-ai-recoverability.md`；只新增 `ops/`、`docs-internal/RUNBOOK-RECOVERY.md`、本報告；只在 worktree 內或指定 D: 臨時目錄演練，不操作現役，不做 git commit，繁中回報。
- 工作目錄：`C:\Users\cyc39\AI-Lanes\a5\repo`；分支 `feat/a5-recoverability`；交付時 HEAD `dfd6cedb9861cd2264eefc87d979f28f1dfffecc`。
- Owner／正式驗收者：Claude 總指揮；maker：本線 Codex；另外使用一席同家族唯讀 reviewer，沒有外部艦隊或跨家族驗收。
- 開工卡：[ops/A5-PLAN.md](../../ops/A5-PLAN.md)。目前成功取得的 Obsidian 首頁、唯讀 Vault 搜尋與戰情板僅作背景；依本次明確的新增檔案範圍，任務紀錄保存在本報告，未另寫 Vault／`ai_vault.py manual`，未更新戰情板。

## r2｜第二輪鎖定與排除修正（2026-10-30）

本輪要求：修正總指揮回報的現役 DryRun `FileReadError`；只修改 `ops/` 與本報告、RUNBOOK，不提交、不對現役執行正式備份。Owner／最終 checker 為 Claude 總指揮，maker 為本線 Codex；r1 的 reviewer 結論保留為歷史，本輪沒有新增其他 agent 或跨家族複審。任務摘要與證據留在本次允許路徑，不另寫 Vault／戰情板。

已完成：

- 備份預設在開檔前排除 `*.lock`、`*.pid`、`*.tmp`；排除項不算 skipped，規則寫入 `ExcludedFilePatterns`。
- 一般來源讀取遇到 `IOException`／`UnauthorizedAccessException` 時略過，將絕對 `Path` 與分類 `Reason` 放入 MANIFEST 的 `Skipped`。涵蓋 data、state、LocalState、MDB、離線 XML，也涵蓋清單完成後才取得的鎖。實際 Files／FileCount 只含成功複製與驗證的檔案。
- `secrets/` 未排除的檔案與根 `.env` 讀取失敗仍中止；以 `powershell.exe -File` 子程序驗證 exit `1`，不建立完成的備份。目的地寫入、SHA／大小異動、缺必要來源、路徑與 XML 安全錯誤仍失敗。
- DryRun 保持零檔案寫入，透過回傳物件提供 `Skipped`；正式備份寫入 MANIFEST。兩者均印出 `A5_BACKUP skipped=N` 並回傳 `SkippedCount`。
- 共用 hash 改用 FileStream／SHA-256，保留原始 IO 例外類型，避免 PowerShell 5.1 的 Get-FileHash 將其包成 `FileReadError`。備份複製持有同一個讀取 handle，來源讀取與目的地寫入分開處理；中途被略過的來源不會留下未列出的 payload。原 restore 的失敗規則不放寬。
- RUNBOOK 已加入 r2 判讀與操作方式，並修正舊有「MDB 鎖定一律中止」的說法。

| 驗收 | 本輪實測 |
| --- | --- |
| 先紅 | 原實作下 r2 初始 21 項：**5 passed／16 failed**，exit `1`。排除、一般真鎖、拒讀與晚到的鎖尚未符合新規格；必要來源失敗等既有護欄保留。 |
| 後綠 | 同組 21 項：**21 passed／0 failed**，exit `0`；`33.11` 秒。成功子程序 stderr 為空，兩模式 skipped 計數可見；DryRun 檔案樹前後相同。 |
| 完整維運回歸 | 原 28 項＋r2 23 項，**51 passed／0 failed／0 skipped**，exit `0`；Pester `85.8` 秒。另含跨 3 個 buffer 的 163857 bytes 檔案與清單後來源異動的拒絕測試。 |
| 真鎖／必要來源 | FileStream／FileShare.None 獨占開啟；data、state、local、MDB、XML 在兩模式均被 skipped；鎖住的 `*.lock` 在讀取前排除；`secrets/line.json`／`.env` 兩模式均 exit `1`。 |
| UnauthorizedAccess | 沙箱拒絕 DACL 修改，因此在實際 XML 讀取邊界注入 UnauthorizedAccessException；其餘備份／MANIFEST／檔案操作為真實執行。一般來源被記錄，必要來源不降級為 skip。沒有宣稱真 ACL 拒讀的端到端驗收。 |
| Python 獨立產物讀回 | **PASS**：9 份 MANIFEST、101 個 payload、`172561 bytes`；7 筆 skipped 的 path／reason 正確，SHA／大小與來源位元相同，未列出／半成品 payload **0**。失敗案例沒有完成 MANIFEST，DryRun 沒有建立備份根。 |
| 原 roundtrip 再驗 | **PASS**：12 個已還原檔 `1045 bytes`、12 個 pre-restore payload `1031 bytes`，逐檔 SHA／大小一致。 |
| PowerShell parser | 7 份正式 `.ps1`／測試腳本，**0** 個解析錯誤。 |

證據：[r2-red.txt](../../ops/evidence/r2-red.txt)、[r2-green.txt](../../ops/evidence/r2-green.txt)、[完整 51 項輸出](../../ops/evidence/r2-full-pester.txt)、[r2 Python 讀回](../../ops/evidence/r2-independent-readback.json)、[roundtrip 再驗](../../ops/evidence/r2-readback/core.json)、[parser](../../ops/evidence/r2-parser.json)。Pester 原始輸出採 UTF-16LE；Python 證據採 UTF-8。可重跑的獨立讀回工具為 [verify-r2-manifests.py](../../ops/verify-r2-manifests.py)。原 r1 證據未覆蓋；修改前副本另以 `.before` 副檔名保存在 `ops/evidence/r2-before/`，不會被 Pester 當成第二份測試。

演練根：`C:\Users\cyc39\AI-Lanes\a5\repo\ops\_tmp\drill-379467b679684c89870665f5e0a679db`。本機原版透過 `powershell.exe -File`／Stop 設定測到一般真鎖會 exit `1`；沒有把這個結果冒充總指揮現役的「帶非終止錯誤但 exit 0」重現。本輪確認的是修正後一般鎖可略過且無錯誤輸出、必要來源失敗仍非零。

測試環境修正也保留：`r2-red-harness.txt` 記錄 DACL 變更被拒；`r2-red-mock-scope.txt` 記錄 Pester 3 mock 範圍需限縮到特定 fixture。`r2-green-transport*.txt` 的失敗是 EncodedCommand 把 Write-Host 資訊序列化到 stderr；改用符合實際入口的 `-File` 子程序後，原 stderr 斷言保留且全通。未以這些測試架構問題冒充產品缺陷。

限制與交接：`Verified=True`／`Status=Complete` 只保證 Files 已驗證，仍須逐項檢查 Skipped 是否足以支援還原；帶 skipped 的備份同樣計入最近 14 份保留。MDB 被略過時，本包不能還原該 MDB。正式資料量、跨檔一致性、現役備份／原生排程與 30 分鐘 RTO 仍未在本輪量測；未執行現役正式備份、服務啟停、排程註冊、git stage／commit／push。總指揮可在既有授權範圍重新讀驗候選與現役 DryRun，首次真實備份仍由總指揮依下方指令執行。

## r1 交付（歷史紀錄保留）

| 檔案 | 已實作行為 |
| --- | --- |
| [backup-sxj-live.ps1](../../ops/backup-sxj-live.ps1) | 備份 secrets、`.env`、data（各層排除 photos／video-*）、line-bot 頂層 JSON／TXT、LocalAppData line-bot 頂層 JSONL、MDB、三種前綴排程 XML；每檔來源路徑／大小／SHA-256；DryRun 零寫入；保留最近 14 份完整驗證備份。 |
| [restore-sxj-live.ps1](../../ops/restore-sxj-live.ps1) | `-From`、單類 `-Only`、所有來源／目的根參數；先驗全部 payload，再保存 pre-restore，最後覆寫並再驗目的檔。正式排程支援 XML 註冊、新 TaskPath、帳號預檢與設定讀回；WhatIf 阻擋所有寫入。 |
| [rollback-code.ps1](../../ops/rollback-code.ps1) | 查指定 tag 是否存在，僅輸出乾淨工作樹檢查、備份／停機前提、`checkout --detach --no-overwrite-ignore`、啟動與 Probe 的指令；本身不回退、不啟停。 |
| [register-backup-task.ps1](../../ops/register-backup-task.ps1) | 每日 03:30；預設 SYSTEM、可選 CurrentUser；顯式固定 owner 的 LocalStateRoot，避免 SYSTEM 執行時改指到系統 profile；WhatIf；拒絕無聲覆寫同名任務；驗 Action／Trigger／Principal／Settings 讀回。 |
| [RUNBOOK-RECOVERY.md](../RUNBOOK-RECOVERY.md) | 四個獨立操作頁：程序故障／重複、程式回退、secrets／data 還原、整機重建；每步有指令與成功條件。 |
| [Recovery.Common.ps1](../../ops/Recovery.Common.ps1) | 路徑與 reparse 邊界、MANIFEST／SHA／大小、XML、保留清理與精確程序篩選的共用函式。 |
| [test-recovery.ps1](../../ops/test-recovery.ps1)、[Recovery.Tests.ps1](../../ops/tests/Recovery.Tests.ps1) | Windows PowerShell 5.1／本機 Pester 3.4.0，所有檔案操作在 `ops/_tmp/`；原生排程與 COM 寫入均用替身。 |
| [verify-drill-manifests.py](../../ops/verify-drill-manifests.py) | 另以 Python 標準庫獨立重讀實際 payload／還原目的檔／pre-restore，直接算 SHA-256 與 bytes，不依賴 PowerShell helper 的判定。 |

主腳本均使用 ASCII 文字，避免 PowerShell 5.1 預設 cp950 造成非 ASCII 腳本解析問題。臨時演練目錄由 `ops/.gitignore` 排除；原始證據在 `ops/evidence/`。

## r1 最終驗證與證據

| 檢查 | 實際結果 |
| --- | --- |
| PowerShell 5.1 parser | 全部新增 `.ps1`：`0` 個解析錯誤。 |
| 最終完整 Pester | **28 passed／0 failed／0 skipped**；exit `0`；Pester `32.73` 秒，演練內計時 `32.504` 秒。 |
| 真實檔案演練 | 12 個合成檔（secrets 2、data 2、state 4、MDB 1、tasks 3），backup → 改壞 → restore 後 SHA-256／大小全同；該項 Pester `1.53` 秒。 |
| Python 獨立讀回 | **PASS**：12 個還原檔、`1045 bytes`；12 個 pre-restore payload、`1031 bytes`，逐檔 SHA／大小全部通過。 |
| DryRun／WhatIf | 目錄／檔案樹快照前後全同，備份目的地不存在時也不建立；原生 tasks WhatIf 不查／不註冊排程。 |
| 保留與覆寫保護 | 固定同一分鐘製造 16 份，路徑全唯一、只保留最近 14 份；不明目錄與備份根內 junction 保留，junction 目標檔案不變。 |
| 失敗模式 | 缺來源、payload 損壞、MANIFEST 跳脫／重複目的地、來源／目的 junction、根目錄重疊、壞 XML、錯 Action／帳號／LogonType／每日週期、Password／舊 SID 均有拒絕測試。 |
| pre-restore | 既有檔原樣保存且驗 SHA；另外實際把非空 pre 再 restore，取回覆寫前內容。 |
| 原生 API 替身 | `Get-ScheduledTask`／Export／Register 與 TaskPath COM 使用 mock；SYSTEM／CurrentUser、巢狀 TaskPath 與錯誤讀回已測。沒有註冊真排程。 |
| 回退／程序選擇 | 回退僅輸出計畫；精確 Python 映像＋完整絕對 script argument 測試排除相似目錄、編輯器、Python `-c`。 |

最終演練根：`C:\Users\cyc39\AI-Lanes\a5\repo\ops\_tmp\drill-b5fd751947974e1990d4ce69fa9c8481`。

證據入口：[完整 Pester 原始輸出](../../ops/evidence/final-pester.txt)（UTF-16LE）、[Python 獨立讀回](../../ops/evidence/final-independent-readback.json)、[備份 MANIFEST 副本](../../ops/evidence/final-roundtrip-MANIFEST.json)、[pre-restore MANIFEST 副本](../../ops/evidence/final-pre-restore-MANIFEST.json)。以下另嵌入完整最終原始輸出。

本次沒有執行 npm／Python 業務測試；新增內容為獨立維運工具，沒有修改既有程式及其呼叫路徑。驗證集中在實際檔案復原流程、PowerShell 與原生介面的替身契約。

## r1 演練失敗、修正與複審

不是把第一個綠燈當完成。保留了初始缺實作、邊界失敗、測試架構錯誤與最終成功的原始輸出：

1. 初始無實作：`red.txt` 為 2 passed／12 failed；完成四支腳本後 `iteration-1.txt` 為 14／14。
2. `hardening-red.txt`／`hardening-before-fix.txt` 暴露 secrets／data 根 junction 漏檢、排程設定讀回不足；修正後 `hardening-after-fix.txt` 8／8。最初 WhatIf 的一筆計數是 Pester 3 以 Describe 累計前一 It 的 mock 呼叫，已改用 `-Scope It`，沒有把它冒充正式 API 寫入。
3. `register-red.txt`／`register-before-fix.txt` 曾有測試替身缺基類 PSTypeName、mock script scope 不同的架構錯誤；修正測試後 `register-confirmed-red.txt` 明確重現尾端反斜線與錯誤讀回缺陷，再修實作，`register-after-fix.txt` 通過。
4. 唯讀複審查官方 cmdlet enum，抓到實作與 mock 一起把 `ServiceAccount` 誤設 `6`；官方值為 `5`。`register-enum-red.txt` 顯示 Expected 5／Actual 6；改為註冊前擷取正式 cmdlet 產物的 enum、mock 依官方 enum 名稱解析，`register-enum-green.txt` 3／3。依據：[Microsoft Principal.LogonType](https://learn.microsoft.com/en-us/windows/win32/taskschd/principal-logontype)。
5. `retention-name-reuse-red.txt` 暴露同分鐘第 1 份被清掉後，第 16 份重用基礎目錄名（15 個唯一名稱）；修為同分鐘有任何前綴就產生新尾碼，並固定測試時鐘，最後完整集合 **28／28**。

同家族唯讀複審最終結論：**Can ship，無剩餘必修問題**，限本機候選程式／手冊／合成演練；不代表原生排程、現役服務或正式 RTO 驗收。Reviewer 逐檔讀程式、讀最終證據，沒有改檔或另跑測試。摘要見 [review-final.md](../../ops/evidence/review-final.md)，沒有稱為跨家族驗收。

## 「第一次真實備份」總指揮執行指令

**以下本線沒有執行。** 總指揮先確認維護時段、真正來源位置、D: 掛載與空間、備份目的地僅有核准帳號可讀的 ACL；需要一致快照時先控制相關 writer／MDB 的使用狀態。這份備份包含明文憑證，不得上傳到公開 Git／一般共享目錄。

```powershell
$ErrorActionPreference = 'Stop'
$ops = 'C:\Users\cyc39\AI-Lanes\a5\repo\ops'
if (-not (Test-Path 'D:\C-moved') -or -not (Test-Path 'D:\AI-Lanes-work')) { throw 'D: 掛載不符，停止。' }
$backupArgs = @{
    Root = 'C:\Users\cyc39\laundry-repo'
    LocalStateRoot = 'C:\Users\cyc39\AppData\Local\line-bot'
    MdbPath = 'C:\FXwash\eHank.mdb'
    BackupRoot = 'D:\AI-Lanes-work\_backups\sxj-live'
}
# 先只列清單；確認範圍與缺件，不產生任何檔案。
$preview = & (Join-Path $ops 'backup-sxj-live.ps1') @backupArgs -DryRun
$preview.Files | Format-Table Category,RelativePath,SourcePath,Size -AutoSize
$preview | Select-Object FileCount,SkippedCount
$preview.Skipped | Format-Table Path,Reason -AutoSize
# 總指揮核對清單、來源一致性與目的地 ACL 後，才執行這兩段。
$backup = & (Join-Path $ops 'backup-sxj-live.ps1') @backupArgs
. (Join-Path $ops 'Recovery.Common.ps1')
$verifiedManifest = Read-RecoveryManifest $backup.BackupDirectory
$backup | Select-Object BackupDirectory,FileCount,SkippedCount,Verified
$verifiedManifest.Files | Group-Object Category | Select-Object Name,Count
$verifiedManifest.Skipped | Format-Table Path,Reason -AutoSize
```

成功條件：備份腳本無錯誤、`Verified=True`，且 `Read-RecoveryManifest` 對新目錄全部 SHA／大小驗通，已複製數量與 Files 相符，並逐項核對 Skipped 是否足以支援預定還原；保留具體目錄於正式事故／備份紀錄。不能只憑排程 exit 0 宣稱備份存在。首次真實備份與 03:30 任務註冊是兩件事；註冊腳本只交付，這次沒有執行。

## 範圍、未驗證項與交接

- **沒有操作現役** `C:\Users\cyc39\laundry-repo`／`Documents\New project 5`，未讀取真 secrets／`.env`／客戶資料，沒有連店機、呼叫正式 LINE／Meta／Google、Probe、啟停服務或註冊排程。
- Git 的 tracked diff／staged diff 為空；只新增允許路徑，未 stage、commit、push、merge 或 checkout。回退 tag 的存在性僅在本 worktree 讀驗，沒有拿舊 A1 報告推測目前現役狀態。
- **正式 30 分鐘 RTO：UNMEASURED。** 上述 1045 bytes 為合成小樣本；MDB 是假位元檔，不證明真資料庫可開啟。正式資料量、鎖定／跨檔一致性、真 Windows 註冊與 SYSTEM 排程執行、重灌依賴、實機 LINE 通路均待總指揮在授權時段驗收。
- `pre-restore` 只保存原先存在且將覆寫的檔／排程；`ABSENT-BEFORE.json` 是資訊清單，不能自動撤回新建檔／新排程。還原也不會刪除多出的檔案；中途失敗不是全量交易回復，保留 pre 後由總指揮判斷已套用範圍。
- 排程 XML 不保存登入密碼；舊 SID／Password principal 需先由店主重建。SYSTEM 是每日任務預設；CurrentUser 需保持登入；機器關機時只能在可用後補跑。逐檔 SHA 不是簽章或整機／交易快照。
- 最終正式接手動作只有：總指揮依上方指令完成首次真實備份與獨立讀回，再於另外核准的維護時段做原生／服務／RTO 驗收。本卡不自行執行。

九格✓（開工／證據／交接留於本次允許的檔案範圍；正式驗收限制如上）。

## r1 最終完整原始輸出

```text





Describing A5 real file recovery drill (synthetic only)
 [+] has all four required entry scripts 588ms
 [+] DryRun creates no files, even when BackupRoot does not exist 492ms
ROUNDTRIP backup=C:\Users\cyc39\AI-Lanes\a5\repo\ops\_tmp\drill-b5fd751947974e1990d4ce69fa9c8481\roundtrip\backups\20261030-0141 entries=12 SHA256_ALL_EQUAL=True preRestore=C:\Users\cyc39\AI-Lanes\a5\repo\ops\_tmp\drill-b5fd751947974e1990d4ce69fa9c8481\roundtrip\pre-restore\pre-restore-20261030-0141
 [+] backs up, corrupts, restores all categories and verifies every SHA/size plus pre-restore 1.53s
 [+] Only data leaves secrets/state/tasks/mdb unchanged 609ms
 [+] restores to a new root and overrides local-state and mdb destinations 776ms
What if: Performing the operation "Snapshot existing files/tasks, then restore verified backup" on target "C:\Users\cyc39\AI-Lanes\a5\repo\ops\_tmp\drill-b5fd751947974e1990d4ce69fa9c8481\whatif\source\line-bot\staff-target.txt, C:\Users\cyc39\AI-Lanes\a5\repo\ops\_tmp\drill-b5fd751947974e1990d4ce69fa9c8481\whatif\source\line-bot\richmenu-id.json, C:\Users\cyc39\AI-Lanes\a5\repo\ops\_tmp\drill-b5fd751947974e1990d4ce69fa9c8481\whatif\fxwash\eHank.mdb, C:\Users\cyc39\AI-Lanes\a5\repo\ops\_tmp\drill-b5fd751947974e1990d4ce69fa9c8481\whatif\local-state\tunnel_events.jsonl, C:\Users\cyc39\AI-Lanes\a5\repo\ops\_tmp\drill-b5fd751947974e1990d4ce69fa9c8481\whatif\source\line-bot\public_base.txt, C:\Users\cyc39\AI-Lanes\a5\repo\ops\_tmp\drill-b5fd751947974e1990d4ce69fa9c8481\whatif\source\.env, C:\Users\cyc39\AI-Lanes\a5\repo\ops\_tmp\drill-b5fd751947974e1990d4ce69fa9c8481\whatif\source\secrets\line.json, C:\Users\cyc39\AI-Lanes\a5\repo\ops\_tmp\drill-b5fd751947974e1990d4ce69fa9c8481\whatif\source\data\posted-log\20261030.json, C:\Users\cyc39\AI-Lanes\a5\repo\ops\_tmp\drill-b5fd751947974e1990d4ce69fa9c8481\whatif\source\data\leads\list.jsonl, C:\Users\cyc39\AI-Lanes\a5\repo\ops\_tmp\drill-b5fd751947974e1990d4ce69fa9c8481\whatif\task-source\SXJ-Test.xml, C:\Users\cyc39\AI-Lanes\a5\repo\ops\_tmp\drill-b5fd751947974e1990d4ce69fa9c8481\whatif\task-source\Laundry-Backup.xml, C:\Users\cyc39\AI-Lanes\a5\repo\ops\_tmp\drill-b5fd751947974e1990d4ce69fa9c8481\whatif\task-source\A5\AI-Daily-Test.xml".
 [+] restore WhatIf performs zero writes including no pre-restore directory 724ms
 [+] validates all payloads before writing even if Only excludes the damaged payload 642ms
 [+] rejects manifest path traversal and duplicate destinations before any write 571ms
 [+] fails for missing sources and does not create a completed backup 140ms
 [+] keeps the newest 14 completed backups, preserves unknown folders, and has unique minute collisions 18.17s
 [+] rejects overlapping source/backup roots and a pre-restore directory inside a restore target 410ms
 [+] rejects out-of-scope task names and malformed XML 104ms
 [+] rollback outputs a plan only and rejects a missing tag 195ms
What if: Performing the operation "Register daily 03:30 backup: -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\Users\cyc39\AI-Lanes\a5\repo\ops\backup-sxj-live.ps1" -Root "C:\Users\cyc39\AI-Lanes\a5\repo\ops\_tmp\drill-b5fd751947974e1990d4ce69fa9c8481\register-preview\source" -LocalStateRoot "C:\Users\cyc39\AI-Lanes\a5\repo\ops\_tmp\drill-b5fd751947974e1990d4ce69fa9c8481\register-preview\local-state" -MdbPath "C:\Users\cyc39\AI-Lanes\a5\repo\ops\_tmp\drill-b5fd751947974e1990d4ce69fa9c8481\register-preview\fxwash\eHank.mdb" -BackupRoot "C:\Users\cyc39\AI-Lanes\a5\repo\ops\_tmp\drill-b5fd751947974e1990d4ce69fa9c8481\register-preview\backups"" on target "\SXJ-Live-Daily-Backup".
 [+] register-backup-task WhatIf never reaches Register-ScheduledTask 359ms
Describing A5 additional boundary and scheduler contract checks
 [+] rejects a junction at secrets or data before enumerating files 278ms
 [+] rejects a destination junction before pre-restore creates files 540ms
 [+] backs up and restores a non-ASCII filename and literal wildcard brackets 661ms
 [+] the native scheduler inventory only exports the three allowed name prefixes (all native calls mocked) 502ms
What if: Performing the operation "Snapshot existing files/tasks, then restore verified backup" on target "scheduled-task:\SXJ-Test, scheduled-task:\Laundry-Backup, scheduled-task:\A5\AI-Daily-Test".
 [+] native task restore WhatIf never queries or registers real tasks 566ms
 [+] can restore the pre-restore snapshot of existing files a second time 661ms
 [+] native task restore handles an absent nested folder and verifies meaningful XML (all providers mocked) 867ms
 [+] does not call a wrong-action scheduler readback verified 815ms
 [+] rejects password-based task principals before overwriting any destination 888ms
 [+] rejects an unresolved old local account SID before writing 844ms
 [+] runbook process selection excludes similarly named directories, editors and Python -c 131ms
Describing A5 backup task action contract (in-memory CIM fixtures only)
 [+] normalizes paths with spaces and trailing slashes before saving task arguments 332ms
 [+] rejects wrong executable, account or daily interval in scheduler readback 214ms
 [+] supports the explicit CurrentUser interactive account without storing a password 103ms
A5_DRILL elapsedSeconds=32.504 root=C:\Users\cyc39\AI-Lanes\a5\repo\ops\_tmp\drill-b5fd751947974e1990d4ce69fa9c8481 realSchedulerWrites=0 livePathOperations=0
Tests completed in 32.73s
Passed: 28 Failed: 0 Skipped: 0 Pending: 0 Inconclusive: 0
A5_TEST_RESULT total=28 passed=28 failed=0
```

Python independent readback (exit 0):

```json
{
  "status": "PASS",
  "synthetic_only": true,
  "formal_rto": "UNMEASURED",
  "pester_total": 28,
  "pester_elapsed_seconds": 32.504,
  "drill_root": "C:\\Users\\cyc39\\AI-Lanes\\a5\\repo\\ops\\_tmp\\drill-b5fd751947974e1990d4ce69fa9c8481",
  "restored_files_verified": 12,
  "restored_bytes_verified": 1045,
  "pre_restore_payloads_verified": 12,
  "pre_restore_bytes_verified": 1031,
  "sha256_and_size_all_equal": true,
  "native_scheduler_writes": 0,
  "live_path_operations": 0,
  "backup_directory": "C:\\Users\\cyc39\\AI-Lanes\\a5\\repo\\ops\\_tmp\\drill-b5fd751947974e1990d4ce69fa9c8481\\roundtrip\\backups\\20261030-0141",
  "pre_restore_directory": "C:\\Users\\cyc39\\AI-Lanes\\a5\\repo\\ops\\_tmp\\drill-b5fd751947974e1990d4ce69fa9c8481\\roundtrip\\pre-restore\\pre-restore-20261030-0141"
}
```
