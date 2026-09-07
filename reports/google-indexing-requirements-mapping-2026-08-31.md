# Google 索引要求與目前站況對照（2026-08-31）

## 判定

目前技術可抓取性不是主要阻塞：live sitemap 32 URL、32/32 HTTP 200、self-canonical 32/32、noindex 0/32、JSON-LD 可解析 32/32；GSC 快照則是 26 indexed、6 discovered-not-indexed。要往 100 頁走，下一個有效槓桿是「值得收錄且有真實需求的頁面」，不是單純增加 URL 或重複送出請求。

## 官方要求轉成 release gate

| Google 官方原則 | 對本專案的可驗證門檻 | 目前證據／判定 |
|---|---|---|
| Sitemap 應只列希望出現在搜尋結果的 canonical URL；提交是發現訊號，不是收錄保證 | live URL 必須 HTTP 200、canonical 自指、可解析、且確實值得被搜尋 | 32/32 通過；24 個候選仍 live 404，不能列入 Google sitemap 或 indexed count |
| URL Inspection／重新抓取請求有配額，且不保證快速或一定收錄 | 只在內容與 live 證據準備好後送一次；以 GSC 狀態與 7/28 日資料驗證 | 今日 IndexNow 33/200 已成功；不把提交數當收錄數，也不重複提交 |
| People-first、原創、第一手經驗與完整解答優先；沒有偏好固定字數 | 每頁要有意圖專屬判斷、限制、作者／來源脈絡與可驗證素材；不能靠字數湊頁數 | PR #30 目前 24 頁正文約 1,160–1,330 字，但 verified real-case assets 0/24，release `NOT READY` |
| Doorway abuse／scaled content abuse 禁止以相似地區或查詢變體製造中間頁 | 每個 URL 要有獨立服務情境與可瀏覽內鏈，不是只換地名；同批 404 內鏈須在 overlay 後閉合 | 24 頁候選仍有 24/48 內鏈目標 404；尚未通過安全閘門，不部署 |
| Canonical、redirect、sitemap 可疊加訊號，但都不是必要或充分條件 | 部署後逐 URL 重驗 canonical、redirect、noindex、正文與 sitemap 一致 | live 32 頁 response header audit：200 32/32、redirect 0/32、X-Robots-Tag 非空 0/32 |

## 今日主實驗與固定控制

- 主變因：六個 `Discovered - currently not indexed` 頁的「答案先行 snippet＋一條情境內鏈」；三個精確缺口已列在 `reports/gsc-six-context-link-audit-2026-08-31.md`。
- 固定控制：live sitemap 32、GSC 26/6 快照、HTTP/canonical/noindex/JSON-LD 全部既有通過值，以及現有 GA4/GSC 缺檔不填 0。
- 判定：未滿 7 日為 `PENDING`；7 日只在 indexed 增加且 impressions／clicks 不下降時 `ADOPT`，否則 `RETEST`；28 日才可作 `ADOPT`／`RETEST`／`REJECT`。

## 官方來源

- [Google：Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google：Ask Google to recrawl your URLs](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)
- [Google：Creating helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
- [Google：Spam policies（doorway abuse／scaled content abuse）](https://developers.google.com/search/docs/essentials/spam-policies)
- [Google：Generative AI search optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)

## 19:12 官方頁面重查

以 Google Search Central 現行頁面重新核對 release gate：

- Sitemap 只應列希望出現在結果中的 canonical、完整絕對 URL；提交只是提示，不保證 Google 下載、抓取或收錄。這與目前 32 live URL／24 候選 404 的判定一致。
- Crawlable links 應使用自然、能說明目標內容的 anchor，避免塞入所有相關關鍵字；因此只補 3 條確認缺口，不增加 sitewide 導覽。
- People-first 自評要求原創資訊、完整解答、第一手經驗與清楚的作者／來源脈絡；目前 PR #30 的 verified real-case assets 為 `0/24`，仍不能放行。
- Doorway abuse 包含以城市／地區相似頁把人 funnel 到同一目的地；scaled content abuse 也涵蓋大量無實質新增價值的自動生成頁。因此下一批 queue 保持「先強化既有頁、證據不足不建新 URL」。

來源： [Helpful content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)、[Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)、[SEO link best practices](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)、[Spam policies](https://developers.google.com/search/docs/essentials/spam-policies)。

## 20:38 Google 官方要求重查（只讀）

- Google 現行 AI 搜尋最佳化指南明確提醒：為每個查詢變體大量建立頁面、主要目的是操縱搜尋或生成式結果，可能落入 scaled content abuse；因此首個 100 頁仍採「少量、高證據、逐批驗證」，不以 URL 數量硬湊。
- Google 的 crawlable links 文件再次確認，發現新頁依賴標準 `<a href>` 連結與清楚 anchor；候選頁的內鏈必須在部署後回到 HTTP 200，不能把 404 目標送進 sitemap。
- Google 的結構化資料通用政策指出，正確標記不保證顯示 rich result，且違反政策可能失去資格；因此 JSON-LD 通過仍不等於收錄或 AI 引用。

官方來源： [AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)、[crawlable links](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)、[structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)。
