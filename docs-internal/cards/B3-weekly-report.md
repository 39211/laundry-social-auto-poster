# 任務卡 B3:自動週報(店主每週一看一張表)

總指揮:Claude(Cowork) 日期:2026-10-30 執行者:Codex(gpt-6.1-sol) 單一 writer:本卡
工作目錄(worktree):C:\Users\cyc39\AI-Lanes\b3\repo 分支 `feat/b3-weekly-report`
只能新增 `scripts/weekly-report.py`、`scripts/register-weekly-report-task.ps1`、`test/test_weekly_report.py`(或 `scripts/test_weekly_report.py`)、`docs-internal/cards/B3-RESULT.md`。**只讀 data/、reports/、%LOCALAPPDATA%\line-bot;不改任何既有檔;不發 LINE;不註冊排程。**

## 目的
每週一 08:00 產一份 `reports/weekly/<yyyy-Www>.md`,店主一分鐘看完就知道上週發生什麼、該做什麼。資料拿不到的欄位寫「未知(原因)」,不要補 0 充數。

## 資料來源(先用 `Get-ChildItem` + 讀幾個樣本搞清楚格式,RESULT 列出你實際用到的欄位)
- 發文:`data/posted-log/`、`data/scheduled-log/`、`data/approved-log/`、`data/feature-posted-log/`、`data/youtube-log/`
- 成效:`data/leads/<yyyy-MM>.json`(LINE 點擊、搜尋漏斗、source_clicks)、`data/ga4-exports/`、`data/insights/`、`data/conversions/`
- 失敗/異常:`data/run-locks/`、`data/publish-locks/`、`reports/daily-progress.md`、`%LOCALAPPDATA%\line-bot\*.err`、`tunnel_events.jsonl`(若有)
- 人工工時:店主填在 Claude 文件(本卡拿不到;留一行「工時:見 B4 工時表」)
- 現役 LINE 通知/查件數:ai 端 `data/staff-inbox.jsonl`、`arrival-state.json`;店機端拿不到(寫未知)

## 週報格式(Markdown,繁中,不超過 60 行)
1. 一句話結論(本週最值得注意的一件事,從數字來)
2. 表:發文 FB/IG/YT/TikTok 篇數(排程 vs 實發 vs 失敗)
3. 表:LINE 點擊、搜尋漏斗各階段、來源前 5(與上週比,括號寫增減)
4. 表:異常清單(失敗排程、鎖檔殘留、webhook 錯誤)各幾次 + 最後一次時間
5. 「下週建議三件事」:**先用規則產生**(例:某來源點擊升但無發文→多做;失敗排程→修),留一個 `--llm` 開關預留給 API 模型(本卡不實作呼叫)
6. 資料口徑與未知欄位說明

## 其他要求
- Python 3.14 標準庫(現役環境無法保證第三方);`--week 2026-W44`、`--dry-run`(只印不寫檔)、`--out <dir>`。
- 測試:用合成的 data 目錄跑出一份週報,斷言各表數字;至少 8 條先紅後綠。
- `register-weekly-report-task.ps1`:每週一 08:00(只寫腳本)。

## 交付
`docs-internal/cards/B3-RESULT.md`:用到的欄位、一份對**真實 data/**(唯讀)產出的本週週報樣本貼進 RESULT、測試輸出、沒做到的事。
