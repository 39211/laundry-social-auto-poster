# 任務卡 B2(唯讀設計):內容來源 → LINE 詢問 → 預約 → 訂單,怎麼對起來

總指揮:Claude(Cowork) 日期:2026-10-30 執行者:Codex(gpt-6.1-sol) 本卡唯讀,只產一份設計文件
工作目錄:C:\Users\cyc39\AI-Lanes\integ\repo(integration/20261030,含所有已驗分支)
只能新增 `docs-internal/B2-DESIGN.md` 與 `docs-internal/cards/B2-RESULT.md`。不改程式、不連店機、不呼叫 API。真實資料只讀 `C:\Users\cyc39\Documents\New project 5\data\`(不要抄客人資料進文件)。

## 目的
週報現在只能說「LINE 點擊 5」,說不出「哪篇內容帶來哪個客人、最後有沒有成交」。設計一條最省事、不改店機 POS 的對照鏈,讓 B3 週報能填「來源→詢問→預約→訂單」三欄。

## 現有材料(先讀)
- 內容端:`src/contentPlan.ts` 的 LINE 入口連結與 tracking 參數(搜 `withLineContact`、`tracking`、`line_url`、`utm`);`data/leads/2026-10.json` 的 `source_clicks`、`search_funnel_events`;`data/posted-log/*.json`、`data/feature-posted-log/*`;GA4 匯出 `data/ga4-exports/`、`scripts/ga4-collect.ps1`。
- LINE 端(店機 FXwash kit 快照 `shop-pc/fxwash/`):`runtime/webhook_server.py`(訊息事件、綁定 `save_binding`、staff handoff)、`data/customer_bindings.json` 格式(只看結構)、`runtime/lookup_service.py`(客號、件號)。ai 端舊 bot `line-bot/staff_notify.py`、`data/staff-inbox.jsonl` 格式。
- 訂單端:eHank `Det`/`Cus` 表欄位(見 `shop-pc/fxwash/bridge/ai_engine/db_manager.py`、`connectors/base.py:240–320`、`docs-internal/cards/A3-RESULT.md` 第 1 節)。
- 規則:`docs-internal/SHOP-FACTS.md`(隱私:照片保留 7 天、不抄客資)。

## 要回答
1. **來源怎麼進 LINE**:LINE 官方帳號的加好友連結能不能帶參數?(查 LINE 官方文件:`https://line.me/R/ti/p/@id?...` 是否保留參數;LIFF / `liff.state`;或用「每篇內容不同的關鍵字」讓客人第一句話帶來源)。列出可行方案與限制,附官方文件連結。
2. **詢問怎麼記**:店機 webhook 收到第一則訊息時,要記哪些欄位(ts、userId hash、來源碼、首句類型:估價/查件/收送/其他)才足夠;寫去哪(建議 `data/inquiries.jsonl`,append-only);跟既有 staff handoff 怎麼接。
3. **詢問 → 訂單**:綁定後 userId ↔ 客號(Cid);訂單用 eHank `Det` 的 `Cid`+`Indate` 在詢問後 7 天內的收件數來對;沒綁定的算「未知」。寫出對照演算法與邊界(同客多次詢問、先成交後綁定)。
4. **週報三欄怎麼算**:每個來源碼 → 詢問數 → 綁定後 7 日內有收件的數;口徑寫清楚;給 B3 `weekly-report.py` 需要新增的輸入檔與欄位。
5. **最小改動清單**:要改哪幾個檔、各幾行左右、哪些要部署到店機、風險(隱私、效能)。不要寫程式。
6. **不做的事**:不自動發訊息、不改 POS、不用第三方追蹤服務。

## 交付
`docs-internal/B2-DESIGN.md`(繁中,含方案比較表、資料流程、欄位表、演算法、改動清單、未知/假設)+ `docs-internal/cards/B2-RESULT.md`(讀了哪些檔、查了哪些官方頁、沒把握的點)。
