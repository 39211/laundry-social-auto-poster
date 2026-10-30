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

## r2(2026-10-30 20:50,總指揮派回)— 依獨立審查 `docs-internal/cards/A9-REVIEW-r1.md` 修正

審查結論 SHIP WITH FIXES。r2 必做(1–6 為 must,其餘也做):
1. 一天只准嘗試一筆(主流程與拿到 mutex 後的 recheck 都要查:當天已有 done/failed 的 attempted_at 就 exit 0 不動)。
2. npm 子程序 600 秒 timeout + `taskkill /PID <pid> /T /F` 殺整棵樹;stdout/stderr 用有上限的 `Wait(30000)` 讀,讀不到就記 `[stdout not closed]`,不能永遠卡住;timeout 回 -1 並標 failed。
3. 驗 A7 mutex 契約:dot-source 包 try;用 `Get-Command Enter-PipelineMutex` 確認存在且有 `TimeoutSec` 參數,否則 exit 1 不發;回傳 `$null` 或 `[bool]` 都視為拿不到鎖 → exit 75。**先讀真實 `scripts/_pipeline-lock.ps1` 的簽名,把它寫進 RESULT。**
4. 隊列寫入改原子:寫 `.tmp` → 讀回 ConvertFrom-Json 驗證 → `[IO.File]::Replace($tmp, $queue, $queue + '.bak')`。
5. 日期字 regex 補:禮拜一~日/禮拜天、週末/周末、上週/下週/上周/下周、今晚/今早/明早/明晚/後天/前天、`10月26號`(日/號)、全形斜線 `10／26`、十月、萬聖。
6. 文案掃描改成「除了 slot/date/time/id/*url*/image*/asset* 以外的所有字串欄位」都檢查(含 hashtags);並到 `src/postCurrentSlot.ts` 確認發布時有沒有在 runtime 追加 footer/模板文字,寫進 RESULT。
7. skip/already-done 不消耗當天:用 while 迴圈往下找下一筆 pending(仍受第 1 點一天一筆限制)。
8. `dry_run` 字串 "false" 也要當 false。
9. redaction 加 `\bIG[A-Z]{2}[A-Za-z0-9_-]{20,}`。
10. registrar 加 `-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`;註冊時間已過第一個 16:00 就 Write-Warning。
11. `[Console]::OutputEncoding` 包 try/catch。
12. **隊列搬出 git 追蹤範圖**:改放 `output/backfill/queue.json`(output/ 已 gitignore),初始檔由腳本在首次執行時從 `data/backfill-seed.json`(新增,7 筆,可追蹤)複製;`-Stop` 除了改 skipped,還要 `Disable-ScheduledTask Laundry-Backfill-1600`(用 try,失敗只記 log)。還原 `.gitignore` 的改動。
13. smoke 補:同日第二次執行不發;npm 假指令 sleep 超時被殺(timeout 可用參數縮短成 5 秒測);mutex 回傳 $false/throw/缺參數三種;壞 JSON 隊列;字串 dry_run;真實 calendar 檔形狀 fixture(從 `data/content-calendar/2026-10-27.json` 複製結構、文字可改假);hashtag 命中;裸 IG token redaction;regex 變異(把 `[本這]週` 分支拔掉要紅)。至少 55 case 全綠;變異證據放 A9-evidence/r2-*。
14. RESULT 增一節「r2 修了什麼、哪些審查項沒採納與原因」。不要 commit。

## r3(2026-10-30 21:25,總指揮派回)— 日期字掃描範圍改回「只掃會發出去的文字」
r2 第 6 點照審查建議掃所有字串欄位,結果七筆全被 `local_image_path`、`video_prompt`、`media_package.effective_date` 等**內部欄位**的 ISO 日期命中而 skipped —— 這些不會發出去。你自己在 RESULT 已查到實際發布文字只有 `slot.facebook_caption`、`slot.instagram_caption`(postCurrentSlot.ts:469/481 → postFacebook/postInstagram 的 `input.caption`)加 first comment。r3 必做:
1. 日期字掃描**只掃**:`facebook_caption`、`instagram_caption`,以及 `data/first-comments/<date>.json` 裡該 slot 的留言文字(讀該檔結構決定欄位;沒有檔或沒有該 slot 就略過)。其他欄位一律不掃。hashtags 已在 caption 內。
2. regex 維持 r2 的台灣用法擴充;ISO 日期 `2026-10-27` 若出現在 caption 內仍算命中(那是真的會發出去的日期字)。
3. 重跑七筆真 repo DryRun:預期回到 7 筆 `pass`(r1 時 caption 全無日期字);若有任何一筆 skip,把命中的字與欄位列在 RESULT。
4. smoke:把「內部欄位含日期但 caption 乾淨 → pass」加為一案;「first comment 含『週末』→ skip」加為一案;其餘 r2 案例維持全綠;變異證據放 `A9-evidence/r3-*`。
5. RESULT 加 r3 段。不要 commit。

## 總指揮驗收(10/30 21:50)
- 我在自己的 shell 跑 smoke:129 案全綠(含 Codex 沙箱裡被擋的 File.Replace / taskkill 原生案)。七筆真 repo DryRun 全 pass。
- **seed 改為 6 筆**:`2026-10-26 slot 2` 當天根本沒產圖、沒核准(approved-log 只有 slot 1;`docs/assets/2026-10-26/slot-02.png` 不存在、線上 404),不是「漏發」而是「沒做出來」,不補。其餘 6 篇圖片線上皆 200、兩平台皆 approved。
- 10/31–11/05 每天 16:00 一篇;11/06 的 trigger 會發現沒有 pending 直接結束。
