# IndexNow 狀態一致性 — 2026-09-02

## 核對結果

重新讀取 live `sitemap.xml` 並以相同語義正規化計算 SHA-256：

| 項目 | 值 |
|---|---|
| live HTTP | 200 |
| live sitemap semantic SHA-256 | `a125282f00129913d2e55112dc76658eaabb8af2c8ae30da62baf3a9c95a5750` |
| `indexing-push-2026-09-02.json` SHA | 相同 |
| `indexing-push-state.json` SHA | 相同 |
| 已接受 URL | `/`、`/services/shoe-bag-care.html` |

## 判定

live、當日報告與成功提交狀態完全一致。下一個執行窗口若 sitemap 未變，應輸出 `sitemap_unchanged_since_last_successful_submission` 並跳過；不會重送同一批 URL。這只驗證 IndexNow 去重狀態，不代表 Google 收錄。
