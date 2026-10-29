# A7 每日圖文發布管線可靠性：實作與驗證

## 開工卡

- Outcome：只在 A7 指定檔案補上 stale git lock 清理、跨程序互斥、補發異常告警與去重；隔離 smoke 先紅後綠。
- Owner：店主；契約：`A7-publish-pipeline-reliability.md`；maker：本次 Codex；checker：同家族 Codex strict-reviewer 唯讀複審（非跨家族），測試由 maker 執行。
- Authority：僅本 worktree 的卡片白名單；不 commit、不碰現役寫入、不真發布、不註冊排程、不發 LINE、不讀 secrets。
- 證據：現役 `2026-10-29.log` 唯讀，起始 SHA-256 `b4093b3e60a2941e8bcbe8b4525a95fd1521117a50c96c925d11f76a70938360`；隔離 PowerShell smoke、差異檢查。
- 做法：先重現缺少保護，再實作共用鎖與告警，最後檢查既有時窗／哨兵行為與部署限制。
- 留痕：本次僅准修改卡片檔案，所以任務紀錄保存在本檔，不另寫 Vault。Graphify 技能與 ADOPTION 已讀；此 worktree 無既有圖，不新增超出白名單的圖檔。

## 完成結果

本 worktree 的候選修補與隔離驗證完成；未部署。只變更下面 6 個白名單檔案，沒有修改 TS、現役資料、排程或憑證，也沒有 stage、commit、push、真發布或發 LINE。

| 檔案 | 差異 |
|---|---|
| `scripts/_pipeline-lock.ps1`（新） | `Remove-StaleGitLock`：鎖超過 10 分鐘、查不到命令列含 repo／gitdir 路徑的 git.exe 才刪，記錄 UTC mtime；支援 worktree 的 .git 指標。程序清單查詢失敗、命令列不可讀、新鎖與 reparse 鎖均保留。`Enter-PipelineMutex`／`Exit-PipelineMutex` 使用 `Global\sxj-publish`，預設等 600 秒，逾時記錄並 exit 75；異常持鎖程序終止後可接手。 |
| `scripts/catchup-publish.ps1` | 載入 helper，在共用 mutex 內先清舊 git 鎖，再走原有自癒、產站、推站與發文流程，finally 釋放。等待後重讀台北時間。產站／推站失敗即 exit 2，不再接著 post-current-slot。finally 統一檢查異常，包含沒有 approved-log 等提早離開路徑。 |
| `scripts/daily-generate.ps1` | 使用同一 mutex，從清舊鎖、既有 git 檢查一直涵蓋各生成／推站分支；間接呼叫 generate-missing-images 與 Codex 也可能產站，故不能只鎖 Publish-Site。finally 釋放。 |
| `test/ps-stale-git-lock.smoke.ps1`（新） | 8 個隔離案例，使用真檔案／mtime，僅 stub git 程序清單。 |
| `test/ps-pipeline-lock.smoke.ps1`（新） | 28 個案例，含真 PowerShell 子程序互斥、exit 75、abandoned mutex、告警、每日去重、成功清零、跨午夜／停機日、4h 邊界及 daily 分支。 |
| `docs-internal/cards/A7-RESULT.md`（新） | 開工卡、證據、紅綠輸出、複審與部署／回復說明。 |

`publish-sentinel.ps1` 與 `_watchdog.ps1` 均已讀；兩者沒有直接 generate-public-site／publish-pages，符合卡片的「若也會產站或推送」條件之外，因此保持原檔。Sentinel 以另一 PowerShell 呼叫 catchup，子程序自行持鎖；若父程序先持同一鎖再等子程序，反而會互等。

## 事故原貌與哨兵判讀

