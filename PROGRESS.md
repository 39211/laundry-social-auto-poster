# AEO325-B-r2 Progress

STATUS| PARTIAL

## 開工卡

- Outcome: 拆除 generator overlay，讓六頁依 `docs-internal/aeo325/final-*.md` 原位更新在 `seo-overrides/`，同步 `docs/`，保持 AEO325 325 項未核准，僅對兩個舊 slug 做明確全域豁免，並交 Draft PR #206。
- Background: B-r1 overlay 會重畫六頁並覆蓋 SEO 手工頁；occurrence 白名單會被真實資料的新增站內連結觸發而令每日建置失敗。
- Deliverable: guardrail slug 豁免、六頁原位文案、fixture/測試、sitemap lastmod、PROGRESS/REPORT/PAYLOAD、更新 Draft PR。
- Constraints: 基底 `766ada1c`；分支 `feat/aeo325-guardrail`；按契約白名單寫入；不跑工作區根目錄 `npm run generate-public-site`，不改其他頁、不裝套件、不合併、不部署、不呼叫 IndexNow/GSC；同一 worktree 單 writer。
- Acceptance: typecheck、guardrail 與新 page-copy 測試、全套 Vitest（僅准保留開工基線失敗）、URL 集合 hash、逐頁 HTML/FAQ/schema/禁詞/日期核對、docs 與 seo-overrides byte 相同、突變紅後還原綠、diff/遠端 PR head readback。
- Owner / maker: Codex gpt-6-luna，本 worktree 單 writer。
- Checker: 自動測試、`git diff`/hash/readback；此輪未另派 checker。
- Authority: 契約明確授權分節 commit、push 本分支並更新 Draft PR #206；不含 merge、deploy 或索引提交。
- Evidence: 測試輸出、URL 集合 SHA-256、commit SHA、PR head、REPORT.md 與 PAYLOAD.md。

## 已完成

- 2026-10-18：開工時 `feat/aeo325-guardrail` HEAD=`852fc5f3`; 工作樹乾淨；`D:\C-moved` 與 `D:\AI-Lanes-work` 存在。
- 2026-10-18：戰情板顯示 AEO325-B-r2 進行中；Vault 搜尋 `aeo325` 無結果。嘗試讀取 `00-System/00-Start-Here.md`，該路徑不存在；依指示讀取 live `02-Current/Current-Context.md`。
- 2026-10-18：基線 `npx vitest run test/publicSite.test.ts -t "keeps checked-in public feeds"` 首次因未設 `PUBLIC_SITE_BASE_URL` 在載入期中止；設正式站點 `https://sixiangjialaundry.com` 後重跑，結果為 1 failed / 48 skipped，唯一紅為既有 `2026-09-15-0: expected undefined to be defined`。
- 2026-10-18：slug 豁免測試先紅：`npx vitest run test/aeo325Guardrail.test.ts -t "allows only the two legacy slugs anywhere"` 得 1 failed / 16 skipped，舊設定沒有 `preExistingSlugs`。更換測試實例為正式 325 清單中的非豁免 slug 後，`npx vitest run test/aeo325Guardrail.test.ts` 為 17 passed / 0 failed / 0 skipped。
- 2026-10-18：Item 0 實作完成：將基底八份 docs/sitemap 檔還原；拆除 generator 的 `AEO325_PAGE_COPIES`、page builder、root 開關及所有 `includeAeo325Lastmod` 分支；保留 guardrail 載入、輸出檢查、sitemap 過濾掛鉤與 `SOURCE_PROJECT_ROOT`。
- 2026-10-18：`config/aeo325/public-url-baseline.json` 將 path/count 記錄改為僅含 `down-vest-cleaning`、`gore-tex-jacket-cleaning` 的 slug 級豁免與理由；URL 集合基線 count/hash 欄位未變，approval 仍全部未核准。
- 2026-10-18：Item 0 `npm run typecheck` PASS；`npx vitest run test/aeo325Guardrail.test.ts` 17/17 PASS；unstaged source diff 的 whitespace check 無錯。`git diff --cached --check` 會指出從 base 原樣還原的 HTML 既有尾端空白；未為消除提示而改寫基底頁。
- 2026-10-18：Item 0 已提交 `66e7f4f9`（`Remove AEO325 managed page overlay`）。
- 2026-10-18：Item 1 使用 Node 從 `git show 766ada1c:seo-overrides/<path>` 抽取六頁 marker 集合並產生 `test/fixtures/aeo325/base-page-markers.json`；每頁包含 meta name、meta property、link rel、JSON-LD @type、section/aside id、script src 六個去重排序集合。六頁集合數依序為 11/8/2/21/5/2、11/8/2/24/3/2、11/8/2/24/2/2、11/8/2/24/2/2、11/8/2/21/2/2、11/8/2/24/3/2。
- 2026-10-18：重跑 REPORT 所附抽取程式後，fixture 結構驗證為 6 頁 × 6 個陣列；SHA-256 開頭 `F4A7AD3088CD5856`。

## 待完成

- Item 0：實作、紅綠驗證、恢復基底頁已完成，將隨本次提交落檔。
- Item 1：fixture 已抽取並驗證，將隨本次提交落檔。
- Item 2：先紅後綠建立 `test/aeo325PageCopy.test.ts`。
- Item 3：六份 `seo-overrides/` 原位改稿，每頁一個 commit，完成後逐頁 cp 至 `docs/`。
- Item 4：五個可索引網址的 sitemap/AI sitemap `lastmod` 手改至 2026-10-18。
- Item 5–7：全套驗證、production mutation、自證、差異報告、push 並更新 Draft PR #206。

## 未完成狀態

- 尚未完成 Item 1–7；overall STATUS 保持 PARTIAL。
- 不 merge、不 deploy、不呼叫 IndexNow/GSC。
