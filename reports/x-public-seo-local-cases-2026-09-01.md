# X 公開案例掃描：索引、在地曝光與 AI 搜尋（2026-09-01）

## 範圍與判讀規則

- 來源是 Grok 的唯讀公開 X／網頁即時搜尋；查詢窗為 2026-08-25 至 2026-09-01。
- 保留需同時具備情境、介入與結果（或明確尚無結果）的貼文；排除純 checklist、工具廣告與無前後狀態的貼文。
- 共 31 則候選：收錄 9、GBP／地圖 5、在地服務業 10、AI 搜尋 7。所有數字都是貼文作者自述，沒有第三方後台或 CRM 可供獨立驗證；不得當成 Google 規則或保證。

## 對私享家可用的判決

**更好的方法**：把 X 案例當成「假設庫」，而不是照抄清單。私享家一次只測一個真實可控變因，並以 Google 商家檔案搜尋／來電／路線／網站點擊、GA4 LINE click、GSC 非品牌曝光的 7／28 日基線做判定。

1. 已完成的第一個資料一致性變因是 Google 商家檔案公開市話與正式網站；它已在公開卡片顯示 `04 2452 7411` 與 `https://sixiangjialaundry.com/`。
2. 下一個候選是「**實際收送服務範圍**」：只能填確實會服務的行政區，不可依 X 案例擴成虛構區域。現有商家檔案只顯示西屯區；是否擴到整個台中市仍需以實際可履約範圍和使用者確認為準。
3. 官網索引維持原本的小型內鏈實驗：只測企業大量洗衣與價目頁，其他頁保持對照；PR #30 fail-closed gate 未通過前不發布候選頁。
4. AI 搜尋案例沒有足夠證據支持調整 FAQ schema、批量 AEO 檔案或產生大量指南；現有答案框實驗維持單變因與 28 日判定。

## 案例清單

### A. Google 商家檔案／在地地圖（5）

