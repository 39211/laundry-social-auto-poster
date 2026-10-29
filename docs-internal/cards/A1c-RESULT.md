# A1-c 結果：live Reel 純 helper 抽取完成，PS smoke 由紅轉綠

- 日期：2026-10-30，Asia/Taipei。
- 依據：`docs-internal/cards/A1b-RESULT.md` 第 4、5 節的建議 (a)。
- 工作目錄：`C:\Users\cyc39\AI-Lanes\integ\repo`；分支 `integration/20261030`；起始 HEAD `8a224d6884a67c8d9ca238aa5bdfa3bd04919d8e`。
- 結果：兩個純 helper 已接回正式 slot loop；原有 14 個 smoke 測例及新增的等價測例通過。**Vitest 未執行：本 worktree 沒有安裝。**

## 開工卡與修改範圍

| 欄位 | 本卡定義 |
| --- | --- |
| Outcome | 抽取 live Reel 判斷而保持既有語意，使指定 PS smoke 可執行，並用同一組 posted-log 樣本比較改前改後 |
| Owner | 店主 |
| Maker | 本席 Codex；沒有派工 |
| Checker | 本席差異覆核、AST 檢查及實跑 smoke；沒有獨立或跨家族複審 |
| Authority | 只修改本 worktree 下述四檔；現役來源唯讀；不做 commit、不上傳 |
| 驗收證據 | 原樣複製 SHA-256、改前紅燈、改後綠燈、100 次等價比較、frozen predicate 與 HEAD 原碼核對、來源完整性及 Git 範圍核對 |

本次只寫入：

1. `scripts/youtube-upload.ps1`：新增 `Test-LiveReelPostedEntry`、`Test-LiveReelHasSlot`，slot 2／3 的呼叫點改用 helper。tracked diff 為 19 行新增、6 行刪除。
2. `test/ps-youtube-live-reel.smoke.ps1`：由指定現役來源原樣複製，再新增一個 legacy 等價測例。
3. `test/youtubeUpload.test.ts`：由指定現役來源原樣複製，內容未改。
4. `docs-internal/cards/A1c-RESULT.md`：本結果與驗收證據。

開工 Git status 為乾淨。已取得 Obsidian 首頁、讀取 live Current-Context、執行唯讀戰情板及 Vault 搜尋；載入 Graphify 規範。這是單檔抽取，沒有另建圖。D 槽兩個必要目錄均存在；C 槽可用空間約 132 GB。

## 實作與語意

`Test-LiveReelPostedEntry($Entry, [int]$Slot)` 只回傳布林值：排除 null、錯 slot、非 Instagram、truthy dry_run 與非 success／posted，最後判斷媒體是否為 reel。保留 PowerShell 原有不分大小寫的比較及 dry_run truthiness；沒有將 Entry.slot 轉成整數，也沒有把字串 `false` 當成布林假。

`Test-LiveReelHasSlot($Entries, [int]$Slot)` 在函式內以 `@($Entries)` 展開已解析的資料，經前述 entry helper 過濾後回傳是否有符合列。呼叫點仍先執行 `$postedParsed = Get-Content $postedPath -Raw -Encoding utf8 | ConvertFrom-Json`，再傳給 `Test-LiveReelHasSlot $postedParsed $slotNumber`，保留 assign-then-wrap。原本在外層的 `$posted` 包裝移入 helper，沒有留下未使用的變數。

AST 檢查顯示，entry helper 沒有命令呼叫，slot helper 只有 `Where-Object` 及 entry helper。兩者不依賴檔案、帳密、時間或外部狀態。

另以 `git show HEAD:scripts/youtube-upload.ps1` 取得改前版本，確認測試中的 frozen filter 逐字包含改前的原 inline 區塊；在記憶體中反向套回這次抽取後，整支腳本文字與 HEAD 相同（正規化換行後比較）。這確認上傳、產站、通知、single-flight 與清理流程沒有其他變動。正式 PS 保留 UTF-8 BOM 與 CRLF；smoke 保留來源的 UTF-8 BOM。

## 紅燈、綠燈與等價驗證

