我會針對六類開源專案做深挖，先平行搜尋可驗證的 repo／模板，再整理成可搬清單。再補搜較弱的幾類：在地商家手冊、設計模板、SEO 工具與更多社群／影片專案。# 台中洗衣店 AI 行銷系統：開源深挖清單

> 目標：找出**可直接借用**的開源專案／模板／方法。每項附 repo 連結、一句話用途、**【可搬】**具體產物。  
> 適用場景：私享家／台中在地洗衣店（IG Reels、Threads、Google 商家、海報 DM、SEO、AI 短影音）。

---

## 1. 社群自動化與排程（Buffer / Postiz 類自架）

| # | 專案 | 解決什麼 | 【可搬】 |
|---|------|----------|---------|
| 1 | **[Postiz](https://github.com/gitroomhq/postiz-app)**（~34k★） | 自架 Buffer/Hypefury 替代：多平台排程、AI 產文、團隊協作、API／n8n 串接。 | **整套自架排程後台** + 多平台 OAuth 發布流程；把每日文案／Reel 標題丟進 API 排程；當「內容日曆 → 一鍵多發」的中樞。 |
| 2 | **[Mixpost](https://github.com/inovector/mixpost)** | Laravel 自架社群管理：內容日曆、多平台發佈、分析（Buffer 替代）。 | **內容日曆 UX／佇列模型**；若團隊偏 PHP 可整站自架；學「草稿→審核→排程→發佈」狀態機。 |
| 3 | **[n8n](https://github.com/n8n-io/n8n)** + [社群工作流庫](https://n8n.io/workflows/categories/social-media/) + [awesome-n8n-templates](https://github.com/enescingoz/awesome-n8n-templates) | 自架 Zapier：串 Sheets／Notion／AI／社群 API；上百個 social 模板。 | **「生成文案 → 審核 → 排程 → 回寫成效」管線**；洗衣店日常可做成：Google Sheet 一列 = 一天貼文 → 自動丟 Meta／YT。 |
| 4 | **[Bulkit.dev](https://github.com/questpie/bulkit.dev)** | 自架 bulk posting／排程，強調無限頻道、資料在自己伺服器。 | **大量排程／多帳號批量邏輯**（多門市或 A/B 帳號時）；對照 Postiz 的精簡實作路徑。 |
| 5 | **[Anil-matcha/Free-AI-Social-Media-Scheduler](https://github.com/Anil-matcha/Free-AI-Social-Media-Scheduler)** | 輕量 AI 社群排程（自架、內建 AI 產文）。 | **小而美的 AI 產文＋排程骨架**；當 Postiz 太重時的 PoC 或單店精簡版。 |

**落地建議（洗衣店）**  
優先：**n8n（管線）+ Postiz 或現有 Meta Graph 腳本（發佈）**。你們已有 meta-publisher 的話，n8n 負責「內容生→審→送 API」，不必一次換掉整套。

---

## 2. 爆款內容分析（Hook／Viral／短影音資料）

| # | 專案 | 解決什麼 | 【可搬】 |
|---|------|----------|---------|
| 1 | **[tiktok-viral-hooks](https://github.com/shixinzhang/tiktok-viral-hooks)** | 開源爆款 TikTok 鉤子庫：逐片拆解文稿、心智圖、2 句公式。 | **Hook 公式卡**（開頭 1–3 秒模板）；直接改寫成「洗衣／除臭／皮鞋保養」繁中公式庫。 |
| 2 | **[davidteather/TikTok-Api](https://github.com/davidteather/TikTok-Api)** | 非官方 TikTok Python wrapper：趨勢、帳號、影片 metadata。 | **競品／同業短影音 metadata 管線**（播放、hashtag、音樂）；注意維護成本與 ToS，只作研究用。 |
| 3 | **[Q-Bukold/TikTok-Content-Scraper](https://github.com/Q-Bukold/TikTok-Content-Scraper)** | 研究向 scraper：影片／投影片 metadata（百餘欄），學術團隊用過。 | **爆款特徵資料集欄位設計**（互動、時長、音樂、字幕結構）；建「同業洗衣店帳號追蹤表」。 |
| 4 | **[FujiwaraChoki/supoclip](https://github.com/FujiwaraChoki/supoclip)** / **[fralapo/clippyme](https://github.com/fralapo/clippyme)** | 開源 Opus Clip 替代：長片 → AI 找爆點 → 9:16 短片＋字幕。 | **「店內長片／客訴前後／教學片 → 自動剪 3 支 Reels」流程**；viral-moment 評分邏輯可當內容品管。 |
| 5 | **[tiktok/tiktok-research-api-wrapper](https://github.com/tiktok/tiktok-research-api-wrapper)** | 官方 Research API 的 Python／R wrapper（合規研究用）。 | **合規資料採集路徑**（若有學術／研究資格）；學官方欄位定義來設計自家「爆款分數」。 |

**落地建議**  
先搬 **hook 公式庫 + 手動對標 20 支同業爆片**；再考慮 Opus Clip 類開源做「門市實拍長片 → 自動出 3 支 Reels」。

---

## 3. 在地商家行銷 Playbook（Local Business）

| # | 專案 | 解決什麼 | 【可搬】 |
|---|------|----------|---------|
| 1 | **[draftdev/startup-marketing-checklist](https://github.com/draftdev/startup-marketing-checklist)** | 依時間序的完整行銷戰術清單（開源、可 fork）。 | **90 天開店／重啟行銷 checklist**；挑在地相關條目改成「台中洗衣店版」。 |
| 2 | **[flowforfrank/seo-checklist](https://github.com/flowforfrank/seo-checklist)** | 技術／on-page／off-page SEO 要求清單。 | **官網＋服務頁 SEO 驗收表**（title、H1、內連、圖片 alt…）。 |
| 3 | **[Faustius/monadic-local-seo-checklist](https://github.com/Faustius/monadic-local-seo-checklist)** | 在地 SEO「隱形商家」技術稽核：NAP、Maps、可見度。 | **NAP 一致性＋Maps 排名診斷協議**；直接套「私享家」多點／多平台名稱地址電話。 |
| 4 | **[Bryanfikes/local-seo-toolkit](https://github.com/Bryanfikes/local-seo-toolkit)** | Local SEO 工具包：schema 模板、robots、GBP 檢查表、citation builder。 | **LocalBusiness／LaundryService JSON-LD 模板** + GBP 優化 checklist + 引用／目錄清單骨架。 |
| 5 | **[garrettjsmith/localseoskills](https://github.com/garrettjsmith/localseoskills)** | 把 Claude 變成 Local SEO 專家的 skills／自動化模板。 | **Agent 用 Local SEO skill 包**（審 GBP、產在地文案、出報告）；可接到你們既有 agent 工作流。 |
| 6 | **[mattedwardseo/local-seo-checklist](https://github.com/mattedwardseo/local-seo-checklist)** | 互動式 Local SEO 稽核 checklist（打勾計分）。 | **客戶／店長可自評的互動檢查表 UI 概念**；門市週檢用。 |

**落地建議**  
立刻可做：**GBP 優化表 + NAP 稽核 + LocalBusiness schema**（對「台中洗衣／精緻洗／皮鞋清潔」關鍵字最直接）。

---

## 4. 海報／DM／廣告設計模板（Canva 替代、可印刷）

| # | 專案 | 解決什麼 | 【可搬】 |
|---|------|----------|---------|
| 1 | **[dromara/yft-design](https://github.com/dromara/yft-design)**（~1.6k★） | 開源「稿定設計」：Vue3 + fabric.js 海報／長圖／封面編輯。 | **自架簡易設計器**或學模板 JSON 結構；做「週年慶／開幕／優惠 DM」可編輯模板。 |
| 2 | **[Aktivisda](https://framagit.org/aktivisda/aktivisda)**（[官網](https://aktivisda.earth/)） | 組織品牌視覺產生器：固定色／字／素材，素人也能出一致海報。 | **「品牌鎖定」模板系統**（Logo、主色、禁改區）；門市員工只改價目與日期就能印。 |
| 3 | **[clawnify/open-design](https://github.com/clawnify/open-design)** | 開源 Canva 向編輯器：社群圖、引用卡、公告圖。 | **IG 方形／限動模板引擎**；串進你們 caption／日更管線。 |
| 4 | **[imgly/canva-clone-react-cesdk](https://github.com/imgly/canva-clone-react-cesdk)** | React + CE.SDK 範例：邀請函、flyer、名片、明信片。 | **可印刷尺寸預設**（A4/A5 flyer、名片 bleed）；學 print-ready 匯出流程。 |
| 5 | **[Imam-Abubakar/mural](https://github.com/Imam-Abubakar/mural)** | FabricJS + React 輕量設計器，多格式匯出。 | **輕量前端編輯元件**；當嵌入後台的「海報小工具」參考。 |

**注意**  
[Polotno Studio](https://github.com/polotno-project) 好用但 **SDK 非完全開源**；適合當產品對標，不建議當「可 fork 核心」。  
**落地**：短期用 Canva 也可，中期把 **Aktivisda 式品牌鎖定 + yft-design 模板格式** 變成「店內 DM 自動生成」。

---

## 5. SEO／索引自動化（sitemap／schema／IndexNow 之外）

| # | 專案 | 解決什麼 | 【可搬】 |
|---|------|----------|---------|
| 1 | **[goenning/google-indexing-script](https://github.com/goenning/google-indexing-script)** | 用 Google API 批次請求索引整站頁面。 | **上新服務頁／部落格後自動「請求索引」腳本**；接 deploy CI。⚠ 官方 Indexing API 主要適用 job／livestream，一般頁面屬灰區，需搭配 GSC 觀察。 |
| 2 | **[harlan-zw/request-indexing](https://github.com/harlan-zw/request-indexing)**（[requestindexing.com](https://requestindexing.com/)） | 找未索引頁並用 Indexing API 請求；可自架。 | **「發現未索引 → 提交 → 追蹤狀態」儀表板**；服務地區頁（南屯／西屯…）上線時用。 |
| 3 | **[jakob-bagterp/index-now-submit-sitemap-urls-action](https://github.com/jakob-bagterp/index-now-submit-sitemap-urls-action)** | GitHub Action：deploy 後把 sitemap 丟 IndexNow（Bing／Yandex 等）。 | **CI 一鍵 IndexNow**（你們已有 sitemap 就直接掛 workflow）。 |
| 4 | **[PhialsBasement/LibreCrawl](https://github.com/PhialsBasement/LibreCrawl)** | 開源 Screaming Frog 替代：爬站、連線、SEO 資料匯出（含 JS 渲染）。 | **定期技術 SEO 爬蟲報告**（斷鏈、缺 meta、重複 title）；門市官網健康檢查。 |
| 5 | **[viasite/site-audit-seo](https://github.com/viasite/site-audit-seo)** / **[StanGirard/seo-audits-toolkit](https://github.com/StanGirard/seo-audits-toolkit)** | 爬站 + Lighthouse 多頁稽核／安全標頭。 | **Core Web Vitals + on-page 批次報告**；上線前／每月固定跑。 |
| 6 | **[sethblack/python-seo-analyzer](https://github.com/sethblack/python-seo-analyzer)** | Python 站內 SEO 分析 CLI。 | **輕量 CLI 接進每日自動化**；比桌面爬蟲更易腳本化。 |

**sitemap／schema／IndexNow 之外還能加的「索引加速棧」**  
1. **Google Indexing API 批次請求**（上列 1–2）  
2. **IndexNow on deploy**（上列 3）  
3. **GSC API 讀「已發現未索引」→ 自動重送**  
4. **站內爬蟲修技術債**（避免爬了卻不收錄）  
5. **LocalBusiness + FAQ + Service schema**（提升富結果資格，間接利於收錄品質）

---

## 6. AI 影片工作流（prompt 工法／分鏡／非船長系）

| # | 專案 | 解決什麼 | 【可搬】 |
|---|------|----------|---------|
| 1 | **[smixs/visual-skills](https://github.com/smixs/visual-skills)** | Agent 用「電影導演 skill」：劇作／分鏡語言 + Seedance／Kling／Veo 等精確 prompt 語法。 | **導演級 prompt 骨架**（鏡頭、blocking、蒙太奇）；改寫成「洗衣前後對比／皮鞋修復」shot chain。 |
| 2 | **[Vincentwei1021/video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft)**（~4k★） | Claude/Codex skill：產品宣傳片分鏡 + Remotion；上百張 shot recipe cards。 | **產品／服務宣傳片「鏡頭食譜卡」**；洗衣店可對應：進店→分類→洗程→交件→滿意特寫。 |
| 3 | **[HBAI-Ltd/Toonflow-app](https://github.com/HBAI-Ltd/Toonflow-app)**（~13k★） | 小說／劇本 → 角色 → 分鏡 → 動畫短劇一站式開源工具。 | **「劇本→分鏡→成片」管線架構**；角色一致性與分鏡節點設計可學（故事型廣告片）。 |
| 4 | **[clipcurator 系列](https://github.com/clipcurator)**（storyboard packs / shot-list templates / production workflows） | AI 短劇分鏡包、shot list 模板、production playbook。 | **分鏡表／鏡頭 continuity 欄位標準**（景別、運鏡、時長、對白、道具）；直接當拍攝腳本表頭。 |
| 5 | **[fanchengchen1-collab/super-director](https://github.com/fanchengchen1-collab/super-director)** | 中英雙語「超級導演」：光影／分鏡／節奏 → 六段式影片提示詞（Sora/Kling/Veo/Seedance）。 | **六段式 video prompt 模板**（開場→衝突→過程→反轉→結果→CTA）；極適合 15–30s Reels。 |
| 6 | **你們既有的 sixiangjia-video-evidence / grok-video-producer** | （對照用）門市證據片＋Grok Imagine 產線。 | **把上列 shot recipe／六段式 prompt 併入既有 skill**，不必另起爐灶。 |

**可搬的「工法」摘要（比工具更重要）**  
- **Hook 3 秒**（來自 viral-hooks）  
- **Shot recipe card**（景別 + 運鏡 + 道具 + 對白 + 時長）  
- **角色／場景一致性錨點**（Toonflow／分鏡 pack）  
- **六段式 prompt**（super-director）  
- **長片→爆點剪輯**（supoclip／clippyme）

---

## 對「私享家／台中洗衣」的優先搬運順序

| 優先 | 動作 | 來源 |
|------|------|------|
| P0 | Hook 公式庫繁中化（洗衣痛點：污漬、氣味、皮鞋、趕件） | tiktok-viral-hooks |
| P0 | GBP + NAP + LocalBusiness schema 檢查表 | local-seo-toolkit / monadic checklist |
| P1 | n8n：Sheet → 產文 → Meta/YT 排程 | n8n + Postiz 或現有 publisher |
| P1 | Deploy → IndexNow + GSC 未索引重送 | IndexNow Action + request-indexing |
| P2 | 鏡頭食譜 + 六段式 prompt 併入 video skill | video-shotcraft / visual-skills / super-director |
| P2 | 品牌鎖定 DM／海報模板（價目、活動） | Aktivisda 概念 + yft-design |
| P3 | 自架完整排程後台（若要脫離 SaaS） | Postiz / Mixpost |
| P3 | 門市長片自動切 Reels | supoclip / clippyme |

---

## 使用風險（務實提醒）

1. **非官方 scraper**（TikTok-Api 等）：易壞、可能違反 ToS → 只做競品研究，不依賴正式生產。  
2. **Google Indexing API**：官方適用範圍窄；一般服務頁以 **sitemap + IndexNow + GSC** 為主，Indexing API 當輔助並監控配額。  
3. **自架排程工具**（Postiz/Mixpost）：Meta／TikTok OAuth 審核與 API 政策仍是瓶頸；台灣小商家常仍要走官方 Graph／審核帳號。  
4. **授權**：AGPL 專案（部分排程／設計工具）若改完要當 SaaS 對外，需評估 copyleft。

---

若要下一步，我可以依這份清單直接產出其中一包可落地產物，例如：  
**（A）洗衣店 20 條 Hook 公式卡**、**（B）n8n 日更管線草圖**、或 **（C）Local SEO + schema 一頁檢查表**。
