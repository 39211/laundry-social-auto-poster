# 交接給 Codex(2026-11-03 01:10,Claude 暫停兩天)

repo:`C:\Users\cyc39\laundry-repo`(release/sxj-live-2026-10)。進度看板:Claude Docs「私享家 AI 營運系統 整合總計畫 v1」(店主在手機看這份;每做完一件就更新)。版本登記:`docs-internal/SXJ-VERSION-REGISTRY-20261029.md`。

## 規則(不能破)
- 不發訊息給客人;不發布/不補發貼文,除非店主當次同意;不刪檔(要店主同意);不新增排程(要店主同意)。
- 店機 `ssh -n shop-pc` 只在 10:00–20:00 動(週六 12–18、週日不動);10:30–11:00 週一不部署。
- `Laundry-LINE-Bot` 排程保持啟用。LINE userId、`customer_bindings.json`、金鑰、token 不進 git/文件,不印出。
- 說「完成」要附證據:測試全綠 + 故意改壞會變紅(拆保護)+ 真實執行紀錄。
- 對客事實只用店主定的:一般衣物 5–7 天、鞋 7 天、難乾大件 10–14 天、皮件包 14 天;價格不自己寫。

## 進行中:V2 晚上 LINE bot 加 AI 對話(店主 D27)
- 店主要的:客人中途插問(例如選預約時間時問別的事)要先回答、再帶回原步驟;聽不懂交給 AI(店機同一份知識庫、同樣免費模型順序);「找真人」任何時候都直通店員;不准自己講價格;目標 AI 自己應付 90% 客人。
- API(claude_api.py,Opus)01:04 派出,成品會在 `C:\Users\cyc39\AI-Lanes\api-jobs\v2-chat\answer.md`(任務卡 head.md 在同目錄)。套用:`python C:\Users\cyc39\AI-Lanes\api-jobs\apply_edits.py <answer.md> <worktree> --dry-run` 再去掉 --dry-run。
- 驗收:`line-bot` 下各自獨立跑 test_ai_chat.py、test_conversation.py、test_guided_flows.py、test_estimate.py(`python -m unittest test_estimate`)、test_handoff.py、test_customer_questions.py;`LAUNDRY_AI_CHAT=off` 回覆與現在完全相同;拆保護。
- **不能直接上線**:開關 `LAUNDRY_AI_CHAT` 預設 off。先跑 `eval_ai_chat.py`(真模型 `--live`,分散呼叫省免費額度)做 20 段「舊回答 vs 新回答」對照,整理成店主手機看得懂的表,店主同意才開 on。

## 每天例行(已排 Claude 提醒;Claude 暫停時請代看)
- 16:00 補發一篇(`Laundry-Backfill-1600`),隊列 `output/backfill/queue.json` 剩 10/28 s1、s2、10/29 s1、s2(11/03–11/06)。16:22 看 `output/backfill-logs/<日>.log` 末行「Backfill done: facebook=success instagram=success」、`data/posted-log/<篇日期>.json`、`ops\Get-FbScheduled.ps1` 的 feed 編號對得上。失敗看原因,不自動重發。
- 21:40 schedule-ahead(A7-3 新版):`output/schedule-ahead-logs/<日>.log` 不該有 `ALERT FB_LOST`;有 `DEFERRED FB` 代表圖片還沒上網站,下次會重試。
- 23:40 第一層成績:`reports/level1-gates.md`。三條件各連 7 天,最快約 11/08(推測)。
- 照片模型用量:`python line-bot\photo_estimate.py usage --days 3`。11/02 第一順位 gemini-flash-latest 失敗 1 次、由 gemini-2.5-flash 接手;連續幾天都這樣再考慮換順序。

## 待做卡(依序)
1. **A7-4**:schedule-ahead 只跑 D+1~D+3,D-1 才變「不確定」的 FB 列當天沒人對帳;`ALERT FB_LOST` 只寫 log 與 `output/alerts/`,要推給人(每日進度報告 + 既有店員通知)。
2. **T-3**:line-bot 5 支舊測試要 `_sandbox_repo` 或呼叫已改名函式(test_catalog_sync、test_ehank_prices、test_suit_pricing、test_linebot_fix_20260926、test_isolation)。
3. D1 一店一套設定:D1-1 骨架在分支 `feat/d1-1-shops`(aa2fcec8,未合併);D1-2 之後照 `docs-internal/D1-SHOP-ISOLATION-PLAN.md`;**第一層過關前不上線**(店主 D22)。

## 最近做完(都已驗證,細節見版本登記 11/01–11/02 附錄)
A2-c 拉檔重試、B4-1 週報省下時間、V1-3 照片用量、T-2 估價測試、B2-8 店機半(11/02 10:10)、A4-7+N1(10:11)、A7-3 FB 預檢+對帳(21:40 真跑正常)。11/01 13:07 ai 電腦藍屏(0x154)到 23:12 才開回;11/01 兩篇 FB 不補(店主 D26)。

## 店主要做(只剩一件)
到 LINE 官方帳號後台看 11/01 13:07–23:17 有沒有客人訊息沒回(那段 bot 當機)。