| 日期（UTC） | 帳號與來源 | 介入與作者自述結果 | 私享家判讀 |
| --- | --- | --- | --- |
| 08-26 | [@indexsy](https://x.com/indexsy/status/2092714198828757162) | 獸醫服務頁、評論與引用等多項工作後，聲稱地圖與自然名次提升；自稱單變因的 browser blast 亦混在整體方案。 | 多變因，不能複製。 |
| 08-31 | [@SocialSwayph](https://x.com/SocialSwayph/status/2094388436081705050) | 改主類別、移除 15 個假服務區後，聲稱 14 天曝光 +140%、來電倍增。 | 僅採「真實範圍」原則；不採其數字。 |
| 08-31 | [@SEOBandwagon](https://x.com/SEOBandwagon/status/2094470125307232465) | 162,244 個 GBP 的評論數平均／中位數盤點。 | 只作評論基線參考。 |
| 08-26 | [@scott_benson](https://x.com/scott_benson/status/2092629421081473293) | 轉述大樣本研究：特定主類別與填齊欄位相關於較高能見度。 | 相關性不是因果；已核對本店類別與欄位。 |
| 08-28 | [@brucebiz2](https://x.com/brucebiz2/status/2093318097125970134) | 個人觀察到關門時 Map Pack 可見度下降。 | 本店營業時間已存在，不因單例修改。 |

### B. 收錄／檢索／內鏈（9）

| 日期（UTC） | 帳號與來源 | 介入與作者自述結果 | 私享家判讀 |
| --- | --- | --- | --- |
| 08-27 | [@noelcetaSEO](https://x.com/noelcetaSEO/status/2093043773815079209) | 電商 facet canonical 收斂；聲稱有效 crawl 比例與轉換提升。 | 不適用於本店小站架構。 |
| 08-31 | [@Haqq_99](https://x.com/Haqq_99/status/2094292526043734169) | 修 noindex、canonical、內鏈與 sitemap；未給後測。 | 只支持逐頁診斷，不支持重送。 |
| 08-27 | [@dylankbuckley](https://x.com/dylankbuckley/status/2092974615727309116) | 停用 Indexing API、改 sitemap，每日爬取與收錄自述上升，但作者不確定因果。 | 不使用一般頁 Indexing API。 |
| 08-28 | [@iamcreativeali](https://x.com/iamcreativeali/status/2093357939268685952) | 4,000 頁站點壓平內鏈、修薄模板；未給後測。 | 支持少量正文內鏈實驗。 |
| 08-29 | [@chr1st1neldn](https://x.com/chr1st1neldn/status/2093777307412398157) | 修 lastmod、404、語意 HTML、薄文合併與已收錄頁內鏈；未給後測。 | 合理稽核方向，非量產依據。 |
| 08-31 | [@TommyBez85](https://x.com/TommyBez85/status/2094462731621691598) | 從已爬頁補正文內鏈；貼文時尚無收錄結果。 | 與本店現有小型實驗一致。 |
| 08-29 | [@tonychetsnut](https://x.com/tonychetsnut/status/2093719088702828956) | client-side render 改 SSR；未給收錄前後數。 | 本站為靜態 HTML，不是問題。 |
| 08-30 | [@MilaChervenkova](https://x.com/MilaChervenkova/status/2094050720752259503) | 70 篇新內容稱全數收錄；站名未公開。 | 證據不足，不能用於量產頁決策。 |
| 08-26／31 | [@rankdotfast](https://x.com/rankdotfast/status/2092626576500298125) | 商業快速提交服務稱小時級更新；有明顯推廣背景。 | 不採用外部「加速收錄」服務。 |

### C. 實體服務業的在地可見度／轉換（10）

| 日期（UTC） | 服務類型與來源 | 介入與作者自述結果 | 私享家判讀 |
| --- | --- | --- | --- |
| 08-28 | 害蟲防治，[@mattjohnsonjm](https://x.com/mattjohnsonjm/status/2093459894393307213) | 移除錯誤區域、保留真實近距離服務區；30 日地圖 grid 改善。 | 可測真實服務範圍，不造假。 |
| 08-31 | 水電，[@noahiglerSEO](https://x.com/noahiglerSEO/status/2094390499486339137) | 多變因（廣告、頁面、GBP、評論、引文等）與高營收聲稱。 | 多變因／銷售案例，排除。 |
| 08-27 | 水電，[@RickyDPR](https://x.com/RickyDPR/status/2092898920326144330) | 服務頁重建與在地訊號；稱 120 日後 leads 上升。 | 支持服務頁成交資訊，不採數字。 |
| 08-29 | 圍籬，[@LiftedWebsites](https://x.com/LiftedWebsites/status/2093758630906806613) | 報 Maps 與報價數字但未細寫介入。 | 不可重現，排除。 |
| 08-28 | 承包商，[@localseobot](https://x.com/localseobot/status/2093368114960294327) | GBP 來電 25→38／月；介入未拆。 | 只作量測指標參考。 |
| 08-31 | 房屋清潔，[@localseobot](https://x.com/localseobot/status/2094455445620420954) | 現況 grid，不是介入實驗。 | 排除。 |
| 08-31 | 汽車隔熱膜，[@localseobot](https://x.com/localseobot/status/2094334469553434843) | 7 週 Maps 平均名次提升；介入不明。 | 排除。 |
| 08-29 | 災損修復，[@localseobot](https://x.com/localseobot/status/2093609667431731243) | 6 週 Maps 小幅提升；介入不明。 | 排除。 |
| 08-28 | 乾洗店，[@pentaclay](https://x.com/pentaclay/status/2093233125434531913) | 轉換頁／首頁改版；未附 Maps、來電或 lead 數字。 | 可參考成交頁資訊架構，但不是成效證明。 |
| 08-31 | 諮商診所，[@MBOnline2023](https://x.com/MBOnline2023/status/2094338631695761885) | 全漏斗方案聲稱 6 倍 leads；含明顯銷售 CTA。 | 排除。 |

### D. AI 搜尋可見度／引用（7）

| 日期（UTC） | 帳號與來源 | 介入與作者自述結果 | 私享家判讀 |
| --- | --- | --- | --- |
| 08-28 | [@semrush](https://x.com/semrush/status/2093377343121186878) | 依買家情境寫內容；稱 SoV 15%→26%。 | 可借鏡意圖對準；需自行量測。 |
| 08-30 | [@BuildWithJared](https://x.com/BuildWithJared/status/2094084420571705420) | 重寫職涯頁、entity／FAQ／schema；稱 0→多位 ChatGPT 提及來源。 | 多變因且領域不同，不改 schema。 |
| 08-25 | [@SuperlewisInc](https://x.com/SuperlewisInc/status/2092082871423086996) | 移 FAQ schema 後聲稱 AIO／Perplexity 引用下降。 | 單一未驗證案例，不能據此加減 FAQ schema。 |
| 08-29 | [@Digi_Ingenuity](https://x.com/Digi_Ingenuity/status/2093745522804666794) | 30 日結構化資料測試；未給量化結果。 | 證據不足。 |
| 08-31 | [@lilyraynyc](https://x.com/lilyraynyc/status/2094426898541478387) | 工具圖表顯示 ChatGPT 引用隨模型更新變動。 | 平台波動，不能歸因內容。 |
| 08-31 | [@ekuzevska](https://x.com/ekuzevska/status/2094276612502048863) | 同一問題重複問 3 次，僅 1 次引用。 | AI 引用不穩，不能作唯一 KPI。 |
| 08-31 | [@romulongomes](https://x.com/romulongomes/status/2094392024778592527) | SEO／PR 後有少量 ChatGPT referral；作者也不確定因果。 | 僅列為觀察。 |

## 不採用的做法

- 不買「快速收錄」、Indexing API 或虛構服務範圍。
- 不因單一 X 貼文增加或刪除 schema、重送 sitemap，或量產相似文章。
- 不把地圖 grid、AI 引用或作者截圖當成私享家已改善的證據。

## 下一個可檢驗動作

先保持已完成的電話／網站修正不動，量測 Google 商家檔案基線。若使用者確認每個實際收送行政區，才可把「真實服務範圍」設為下一個單變因；7 天看 Google 是否重新處理檔案，28 天比較搜尋、來電、路線、網站點擊、LINE click 與非品牌 GSC 曝光。沒有新鮮基線就維持 `PENDING`，不連續改動。
