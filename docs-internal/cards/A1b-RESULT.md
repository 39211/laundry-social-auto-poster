# A1-b 唯讀評估結果：3 檔建議封存，2 檔建議配套純函式

- 評估日期：2026-10-30，Asia/Taipei；資料完整性核對時間：03:30:57 +08:00。
- 結果：**本卡評估完成；所有處置均為建議，未搬檔、補 helper、修改週報或修復發布。**
- 店主要求：依 `docs-internal/cards/A1b-suspect-files-review.md` 評估五個 SUSPECT；只新增本檔，現役目錄唯讀，不做 commit。
- 工作目錄：`C:\Users\cyc39\AI-Lanes\integ\repo`，分支 `integration/20261030`，HEAD `63d8c8a6d774ccae98055d7f81593a093a026a26`。
- 現役來源：`C:\Users\cyc39\Documents\New project 5`；讀取時 HEAD `766102c4ad5988ea0c8724925129ac5619a0dbda`。五個 SUSPECT 仍全部為 `??`。

## 開工卡與範圍

| 欄位 | 本卡定義 |
| --- | --- |
| Outcome | 五檔逐一說明用途、來源線索、現行實作、三選一建議及事故關聯；釐清 YT 台帳與 B3 口徑 |
| Owner | 店主／Claude 總指揮 |
| Maker | 本席 Codex，未派出其他 Agent |
| Checker | 本席交叉核對當前原始碼、Git 歷史、限定台帳及記憶體測例；總指揮獨立驗收尚未進行 |
| Authority | 只新增本檔；現役五檔、相關正式腳本及卡片指定 `youtube-log`／`scheduled-log` 唯讀 |
| 驗收證據 | 下列來源行號、Git commits、smoke 原始輸出、14 個現行判斷測例、B3 限定來源重算及 SHA-256 核對 |

已取得 Obsidian 首頁、讀取 live Current-Context、執行唯讀戰情板與 Vault 搜尋。D 槽兩個必要目錄均存在，C 槽餘裕約 132 GB。載入 Graphify 與 `sxj-publish-ops`；整合工作樹沒有既有圖，依本卡單一輸出限制未建圖。沒有執行發布入口、生成作業、平台 API、OAuth、排程、服務操作或 Git 寫入；沒有整支執行或 dot-source 正式腳本，僅抽取下述指定邏輯在記憶體驗證。

以下「現役」路徑均相對於上述 New project 5；其他相對路徑指整合工作樹。現役讀取沒有擴展到 B3 的其他資料目錄、客戶資料或憑證，因此下述 B3 重算是**指定兩種台帳的貢獻**，不是整份 B3 的全來源重跑。

## 五檔建議表

