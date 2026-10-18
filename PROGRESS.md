# AEO325-B-r2 Progress

STATUS| IN_PROGRESS
BASE| 766ada1c
BRANCH| feat/aeo325-guardrail
PARENT_HEAD| 37f617f6

## r3 開工卡

- Outcome：修正掃描副檔名／URL 形狀與 junction 走訪，拆永久 URL 集合 hash，補回白鞋店家卡容器、精品包門市卡及白鞋服務描述同步；維持豁免僅兩個既有 slug，更新 Draft PR #206。
- Owner/maker：Codex；此 worktree 單一 writer。
- Checker：本機 typecheck、指定與全套 Vitest、差異/bytes/PR readback；Opus 複審須交 Claude commander 路由，Codex 不自行派外部席。
- Authority：使用者契約明確授權分節 commit、push `feat/aeo325-guardrail`、更新 Draft PR #206；不含 merge/deploy/IndexNow/GSC。
- Acceptance：按 r3 的 1–7 項驗收；所有不完整項目在 REPORT/PAYLOAD 標 PARTIAL 或 NOT_DONE。

## r3 項目狀態

- 起始工作區乾淨；branch `feat/aeo325-guardrail`、HEAD/PR/remote branch 均為 `37f617f6a0e47d2ef666bb050dc850ef03285b09`，PR #206 為 OPEN/Draft。
- 已確認 `D:\C-moved` 與 `D:\AI-Lanes-work` 存在，C: 可用空間約 18.8 GiB；本輪不產生大型素材。
- Item 1 DONE：`src/aeo325Guardrail.ts` 改為只略過契約的二進位副檔名；結構化文字維持裸 slug，其他文字只檢查兩種 URL 形狀；走訪以 `stat` 跟進 junction/symlink，`realpath` 集合防循環。
- Item 2 DONE：新增 10 個走訪層案例（六種檔案、PNG 黑名單、CSS class、豁免 JS、Windows junction/循環）；先紅後綠。首次有效紅測為 21 passed / 6 failed，紅在 JS/CSS/SVG/HTM/無副檔名與 junction 漏掃；兩個 junction 建立成功、未 skip。
- Item 2 mutation 自證 DONE：僅讀 `.html` 突變 `27 tests: 7 failed`；走訪暫時 `return []` 突變 `27 tests: 7 failed`；兩次都還原後 `27/27 passed`。
- Item 3 DONE：移除 `public-url-baseline.json` 的 sitemap/AI sitemap/RSS URL count/hash；保留 `source_commit` 與兩個豁免 slug。guardrail 改驗三個 URL 集合無非豁免 AEO325 slug，並核對六個受管頁面在 sitemap/AI sitemap 的預期存在/缺席；PageCopy 保留 lastmod、移除 URL 集合比較。指定兩檔合計 70/70 PASS。
- Item 4 test-first checkpoint：新增白鞋 `#geo-entity` section.surface 祖先檢查、精品包可見「門市與收送」及電話檢查；頁面修改前兩項均按預期失敗。

---

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
- Item 6 DONE：`8196fb1f` 已 push；Draft PR #206 內文已更新。最終報告 checkpoint 也已 push，遠端 Git ref 與 PR API readback 的 head 相同；PR 為 OPEN/Draft、base `fix/reel-v3-two-reference-images`、branch `feat/aeo325-guardrail`。
- Item 7 DONE：`REPORT.md` 完成逐檔說明、驗證數字與 PARTIAL 原因；`PAYLOAD.md` 使用最終 remote head，並附於最終回覆。

## 限制與下一步

- 沒有在工作區根目錄跑 `npm run generate-public-site`；不合併、不部署、不呼叫 IndexNow/GSC。
- 總狀態維持 PARTIAL，因 AI sitemap 基線不含 `/services/luxury-bag-cleaning.html`，新增會違反 URL 集合 hash 不變。
- 收尾證據：最終 remote head 已寫入 `PAYLOAD.md`；Vault task summary 記錄最終 head、測試、PR readback 與 AI sitemap partial 原因。
