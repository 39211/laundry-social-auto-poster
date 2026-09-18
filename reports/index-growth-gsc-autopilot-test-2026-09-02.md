# GSC 候選自動化 fail-closed 驗證（2026-09-02）

## 結果

`npx.cmd vitest run test/gscSeoCandidateAutopilot.test.ts`：1 個 test file、12/12 tests passed。

## 保護行為

在當日 GSC collection cycle 缺失時，正式輸出為 `status: BLOCKED`、`candidate: null`、`reason_codes: ["current_collection_cycle_missing"]`，並列出以下禁止動作：

- 不生成內容
- 不寫入公開網站
- 不部署
- 不要求 GSC 建立索引
- 不送 IndexNow
- 不發出網路候選查詢
- 不建立反向連結或外部 listing
- 不新增 URL

目前產物：`output/operations/gsc-seo-candidates/2026-09-02.json`。這只證明自動化在資料不足時會停車，不代表任何頁面已被 Google 收錄或獲得曝光。
