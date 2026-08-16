# 私享家 90 天營收作業系統

> 【合併注記 2026-08-17,Claude】本檔自 aiwork-sxj 工作樹併入(佇列項「營收計畫合併」)。
> 它的**機制層**(北極星=付費訂單、追蹤鏈、null≠0、通路分工、GA4 事件契約、週複盤)自併入日起生效;
> 但「舊窗口結案、期間重設為 08-13~11-15」與「本檔是唯一正本」兩項**待老闆拍板**——
> 在那之前排程正本仍是 `data/slot1-plan.json`+`ab-test-plan.json`,策略正本仍是 `2026-08-12-90day-plan-v4.md`。
> 兩檔對「未量測≠0」「先讓數字存在」同源一致,無實質衝突;差異只在曆法與標題主權。

- 版本:v3(2026-08-12 重構)｜**本檔是 90 天計畫的唯一正本**
- 期間:**2026-08-13 ~ 2026-11-15**(W0 前置 4 天 + 13 個完整週,週一起算)
- 取代:`2026-08-12_90-day-revenue-plan-v2.md`(已刪,內容併入本檔);
  `2026-07-11_90-day-view-growth-playbook.md` 的觀看數/粉絲目標**廢止**,該檔降為**題材庫**
  (由 `src/generateGrowthPlaybook.ts` 生成,不要手改)。

> **這套系統以四件事判定工作是否完成,不以「今天發了幾篇」判定:**
> ① 是否產生可重複使用的內容資產 ② 是否能追蹤到正確來源
> ③ 是否帶來有效詢問 ④ 是否轉成付費訂單與回購

---

## 〇、期間重定基準(先講清楚,免得後面對不上)

原 90 天窗口(07-11 ~ 10-08)在 2026-08-12 **正式結案**,它產出的唯一有價值成果是一份診斷:
產線會跑、但錢的路徑斷在量測與入口。13 週的節奏需要 13 週,壓進剩下的 8 週會變成趕工表。
因此重新定基準:

| 段 | 日期 | 天數 |
|---|---|---|
| W0 前置 | 08-13(四) ~ 08-16(日) | 4 |
| W1 ~ W13 | 08-17(一) ~ 11-15(日) | 91 |

週界對齊週一~週日,週複盤固定週日;P0 在 W0 就動工,不等 W1。

### 三處與舊版衝突,以本表為準

| 項目 | 舊版寫法 | 本版 | 理由 |
|---|---|---|---|
| 產能 | 每日 7 則砍到 3 則 | **發布仍 3 則/日,但來源改為案例資產包** | 資產是庫存、發布是節流;一個案例包供 3–5 天的槽,不是每天現想 |
| IG 配比 | Reel 鞋類 29%→70% | **改用五分比例(見二)**:鞋 40 + 包/皮件 20 + 季節 15 + 知識 15 + 信任 10 | 鞋包合計 60%,比單一「鞋 70%」可執行,且留了季節與信任證據的位置 |
| 期末 | 2026-10-08 | **2026-11-15** | 13 週 × 7 天;舊窗口已結案 |

---

## 一、北極星與指標階梯

**唯一北極星:每月由數位通路帶來的「已完成付費訂單數」**(含 LINE、門市現金、電話、儲值扣款)。
粉絲數、瀏覽、按讚、網站流量一律不得出現在目標欄。

| 層級 | 指標 | 用途 |
|---|---|---|
| 曝光 | 有效觸及、搜尋曝光 | 判斷是否有人看到 |
| 興趣 | 影片完成率、頁面停留、收藏 | 判斷題材是否有需求 |
| 行動 | LINE 點擊、電話點擊、地圖導航 | 判斷 CTA 是否有效 |
| 詢問 | 新詢問數、來源渠道 | 判斷流量是否成為名單 |
| 成交 | 送洗件數、營收、客單價 | 最終商業價值 |

**追蹤鏈(每一則內容都必須能走完)**:

