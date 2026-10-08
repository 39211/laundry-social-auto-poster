# 索引／候選自動化 no-op gate 重驗（2026-09-02）

## 驗證

執行：

```text
npm.cmd exec -- vitest run test/indexingPush.test.ts test/gscCollectScript.test.ts test/seoExposureReview.test.ts test/gscSeoCandidateAutopilot.test.ts
```

結果：4 個 test files、25 tests 全部通過（2026-09-02 07:35 Asia/Taipei）。

## 覆蓋的實際邊界

- Sitemap semantic hash 未變時，IndexNow 選擇空集合，不重送。
- GSC／index inspection 缺失或非當日 freshness 時，候選產生器輸出 `BLOCKED`，不產生內容或發布動作。
- 相同輸入 fingerprint 時，候選輸出 `NOOP`，不重複產生 draft。
- 已有候選頁在七日 cooldown 內，即使數字微變也輸出 `NOOP`。
- GSC／GA4／LINE 任一排程資料缺失時，exposure review 保留 `null` 並輸出 `BLOCKED`／`INCONCLUSIVE`，不把缺資料寫成 0。

## 現場狀態

這些測試證明自動化的安全邊界與去重邏輯，不證明 Google 已收錄或曝光增加。今日 live sitemap 仍 33 URL，最新 GSC 仍 25/32；候選 Cohort A 仍受 pilot 7／28 日與素材 provenance gate 約束。

本輪未改 `src/`、`scripts/`、live HTML、Sitemap、schema 或發布紀錄，也未重送 IndexNow。
