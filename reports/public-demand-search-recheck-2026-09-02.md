# 近期公開需求核對（2026-09-02）

## 範圍

2026-09-02 以公開搜尋結果重查四組台中鞋／包／收送需求；這是需求型態與服務欄位的交叉核對，不是月搜尋量、排名、收錄或轉換證據。

## 觀察到的重複需求型態

| 查詢群 | 可核對的服務詞／問題詞 | 目前處置 |
|---|---|---|
| 台中洗鞋、洗鞋到府 | 手工洗鞋、鞋底／鞋面／鞋內、烘乾、除味、到府收送 | 納入既有鞋包服務頁的觀測池；不新增城市複製頁 |
| 台中洗包、包包護理 | 包包／鞋子清潔保養、除霉、整染、鍍膜、到府收送 | 保留洗包服務頁承接；價格與效果仍須第一方資料 |
| 材質分流 | 皮革、麂皮、帆布、網布、運動鞋 | 作為 Cohort A 問題分流候選；未解除 pilot gate 前不發布 |
| 預約與成交 | 傳照片估價、LINE 預約、收送範圍、營業時間 | 維持服務頁的答案／預約入口，不把競品流程當成本站承諾 |

## 可直接開啟的近期來源

- [DontWashClean 大里洗鞋](https://www.dontwash-dali.com/)：列出材質分流、鞋底／鞋面／鞋內與除味流程。
- [OC 鞋包護理公開頁](https://www.cleaners10.com/TW/Taichung/153741931853374/Oc%E9%9E%8B%E5%8C%85%E8%AD%B7%E7%90%86%C2%B7%E6%B8%85%E6%BD%94%E4%BF%9D%E9%A4%8A%C2%B7%E9%8D%8D%E8%86%9C%C2%B7%E6%95%B4%E6%9F%93%C2%B7%E9%99%A4%E9%9C%89%C2%B7%E5%88%B0%E5%BA%9C%E6%94%B6%E9%80%81)：可核對洗包、洗鞋、除霉、整染與到府收送欄位。
- [快客 Quick 到府洗鞋洗包](https://quick-service.com.tw/)：可核對線上估價、到府收件與鞋包服務分類。
- [Dreamers 西屯店](https://dreamers-818.com.tw/ContactUs)：可核對西屯在地鞋／包／皮革服務詞，但其地址、評論與價格不代表私享家。

## 判定與控制

1. 來源只證明搜尋結果中反覆出現的需求型態；沒有把競品的價格、案例、評論或服務承諾複製到本站。
2. 本輪不改 `src/`、`scripts/`、live HTML、schema、sitemap，也不重送 IndexNow。
3. 只有在本站 GSC 出現非品牌 query/page evidence，且 7／28 日資料完整時，才保留、替換或擴大詞；否則維持 `PENDING`。
4. Cohort A 五頁仍受 `HOLD_UNTIL_PILOT_ADOPT` 約束；近期公開結果不能解除素材 provenance 或 28 日 gate。

## 與官方規則的邊界

Sitemap、網址檢查與要求建立索引只是提示，不保證收錄；內容仍須先可索引、對使用者有獨特價值，才能作為後續曝光實驗的候選。官方依據：

- https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap?hl=en
- https://support.google.com/webmasters/answer/12482179?hl=en
- https://developers.google.com/search/docs/fundamentals/using-gen-ai-content?hl=en
