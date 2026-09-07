# Index-growth safety draft smoke test（2026-08-31 16:24）

## 範圍

只讀取 `docs-internal/draft-clothing-mold-airing-2026-08-31.md` 的「可供日後頁面使用的保守答案」區段；不改 production gate、不產生 sitemap、不部署。此測試是草稿層的 safety canary，不取代 PR #30 的 production validator。

## Gate 定義

- 必須同時存在：`狀態：DRAFT / 不發布`、避免搖晃／少擾動霉、`至少使用 NIOSH 核准的 N95`、專業人員評估。
- 內容區段若出現 `狀態：accepted`、`提供漂白比例`、`戴一般口罩即可` 或 `本店一定洗回原色`，即拒絕。
- 測試文字在記憶體中突變，原檔保持不變。

## 實測矩陣

| case | 預期 | 實測 |
|---|---|---|
| baseline | pass | **PASS** |
| 移除「不要搖晃／少擾動」兩項 | fail | **FAIL（缺安全條件）** |
| 將 N95 改成「戴一般口罩即可」 | fail | **FAIL（缺 N95 且命中不安全文字）** |
| 將禁止提供漂白比例的句子改成「提供漂白比例」 | fail | **FAIL（命中化學建議）** |
| 將 draft 改成 accepted | fail | **FAIL（狀態與 sitemap 邊界條件缺失）** |

`matrix_pass=true`：基線通過，四個突變全部被拒絕；未修改原始草稿。

## 限制與下一步

- 此 smoke test 只能證明草稿的必要安全詞與狀態邊界可被簡單突變攔下，不能證明語意完整、來源 provenance 完整或 production resolver 已修好。
- 要進入 accepted 集合，仍須在 PR 分支補 production host gate、單一 resolver、claim-level locator／摘要／hash、真實 revision/hash 與獨立複審；在此之前維持 draft。
