# 一塊印(iprinter.com.tw)版型移植到私享家公開站：實作與驗證紀錄

日期：2026-09-03（Asia/Taipei）
分支：`claude/iprinter-website-clone-c9cb19`

## 做了什麼

把 `src/generatePublicSite.ts` 的整套版型換成一塊印公開站的設計系統與頁面組成，內容、網址、schema、
GA4 事件、LINE 轉址追蹤全部不動。這是第二階段：第一階段（PR #32）移植的是搜尋漏斗架構
（知識庫、答案頁、GA4 事件），本次移植的是**視覺與版面**。

### 一塊印公開可驗證的樣本（2026-09-03 抓取）

- 首頁 HTML 22 KB、Astro 建置、單一 CSS 檔 `/_astro/BaseLayout.*.css` 11 KB。
- 設計 token：`--color-brand:#f5c400`（黃）、`--color-ink:#172033`、`--color-blue:#1f6feb`、
  `--color-bg:#f7f8fb`、`--radius-card:8px`、`--max-page:1180px`、字體 Microsoft JhengHei UI。
- 首頁組成（由上到下）：sticky header（品牌方塊＋文字＋一列導覽）→ hero 左文右圖＋浮動小圖
  → 四步流程條（藍色圓數字）＋白色 callout → 產品系列 grid four → 怎麼使用 grid five（Step 1–5）
  → 場域方案 grid three → 90 日日更 grid three（圖＋日期＋標題＋摘要）→ 品牌與信任 grid two
  （左文右聯絡卡）→ 深色 cta-band → 深色 footer（左品牌右連結）→ 手機底部固定雙按鈕。
- 內頁組成：麵包屑 → `section grid two`（左 eyebrow/h1/lead/button-row，右 answer-block）
  → `section tight` 多張 card → 相關產品／方案卡 → footer。
- 站點地圖 128 URL：/products/ 5、/solutions/ 6、/knowledge/ 14、/daily/ 93、pricing、locations、
  faq、about、contact、privacy。

### 私享家對應表

| 一塊印 | 私享家 |
|---|---|
| 產品系列（4 張 product-card） | 服務項目：7 個服務頁（含價目表），卡片加受眾 meta、summary、「能解決：」answer_summary |
| 怎麼使用 Step 1–5 | 送洗前流程 Step 1–5（拍照詢問／傳 LINE 或到店／門市判斷／約收送或交件／洗好送回） |
| 場域方案 | 在地收送：4 個 local 頁（逢甲、中科、東海、青海路洗鞋）＋收送說明按鈕 |
| 知識庫 | 洗護知識庫：五組精選答案卡＋總覽連結（完整清單仍在 `/knowledge/`） |
| 90 日日更 | 已發布社群內容：最近 7 天 grid three，較早內容收合 |
| 品牌與信任＋合作洽詢卡 | 品牌與信任＋預約與詢問入口卡（LINE／電話／Google Maps） |
| cta-band | 想先問再送洗？（LINE 傳照片／常見問題） |
| footer 網站連結／社群 | 首頁、服務項目、免費收送、知識庫、每日紀錄、常見問題、店家資料／LINE、FB、IG、YouTube、Maps |
| mobile-sticky-cta | 服務項目／LINE 預約 |
| 首頁 kiosk 照片＋浮動 APP 截圖 | 布品收納主圖＋浮動白鞋主圖（沿用既有 `assets/services/*`） |

保留私享家自己的區塊（一塊印沒有，但 SEO／AEO 依賴）：依需求找到服務（四組）、首頁 FAQ、
在地搜尋 chips、AI 與搜尋引擎入口（收合）。

## 不動的東西（刻意）

- 所有網址、canonical、sitemap、JSON-LD、hreflang、OG。
- 八個 GA4 搜尋漏斗事件與 `/go/line.html` 轉址：事件靠 href 判定，不靠 class。
- LINE 觸點集合：每頁允許的 placement 不變（首頁 nav/cta/inline/pickup/footer；服務頁 cta/footer；
  答案頁 nav/cta/inline；知識庫只有 cta；貼文 nav/cta/footer），新 footer 一律重用該頁既有 placement。
- AEO 抽取契約：`<div class="answer-box">` 第一個子元素仍是 `<p>`；標籤改放在框外。
- 價目表內鏈規則 R4：footer 不再列出全部服務，改列站區入口，避免非指定頁出現價目表正文內鏈。
- 品牌色沿用一塊印的黃 `#f5c400`，要換成私享家自己的色只需改 `--color-brand` 與 `--color-brand-ink`。

## 驗證

- `npx tsc --noEmit`：乾淨。
- `npx vitest run`（全套）：87 檔、749 通過、16 跳過、0 失敗。
- 聚焦四檔（publicSite、lineAttribution、auditPublicSite、indexGrowthPages）：64/64。
- `npm run audit-public-site`：173 HTML、268 img、missing alt 0、broken URLs 0、NAP 一致。
- 重產 `docs/`：非 HTML 產物只有 9 個 `generated_at` 時間戳差異；`content-calendar/` 零內容差異；
  0 個檔案被刪除。
- 本機預覽（python http.server + 瀏覽器）：1366 寬桌機與 375 寬手機皆檢查首頁全段、服務頁、
  答案頁、知識庫、貼文頁；手機版有橫向捲動導覽與底部固定 CTA。

### 測試改動

`test/publicSite.test.ts` 三處只換掉舊版型的斷言：
`depth-band`／背景圖 URL → 新殼層斷言（site-header、home-hero、四步流程 li 數、cta-band、
site-footer、mobile-sticky-cta、footer 在 `</main>` 之後）；
`section-header-bottom` 排序 → `grid four discovery-grid` 在「依需求找到服務」之後；
`read full post` 連結 regex → `閱讀文章`。內容與 schema 斷言全部保留。

## 踩到的坑（已寫進記憶）

worktree 沒有 gitignored 的 `data/content-calendar`、`data/approved-log`、`.env`，直接重產會把
162 個公開行事曆刪掉；從主 checkout 鏡射過來又會夾帶主分支之後才改的內容
（08-29 slot 3 主題已被改成「馬丁靴整雙發霉了」）與尚未提交的 08-30 以後媒體。
對齊法：刪掉 docs 沒有媒體的日期（≥ 08-30）的核准檔，08-29 私有行事曆直接用 HEAD 的
`docs/content-calendar/2026-08-29.json` 取代。之後重產才做到「只換版型」。

## 尚未做／下一步

- 部署後（Pages 鏡射）看 GSC 是否對版型變更有反應，這與索引無直接關係，不需重新提交。
- 品牌色是否改成私享家自己的色，等老闆看過首頁再決定。
- 一塊印每篇日更頁有動畫版 Reel 按鈕；私享家貼文頁目前只有圖，Reel 連結要等 YouTube 上傳鏈打通。
