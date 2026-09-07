# IndexNow／sitemap 傳播核對 — 2026-09-02

## 結果

- 首頁與 `services/shoe-bag-care.html` 今天有真實內鏈變更，因此本機 sitemap 的兩個 `<lastmod>` 已更新為 `2026-09-02`。
- `publish-pages` 已完成；GitHub Pages Actions run `33562731871` 為 `success`，root Pages `main` commit 為 `18e9bc512d77a5e5fb3662d8f77dae6ee1a347cf`。
- 同日第一次 `indexing-push` 執行時，live sitemap 尚未完成傳播，故 `submitted=0`、`indexnow_status=skipped`。
- 傳播完成後重新讀取 live sitemap：HTTP 200、33 URL、pilot 存在，首頁與鞋包服務頁 `<lastmod>` 均為 `2026-09-02`。
- 因 live sitemap 已較第一份報告更新，依既定規則做唯一一次修正提交：`submitted=2`、`indexnow_status=200`，目標為首頁與鞋包服務頁。

## 解讀邊界

這只證明 sitemap 已更新、Pages 可服務且 IndexNow API 接受兩個變更 URL；IndexNow 不代表 Google 已收錄。下一個排程窗口依語義 hash 與 `<lastmod>` 決定是否跳過；GSC 收錄仍只接受 URL Inspection／Page Indexing 證據。

## 證據

- `output/operations/indexing-push-2026-09-02.json`
- `docs-internal/index-growth-100-evidence-manifest-2026-09-02.json`
- `reports/live-sitemap-url-audit-2026-09-02.md`
- `https://github.com/39211/39211.github.io/actions/runs/33562731871`
