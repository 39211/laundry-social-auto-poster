# 2026-09-01 索引與流量診斷

## 判決

「8 月 21 日後完全沒有新增索引」不成立；螢幕截圖的 *所有已知的頁面* 報表最後一個點停在 8 月 21 日，不能拿來代表 8 月 31 日的 URL inspection 狀態。實際的每日 inspection 快照顯示，追蹤 URL 已由 8 月 21 日的 10/24 變為 8 月 30 日與 31 日的 26/32。

流量偏低則成立：8 月 31 日 GA4 僅 7 sessions，Google organic 與 AI referral 都是 0；最新可用的 8 月 28 日 GSC 成效資料是 22 impressions、0 clicks。這兩項是低量基線，不可由單日推論為長期趨勢。

## 追蹤 URL 的索引時序

| 日期 | 已建立索引 / 追蹤 URL | 變化 |
| --- | --- | --- |
| 2026-08-21 | 10 / 24 | 基線 |
| 2026-08-22 | 19 / 24 | +9 |
| 2026-08-23 至 2026-08-25 | 20 / 25 | +1 |
| 2026-08-26 | 20 / 26 | 0 |
| 2026-08-30 | 26 / 32 | +6 |
| 2026-08-31 | 26 / 32 | 0 |

來源：`data/insights/gsc-index/2026-08-21.json` 至 `2026-08-31.json`。這是受排程追蹤的 URL 集合，不是 Search Console 「所有已知頁面」卡片的同一種彙總，因此兩個數字不可互相取代。

## 實際瓶頸

1. **最後六頁尚未被抓取，不是重新送件不足。** 六頁都是 `Discovered - currently not indexed`；`last_crawl_time`、頁面抓取、canonical 結果皆為空。8 月 31 日已逐頁要求建立索引；在 sitemap 未變之前重送只會製造重複工作，不是新訊號。
2. **可擴張的候選內容尚未成為 live URL。** PR #30 的 24 個候選頁仍是 404 且不在 live sitemap，因 fail-open mutation gate 尚未修好。未上線的頁不能帶來 Google 索引或流量。
3. **已收錄頁的需求訊號仍極低。** 最新 GSC 成效為 22 impressions / 0 clicks；8 月 31 日 GA4 為 7 sessions、0 Google organic、0 AI referral。這說明下一步不能只追求 sitemap URL 數，還必須驗證非品牌查詢曝光與點擊。

六個未收錄 URL：

- `/services/fabric-storage.html`
- `/services/taichung-xitun-laundry.html`
- `/services/business-bulk-laundry.html`
- `/services/taichung-citywide-laundry-pickup.html`
- `/services/taichung-laundry-price-list.html`
- `/guides/taichung-laundry-service-search.html`

來源：`data/insights/gsc-index/2026-08-31.json`、`data/insights/ga4-traffic/2026-08-31.json`、`data/insights/gsc/2026-08-28.json`。

## 已採取且不得重複的動作

- 2026-08-31 已對上述六頁各提出一次 Google 建立索引要求；見 `reports/gsc-six-url-indexing-request-2026-08-31.md`。
- 2026-08-31 IndexNow 已成功提交 33 個 URL；live sitemap 的 hash 未變前不重送。

2026-09-01 即時核對 live `sitemap.xml`：HTTP 200、32 個 URL、最大 `lastmod` 為 2026-08-31、SHA-256 為 `743b8c3dd729c8aae580ecfc207e4df3fdffcb63e04fe45d949a13c671d83dc7`。因此自上次送件後尚無新的 sitemap 訊號。

送出不是收錄；這兩項只證明發現訊號已送達，不能寫成 Google 已建立索引。

## 立即實驗：只動一個變因

**實驗 A（待 PR gate 綠燈後）：** 僅為「企業大量洗衣」與「價目頁」新增來自高權重、意圖相符頁面的正文情境內鏈。全市收送頁已經有 17 個來源，維持不改作對照組；不做全站模板式塞連結。

- 固定控制：canonical、標題、description、答案框、sitemap 與其餘四頁內容不變。
- 第 7 天：只記錄是否出現 crawl / inspection 狀態變化；不再提交。
- 第 28 天：若本組至少 2/2 已收錄，且至少一頁出現非品牌 impressions，才保留做法；否則記為 inconclusive 或 reject，再檢查內容意圖與頁面整併。
- 不與答案框／description 的品牌先行問題同時變更；那是實驗 B。

**內容擴張門檻：** 先部署唯一已有第一方非品牌查詢證據的 `shoe-odor-source.html` pilot。第 28 天只有在 pilot 已收錄且出現非品牌曝光時，才每批釋出 4–6 個頁面；每批需至少 70% 收錄且有非品牌曝光，才可進下一批。這是控制放量的判定規則，不是 Google 保證。

