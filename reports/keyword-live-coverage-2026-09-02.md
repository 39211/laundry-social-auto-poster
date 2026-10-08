# 新增觀測詞 live 承接稽核 — 2026-09-02

## 結果

逐頁讀取 live HTML，檢查 12 個第二來源觀測詞是否以完整字串出現在指定承接頁：完整命中 `2/12`，未完整命中 `10/12`。

| 觀測詞 | 指定頁 | 完整字串命中 | 備註 |
|---|---|---:|---|
| 台中鞋子送洗 | `services/shoe-bag-care.html` | 否 | 頁面已有台中／鞋／送洗語意，但非連續字串 |
| 運動鞋清洗 | `services/shoe-bag-care.html` | 否 | 頁面未出現「運動鞋」完整詞 |
| 白鞋清潔台中 | `services/white-shoe-cleaning.html` | 否 | 頁面已有白鞋、台中與送洗語意 |
| 西屯洗包 | `services/shoe-bag-care.html` | 是 | 已有自然地區＋包類服務表述 |
| 台中包包送洗 | `services/shoe-bag-care.html` | 否 | 頁面已有包包／送洗語意 |
| 精品包送洗 | `services/shoe-bag-care.html` | 否 | 頁面已有精品包與送洗語意 |
| 台中床被送洗 | `services/taichung-citywide-laundry-pickup.html` | 否 | 頁面以寢具／棉被等近義服務表述 |
| 羽絨被送洗台中 | `guides/bedding-duvet-cleaning.html` | 否 | 頁面已有羽絨與台中／送洗語意 |
| 西裝乾洗台中 | `guides/shirt-suit-dry-cleaning.html` | 否 | 頁面已有西裝、乾洗與台中語意 |
| 台中洗衣收送 | `services/taichung-citywide-laundry-pickup.html` | 是 | 已有自然服務表述 |
| 企業制服送洗 | `services/business-bulk-laundry.html` | 否 | 頁面已有企業／制服／送洗語意 |
| 台中到府洗衣 | `services/taichung-citywide-laundry-pickup.html` | 否 | 頁面已有台中／到府／收送語意 |

## 判定邊界

- 完整字串命中只是內容承接檢查，不是搜尋量、排名或 Google 收錄證據。
- 沒命中不代表頁面無法匹配查詢；搜尋引擎會理解詞形與上下文。
- 不在同一輪把 10 個缺口全部硬塞進正文，避免關鍵字堆疊與多變因混淆。

## 下一步

1. pilot 先維持目前版本，作為 7／28 天基線。
2. 若要做第二個 treatment，從鞋／包高意圖群挑一組，在既有頁補一段自然、可驗證的服務句，再單獨部署。
3. 第 7 天看非品牌 impressions／crawl；第 28 天以 GSC 非品牌、GA4 organic、LINE click 決定 KEEP／RETEST／REPLACE。
