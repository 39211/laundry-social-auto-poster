# AI entrypoint host-link audit（2026-08-31）

## 範圍

檢查 live `llms-full.txt`、`ai-discovery.json`、`llms.txt`、`answers.json`、`sitemap.xml` 與 `robots.txt` 內的 `39211.github.io` 舊鏡像引用。這是 read-only 稽核。

## 結果

| 入口 | 舊鏡像出現次數 | unique 字串 | 判讀 |
|---|---:|---:|---|
| `llms-full.txt` | 23 | 2（同一 CTA 的標點變形） | **REVIEW／GEO conversion blocker** |
| `ai-discovery.json` | 23 | 2（同一 CTA 的標點變形） | **REVIEW／GEO conversion blocker** |
| `llms.txt` | 0 | 0 | 通過 |
| `answers.json` | 0 | 0 | 通過 |
| `sitemap.xml` | 0 | 0 | 通過 |
| `robots.txt` | 0 | 0 | 通過 |

兩個含鏡像的入口各自仍 HTTP 200，問題不是可抓取性或額外索引頁：兩個 host 的 `/go/line.html` 都明確 `noindex, nofollow`。風險是 AI 讀取到的公開 CTA 可能導向非 canonical host，影響轉換與歸因；首頁 HTML 另有 13 次 occurrence（2 種相同 CTA 的 URL 變形），合併看是 feed 與首頁共用來源尚未完全 canonicalize。

## 來源追蹤

- 在 `ai-discovery.json` 的 `published_posts` 中，鏡像 occurrence 來自 13 筆貼文記錄、共 23 次欄位內容 occurrence；日期範圍為 2026-08-14～2026-08-19。
- 受影響欄位是 `facebook_caption`／`instagram_caption` 的公開 CTA，不是 23 個不同 sitemap URL。修正範圍應是資料來源與 feed 重產，不應建立新頁或複製貼文。

## 修正與驗收邊界

1. 在授權 PR 中將舊鏡像 CTA 改為 `https://sixiangjialaundry.com/go/line.html`，保留 source 參數與原有追蹤語意。
2. 重新產生四個 AI 入口與首頁，驗證舊鏡像 occurrence 為 0、canonical host occurrence 正確、HTTP 200、JSON parseable 與 sitemap 覆蓋不變。
3. 不把修正後的 feed HTTP 200 或 URL 數當作 AI 引用／Google 收錄證據；citation 仍需外部實測或標示 `unmeasured`。
