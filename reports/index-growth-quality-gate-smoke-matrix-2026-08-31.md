# Index-growth quality-gate smoke matrix — 2026-08-31

以下結果均在隔離 review worktree 取得；沒有修改 live、`src/`、`scripts/`、排程或發布紀錄。`PASS` 代表目前閘門讓該突變通過，不代表突變是正確的。

| Mutation / probe | Current result | Expected final gate |
|---|---|---|
| 移除 `citation_answer` | **FAIL**（citation fallback／lead） | FAIL |
| 將 claim 改綁另一個合法 `source_ref` | **PASS** | FAIL（claim-level provenance） |
| 清空 source registry `origin`／`note` | **PASS** | FAIL |
| 使用格式合法但任意的 `content_revision` | **PASS** | FAIL（content/cohort hash） |
| 替換足夠長的 section body | **PASS** | FAIL（production content hash） |
| `publish_state` 缺省 | validator **PASS**，resolver 少 1 頁 | validator/resolver/count 必須一致並 FAIL |
| mold 正文加入拍打／甩動／刷洗建議 | **PASS** | FAIL（隔離／PPE／no-dispersal safety） |
| 產生器 deployment 使用錯誤 host | **FAIL closed** | FAIL closed |
| `publishPages.ts` host assertion | **未發現 import／usage** | 必須共用 exact production host gate |
| 地理識別變體 doorway clone | normal 0.7852；doorway 0.6073（低於 0.68） | FAIL（location-independent semantic test） |

## Release interpretation

目前只有 citation fallback 與 generator invalid-host probe 達到預期防線；其餘 PASS 或 coverage gap 仍屬 `REWRITE REQUIRED`。因此 PR #30 的 CI 綠燈不能升格為 production release gate，24 個候選頁也不能計入 live 56／100。

## Required recheck

修復後必須在同一 production path 重跑每一列：移除條件變紅，還原相同 mutation 回綠；並重新執行 focused/full/typecheck、HTML／SEO-only overlay、live sitemap／HTTP／canonical／schema audit，再檢查 GSC 新鮮度。
