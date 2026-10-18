# AEO325-B-r1 Progress

STATUS| PARTIAL

## 開工卡

- Outcome: 建置拒絕未核准 AEO325 slug 外洩；只改既有白鞋、精品包、羽絨頁，並交 Draft PR。
- Owner / maker: Codex gpt-6-luna（本 worktree 單 writer）。
- Checker: 指定新測試、typecheck、全套 Vitest、建置輸出掃描與 diff 檢查。
- Authority: 僅限任務契約白名單；允許提交 `feat/aeo325-guardrail` 並開 Draft PR；不合併、不部署、不送 IndexNow/GSC。
- Acceptance evidence: 8 條防線回歸、325 筆核准資料、URL 集合基線、六個目標 HTML 的 FAQ/schema 一致、三頁禁詞掃描、全套驗證與 Draft PR。

## 進度

- 2026-10-18：確認位於 `feat/aeo325-guardrail`，工作區乾淨，HEAD `0648e83c`、基底 `766ada1c` 為祖先；D 槽工作目錄存在，C: 可用空間約 21.5 GiB。
- 2026-10-18：Vault 搜尋 `AEO325 approval guardrail draft PR` 與 `AEO325` 均無結果；啟動記憶目前沒有 AEO325 專案狀態。
- 2026-10-18：發現基底 `docs/` 已含 `down-vest-cleaning` 與 `gore-tex-jacket-cleaning` 兩個答案庫 slug（含既有 URL）；清除會和 sitemap URL 集合不變、不動其他頁的限制衝突。已向店主列選擇題，未取得答覆前不移除既有輸出。
- 2026-10-18：讀取 A 單交接、店主事實及三份首批文案；已按 TDD 開始先寫測試，尚未新增 production code。
- 2026-10-18：新增 16 個 guardrail 測試與 sitemap/AI sitemap/RSS URL hash 基線；首次紅測 `npx vitest run test/aeo325Guardrail.test.ts`：14 failed、2 passed、0 skipped，預期失敗訊息為 guardrail module 不存在。紅測摘錄見 `REPORT.md`。
