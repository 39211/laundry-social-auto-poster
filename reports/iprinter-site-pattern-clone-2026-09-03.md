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

---

## 第二回合（2026-09-04）：SEO／AEO／GEO／GA4 補到一塊印同等級

### 差距怎麼量出來的

| 項目 | 一塊印（2026-09-04 抓取） | 私享家（改前） | 私享家（改後） |
|---|---|---|---|
| sitemap URL 數 | 128（其中 93 篇 daily） | 57（貼文頁全部排除） | 169（57＋111 篇文章＋總覽頁） |
| 每篇日更／貼文頁可見字數 | 約 2,150 | 平均 870、最低 659 | 平均 2,167、最低 1,923 |
| 貼文頁 robots | index | noindex | 過厚度閘門者 index，其餘 noindex |
| 貼文頁 schema | BlogPosting＋FAQPage＋BreadcrumbList | BlogPosting＋Breadcrumb | BlogPosting＋FAQPage＋Breadcrumb（三層） |
| 日更總覽頁 | `/daily/` | 無 | `/posts/`（CollectionPage＋ItemList） |
| RSS | `rss.xml` 200 | 只有 feed.json | `rss.xml`（只收可索引文章） |
| GA4 文章事件 | view_article、click_product_from_article… | 貼文頁沒有事件腳本 | view_article、click_service_from_article |
| robots.txt 對 AI 爬蟲 | 允許 OAI-SearchBot／GPTBot | 已允許 | 不變 |
| llms.txt／JSON 入口 | 有 llms.txt | 有 llms、llms-full、jsonl、ai.json 等 | 不變 |

### 做法

- 貼文頁改成「每日洗護紀錄」文章頁，結構照一塊印 daily：重點摘要 → 門市筆記（完整文案）→ 物件族檢查重點（ol）
  → 材質與處理界線（表格，取對應服務頁的送件情境）→ 下一步（LINE／服務／收送）→ 常見問題（物件族 FAQ＋收送 FAQ）
  → 延伸閱讀（同族其他紀錄＋指南＋總覽）→ 對應服務卡 → 追蹤入口。
- **厚度閘門 fail-closed**：以渲染後 `<main>` 可見字數 ≥ 1,200、文案 ≥ 80 字、有自己的文章頁（非重複文案）、
  有正式站網址四條件全過才給 index robots、進 sitemap／ai-sitemap／rss／總覽 schema；任一不過就維持 noindex, follow。
  測試用短文案的貼文證明閘門會關（`sitemap` 不含、robots noindex）。
- 總覽頁 `/posts/`：列出全部紀錄卡（Day 編號、日期、物件族），只有至少一篇過閘門才 index。
- GA4：貼文頁掛上 search-content-analytics，body 標 `page_type=article`；新增 `view_article`、
  `click_service_from_article` 兩個事件並納入必備事件清單與 runtime 可達性檢查。
- `ai-discovery.json` 新增 `daily_article_policy`（門檻、行為、可索引篩數／總篇數），讓判讀時能對得上。

### 驗證

- 111 篇文章 111 篇過閘門；sitemap 169 URL；rss 111 items；`posts/index.html` 產生。
- publicSite 32/32（含新增的閘門測試）；全套 742 通過、16 跳過；`publishPages.test.ts` 有 1–4 條在此機器上因
  `%TEMP%` EPERM 隨機紅，該檔案本次未改動、同一套程式稍早全綠，判定環境因素。
- 首頁 lastmod 因新增 RSS 與總覽連結改為 2026-09-04，對應測試同步更新；知識庫 lastmod 維持 09-03。

### 這不等於已被索引

一塊印的 93 篇是「已收錄且有曝光」的結果，不是提交當天就有。私享家這 112 個新 URL 部署後要走 Day 0／7／28 判定
（見第一回合報告）；若 28 天仍 crawled-not-indexed，整併同族紀錄而不是再堆 URL。

---

## 第三回合（2026-09-04 晚）：品牌色＋一塊印發文規則套用

- 品牌色改為老闆選的深墨綠 `#1f4d3a`／米白 `#f4efe6`；新增 `--color-brand-deep`、`--color-brand-soft` 供邊框與淡底，品牌方塊字色跟著換成米白。
- 一塊印 FB／IG／Threads／daily 的發文規則研究與套用對照，正本在 `content-playbooks/2026-09-04-iprinter-posting-rules.md`。
  重點結論：一塊印「被看到」是搜尋帶的（FB 151 追蹤、Threads 42 粉絲），社群的角色是把同一句問句放到第三個地方並導回文章；
  93 篇裡只有後期 17 篇配 Reel；每則貼文固定「鉤子→場景→反轉句→產品一句→出處→行動→下一集」。
- 已進 PR 的產線改動：文案出處行「出處：門市當日看件」、slot 1 下一集預告、Shorts 描述帶文章網址、hooks-bank 兩條反轉句原地取代、文章頁上一則／下一則。
- 驗證：`test/iprinterPostingRules.test.ts` 4/4；dailyContent、linePostRedirect、repeatCaptionVariation、nightlyChecks、youtubeScheduleAhead、scheduleReel 全綠
  （180 篇文案測試單跑 1.3 秒，並行時偶發超時，屬負載不是邏輯）。
- 沒做的：把主題句改成問句、系列化、投票收尾——這三件是 slot1-plan 主題層的決策，程式不能替老闆選題。

