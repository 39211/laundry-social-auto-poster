# Treatment 2 草稿：洗包意圖承接（DRAFT_ONLY）

## 觸發證據

- 2026-09-02 公開 SERP 抽樣：`台中洗包`、`西屯洗包包` 的前列結果主要由市場平台與其他鞋包業者占據，未見私享家頁面；詳見 `reports/public-serp-visibility-recheck-2026-09-02.md`。
- 私享家既有 `/services/shoe-bag-care.html` 已有「包角水痕、提把油痕、包內裡濕氣、材質判斷、LINE 傳照片、台中市免費收送、清潔費另計」等第一方內容；不需發明新服務或新價格。

## 目標與範圍

- 目標頁：`/services/shoe-bag-care.html`（既有 URL）。
- 觀測詞：`台中洗包`、`西屯洗包包`、`台中包包清潔`、`包包送洗`。
- 只允許一個正文 treatment：在現有鞋包服務段落增加一段以「洗包／包包清潔」為主詞的直接承接，並同步檢查答案框與 JSON-LD；不新增城市頁、不建立同義 URL。
- 本 treatment 不得與企業／價目內鏈變因同一窗口發布；先完成目前 treatment 的 7／28 日判定。

## 內容邊界（草稿，不是 live 文案）

可用的第一方事實只能來自既有 live 頁與 business profile：

1. 先看包身材質、提把、包角、內裡與痕跡深度，再決定清潔或先說明限制。
2. 先拍包包整體、提把、包角、內裡與問題近照，透過 LINE 詢問。
3. 台中市內收送本身免費、沒有最低消費門檻；清潔／洗護費用依物件狀態另行判斷。
4. 發霉、掉色、邊油磨耗、塗層霧化或結構損傷不承諾恢復新品；不新增補色、鍍膜或修復服務宣稱。

## 解除條件與驗證

- 先取得新鮮 GSC query/page rows 或其他第一方曝光證據；公開 SERP 只能作候選訊號。
- 修改前後只允許此單一 treatment，保存 HTML／JSON-LD／canonical／robots／LINE click 的 hash 與基線。
- 第 7 天：確認重新抓取與非品牌 impressions；缺資料為 `UNMEASURED`。
- 第 28 天：同時比較非品牌 GSC impressions/clicks/CTR、GA4 organic/AI sessions 與 LINE clicks；缺一項即 `INCONCLUSIVE`。
- 未通過前維持 `DRAFT_ONLY`，不部署、不要求索引、不送 IndexNow。
