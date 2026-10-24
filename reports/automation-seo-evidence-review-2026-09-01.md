# 自動化 SEO 證據盤點（2026-09-01）

## 問題與範圍

要驗證的不是「AI 寫文章會不會被 Google 收錄」，而是 AutoSEO 類服務到底自動化了什麼、哪些部分可能帶來搜尋曝光或客戶、以及是否適合私享家洗衣店。

觀測窗口為 2026-08-18 至 2026-09-01。這不是全網窮盡搜尋；它是 31 筆近期公開資料的可追溯樣本。Google 的政策文件僅作長期規則基準，不計入「近兩週新聞」樣本。X 貼文由 Grok 搜尋發現，但公開擷取遭 X 403 阻擋，全部標為「未獨立驗證」，不可當成事實或成效承諾。

## 先給結論

### 判決

**部分正確：AutoSEO 的工作流能自動增加可被搜尋的有效頁面，因而可能增加曝光；但它的公開證據尚不足以證明能為台中在地洗鞋／洗包帶來訂單，更不足以授權自動發布或自動外鏈。**

### 它如何自動化

1. 蒐集商業、客戶與競品背景，再選擇題目／關鍵字。
2. 產生約每日一篇長文，透過 WordPress 外掛同步或自動發布。
3. 建立內外鏈；AutoSEO 公開主張每月提供「100 Domain Authority worth」的外鏈。
4. 用 sitemap、索引與排名／流量看板追蹤結果。

這會有用的前提是：每一個題目對應真實搜尋需求，每頁有不同且準確的資料，且讀者會因該頁採取下一步。它不是「送 sitemap 就會增加客人」的索引工具。

### 為什麼有些案例會成長

近期可讀到的正例，都是用結構化、逐項不同的資料回答大量長尾問題，例如工具目錄、比較頁或整合頁；不是單純把同一段文字換城市或關鍵字。Silkdrive 的自營 1,100+ 頁目錄案例公開說明：每筆工具記錄都有頁面專屬事實、來源與 build gate；其第三方估算的排名關鍵字從 527 到 1,345、前十名從約 9 到 69，但作者也明確說明不是 GA4／GSC 流量數據。

### 為什麼不應直接套用到私享家

私享家不是有 1,100 個持續變動資料項目的工具目錄，而是單一實體店。大量「台中／西屯／逢甲＋洗鞋」近似頁容易變成同一服務的城市門頁；Google 將此列為 doorway abuse 的典型風險。店目前最缺的不是更多泛知識頁，而是地圖／商家檔案的實體訊號、洗鞋洗包的可成交資訊，以及每個主力頁的真實照片、價格邊界、收送條件與預約入口。

## AutoSEO：機制與證據強度

| 面向 | 可核對事實 | 證據等級 | 限制 |
| --- | --- | --- | --- |
| 自動發布 | WordPress 外掛說明需要帳號，傳送 API key、網站 URL 與文章 metadata；可設定同步與自動同步。 | 一手產品文件 | 代表有能力，不代表內容品質、索引或收益。 |
| 官方案例 | AutoSEO 自述 AVIAN Care 3 個月 blog clicks 13,400→19,800、impressions 445K→787K，165 篇文章與 29 條外鏈；GrowthGrid 自述 93→205 平均每日訪客。 | 供應商自述，附截圖 | 不是可下載的原始 GSC，沒有對照組，也非台灣在地服務。 |
| 使用者看法 | Trustpilot 近期有「節省發文時間」與「需給更精確背景才會改善」的正面心得；也有 2026-08-29 使用者稱文章含未核准的外部／競爭者連結。 | 第三方平台的個人陳述 | 可做風險訊號，不可驗證真實流量或單一指控。 |
| 外掛安全歷史 | WordPress.org 上有 2026-03 的未授權發布投訴；外掛也說已發布文章會留在網站。 | 第三方評論＋產品文件 | 在窗口外，不能視為近期事件；但足以否定「無人審核自動發布」。 |

### 不可接受的跳躍

- 供應商的 48%、77%、220% 成長主張不是私享家的預期值。
- 文章數、索引數、排名估計不是訂單、來電或 LINE 預約。
- 「從其他客戶站取得外鏈」是否合規，取決於每一條連結的取得方式與屬性；Google 明確把以操縱排名為目的的自動建鏈、過度交換連結列為 link spam。未逐條稽核前，不能採用。

## 近期樣本（31 筆）

