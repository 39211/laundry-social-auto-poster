# 私享家 SEO / AEO / GEO 實證稽核與執行紀錄

日期：2026-07-20（Asia/Taipei）  
網站：https://39211.github.io/

## 結論先行

目前 SEO **已開始產生曝光與少量點擊，但尚未證明能穩定引流或帶來 LINE 預約**。Google Search Console 的實際資料不是零：2026-07-03 至 2026-07-17 有 135 次曝光、2 次點擊、CTR 1.5%、平均排名 7。2026-07-20 即時複查時，成效資料仍只到 7/17；索引報告仍停在 7/10，且唯一已索引頁是舊的 `/laundry-social-auto-poster/`，不是首頁或新服務頁。

因此本次優先修復「發現與索引」的根因，再補 AEO/GEO 可引用性；沒有把更多 schema、llms.txt 或關鍵字當作收錄替代品。首頁即時測試已確認「Google 可為網址建立索引」，並已加入優先檢索佇列；但 sitemap 報表在 7/20 重新讀取後仍顯示「無法讀取 Sitemap」，所以索引問題尚未結案。任何人都不能誠實保證 Google 或 AI 搜尋第一名，本次能保證的是：可控技術訊號已修正、網站已上線、送出紀錄可查、成效基線已建立。

## 1. 2026-07-20 前的真實基線

### Search Console 成效（資料區間 2026-07-03 至 2026-07-17）

| 指標 | 基線 |
|---|---:|
| Google Web Search 曝光 | 135 |
| 點擊 | 2 |
| CTR | 1.5% |
| 平均排名 | 7 |
| 已索引頁面 | 1 |
| sitemap 探索頁數 | 0 |

頁面拆分：

- `https://39211.github.io/`：121 次曝光、1 次點擊。
- `https://39211.github.io/laundry-social-auto-poster/`：14 次曝光、1 次點擊。

查詢已有品牌與服務訊號，包括「私享」「私享家」「洗衣店」「西屯洗鞋」「逢甲洗鞋」「乾洗」「洗包包」等；這證明 Google 已經開始理解品牌，但非品牌流量太少，不能推論預約成效。

### 根因證據

- `/sitemap.xml`：2026-07-04 送出，狀態「無法擷取」，探索 0 頁。
- `/laundry-social-auto-poster/sitemap.xml`：2026-07-03 送出，狀態「無法擷取」，探索 0 頁。
- `/services/taichung-xitun-laundry.html`：網址不在 Google 服務中、Google 無法辨識、沒有參照 sitemap、沒有參照網頁、從未檢索。
- 網站、robots、sitemap、驗證檔與 IndexNow key 對外均為 HTTP 200；因此問題不是網站完全離線，而是 Google 尚未成功處理 sitemap／服務頁發現訊號。

### 2026-07-20 即時狀態

- 索引報告最後更新於 2026-07-10：唯一已索引頁為 `https://39211.github.io/laundry-social-auto-poster/`，上次檢索 2026-07-03。
- 首頁的歷史索引狀態顯示「網址不在 Google 服務中」；同一次即時測試則顯示「Google 可為網址建立索引」「網頁可編入索引」，並偵測到 1 個有效導覽標記。
- 首頁已在 2026-07-20 加入 Google 優先檢索佇列；這是排程要求，不是已收錄證明。
- `/sitemap.xml` 的 Search Console 上次讀取時間已更新為 2026-07-20，但狀態仍是「無法讀取 Sitemap」、探索 0 個網頁。

## 2. 研究規模與證據分層

### 官方／第一方來源（決策優先級最高）