```
content_id → channel → channel_code → landing_page → line_click → inquiry_id → order_id → revenue
```

鏈上任何一環斷掉,該內容的成效判定一律寫 `null`(未取得),**不得寫 0**。
`0` 只代表「已量測且結果為零」。這條規則貫穿全系統。

### 三條鐵則

1. **未量測 ≠ 0。** 目前 `line_click` 因 gtag 缺席結構性為 0(見九),與需求無關。
2. **null ≠ 0。** 彙總時兩者分開統計,禁止混算;consent 拒絕或瀏覽器阻擋也算 null。
3. **產量 ≠ 營收。** 內容產線是支援層,不是成果。

---

## 二、通路分工(不是同一支影片三邊貼完)

### Instagram —— 主要信任與詢問入口

1,085 位在地粉絲都在這裡,這是離錢最近的既有資產。

**內容比例**:洗鞋前後對比 40% ｜ 包包/皮件案例 20% ｜ 羽絨衣、棉被與季節需求 15% ｜ 清洗知識與避坑 15% ｜ 門市、流程、顧客信任證據 10%

**每支 Reel 七項必備(缺一不發)**:
1. 前 1.5 秒直接出現髒污或成果(不做片頭、不做懸念鋪陳)
2. 清楚標示品項:「白鞋發黃」「麂皮鞋水痕」這種具體命名,不寫 generic
3. 至少一個清洗過程證據(不是只有前後兩張)
4. 前後畫面角度、物件一致(靠單次多鏡頭生成保證,見五)
5. 西屯/台中在地訊號
6. 單一 CTA:拍照傳 LINE 評估(**只能一個**,不要並列多個動作)
7. 專屬渠道碼

**判斷指標**(不看粉絲數):私訊率、Bio 點擊率、LINE 點擊率、**每千次播放產生的詢問數**(主指標)。

### Facebook —— 熟客與在地社群擴散

拆成三種內容,**不是 IG 同步轉貼**:

| 類型 | 寫法 | 禁止 |
|---|---|---|
| 粉專 | 案例、公告、季節提醒、評論截圖、服務說明 | — |
| 在地社團 | 問題或經驗型開場,門市與諮詢方式**放最後**。範例:「最近台中下雨,麂皮鞋沾水後不要直接吹熱風,容易留下更明顯水痕。這雙我們先做色牢度測試,再分區處理……」 | 直接貼廣告模板;同一社團洗版 |
| 熟客再觸達 | 依服務週期提醒:換季羽絨衣、棉被收納、雨季鞋包發霉、開學前球鞋、年前大件 | 群發無差別訊息 |

**判斷指標**:分享數、在地用戶互動、Messenger/LINE 詢問、**熟客回購訂單**。
社團發布須記入 `publication-log.jsonl`(哪個社團、哪天、哪則),避免重複與洗版。

### YouTube —— 長期搜尋資產

Shorts 可用同批素材,但**標題不能沿用 IG 字幕**,要用搜尋式語言:
「白鞋發黃洗得回來嗎?」「麂皮鞋碰水怎麼處理?」「羽絨外套可以自己丟洗衣機嗎?」
「包包發霉還能救嗎?」「洗鞋價格怎麼算?」

**每週至少把一個高價值題材擴寫成 2–5 分鐘完整解答影片。**
這類影片未必立即爆量,但累積 Google 與 YouTube 搜尋入口,同時餵養 AEO。
說明欄必須接服務頁 + 帶碼入口。

---

## 三、題材決策:內容題材評分器

**不再每天現想題材。** 每個候選題材先評分,再決定拍不拍:

| 維度 | 權重 |
|---|---:|
| 近期顧客詢問頻率 | 25 |
| 服務毛利與客單價 | 20 |
| 季節性需求 | 15 |
| 前後畫面可視性 | 15 |
| 搜尋需求 | 15 |
| 能否自然帶出 LINE CTA | 10 |

- **< 60**:不拍
- **60–74**:補充內容(填槽用)
- **≥ 75**:進入主要拍攝清單