## 近七日 X 案例研究狀態

使用者限定的期間是 2026-08-25 至 2026-09-01，且限定 X 貼文，不採用官方文件或舊文章。

- Grok X 搜尋的兩次限期查詢未在逾時前回傳可引用結果。
- 直接開啟 X 搜尋被登入牆擋住，既有 Google continuation 沒有完成切換。
- 一次公開搜尋結果只回傳 X Business 官方廣告說明，依限制已剔除。

因此本輪**沒有**取得可驗證的 30–50 則近七日 X 案例；沒有以舊文、無日期貼文或模型摘要補數。待可讀取 X 時，才可依「原文 URL、發文日、帳號、操作、聲稱結果、可否套用」欄位建立案例集；在此之前，本站只採用上方可重現的 GSC/GA4 實測資料行動。

## 採納「索引與曝光分流」後的執行校正

### 本站現在屬於哪一種問題

| 類型 | 本站證據 | 正確動作 |
| --- | --- | --- |
| 已發現、尚未檢索 | 6/32 URL 是 `Discovered - currently not indexed`，且 `last_crawl_time` 為空 | 先提高 crawl demand：只對企業大量洗衣與價目頁補正文內鏈；其餘維持控制組；不反覆提交。 |
| 已檢索、尚未索引 | 8/31 快照沒有這個狀態 | 不假設是品質拒收，也不預先大量改寫。若日後出現，才用第一方案例、查核流程、照片與內容整併處理。 |
| 已索引、曝光很少 | 8/28 GSC：22 impressions、0 clicks | 不新增同義頁；優先改善已有排名資料的頁面與其搜尋意圖。 |

### 第一批曝光頁（不新增 URL）

以下頁面已收錄、平均排名落在約 8–20，但各自只有 1–8 impressions、目前 0 clicks。這正是應先做標題／答案開頭／意圖完整度／相關正文內鏈的小樣本，而不是另外生 10 篇相似文章的範圍。

- 首頁（8 impressions，position 8.1）
- `guides/birkenstock-care.html`（3，9.3）
- `guides/luxury-bag-mold.html`（2，10）
- `guides/white-shoe-yellowing.html`（2，8）
- `guides/down-jacket-cleaning.html`（1，9）
- `guides/rainy-shoe-care.html`（1，10）
- `guides/photo-before-laundry.html`（1，15）
- `guides/leather-jacket-care.html`（1，16）
- `guides/clothing-alteration-with-laundry.html`（1，19）
- `local/qinghai-road-shoe-cleaning.html`（1，18）

來源：`data/insights/gsc/2026-08-28.json`。因樣本很小，先固定內容、收集 28 天資料，再挑一個頁群做一個變因的實驗；不以單日 0 click 改版。

### 需要更正或暫不下結論的說法

1. **不要假定存在固定「每日十次」要求建立索引額度。** 本站做法改為：每個重要 URL 在有實質變更後只請求一次，並用 URL inspection 驗證，而不依賴未公開的固定配額數字。
2. **Search Console 的生成式 AI 控制與生成式 AI 成效報表已存在，但本站是否已取得報表、控制是否維持納入仍是 unmeasured。** 此報表正分批推出，且可能因曝光不足而不顯示；需由已登入的資源擁有者在 UI 唯讀確認，不能用缺檔案寫成 0。
3. **`site:sixiangjialaundry.com` 不是本站的收錄計數器。** 本次公開搜尋未回傳結果，卻與 8/31 的 26 個逐 URL inspection 直接矛盾；因此只把它當抽樣發現工具，收錄判定以 URL inspection 為準。
4. **IndexNow 不計入 Google 索引進度。** 它保留為 Bing 的發現訊號；Google 是否索引一律只以 GSC inspection／成效資料判定。

### 現在起的 7／28 日節奏

- **今天：** 保持 sitemap 乾淨且不重送；確認 PR #30 的 fail-closed gate；不發布 24 個仍為 404 的候選 URL。
- **PR gate 通過後：** 先做企業大量洗衣與價目頁的兩頁正文內鏈實驗；`shoe-odor-source.html` 仍只作一頁 pilot。
- **第 7 日：** 只讀 inspection，記錄 crawl 是否發生與索引狀態；沒有 sitemap 變更就不重新提交。
- **第 28 日：** 以「2/2 內鏈頁是否收錄、至少一頁是否出現非品牌曝光」判定內鏈實驗；以 pilot 是否收錄且出現非品牌曝光判定是否可放大到 4–6 頁。