兩個測試從 `C:\Users\cyc39\Documents\New project 5\test\` 讀取並複製；第一次跑 smoke 前，兩份副本與來源逐 byte 相同。正式 PS 當時仍是改前 SHA-256 `d6b9c08e5d45266af3a4ffdc78cca4413b8fc759f10e3bc597bdb79253576eed`。

執行命令（在本 worktree）：

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/ps-youtube-live-reel.smoke.ps1
```

以 Python subprocess 擷取原生退出碼，避免外層 PowerShell 對退出碼的轉譯。改前：

```text
EXTRACT_FAIL=Test-LiveReelPostedEntry not found
native_exit_code=2
```

修改後，Windows PowerShell `5.1.26100.9711` 的實跑結果：

```text
EXTRACT_OK name=Test-LiveReelPostedEntry
EXTRACT_OK name=Test-LiveReelHasSlot
WRAP_OK=ASSIGN_THEN_WRAP
CASE_OK name=legacy-equivalence samples=6 comparisons=100
SMOKE_OK
native_exit_code=0
```

原有 **14/14** 測例通過，涵蓋 success／posted、dry-run、Facebook、image、failed、null、錯 slot、混合陣列、單物件與空陣列。原有最後一行 JSON payload 保持不變，因此保留 TS 外層 smoke 契約。

新增的是 **一個等價測例**：使用六組合成 posted-log JSON 樣本（混合陣列、單物件、空陣列、null、全排除列、大小寫／字串 slot／選填欄位）。每組對 slot 1–4 比較原 inline filter 與新 slot helper，並對其中每列比較原 filter 與新 entry helper，共 **100 次比較、0 差異**；同時檢查兩個 helper 回傳的確是單一布林值。樣本含缺欄位、null 欄位、dry_run 為數字 0 與字串 `false` 等邊界；這些是合成回歸樣本，沒有讀取現役 posted-log。

兩份 PS 的 AST parse errors 均為 **0**；`git diff --check` 通過。smoke 只經 AST 抽取並載入兩個 helper，沒有執行或 dot-source 正式上傳腳本本體。

本 worktree 的 `node_modules/.bin/vitest.cmd` 及 `node_modules/vitest/vitest.mjs` 均不存在。依店主指示沒有安裝套件、借用現役依賴或執行 Vitest；因此不宣稱 `test/youtubeUpload.test.ts` 已實跑通過，也沒有執行全庫測試。

## 完整性與界線

現役三份讀取來源（正式 PS 及兩個測試）在 04:06:42 +08:00 核對 **SHA-256、大小、mtime_ns 全數與開工基線一致**。兩個來源測試仍為未追蹤檔，未修改來源。候選檔雜湊如下：

| 檔案 | SHA-256 |
| --- | --- |
| `scripts/youtube-upload.ps1` | `c0b33f6888c0567fcee60189d838042841405bcb66c8260f751a5ecc51000421` |
| `test/ps-youtube-live-reel.smoke.ps1` | `65685acd64c407793bd049ac2a1e05b3aeed965f0d589ba520d481d2f40d9df7` |
| `test/youtubeUpload.test.ts` | `c4d9be1696b04e29c0ecec2313a3aa62a911ce91fe2df00e99281f3642df4f61` |

複製前的 PS smoke SHA-256 是 `f3ee5d403c512863016bdd71d4b5c5fff4d8aa03bc50d7b1442b016b7ecc7956`；其後的差異僅新增上述等價測例。TS 副本雜湊仍與來源相同。

本卡驗證的是隔離候選的判斷等價及測試配套；沒有執行上傳、產站、平台 API、OAuth、排程或現役腳本，也沒有以此宣稱平台公開狀態或中斷修復完成。未 stage、commit、push、merge 或發布。

交卷核對（04:08:13 +08:00）：最終檔案版本再次跑 smoke，原生退出碼 0，14 個原測例與 100 次等價比較仍全過，最後 JSON 與 TS 外層的預期物件完全相同。Git status 恰為本卡四檔（一個修改、三個未追蹤）；staged diff 為空，HEAD 未變，`git diff --check` 通過；現役三份來源的 SHA-256、大小、mtime_ns 及限定 Git status 再核對均未變。

留痕即本檔。九格缺項：第 9 格的 Vault 回存未執行，因店主本卡明定只寫上述四檔；沒有另寫 Vault、更新戰情板或建立其他輸出。
