# A9 補發排程器(停擺 4 天的 7 篇,每天 16:00 補 1 篇)

## 背景(事實,已查證)
- 10/25 23:40 留下的 0-byte `.git/index.lock` 讓 `publish-pages` 連續失敗,公開站沒更新,`post-current-slot` 因圖片 404 失敗 → **10/26 slot2、10/27 slot1/2、10/28 slot1/2、10/29 slot1/2 共 7 篇 FB+IG 都沒發**。`data/posted-log/2026-10-26.json` 只有 slot1 兩筆 success;10/27–10/29 沒有 posted-log 檔。
- 這 7 篇的 `data/approved-log/<date>.json`、`data/content-calendar/<date>.json`、`docs/assets/<date>/slot-0N.png` 都在,公開站 `https://sixiangjialaundry.com/assets/<date>/slot-0N.png` 現在都是 200。
- 店主 10/30 19:50 拍板:**7 篇全補,從 10/31 起每天 16:00 多發 1 篇,排 7 天,7 天內可隨時中止。**
- `src/postCurrentSlot.ts` 已有刻意修復路徑:環境變數 `ALLOW_OFF_SCHEDULE_PUBLISH=true` + `--date <舊日期> --slot N --live`(見 L724–733);沒有這個變數會拒絕非當日 live 發布。`hasRecordedPost` 會跳過 posted-log 已有 success/uncertain 的平台 → 天然防重發。
- 16:00 沒有其他 Laundry-* 排程(14:00 Publish-1400 / Feature-Reel;16:40 Sentinel-Afternoon)。A7 的 `scripts/_pipeline-lock.ps1`(Enter-PipelineMutex 'sxj-publish')在 release 分支上;若存在就要用它包住發布。

## 要做的
1. `scripts/backfill-publish.ps1`(PS 5.1,ASCII only,`$ErrorActionPreference='Stop'`):
   - 讀 `data/backfill-queue.json`(本卡要建立初始檔,7 筆,順序:2026-10-26 s2 → 2026-10-27 s1 → s2 → 2026-10-28 s1 → s2 → 2026-10-29 s1 → s2;每筆 `{date, slot, status: "pending"|"done"|"skipped"|"failed", note, attempted_at, result}`)。
   - 每次執行只處理**第一筆 pending**:
     a. 先檢查 posted-log:若該 date/slot 的 facebook 與 instagram 都已 success → 標 done(不發)。
     b. **日期字檢查**:讀 content-calendar 該 slot 的文案(caption/first comment 全部文字),若含「今天」「今日」「明天」「昨天」「週一…週日」「星期」「本週」「這週」或 `10/2\d`、`10月2\d日` 這類明確日期字樣 → 不發,標 `skipped`,note 寫出命中的字,留給店主決定(店主說過不冒充真實時間點)。
     c. 否則 `$env:ALLOW_OFF_SCHEDULE_PUBLISH='true'`,在 repo 根跑 `npm run post-current-slot -- --date <date> --slot <slot> --live`(用 `Start-Process`/`&` 皆可,但要拿到 exit code 與輸出寫到 `output/backfill-logs/<today>.log`,token 不得入 log)。
     d. 完成後再讀 posted-log 判定:FB 與 IG 都 success → done;任一 uncertain/failed → `failed`,note 寫原因,**不自動重試**(下一天會輪到下一筆,失敗的留給總指揮)。
   - 若有 `scripts/_pipeline-lock.ps1` 就 dot-source 並用 `Enter-PipelineMutex 'sxj-publish'`/`Exit-PipelineMutex` 包住 c(拿不到鎖就寫 log 退出 75,不發)。
   - 隊列空(沒有 pending)→ 寫一行 log 退出 0,不做事。
   - 支援 `-DryRun`(只印會發哪一筆與日期字檢查結果,零寫入)、`-Stop`(把所有 pending 改成 skipped,note "owner stop",這是店主中止用)。
2. `scripts/register-backfill-task.ps1`:註冊 `Laundry-Backfill-1600`,每日 16:00,current user、Interactive、Limited,ExecutionTimeLimit 15 分,MultipleInstances IgnoreNew;`-WhatIf` 支援;已存在就 throw。**本卡只寫腳本,不執行註冊**(總指揮執行)。
3. 測試 `test/ps-backfill-publish.smoke.ps1`:用假 repo 目錄(temp)與假 `npm`(用 `-NpmCommand` 參數注入一個 .cmd/.ps1 假指令,寫入假 posted-log)覆蓋:隊列推進、posted-log 已 success 直接 done、日期字命中 skipped、npm 失敗標 failed 且不重試、隊列空退出 0、`-Stop` 全改 skipped、拿不到 mutex 退出 75。至少 10 個 case,全綠;並做一次變異:拿掉日期字檢查 → 對應 case 要紅,把輸出留 `docs-internal/cards/A9-evidence/`。
4. 不改 `src/*.ts`。不碰 line-bot。不發真貼文(測試一律假 npm)。不讀 secrets。

## 交付
- `docs-internal/cards/A9-RESULT.md`:做了什麼、怎麼驗、`-DryRun` 在真 repo 跑一次的輸出(會列第一筆 2026-10-26 s2 與日期字檢查結果)、7 筆文案的日期字檢查結果表(哪幾筆會被 skip、命中什麼字)、剩餘風險。
- 不要 commit;總指揮會 commit。
