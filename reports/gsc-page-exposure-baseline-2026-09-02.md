# GSC 頁面曝光基線 — 2026-09-02

## 資料範圍

來源為 `data/insights/gsc/2026-08-29.json`，於 2026-09-01 取得；共 9 次 impressions、0 clicks。這是目前最新可用快照，不是 2026-09-02 即時資料。

## 有曝光頁面

| 頁面 | impressions | clicks | position | 下一步解讀 |
|---|---:|---:|---:|---|
| `guides/bedding-duvet-cleaning.html` | 3 | 0 | 8 | 已在第一頁邊緣，先觀察，不與 pilot 同時改 |
| `guides/shirt-suit-dry-cleaning.html` | 2 | 0 | 10 | 可作衣物意圖對照，不宣稱有流量 |
| `/` | 1 | 0 | 2 | 品牌／首頁訊號，維持控制 |
| `guides/birkenstock-care.html` | 1 | 0 | 11 | 鞋類問題訊號，暫不新增同義頁 |
| `guides/clothing-alteration-with-laundry.html` | 1 | 0 | 2 | 非本輪鞋包主題，維持控制 |
| `guides/white-shoe-yellowing.html` | 1 | 0 | 8 | 鞋類對照頁，維持不變 |

## 判定

- `top_queries=[]`、`top_query_pages=[]`，因此無法把任何一個詞與頁面做確定歸因。
- 位置 8–11 的頁面是後續測試候選，但目前樣本太小，不能直接改標題或宣布曝光策略有效。
- pilot `shoe-odor-source` 仍是唯一已部署的新頁；其他候選與 treatment 維持 gate。

## 後續規則

等 2026-09-02 收集週期完成後，先比較同一頁的非品牌 impressions／clicks／CTR／position；再搭配 GA4 organic 與 LINE click。任何缺欄位保持 `PENDING`／`INCONCLUSIVE`，不補零、不重複要求索引。
