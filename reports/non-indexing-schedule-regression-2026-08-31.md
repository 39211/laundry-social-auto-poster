# 非索引流程回歸紀錄 — 2026-08-31

## 重現

- 完整 `npm.cmd test`：89 個 test files 中 88 通過、1 失敗；754 個 tests 中 753 通過、1 失敗。
- 同一測試再次獨立重跑仍失敗：`test/scheduleAhead.test.ts` → `skips a reel slot whose video is deferred instead of downgrading it to an image post`。
- 錯誤固定為：`Refusing image fallback for reel slot 3: Video file is missing for slot 3: docs/assets/2026-09-21/slot-03.mp4.`

## 根因邊界

測試 fixture 將 slot 3 標成 `media_type=reel` 並指向不存在的 MP4；`resolveSlotPublishMedia` 在 `src/postCurrentSlot.ts:154` 對 Reel 缺檔丟出拒絕 fallback 的例外，未回到 `scheduleAhead` 的 skipped 結果。這是排程／影片流程的既有 dirty-worktree 回歸，不是 SEO、sitemap、GSC 或 IndexNow 邏輯。

## 判定與處置

- 這次已完成同一干擾條件的重現，結果一致；不是一次性測試抖動。
- 本回合遵守 heartbeat 邊界，沒有修改 `src/`、`scripts/`、影片檔、排程或發布紀錄，也沒有為了讓 suite 變綠而新增假 fixture。
- SEO focused tests 與 typecheck 仍維持先前 `50/50 PASS`／`tsc --noEmit PASS`；但整體 suite 必須標為 `1 regression unresolved`，不能宣稱全套通過。

後續若要修復，需在獨立授權 PR 中決定「缺 Reel 素材應回傳 skipped」的控制流與 fixture 契約，修正後重跑同一測試、完整 suite 與既有發布閘門；不與 100 頁內容變更混在同一 patch。