- 指定現役 log `C:\Users\cyc39\Documents\New project 5\output\catch-up-logs\2026-10-29.log` 只讀；開工及最後複核 SHA-256 均為 `b4093b3e60a2941e8bcbe8b4525a95fd1521117a50c96c925d11f76a70938360`。
- 原始 log 第 1494 行是 index.lock File exists；1523 行記 publish-pages failed；1524 行卻明寫 posting continues；1530 行是 slot-01.png 的公開 URL 404。整份 10/29 log 有 5 次頂層 index.lock fatal、6 次 errno -4094。這些是本次直接讀到的證據。
- 14:00 的 UNKNOWN 是 `docs/rss.xml`（2809–2812 行）；後續還有歷史文章、copyfile、20:43 與 20:50 的 llms-full.txt。不能把所有 UNKNOWN 都確診成同一種互鎖，也沒有藉這次隔離 smoke 宣稱原機 I/O 問題已根治。
- 哨兵 `scripts/publish-sentinel.ps1` 依 posted-log 檢查每個 slot 的 FB／IG，success／posted 且非 dry_run 才算；uncertain 只提示人工確認，不當缺格自動重送。雲端 IG 缺件先 sync，再讀帳。缺格會寫 MISSING、show toast、執行 catchup，重新讀帳後仍缺就寫 STILL MISSING 並再 show toast（原碼第 269–318 行）。
- 哨兵的 `Show-Toast` 呼叫 Windows ToastNotificationManager；toast API 失敗只追加 `Toast failed` 到 log。它沒有 staff_notify／LINE，也沒有「店主已看到」的回執。`_watchdog.ps1` 只檢查維護抑制令牌、重新啟用停用的 Laundry 任務與 toast，不產站也不推站。
- 所以程式能解釋「缺格偵測只落在檔案與桌面通知，補發照樣被 git 鎖擋住」這個缺口；單憑程式與這份 catchup log，無法判定四天中哨兵是否每次執行、Windows 是否顯示 toast 或店主是否看到。卡片的四天事故與 10/25 鎖檔起點視為任務背景，本次沒有冒稱另查四天平台／排程實況。

## 告警介面、狀態與代價

- 現有可用介面是 `line-bot/staff_notify.py` 的 `group_id()`（讀 staff-target）與 `_post_to_group(gid, text, retry_key)`（原碼第 341、438 行）；沒有獨立 CLI。保留既有函式送原文，不借用會套上「客人詢問」版型的 push_group，也不建立假的客戶 inbox／handoff。
- catchup 以固定 Python 3.14 子程序載入該 repo 的 staff_notify，先在子程序設定 `LAUNDRY_REPO_ROOT`，訊息與路徑透過 ASCII JSON stdin 傳入，沒有 shell 文字插入。`-B` 避免新增 pycache；使用既有群組傳送函式及穩定 retry key，不另外處理 token。
- 任一應發 slot 到自己排定時間 +4h 後，FB／IG 任一缺真成功帳列即告警；遵守 `data/publish-times/<date>.json`，也檢查昨日行事曆，所以 20:30 的 slot 2 在次日 00:30 才到期。沒有改發文時段、4h 補發規則或 optional slot 3 的判斷。
- publish-pages 連敗以 catchup **實際嘗試**為單位，成功才歸零，沒有嘗試不算成功。新日期從先前最近的狀態檔繼承 counter／last_error，因此午夜與停機一天都不中斷；日期的 reasons 則重新開始。新日僅繼承舊 counter 不會自行觸發 pages 告警，須本輪真的再次失敗。
- 每日狀態在 `data/publish-alerts/<date>.json`。同原因先在共用 mutex 內寫入 reserved，再嘗試 LINE，確保同日最多一次；index.lock 依同一原因正規化，其餘依最後錯誤文字雜湊。訊息格式為 `[發布異常] <日期> slot <n> 未發出;原因:<最後錯誤>;看 output/catch-up-logs/<日期>.log`。
- 若推站連敗但各 slot 都有成功帳列，改用「公開站更新連續失敗（各 slot 已有成功紀錄）」避免謊稱已發的 slot 沒發。模組、Python、綁群或傳送介面不可用時，保存狀態並降級 toast；子程序 25 秒上限。
- `delivery=line` 代表既有傳送介面回報接受；沒有群組讀取回執。`reserved` 代表只預留過，`toast-fallback` 代表降級，兩者都不代表 LINE 到達。這是同日同原因最多一次的代價：預留後 crash／傳送失敗當日不再自動嘗試；固定 retry key 也沒有被拿來擴張成新重試流程。
- 本次測試在 Temp 假 repo 放置假的 staff_notify，傳送只寫 fixture 的 line-sends.jsonl，cmd／curl／watchdog 均 stub。**沒有載入現役 staff_notify、讀 secrets 或發出真 LINE。** 所有程序測試使用唯一 a7 mutex 名稱，未爭用現役 Global\sxj-publish。

## 測試紅燈原始輸出

先建立兩支 smoke，再新增實作。兩次缺少 helper 的紅燈，退出碼皆為 1：

```text
CASE_FAIL name=stale-lock-library reason=missing _pipeline-lock.ps1
SMOKE_FAIL
```

