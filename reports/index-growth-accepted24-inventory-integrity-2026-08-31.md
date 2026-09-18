# Index-growth accepted 24 inventory integrity audit（2026-08-31）

## Scope

只讀讀取 PR #30 head `ba6ab5a85524c3a5e4fa4c0848c89be7b944881d` 的 `research/index-growth-100/topic-inventory.csv`，對 `publish_state=accepted` 做欄位與關聯完整性檢查；這不是部署或收錄證據。

## Result

| Check | Result | Interpretation |
|---|---:|---|
| accepted rows | 24 | 與需求批次文件一致 |
| missing `related_links` | 0/24 | 每頁都有明確關聯目標 |
| unknown related slugs | 0 | 沒有懸空 inventory reference |
| edges to accepted candidates | 26 | 同批 overlay 後必須重新驗證 live 200 |
| edges to existing/non-accepted pages | 22 | 可作既有 hub／service 入口，仍需 live recheck |
| non-empty `source_evidence` | 24/24 | 有來源欄位；不等於 claim-level provenance 已核實 |
| non-empty `unique_answer` | 24/24 | 有頁面答案欄位；不等於 snippet／安全 gate 通過 |
| medium cannibalization risk | 4/24 | 需額外人工審查；不得只依 validator 放行 |

## Hub 分布

- `bags` 9 頁、`shoes` 8 頁、`textiles` 4 頁、`decisions` 3 頁。
- 分布顯示候選不是單純城市名稱複製，但仍需逐頁證明獨立 user job、第一手／可追溯來源與內容 revision。

## Release 判定

`INVENTORY_INTACT / RELEASE_NOT_READY`。欄位與關聯沒有發現懸空引用，但 PR #30 的 claim-level provenance、snippet 先行、影像標示、production host/resolver、live URL 與獨立複審仍未通過；不能因 inventory 完整就部署或把 24 頁計入索引。

