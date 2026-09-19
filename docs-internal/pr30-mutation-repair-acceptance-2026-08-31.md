# PR #30 mutation repair acceptance（2026-08-31）

## 目的

把 `probe-index-growth.ts` 已重現的 fail-open 變成不可繞過的 release acceptance。每個案例都必須先以目前 fixture 取得 baseline 綠燈，再套用單一 mutation 變紅，最後還原同一 mutation 回到綠燈；不能只測 helper 或欄位存在。

## 必須通過的六組 mutation

| Case | Mutation | 變紅條件 | 還原條件 |
|---|---|---|---|
| provenance-repoint | 將一頁的 citation／step／section／FAQ source ref 改綁另一個合法 registry ref | immutable locator／摘要／hash 與 claim 不匹配即 `unknown/invalid provenance` | 還原原始 claim-level ref 與 digest 後 baseline 綠燈 |
| revision-arbitrary | 把 `content_revision` 改成同日期的任意 `#999` | revision 必須與 frozen content/cohort hash 綁定，任意序號即 fail | 還原 frozen revision/hash |
| body-change | 改寫正文但保留舊 revision | body hash／revision mismatch 即 fail，即使長度、字數、格式仍合格 | 還原原始正文與 hash |
| mold-safety | 把衣物發霉答案改成戶外抖、刷、拍散霉屑等不安全指示 | safety rule 針對 citation、summary、steps、sections、FAQ 的語意均 fail | 還原安全答案、停手條件與限制後綠燈 |
| registry-blank | 清空 registry record 的 origin／locator／摘要／hash | provenance record 不完整即 fail，不能只看 key 存在 | 還原完整 frozen record |
| state-removal | 移除 `publish_state` 或改成未知狀態後呼叫 resolver | validator 與 resolver 都 fail closed；不得把缺失狀態默認成 accepted | 還原明確 accepted/draft/rejected/merge 狀態後綠燈 |

## 執行邊界

- 測試需使用 production host `https://sixiangjialaundry.com` 的顯式設定，但不得寫入 `.env` 或 repo。
- 必須以整個 accepted catalog、source registry、resolver 與輸出 projection 做 mutation；只測單一 helper 不算。
- 驗收報告要保留每一 case 的 baseline、mutation failure code、restore 結果與輸出 hash；任何 `ok=true` 的 mutation 都是 release blocker。

## Release gate

在六組 mutation 全部「fail then restore pass」，且 production exact-host、snippet、image provenance、link closure 與獨立複審同時通過前，PR #30 維持 `REWRITE_REQUIRED`；不得部署候選頁、更新 sitemap 或提交新的索引請求。

