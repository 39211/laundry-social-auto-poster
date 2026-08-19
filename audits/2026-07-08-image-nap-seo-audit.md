# 私享家洗衣店圖片與 NAP 驗收報告

產出時間：2026-07-08

## 結論

本次驗收已檢查公開站圖片 URL、OG image、img alt、JSON-LD ImageObject、網站商家資料與外部 NAP 線索。

最重要的問題已修復：`2026-07-02` 兩張歷史社群圖片原本線上 404，已透過 `npm.cmd run publish-pages -- --date 2026-07-02` 補發布，重新驗證後皆為 200 image/png。

目前圖片層驗收通過；NAP 核心資料在網站內部一致，且與可讀外部線索大致一致。仍建議後續用 Google Business Profile 後台人工確認營業時間與官方網站欄位，因 Google Maps 頁面公開抓取容易受動態頁限制。

## 圖片驗收

檢查範圍：
- `docs/**/*.html`
- `docs/**/*.json`
- `docs/**/*.jsonl`
- 線上 URL：`https://39211.github.io/`

結果：

| 項目 | 結果 |
|---|---:|
| HTML 檔案 | 14 |
| JSON / JSONL 檔案 | 16 |
| 圖片引用總數 | 111 |
| 唯一圖片 URL | 13 |
| `<img>` 標籤 | 17 |
| 缺少或空白 alt | 0 |
| OG / Twitter image 引用 | 8 |
| Schema ImageObject 引用 | 17 |
| JSON-LD 解析錯誤 | 0 |
| broken image URL | 0 |
| 非圖片 content-type | 0 |

修復紀錄：

| 原問題 | 修復 |
|---|---|
| `https://39211.github.io/laundry-social-auto-poster/assets/2026-07-02/slot-01.png` 404 | 補發布後 200 image/png |
| `https://39211.github.io/laundry-social-auto-poster/assets/2026-07-02/slot-02.png` 404 | 補發布後 200 image/png |

判斷：
- OG image 目前使用服務主圖，且線上可讀。
- 首頁、服務頁與社群貼文圖片都有 alt。
- Schema ImageObject 可解析，且圖片 URL 回 200。
- 歷史貼文圖片目前已補齊，避免 `social-posts.json` / `knowledge-graph.json` 指到失效圖片。

## NAP 驗收

內部資料來源：
- `data/business-profile.json`
- `docs/business-profile.json`
- `docs/index.html`
- `docs/knowledge-graph.json`

網站內部一致性：

| 欄位 | 目前網站資料 | 驗收 |
|---|---|---|
| 店名 | 私享家洗衣店 | 通過 |
| Google Business Profile 名稱 | 私享家 旗艦總店 | 通過 |
| 地址 | 407 臺中市西屯區至善里青海路二段365號 | 通過 |
| 電話 | 04-2452-7411 | 通過 |
| LINE / 手機 | 0968-327-653 / 0968327653 | 通過 |
| LINE URL | https://line.me/ti/p/4m-rA6hxf6 | 通過，HTTP 200 |
| Facebook | https://www.facebook.com/100083194756904/ | 通過，HTTP 200，會轉 canonical people URL |
| Instagram | https://www.instagram.com/si_xiang_jia/ | 通過，HTTP 200 |
| 營業時間 | 週一至週五 10:00-20:00；週六 12:00-18:00；週日公休 | 通過 |
| `data/business-profile.json` vs `docs/business-profile.json` | 完全一致 | 通過 |

外部線索：

| 平台 | 可讀到的資訊 | 判斷 |
|---|---|---|
| Facebook 公開搜尋摘要 | 私享家旗艦店、台中市西屯區青海路二段365號、IG `@si_xiang_jia`、LINE `0968327653` | 與網站一致 |
| Instagram 公開搜尋摘要 | `LINE/手機:0968-327-653`、電話 `04-2452-7411`、週一至週五 `10:00-20:00`、週六 `12:00-18:00`、週日公休 | 與網站一致 |
| 台灣百工百業資訊網 | 公司名稱私享家洗衣店、登記地址臺中市西屯區青海路二段365號、洗衣業 | 與網站核心地址一致 |
| LINE URL | HTTP 200 | 連結有效 |

注意：
- Google Maps 公開頁較難穩定機器解析，網站目前保存 Google Maps short link、feature id、CID，但 `google_place_id` 仍為 null。這是正確保守做法，避免把 CID 誤當 Place ID。
- Google Maps / Google Business Profile 的營業時間應以後台人工確認為準；目前網站不產生未驗證節日營業 schema，做法正確。

## P0 / P1 / P2

P0 已修復：
- 歷史圖片 `2026-07-02 slot-01/slot-02` 線上 404。

P1 建議：
- 之後 `publish-pages` 應納入「所有已審核貼文的圖片資產」檢查，避免只發布當天圖片，造成歷史貼文圖片 404。
- 每次重產 SEO/AIO/GEO 後，固定跑圖片 URL 驗收，至少檢查 `social-posts.json`、`knowledge-graph.json`、首頁 `<img>`、OG image。

P2 建議：
- 補一個正式 `npm` script，例如 `audit-public-site`，讓圖片/NAP 驗收可重跑。
- 若日後 Google Business Profile 後台可讀，補 `google_place_id`，但不要用 CID 代替。

## 資料來源

- 官方公開站：https://39211.github.io/
- 公開商家資料：https://39211.github.io/business-profile.json
- Facebook：https://www.facebook.com/100083194756904/
- Instagram：https://www.instagram.com/si_xiang_jia/
- LINE：https://line.me/ti/p/4m-rA6hxf6
- 台灣百工百業資訊網：https://twii.com.tw/company/999735/info