```text
CASE_FAIL name=pipeline-mutex-library reason=missing _pipeline-lock.ps1
SMOKE_FAIL
```

只有 lock helper 完成、尚未實作告警時，pipeline smoke 的原始輸出如下（exit 1）。當時也發現 fixture wrapper 未明確轉送 LASTEXITCODE，已修成 `exit $LASTEXITCODE`；最後退出碼證據以綠燈版為準：

```text
CASE_OK name=second-process-waits-for-mutex 
CASE_OK name=timeout-exits-75-and-logs exit=75
CASE_OK name=waiter-enters-after-release 
CASE_OK name=finally-releases-after-exception 
CASE_OK name=abandoned-mutex-recovered 
CASE_FAIL name=expired-window-alert-sends-once exit=0
CASE_FAIL name=same-day-same-reason-deduplicated 
CASE_FAIL name=site-failure-blocks-posting-and-returns-nonzero 
CASE_FAIL name=consecutive-publish-pages-failures-persist 
CASE_OK name=first-pages-failure-before-expiry-does-not-alert 
CASE_FAIL name=second-pages-failure-before-expiry-alerts 
SMOKE_FAIL
```

複審新增反例也先紅，再改實作。下列為對應失敗行的原始節錄，該輪其餘既有案例為綠、整體 exit 1：

```text
CASE_FAIL name=second-failure-across-midnight-alerts 
SMOKE_FAIL
```

```text
CASE_FAIL name=offline-day-does-not-reset-failure-streak 
SMOKE_FAIL
```

## 最終綠燈原始輸出

Windows PowerShell 5.1，執行 `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/ps-stale-git-lock.smoke.ps1`，exit 0：

```text
CASE_OK name=old-zero-byte-lock-removed-and-mtime-logged
CASE_OK name=one-minute-lock-preserved
CASE_OK name=matching-git-commandline-preserves-old-lock
CASE_OK name=slash-and-case-normalized-process-match
CASE_OK name=unrelated-git-does-not-block-cleanup
CASE_OK name=inventory-error-preserves-lock
CASE_OK name=unreadable-git-commandline-preserves-lock
CASE_OK name=worktree-gitdir-lock-resolved
SMOKE_OK stale-git-lock cases=8
```

執行 `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/ps-pipeline-lock.smoke.ps1`，exit 0（28 項）：

```text
CASE_OK name=second-process-waits-for-mutex 
CASE_OK name=timeout-exits-75-and-logs exit=75
CASE_OK name=waiter-enters-after-release 
CASE_OK name=finally-releases-after-exception 
CASE_OK name=abandoned-mutex-recovered 
CASE_OK name=expired-window-alert-sends-once exit=2
CASE_OK name=same-day-same-reason-deduplicated 
CASE_OK name=site-failure-blocks-posting-and-returns-nonzero 
CASE_OK name=consecutive-publish-pages-failures-persist 
CASE_OK name=first-pages-failure-before-expiry-does-not-alert 
CASE_OK name=second-pages-failure-before-expiry-alerts 
CASE_OK name=failed-pages-never-post-within-recovery-window 
CASE_OK name=successful-pages-resets-failure-streak 
CASE_OK name=four-hour-window-not-closed-early 
CASE_OK name=four-hour-boundary-alerts-without-success-log 
CASE_OK name=fb-only-and-dry-run-ig-do-not-silence-alert 
CASE_OK name=both-platforms-live-silence-expiry-alert 
CASE_OK name=alert-respects-assigned-publish-time 
CASE_OK name=missing-staff-module-persists-and-toasts-once 
CASE_OK name=generation-failure-blocks-pages-and-post 
CASE_OK name=early-no-approval-exit-still-checks-alerts 
CASE_OK name=evening-window-stays-open-until-next-day-0030 
CASE_OK name=previous-day-evening-expiry-alerts-at-0030 {"text": "[發布異常] 2026-10-29 slot 2 未發出;原因:posted-log 缺少 FB/IG 成功紀錄;看 output/catch-up-logs/2026-10-29.log", "key": "f03eef3b-7596-5619-9f77-3b044a2136c1"}

CASE_OK name=second-failure-across-midnight-alerts 
CASE_OK name=offline-day-does-not-reset-failure-streak 
CASE_OK name=latest-success-state-resets-older-failures 
CASE_OK name=daily-waits-before-any-git-or-site-work 
CASE_OK name=daily-generation-failure-does-not-push 
SMOKE_OK pipeline-lock
```

其他驗證：

