# Index-growth release boundary — 2026-08-31

## Set comparison

以隔離輸出的 `docs/sitemap.xml` 與 live `https://sixiangjialaundry.com/sitemap.xml` 做 unique URL set diff，再對差集逐一執行 HTTP HEAD：

- 隔離輸出：56 URLs
- live：32 URLs
- 差集：24 URLs
- 差集 HTTP 404：24/24

差集就是目前尚未部署的 24 個候選 guide；沒有一個可被算成 live、可抓取或已收錄頁面。

## Decision

`NOT DEPLOYED`。目前不能把隔離 sitemap 的 56、IndexNow submission 或 generator exit 0 報成 live index growth。只有在 production gate、獨立複審與 HTML／SEO-only overlay 成功後，才可重新做同一個 set diff；預期 live sitemap 先變成 56，之後再以 GSC coverage／inspection 驗證 indexed count。

本次只讀比對沒有 commit、push、部署、IndexNow 重送，也沒有修改 `src/`、`scripts/`、排程或發布紀錄。

## 16:39 remote candidate recheck

- 直接從 PR #30 HEAD 的 `topic-inventory.csv` 讀出 24 個 `publish_state=accepted`／`gsc_state=generated` 候選，對每個 URL 使用 GET（而非 HEAD；此站對 HEAD 不能提供可靠狀態）。
- 結果：HTTP 404 **24/24**、非 404 **0**。因此差集仍是完整未部署集合；sitemap 的 live 計數仍為 32。
- `clothing-mold-airing` 已被安全審查降為 draft，故即使未來 overlay，也應先以 23 頁／55 URLs 作保守上限，不能直接宣稱 24／56。
