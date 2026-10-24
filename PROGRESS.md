# AEO325-B-r3 Progress

STATUS| DONE
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
- Item 4 DONE：白鞋 `#geo-entity` 已回到 `section.section.surface` 內的雙欄，詢問內容在另一欄；精品包逐字補回基底「門市與收送」article/card，置於三段新文案後、對應服務前；泛黃指南 Service description 與白鞋服務頁 `#service` 節點相同。三頁 docs/override 位元同步；六頁 JSON-LD 及 PageCopy 45/45 PASS。
- Item 4 mutation 自證 DONE：暫時移除精品包門市卡時 PageCopy 目標測試 `1 failed`；還原後 PageCopy `45/45 passed`。
- Item 5 DONE：基底 marker fixture 以 `D:\AI-Lanes-work\_tmp\aeob\extract_aeo325_base_markers.py` 從 commit `766ada1c` 程式重抽，為六頁新增 `link_rel_alternate_count`（6/7）與 `inline_gtag_config_count`（各 1）；PageCopy marker test 改比數量並明確要求 inline gtag config > 0，45/45 PASS。重抽命令：`python "D:/AI-Lanes-work/_tmp/aeob/extract_aeo325_base_markers.py"`。
- Item 6 DONE：npm run typecheck PASS；指定兩檔 72/72 PASS；CI placeholder env 下 npx vitest run --maxWorkers=4 為 1709 passed / 1 failed / 19 skipped，唯一失敗是既有 publicSite.test.ts:2965 缺少 2026-09-15-0 calendar slot；Qinghai timeout 測試獨跑 PASS。

---

## B-r2 歷史紀錄（已由 r3 結果覆蓋）

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
- Item 6 DONE：npm run typecheck PASS；指定兩檔 72/72 PASS；CI placeholder env 下 npx vitest run --maxWorkers=4 為 1709 passed / 1 failed / 19 skipped，唯一失敗是既有 publicSite.test.ts:2965 缺少 2026-09-15-0 calendar slot；Qinghai timeout 測試獨跑 PASS。
- Item 7 DONE：`REPORT.md` 完成逐檔說明、驗證數字與 PARTIAL 原因；`PAYLOAD.md` 使用最終 remote head，並附於最終回覆。

## 限制與下一步

- 沒有在工作區根目錄跑 `npm run generate-public-site`；不合併、不部署、不呼叫 IndexNow/GSC。
- 總狀態維持 PARTIAL，因 AI sitemap 基線不含 `/services/luxury-bag-cleaning.html`，新增會違反 URL 集合 hash 不變。
- 收尾證據：最終 remote head 已寫入 `PAYLOAD.md`；Vault task summary 記錄最終 head、測試、PR readback 與 AI sitemap partial 原因。

- Item 7 DONE：已推送 feat/aeo325-guardrail 並更新/讀回 Draft PR #206 的 r3 摘要；交付記錄 push 後再核對 remote branch 與 PR head 一致、狀態仍 OPEN / Draft。
- r3 總狀態 DONE；PAYLOAD.md 的 HEAD 欄位記錄最後一個程式與測試驗證 commit dd52973，交付記錄 commit 的實際最終 SHA 以最終 GitHub/remote readback 為準。
# AEO325-B-r4 checkpoint — Item 1 initial red tests

- Branch feat/aeo325-guardrail; starting HEAD d396643b (PR #206 is OPEN / Draft). Initial worktree was clean.
- Added 11 independent temporary-docs-tree cases in test/aeo325Guardrail.test.ts.
- Initial targeted run: npx vitest run test/aeo325Guardrail.test.ts -t "r4 scanner case" --reporter=verbose → 8 failed / 3 passed / 27 skipped (filtered out). Cases 01–08 failed as expected; cases 10–11 passed as expected. Case 09 (uppercase URL) already rejects on the unmodified implementation because the complete source is lowercased before both URL regexes; this differs from the task contract's predicted initial failure and is retained as a regression test.
- Item 1 red evidence is PARTIAL against the literal ①–⑨ must fail condition; the observed result is documented rather than manufacturing a failure.
- Item 2 DONE: every normalized output path now receives strict slug-token scanning, including blacklisted binary extensions; content matching normalizes lowercase, %2f/%3a, escaped slash and escaped backslash; URL patterns accept .html/.htm and use a negative path-token boundary. Full guardrail suite: 38 passed / 0 failed / 0 skipped; all 11 r4 cases match expected behavior.

- Item 3 DONE: replaced URL substring includes with exact pathname-segment matching (slug, slug.html, slug.htm); added a dated feature-post collision regression and direct bare/.html/.htm checks. RED: the feature-post test failed under substring matching; GREEN: `npx vitest run test/aeo325Guardrail.test.ts -t "dated feature-post path|public sitemap" --reporter=verbose` → 2 passed / 0 failed (37 filtered out).
- Item 4 DONE: luxury-bag store/pickup card now contains the specified factual copy only; seo-overrides and docs copies have identical SHA-256 4F43E92F396C603BB409B9345A1C49B9A5522227DF37B6264F83BB6C8DF621BF. PageCopy regression was RED before copy change (1 failed / 44 filtered out) and GREEN after (1 passed / 44 filtered out).
- Item 5 DONE: three temporary production mutations in src/aeo325Guardrail.ts each produced one targeted failing test (path token scan removed: punctuation-delimited path test; %2f normalization removed: encoded JS URL case; negative boundary reverted: newline boundary case). Each mutant was restored byte-for-byte in finally; then all three targeted cases passed together (3 passed / 0 failed / 37 filtered out), and git diff confirmed src has no mutation residue. Added one focused path-token test because the required examples are also caught by the broadened URL regex and would not independently prove the path-token scan mutation.
- Item 6 DONE: npm run typecheck passed; specified Guardrail + PageCopy files passed 85/85; luxury-bag docs/override SHA-256 matched. Default full npx vitest run produced 1721 passed / 2 failed / 19 skipped: the existing 2026-09-15-0 calendar-slot failure plus the Qinghai test timing out at 5s under full-suite load. Qinghai passed alone (1/1). Full rerun with the repository's established stable profile npx vitest run --maxWorkers=4 --testTimeout=15000 produced 1722 passed / 1 failed / 19 skipped; the sole failure was the same existing calendar-slot assertion.
## AEO325-B-r4 final checkpoint

- Status is PARTIAL only because the task required all cases 01–09 to fail before the fix. Case 09 already rejected on the baseline: the full source is lowercased before the URL patterns, so the task's uppercase-regex diagnosis did not reproduce. The rejection test is retained and passes after the fix; no production behavior was weakened to force a red test.
- Items 2–7 are DONE: scanner correction; exact URL segment matching; factual luxury-bag card and docs sync; all three production mutations red then restored green; scoped/typecheck/full validation; branch push and Draft PR #206 body update/readback.
- Report and payload identify the last code/test commit as the validated implementation head. A final readback after the delivery-record commit verifies that the pushed PR head matches the branch.