**題材來源固定五處**(寫進 `topic-backlog.jsonl`,每筆帶六維分數與總分):
① 門市實際詢問 ② LINE 對話常見問題 ③ GSC 查詢 ④ Google 商家評論與問答 ⑤ 近期完成案例

這樣內容從真實需求長出來,不是 AI 隨機想文案。v1 母表(2026-07-11 檔)降為**題材候選來源之一**,
每則仍須過評分器才進拍攝清單。

---

## 四、一次拍攝形成「內容母體」

**一個真實案例 ≠ 一支影片。** 每個案例至少輸出十項資產:

1. 1 支 20–35 秒主 Reel
2. 2 支 8–15 秒短切片
3. 3–5 張前後對比圖片
4. 1 篇 FB 案例貼文
5. 1 個網站案例頁(或既有頁面更新)
6. 1 組限時動態
7. 1 個 FAQ
8. 1 則 Google 商家貼文
9. 1 個可放進 YouTube 標題庫的問題
10. 1 筆內容成效紀錄(`content-registry.jsonl`)

資產清單記入 `asset-manifest.jsonl`,共用同一個 `content_id` 前綴,跨通路可追。
**這是「3 則/日」與「內容母體」的接點**:一個案例包供 3–5 天的發布槽,產能不變、來源變。

---

## 五、文案架構依意圖拆分(不能同一套格式打天下)

| 型 | 用在 | 結構 |
|---|---|---|
| **搜尋型** | SEO 頁、YouTube、Google 商家 | 問題 → 原因 → 錯誤處理風險 → 專業處理方法 → 適用與不適用 → 拍照傳 LINE 評估 |
| **社群型** | IG / FB | 視覺衝突或痛點 → 這件物品發生什麼問題 → 處理過程 → 結果與限制 → 在地資訊 → 單一 CTA |
| **成交型** | 服務頁、廣告落地頁 | 服務對象 → 可處理問題 → 流程 → 價格或估價方式 → 時間 → 風險與限制 → 真實案例 → LINE 詢問 |

**禁用空話**:「歡迎來店」「專業清洗」「煥然一新」「還你潔白如新」——沒有辨識度、不可驗證。
所有文案共同必備:參考價或估價方式、地標或服務範圍(至善國中對面 / 台中市全區免費到府收送)、
單一 CTA、渠道碼。

**圖片**:真實門市照優先(乾淨櫃台、手部檢查、光線明亮);AI 生成圖**必須標示**、不冒充真實案例
(`imageProvenance.ts` / `markImageSource.ts` 續用)。

**影片(單次多鏡頭,取代拆三段)**——`generateGrokVideo.ts` / `importGrokVideo.ts` 改造:
① 同一物件、同地點、連續動作、≤15 秒 → **合併成一條提示詞**,內部【鏡頭1】【鏡頭2】【鏡頭3】分段
② 風格前置四段:全局畫質/物件材質/燈光/核心物理 ③ 禁令不掛固定尾巴
④ 時長畫幅不進正文 ⑤ 泛稱拆成具體事件 ⑥ 鏡頭時長依內容分配(不平均 5/5/5)
驗收:`videoReviewGate.ts` 加「前後物件同一性」檢查點。

---

## 六、發布與品質淘汰制度

**流程時刻表(續用)**:06:30 生成 → 10:20 審核(核准指紋)→ 11:35 / 12:05 / 20:35 發布 → 21:00 YT
→ 22:50 結算 → 23:10 自檢。8 道防禦閘門續用;發布失敗不重試,走 `catchup-publish.ps1` 人工補發。

**發布後 72 小時,每則內容必須被判入四類之一**(寫進 `content-registry.jsonl` 的 `decision`):

