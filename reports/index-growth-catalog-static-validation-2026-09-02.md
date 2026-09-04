# Index-growth catalog 靜態品質驗證 — 2026-09-02

## 可重現命令

在 PR #31 隔離 worktree 執行：

```text
PUBLIC_SITE_BASE_URL=https://sixiangjialaundry.com
npx tsx -e "import {INDEX_GROWTH_CATALOG,validateIndexGrowthPages} from './src/indexGrowthPages.ts'; const r=validateIndexGrowthPages(INDEX_GROWTH_CATALOG,{today:'2026-09-02'}); ..."
```

## 結果

- catalog：24 個 `accepted` 頁。
- `validateIndexGrowthPages(..., { today: "2026-09-02" })`：`ok=true`。
- failures：0。
- 驗證涵蓋 explicit lastmod／revision、citation answer、FAQ／HowTo 長度、來源 provenance、服務父頁、相關連結、價格／競品／placeholder 掃描、停手與限制語句，以及 duplicate／similarity／doorway 檢查。

## 發布界線

這是候選目錄的靜態品質證據，不代表 24 頁已部署或已被 Google 收錄。live 仍只有 33 個 sitemap URL；Cohort A 五頁維持 404，必須等 pilot 7／28 日與新鮮 GSC／GA4 gate 後，才可進入 publish PR。
