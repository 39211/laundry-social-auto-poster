# Live／本機 Pages mirror 漂移檢查 — 2026-09-02

## 結論

發布前曾發現本機 `docs/` sitemap 只有 32 個 URL，而 live 有 33 個；唯一差異是 `guides/shoe-odor-source.html`。本輪已將 live pilot 原樣回填本機、補入 sitemap，並在首頁與鞋包服務頁加上情境內鏈；部署後本機／live 已重新對齊為 33/33。

## 證據

| 項目 | 本機 | live |
|---|---:|---:|
| sitemap HTTP | 檔案存在 | 200 |
| sitemap URL 數 | 33 | 33 |
| `shoe-odor-source` | 200／已回填 | 200 |
| 其他 URL 差異 | 0 | 0 |

檢查命令以 `<loc>` 集合做比對；部署後結果為 `local_not_live=[]`、`live_not_local=[]`、`exact_set=true`。首頁與鞋包服務頁均可抓到 pilot 連結。

pilot live body 目前為 41,933 bytes，SHA-256 `31ee6c48b4dac2dd752afe0e5ad0153b177291c254eeea995c10df0a4413e2d5`；同一綁定已寫入 [100-page evidence manifest](../docs-internal/index-growth-100-evidence-manifest-2026-09-02.json)。

## 風險

`publishRootPagesMirror` 仍會從本機 `docs/` 覆蓋 mirror 文字目錄；因此同步前的漂移可能再次造成刪除。現在 pilot HTML 的 SHA-256／bytes 已綁定，但每次發布前仍需重跑 URL 集合與 hash 檢查。

## 發布前必要條件

1. 每次發布前重新做本機／live URL 集合、canonical、HTTP 200 與 provenance 檢查。
2. 若再次出現 drift，先停止 `publish-pages`，修復同步後再發布；IndexNow 不因漂移而重送。