| 判定 | 條件 | 動作 |
|---|---|---|
| **Scale** | 詢問效率高(每千播放詢問數 ≥ 當期中位數 1.5 倍) | 繼續拍同系列 |
| **Repair** | 有觀看沒行動(播放達標但 line_click 偏低) | 改 CTA 或落地頁,不改題材 |
| **Stop** | 沒有需求訊號(觸及與行動雙低) | 停止投入該題材 |
| **Evergreen** | 持續有搜尋價值 | 定期更新,進 SEO 資產 |

沒有這套判定,產線只會持續製造內容,卻不知道什麼帶來營收。
**W1–W2 期間量測未修復,一律判 `pending`,不得先射箭再畫靶。**

---

## 七、SEO 頁面矩陣(依 repo 實查,2026-08-12)

每個核心服務要有四種頁面角色:**商業服務頁**(接詢問)、**問題解答頁**(搜尋流量)、
**案例頁**(建立信任)、**在地頁**(GEO)。現況與缺口:

| 服務 | 商業服務頁 | 問題解答頁 | 案例頁 | 在地頁 |
|---|---|---|---|---|
| 洗鞋 | `services/white-shoe-cleaning.html`(僅白鞋)<br>`services/shoe-bag-care.html`(鞋包混用) | `guides/white-shoe-yellowing.html`<br>`guides/rainy-shoe-care.html` | **🔴 無** | `local/qinghai-road-shoe-cleaning.html`<br>`services/taichung-xitun-laundry.html` |
| 包包/皮件 | **🔴 無獨立頁**(併在 shoe-bag-care) | `guides/bag-handle-cleaning.html` | **🔴 無** | 無 |
| 棉被/寢具 | **🔴 無清洗服務頁**(`fabric-storage.html` 是收納向) | `guides/bedding-duvet-cleaning.html`<br>`guides/bedding-storage-check.html` | **🔴 無** | 無 |
| 西裝/精品 | — | `guides/shirt-suit-dry-cleaning.html`<br>`guides/luxury-dry-cleaning.html` | **🔴 無** | 無 |
| 收送 | `services/taichung-citywide-laundry-pickup.html` | `guides/taichung-laundry-service-search.html` | **🔴 無** | 無(逢甲缺) |
| B2B | `services/business-bulk-laundry.html` | — | — | — |

**三個結構缺口**:① **案例頁整類都沒有**(`docs/posts/` 38 頁是每日貼文歸檔,不是前後案例頁)
② 包包與棉被沒有獨立商業頁,意圖混在別頁 ③ 在地頁只有青海路與西屯,缺逢甲。

**施工優先順序(離成交近 → 遠,不平均優化 88 頁)**:
1. 洗鞋服務主頁(先把 shoe-bag-care 拆成「洗鞋」與「包包清洗」兩頁)
2. 包包清洗服務頁(新建)
3. 羽絨衣/棉被清洗服務頁(新建,與 fabric-storage 的收納意圖分開)
4. 西屯/逢甲/台中在地頁(逢甲新建)
5. 高曝光、低 CTR 頁面(GSC 週檢清單)
6. 有流量但沒有 LINE 點擊的頁面
7. FAQ 與案例頁

**每個錢頁必備 12 項**(缺任一不算完工):唯一且具體的 title｜可點擊的 meta description｜清楚 H1｜
真實前後案例｜處理範圍與限制｜價格或估價方法｜地區資訊｜FAQ schema｜LocalBusiness / Service schema｜
LINE CTA｜可追蹤渠道碼｜更新日期與真實門市資訊。

站內渠道碼由 `generatePublicSite.ts` 自動生成(`homepage` / `service-{slug}` / `support-{slug}` /
`post-{date}-slot-{n}`),新頁沿用同一函式即可,不要手寫連結。

---

## 八、AEO / GEO

**AEO 的內容必須能被直接抽取回答**,六段式:
問題標題 → **一句直接答案** → 條件與例外 → 處理步驟 → 不可自行處理的情況 → 門市服務方式

範例:

> **麂皮鞋可以水洗嗎?**
> 不建議直接整雙浸水。麂皮吸水後可能出現色差、水痕、變硬或掉色,應先測試色牢度,再依污漬區域處理。

