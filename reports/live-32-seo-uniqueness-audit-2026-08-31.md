# live 32 頁 SEO uniqueness audit（2026-08-31）

## 範圍與方法

- 來源：live `https://sixiangjialaundry.com/sitemap.xml`，當次讀到 32 URL。
- 每頁以 HTTPS GET 讀取並檢查 HTTP、title、meta description、H1、canonical、noindex、JSON-LD 與去除 script/style/tag 後的正文長度。
- 這是 read-only 稽核；沒有改 HTML、sitemap 或推送。

## 結果

| 檢查 | 結果 |
|---|---:|
| sitemap URL 數 | 32 |
| HTTP 200 | 32/32 |
| self-canonical | 32/32 |
| noindex | 0/32 |
| JSON-LD 可解析 | 32/32 |
| unique title | 32/32 |
| unique meta description | 32/32 |
| unique H1 | 32/32 |
| 正文去標籤字元 | 1,046–55,913（平均 3,457） |

## 判讀

- live 站沒有發現 title、meta description 或 H1 的完全重複；六個 GSC `Discovered - currently not indexed` 頁面也不是因為 canonical／noindex／JSON-LD 解析錯誤而被直接擋住。
- 這不代表 Google 必然收錄；「已發現未收錄」仍可能受內容品質、需求匹配、內鏈脈絡、抓取排程或 Google 自有選擇影響。下一個實驗應維持單一變因，優先驗答案先行 snippet 與情境內鏈。
- 首頁 55,913 字元拉高平均值；最短 live 頁為 1,046 字元，需以主題與可用答案判斷，不能只用全站平均字數作收錄門檻。

## 交付邊界

這份結果只證明目前 live 技術與 metadata uniqueness；未增加 URL、未送 IndexNow，也未把 32 sitemap URL 解讀成 32 個 Google indexed pages。
