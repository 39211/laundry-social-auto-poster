# AEO325-B-r2 Report

STATUS| PARTIAL
BASE| 766ada1c

## Item 0 — 拆 overlay 與 slug 級豁免

- 已把六份 `docs/services/`、`docs/guides/` 目標頁及兩份 sitemap 還原至基底 `766ada1c`。
- 已從 `src/generatePublicSite.ts` 拆除精簡 HTML overlay 型別、資料、builder、root 開關、AEO325 sitemap lastmod 參數與相關分支。保留 `loadAeo325Guardrail`、`assertAeo325PublicOutputSafety`、sitemap 過濾掛鉤與 `SOURCE_PROJECT_ROOT`（僅供 guardrail 設定載入/掃描）。
- `config/aeo325/public-url-baseline.json` 現以 slug 級 `pre_existing_slugs` 列出 `down-vest-cleaning`、`gore-tex-jacket-cleaning` 及豁免理由；程式限定清單恰為這兩項。`approvals.json` 未修改，兩列仍未核准。sitemap/AI sitemap/RSS URL 集合 count/hash 基線未修改。
- TDD 紅：在實作前，`npx vitest run test/aeo325Guardrail.test.ts -t "allows only the two legacy slugs anywhere"` 為 1 failed / 16 skipped，舊 API 沒有 `preExistingSlugs` 欄位。綠：`npx vitest run test/aeo325Guardrail.test.ts` 為 17 passed / 0 failed / 0 skipped。實作後首次測試曾因合成 slug 不在正式 325 筆清單而誤測；修正測試從 catalog 選取非豁免 slug 後重跑綠。
- `npm run typecheck`: PASS；本次未暫存 source diff 的 whitespace check 無錯。`git diff --cached --check` 會標出從 `766ada1c` 原樣還原的 HTML 既有尾端空白；沒有為消除提示改寫要求精確還原的基底頁。新加入的 `docs-internal/aeo325/` 輸入檔亦有原始空白行，依契約保持不動。

## 開工基線

- 按契約跑 `npx vitest run test/publicSite.test.ts -t "keeps checked-in public feeds"`。第一次沒設必要的 `PUBLIC_SITE_BASE_URL`，在模組載入期中止、沒有測試結果；設定 `PUBLIC_SITE_BASE_URL` 與 `PUBLIC_IMAGE_BASE_URL` 為 `https://sixiangjialaundry.com` 後重跑，結果 1 failed / 48 skipped。唯一失敗為既有 `2026-09-15-0: expected undefined to be defined`（`test/publicSite.test.ts:2965`，calendar/feed slot 不一致）。這是唯一准許保留的全套基線紅。

## 待完成

- Item 1：由六頁基底 `seo-overrides/` 程式抽取 `base-page-markers.json`。
- Item 2：`aeo325PageCopy.test.ts` 先紅後綠，並覆蓋 FAQ、內容、marker、禁詞、日期、bytes 和 sitemap。
- Item 3–4：六頁原位改稿與兩 sitemap lastmod。
- Item 5：全套測試及完整範圍核對；唯一准許的已知失敗如上。
- Item 6–7：push、更新 Draft PR #206、補齊 REPORT/PAYLOAD。

NOT_DONE| Items 1–7 | 尚未執行；本輪狀態 PARTIAL。
