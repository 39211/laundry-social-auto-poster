# 索引成長主線／自動化整合隔離稽核 — 2026-09-02

## 整合來源

- 基底：`origin/main`／PR #30 merge `51fb978`（保留 `src/indexGrowthPages.ts` 與其測試）。
- 以隔離 worktree `C:\Users\cyc39\.codex\worktrees\sxj-index-growth-integrated-audit-20260902` 套用四個已審核提交：
  - `73d610e` fail-closed SEO／GSC／GA4 automation
  - `3ab493b` GSC collector handoff test
  - `7bf4831` GA4 collector handoff test
  - `6692a3d` material-variant candidate classification
- 整合後 HEAD：`cabd9e0baffac0dd0ea1739219e1578560f3fecb`（隔離 worktree）。已推送至 `codex/index-growth-main-automation-integrated-20260902`，遠端 SHA 與本機一致；已建立 Draft PR [#31](https://github.com/39211/laundry-social-auto-poster/pull/31)，base `main`、狀態 OPEN、可合併性 `MERGEABLE`。

## 驗證

- `indexGrowthPages`、`publicSite`、GSC candidate、SEO exposure、GA4／GSC collector handoff：6 files／68 tests PASS。
- `indexNow.test.ts`：5/5 PASS。
- `tsc --noEmit`：PASS。
- `PUBLIC_SITE_BASE_URL=https://sixiangjialaundry.com` 已明確設定；未設定時的失敗已在前一份 main 隔離稽核重現。
- GitHub Actions：PR #31 已觸發 workflow；run `33575804361` 的 `typecheck-and-test` 已完成成功。`.github/workflows/ci.yml` 僅在 pull request 或 push `main` 時觸發，因此以該 run 的實際結果為準。

### Full-suite recheck

- 隔離整合線完整 `vitest run`：92 files；769 passed、16 skipped；1 個 `loggingConcurrency.test.ts` 測試因 Windows `EPERM` 開啟暫存 `.lock` 檔失敗，整體 exit 1。
- 隨後單獨重跑該檔案：2/2 PASS，表示目前是可重現的間歇性共享／檔案鎖環境問題；未將它改寫成索引成長測試通過，也未在本輪修改 `src/logging.ts`。

### GitHub Actions remote verification

- PR #31 草稿的 CI run `33575804361` 已完成：`typecheck-and-test` job 通過，包含 `npx tsc --noEmit` 與完整 `npx vitest run`。
- GitHub 僅附帶 Node.js 20 deprecation annotation；沒有失敗 job 或測試失敗。

## 發布界線

- 這是程式整合驗證與 GitHub 候選分支，不是 live 發布授權；沒有合併 `main`、沒有網站部署、沒有加入 sitemap、沒有要求 Google 建立索引、沒有送 IndexNow。
- live 仍以 33 URL、pilot 200、Cohort A 五頁 404 為準；最新 GSC／GA4 仍待今日排程輸出。
- 只有 pilot 7／28 日 gate、素材 provenance、live 200 與新鮮 GSC／GA4 通過後，才可建立發布 PR 並推送。
