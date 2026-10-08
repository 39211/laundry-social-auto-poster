# Live sitemap 全量可索引性稽核 — 2026-09-02

## 取樣時間與範圍

- 取樣時間：2026-09-02 08:39（Asia/Taipei）。
- 來源：`https://sixiangjialaundry.com/sitemap.xml`；逐一請求 sitemap 內全部 33 個 URL。
- 本報告的 `body_chars` 是 `Invoke-WebRequest` 取得的 HTML 字串長度，不等同 HTTP `Content-Length`；不可與舊報告的 header bytes 混用。

## 結果

- sitemap URL：33；HTTP 200：33；非 200：0。
- `index, follow` robots：33/33。
- self-canonical：33/33。
- 至少一段 JSON-LD：33/33。
- 本次 live 技術檢查沒有發現可解釋「8/21 後索引停滯」的 robots、canonical、noindex 或 404 故障。
- 這只證明可抓取與可索引資格，不代表 Google 已收錄、排名或產生曝光。

## 逐頁證據（URL／狀態／body_chars）

| URL | HTTP | body_chars |
|---|---:|---:|
| `/` | 200 | 210129 |
| `/services/shoe-bag-care.html` | 200 | 40447 |
| `/services/white-shoe-cleaning.html` | 200 | 37580 |
| `/services/fabric-storage.html` | 200 | 41460 |
| `/services/taichung-xitun-laundry.html` | 200 | 41595 |
| `/services/business-bulk-laundry.html` | 200 | 38062 |
| `/services/taichung-citywide-laundry-pickup.html` | 200 | 39371 |
| `/services/taichung-laundry-price-list.html` | 200 | 37957 |
| `/guides/photo-before-laundry.html` | 200 | 37371 |
| `/guides/white-shoe-yellowing.html` | 200 | 36227 |
| `/guides/school-uniform-care.html` | 200 | 37260 |
| `/guides/birkenstock-care.html` | 200 | 37530 |
| `/guides/luxury-bag-mold.html` | 200 | 36794 |
| `/guides/down-jacket-cleaning.html` | 200 | 36818 |
| `/guides/leather-jacket-care.html` | 200 | 36856 |
| `/guides/dry-cleaning-guide.html` | 200 | 37503 |
| `/guides/rainy-shoe-care.html` | 200 | 36584 |
| `/guides/shoe-odor-source.html` | 200 | 36269 |
| `/guides/bag-handle-cleaning.html` | 200 | 37369 |
| `/guides/bedding-storage-check.html` | 200 | 36535 |
| `/guides/shirt-suit-dry-cleaning.html` | 200 | 36261 |
| `/guides/bedding-duvet-cleaning.html` | 200 | 36703 |
| `/guides/plush-doll-cleaning.html` | 200 | 37651 |
| `/guides/luxury-dry-cleaning.html` | 200 | 37315 |
| `/guides/taichung-laundry-service-search.html` | 200 | 40835 |
| `/guides/clothing-alteration-with-laundry.html` | 200 | 37641 |
| `/guides/luggage-wheel-cleaning.html` | 200 | 37630 |
| `/guides/curtain-cleaning.html` | 200 | 37524 |
| `/guides/carpet-cleaning.html` | 200 | 37170 |
| `/local/fengjia-laundry-pickup.html` | 200 | 38294 |
| `/local/zhongke-office-laundry.html` | 200 | 36977 |
| `/local/donghai-laundry-pickup.html` | 200 | 37884 |
| `/local/qinghai-road-shoe-cleaning.html` | 200 | 39540 |

## 判讀與下一步

1. 先前把 `/services/business-bulk.html` 與 `/price-list.html` 當成 live URL 的 404 結果是測試 slug 錯誤，不能用作故障證據；sitemap 內正確 slug 本次均為 200。
2. 技術層已通過後，不再重送未變更的 IndexNow，也不把要求索引當成收錄保證。
3. 目前真正缺口仍是 GSC 新鮮 inspection／索引狀態與非品牌曝光；今日 09-02 GSC、GA4 檔案尚未產生，等待既有 23:10／23:15 排程，不以缺資料填 0。
4. PR #31 的自動化整合保持 Draft；pilot 7／28 日 gate 與新鮮 GSC／GA4 到位前，不放行 Cohort A 批次。
