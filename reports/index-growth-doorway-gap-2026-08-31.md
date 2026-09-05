# Index growth doorway comparator diagnostic — 2026-08-31

## Scope

唯讀檢查候選 24 頁的地理差異閘門；沒有修改 `src/`、`scripts/`、排程、發布紀錄或 live 網站。

## Live baseline

- `https://sixiangjialaundry.com/sitemap.xml`: HTTP 200、32 個唯一 URL。
- GSC snapshot `data/insights/gsc-index/2026-08-31.json`: 26 indexed、6 discovered/not indexed。
- `output/operations/indexing-push-2026-08-31.json`: `ok=true`、HTTP 200、33 submitted；今日不重送。

## Isolated counterexample

在隔離 review worktree 以第一個候選頁複製內容，只替換 title、h1、description、keywords、local_intent 為另一個地理表述，保留程序內容：

| Check | Result | Current rule |
|---|---:|---:|
| 一般 diagnostic 3-gram Jaccard | 0.7852 | 0.68 以上應拒絕 |
| `doorwayPairSimilarity` | 0.6073 | 0.68 以上才拒絕 |
| doorway fingerprint Jaccard | 0.5937 | 非 validator gate |

這表示目前 doorway 專用比較在此反例沒有達到拒絕閾值；正常相似度雖會拒絕，但若內容再加入少量改寫，仍缺少 claim-level、location-independent 的獨立證據。這與 Luna 的 `REWRITE` 意見一致，不能把目前閘門當成已完成的 production 防線。

## 判定

`PENDING — REWRITE REQUIRED`。在取得明確的 PR-only 例外前，不改生產程式、不合併 PR、不部署 24 頁；候選頁維持 live 404，不能宣稱索引已增加。

## 下一步

1. 取得使用者明確的「只修 PR #30 的 src/test、不得碰其他 dirty work」授權。
2. 由實作者補 production exact-host、單一 resolver/count、claim-level immutable provenance、真實 revision/cohort/hash、衣物發霉安全閘門及真突變還原測試。
3. 以獨立 reviewer 重跑反例與完整 suite；通過後才進行 HTML/SEO-only deploy，再驗證 live sitemap 由 32 變為 56。
