# GSC 六頁正文脈絡入鏈稽核（2026-08-31 19:08 Asia/Taipei）

## 方法

重新讀取 live sitemap 的 32 個來源頁，先取 `<main>`（沒有則取 body），移除 `nav`、`footer`、`script`、`style`、`noscript`，再統計六個 `Discovered - currently not indexed` 目標的正文 `<a href>`。這是 read-only 檢查，不修改 HTML、不提交 URL。

## 結果

| 目標頁 | 正文入鏈次數 | 不同來源頁 | 判讀 |
|---|---:|---:|---|
| `services/business-bulk-laundry.html` | 9 | 3 | **偏低**：優先補 B2B 情境段落內鏈 |
| `services/taichung-laundry-price-list.html` | 9 | 7 | **偏低**：優先補價格判斷段落內鏈 |
| `guides/taichung-laundry-service-search.html` | 14 | 11 | 中等；保留單一搜尋指南主入口 |
| `services/fabric-storage.html` | 25 | 8 | 中等；來源集中於收納／寢具內容 |
| `services/taichung-citywide-laundry-pickup.html` | 32 | 22 | 足夠；不再大量增加導覽連結 |
| `services/taichung-xitun-laundry.html` | 38 | 11 | 足夠；優先測答案／snippet 而非再加連結 |

正文零入鏈：`0/6`。與全站入鏈稽核相比，導覽與 footer 重複確實放大了原始次數；真正可行的下一個內鏈變因是 B2B 與價格頁各補少量、語意對應的正文段落連結。

## 行動界線

- 只在授權 PR 中補 2 個低正文入鏈頁；anchor 必須描述下一個判斷，不得只複製「進一步了解」。
- 其餘四頁不增加連結數，避免把 sitewide navigation 當成品質訊號。
- 補鏈後須重新跑 contextual audit、live 200／canonical／noindex／JSON-LD，並等待 GSC crawl／inspection；入鏈本身不等於收錄。

