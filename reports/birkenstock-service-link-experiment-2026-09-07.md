# 勃肯頁服務銜接：待授權的最小改動

狀態：PREPARED，尚未修改網站、提交或部署；不是已改善收錄。

## 基線與來源

使用者提供後台讀值，尚未由本回合獨立登入驗證：8/31–9/6 GA4 活躍45、瀏覽69、LINE重要活動0；8/10–9/6 GSC clicks11、impressions744、CTR1.48%、position13.9。勃肯臭味相關三詞合计8曝光、0點擊、排名7–15。後台仍可讀與本機OAuth失效可以同時成立。

本回合直接 HTTP 讀取勃肯、棉被、價目三頁：200、自指canonical、未見meta noindex、各有JSON-LD。這只能證明基本可存取條件，不是Google已索引或schema完整驗證。

勃肯目前title：勃肯鞋會臭嗎？鞋床發黑怎麼處理｜台中洗鞋 私享家。
目前H1：勃肯鞋會臭嗎？先看軟木鞋床，不要整雙泡水。
正文「對應服務」目前為白鞋清潔；導覽有鞋包清潔，但不等於正文服務銜接正確。

## 唯一 treatment：對應服務映射

將勃肯頁的對應服務由 `/services/white-shoe-cleaning.html`、白鞋清潔，改為 `/services/shoe-bag-care.html`、鞋包清潔。以generator既有service映射欄位修改，不手改生成HTML；同一映射在頁面上產生的入口應一致。

不改title/H1/description/答案框/價格/CTA文案，不新增URL，不改首頁與棉被頁，不改其他服務映射。相關白鞋指南連結仍可保留。

目的：讓已找到勃肯問題的訪客接到較符合物件的送洗服務。這是導流假設，不宣稱直接增加Google收錄。

## 驗收與觀察

1. 差異限定勃肯一個service映射；在隔離工作目錄產生HTML，不覆蓋主工作樹其他人改動。
2. 渲染後正文對應服務href/文案正確，目標200；canonical、title、H1、答案及LINE連結保持原值。
3. 獨立複審後才可發布；記錄部署commit、時間與HTML hash作Day0，不以今天製作草案開始計時。
4. 第7天檢查Google抓取時間與頁面曝光，未抓取則PENDING，不重複催送。
5. 第28天比較同URL前後28天的非品牌曝光、organic sessions、文章到服务点击、LINE click。必須先驗證事件實際送達且可依頁面/來源區分；未有可靠事件則null，不能用站級0判此頁無效。
6. 低於30個該頁自然搜尋sessions的窗口標INCONCLUSIVE；30只是操作性樣本下限，不是統計顯著保證。不同時改標題，不把前後變化當單一改動的因果證明。

## 邊界與後續候選

- 既有規則禁止src/改動，而來源為src/generatePublicSite.ts，需明確開放本次單一映射才實作。當前官網大量dirty工作，禁止全量stage/build覆寫。
- 8曝光0click不足以证明title失敗；Google也可能重寫搜尋標題：https://developers.google.com/search/docs/appearance/title-link
- 正文對應服務应相关且锚文本明确：https://developers.google.com/search/docs/crawling-indexing/links-crawlable
- 內容另有需查證的絕對說法（例如除臭劑沒用、麂皮一濕就硬），不得為了吸引點擊放大。品牌保養指引有分材質及Cleaner & Refresher用法：https://www.birkenstock.com/us/us-service-caretips.html 。內容正確性修訂應另行完整核對，不混入此次內鏈測試。
- 海外國家不等於bot，LINE重要活動0不等於無詢問，也不能證明H1單CTA有效。
- Fable規劃嘗試被本機互動式安全啟動器拒絕；未繞過，未取得跨家族複審，不能標示review passed。
