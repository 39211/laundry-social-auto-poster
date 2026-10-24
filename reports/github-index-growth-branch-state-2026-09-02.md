# GitHub／live 索引成長分支狀態 — 2026-09-02

## 核對結果

`gh pr view 30` 已確認 PR #30 狀態為 `MERGED`，base=`main`、head=`codex/index-growth-100-phase1`，merge commit=`51fb97874cdfc5fc2282b59d31fc6028caf0b4c2`，合併時間為 2026-09-01 19:56:03 UTC。

| 對象 | commit | sitemap URL 數 | 意義 |
|---|---|---:|---|
| `origin/main` | `51fb978` | 26 | PR #30 合併後的主線基線；不等於 Google indexed 數 |
| `origin/still-material-optics` | `6692a3d` | 目前工作樹 33 | live SEO／pilot 分支；已推送且遠端一致 |
| `origin/deploy/index-growth-pilot-20260902` | `622ae1e` | 含大量資產變更 | 不作本輪發布來源，避免把全量資產樹帶入部署 |

## 重要界線

- `origin/main` 的 `research/index-growth-100/topic-inventory.csv` 把 24 個頁面標成 `accepted/generated`，這是研究／候選狀態，不是 live 或 Google indexed 證據。
- 目前 live sitemap 的 33 URL 包含既有頁與 `shoe-odor-source` pilot；Cohort A 五頁仍不在 live sitemap，直接 URL 為 HTTP 404。
- GitHub commit、Pages HTTP 200、sitemap URL 數與 Google Search Console indexed count 必須分開記錄。

## 本輪決策

- 不合併或推送 `deploy/index-growth-pilot-20260902` 的大量資產差異。
- 不把 24 個 accepted rows 直接加入 sitemap，也不提前宣告 100／150／200 里程碑。
- 等 pilot 7／28 日 gate 與新鮮 GSC／GA4 後，才決定第一個 4–6 頁批次。