- [Google：AI features and your website](https://developers.google.com/search/docs/appearance/ai-features)：AI Overviews / AI Mode 沿用 SEO 基礎，沒有特殊 AI 標記或檔案可保證出現；頁面仍須先可索引、可顯示摘要。
- [Google：Improve your local ranking](https://support.google.com/business/answer/7091?hl=en)：本地結果核心仍是關聯性、距離、知名度；完整 GBP、正確營業時間、評論回覆、照片與影片是可控項。
- [Google：LocalBusiness structured data](https://developers.google.com/search/docs/appearance/structured-data/local-business)：結構化資料必須與頁面可見內容和真實商家資料一致。
- [Google：Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)：`lastmod` 只有在持續準確時才有價值；Google 忽略 `priority`、`changefreq`。
- [Google：Canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)：用 canonical 聚合重複網址訊號。
- [Google：FAQ rich result changes](https://developers.google.com/search/blog/2023/08/howto-faq-changes)：一般商家不應期待 FAQ schema 帶來可見 FAQ rich result。
- [Bing：AI Performance](https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview)：可看 AI citations、被引用頁與 grounding queries；citation 數不等於排名或重要性。
- [IndexNow documentation](https://www.indexnow.org/documentation)：HTTP 200 只代表收到通知，不代表已索引。
- [OpenAI bots](https://developers.openai.com/api/docs/bots)：OAI-SearchBot 控制 ChatGPT 搜尋可見性；GPTBot 訓練控制是另一件事。
- [Perplexity crawlers](https://docs.perplexity.ai/docs/resources/perplexity-crawlers)：PerplexityBot 用於搜尋表面與連結，不等於訓練。
- [Schema.org DryCleaningOrLaundry](https://schema.org/DryCleaningOrLaundry)、[Service](https://schema.org/Service)、[areaServed](https://schema.org/areaServed)。
- [llms.txt proposal](https://llmstxt.org/)：屬新興倡議，不是 Google 排名標準。

### X 最近一年掃描

- 3 組只讀搜尋：AI search/GEO 測量、本地 SEO/GBP/Maps、crawler/IndexNow/schema/AI reporting。
- 收集 155 筆候選，機械去重後 **153 個直接 X status URL**。
- 每批要求分開官方公告、實測、研究摘要與個人觀點；排名保證與純賣課內容不採用。
- 完整清單：[x-source-corpus.md](./x-source-corpus.md)。

代表性高訊號：

- [Aleyda Solis：GSC Generative AI report 的可用與缺口](https://x.com/aleyda/status/2078127513545367945)
- [Lily Ray：封鎖 crawler 後仍可能透過其他路徑被引用](https://x.com/lilyraynyc/status/2078090434165854383)
- [本地推薦 prompt 粒度會改變名單](https://x.com/milhan_mohammad/status/2077926855085322537)
- [伺服器日誌觀察：live answer bots 偏 HTML，不常抓 llms.txt](https://x.com/0xhsing/status/2077053758404514163)
- [llms.txt 大型抓取研究的轉述與限制](https://x.com/connrbrwn/status/2077848532527296623)
- [官方 Google Business Profile 客服／政策訊號](https://x.com/GoogleMyBiz/status/2078920391397982650)

### GitHub 公開技術討論與實作樣本

- 9 組 focused searches，發現 672 個倉庫；檢查 360 個 README，322 個相關，選取 **160 個實作樣本**。
- 9 組 exact-title issue searches：817 筆原始結果、290 筆標題精準命中；排除 CI、維護與 bounty 噪音後，保留 **119 筆具實質內容的公開技術討論**。
- 技術討論分層：63 maintainer/practitioner、6 official/platform、50 community。
- 完整清單：[github-practitioner-posts.md](./github-practitioner-posts.md)；實作樣本：[github-sources.md](./github-sources.md)。

這些清單用來找實作模式與反例，不用星數或重複採用次數假裝成因果證據。

## 3. 主流共識與本次採用判準

### 已採用

1. **先可抓、可索引，再談 GEO**：robots、canonical、sitemap、內部連結與真實 HTTP 回應是前置條件。
2. **答案優先且事實一致**：人看得到的範圍、費用邊界、門市地址與 CTA，要和 schema / JSON 一致。
3. **本地商家雙軌**：網站／GBP 的第一方資料品質，加上評論、目錄、在地媒體與社群的第三方實體證據。
4. **測量分層**：曝光、抓取、索引、排名、AI 引用、網站流量、LINE 點擊、預約不可混成一個 PASS。
5. **誠實 freshness**：只在內容真的變更時更新 sitemap `lastmod` 與 schema `dateModified`。
6. **多引擎觀察**：Google GSC、Bing AI Performance、ChatGPT / Perplexity referral 與人工 prompt 抽樣要分開看。

### 不當成排名捷徑

- `llms.txt`：保留作低成本機器入口，但沒有證據可保證索引、引用或排名。
- FAQ schema：保留機器可讀問答，但一般洗衣店不期待 Google FAQ rich result。
- IndexNow：只視為變更通知，不宣稱已索引。
- Schema：用於事實清晰與一致，不宣稱單獨提高 AI citation。
- 大量行政區 doorway pages、關鍵字堆疊、虛構評論／案例、買「保證進 ChatGPT」服務：不採用。

## 4. 2026-07-20 已完成的網站修改

- 新增 canonical 人類可讀服務頁：`/services/taichung-citywide-laundry-pickup.html`。
- 明確寫出已確認事實：台中市全區、收送本身免費、主要用 LINE 預約、門市仍在西屯青海路二段365號。
- 明確寫出費用邊界：收送免費不等於清潔免費；未虛構時效、最低消費、清潔價、固定時段或效果保證。
- 首頁 title、description、H1、導覽與可見區塊加入「台中全市免費洗衣收送」及服務頁內部連結。
- `DryCleaningOrLaundry` 與 `Service` schema 加入台中市 `AdministrativeArea` 與收送服務；未用 `price: 0` 誤導清潔免費。
- sitemap 改為：首頁／新服務頁使用真實 2026-07-20，貼文使用發布日，沒有可信日期的靜態頁省略 `lastmod`。
- WebPage / Article `dateModified` 不再用每次產站時間製造假新鮮度。
- 部署到 https://39211.github.io/；部署 commit：`be31043c52afa544b9390f6970842887ad7128b9`。

## 5. 驗證與提交證據

### 程式與產站

- Focused public-site test：12/12 PASS。
- 全套測試：20 files、88/88 tests PASS。
- TypeScript `tsc --noEmit`：PASS。
- `git diff --check`（兩個允許檔案）：PASS。
- 本機與公開稽核：47 HTML、28 JSON、361 image references、69 img tags、0 missing alt、0 broken URL、NAP 全欄位一致。
- 線上首頁、新服務頁、sitemap、robots：全部 HTTP 200。

### 搜尋引擎通知

- IndexNow：已送出 44 個 canonical HTML URL；只代表接收通知。
- Google Search Console：2026-07-20 重新提交 `/sitemap.xml`，介面顯示「已成功提交 Sitemap」。
- 新收送頁：已加入 Google 優先檢索佇列。
- 西屯洗衣服務頁：已加入 Google 優先檢索佇列。
- 首頁：即時測試確認可編入索引，並已加入 Google 優先檢索佇列。
- 送出後 GSC 在 2026-07-20 已重新讀取 sitemap，但仍顯示「無法讀取 Sitemap／0 頁」；不能宣稱已解除或已收錄。

### Sitemap 技術診斷（2026-07-20 06:00–06:08 Asia/Taipei）

- `https://39211.github.io/sitemap.xml`：一般瀏覽器、Googlebot、Google Inspection Tool、Bingbot 均回 HTTP 200，`Content-Type: application/xml`，沒有 `X-Robots-Tag` 封鎖。
- XML 可正常解析，檔案 6,847 bytes，共 44 個 URL、44 個唯一 URL，全部在同一 Search Console 資源範圍內。
- sitemap 內 44 個 URL 逐一以 Googlebot 身分請求：44/44 HTTP 200、44/44 為 HTML，0 失敗。
- `robots.txt` 以 Googlebot 身分回 HTTP 200，含 `User-agent: *`、`Allow: /` 與 `Sitemap: https://39211.github.io/sitemap.xml`。
- 同一時段的首頁即時測試成功；sitemap URL 即時測試則只回「發生錯誤，請過幾小時後再試」，沒有提供 XML、HTTP、robots 或範圍的具體錯誤。
- 判定：目前沒有可重現的站端 fetch／XML／robots／URL 狀態缺陷；GSC sitemap 狀態仍屬未解除風險，應在 24–72 小時內重試。若持續失敗，保留既有有效 sitemap，改以 Search Console 問題回報與 GitHub Pages／Google 抓取記錄繼續升級，不做無證據的格式改寫。

## 6. KPI 與判定時間窗

| 時點 | 必看指標 | 成功判準 |
|---|---|---|
| Day 0（2026-07-20） | GSC 1 indexed（7/10 舊快照，只有舊子路徑）、135 impressions、2 clicks；sitemap 0 discovered | 基線鎖定；首頁即時可索引且已送出 |
| Day 7 | sitemap 狀態、discovered URLs、indexed URLs、新頁 URL Inspection、品牌／非品牌 impressions | sitemap 可讀；重要服務頁開始被發現或索引 |
| Day 28 | 非品牌查詢曝光與點擊、CTR、服務頁 clicks、GBP actions、AI referral | 不只品牌詞；服務意圖流量開始出現 |
| Day 72 | LINE 點擊、有效詢問、預約數、題材／頁面帶來的轉換 | 流量能對應實際詢問或預約 |

目前網站沒有 GA4／其他站內 analytics measurement ID，因此 **LINE 點擊與預約尚無可驗證歸因**。在沒有量測代碼或預約端紀錄前，只能證明搜尋曝光／點擊，不能聲稱帶來預約。下一階段應接入合法的一方量測（例如 GA4 outbound click event）並以門市實際預約紀錄核對；不得用社群觸及或 IndexNow 200 代替轉換。

## 7. 最終判定

- 「之前 SEO 是否有做」：有，且 Google 已給 135 次曝光、2 次點擊。
- 「之前是否有效」：只有初步效果，尚未穩定；1 個索引頁與失敗 sitemap 是主要瓶頸。
- 「AEO/GEO 是否更新」：已更新並上線，但以可抓取、真實內容、實體一致與可量測為核心，不用未證實捷徑。
- 「現在是否保證第一名」：不能誠實保證；距離、競爭、Google 系統、GBP 知名度與第三方證據不受網站程式單方面控制。
- 「下一個可驗證結果」：GSC sitemap 狀態由失敗轉成功、首頁與服務頁出現 crawl/index 證據，以及 7/28/72 天指標是否成長。