**GEO 要建立一致實體訊號**:店名、地址、電話、營業時間、服務項目五處一致;Google 商家類別正確;
網站與社群互相連結;真實照片持續更新;評論有具體品項與地區語意;回覆評論時自然補充服務資訊。
現有資產(`llms.txt` / `llms-full.txt` / `llms.jsonl` / `ai-discovery.json` / `answers.json` /
`knowledge-graph.json` / `ai-sitemap.xml` / `business-profile.json`)已在,續用並隨新頁同步。

**28 天面板續用**(引擎:google-web、google-ai-overview、chatgpt-search、perplexity、bing-copilot、
gemini、grok-search),指標分開記(indexed_page、brand_mention、linked_citation、cited_url、
answer_accuracy、ai_referral),缺資料保留 null。

> **判準升級**:「某 AI 提到私享家」**不算成果**。成果是它是否導向網站、地圖、LINE 或訂單。

---

## 九、GA4 事件契約

### 🔴 P0 現況(2026-08-12 程式實查)

`generatePublicSite.ts` 的 `buildAnalyticsTag()` 在 `PUBLIC_GA4_MEASUREMENT_ID` 未設定時輸出空字串,
**docs/ 全站沒有任何 gtag.js 載入碼**;`go/line.html` 只在 `window.gtag` 存在時送事件,否則 250ms 直接跳轉。
**結論:`line_click` 從結構上必為 0。修復前,GA4 的一切數字不可判讀。**

已具備的基礎(不必重建):`/go/line.html` 已保留 `source` / `content` / `slot` 三參數並用
`transport_type: 'beacon'` + 1.2s callback + 1.5s fallback;`tel:` 連結已在 4 處渲染;
`business-profile.json` 已有 `map_url`。缺的是載入碼、事件掛載與去重。

### 事件表

| 事件 | 觸發條件 | 必要參數 |
|---|---|---|
| `line_click` | 使用者實際點擊 LINE | `page_path`、`placement`、`content_id`、`channel_code` |
| `phone_click` | 點擊電話 | `page_path`、`placement` |
| `map_click` | 點擊地圖導航 | `page_path`、`location` |
| `inquiry_recorded` | 人工建立詢問紀錄 | `inquiry_id`、`source`、`service` |
| `booking_recorded` | 確認送洗 | `inquiry_id`、`order_id` |
| `purchase_completed` | 訂單完成付費 | `order_id`、`value`、`service`、`source` |

### 必須驗證的八項

1. 首頁、服務頁、文章頁**皆有**載入 GA4(不是只有首頁)
2. Consent 拒絕或瀏覽器阻擋時,**不把未取得寫成 0**(寫 null)
3. 同一次點擊不重複送事件(注意:`/go/line.html` 用返回鍵重進會再送一次,需 guard)
4. 渠道碼不被重新導向吃掉
5. LINE 跳轉頁仍保留來源參數
6. GA4 DebugView 可即時看到事件
7. Realtime 報表可看到來源
8. 人工 leads ledger 可與事件對帳

**成交金額不得只依 GA4 推估**——GA4 證明「點了」,金額以 `orders-attribution.jsonl` 人工台帳為正本。

### P0 完成標準(不是「程式碼裡有 gtag」)

> **實際用手機、從指定 IG 渠道碼點擊 → 進站 → 點 LINE → DebugView 出現正確 `line_click`(含四個參數)
> → leads ledger 記錄到相同渠道碼。** 四條入口(IG、FB、YT、Google 商家)各做一次,結果寫入
> `ga4-validation.jsonl`。

機器層事件正本沿用既有的 `src/conversionFunnel.ts`(已有 line_click / inquiry / booking / revenue
模型與 platform / source / count / revenue_twd 欄位),**擴充而非另起爐灶**:補 null 語意、
`quoted`、`lost_reason`、`content_id`、`channel_code`。

---

## 十、13 週節奏

每週四欄:**輸入 → 輸出 → 驗收(Gate)→ 決策點**。Gate 不過不進下一週的優化類工作。

