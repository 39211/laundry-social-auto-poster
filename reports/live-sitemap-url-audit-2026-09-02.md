# Live sitemap 逐 URL 稽核 — 2026-09-02

## 結果

在 2026-09-02 05:35（Asia/Taipei）讀取 live `https://sixiangjialaundry.com/sitemap.xml`，逐一 GET 其 33 個 `<loc>`，並檢查 HTTP、canonical、robots 與正文厚度：

| 檢查 | 結果 |
|---|---:|
| sitemap URL 總數 | 33 |
| HTTP 200 | 33/33 |
| canonical 自指 | 33/33 |
| `noindex` | 0/33 |
| 正文少於 500 字元 | 0/33 |
| 正文字元最小／最大 | 1,046／55,969 |
| 異常 URL | 0 |

## 解讀邊界

這證明 live 頁面可連線、可解析且沒有明顯 soft-block／noindex／薄正文異常；**不等於 Google 已收錄或已有曝光**。收錄與成效仍只接受 GSC URL Inspection／Page Indexing、非品牌 impressions、GA4 organic 與 LINE click 證據。

## 後續

- 33/33 live URL 可作為下一次 GSC fresh inspection 的輸入基線。
- 目前不對 5 個 Cohort A 候選放量；先等 pilot 的 7／28 天 gate。
- 下一次發布前重跑本稽核，避免 mirror drift 再次把 live-only pilot 移除。
