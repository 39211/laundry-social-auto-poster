# 觀測詞語意元件缺口重驗（2026-09-02）

## 方法

對 12 個第二來源觀測詞，從指定 live `<main>` 文字檢查「地點／物件／服務」元件是否同時出現。這比完整字串比對更接近中文查詢的語意承接，但仍不是 Google 的 query matching 或搜尋量證據。

## 結果

| 查詢 | 指定頁 | 元件結果 | 判讀 |
|---|---|---|---|
| 台中鞋子送洗 | `services/shoe-bag-care.html` | 3/3 | 已有自然承接 |
| 運動鞋清洗 | `services/shoe-bag-care.html` | 0/2（「運動鞋」「清洗」字面缺） | 頁面已有鞋類／清潔語意；列為後續單一正文 treatment 候選 |
| 白鞋清潔台中 | `services/white-shoe-cleaning.html` | 3/3 | 已有自然承接 |
| 西屯洗包 | `services/shoe-bag-care.html` | 2/2 | 已有自然承接 |
| 台中包包送洗 | `services/shoe-bag-care.html` | 3/3 | 已有自然承接 |
| 精品包送洗 | `services/shoe-bag-care.html` | 2/2 | 已有自然承接 |
| 台中床被送洗 | `services/taichung-citywide-laundry-pickup.html` | 2/3（「床被」字面缺） | 頁面已有寢具／棉被語意；列為收送頁候選，不與鞋頁同輪修改 |
| 羽絨被送洗台中 | `guides/bedding-duvet-cleaning.html` | 3/3 | 已有自然承接 |
| 西裝乾洗台中 | `guides/shirt-suit-dry-cleaning.html` | 3/3 | 已有自然承接 |
| 台中洗衣收送 | `services/taichung-citywide-laundry-pickup.html` | 3/3 | 已有自然承接 |
| 企業制服送洗 | `services/business-bulk-laundry.html` | 2/3（「企業」字面缺） | 頁面已有店家／公司／制服語意；列為 B2B 頁候選，不先改寫 |
| 台中到府洗衣 | `services/taichung-citywide-laundry-pickup.html` | 3/3 | 已有自然承接 |

## 方策與順序

1. 目前只有 3 組字面元件缺口：`運動鞋清洗`、`台中床被送洗`、`企業制服送洗`；不把它們誤報成頁面無法匹配。
2. pilot 觀測期內不改 live；若取得 fresh GSC query/page evidence，先選一個意圖做單一正文變因，再重跑 canonical／內容／mirror／IndexNow 去重 gate。
3. `運動鞋清洗` 與既有鞋包服務頁最接近，但不能與「台中鞋子送洗」 treatment 同輪改；先等 pilot gate。
4. 任何詞若只有競品或公開結果證據，仍不得直接新增城市頁或把詞塞進 JSON-LD／meta。

## 控制

- 本輪只讀 live HTML；未修改 `src/`、`scripts/`、live HTML、Sitemap、schema 或發布紀錄。
- 缺少 GSC fresh query/page、GA4 organic 或 LINE 資料時，維持 `PENDING`／`INCONCLUSIVE`，不填零。
