# Live SEO／索引承接複核（2026-09-02）

## 範圍

唯讀抓取首頁、主要服務頁、兩個在地頁與 `shoe-odor-source.html` pilot，並對 robots、sitemap、canonical、robots meta、正文厚度與 JSON-LD 類型做現況核對。沒有修改 `src/`、`scripts/`、live HTML、sitemap 或發布紀錄。

## Live 證據

| 項目 | 結果 |
|---|---|
| `https://sixiangjialaundry.com/robots.txt` | HTTP 200；`User-agent: * Allow: /`；指定爬蟲亦 `Allow: /`；宣告主 sitemap |
| `https://sixiangjialaundry.com/sitemap.xml` | HTTP 200；`application/xml`；33 個 URL |
| sitemap | 無未來 `lastmod`；首頁、鞋包服務、台中收送、企業大量、價目等主頁均在清單 |
| 9 個抽樣頁 | 全部 HTTP 200；robots meta 均為 `index, follow, max-image-preview:large` |
| canonical | 9/9 自指，未發現跨頁 canonical |
|正文 | 抽樣頁 main text 約 1,198–55,941 字元；沒有本輪可見的 500 字以下頁 |
| JSON-LD | 抽樣頁均可解析，含 `DryCleaningOrLaundry`、`BreadcrumbList`、FAQ；在地頁另含 `HowTo` |

抽樣 URL：首頁、`services/shoe-bag-care.html`、`services/business-bulk-laundry.html`、`services/taichung-laundry-price-list.html`、`services/taichung-citywide-laundry-pickup.html`、`services/taichung-xitun-laundry.html`、`local/fengjia-laundry-pickup.html`、`local/qinghai-road-shoe-cleaning.html`、`guides/shoe-odor-source.html`。

## 意圖承接觀察

- 鞋／包、衣物、收送、台中／西屯／逢甲等核心詞在相應頁的正文有承接。
- `床被` 這個字串在抽樣頁的 `<main>` 文字未直接命中；部分頁使用「寢具／棉被」等同義表達。這是待實驗的語意承接問題，不是索引技術錯誤，暫不在同一輪與企業／價目內鏈同時修改。
- 企業大量與價目頁的 sitemap `lastmod` 為 `2026-09-02`，今日 IndexNow 報告記錄 4 個 URL、HTTP 200；提交只表示通知成功，尚無 2026-09-02 GSC inspection 證明已索引。

## 官方規則對照

Google 的現行文件指出：sitemap 有助發現但不保證抓取／索引；`lastmod` 應可驗證且反映實際重大更新；URL Inspection 的 live test 顯示的是頁面是否具備出現在搜尋的資格，不等於已曝光；AI 搜尋仍以可索引、people-first、非商品化內容為基礎。這些規則與本專案的 no-op、雙快照與品質閘門一致。

## 今日判定與下一步

**判定：LIVE_TECHNICAL_BASELINE_PASS；INDEXING_OUTCOME_UNMEASURED。** 技術基線正常，但新鮮 GSC 尚未到齊，不能把 live 200、sitemap 33 或 IndexNow 200 宣稱為收錄／曝光增加。

1. 等 23:10 GA4、23:15 GSC 排程後重讀新鮮檔案。
2. 逢甲頁只有在兩個新鮮快照仍為 `Crawled - currently not indexed` 時，才做一次內容／意圖 treatment。
3. `床被` 的語意缺口列入下一個單一變因候選；不與現有企業大量／價目內鏈實驗混做。
4. 在 pilot 第 7 天前不新增大量 URL、不重複 IndexNow、不改寫 sitemap 以製造活動量。

## 來源與限制

- Live fetch：2026-09-02 07:41（Asia/Taipei）。
- 本報告是可抓取性與內容承接證據，不是 Google 收錄結果；收錄與曝光以 GSC／GA4 新鮮資料為準。
