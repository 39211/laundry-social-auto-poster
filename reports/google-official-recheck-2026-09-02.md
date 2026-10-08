# Google 官方索引／AI 搜尋規則複核 — 2026-09-02

## 核對來源

以下頁面於 2026-09-02 重新查閱，採 Google 官方文件，不以 SEO 業者說法取代：

1. [Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap?hl=en)
2. [Inspect and troubleshoot a single page](https://support.google.com/webmasters/answer/12482179?hl=en)
3. [Optimizing your website for generative AI features](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide?hl=en)
4. [Google Search's guidance on using generative AI content](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content?hl=en)

## 已確認規則

- Sitemap 是發現／提交提示；只應包含希望出現在搜尋結果的 canonical URL，`lastmod` 必須真實且可驗證。
- URL Inspection 的「URL 在 Google 上」不等於保證會顯示；要求建立索引也不保證收錄或排名。
- Google 的生成式搜尋功能建基於核心 Search 系統；沒有另立的特殊 AEO／GEO 提交捷徑，仍需可索引、對使用者有價值且具差異的內容。
- 使用生成式 AI 大量產生沒有新增價值的頁面，可能違反 scaled content abuse 垃圾內容政策。

## 對目前專案的決策

1. 保留 `DRAFT_ONLY` 候選器：它不能寫站、部署、要求索引或送 IndexNow。
2. 不把 HTTP 200、Sitemap 或 IndexNow 200 當成 Google 收錄證據；以 GSC inspection／coverage 及非品牌曝光確認。
3. 不因「關鍵詞太少」建立同義城市頁；詞只映射到既有服務頁，須等 GSC／GA4／LINE 7／28 日資料替換。
4. Cohort A 仍須通過 pilot 與第一方 provenance gate，未達成前不放量。