選項沿用卡片：(a) 補齊正式 helper；(b) 原樣入 Git 並註明待辦；(c) 原樣搬到 `D:\AI-Lanes-work\_archive\suspect-20261030\`，不入 Git。**本次沒有執行任何選項。**

| 檔案 | 判定／用途 | 建議 | 工作量及風險 | 與 10/26–10/29／YT W43 的關聯 |
| --- | --- | --- | --- | --- |
| `scripts/reel-v3/run_manifests.ps1` | 指定 manifests 的序列 I2V 重生工具；有失敗仍固定 `exit 0` | **(c)** | 封存保留原檔。只修回傳碼約 2–5 行；若正式化，另需約 15–30 行處理輸入、子程序結果及成品驗證，另計測試；會觸發生成，風險較高 | 抽查正式入口未見呼叫；沒有此次事故的直接因果證據 |
| `test/agyImageFallback.test.ts` | AGY 4:5 要求與 PS smoke 的 Vitest 外層；對應路線已退役 | **(c)** | 恢復原 helper／fallback 約 80 行會恢復已移除的 Google 路線，與現行 GPT-only 實作衝突 | 是過期測試，無證據造成 10 月發布中斷 |
| `test/ps-agy-aspect.smoke.ps1` | AST 擷取 AGY 兩個 helper，測比例、路徑與參考圖字串 | **(c)** | 與前檔成對封存；沒有理由為此重開 AGY | 同上；實跑停在擷取失敗，沒有呼叫 AGY |
| `test/ps-youtube-live-reel.smoke.ps1` | AST 擷取 live Reel 純判斷，測 JSON 陣列展開與排除條件 | **(a)** | 與下一檔共用一次修改：正式 PS 約 25–40 行抽取兩個純 helper、替換呼叫點；測試校整約 0–10 行。功能風險低，發布腳本整合風險仍須驗收 | 現行 inline 判斷已有效；補 helper 是補回歸保護，不能宣稱會修復中斷或確認公開狀態 |
| `test/youtubeUpload.test.ts` | 上述 PS smoke 的 Vitest 外層，另鎖定 helper 與呼叫形狀 | **(a)** | 同一組 25–40 行，不重複計工；避免為滿足字串斷言而改變既有判斷語意 | 同上；缺 helper 造成測試失配，尚無事故因果證據 |

不選 (b)：`package.json:59` 的測試入口是 `vitest run`；兩份 `*.test.ts` 的第一個測例會直接找正式 helper。只加「待辦」檔頭不會跳過測例，會把確定失敗的測試帶進一般測試。runner 的成功回傳問題也不會因註解消失。

## 1. run_manifests.ps1

**用途與缺陷。** 現役 `scripts/reel-v3/run_manifests.ps1:16` 拆分名稱清單，`:18`／`:19` 固定 Hermes Python 與 `wt-reel-v2` 的 `generate_shot.py`；依序跳過既有片段、等待首幀，並追加 `JobDir/regen.log`。`:28` 缺 manifest 會累計失敗，`:35` 呼叫生成器，`:37`／`:38` 僅按輸出檔存在判成功，`:42` 卻一律 `exit 0`。亦未以子程序退出碼、檔案有效性或視訊解碼證明生成成功。本次只做靜態及 AST 檢查，未執行會生成／寫 log 的本體。

**現行對應。** Git 已追蹤 `scripts/reel-v3/run-soleso-clips.ps1` 等題材專用序列 runner。`51061994`（2026-09-15）新增 SOLESO runner，其序列防重複、固定生成器路徑與續作寫法和本檔相近；該正式 runner `:69` 也固定 `exit 0`，因此「同類 runner 已入 Git」不能當品質放行理由。抽查 `produce_day.py`、三支題材 runner、`daily-generate.ps1`、`schedule-ahead-daily.ps1`、`youtube-upload.ps1`，未見 `run_manifests` 引用；這不是全機排程或歷史執行稽核。

**可能作者。** 本檔沒有可得的 Git 歷史。檔案建立時間為 9/17 00:53 台北；相鄰 `51061994` 的 Git Author 是 `39211`，commit body 記載 `Co-Authored-By: Claude Opus 5`。相似內容支持「可能出自同批 Claude Opus 5 影片工作」的推測，不能證明本檔作者。Vault 對 `run_manifests` 及 helper 名稱無直接命中。

**建議 (c)。** 保留作為一次性重生工具的歷史材料，不把它直接當正式可監控入口；封存時保留 `scripts/reel-v3/` 相對路徑及下方雜湊。沒有證據把它的假成功回傳，與 10/26–10/29 發文中斷連成同一次事故。

## 2. agyImageFallback.test.ts

**用途與現況。** 現役 `test/agyImageFallback.test.ts:27` 起要求 `Get-AgyGenerateImageAsk`、`Invoke-AgyImageFallback`、`AspectRatio '4:5'` 與 AGY 呼叫點；`:43` 起在 Windows 執行 PS smoke。這兩個 helper **以前確實存在**：Git `1845c953` 引入，`8088792b`（2026-09-27）連同 AGY fallback 整段刪除。後者 commit 明記 9/26 店主 GPT-only 規則。故 A1 所見「目前缺 helper」正確，但不足以把這兩檔判成從未配套的半成品。

**現行正式功能。** `scripts/generate-missing-images.ps1:55` 的 `Get-PortraitFourFiveVerdict` 仍檢查 4:5 ±0.01，`:65` 以 ffprobe 取尺寸，`:288`–`:295` 檢查候選並重試。`:300`–`:305` 在 Codex 無圖時告警並 `exit 1`，不走 Google/Grok fallback。`:289`–`:292` 在量不到尺寸時會接受候選，`:319`–`:324` 對存下來的異比例圖告警；這些是現行檢查行為，不代表保證每張成品都已通過尺寸量測。

**可能作者。** 本檔建立於 9/12 23:06 台北；Git `d831a4a6`、`1845c953` 的相鄰修正登記 `39211`／Claude Opus 5，內容涉及 AGY 錯誤比例與 4:5 修復，故可能出自同一輪工作。未追蹤測試本身沒有 commit／作者證據，不能直接署名。

**建議 (c)。** 這是已退役供應路線的殘留測試。當前仍有 4:5 檢查，不能把「AGY helper 已刪除」解讀為「4:5 沒有實作」。恢復舊 backend 並非本次中斷修復。

## 3. ps-agy-aspect.smoke.ps1

**用途。** 現役 `test/ps-agy-aspect.smoke.ps1:24` 解析正式腳本 AST，`:39`／`:40` 找兩個 AGY helper，之後僅檢查函式字串並呼叫產生要求字串的純函式，沒有執行 AGY fallback 本體。

**實測。** 在現役來源上讀取式執行，原始輸出如下；以 Python subprocess 取得的 native exit code 為 **2**：

```text
EXTRACT_FAIL=Get-AgyGenerateImageAsk not found
```

**作者、正式功能及建議。** 本檔與前一份測試同於 9/12 23:06 建立，內容互相配套；可能作者線索、GPT-only 退役證據及 4:5 現行實作同前節，作者仍未確證。選 **(c)**，與 TS 檔成對封存；這次失敗代表過期測試目標不存在，不能當 10/26 發文中斷的根因。

## 4. ps-youtube-live-reel.smoke.ps1

**用途與缺口。** 現役 `test/ps-youtube-live-reel.smoke.ps1:41`／`:42` 要找 `Test-LiveReelPostedEntry`、`Test-LiveReelHasSlot`；`:55` 起還要求正式入口改由 helper 判斷。當前正式腳本只有 `Write-Log`、`Publish-Site`、`Show-Toast` 三個函式。原始輸出與 native exit code **2**：

```text
EXTRACT_FAIL=Test-LiveReelPostedEntry not found
```

**正式功能已有。** `scripts/youtube-upload.ps1:94` 先 `ConvertFrom-Json` 賦值，再於 `:95` 包成陣列；`:102`–`:106` 分別判斷 slot 2／3，只接受 Instagram、非 dry-run、success/posted、reel。陣列展開修復早在 Git `5bb9ed5a`（2026-08-03）完成，非等待本測試補 helper 才能使用。本次只取這四行 inline 判斷放入記憶體，live、posted、dry-run、FB、image、failed、null、錯 slot、混合 JSON、單物件、空陣列共 **14/14** 通過，沒有執行正式腳本本體。

**可能作者。** 檔案建立於 9/13 23:10 台北，測試註解標示 F20／fish-1 sister，與同時建立的 TS 測試成對。`5bb9ed5a` 登記 Codex Automation，body 記載 Claude Fable 5，但它是 8 月正式修正的歸屬，**不是這份 9 月測試的作者證明**。Git `--all -S Test-LiveReelPostedEntry` 在正式腳本無命中；Vault tasks／handoffs 對兩個目標 helper 亦無直接命中，故只能保留作者未確證。

**建議 (a)。** 將現行邏輯抽出兩個純 helper 並接回正式 slot loop，保留 assign-then-wrap、平台、狀態、媒體及 dry-run 語意，再跑原 smoke 與等價測例。兩份 YT 測試合計約 25–40 行正式碼，不增加新的上傳路徑。這能修復測試配套，不能證明平台已公開，也不能修復產站失敗。

## 5. youtubeUpload.test.ts

**用途。** 現役 `test/youtubeUpload.test.ts:27` 起鎖定上述兩個 helper 與正式呼叫點；`:50` 起執行 PS smoke。它同時保護有價值的行為與很具體的原始碼字串，應避免只為滿足字串比較而引入多餘分支。

**正式功能與作者。** 正式腳本當前已用 inline 實現被測行為，但 helper 契約未實現；現行 14 個測例已驗證。建立時間與前檔相同，五個 SUSPECT 檔在可得 `git log --all -- <五檔>` 都沒有歷史；因此成對作者仍未確證，不能把 Git 邊上的署名當本檔署名。

**建議 (a)。** 與前檔共用同一組純函式抽取；合計工作量前節已計。驗收須同時確認現行行為等價及兩份測試可用。本卡沒有執行 Vitest／全庫測試；已實跑的下層 PS smoke 為預期的缺 helper 失敗，不宣稱 TS 測試通過。

## YT 路徑與台帳口徑

### 現役有兩條上傳路徑

1. **當日 live Reel 補上傳：** `scripts/youtube-upload.ps1:87` 讀當日 posted-log；上述 inline 條件通過後，`:113` 執行 `post-youtube --date ... --slot ... --live`。`package.json:60` 對應 `src/postYouTube.ts`；`uploadShort` 在 `:225`–`:245` 先檢查同 slot 是否已有 YT 記錄，再驗證 IG live Reel，`:269` 請求 public，上傳後 `:280`–`:288` 寫入 YT 台帳。
2. **平台提前排程：** `scripts/schedule-ahead-daily.ps1:159`–`:160` 對 slot 2／3 執行 `schedule-youtube --live`；`package.json:61` 對應同一 TS 的 `--schedule-ahead`。`scheduleYouTubeShort` 在 `src/postYouTube.ts:349` 檢查雙平台核准，`:363` 設定原 slot 時間加 45 分鐘，`:398`–`:421` 以 private + publishAt 上傳，寫入 video ID、uploaded_at、scheduled_publish_at、`video_status: scheduled`。

兩路共用 `data/youtube-log/<date>.json`，同 slot 已有記錄時都略過；提前上傳不必等當日 IG live。`--live` 是目前兩路必要旗標，Git `e859d595` 已同步修改這兩支 PS 呼叫。這只能證明原始碼接線，沒有檢查 Windows 排程的當下參數或實際執行。

`youtube-upload.ps1:46`–`:69` 另有產站／publish-pages 副作用，`:148` 會呼叫，故本卡未直接執行整支腳本。`:129` 仍以 stdout 出現 `video_id` 記「uploaded」；這個文字不等於平台公開驗證。Vault `04-Tasks/2026-08-19-laundry-youtube-canonical-gate.md:18` 聲稱已不再以該文字判成功，但與當前來源不同，只能當歷史／候選記錄，不能拿來證明現役已具備該驗收。

### 兩種台帳不能互換

| 台帳／欄位 | 這次實讀內容 | 可以證明的事／限制 |
| --- | --- | --- |
| `data/scheduled-log/*.json` | 54 檔、113 列，platform **全部 facebook**；107 列無 status，6 列 uncertain；YT 列 0 | 這批是 Meta 排程登記，不能按列數推 YT 排程或 YT 實發；無 status／有 scheduled ID 也不代表公開 |
| `data/youtube-log/*.json` | 53 檔、58 列；22 列無 video_status，1 列 published，35 列 scheduled | 混合即時上傳與提前上傳；video_id 表示本機記下 API 回傳的影片身分，不是當下可公開觀看證據 |
| `uploaded_at` | 上傳完成時刻，提前排程通常早三天 | 應用於「上傳完成」統計，不能直接當公開日 |
| `scheduled_publish_at` | 希望平台公開的 UTC 時刻 | 應用於「預定公開」歸週；到期不會使本機此欄或 video_status 自動成為公開證明 |
| `video_status`／公開時間 | W43 四列仍為 scheduled，沒有公開時間／公開確認 | 公開結果待查；既不能推成未發，也不能把到期當已發 |

### W43「排程 7／實發 0」的裁決

**「已證實 W43 七支都沒公開」不成立。指定來源只能重現四筆預定公開，以及零筆本機公開成功確認；七筆的原始來源尚未確證。**

W43 期間為台北 `2026-10-19 00:00` 至 `2026-10-26 00:00`（不含）。四筆都屬 slot 2，預定 21:15 公開：

| 現役來源（video_id 所在行） | video_id | 上傳時間（台北） | 預定公開（台北） | 本機狀態 |
| --- | --- | --- | --- | --- |
| `data/youtube-log/2026-10-19.json:5` | `YgRlFBdPYa0` | 10/16 21:41:06 | 10/19 21:15 | scheduled |
| `data/youtube-log/2026-10-20.json:5` | `v0_YcbbmG9Y` | 10/17 21:40:52 | 10/20 21:15 | scheduled |
| `data/youtube-log/2026-10-21.json:5` | `Qy1-aADQyU4` | 10/18 21:40:50 | 10/21 21:15 | scheduled |
| `data/youtube-log/2026-10-22.json:5` | `kqh0xACx_h4` | 10/19 21:41:01 | 10/22 21:15 | scheduled |

- 按預定公開時刻歸週：**4** 筆；按 uploaded_at 歸週：**1** 筆。兩種數字不能混用。
- 現有 youtube-log 的最後日期檔為 10/22；10/23–10/29 沒有對應日期檔。這是台帳缺項，不足以證明平台沒有影片或沒有執行。
- 整合版 `docs-internal/cards/B3-RESULT.md:118`–`:130` 內嵌的是 **W44** 樣本，YT 為 `0／0／0`，並非 W43 的 `7／0`。不能把卡片引述的數字當成已取得的原報表。
- 抽取當前 `scripts/weekly-report.py` 的 `parse_time`、`first_time`、`publication_metrics`，只接本卡指定兩類真實來源，在記憶體重算得 `scheduled=4, published=0, failed=0, uncertain=0`，與逐筆獨立加總相符。**沒有把未讀的 posted-log、feature-posted-log、approved-log 當成已確認為空。**
- B3 `scripts/weekly-report.py:179` 亦讀其他台帳，`:234`–`:247` 按排程時間與成功狀態分計；`:244` 才把無排程／無狀態的舊 YT 上傳列為本機成功。四筆仍是 scheduled，因此 published 為 0 符合目前演算法。**沒有證據判定這個 0 是加總算錯；若把它解釋為線上零公開，則結論過度。**
- B3 已在 `B3-RESULT.md:165` 寫明「0＝無該類記錄，不代表線上無發文」。仍建議將欄位顯示為「公開已確認／到期未確認」，避免店主把帳面 0 當實際失敗率。七筆則需總指揮取回原 W43 報表、時間戳、實際 data-root 與來源集合，比對是否有其他台帳貢獻或快照差異，才能裁定。

### B3 另有已重現的跨週時間風險

`scripts/weekly-report.py:210` 以 `published_at → created_at → at → uploaded_at` 選實發時間；當提前上傳列後來變成 `video_status: published`，但未補公開時間，會用較早的 uploaded_at 歸週。記憶體合成資料設為「10/16 上傳、10/19 預定公開、狀態 published、沒有 published_at」，結果如下：

| 合成情境 | W42 published | W43 published |
| --- | ---: | ---: |
| 只有上述三個時間／狀態欄位 | 1 | 0 |
| 明確補入 10/19 的 `published_at` | — | 1 |

這證明 B3 可能把**公開時間未知**的排程影片計到上傳週；應以真正公開時間歸週，沒有時間則保留未知，避免用上傳時間冒充。這是合成測例識別的風險，**不是 W43 現有四列造成 0 的原因**，因為四列現在仍是 scheduled。本卡未改 B3。

## 與 10/26–10/29 中斷的因果界線

Vault `04-Tasks/2026-10-29-Claude-私享家總計畫整合與現役主幹盤點.md:58` 記載的事故鏈是 `.git/index.lock → publish-pages 失敗 → 公開站未更新 → 圖片 404 → FB/IG 發文失敗`。這是既有調查記錄；本卡未擴大讀取產站／補發原始日誌或平台，因此沒有獨立重驗整條事故鏈。

這五檔沒有可證明的直接因果關係：AGY 測試所屬功能已退役；YT 測試期待的純函式雖缺，但現行判斷已有效；`run_manifests` 的假成功確實存在，卻沒有在抽查發布入口找到它。YouTube live 補上傳依賴 IG 成功 Reel，所以上游 FB/IG 中斷**可能**讓它略過，這是程式可解釋的下游影響，尚非該四日執行日誌的實證。

另須注意時間順序：W43 在 10/26 前已結束，且這次最後一筆 YT 台帳記錄的 uploaded_at 是 10/19。不能用「10/26 才開始的事故」單獨解釋較早的排程與狀態缺口，也不能把補 helper 當成恢復發布的措施。

## 驗證、完整性與下一步

本次實際驗證：五支 PS（runner、兩支 smoke、兩支正式入口）AST 語法錯誤均 **0**；兩支既有 smoke 缺 helper，native exit 均 **2**；現役 YT inline 判斷 **14/14** 合成測例通過；B3 指定來源重算與獨立逐筆加總一致；B3 跨週合成重現及補 published_at 對照通過。沒有執行完整 Vitest、生成器、上傳或公開站發布，不能宣稱整體發布驗收通過。

5 個 SUSPECT＋12 個相關正式來源＋107 個指定 JSON 台帳，合計 **124 檔**，SHA-256、大小及精確 mtime_ns 與讀取基線一致；兩個台帳目錄的檔案集合亦一致。寫入本報告後於 03:35:58 +08:00 再核對，124 檔仍一致。107 檔台帳 metadata manifest 的 SHA-256 為 `47e45c93dbaa2bd0a4e7606b1f6c0feb1acc25a04702122bcb7f9a6913108525`（按 youtube-log、scheduled-log 次序及檔名排序，含 path／sha256／size／字串 mtime_ns，JSON sort_keys、無空白）。行號核對工具曾因 PowerShell 傳遞內嵌引號發生 Python 語法錯誤，改用不含內嵌雙引號的搜尋詞後重跑完成；失敗命令未寫檔。

| SUSPECT | SHA-256 |
| --- | --- |
| `scripts/reel-v3/run_manifests.ps1` | `571c3c88138bbb8fa756534be5ddc9a293c4139a2be5c4335a7aaa7ffe6c70a4` |
| `test/agyImageFallback.test.ts` | `9058da42ec73022a734d55ca8be5beafbb960fcbe70feba5e9f601365bba4700` |
| `test/ps-agy-aspect.smoke.ps1` | `031ed98b1dcb697c81bcdfd097b34936ab564247708a12006f9da942b8efaf51` |
| `test/ps-youtube-live-reel.smoke.ps1` | `f3ee5d403c512863016bdd71d4b5c5fff4d8aa03bc50d7b1442b016b7ecc7956` |
| `test/youtubeUpload.test.ts` | `c4d9be1696b04e29c0ecec2313a3aa62a911ce91fe2df00e99281f3642df4f61` |

正式 YT PS 的 SHA-256 為 `d6b9c08e5d45266af3a4ffdc78cca4413b8fc759f10e3bc597bdb79253576eed`；產圖 PS 為 `0960ac6c3004fa77a1c3541c799d3344eeb4d6f725836691a1455ba73de25ae9`；B3 `weekly-report.py` 為 `e941a580885e8827fde0c20f93f7e2c5c528b94963ecebd63b1fc29d18ec1a14`。

總指揮下一步建議，按處置順序：

1. 驗收本報告後，將 runner 與兩個 AGY 過期測試按 (c) 保留相對路徑及雜湊封存；本卡沒有搬移，也沒有把它們入 Git。
2. 在隔離候選配套兩個 YT 純 helper 與成對測試，保持現行條件及提前排程／live 兩路不變，再做原 smoke、14 個等價測例及相關回歸；本卡沒有實作此建議。
3. 取回 W43 `7／0` 原件及來源快照，查明七筆來源；對四個已知影片 ID 做另行授權範圍內的公開狀態查核，先補證據，不按台帳 0 自動重傳。
4. 調整 B3 的公開時間缺失與到期未確認呈現，將合成跨週案例納入驗收；10/26–10/29 事故則沿既有產站／發布修復線驗證，分開裁決。

交卷核對：整合工作樹的 tracked diff 與 staged diff 均為空，HEAD 未變。期間另出現非本卡建立的未追蹤檔 `docs-internal/C6-R11-POS-POSITION.md`，本卡未開啟、修改或移除；本卡建立的檔案只有本報告。

留痕即本檔。依本卡「只新增 A1b-RESULT.md」限制，未執行會另寫 Vault 的 `ai_vault.py manual`、未更新筆記／戰情板；總指揮可在驗收後補入安全摘要。九格缺項：第 9 格的 Vault 回存未執行，原因是本卡寫入範圍；W43 七筆原始來源及平台公開結果仍未確認，以上均已保留界線。沒有 commit、stage、push 或發布。
