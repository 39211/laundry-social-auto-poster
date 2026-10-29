# 任務卡 A7:每日圖文發布管線可靠性(四天沒發出去,不能再發生)

總指揮:Claude(Cowork) 日期:2026-10-30 執行者:Codex(gpt-6.1-sol) 單一 writer:本卡
工作目錄(worktree):C:\Users\cyc39\AI-Lanes\a7\repo 分支 `feat/a7-publish-reliability`
只能改 `scripts/catchup-publish.ps1`、`scripts/daily-generate.ps1`、`scripts/publish-sentinel.ps1`、`scripts/_watchdog.ps1`、新檔 `scripts/_pipeline-lock.ps1`、新測試 `test/ps-pipeline-lock.smoke.ps1`、`test/ps-stale-git-lock.smoke.ps1`、`docs-internal/cards/A7-RESULT.md`。不執行任何真發布、不碰現役目錄、不註冊排程、不發 LINE。

## 事故(已查證,見 docs-internal/SXJ-VERSION-REGISTRY-20261029.md 10/30 02:10 段)
1. 10/25 23:40 留下 0-byte `.git/index.lock`(沒有 git 程序)→ 10/26–10/29 每輪 `publish-pages` 都 `fatal: index.lock File exists` → 公開站不更新 → `post-current-slot` 檢查 `https://sixiangjialaundry.com/assets/<date>/slot-0X.png` 404 → FB/IG 四天沒發。排程 rc 都是 0,沒人知道。
2. 10/29 14:00 起 `generate-public-site` 寫 `docs/llms-full.txt` 得 `UNKNOWN errno -4094`,同一分鐘有別的排程(Feature-Reel-1400、Publish-1400、Sentinel、Time-Gate)也會產站 → 疑似互鎖;單獨跑 9 秒成功。
3. `publish-sentinel.ps1` 四天內沒有讓店主知道(只做桌面 toast?先確認它實際做什麼)。

## 要做的事
1. `scripts/_pipeline-lock.ps1`(dot-source 用):
   - `Remove-StaleGitLock -RepoRoot`:`.git/index.lock` 存在 且 沒有任何 `git.exe` 程序的 CommandLine 含此 repo 路徑 且 鎖檔 mtime 超過 10 分鐘 → 刪除並寫一行 log(含鎖檔 mtime);否則不動。
   - `Enter-PipelineMutex -Name 'sxj-publish' -TimeoutSec 600` / `Exit-PipelineMutex`:用 `System.Threading.Mutex`(Global\),拿不到就等,逾時就記 log 並 exit 75(讓下一輪再來),**不要**跳過產站硬發。
2. `catchup-publish.ps1`、`daily-generate.ps1`:開頭 dot-source,先 `Remove-StaleGitLock`,把 generate-public-site / publish-pages / post-current-slot 整段包在 mutex 內。`publish-sentinel.ps1`、`_watchdog.ps1` 若也會產站或推送,一樣包。
3. 告警:在 `catchup-publish.ps1` 結尾,若當天應發的 slot 到了「4h recovery window」結束仍沒有 posted-log 成功紀錄,或 publish-pages 連續失敗 ≥ 2 輪 → 呼叫既有 `line-bot/staff_notify.py`(查它的介面;它會推到 `data/staff-target.json` 的店員群)送一則:「[發布異常] <日期> slot <n> 未發出;原因:<最後一行錯誤>;看 output/catch-up-logs/<日期>.log」。**每天同一原因最多送一次**(用 `data/publish-alerts/<date>.json` 去重)。找不到 staff_notify 可用介面就改寫 `data/publish-alerts/` + toast,並在 RESULT 說明。
4. 測試(PowerShell smoke,比照 `test/ps-*.smoke.ps1` 既有寫法):
   - 假 repo 目錄 + 0-byte 舊鎖 → 被移除;鎖很新(1 分鐘)→ 不動;有假的 git 程序命令列含路徑 → 不動。
   - 兩個 PowerShell 程序同時 Enter-PipelineMutex → 第二個等待;逾時路徑 exit 75。
   - 告警去重:同日同原因第二次不送。
   先紅後綠,RESULT 附原始輸出。`npm run typecheck` 不需要(沒改 TS)。
5. RESULT 另附:`publish-sentinel.ps1` 到底做什麼、為什麼四天沒告警(讀程式說明,不猜)。

## 禁止
不改 src/*.ts;不改發文邏輯與 4h 視窗;不改排程時間;不真的推送或發文;不碰 secrets。

## 交付
diff 摘要、測試紅綠輸出、部署到現役的步驟(這幾支 ps1 是排程直接跑的,複製過去就生效;寫清楚先核對哪些排程正在跑、什麼時間點換最安全)。
