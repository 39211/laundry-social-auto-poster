# 任務卡 A1:版本收斂,建立可回退的現役基線

總指揮:Claude(Cowork) 日期:2026-10-29 執行者:Codex(gpt-6.1-sol) 單一 writer:本卡
repo:C:\Users\cyc39\Documents\New project 5(`C:\Users\cyc39\laundry-repo` 是指向它的 junction,同一份)

## 目的
現役 LINE bot + 發文系統要有一個「已知、可回退」的 git 版本。現在工作區 378 檔未提交,任何後續改動都無法安全回退。

## 你可以改的範圍
- `.gitignore`(新增產生檔規則)
- git 分支/commit/tag(只在新分支 `release/sxj-live-2026-10` 上)
- `docs-internal/cards/A1-RESULT.md`(你的回報)
禁止:刪除任何檔案(產生檔也不刪,只 ignore)、改任何 `.py/.ts/.ps1` 程式邏輯、碰 `secrets/`、`.env*` 的內容、merge 到 main、停或重啟任何排程與服務。

## 步驟
1. `git status --porcelain` 全量分類成三組,寫進 RESULT:(a) 產生檔(docs/assets、data/* 日檔、reports、output、.tmp 等 pipeline 每天會重產的);(b) 設定/文件(docs-internal、.agents、config);(c) 程式(src、scripts、test、line-bot)。
2. 對 (c) 逐檔 `git diff`,在 RESULT 用一行摘要每個檔改了什麼;若看起來是半成品或矛盾,標 `SUSPECT`,不要 commit 它,留在工作區。
3. 從目前 HEAD(59b53060)建分支 `release/sxj-live-2026-10`。
4. (a) 類:判斷哪些該 ignore(每日重產、可由 pipeline 再生成)→ 加進 `.gitignore`;確實是「發布紀錄/帳本」(approved-log、posted-log、scheduled-log、leads、youtube-log 等不可再生的)→ commit,訊息 `data: 2026-10 ledgers as of 2026-10-29`。
5. (b) 類一個 commit:`docs: internal notes as of 2026-10-29`。
6. (c) 類中非 SUSPECT 的,按子系統分 commit(line-bot / scripts / src / test),訊息寫清楚改了什麼。
7. 打 tag `sxj-live-2026-10-29`。
8. 驗收:`git status --porcelain` 只剩 SUSPECT 檔;然後跑 `powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\cyc39\laundry-repo\line-bot\run_line_bot.ps1" -Probe`,exit code 必須是 0(Probe 不會啟停任何東西)。
9. `git push -u origin release/sxj-live-2026-10` 與 tag(私有 repo,不是發布)。推失敗就記在 RESULT,不要重試超過一次。

## 交付(寫進 docs-internal/cards/A1-RESULT.md)
- 三組分類清單與數量;SUSPECT 清單與原因
- 每個 commit 的 hash 與一句話
- `.gitignore` 新增的規則
- Probe 的原始輸出與 exit code
- 沒做到的事與原因

## 停止條件(觸發就停下來寫 RESULT,不要繞過)
- 需要刪除任何非產生檔
- 任何步驟需要改程式邏輯才能過
- Probe exit code 不是 0(這代表現役服務狀態有問題,只回報,不要修)
