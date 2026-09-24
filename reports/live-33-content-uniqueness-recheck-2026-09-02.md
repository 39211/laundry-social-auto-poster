# Live 33 頁內容差異化重驗 — 2026-09-02

## 方法

- 來源：2026-09-02 直接讀取 `https://sixiangjialaundry.com/sitemap.xml` 的 33 個 URL。
- 每頁檢查 title、meta description、H1 與 `<main>` 可見正文長度；再將 `p/li/h2/h3` 中至少 60 字元的區塊正規化，計算跨不同 URL 的完全相同區塊。
- 同一 URL 內重複出現的區塊不計入跨頁重複；結果是內容診斷訊號，不是 Google spam 判決。

## 結果

| 檢查 | 結果 |
|---|---:|
| sitemap URL／HTTP 200 | 33／33 |
| unique title | 33／33 |
| unique meta description | 33／33 |
| unique H1 | 33／33 |
| `<main>` body_chars 範圍 | 958–55,631 |
| 跨 URL 完全相同的 60+ 字元區塊 | 13 組 |

## 重複區塊的解讀

13 組跨頁重複主要落在三類：

1. 品牌／門市／台中收送的共同事實；
2. 材質與不可逆風險的安全界線；
3. 首頁、服務頁與對應指南之間的摘要承接。

例如皮衣判斷段落同時出現在首頁、鞋包服務頁與皮衣指南；羽絨判斷段落同時出現在首頁、布品服務頁與羽絨指南。這些重複本身合理，但若子頁只剩摘要而沒有自身的檢查步驟，獨立價值會變弱。

## 判定與行動

- 33/33 metadata 唯一，沒有發現「同標題／同描述／同 H1」造成的直接技術問題。
- 不把共同事實刪光；它們是 NAP、服務範圍與安全限制的必要一致性。
- 下一批內容只應補「該頁獨有的問題→檢查→限制→預約」段落，不能靠換地名或堆同義詞增加 URL。
- 優先檢視已有曝光或 GSC discovered 的頁面；不新增城市 doorway。洗包 treatment 仍限定在既有鞋包服務頁，維持 `DRAFT_ONLY`。
- body_chars、HTTP 200、metadata 唯一都不能代表收錄或曝光；仍以新鮮 GSC query/page、GA4 organic/AI 與 LINE click 判定。

## 證據邊界

本報告是 2026-09-02 live 抓取的內容差異化基線；未修改 source、HTML、sitemap 或 IndexNow，也沒有將 33 live URL 解讀成 33 個已收錄頁。
