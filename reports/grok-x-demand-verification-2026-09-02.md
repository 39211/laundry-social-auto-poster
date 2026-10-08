# Grok X／公開需求候選獨立核對 — 2026-09-02

## 範圍與判決

Grok 唯讀搜尋要求 2026-08-19 至 2026-09-02 的台灣／台中洗鞋、洗包、乾洗、到府收送與地圖曝光案例，先取得 15 個候選；本回合再用公開網址獨立開啟核對。Grok 回傳是探索資料，不是本站成效證據，也沒有傳送本機或專案資料。

結論：可交叉核對的是「服務與搜尋意圖型態」，不是排名、訂單或收錄因果。X／Threads 多數受 429 或無法開啟限制，不能把帳號自述列為已驗證案例。市府店家頁的日期也被 Grok 誤判，已排除近兩週事件。

## 核對結果

| 狀態 | 來源 | 可核對內容 | 對私享家可用的範圍 |
|---|---|---|---|
| `VERIFIED_SHAPE` | [京喆麗文章](https://jingzheli.tw/%E7%B6%B2%E8%B7%AFptt%E3%80%81dcard%E6%8E%A8%E8%96%A6%E5%8F%B0%E4%B8%AD%E9%AB%98%E7%B4%9A%E5%B0%88%E6%A5%AD%E6%B4%97%E8%A1%A3%E5%BA%97%E6%8E%A8%E8%96%A6%E4%BA%AC%E5%96%86%E9%BA%97%E5%88%B0%E5%BA%9C/) | 頁面標示 Updated 28 8 月 2026，列出洗鞋、洗包、床組、棉被、窗簾、西裝、羽絨、企業長期配合與台中多區收送。 | 支持「鞋／包／寢具／企業／收送」意圖分組；不複製其服務承諾、價格或推薦語。 |
| `VERIFIED_SHAPE` | [中島生活台中洗鞋整理](https://livingmiddle.com/article/43) | 公開整理西屯、西區、北區、南區、豐原、大里等店，含鞋子送洗、白鞋、帆布鞋、麂皮、到府收送與價格欄位。頁面未提供可證明的近兩週發布日。 | 支持「台中鞋子送洗／白鞋／材質／價格界線」觀測詞；不當成近期事件或月搜尋量。 |
| `VERIFIED_SHAPE` | [快客 Quick 首頁](https://quick-service.com.tw/) | 可直接看到到府洗鞋／洗包、LINE 諮詢、方案價格與四步驟收件流程；未見可核對的近兩週發布日。 | 支持「照片／線上估價／到府收件／洗鞋洗包」成交流程詞；不複製價格或優惠。 |
| `DATE_CORRECTED_OUT` | [臺中市政府合作店家頁](https://fun.taichung.gov.tw/shop/view/39433) | 頁面內容有洗鞋、洗包、洗衣、皮件與到府收件，但頁尾明確標示更新日期 2025-11-13，不是 Grok 所稱 2026-08-25。 | 只能作長期服務型態參考，不列入近兩週案例。 |
| `CONTENT_VISIBLE_DATE_UNPROVEN` | [TWW FAQ](https://www.tww.com.tw/Contact/FAQ) | 公開全台送洗／到府流程 FAQ；本次未取得近兩週發布日期。 | 只能作一般流程對照，不作台中近期曝光證據。 |
| `UNVERIFIED_429` | [Threads @happy415wash](https://www.threads.com/@happy415wash) | Grok 回傳自述台中西區洗衣、洗鞋、洗包與到府服務；獨立開啟回 429。 | 不進入已驗證詞池；等待可開啟原文或本站 GSC 證據。 |
| `UNVERIFIED_429` | [Threads @cian_ye](https://www.threads.com/@cian_ye) | Grok 回傳台中鞋包清潔與好評展示；獨立開啟回 429。 | 不把五星或成交寫成事實。 |
| `UNVERIFIED_FETCH` | [PRO360 需求單](https://www.pro360.com.tw/case/request/3486280) | Grok 回傳台中梧棲乾洗到府需求；本次公開開啟未取得可核對內容或日期。 | 不列入近期案例，不推論已成交。 |
| `UNVERIFIED_FETCH` | [AmpLaun 收送頁](https://www.amplaun.com.tw/page/2080) | Grok 回傳台北／三重收送規則；本次未取得可核對頁面內容。 | 不用於台中詞或近期策略。 |
| `OUT_OF_SCOPE` | [X @S1OWD 貼文](https://x.com/S1OWD/status/2093404942296121414) | Grok 回傳為中國大陸美團洗鞋情境，不是台灣／台中服務。 | 排除，不移植平台、價格或效果敘述。 |

## 對詞庫的實際變更

只新增 12 個「第二來源觀測詞」，映射到既有服務頁；沒有改寫 HTML、JSON-LD、title、description，也沒有建立新 URL。詞池與替換規則見 [keyword map](../docs-internal/index-growth-100-keyword-map-2026-09-02.md)。

這些來源最多證明搜尋意圖存在。第 7 天只看抓取／canonical；第 28 天必須同時查看本站 GSC 非品牌 impressions、GA4 自然搜尋與 LINE click，否則保持 `PENDING`／`INCONCLUSIVE`。

## 限制與修正

- Grok 的日期摘要可能錯誤；所有日期以原始頁面為準。
- X／Threads 不能開啟時，不以 Grok 摘要代替原文，也不把行銷自述當成排名或訂單證據。
- 公開競品頁不能證明私享家有相同服務；店方實際服務、價格、照片與收送範圍仍需第一方資料確認。
