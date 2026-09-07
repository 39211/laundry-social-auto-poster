# AI discovery 入口 live audit（2026-08-31）

## 結果

| 入口 | HTTP | bytes | JSON | sitemap URL 覆蓋 | server Last-Modified |
|---|---:|---:|---|---:|---|
| `/llms.txt` | 200 | 99,081 | — | 32/32 | 2026-08-31 06:04:33 GMT |
| `/llms-full.txt` | 200 | 290,424 | — | 32/32 | 2026-08-31 06:04:34 GMT |
| `/ai-discovery.json` | 200 | 652,815 | 可解析 | 32/32 | 2026-08-31 06:04:33 GMT |
| `/answers.json` | 200 | 204,672 | 可解析 | 32/32 | 2026-08-31 06:04:34 GMT |

JSON 結構目前包含：`ai-discovery.json` 的 7 個 service、24 個 support page、30 個 recent post、127 個 published post；`answers.json` 有 155 個 answer。

## Freshness 與邊界

- `ai-discovery.json` 與 `answers.json` 的內容欄位 `generated_at` 都是 `2026-08-30T17:11:35.767Z`，比 server `Last-Modified` 約早 12 小時 53 分 01 秒。這是 timestamp freshness discrepancy，不足以單獨證明入口漏掉最新內容；需在下次產生流程核對來源時間與輸出時間。
- 四個入口完整涵蓋目前 32 個 sitemap URL；候選 24 頁尚未 live，因此不應期待它們出現在入口。
- 這些結果證明 AI crawler 可讀與入口覆蓋，不證明 Perplexity／ChatGPT／Google 已引用或收錄；未註冊外部工具、未上傳資料、未重送 IndexNow。

## 下一個驗證

在授權內容批次部署後，對 sitemap、四個 AI 入口與 `generated_at`／`Last-Modified` 做同一批 hash／時間比對；若輸出時間仍早於 sitemap 更新，先修正產生流程再談 GEO 成效。