| 週 | 日期 | 主題 | 輸出 | Gate(怎麼驗) |
|---|---|---|---|---|
| **W0** | 08-13~08-16 | P0 動工 | 設 measurement ID、重建發布 | 站上任一頁 view-source 看得到 gtag.js |
| **W1** | 08-17~08-23 | 量測修復 | 事件契約落地、渠道碼登記表、四條入口實測、人工詢問與成交台帳建立 | **至少四條真實點擊能從入口追到事件**(DebugView 截圖 + ledger 對帳) |
| **W2** | 08-24~08-30 | 基準盤點 | 匯出近 90 天 GSC;記錄商家曝光/電話/導航/網站點擊;IG/FB/YT 基準;近期詢問依服務與來源分類 | **null、未知、0 三者明確分離**(逐欄可指出屬於哪類) |
| **W3** | 08-31~09-06 | 錢頁優化 | 三個核心服務頁(洗鞋、包包、棉被)補 title/meta/案例/FAQ/CTA/schema;手機版 CTA 不被遮擋 | 每頁有唯一目的與可追蹤 LINE 入口;實機開頁點得到 |
| **W4** | 09-07~09-13 | 內容母體流程 | 選三個真實案例,每案例產出跨平台內容包;建立 content_id;建立發布與回填流程 | **一個案例形成 ≥6 項資產**且共用同一 content_id |
| **W5** | 09-14~09-20 | IG 轉換優化 | 測三種前 1.5 秒開場、兩種 CTA、案例型 vs 知識型 | 以**詢問率**判勝負,不用按讚;每組 ≥3 則樣本 |
| **W6** | 09-21~09-27 | FB 在地擴散 | 粉專/社團/熟客三種模板;在地問題型內容測試;社團發布紀錄 | 社團無重複無洗版(publication-log 可查);有社團帶來的詢問 |
| **W7** | 09-28~10-04 | YouTube 搜尋層 | Shorts 標題改問題式;上架 ≥1 支完整解答影片;描述欄接服務頁與帶碼入口 | YT 來源出現在 GA4;標題庫 ≥10 題 |
| **W8** | 10-05~10-11 | Google 商家 | 補服務分類與說明;更新真實照片;每週 ≥1 則商家貼文;合規邀評流程;統一回覆模板但保留個別內容 | 評論數對 W2 基準有變化;商家帶來的網站/LINE 點擊可見 |
| **W9** | 10-12~10-18 | AEO / FAQ | 從真實詢問整理 20 題,優先發布最接近成交的 8 題(六段式) | 8 題皆含直接答案、風險、限制與 CTA;已進 FAQ schema |
| **W10** | 10-19~10-25 | 轉換優化 | 找出「有流量無點擊」頁、「有點擊無詢問」渠道、「有詢問無成交」服務,分別修標題/CTA/信任證據/報價流程 | 三張清單各有具名項目與已執行的修正 |
| **W11** | 10-26~11-01 | 內容淘汰與加碼 | 全部內容判入 Scale / Repair / Stop / Evergreen | 每個 content_id 都有 decision,無 pending |
| **W12** | 11-02~11-08 | 回購與熟客 | 依服務週期建立提醒題材;區分新客/熟客/沉睡客;不騷擾式季節提醒 | **追蹤回購訂單**,不是「訊息已發送」 |
| **W13** | 11-09~11-15 | 總結與下季決策 | 各渠道詢問與成交、各服務客單與毛利、每個 content_id 詢問效率、搜尋與商家變化、保留/停止/擴大清單 | 下一季**只設有基準支持的數字目標** |

### 停損條款

**W1 的 Gate 沒過,W3 之後的轉換類工作全部順延**,順延期間只做內容資產累積與錢頁內容補強
(這兩件不依賴量測)。理由:在量測壞掉的狀態下做轉換優化,等於拿雜訊當訊號調參數,
會把「沒量到」誤判成「沒需求」——這正是前 32 天踩過的坑,不重踩。

