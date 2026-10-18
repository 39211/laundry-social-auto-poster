# AEO325-B-r1 Report

STATUS| PARTIAL

## 已完成

- 核對正式 worktree：`feat/aeo325-guardrail`，初始 HEAD `0648e83c`，基底 `766ada1c` 是其祖先。
- 確認 `D:\C-moved`、`D:\AI-Lanes-work` 存在；C: 可用空間約 21.5 GiB。
- 新增 `test/aeo325Guardrail.test.ts`，先寫測試再碰 production code；另保存三份公開 URL 集合基線於 `config/aeo325/public-url-baseline.json`。

## TDD 紅測證據

命令：`npx vitest run test/aeo325Guardrail.test.ts`

```text
❯ test/aeo325Guardrail.test.ts (16 tests | 14 failed)
Tests  14 failed | 2 passed (16)
```

預期失敗訊息：`AEO325 guardrail module must exist before its behavior can be exercised: expected undefined to be defined`。此時 `src/aeo325Guardrail.ts` 尚不存在；兩個通過案例確認基底 sitemap、AI sitemap、RSS URL hash，及六個目標頁當前可見 FAQ 與 FAQ JSON-LD 相符。

## 尚未完成

- 防線、325 筆 approvals、六頁上稿、全套驗證、突變自證、Draft PR 均未完成。
- 基底文件已有 `down-vest-cleaning` 與 `gore-tex-jacket-cleaning` 答案庫 slug，包含在既有頁面及 sitemap 中；清掉會破壞要求的 URL 集合不變與其他頁不變。店主已收到選擇題，尚未回覆；先保留原狀。
