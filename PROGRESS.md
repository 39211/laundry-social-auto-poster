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
- 2026-10-18：Item 2 新測試草稿 `test/aeo325PageCopy.test.ts` 已先跑紅：42 項中 28 failed / 14 passed；紅項集中於 r3 文案、FAQ、四頁 HowTo 清除與 descriptions/dates。`npm run typecheck` PASS。初版採「只驗本輪替換文案＋FAQ＋自有 JSON-LD」掃禁詞的解讀；羽絨兩個明確保留區塊含禁詞，已用選擇題請店主裁定，尚未改任何頁面。
- 2026-10-18：Item 2 測試檔與紅測證據以 PARTIAL checkpoint 提交；禁詞驗收範圍仍等待裁定，不把 Item 2 標 DONE。

## 待完成

- Item 0：實作、紅綠驗證、恢復基底頁已完成，將隨本次提交落檔。
- Item 1：fixture 已抽取並驗證，將隨本次提交落檔。
- Item 2：測試先紅已證明並已 checkpoint；禁詞驗收範圍待店主選擇後，完成測試並補綠。
- Item 3：六份 `seo-overrides/` 原位改稿，每頁一個 commit，完成後逐頁 cp 至 `docs/`。
- Item 4：五個可索引網址的 sitemap/AI sitemap `lastmod` 手改至 2026-10-18。
- Item 5–7：全套驗證、production mutation、自證、差異報告、push 並更新 Draft PR #206。

## 未完成狀態

- 尚未完成 Item 1–7；overall STATUS 保持 PARTIAL。
- 不 merge、不 deploy、不呼叫 IndexNow/GSC。
- 2026-10-18：Item 2 測試修整：schema 斷言只選對應頁 URL 的 JSON-LD 頂層自有節點，避免誤掃站共用／巢狀 Offer 服務節點；將全站 sitemap lastmod 驗證拆成獨立測試。測試共 43 項。測試程式修整後、白鞋服務頁完成時，全檔仍以 25 failed / 18 passed 保持紅，失敗皆來自尚未改的其餘五頁或待辦 sitemap lastmod。
- 2026-10-18：Item 3 第 1 頁完成：`services/white-shoe-cleaning.html` 依 r3 更新 lead、三個文案 section、FAQ/FAQPage、meta 與 page-owned schema description/dateModified；保留原 title、H1、hero eyebrow、共享 JSON-LD 與保護區塊。原 `#geo-entity` aside 嵌在被移除的舊文案 section 內，已完整保留並置於新文案後的 `page-shell`。`docs/` 與 `seo-overrides/` bytes 相同；該頁 page-copy 測試 7 passed / 36 skipped，`npm run typecheck` PASS。全域 sitemap 測試仍待 Item 4。
- 2026-10-18：Item 2 禁詞範圍修整：白鞋指南的 `#aeo-u06` 同時含替換的回答與保留的服務交叉連結；測試改成只掃被替換的 `answer-box`，不把保留的 `section-copy` 算進本輪文案。調整前白鞋指南測試誤報保留連結中的「台中全市」；調整後該頁 7/7 測試 PASS。
- 2026-10-18：Item 3 第 2 頁完成：`guides/white-shoe-yellowing.html` 更新 lead 與 `#aeo-u06` answer-box 內文，原 h2、section-copy 交叉連結保留；新增三個文案 section、同步三組 FAQ/FAQPage，並移除舊 HowTo 節點及 WebPage 對該節點的 mainEntity 引用。`docs/` 與 `seo-overrides/` bytes 相同；該頁 7/7 page-copy 測試 PASS，差異 whitespace check PASS。
- 2026-10-18：Item 3 第 3 頁完成：`services/luxury-bag-cleaning.html` 換成 r3 lead、三個文案 section、FAQ/FAQPage 與 metadata；保留對應服務、店家資料與頁面標題欄位，刪除舊 HowTo 節點與其 WebPage 引用。該頁 7/7 page-copy 測試 PASS；`docs/`/`seo-overrides/` bytes 相同，whitespace check PASS。
- 2026-10-18：Item 3 第 4 頁完成：`guides/luxury-bag-mold.html` 依 r3 更新 lead、風險／門市／詢問 section、FAQ/FAQPage 與 page-owned description/dateModified；移除 HowTo 及 WebPage 指向 HowTo 的引用。該頁 7/7 page-copy 測試 PASS；`docs/`/`seo-overrides/` bytes 相同，whitespace check PASS。
- 2026-10-18：Item 3 第 5 頁完成：`services/down-jacket-cleaning.html` 更新 lead、兩個新風險／門市 section、第三個詢問 section、FAQ/FAQPage 與 metadata；保留原 canonical 指向指南、`#consolidated-notice`、相關服務及羽絨頁面區塊，沒有 HowTo 節點。該頁 7/7 page-copy 測試 PASS；`docs/`/`seo-overrides/` bytes 相同，whitespace check PASS。
- 2026-10-18：Item 3 第 6 頁完成：`guides/down-jacket-cleaning.html` 更新 lead、三個文案 section、FAQ/FAQPage 與 page-owned description/dateModified；保留 `#down-price-split` 區塊與指南頁 canonical，刪除舊 HowTo 節點及 WebPage 引用。該頁 7/7 page-copy 測試 PASS；`docs/`/`seo-overrides/` bytes 相同，whitespace check PASS。六頁目前各自測試全綠。