| # | 日期 | 來源 | 類型 | 可用結論／限制 |
| --- | --- | --- | --- | --- |
| 1 | 08-31 | Google Search Central：Generative AI performance reports | 一手產品更新 | 8/31 已宣稱全網站可用 AI 功能曝光／頁面／國別／裝置報告；先量測，不把缺資料當 0。 |
| 2 | 08-31 | Search Engine Land／Sterling Sky + Jepto | 產業資料報導 | 179 個 GBP 分析：AI local pack 常只顯示 2 家且出現較少獨特商家；對在地店要量測路線、電話和檔案品質。 |
| 3 | 08-25 | Search Engine Land | 產業觀點 | AI 引用不等於被購買；需連同跨部門可信度／成交訊號處理。 |
| 4 | 08-26 | Uplift AI | 供應商指南 | 主張 GBP 自動化需明確店主同意；只能作政策風險線索，未取代 Google 條款。 |
| 5 | 08-24 | Silkdrive／vibecoding.app | 透明自營案例 | 1,100+ 資料型頁面、必填來源與 build gates；排名估算成長，但非第一方流量。 |
| 6 | 08-23 | pSEO：房地產案例 | 供應商案例 | 5 倍流量主張；客戶不可獨立識別，不作成效證據。 |
| 7 | 08-24 | AI Growth Bench | 公開實驗站 | 22/28 索引但僅 158 property impressions、0 clicks；證明「索引」不等於流量。 |
| 8 | 08-27 | Reddit／WebsiteSEO | 社群心得 | 小批量頁面發現近似且空泛；為經驗，不是實驗。 |
| 9 | 08-26 | Reddit／LLMTraffic | 社群觀點 | 第三方提及可能比再發十篇自有文有用；無可驗證數據。 |
| 10 | 08-28 | Reddit／digital_marketing | 社群心得 | 把真實客問／銷售異議提供給 AI 比空泛題目好；無站點數據。 |
| 11 | 08-31 | Reddit／localseo | 社群觀點 | 本地商家仍應先做 GBP、行動體驗、在地意圖頁；非一手資料。 |
| 12 | 09-01 | Reddit／GoogleMyBusiness | 自述案例 | 聲稱 30 天改善本地能見度；沒有原始資料，不採用。 |
| 13 | 08-29 | Trustpilot／AutoSEO 使用者 | 使用者心得 | 最新 1 星評論稱出現未核准外連，應設 outbound-link 檢查。 |
| 14 | 08-27 | Trustpilot／AutoSEO 使用者 | 使用者心得 | 覺得設定與內容製作便利；未提供流量。 |
| 15 | 08-23 | Trustpilot／AutoSEO 使用者 | 使用者心得 | 覺得省時；未提供流量。 |
| 16 | 08-22 | Trustpilot／AutoSEO 使用者 | 使用者心得 | 兩站內容發布變省時；未提供流量。 |
| 17 | 08-19 | Trustpilot／AutoSEO 使用者 | 使用者心得 | 表示內容品質取決於輸入背景；支持人工審稿。 |
| 18 | 08-18 | Trustpilot／AutoSEO 使用者 | 使用者心得 | 對外鏈品質與成效提出疑慮；為個人陳述。 |
| 19 | 08-31 | X @MitchForest | 自述案例，未獨立驗證 | 聲稱 impressions 200→8k/day、clicks 5→50/day。 |
| 20 | 08-31 | X @eyalccohen | 自述反例，未獨立驗證 | 聲稱約 9,000 頁 pSEO 後約 80% 被移出索引。 |
| 21 | 08-30 | X @itskevinlnh | 自述案例，未獨立驗證 | 聲稱 46,845 impressions、372 users。 |
| 22 | 08-29 | X @poyashad | 自述案例，未獨立驗證 | 聲稱 SEO 導流與 1K USD MRR。 |
| 23 | 08-25 | X @JulianGoldieSEO | 行銷型自述，未獨立驗證 | 多站點 click 成長主張。 |
| 24 | 08-25 | X @TheKeywordMan | 行銷型自述，未獨立驗證 | AI Overview impressions／click 主張。 |
| 25 | 08-23 | X @MBQSurveying | 推薦連結，未獨立驗證 | 使用心得，無流量指標。 |
| 26 | 08-26 | X @martonsaas | 問題討論，未獨立驗證 | 詢問 AutoSEO 類工具是否受影響，無結論。 |
| 27 | 08-24 | X @PeterMindenhall | 批評觀點，未獨立驗證 | 批評自動 SEO 工具／案例行銷，無成效資料。 |
| 28 | 08-18 | X @codyschneider | 工作流觀點，未獨立驗證 | 競品內容重組工作流，無站點績效。 |
| 29 | 08-19 | X @codyschneider | 工作流觀點，未獨立驗證 | Claude Code 加 API 建 pSEO／連結的做法，無績效。 |
| 30 | 08-30 | X @Outreachprohub | 工作流觀點，未獨立驗證 | SaaS integration pSEO 意見，非本地服務案例。 |
| 31 | 08-31 | Dataconomy | 產業評論 | 零點擊／agentic AEO 觀點；沒有可套用成效實驗。 |

## Google 長期規則基準（不列入上述 31 筆）

