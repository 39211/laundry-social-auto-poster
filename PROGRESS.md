# AEO325-B-r1 Progress

STATUS| PARTIAL

## 開工卡

- Outcome: 建置拒絕未核准 AEO325 slug 外洩；只改既有白鞋、精品包、羽絨頁，並交 Draft PR。
- Owner / maker: Codex gpt-6-luna（本 worktree 單 writer）。
- Checker: 新 guardrail 測試、typecheck、全套 Vitest、建置輸出掃描與 diff 檢查。
- Authority: 契約白名單；允許提交 `feat/aeo325-guardrail` 並開 Draft PR；不合併、不部署、不送 IndexNow/GSC。
- Acceptance evidence: 325 筆核准資料、8 條防線回歸、三 sitemap/feed URL 集合 hash、六個目標 HTML FAQ/schema 同步、禁詞掃描、全套驗證與 Draft PR。

## 進度

- 2026-10-18：確認在 `feat/aeo325-guardrail`，初始 HEAD `0648e83c`、基底 `766ada1c` 為祖先；D 槽工作目錄存在，C: 可用空間約 21.5 GiB。
- 2026-10-18：Vault 搜尋 `AEO325 approval guardrail draft PR` 與 `AEO325` 無結果；啟動記憶沒有 AEO325 專案狀態。
- 2026-10-18：基底 `docs/` 已含 `down-vest-cleaning` 與 `gore-tex-jacket-cleaning` 答案庫 slug。移除會破壞 URL 集合不變與不動其他頁限制；已用選擇題詢問店主，未收到答覆，暫時保留並記錄精確基底次數。
- 2026-10-18：讀取 A 單交接、店主事實及三份 final 文案；依 TDD 先寫測試。
- 2026-10-18：首次紅測 16 項中 14 failed / 2 passed，錯誤為 guardrail module 不存在；摘錄見 `REPORT.md`。
- 2026-10-18：加入 `src/aeo325Guardrail.ts`、325 筆全未核准 `approvals.json`，連接生成器載入檢查與建置後 `docs/` 掃描；新測 17/17 綠、typecheck 通過。
- 2026-10-18：全站測試發現臨時輸出根目錄不含專案設定；改為從源碼所在專案載入核准資料，仍掃描各自的輸出目錄。指定的 6 個舊測試套件 101 項通過。
- 2026-10-18：加入 base collision occurrence 上限；先寫的回歸測試紅，再實作限制，避免已存在頁面能無上限新增同一 slug。production mutation 自證紅後已還原。
- 2026-10-18：`npm run generate-public-site` 成功；完整產生器把 339 個 docs 檔改動（含既有日更輸出刪除），產出的 sitemap 為 145 URLs，與檢查前的基底 176 URLs 不一致。已將非本任務輸出恢復，只保留 6 個目標 HTML 與兩份 sitemap 日期欄位，RSS 未改；最終 docs diff 8 檔。
- 2026-10-18：目標頁可見正文禁詞檢查為 0；FAQ 可見文字與 JSON-LD 相同；羽絨服務 canonical 仍指指南。sitemap、AI sitemap、RSS URL 集合 hash 與基底相同。
- 2026-10-18：`npm run typecheck` PASS；`npx vitest run test/aeo325Guardrail.test.ts` 17/17 PASS；`npx vitest run --testTimeout 20000` 1,654 passed / 1 failed / 19 skipped。唯一失敗是既有 `docs/feed.json` 的 `2026-09-15 slot 0` 在當日 calendar 找不到相符 slot；兩份輸入均與 HEAD 相同，未改它們。

## 下一步

- 更新最終 `PAYLOAD.md`，提交本輪程式與頁面變更，推送 `feat/aeo325-guardrail`，用指定 base 建 Draft PR；不合併、不部署。
- STATUS 維持 PARTIAL：全套有一個未修既有資料錯誤；答案庫兩個舊 slug 仍在既有公開頁。完整生成器本身的 sitemap URL count 也與既有 docs 基線不同，需在 PR 明示。
- 2026-10-18：第一批三項內容已套入六個既有 HTML，並將五個 sitemap、四個 AI sitemap 頁面 lastmod 設為 2026-10-18；RSS 不變。`git diff --check` PASS，URL 集合基線測試 PASS。