- 現有 `test/ps-publish-sentinel-live-slots.smoke.ps1` 全部 66 個 CASE_OK、exit 0；原始結尾如下。它用 fake catchup／npx 與 Temp 帳本，沒有真發文。
- 5 支新增／修改 PowerShell Parser 均為 0 errors，均為 UTF-8 BOM；git diff --check 通過。未改 TS，依卡不跑 npm run typecheck。
- 舊 `test/ps-catchup-publish-due-slots.smoke.ps1` 的 fixture 只 copy catchup、slot-times 與空 watchdog，欠新 helper（原碼第 82–84 行）。它不在白名單內，所以沒有修改；不能把這套舊 harness 列為已通過。本次新增 smoke 已直接覆蓋時窗、指定時刻、缺核准、停止推站後發文等相關行為。
- 嘗試僅在 Temp 補上舊 harness 的新依賴並改用唯一 mutex 名稱時，工具自動政策拒絕該執行指令，只提供 `blocked by policy`，沒有較細理由；該動作沒有執行。沒有改用隱藏／間接方式重送此動作。

```text
CASE_OK name=main-scheduled-after-catchup-advice got=True
CASE_OK name=main-cloud-after-catchup-advice got=True
CASE_OK name=main-cloud-after-sync-advice got=True
CASE_OK name=main-calendar-1-2-no-slot3-gap got=True
CASE_OK name=main-calendar-slot3-still-due got=True
CASE_OK name=main-missing-slot1-still-due-and-hard-fails got=True
CASE_OK name=main-calendar-unreadable-fallback got=True
CASE_OK name=main-assigned-1412-not-due-at-1150 got=True
CASE_OK name=main-assigned-1412-due-at-1430 got=True
CASE_OK name=main-scheduled-log-read-only got=True
SMOKE_OK
{"ok":true,"dry_run_counts":false,"posted_alias":true,"due_1145":"1","due_1215":"1,3","due_2045":"1,3,2","missing_dry_noon":"1,3","live_pairs":"1:facebook","normalized_pairs":"1:instagram,3:facebook","dry_pairs":"","empty_pairs":"","missing_pairs":"1:instagram,3:facebook,3:instagram","missing_dry_pairs":"1:facebook,1:instagram,3:facebook,3:instagram","no_missing_pairs":"","uncertain_pairs":"1:instagram","uncertain_normalized_pairs":"1:facebook,3:instagram","no_uncertain_pairs":"","pair_notice":"slot 1 的 IG、slot 3 的 FB","ig_cloud_sync_missing":false,"ig_cloud_sync_present":true}
SMOKE_ELAPSED_MS=16034
```

## 複審與覆蓋限制

- 依 requesting-code-review 技能，由同家族 Codex strict-reviewer 唯讀複審；不是跨家族確認。複審查核原碼、同類錯誤、Parser、BOM 與 diff，沒有實跑會寫 fixture 的 smoke。它提出跨午夜與停機日連敗問題，均已加紅測試並修正；增量重讀後判 `Ship with risk`，目前無未解的卡內實作 blocker。最終 smoke 是本席實際執行，不冒稱複審席跑過。
- 互斥只保護本卡入口。`scripts/produce-next-reel.ps1:1120`／1155 與 `scripts/youtube-upload.ps1:49`／57 仍直接產站／推站，卡外不改；獨立執行 generate-missing-images 也未新增鎖。不能保證它們與新入口不衝突，因此也不能說所有 UNKNOWN -4094 都已消失。
- 依卡片明定判準清鎖：若 git 只靠工作目錄選 repo、命令列沒有 repo 路徑，此判準無法識別它；新 helper 不宣稱已追蹤 git 的 cwd。程序清單錯誤或命令列不可讀則保留鎖。
- daily 的全流程持鎖可能包含長時間生圖／Codex，其他入口最多等 600 秒便 exit 75，留待下一輪，不跳過產站硬發。
- 真平台發布、現役 errno 重現、真 LINE／toast 到人眼、現役排程狀態均未量測，沒有以隔離綠燈取代現役驗收。

## 部署到現役的步驟（本次沒有執行）

