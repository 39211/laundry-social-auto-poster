# AI 可見度與搜尋需求串流規格（2026-08-31）

這是一份與 100 頁索引計畫配套的資料最小化規格，不是註冊、OAuth、付費試用或上傳指令。目標是把真實 GSC／GA4 彙總訊號轉成下一批「值得做、可被引用、不是 doorway」的內容決策。

## 工具邊界（官方能力 vs. 本站可執行範圍）

| 工具 | 官方頁面目前可確認的能力 | 本案現在的用法 | 明確禁止 |
|---|---|---|---|
| Searchable | 品牌頁描述 AI search visibility、競品比較與 ChatGPT／Perplexity／Gemini referral attribution | 先列為候選觀測器；只做公開頁面研究，等待站主明確授權後才評估試用 | 未授權建立帳號、付費、OAuth、上傳站內資料 |
| Perplexity | 官方 crawler 文件說明 `PerplexityBot`／`Perplexity-User` 的抓取角色與 IP 查驗方式 | 讀 robots、伺服器紀錄與公開引用結果；以實際 URL 引用作為證據 | 把一次回答當成穩定排名或收錄證明 |
| Julius AI | 官方隱私文件說明上傳資料的儲存／處理與刪除控制 | 只有在另取得授權後，分析已去識別化的 GA4／GSC 彙總表 | 原始 GA4 identifiers、客戶個資、匿名訪客明細 |
| Clay | 官方資料點頁面列出 B2B 公司／網站流量等 enrichment | 只有已有合法商業名單用途時評估；與匿名網站流量隔離 | 上傳匿名訪客、原始 GA4、未具合法用途的名單 |

官方參考：

- Searchable：<https://www.searchable.com/solutions/brands>
- Perplexity crawler：<https://docs.perplexity.ai/docs/resources/perplexity-crawlers>
- Julius privacy／data security：<https://julius.ai/docs/get-started/privacy-and-data-security>
- Clay enrichment：<https://www.clay.com/faq/what-data-points-can-clay-enrich>

## 本地資料契約

### 允許輸入

- GSC：按日期彙總的 query／page `impressions`、`clicks`、`ctr`、`position`、coverage state。
- GA4：按日期與來源彙總的 `sessions`、`engaged_sessions`、AI referral、Google／Bing organic、`line_click`。
- live 稽核：URL、HTTP status、canonical、robots、JSON-LD、正文長度、內鏈目標是否 200。

### 脫敏與缺值規則

1. 不輸出 user ID、client ID、device ID、原始事件串、表單內容或客戶姓名／電話。
2. 小樣本只保留彙總數字；不足以可靠解讀的欄位保留 `null`，不可改寫成 0。
3. GSC OAuth 失效、排程未產生或 freshness 不合格時標示 `blocked`／`unmeasured`，不可用猜測補值。
4. 外部工具若要讀取資料，只能收到已脫敏的日／週彙總 CSV；預設不送出任何檔案。

## 每日串流

1. 23:10／23:15 排程完成後，先讀取當日檔案與 freshness；不可與相同 writer 並行。
2. 在本地合併 GSC、GA4、live sitemap 與 IndexNow 證據，計算「需求訊號 → 現有頁 → 缺口」清單。
3. 優先挑選：有 impression 且排名 11–30 的查詢、已 indexed 但 CTR 弱的頁、或 discovered/not indexed 且內容厚度／內鏈可修的頁。
4. 每日只選一個主變因（例如六頁正文情境內鏈），記錄現象、可能原因、固定控制、7 日與 28 日規則。
5. 產生本地決策列：`PENDING`、`ADOPT`、`RETEST`、`REJECT` 或 `INCONCLUSIVE`；未達資料門檻不得升級結論。

## 每週一 AI 可見度抽查

- 先讀官方文件版本與 robots／IP 變化，再做公開、可重現的少量查詢。
- 每個查詢記錄日期、完整問題、出現的引用 URL、是否提到私享家、競品與結果截圖／連結；不把單次生成答案當成穩定指標。
- 若要使用 Searchable、Julius 或 Clay，先停在 `authorization_required`，由站主另行授權；沒有授權就只保留公開研究結果。

## 本日基線與決策

- live sitemap：32 URL；GSC 最新快照：26 indexed、6 discovered/not indexed，快照已 stale。
- 今日 GA4／GSC 成效檔在 23:10／23:15 前尚未產生；因此本輪不啟動外部工具、不填 0、不宣稱 AI 流量或索引增加。
- 目前主變因仍是六頁正文情境內鏈；`post-wash-drying-before-storage.html` 已被 live recheck 證實 404，內鏈 brief 已禁止使用。
- 7 日：部署後若 crawl／inspection 前進且 indexed 或 impressions 增加才 `ADOPT`；只有 crawl 前進為 `RETEST`。
- 28 日：完成品質閘門仍無 crawl、indexed 或 impressions 改善才 `REJECT`；資料缺失維持 `INCONCLUSIVE`。
