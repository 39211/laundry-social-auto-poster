# AI／搜尋爬蟲 live audit — 2026-08-31

## 方法

- 來源 URL：live `https://sixiangjialaundry.com/sitemap.xml` 的 32 個唯一 URL。
- 每個 URL 以三個 User-Agent 各請求一次：Googlebot、GPTBot、PerplexityBot。
- 只記錄 HTTP 狀態與回應文字長度；沒有登入、寫入或發布。

## 結果

| User-Agent | 請求數 | HTTP 200 | 非 200 | 最短去 markup 文字 |
|---|---:|---:|---:|---:|
| Googlebot | 32 | 32 | 0 | 2713 |
| GPTBot | 32 | 32 | 0 | 2713 |
| PerplexityBot | 32 | 32 | 0 | 2713 |
| **合計** | **96** | **96** | **0** | **2713** |

## 判讀

- live robots／CDN／WAF 沒有阻擋這三種爬蟲；這是可抓取證據，不是 Google 或 AI 已收錄／引用證據。
- GSC 仍是 26 indexed、6 discovered/not indexed；候選 24 頁未在 live sitemap，不能把本次 96/96 當成 56 頁驗證。
- 下一步仍是先完成 PR #30 的品質 `REWRITE` 與安全 gate，再做 HTML／SEO-only overlay；部署後需重新執行同一套 crawler audit 與 GSC inspection。