---

## 十一、人力現實(這節是我加的,因為計畫要跑得動)

上面的量若沒有分工,會壓在同一個人身上然後停擺。分配如下:

| 誰 | 負擔 | 上限 |
|---|---|---|
| **老闆** | 每日 22:50 回填 daily-close(詢問/報價/成交,不知道就填 null);每週一次邀評;報價回覆 | **≤10 分鐘/日** |
| **系統(排程)** | 生成、審核、發布、洞察抓取、結算、自檢、IndexNow、提醒 | 現行 9 條排程 |
| **待派工(fleet)** | 所有程式改動(見十三) | 單一 writer |
| **人工(非老闆)** | 案例拍攝、社團發文、YouTube 長影片、週複盤判讀 | 每週集中,不逐日 |

拍攝採**集中制**:每 1–2 週集中拍 3 個案例(一次進場拍完十項資產的素材),不是每天現拍。

---

## 十二、紀錄架構

```
aiwork-sxj/
├─ content-playbooks/
│  ├─ 90-day-revenue-operating-system.md      ← 本檔:計畫正本(手寫)
│  └─ 2026-07-11_90-day-view-growth-playbook.md ← 題材庫(生成檔,勿手改)
├─ data/
│  ├─ revenue/
│  │  ├─ daily-close.jsonl          每日收盤回填
│  │  ├─ leads-ledger.jsonl         每筆詢問追到結案
│  │  ├─ orders-attribution.jsonl   訂單←來源歸屬(金額正本)
│  │  ├─ channel-codes.json         渠道碼登記表
│  │  ├─ ga4-validation.jsonl       四條入口實測紀錄
│  │  └─ gbp-baseline.md            商家評論基準與週變化
│  ├─ content/
│  │  ├─ content-registry.jsonl     每則內容一行(含 decision)
│  │  ├─ topic-backlog.jsonl        題材候選與六維評分
│  │  ├─ publication-log.jsonl      發布紀錄(含社團,防洗版)
│  │  ├─ asset-manifest.jsonl       案例→資產包清單
│  │  └─ performance-weekly.jsonl   週成效彙總
│  └─ search/
│     ├─ gsc-weekly.jsonl           GSC 週匯出
│     ├─ money-pages.json           錢頁清單與角色
│     ├─ faq-registry.jsonl         FAQ 題庫與上線狀態
│     └─ local-entity-audit.md      GEO 實體訊號一致性稽核
└─ plan-log/
   ├─ weekly/       每週複盤(範本 _TEMPLATE.md)
   ├─ decisions/    決策紀錄(改了什麼、為什麼、依據)
   ├─ experiments/  A/B 測試紀錄(W5 起)
   └─ revisions/    本計畫修訂紀錄
```

**content-registry.jsonl 一行**:

```json
{
  "content_id": "2026-08-shoe-001",
  "service": "shoe_cleaning",
  "problem": "white_shoe_yellowing",
  "channel": "instagram",
  "format": "reel",
  "published_at": "2026-08-12T18:30:00+08:00",
  "channel_code": "ig_reel_shoe_001",
  "landing_page": "/shoe-cleaning/",
  "views": null,
  "line_clicks": null,
  "inquiries": null,
  "bookings": null,
  "revenue": null,
  "decision": "pending"
}
```

**daily-close.jsonl 一行**:

```json
{"date":"2026-08-13","inquiries":{"tagged_line":0,"direct_line":null,"phone":null,"walk_in":null},"quotes":null,"orders":null,"revenue_twd":null,"note":""}
```

**leads-ledger.jsonl 一行**:

```json
{"id":"L-20260813-01","date":"2026-08-13","source":"direct_line","channel_code":null,"content_id":null,"item":"白鞋 2 雙","quoted_twd":600,"first_reply_min":12,"outcome":"pending","lost_reason":null,"order_twd":null,"closed_date":null}
```

