# Index-growth accepted 24 link integrity audit（2026-08-31）

## Scope

對 PR #30 的 24 個 accepted 隔離 HTML 取出所有本站絕對 `href`，與 live Google sitemap 及候選路徑比對，再對候選與 CTA 逐一做 live request。這是部署前 read-only closure 證據。

## Result

| 類別 | 唯一數量 | live 結果 | 判讀 |
|---|---:|---|---|
| 指向目前 live sitemap URL | 20 | 20 個目標可用 | 目前 cohort 能連到的既有頁 |
| 指向本批候選 guide | 24 | HTTP 200 `0/24`（目前全 404） | 尚未部署的預期阻塞；overlay 後必須全部變 200 |
| `/go/line.html?source=...` CTA | 72 | HTTP 200 `72/72`；meta `noindex` `72/72`；LINE destination `72/72` | 可轉換但不應計入 sitemap/indexed |
| 其他本站 JSON 入口 | 4 | HTTP 200 `4/4` | `answers.json`、`business-profile.json`、`search-visibility.json`、`services.json` |

全體唯一本站絕對 href 為 `120`；inventory 期待的 48 條 related-link 邊在隔離 HTML 中存在 `48/48`。本次沒有發現候選以外的本站 404 目標。

## Release 判定

`CLOSURE_PENDING / RELEASE_NOT_READY`。CTA 與既有 JSON 入口沒有 broken link，主要未閉合項只剩 24 個候選頁尚未 live；候選部署後須重跑同一稽核，並同時通過 canonical、noindex、JSON-LD、內容 provenance、snippet 與獨立複審，才可更新 sitemap／提交。