1. 自動產生大量、沒有新增使用者價值的頁面，可能屬 scaled content abuse。
2. 為相近地區／查詢建立近似導流頁，屬 doorway abuse 的明示例。
3. 以操縱排名為目的的自動建鏈與過度交換連結屬 link spam；不能因供應商稱「高權重」就假定合規。
4. 生成式 AI 曝光屬 Search Console 可量測面；它不是專門 AEO 格式或自動發文的保證。

## 對私享家的可採用版本：自動化「研究與品管」，不自動發布

| 階段 | 可自動化 | 必須人工確認 | 成功指標 |
| --- | --- | --- | --- |
| 每週找題 | GSC／GA4／Bing／商家檔案資料彙整；競品 SERP 差異清單 | 是否是洗鞋、洗包、衣物／床被收送的真實需求 | 新的非品牌 query、商家檔案搜尋字 |
| 內容草稿 | 依真實收件流程、價目與不可收條件建立草稿與內鏈候選 | 每句服務事實、價格、地區、照片與醫療／材質聲明 | 內容審核通過率；無虛構服務 |
| 發布閘門 | canonical／schema／link／重複度／答案框測試 | 每頁是否值得上線；最多一個 pilot | GSC request、實際抓取與收錄 |
| 地圖／成交 | 評論回覆草稿、照片與營業資料缺口提醒 | GBP 寫入、評論回覆、任何外部帳號動作 | GBP 搜尋、電話、路線、網站點擊、LINE click |
| 外鏈 | 僅列出可評估的相關本地媒體／社區候選 | 不購買、不交換、不自動投放；逐筆決定 | 合格自然提及，不以連結數當 KPI |

## 可驗證的 28 天小實驗（尚未執行）

目的：測試「高意圖、第一手證據的洗鞋頁」能否增加商業發現，而非測試一天一篇文章。

- 實驗頁：現有 `services/shoe-bag-care.html`。
- 變因：補一組經店主確認的洗前／洗後照片、收件判斷與不可保證範圍；以及從兩個已收錄高相關頁加入描述性正文內鏈。
- 不改：台中全市免費收送、無低消；電話 04-2452-7411；其他頁與 sitemap；不新增 URL；不重送同一 GSC 要求。
- 7 天：只看抓取／索引狀態與頁面技術完整性，不能做成效判決。
- 28 天：比較非品牌 impressions、GBP 搜尋／來電／路線、GA4 organic sessions 與 LINE click。所有無資料欄位保留 `null`；沒有足夠樣本則 `INCONCLUSIVE`。

此實驗需要店主先提供或核准第一手照片與真實收件規則，且任何 Google 商家檔案或社群寫入仍需操作當下確認。

## 來源

- https://getautoseo.com/
- https://getautoseo.com/case-studies
- https://wordpress.org/plugins/getautoseo-ai-content-publisher/
- https://www.trustpilot.com/review/getautoseo.com
- https://www.silkdrive.com/insights/programmatic-seo-case-study
- https://searchengineland.com/calls-clicks-falling-google-maps-destination-486276
- https://searchengineland.com/ai-visibility-execute-seo-mobilize-organization-485812
- https://www.upliftai.co/blog/local-seo-automation-google-business-profile
- https://aigrowthbench.com/
- https://pse0.com/blog/how-a-real-estate-platform-5x-their-organic-traffic-with-programmatic-seo-bbf5a5
- https://www.reddit.com/r/WebsiteSEO/comments/1w05f81/i_was_doing_programmatic_seo_backwards/
- https://www.reddit.com/r/LLMTraffic/comments/1vyq7ev/whats_one_geo_tactic_thats_working_better_in_2026/
- https://www.reddit.com/r/digital_marketing/comments/1w0ivd3/has_ai_actually_made_digital_marketing_easier/
- https://www.reddit.com/r/localseo/comments/1w2rl1r/local_seo_in_2026/
- https://dataconomy.com/2026/08/31/from-seo-to-aeo-why-agentic-workflows-are-the-only-way-to-survive-the-zero-click-market/
- https://developers.google.com/search/docs/fundamentals/using-gen-ai-content
- https://developers.google.com/search/docs/essentials/spam-policies
- https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports
- https://x.com/MitchForest/status/2094411245323534829
- https://x.com/eyalccohen/status/2094554299322020329
- https://x.com/itskevinlnh/status/2094123120940470619
- https://x.com/poyashad/status/2093646932438650992
- https://x.com/JulianGoldieSEO/status/2092364164157301011
- https://x.com/TheKeywordMan/status/2092292168891375774
- https://x.com/MBQSurveying/status/2091642095224115395
- https://x.com/martonsaas/status/2092628010465706221
- https://x.com/PeterMindenhall/status/2091959470452551938
- https://x.com/codyschneider/status/2089774331916149090
- https://x.com/codyschneider/status/2090182015094075763
- https://x.com/Outreachprohub/status/2094024723466195106
