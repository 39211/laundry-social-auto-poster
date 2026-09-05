# AI 工具官方能力週檢（2026-08-31）

本週一只做官方文件查閱，不建立帳號、不啟動試用、不 OAuth、不上傳資料、不改網站設定。

| 工具 | 官方現況 | 對私享家流程的判定 |
|---|---|---|
| Searchable | 官方文件描述 9 個 AI 平台的 visibility、mentions、share of voice、競品追蹤、citation analysis，並列出 GA4／GSC 整合與週期報表。 | **候選（未啟用）**：可作 AEO/GEO 競品與 citation 觀測，但需先取得使用者對帳號、試用、OAuth 的明確授權。 |
| Perplexity | 官方 crawler 文件區分 `PerplexityBot`（搜尋結果引用）與 `Perplexity-User`（使用者請求抓取），建議在 robots.txt 放行並允許官方 IP。 | **技術控制已通過**：本日 live robots 與爬蟲 HTTP 盤點均未見阻擋；是否實際引用仍未量測。 |
| Julius AI | 官方 quickstart 支援 CSV、Excel、JSON、PDF 等上傳及資料連線；隱私政策提供刪除／DPA 說明，但不能把政策當成個案授權。 | **僅可分析去識別化彙總**：目前不上傳 GA4/GSC 原始資料、不連線帳戶。 |
| Clay | 官方定位為 CRM／warehouse／signals 與 enrichment 的 GTM 資料層，含 audience、名單與外展流程；FAQ 說明資料限工作區成員並由使用者選擇整合。 | **暫不使用**：目前沒有已授權的合法客戶／商業名單用途；禁止上傳匿名訪客、客戶個資或原始 GA4 identifiers。 |

## 與今日索引工作的關聯

- Searchable 的官方建議仍把內容品質、結構化資料、可被引用的權威來源與週期趨勢放在前面；因此今天先驗證站上 15 個 AI 入口可讀，再處理 6 個 GSC discovered-not-indexed 頁與 PR #30 的品質閘門。
- Perplexity 的 crawler 可讀是必要條件，不是 Google／Perplexity 已收錄或已引用的證據；兩者在報告中分開記錄。
- 沒有任何付費、帳號、OAuth、外部表單或資料上傳動作；若要啟用任一 SaaS，先取得明確授權並另寫資料最小化與撤銷方案。

## 官方來源

- [Searchable visibility tracking docs](https://docs.searchable.com/using-searchable/visibility-tracking)
- [Perplexity crawler documentation](https://docs.perplexity.ai/docs/resources/perplexity-crawlers)
- [Julius quickstart](https://www.juliuscontent.com/docs/get-started/quickstart)／[Julius privacy policy](https://julius.ai/privacy-policy)
- [Clay Audiences](https://www.clay.com/audiences)／[Clay FAQ privacy](https://www.clay.com/faq)

## 20:05 官方頁面重查（只讀）

本次重查以各家目前公開官方頁為準，沒有建立帳號、啟動試用、OAuth、上傳資料或改站台設定。

- **Searchable：候選，不啟用。** 官方品牌頁描述跨 ChatGPT、Claude、Perplexity、Gemini、Copilot 與 Google AI 等引擎的 visibility、mention、citation、競品與 referral attribution；這是產品自述，不能當成私享家已取得曝光或流量。若要用 GA4/GSC 整合，仍須先取得明確授權。
- **Perplexity：技術必要條件已核對。** 官方 crawler 文件把 `PerplexityBot`（搜尋結果與連結）和 `Perplexity-User`（使用者請求）分開，並要求以官方 IP 清單與 robots 規則為準；本次不把可抓取誤寫成已引用。
- **Julius AI：只保留去識別化彙總分析選項。** 官方資料分析頁支援上傳／連接資料，官方安全頁說明資料在美國處理、可刪除且不拿來訓練模型；這些政策不等於我們已獲得資料處理授權，因此不上傳 GA4/GSC 原始資料或 identifiers。
- **Clay：目前 out-of-scope。** 官方文件定位為客戶／公司資料、受眾與 enrichment 工作流，並說明客戶資料不供模型訓練；私享家目前沒有已授權的合法商業名單用途，故不建立 workspace、不匯入匿名訪客或客戶個資。

官方重查只改變「能力與合規邊界」的證據，不改變 live sitemap、索引數或發布決策；Searchable／Julius／Clay 的實際成效仍為 `unmeasured`。

### 本次官方來源

- [Searchable AI search visibility](https://www.searchable.com/solutions/brands)／[mentions and citations](https://www.searchable.com/features/aeo-insights/mentions-citations)
- [Perplexity crawlers](https://docs.perplexity.ai/docs/resources/perplexity-crawlers)
- [Julius privacy and data security](https://julius.ai/docs/get-started/privacy-and-data-security)／[privacy policy](https://julius.ai/privacy-policy)
- [Clay AI privacy and security](https://university.clay.com/docs/ai-in-clay)
