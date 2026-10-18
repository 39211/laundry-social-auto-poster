# AEO325-B-r1 Report

STATUS| PARTIAL
BASE| 766ada1c

## 實作結果

- `config/aeo325/approvals.json` 有 325 筆，ID 與 `items.json` 一對一；全部 `approved=false`、`index_eligible=false`、`page_mapping=null`，未寫入答案庫草稿文案。
- `src/aeo325Guardrail.ts` 驗證登錄完整性、核准欄位、正文輸出與 sitemap 候選；建置開始時載入設定，結束時掃描 public `docs/`。redirect、noindex、外部 canonical 或不符合 mapping 的 URL 不進 AEO sitemap。
- 審核資料從源碼專案根目錄載入，生成器測試使用臨時輸出目錄時仍掃描該目錄。白鞋與精品包服務/指南、羽絨指南與既有 canonical 羽絨服務頁共 6 個 HTML 由同一 copy data 產生；羽絨服務 canonical 保持指向指南，不建立第二個索引 URL。
- 最終 `docs/` diff 只有 8 檔：
  - `docs/services/white-shoe-cleaning.html`
  - `docs/guides/white-shoe-yellowing.html`
  - `docs/services/luxury-bag-cleaning.html`
  - `docs/guides/luxury-bag-mold.html`
  - `docs/services/down-jacket-cleaning.html`
  - `docs/guides/down-jacket-cleaning.html`
  - `docs/sitemap.xml`
  - `docs/ai-sitemap.xml`
- RSS 未變；`docs/sitemap.xml`、`docs/ai-sitemap.xml`、`docs/rss.xml` 的 URL 集合維持基底 hash：176 / `f0bf667b6f420a6256933e8aa77afe4a5233df10499c420f13f80cecf48eb623`、619 / `63bc7ae57a8977f486c5a36d95ca2e38c36804fb863ee7670e1910934c5fdffd`、216 / `5dd2215c158fa582fe25586f2744110868f72d8840db44035f7e6c1fcdf3d2bd`。五個 sitemap 頁面 URL 與四個 AI sitemap 頁面 URL 的 lastmod 更新為 `2026-10-18`；羽絨服務頁 canonical 到指南，未加入新 URL。

## 已清除的舊頁說法

基底六個目標頁包含「台中全市免費收送」；白鞋泛黃頁有「不保證回白」；精品包頁有「不保證變全新／完全復原」；羽絨頁有「不保證恢復全新蓬鬆」「不承諾除味」，並在舊 FAQ 說「不做消毒或醫療滅菌」。新稿移除上述舊句，沒有加入設備效果、範圍或保證詞。`rg` 對六頁可見 `<body>` 的指定禁詞 regex 命中 0；全 HTML 直接 grep 的百分比命中在 CSS 寬度/圓角設定，不是文案。

## TDD 與驗證

- 首次測試先紅：`npx vitest run test/aeo325Guardrail.test.ts`，當時 16 項中 14 failed / 2 passed，紅因 guardrail module 尚未建立。
- occurrence 上限回歸也先紅：重複兩次 `down-vest-cleaning` 超出基底一次上限時，原實作未報錯；補上數量上限後測試通過。
- production mutation 自證：暫時關閉未核准 slug 的輸出拒絕條件，`npx vitest run test/aeo325Guardrail.test.ts -t 'rejects an unapproved slug in HTML output'` 報 1 failed / 16 skipped（「expected [Function] to throw an error」）；還原後 `test/aeo325Guardrail.test.ts` 17 passed / 0 failed / 0 skipped。
- `npm run generate-public-site`：PASS（設定 `PUBLIC_SITE_BASE_URL` 與 `PUBLIC_IMAGE_BASE_URL` 為正式 canonical host）。完整產生器輸出 145 sitemap URLs，但建置前 docs 基底有 176；產生器另刪改 339 個 docs 檔，包含日更頁。為遵守本任務禁止改日更／其他頁與 URL 集合不變，已恢復所有非目標文件，只留下上列 8 個 docs 檔。故產生器完整輸出與已存在的 docs 基底仍有既有落差，不能宣稱乾淨重生全站輸出完全一致。
- `npm run typecheck`: PASS。
- `npx vitest run test/aeo325Guardrail.test.ts`: 17 passed / 0 failed / 0 skipped。
- `npx vitest run --testTimeout 20000`（站點與圖片 base URL 已設定）：141 files；1,654 passed / 1 failed / 19 skipped。唯一失敗：`test/publicSite.test.ts` 的「keeps checked-in public feeds, calendars, HTML, and image metadata consistent」指出 feed 中 `2026-09-15 slot 0` 在 `docs/content-calendar/2026-09-15.json` 找不到對應 slot。`docs/feed.json` 與該 calendar 對 HEAD 均無 diff；未修改日更資料。
- `git diff --check`: PASS。

## 必須明示的未完成項

1. 基底已有答案庫 slug `down-vest-cleaning` 與 `gore-tex-jacket-cleaning`，共 12 個 slug/path 基底位置，仍在答案資料、sitemap 與舊指南/服務輸出。為遵守不刪既有頁與 URL 集合限制，guardrail 僅允許各檔案不超過基底 occurrence 數；新位置或超額即 fail。店主尚未回覆移除/保留選擇題，故「全 docs 無任何未核准 slug」不成立。
2. 全套 Vitest 有一個與本次檔案無關的現有 feed/calendar 對應失敗；不能標成全套綠。
3. 全站產生器現有輸出 sitemap count 145 與目前 docs 基底 176 不同；全站 generator 會刪改日更 docs。本輪保留基底 URL 集合與日更輸出，不擴大修改 generator 的其他內容流。
4. Draft PR 尚待建立；本報告在提交前更新。

UNSURE| none beyond the unresolved legacy slug choice and baseline feed/calendar inconsistency above.