> `null` = 尚未取得;`0` = 已量測且結果為零。**全系統唯一最重要的一條資料規則。**

**節奏**:每日 22:50 老闆回填 → 每週日 `weekly-review.ps1` 出三區塊(營收 / 搜尋 / GA4,null 與 0 分開)
→ 人工判讀寫 `plan-log/weekly/YYYY-MM-DD.md` → 每月底對基準決定下月數字目標 → 計畫修訂記入
`plan-log/revisions/`。

---

## 十三、待派工清單(實作歸 fleet,單一 writer)

| # | 項目 | 週次 |
|---|---|---|
| 1 | 🔴 **P0 GA4 上線**:設 measurement ID、重建、發布、四條入口實測到 DebugView | W0–W1 |
| 2 | 事件契約實作:`phone_click` / `map_click` 掛載、去重 guard、consent 下寫 null | W1 |
| 3 | `conversionFunnel.ts` 擴充:null 語意、quoted、lost_reason、content_id、channel_code | W1 |
| 4 | daily-close 回填工具(一行式 CLI 或 LINE 快捷)+ 22:50 排程提醒 | W1 |
| 5 | `channel-codes.json` 建檔 + 社群側碼(bio/文案/頭香/限動)入冊 | W1 |
| 6 | `weekly-review.ps1` 加營收/搜尋/GA4 三區塊(null 與 0 分開) | W2 |
| 7 | 錢頁:shoe-bag-care 拆頁、包包頁、棉被清洗頁、逢甲在地頁(四頁新建/拆分) | W3 |
| 8 | **案例頁模板**(目前整類缺席)+ money-pages.json | W3 |
| 9 | 題材評分器:`topic-backlog.jsonl` 與六維計分 | W4 |
| 10 | content_id 生成與 `content-registry.jsonl` 回填流程 | W4 |
| 11 | 影片單次多鏡頭生成 + `videoReviewGate.ts` 物件同一性檢查 | W4 |
| 12 | `contentPlan.ts`:產能 7→3、IG 五分配比 | W4 |
| 13 | 72 小時後自動判定 Scale/Repair/Stop/Evergreen(依 registry 數據) | W11 |
| 14 | GBP API 通過後自動抓評論寫入 gbp-baseline(通過前手動記) | W8 |

---

## 十四、依據

- **repo 程式實查(2026-08-12)**:`generatePublicSite.ts`(`buildAnalyticsTag` / `trackedLineUrl`)、
  `docs/go/line.html`、docs 全站 gtag 掃描、`conversionFunnel.ts`、`business-profile.json`(map_url)、
  docs 頁面清單(services 6 / local 1 / guides 10 / posts 38)。
- **本機實測快照(2026-08-12)**:粉絲 1,414(台中 76.8%,約 1,085)、28 日非粉觸及 1,284、
  GSC 曝光 491 / 點擊 4;`output/operations/local-reach.json`、`data/insights/`、IG Graph API。
- **六節點營收鏈**:`sixiangjia-revenue-system-v2.1-20260812-013637.zip`(SHA-256 `77450df2…`);
  審查 `_bridge\runs\sixiangjia-arch-grok-final-20260812`(商業真實性 APPROVE)、
  `sixiangjia-arch-luna-final-20260812-r2`(規格 APPROVE)。
- **影片方法論**:github.com/zhangxiansheng-888/chuanzhangAIshijie(MIT,「船长AI视界」)。

## 修訂紀錄

- **2026-08-12 v3**|重構為營收作業系統:補題材評分器、通路分工、內容母體、文案三型、
  頁面矩陣(含三個結構缺口)、GA4 事件契約與 P0 完成標準、13 週 Gate 節奏、內容淘汰制度、
  人力分工與停損條款;期間重定基準為 08-13 ~ 11-15;紀錄架構擴為 revenue/content/search + plan-log。
  v2 檔案已刪除,內容併入本檔。
- 2026-08-12 v2|廢止 v1 觀看/粉絲目標,改營收鏈六節點(已併入 v3)
