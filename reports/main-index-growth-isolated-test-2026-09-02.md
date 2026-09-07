# main 索引成長系統隔離驗證 — 2026-09-02

## 測試環境

- worktree：`C:\Users\cyc39\.codex\worktrees\sxj-index-growth-main-audit-20260902`
- commit：`51fb978`（`origin/main`，PR #30 merge commit）
- `src/indexGrowthPages.ts`：存在
- `test/indexGrowthPages.test.ts`：存在
- 測試使用 `PUBLIC_SITE_BASE_URL=https://sixiangjialaundry.com`

## 結果

- `vitest run test/indexGrowthPages.test.ts test/publicSite.test.ts`：2 files／47 tests PASS。
- `tsc --noEmit`：PASS。
- 初次未設定 `PUBLIC_SITE_BASE_URL` 時，`publicSite.test.ts` 會因 LINE redirect URL 前置條件失敗；補上正式站 URL 後完整回綠。這是可重現的環境前置條件，不是忽略測試。

## 判定

主線索引成長程式可建置且測試可通過；但測試綠燈只證明程式契約，不代表 24 個候選已部署、已收錄或已帶來曝光。候選仍須遵守 pilot 7／28 日、素材 provenance、live 200 與 sitemap／IndexNow 邊界。
