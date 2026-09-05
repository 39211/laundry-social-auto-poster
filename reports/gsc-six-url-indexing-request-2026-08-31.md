# GSC 六頁索引要求實際提交證據 — 2026-08-31

時區：Asia/Taipei

## 結果

在已登入的 Google Search Console 網址檢查介面，以下六頁各操作一次「要求建立索引」，每頁都實際顯示成功對話框：

> 已要求建立索引。已將網址加入優先檢索佇列。多次提交同一網頁並不會讓要求在佇列中的排位或優先順序有所改變。

| URL | GSC 提交結果 | 重複提交 |
|---|---|---:|
| `https://sixiangjialaundry.com/services/fabric-storage.html` | 成功提示可見 | 0 |
| `https://sixiangjialaundry.com/services/taichung-xitun-laundry.html` | 成功提示可見 | 0 |
| `https://sixiangjialaundry.com/services/business-bulk-laundry.html` | 成功提示可見 | 0 |
| `https://sixiangjialaundry.com/services/taichung-citywide-laundry-pickup.html` | 成功提示可見 | 0 |
| `https://sixiangjialaundry.com/services/taichung-laundry-price-list.html` | 成功提示可見 | 0 |
| `https://sixiangjialaundry.com/guides/taichung-laundry-service-search.html` | 成功提示可見 | 0 |

提交前的新鮮 GSC inspection 基線來自 `data/insights/gsc-index/2026-08-31.json`：32 個 live sitemap URL 中，26 個 `Submitted and indexed`、6 個 `Discovered - currently not indexed`；六頁均無 `last_crawl` 與 Google canonical。這個快照晚於六頁當前部署時間，因此不是前一版舊快照。

## GA4 × Search Console 關聯

使用者提供的 Search Console 系統通知顯示：網域資源 `sixiangjialaundry.com` 已於 2026-08-29 與 GA4 資源 `panhaoxin` 建立關聯。這可讓 GA4 顯示 Search Console 資料，但不會直接提高收錄或排名；實際是否可用仍要等 GA4 報表資料延遲後讀回驗證。

## 證據邊界

- 「已要求建立索引」＝網址進入 Google 優先檢索佇列，不等於已檢索、已收錄或排名提升。
- IndexNow 2026-08-31 已成功一次，sitemap 未再變更；本輪沒有重送。
- 六頁提交後，下一次判定必須使用新的 GSC inspection／coverage 證據；沒有新快照就維持 `PENDING`，不得把缺資料寫成 0。
- 第一個內容實驗只處理企業大量洗衣與價目頁的精準正文 inbound links；全市收送維持 control，答案框／description 實驗不得同批混做。
