# Cohort A claim／圖片文字重驗（2026-09-02）

## 範圍

讀取最新隔離建置樹 `laundry-index-growth-deploy-FIvbtW` 的五頁候選：`suede-shoe-cleaning`、`canvas-shoe-mud`、`leather-shoe-water-marks`、`washing-machine-shoe-risk`、`athletic-shoe-mixed-materials`。只檢查 meta、OG image alt、figcaption 與正文的可見承諾，不把隔離檔當成 live。

## 發現

| 頁面 | meta 是否含安全限制 | OG alt／caption 狀態 | 判定 |
|---|---|---|---|
| 五頁全部 | 有「評估／不保證／不能」等限制 | 仍共用「鞋包清潔前的包角、鞋面與皮革檢查主圖」字樣 | `LABEL_REWRITE_REQUIRED` |

五頁正文各自回答不同材質／處理決策，且有「不能保證恢復」等安全界線；但 OG alt 與 figcaption 把共用示意圖描述成「清潔前」檢查主圖，若素材沒有第一方客件 provenance，容易讓讀者誤解為每頁的實際案例或成果。

## 必修修正（仍在隔離層）

1. 無法提供第一方素材 provenance 時，統一改為中性描述，例如「鞋包材質與痕跡檢查示意圖」，並移除「清潔前／清潔後／成果」暗示。
2. 若要保留「清潔前」或任何前後效果敘述，必須補來源、取得／拍攝日期、使用同意、原始檔 SHA-256 與逐頁 claim 對應。
3. 改完後重跑可見文字安全掃描、provenance、sitemap/link closure、exact-host、mutation 與獨立複審；任一項失敗仍保持 `HOLD`。

## 控制

- 本輪沒有修改 `src/`、`scripts/`、live HTML、Sitemap、schema 或發布紀錄。
- 不因隔離檔通過結構檢查就解除 `HOLD_UNTIL_PILOT_ADOPT`，也不以 HTTP 200、IndexNow 或圖片檔存在替代第一方證據。