1. 由總指揮在已授權的維護窗，先唯讀檢查 Task Scheduler 所有 `Laundry-*` 的 State、Actions、WorkingDirectory、LastRunTime、NextRunTime，確認真正指向 `C:\Users\cyc39\Documents\New project 5` 的入口。至少核對 Daily-Generate、CatchUp-Publish、各 Publish-*、Publish-Time-Gate、Publish-Sentinel／Afternoon、Watchdog-Patrol、Reel-Production／Produce、Feature-Reel-1400、YouTube-Upload、Day-Audit；名稱以當下清單為準，不只照註冊腳本猜。
2. 同時查工作目錄相關的 powershell／node／git PID 與 command line，尤其正在執行 generate-public-site、publish-pages、post-current-slot、generate-missing-images 的程序。Task 顯示 Ready 不代表它啟動的子程序已結束。不要按 image name 停掉整批程序，也不要強殺在跑的發文。
3. 最安全是所有相關 writer 結束、且離下一個觸發至少 10 分鐘的離峰空窗。依原碼預設可優先評估台北 01:05–06:00（晚間 4h 窗 00:30 後、06:30 生成前），但每 30 分鐘巡邏、補跑與長影片工仍可能在跑，必須重查當下 State／NextRunTime／子程序；此區間不是保證安全的固定排程。本次未讀現役 Scheduler，沒有宣稱已取得維護空窗。
4. **先處理既有自動 stash 的部署阻擋。** `daily-generate.ps1:90` 附近原本就會 `git stash push -- src scripts`。直接 copy 本卡兩支已追蹤腳本，會變成未提交差異，下一次 daily 可能將它們收走；新 helper 又未必隨 tracked 檔一起 stash，會造成版本分裂。本卡禁止 commit，所以這裡不能替總指揮完成正式版本。正式部署應先在另一次已授權的版本流程整合已驗修補，使現役 src/scripts 沒有需要被 stash 的候選差異，再換檔；若只做臨時 copy，不能視為持續部署完成，也不應讓它跨到下一次 daily。不要為部署直接移除 watchdog 或偷改排程。
5. 在已確認無 writer 的空窗先備份現役 `scripts/catchup-publish.ps1`、`scripts/daily-generate.ps1`，記錄 SHA-256；新 helper 若已存在也要備份。保護原有未提交／untracked 工作，不 reset、不 stash 他人工作、不覆蓋未知版本。
6. 實際要套用的是 3 個 runtime 檔：先放 `_pipeline-lock.ps1`，再放 `catchup-publish.ps1`、`daily-generate.ps1`；保留 UTF-8 BOM。文件／smoke 留在驗證包，sentinel 與 watchdog 不必更換。新 helper 必須與呼叫端同時具備，缺 helper 時呼叫端會 fail closed。這些 ps1 為排程直接載入，換檔即影響下一輪，不需重註冊排程。
7. 複製後做現役檔案 SHA-256 readback／Parser，檢查版本一致及 src/scripts 的 git 狀態；不要為驗收手動跑會真發布的 catchup 或 daily。可在隔離環境重跑本檔兩支 smoke。
8. 經授權恢復正常輪次後，讀真 catchup log／posted-log 與平台 readback，另外驗證推站 URL、mutex 等待／75、告警狀態與群組是否實收。LINE 實收屬另一次明確授權的驗收，本次沒有測。Task Scheduler rc=0 不能代替發布成功。

回復：同樣先等相關 writer 結束，用備份逐檔回復兩支呼叫端，再處理新 helper；若部署前已有 helper，還原原版，若本次才新增，可先保留不會自行執行的 helper，避免未確認引用者便刪檔。核對還原 SHA／Parser／正式版本狀態，維持原排程；不寫假 posted-log、不補發過期 slot。

## 交付狀態

- 本地候選：完成；新 smoke 36／36 綠、哨兵舊 smoke 綠；同家族唯讀複審無未解卡內 blocker。
- 現役：未部署、未真發布、未註冊排程、未發 LINE；指定事故 log hash 未變。
- 九格缺口：本次明令只改卡列檔，故未另跑 Vault task_summary 寫庫；已把可追查開工卡、驗證與交接留在本檔。舊 catchup fixture 的依賴補件與全入口互斥不在本卡可改範圍，限制如上。

## 官方 API 參考

Global 命名空間與 Mutex／WaitOne 行為採用 Microsoft 文件，實際等待、75 與 abandoned 路徑另有本機程序測試佐證：[Mutex](https://learn.microsoft.com/en-us/dotnet/api/system.threading.mutex?view=netframework-4.8.1)、[WaitOne](https://learn.microsoft.com/en-us/dotnet/api/system.threading.waithandle.waitone?view=netframework-4.8.1)、[Kernel object namespaces](https://learn.microsoft.com/en-us/windows/win32/termserv/kernel-object-namespaces)。
