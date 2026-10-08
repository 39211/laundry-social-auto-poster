# live absolute-host link audit（2026-08-31）

## 方法

- 逐頁讀取 sitemap 32 頁 HTML，抽取所有絕對 HTTPS host。
- 將預期的 LINE、Google Maps、schema、Tag Manager、Facebook、Instagram、YouTube 與舊鏡像分開檢查。
- 本次只讀取，不改連結或部署。

## 結果

| 檢查 | 結果 |
|---|---:|
| pages checked | 32 |
| pages with external hosts | 32/32（預期服務／社群／結構化資料連結） |
| pages with `39211.github.io` mirror | 1/32（首頁） |
| mirror occurrences | 13 |
| unique mirror URL variants | 2（同一 CTA 的標點變形） |
| mirror HEAD status | 200（舊鏡像仍可回應） |
| mirror `/go/line.html` robots | `noindex, nofollow`（兩個 host） |

首頁的 13 次舊鏡像 occurrence（2 種 URL 變形）指向 `https://39211.github.io/go/line.html?source=post...`；其餘外部 host 為目前預期的 `line.me`、`maps.app.goo.gl`、社群、Tag Manager 與 schema.org。

## 判讀

- 舊鏡像不是 robots／canonical 的直接阻擋，也沒有出現在 31 個其他頁面；其目的頁明確 `noindex, nofollow`，所以這不是額外索引頁，但仍可能把訪客與轉換事件送到非 canonical host，應列為 release 前的 link hygiene 修正。
- 修正時只替換舊鏡像 CTA 為 canonical `sixiangjialaundry.com`，並保留 source 參數與一次性轉換驗證；不要以大量新頁或重複 IndexNow 代替。
