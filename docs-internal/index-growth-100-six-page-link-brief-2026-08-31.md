# 六頁情境內鏈 brief（2026-08-31）

## 目的與證據

這是針對目前 GSC `Discovered - currently not indexed` 六頁的內鏈修正 brief，不是發布指令。live sitemap 仍為 32；本輪只讀取每頁 live `<main>` 的標題與段落，未改 HTML。

Google Search Essentials 建議讓連結可抓取，並用人們會使用的文字描述內容；但相似城市頁若只把人 funnel 到同一頁，會有 doorway 風險。因此每個建議連結都必須服務不同下一步，不以增加 link count 為目標。

## 逐頁建議（主變因：正文情境內鏈）

| 頁面 | live 已有的主要意圖 | 建議新增的 1–2 個正文連結 | 不應做的事 |
|---|---|---|---|
| `services/taichung-citywide-laundry-pickup.html` | 全市收送、收送限制、LINE 詢問 | `taichung-laundry-price-list.html`（先看估價因素）；`taichung-laundry-service-search.html`（先分辨物件與需求） | 不再建立各行政區同文案頁；不把收送頁只改成地名變體 |
| `services/business-bulk-laundry.html` | 公司／店家大量衣物、分類、交期與收送 | `local/zhongke-office-laundry.html`（中科辦公情境）；`taichung-citywide-laundry-pickup.html`（大量件如何安排收送） | 不虛構批量價格、客戶數或產能數字 |
| `services/taichung-laundry-price-list.html` | 鞋、包、衣物寢具的參考價與估價因素 | `guides/white-shoe-yellowing.html`（鞋況影響處理）；`guides/luxury-dry-cleaning.html`（精品材質與風險） | 不用固定價承諾所有材質；不做「每品項一頁」薄頁 |
| `services/taichung-xitun-laundry.html` | 西屯到店、逢甲／通勤、收送 | `guides/taichung-laundry-service-search.html`（選店分流）；`local/fengjia-laundry-pickup.html`（逢甲收送情境） | 不與搜尋指南複製同一段 FAQ；保留西屯在地到店證據 |
| `guides/taichung-laundry-service-search.html` | 分流：門市、收送、企業、價格、布品 | 以清楚的意圖 anchor 分別連到上述 5 個服務頁；每個連結前放一句判斷條件 | 不新增「台中○○區洗衣」大量變體；不把 hub 變成關鍵字目錄 |
| `services/fabric-storage.html` | 收納前檢查、潮濕／起毛球／真空袋風險 | `guides/bedding-storage-check.html`（寢具檢查）；`guides/post-wash-drying-before-storage.html` 目前 live 為 404，暫不建立連結 | 不用泛泛「防霉」宣稱；沒有第一手照片／檢查紀錄前不宣稱案例成果 |

## 驗收條件

1. 每個新連結必須位於正文情境段落，anchor 明確描述下一步，不得只出現在全站導覽或 footer。
2. 連結目標需 HTTP 200、自 canonical、正文可讀；新增後不增加重複城市頁或 future-dated URL。
3. `fabric-storage` 的案例與照片若無合法第一方素材，維持「檢查流程」敘述，不補造案例。
4. 上線前先在隔離輸出跑 focused/full/typecheck、HTML／SEO-only overlay dry-run；live 重新驗證後才可一次 IndexNow。
5. 7 日只觀察 crawl／inspection、indexed、impressions；未達規則維持 `PENDING`，不把 link count 或 IndexNow 200 當成收錄。

## 17:42 live snippet recheck

六頁目前全部 HTTP 200、self-canonical、JSON-LD 可解析、noindex `0/6`，但 meta description 品牌／地址先行 `4/6`，answer box 品牌先行 `3/6`。因此今日唯一主變因定為「答案先行的 snippet＋一條情境內鏈」；`citywide pickup` 與 `price list` 已有部分答案先行訊號，先固定作控制組，不與其他頁同時改寫。完整欄位與內容見 `reports/gsc-discovered-six-snippet-audit-2026-08-31.md`。

## 17:47 內鏈 href live recheck

以本 brief 的 14 個建議目標逐一比對 live HTML：已有 `11/14`，且已存在目標 `11/11` 均 HTTP 200。三個確定缺口是：

1. `services/taichung-citywide-laundry-pickup.html` → `guides/taichung-laundry-service-search.html`。
2. `services/taichung-laundry-price-list.html` → `guides/white-shoe-yellowing.html`。
3. `services/taichung-laundry-price-list.html` → `guides/luxury-dry-cleaning.html`。

這三條只可在授權 PR 的正文情境段落補上；完整檢查見 `reports/gsc-six-context-link-audit-2026-08-31.md`。本輪未改 source、未部署。

## 19:11 正文入鏈優先級重校

最新 live contextual audit 已排除 `nav/footer/script/style`：business-bulk 為 9 次／3 個來源頁、price-list 為 9 次／7 個來源頁、搜尋指南 14 次／11 個來源頁、fabric-storage 25 次／8 個來源頁、citywide pickup 32 次／22 個來源頁、Xitun 38 次／11 個來源頁。

因此「低正文入鏈」只能作為補鏈優先級訊號，不能直接增加導覽連結。若取得授權，先補上方三條已確認缺口；其餘頁維持控制，補鏈後再重跑 contextual audit 與 GSC crawl／inspection。
