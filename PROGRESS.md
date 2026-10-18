# AEO325-B-r2 Progress

STATUS| PARTIAL
BASE| 766ada1c
BRANCH| feat/aeo325-guardrail

## 開工卡

- Outcome：拆除 generator overlay，六頁依 r3 final 檔原位更新於 `seo-overrides/` 並同步 `docs/`；325 筆保持未核准，僅兩個舊 slug 可作全域豁免；更新 Draft PR #206。
- Owner/maker：Codex gpt-6-luna；此 worktree 單一 writer。
- Checker：typecheck、Vitest、HTML/URL/hash/slug readback；本輪未另派 checker。
- Authority：使用者契約明確授權分節 commit、push `feat/aeo325-guardrail`、更新 Draft PR #206；不含 merge/deploy/IndexNow/GSC。
- Acceptance：詳見 `REPORT.md`。AI sitemap 基線少一個目標 URL，故 Item 4 與總狀態 PARTIAL。

## 項目狀態

- Item 0 DONE，`66e7f4f9`：還原八個 docs/sitemap 檔、拆除 managed-page overlay、兩個 legacy slug 改為 slug 級豁免；guardrail 17/17 PASS。
- Item 1 DONE，`763e6c03`：程式抽取六頁 × 六集合 fixture；SHA-256 prefix `F4A7AD3088CD5856`。
- Item 2 DONE，`8b77df17` / `e02a8331` / `48c589fa`：page-copy test 先紅後綠，43/43 PASS；保留區塊依契約排除於替換文案禁詞掃描。
- Item 3 DONE，六頁各一個 commit：`311e9473` 白鞋服務、`b3d5c4ed` 白鞋指南、`de64ec0d` 精品包服務、`8b17fb2a` 精品包指南、`6f3e4c04` 羽絨服務、`c9fa40a9` 羽絨指南。六組 docs/override bytes 一致；四頁移除舊 HowTo。
- Item 4 PARTIAL：主 sitemap 五個目標 lastmod 都是 `2026-10-18`；AI sitemap 更新四個原有目標。精品包服務 URL 基線未收錄於 AI sitemap；未新增 URL 以保持集合 hash。
- Item 5 DONE：typecheck PASS；guardrail 17/17、page-copy 43/43 PASS；全套 1697 passed / 1 failed / 19 skipped。唯一失敗與開工基線相同。docs 無新 325 slug；三 sitemap/feed URL hashes 不變。
- Item 6 DONE：`8196fb1f` 已 push；Draft PR #206 內文已更新，readback 為 OPEN/Draft、base `fix/reel-v3-two-reference-images`、branch `feat/aeo325-guardrail`。最終報告提交 push 後再核對 head。
- Item 7 DONE：`REPORT.md` 已完成逐檔說明、驗證數字與 PARTIAL 原因；`PAYLOAD.md` 依最終 head 讀回後產生。

## 限制與下一步

- 沒有在工作區根目錄跑 `npm run generate-public-site`；不合併、不部署、不呼叫 IndexNow/GSC。
- 總狀態維持 PARTIAL，因 AI sitemap 基線不含 `/services/luxury-bag-cleaning.html`，新增會違反 URL 集合 hash 不變。
- 最後收尾：push 最終報告提交、確認 PR head 等於本地 head；寫出含實際 head 的 `PAYLOAD.md`，再記 Vault task summary。
