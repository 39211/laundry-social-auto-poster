# Index-growth accepted 24 頁隔離 HTML 稽核（2026-08-31）

## 範圍

- 來源：PR #30 head `ba6ab5a85524c3a5e4fa4c0848c89be7b944881d` 的 `research/index-growth-100/topic-inventory.csv`，`publish_state=accepted` 共 24 頁。
- 隔離輸出：`C:\Users\cyc39\AppData\Local\Temp\sxj-index-growth-100-20260831\docs`。
- 本報告只驗隔離產物；24 個候選 URL 目前仍為 live 404，不能計入 sitemap 或 GSC indexed count。

## 結果

| 檢查 | 結果 | 判讀 |
|---|---:|---|
| 候選 HTML 存在 | 24/24 | 隔離產物完整 |
| 去除 script/style/tag 後正文 | 1,160–1,330 字元 | 通過目前正文厚度門檻；不是收錄保證 |
| answer box 以店名／地址開頭 | 0/24 | 答案框首句目前是問題答案 |
| meta description 以店名／地址開頭 | 24/24 | **REVIEW**：snippet 先顯示 NAP，問題答案延後 |
| Open Graph description 以店名／地址開頭 | 24/24 | **REVIEW**：社群／部分預覽摘要同樣受影響 |
| Twitter description 以店名／地址開頭 | 24/24 | **REVIEW**：需與 meta 同步修正 |
| self-canonical | 24/24 | 通過隔離 canonical |
| JSON-LD 可解析 | 24/24 | 通過隔離結構化資料解析 |
| unique answer text | 24/24 | 每頁 answer box 文本不同；仍需 claim provenance 審查 |
| unique hero image | 3 | 17 頁共用鞋包圖、4 頁共用布品 hero、3 頁共用布品 inspection；不是 24 件第一方案例 |
| 可見「清潔前／案例／成果」標示 | 17/24 | **REVIEW**：共用未核實素材不應暗示客件前後或成果 |
| live candidate URL HTTP 200 | 0/24 | 目前全為隔離候選，尚未部署 |
| 唯一站內連結目標 | 48 | 24 個指向現有 live 頁；24 個指向本批候選 |
| 站內連結目標 live HTTP 200 | 24/48 | 現有頁可抓取 |
| 站內連結目標 live HTTP 404 | 24/48 | 全部是本批尚未部署候選；整批 overlay 後必須重新驗證為 200 |

## 圖片分布

- `shoe-bag-care-hero-product.png`：17 頁。
- `fabric-storage-hero-product.png`：4 頁（衣物發霉、真空袋、毯子潮氣、洗後乾燥）。
- `fabric-storage-inspection.png`：3 頁（羊毛大衣、針織縮水、油水污漬）。
- `data/asset-ledger.json` 沒有上述候選素材的 `real-case` entry；因此目前可驗證第一方案例為 `0/24`。未取得同意與 provenance 前，必須使用中性示意標示。

## Release 判定

`NOT READY`。HTML 的答案框、canonical、JSON-LD 與正文厚度通過，但三個 snippet surface `24/24` 品牌先行、圖片標示 `17/24` 有未驗證案例暗示，候選 URL `0/24` live 200，且 24/48 站內連結目前指向尚未部署候選。必須先完成 snippet、provenance、內鏈 closure、resolver／host gate 及獨立複審，再考慮 HTML-only overlay；不得以 sitemap 或 IndexNow 提交數代替收錄。

## 可重現方式

1. 使用同一 PR head 與 inventory 篩選 `publish_state=accepted`。
2. 在隔離 docs 輸出逐頁檢查 meta／OG／Twitter、answer box、canonical、JSON-LD、正文字數與第一張圖片。
3. 部署前再對每個候選 URL 做 live HTTP、canonical、JSON-LD 與內鏈 closure recheck；任一 404 或 provenance 不明即 fail。

## 20:16 live candidate closure recheck

- 以 PR #30 accepted inventory 的 24 rows 重查候選 URL：HTTP 200 `0/24`、HTTP 404 `24/24`。
- 對照公開 `sitemap.xml`：候選 URL 成員 `0/24`、缺席 `24/24`；因此目前沒有候選頁可計入 live sitemap 或 indexed count。
- 這次重查沒有改變 release 判定，仍為 `NOT READY`；不執行 HTML overlay、不重送 IndexNow。

## 20:30 accepted24 intent-collision audit

- 重新以同一 accepted inventory 對隔離輸出逐頁取 `<h1>` 與 answer box，24/24 HTML 存在。
- unique `<h1>` `24/24`、unique answer text `24/24`；答案 token set 的 Jaccard 相似度門檻 `>=0.55` 配對為 `0`。
- 這是去重與意圖差異的 lexical signal，不是 Google doorway 判決；仍須保留第一方證據、內容深度、內鏈 closure、provenance 與整批 live 驗證。候選仍未部署。

## 21:02 live closure recheck

- 從 PR30 head 的 accepted inventory 讀取 24 個 `path`，逐一對 production host 做 HEAD：HTTP 200 `0/24`、HTTP 404 `24/24`、其他狀態 `0/24`；sitemap 成員 `0/24`。
- accepted24 仍是隔離輸出，沒有任何新頁可加入 live sitemap 或索引分母；維持 `NOT READY`，不重送 IndexNow。
