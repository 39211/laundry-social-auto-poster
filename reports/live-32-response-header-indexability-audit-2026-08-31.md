# live 32 頁 response-header indexability audit（2026-08-31）

## 方法

- 讀取 live sitemap 的 32 個 URL，以 HTTPS `HEAD`（最多 5 次 redirect）檢查 status、Content-Type、`X-Robots-Tag` 與 Location。
- 本次只讀取 response headers，不改站點或提交。

## 結果

| 檢查 | 結果 |
|---|---:|
| URL checked | 32 |
| HTTP 200 | 32/32 |
| 非 `text/html` content-type | 0/32 |
| 非空 `X-Robots-Tag` | 0/32 |
| response Location redirect | 0/32 |

## 判讀

沒有發現 HTML 以外的 `noindex` header、錯誤 content-type 或隱性 redirect；這進一步排除 response layer 作為六頁「已發現未收錄」的主要阻擋。仍不能由此推論 Google 已收錄，內容差異、snippet、內鏈、抓取時機與 Google selection 仍需實驗驗證。
