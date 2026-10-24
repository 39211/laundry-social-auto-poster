# Bing 索引與曝光基線（2026-09-01）

時區：Asia/Taipei。資料直接讀取已登入的 Bing Webmaster Tools；本報告不把提交或抓取資格誤寫為已收錄。

## 現況

| 面向 | 實際觀察 | 判讀 |
| --- | --- | --- |
| Sitemap | `https://sixiangjialaundry.com/sitemap.xml` 已提交、最後提交與最後爬取均為 2026-08-29、狀態成功、發現 32 URL、錯誤 0、警告 0 | 不需重送 sitemap。 |
| Site Explorer（過去 6 個月） | Indexed 1、Error 0、Warning 4、Excluded 15；工具已知 URL 20 | Bing 的實際收錄遠低於 sitemap 發現數，屬於抓取／選擇收錄階段，不是 sitemap 格式錯誤。 |
| Bing 搜尋效能（3 個月，至 2026-08-30） | Clicks 0、Impressions 0 | 沒有 Bing 自然曝光，不能用 Google 的 26/32 收錄替代。 |
| Bing AI Performance（3 個月，至 2026-08-30） | Total citations 0、Average cited pages 0 | 目前沒有 Microsoft Copilot／合作夥伴 AI 的可觀測引用。 |
| 主力頁 URL Inspection | `https://sixiangjialaundry.com/services/shoe-bag-care.html` 為「已發現但尚未爬取」，發現於 2026-08-18，不能在 Bing 顯示 | 優先處理洗鞋洗包頁，而不是對 32 頁批次重送。 |

## 今日方策：單頁 Bing 索引請求實驗

- 主要變因：僅對 `services/shoe-bag-care.html` 做一次 Bing Webmaster「請求索引」。
- 固定控制：既有 canonical、robots、32 URL sitemap、IndexNow 成功紀錄、其他 URL 和內容皆不動。
- 未執行原因：該按鈕會向 Bing 提交外部索引請求；本輪只完成診斷並保留按鈕待使用者當下確認。
- 7 日判定（2026-09-08）：URL Inspection 是否由「已發現但尚未爬取」變成已爬取／已索引。未變則 `PENDING`，不得重複點送。
- 28 日判定（2026-09-29）：該頁是否已索引且 Bing 出現非零 impressions；兩者皆為否才 `RETEST` 技術／內容診斷，絕不擴大到薄頁批量提交。

## 其他發布邊界

- live sitemap 於 2026-09-01 重查為 HTTP 200、32 URL；與 2026-08-31 IndexNow 成功批次 URL 數相同，因此未重送。
- PR #30 雖 CI 成功，但獨立複核仍為 `REWRITE / CANNOT SHIP`：registry key／record identity 未綁定，且 accepted export 將日期寫死。24 個候選頁不得合併、部署、加入 sitemap 或提交。
- Bing URL Inspection 的即時抓取測試啟動後，儀表板未回傳可判定結果；此項記為 `unmeasured`，不據此宣稱可抓取。

## 證據入口

- Bing Webmaster Tools：Sitemaps、Site Explorer、Search Performance、AI Performance、URL Inspection（登入帳號畫面）。
- Google 快照：[data/insights/gsc-index/2026-08-31.json](../data/insights/gsc-index/2026-08-31.json)
- IndexNow 成功紀錄：[output/operations/indexing-push-2026-08-31.json](../output/operations/indexing-push-2026-08-31.json)
- PR #30 獨立複核：[reports/pr30-mutation-repair-v4-review-2026-09-01.md](pr30-mutation-repair-v4-review-2026-09-01.md)
