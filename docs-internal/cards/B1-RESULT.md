# B1 店務事實盤點結果

任務卡日期：2026-10-29。交付檢核日期：2026-10-30（Asia/Taipei）。主事實檔保留任務卡要求的 v1(2026-10-29) 標題。

已產出 [docs-internal/SHOP-FACTS.md:1](<C:/Users/cyc39/Documents/New project 5/docs-internal/SHOP-FACTS.md:1>)。本次只有該檔與本結果檔是可寫範圍；不改其他檔、不連店機、不呼叫 API、不做 git commit、push、部署或發布。

## 開工卡與權限

| 欄位 | 本次紀錄 |
|---|---|
| Outcome | 盤點 bot、每日圖文與本機網站的店務說法；每條可回來源，保留衝突與未確認事項。 |
| Owner | 店主；B1 卡列 Claude(Cowork) 為總指揮。 |
| Maker | 本次 Codex 對話，單一 writer，僅處理 B1。未派子代理或外部席。 |
| Checker | 本席以來源回讀與機械檢查驗收文件；未宣稱完成獨立跨席／跨家族複審。 |
| Authority | 使用者本回合與 B1 卡只授權兩份文件；不增加改程式、連線或發布權限。 |
| Evidence | 五欄事實表、來源行號、衝突原文、10 條抽核、111 品項核對、輸入 SHA-256 與工作樹比對。 |
| 工作目錄 | `C:/Users/cyc39/Documents/New project 5`。 |

## 統計

| 項目 | 數量／結果 |
|---|---|
| 事實表列數 | 77 |
| 店主已定 | 9 |
| 來源一致 | 43 |
| 來源衝突 | 5 |
| 待店主確認 | 20（按「狀態」欄計數，不是將所有引文裡出現該詞的次數相加） |
| 衝突／口徑差異 | 11 組，C01–C11；四組交期、帶價設計、收送門檻、範圍用詞、收送時段、支付方式承諾、效果保證、AI 生成標示。 |
| 衝突原文 | 49 段；每段各有來源檔與行號，保留原字，不抄金額。 |
| 直接採用及定位的店務來源 | 82 檔：32 份卡片／程式／資料／Vault 文件，另 50 份服務與地區 HTML。查閱方式見下表，不代表每份程式都逐行完整審查。 |
| 價目分類／品項 | 6 類、111 個；只列名稱，不抄價格。 |
| 指定來源無法讀取 | 0；題卡指定的檔案皆找到。 |
| 未做的執行驗收 | 店機、手機、外部 API、同步頻率、推播、收送車趟、付款、照片到期刪除、實際洗護效果。 |

四組交期按店主硬規則記為「店主已定」，但下游仍有不一致，因此衝突組數不等於狀態為「來源衝突」的列數。C07 是市區／全市的口徑差異，沒有據此斷言門市拒收其他行政區。C05 未判定個別歷史發布的當次給價授權；C09 沒把 kit disabled 誤當成櫃台不收款。

## 讀取來源清冊

### 卡片、bot、圖文、店家資料與 Vault

| 檔案 | 讀取方式與限制 |
|---|---|
| [data/business-profile.json:1](<C:/Users/cyc39/Documents/New project 5/data/business-profile.json:1>) | 解析本機店名、地址、市話、手機、LINE、營業時間等欄位；比對三份來源，未改資料。 |
| [data/persona-master.md:1](<C:/Users/cyc39/Documents/New project 5/data/persona-master.md:1>) | 唯讀本卡或指定靜態資料。 |
| [docs-internal/cards/B1-shop-facts.md:1](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:1>) | 唯讀本卡或指定靜態資料。 |
| [docs/business-profile.json:1](<C:/Users/cyc39/Documents/New project 5/docs/business-profile.json:1>) | 解析本機店名、地址、市話、手機、LINE、營業時間等欄位；比對三份來源，未改資料。 |
| [line-bot/conversation.py:1](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:1>) | 唯讀相關 FAQ、估價、付款、查件及人工轉接段落；只作舊 bot 對照。 |
| [line-bot/quote_flow.py:1](<C:/Users/cyc39/Documents/New project 5/line-bot/quote_flow.py:1>) | 唯讀相關 FAQ、估價、付款、查件及人工轉接段落；只作舊 bot 對照。 |
| [seo-overrides/business-profile.json:1](<C:/Users/cyc39/Documents/New project 5/seo-overrides/business-profile.json:1>) | 解析本機店名、地址、市話、手機、LINE、營業時間等欄位；比對三份來源，未改資料。 |
| [shop-pc/fxwash/config/Clothing_Memory.md:1](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Clothing_Memory.md:1>) | 採用前段靜態指南與回覆格式；未採用動態辨識個案。 |
| [shop-pc/fxwash/config/Dialog_Phrases.json:1](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:1>) | 唯讀本卡或指定靜態資料。 |
| [shop-pc/fxwash/config/Memory.md:1](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Memory.md:1>) | 採用前段靜態指南（交期、材質、風險）；未採用動態辨識個案。 |
| [shop-pc/fxwash/config/dialog_corpus.py:1](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/dialog_corpus.py:1>) | 唯讀本卡或指定靜態資料。 |
| [shop-pc/fxwash/config/prices.json:1](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/prices.json:1>) | 解析 categories 與 items 的結構、分類及品名；未抄金額。 |
| [shop-pc/fxwash/runtime/chat_service.py:1](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/chat_service.py:1>) | 唯讀相關路由、格式、prompt、設定檢查與保存邏輯；未 import／啟動服務或呼叫 API。 |
| [shop-pc/fxwash/runtime/line_pay.py:1](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/line_pay.py:1>) | 唯讀相關路由、格式、prompt、設定檢查與保存邏輯；未 import／啟動服務或呼叫 API。 |
| [shop-pc/fxwash/runtime/lookup_service.py:1](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/lookup_service.py:1>) | 唯讀相關路由、格式、prompt、設定檢查與保存邏輯；未 import／啟動服務或呼叫 API。 |
| [shop-pc/fxwash/runtime/photo_session.py:1](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/photo_session.py:1>) | 唯讀相關路由、格式、prompt、設定檢查與保存邏輯；未 import／啟動服務或呼叫 API。 |
| [shop-pc/fxwash/runtime/vision_service.py:1](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/vision_service.py:1>) | 唯讀相關路由、格式、prompt、設定檢查與保存邏輯；未 import／啟動服務或呼叫 API。 |
| [shop-pc/fxwash/runtime/webhook_server.py:1](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/webhook_server.py:1>) | 唯讀相關路由、格式、prompt、設定檢查與保存邏輯；未 import／啟動服務或呼叫 API。 |
| [shop-pc/fxwash/shop.json:1](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:1>) | 唯讀本卡或指定靜態資料。 |
| [shop-pc/fxwash/shop_config.py:1](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop_config.py:1>) | 唯讀相關路由、格式、prompt、設定檢查與保存邏輯；未 import／啟動服務或呼叫 API。 |
| [src/config.ts:1](<C:/Users/cyc39/Documents/New project 5/src/config.ts:1>) | 唯讀關鍵詞搜尋及相關函式／設定段落；未執行圖文、模型或發布流程。 |
| [src/contentPlan.ts:1](<C:/Users/cyc39/Documents/New project 5/src/contentPlan.ts:1>) | 唯讀關鍵詞搜尋及相關函式／設定段落；未執行圖文、模型或發布流程。 |
| [src/generateDailyContent.ts:1](<C:/Users/cyc39/Documents/New project 5/src/generateDailyContent.ts:1>) | 唯讀關鍵詞搜尋及相關函式／設定段落；未執行圖文、模型或發布流程。 |
| [src/generateDailyContext.ts:1](<C:/Users/cyc39/Documents/New project 5/src/generateDailyContext.ts:1>) | 唯讀關鍵詞搜尋及相關函式／設定段落；未執行圖文、模型或發布流程。 |
| [src/generateImage.ts:1](<C:/Users/cyc39/Documents/New project 5/src/generateImage.ts:1>) | 唯讀關鍵詞搜尋及相關函式／設定段落；未執行圖文、模型或發布流程。 |
| [src/generatePublicSite.ts:1](<C:/Users/cyc39/Documents/New project 5/src/generatePublicSite.ts:1>) | 唯讀關鍵詞定位主圖說明與服務／風險文字；未執行產站。 |
| [src/growthPlaybook.ts:1](<C:/Users/cyc39/Documents/New project 5/src/growthPlaybook.ts:1>) | 唯讀關鍵詞搜尋及相關函式／設定段落；未執行圖文、模型或發布流程。 |
| [src/imageDoctrine.ts:1](<C:/Users/cyc39/Documents/New project 5/src/imageDoctrine.ts:1>) | 唯讀關鍵詞搜尋及相關函式／設定段落；未執行圖文、模型或發布流程。 |
| [src/imageProvenance.ts:1](<C:/Users/cyc39/Documents/New project 5/src/imageProvenance.ts:1>) | 唯讀關鍵詞搜尋及相關函式／設定段落；未執行圖文、模型或發布流程。 |
| [Vault/03-Projects/Smart-Laundry-AI/02_已決定規格.md:1](<C:/Users/cyc39/Documents/AI-Agent-Vault/03-Projects/Smart-Laundry-AI/02_已決定規格.md:1>) | 唯讀指定規格／SOP 相關段落；保留其原適用範圍。 |
| [Vault/03-Projects/Smart-Laundry-AI/收件檢查表-v1.csv:1](<C:/Users/cyc39/Documents/AI-Agent-Vault/03-Projects/Smart-Laundry-AI/收件檢查表-v1.csv:1>) | 只採欄名／表頭與模板結構；未採用個案列或金額。 |
| [Vault/08-Knowledge/Approved/私享家-開店到關店SOP-v1.1/私享家-開店到關店SOP-v1.1.md:1](<C:/Users/cyc39/Documents/AI-Agent-Vault/08-Knowledge/Approved/私享家-開店到關店SOP-v1.1/私享家-開店到關店SOP-v1.1.md:1>) | 唯讀指定規格／SOP 相關段落；保留其原適用範圍。 |

### 網站服務與地區頁

以下 50 檔均為本機來源；沒有從網路讀取正式站，也沒有修改既有 dirty 網頁。HTML 可見文字擷取另排除 script／style；主事實檔引用回原始 HTML 行號。

| 檔案 | 讀取方式 |
|---|---|
| [docs/services/business-bulk-laundry.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/business-bulk-laundry.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/services/clinic-uniform-laundry.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/clinic-uniform-laundry.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/services/curtain-carpet-cleaning.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/curtain-carpet-cleaning.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/services/down-jacket-cleaning.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/down-jacket-cleaning.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/services/duvet-bedding-cleaning.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/duvet-bedding-cleaning.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/services/evening-gown-cleaning.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/evening-gown-cleaning.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/services/fabric-storage.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/fabric-storage.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/services/ironing-pressing.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/ironing-pressing.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/services/luggage-cleaning.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/luggage-cleaning.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/services/luxury-bag-cleaning.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/luxury-bag-cleaning.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/services/luxury-garment-cleaning.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/luxury-garment-cleaning.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/services/plush-doll-cleaning.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/plush-doll-cleaning.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/services/postpartum-center-laundry.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/postpartum-center-laundry.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/services/secondhand-luxury-shop-cleaning.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/secondhand-luxury-shop-cleaning.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/services/sequin-rhinestone-clothing-cleaning.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/sequin-rhinestone-clothing-cleaning.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/services/shoe-bag-care.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/shoe-bag-care.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/services/suit-dry-cleaning.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/suit-dry-cleaning.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/services/taichung-citywide-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/taichung-citywide-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/services/taichung-laundry-price-list.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/taichung-laundry-price-list.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/services/taichung-xitun-laundry.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/taichung-xitun-laundry.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/services/uniform-laundry.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/uniform-laundry.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/services/white-shoe-cleaning.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/white-shoe-cleaning.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/services/wool-coat-cleaning.html:1](<C:/Users/cyc39/Documents/New project 5/docs/services/wool-coat-cleaning.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/beitun-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/beitun-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/beitun-shoe-cleaning.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/beitun-shoe-cleaning.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/central-district-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/central-district-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/dadu-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/dadu-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/dali-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/dali-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/daya-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/daya-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/donghai-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/donghai-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/east-district-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/east-district-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/fengjia-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/fengjia-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/fengjia-shoe-cleaning.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/fengjia-shoe-cleaning.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/fengyuan-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/fengyuan-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/houli-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/houli-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/nantun-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/nantun-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/nantun-shoe-cleaning.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/nantun-shoe-cleaning.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/north-district-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/north-district-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/qinghai-road-shoe-cleaning.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/qinghai-road-shoe-cleaning.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/qingshui-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/qingshui-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/shalu-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/shalu-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/shengang-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/shengang-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/south-district-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/south-district-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/taiping-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/taiping-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/tanzi-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/tanzi-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/west-district-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/west-district-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/wufeng-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/wufeng-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/wuqi-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/wuqi-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/wuri-laundry-pickup.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/wuri-laundry-pickup.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |
| [docs/local/zhongke-office-laundry.html:1](<C:/Users/cyc39/Documents/New project 5/docs/local/zhongke-office-laundry.html:1>) | 本機讀取；擷取營業、公休、交期、收送與服務邊界。 |

## 沒讀到、未採用與證據限制

- 指定的三份 Vault 來源均可讀，包含 `收件檢查表-v1.csv`；CSV 僅採用欄位結構，不複製個案列。`Memory.md`、`Clothing_Memory.md` 的動態辨識歷史不作店務事實或真實案例證據，亦未複製到交付檔。
- 未讀憑證、Cookie、secrets 內容、客戶正式資料、查件資料庫或 session 資料檔。程式碼提及這些路徑，不代表本次打開或連線。價目 JSON 僅提取分類、品名及初估注意事項。
- `shop.json` 是本機 demo 設定且驗收旗標未過；線上付款 disabled 只限該設定。未確認真正店機版本、服務上線或手機接收結果。
- `photo_retention_days=7` 只有設定證據；照片 session 的一小時讀取窗與寫入時二十四小時清理是記憶保存機制，不能充作原始照片七天刪除證明。Smart-Laundry-AI 的研究資料限制沒有被當作營運 bot 已實作。
- 先讀共用首頁注入內容，查戰情板及 live Current-Context，再依關鍵詞搜尋 Vault；戰情板為自報資料且多筆 stale，未把它當授權或店機現況。依當前「只能改兩檔」限制，沒有執行 `ai_vault.py manual` 或另建 Vault／記憶筆記，本結果檔承接任務摘要。
- 依 [Graphify SKILL.md](<C:/Users/cyc39/.codex/skills/graphify/SKILL.md>) 與 [ADOPTION.md](<C:/Users/cyc39/.codex/skills/graphify/ADOPTION.md>) 唯讀查現有圖。查詢 budget 1000，只作定位，結果有截斷；未重建、更新或儲存查詢結果，採用的事實全部另核對本機原始檔。未把圖查詢當完整盤點或新授權。
- 開工記憶僅用作尋找過往 NAP 表示方式與產站來源的線索；本檔店務值均重新核對本機檔案，沒有採用舊記憶當現況。

## 驗證紀錄

已完成兩份交付檔的本機回讀。首輪發現任務卡來源行號偏移一行，已修正；修正後錯誤數為 0。以下為實際工具輸出，不代表店機或線上系統驗收。

| 檢查 | 結果 |
|---|---|
| 77 列、10 個規定分節、四種狀態與逐列來源 | PASS；另有最後一節衝突清單，共 11 個二級分節，五欄表格完整。 |
| 所有本機來源連結存在、行號有效 | PASS；379 個帶行號連結，82 個唯一輸入來源，全部檔案存在且行號有效。 |
| 49 段衝突原文逐段對行 | PASS；49/49 段為所標原始行的逐字子字串。 |
| 10 條抽核（見下表） | PASS；10/10 條、17 個關鍵文字斷言全部對上指定來源行。 |
| 6 類與 111 品項名稱逐一對照 | PASS；每類名稱及順序與 prices.json 的 categories 逐項一致，items 結構亦為 111。 |
| 未抄價格數字／未複製客戶個案 | PASS；未找到金額模式或非店家手機字面值；人工覆核未貼入動態辨識歷史、客戶 CSV 列、查件明細或帳密。 |
| 非指定檔案與既有 dirty 工作保存 | 本席只新增兩份指定文件。原 253 檔雜湊快照中有 8 檔在共享樹期間變動；已分列於下方，未回退或覆寫。不能宣稱整棵共享樹只變兩檔。 |
| Git HEAD／index | 共享 HEAD 期間有變更；本席未執行 commit、stage、push。檢核當下 git diff --cached 為空，未碰既有工作。 |

### 抽核 10 條

| 事實 | 逐一回讀依據 | 結果 |
|---|---|---|
| F01 平日對客營業時間 | [data/business-profile.json:31](<C:/Users/cyc39/Documents/New project 5/data/business-profile.json:31>)；[shop-pc/fxwash/shop.json:16](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:16>) | PASS |
| F12 最低消費／最低件數 | [shop-pc/fxwash/config/Dialog_Phrases.json:324](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:324>)；[docs/services/taichung-citywide-laundry-pickup.html:677](<C:/Users/cyc39/Documents/New project 5/docs/services/taichung-citywide-laundry-pickup.html:677>) | PASS |
| F18 一般衣物標準交期 | [docs-internal/cards/B1-shop-facts.md:10](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:10>)；[line-bot/conversation.py:851](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:851>) | PASS |
| F19 鞋類標準交期 | [docs-internal/cards/B1-shop-facts.md:10](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:10>)；[docs/services/white-shoe-cleaning.html:576](<C:/Users/cyc39/Documents/New project 5/docs/services/white-shoe-cleaning.html:576>) | PASS |
| F21 皮件包標準交期 | [docs-internal/cards/B1-shop-facts.md:10](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:10>)；[docs/services/luxury-bag-cleaning.html:493](<C:/Users/cyc39/Documents/New project 5/docs/services/luxury-bag-cleaning.html:493>) | PASS |
| F29 價目檔分類／品項：鞋子 | [shop-pc/fxwash/config/prices.json:481](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/prices.json:481>) | PASS |
| F41 PU／人造皮老化 | [shop-pc/fxwash/config/Clothing_Memory.md:66](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Clothing_Memory.md:66>)；[shop-pc/fxwash/config/Dialog_Phrases.json:517](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:517>) | PASS |
| F48 預估價與付款時點 | [line-bot/quote_flow.py:231](<C:/Users/cyc39/Documents/New project 5/line-bot/quote_flow.py:231>) | PASS |
| F53 首次查到後的綁定行為 | [shop-pc/fxwash/runtime/webhook_server.py:650](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/webhook_server.py:650>)；[shop-pc/fxwash/shop.json:120](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:120>) | PASS |
| F66 照片保留天數 | [shop-pc/fxwash/shop.json:112](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:112>) | PASS |

### 輸入快照與共享工作樹

- 開工 HEAD：`d44bcb451cacd706b85dad8297522ddc925c9268`；比對時 HEAD：`2e8de7e7799c982e9538fa740ffdf1514a35689a`。本席沒有執行 commit 或 stage，這是共享樹期間觀察到的其他變動，不以全樹 HEAD 不變作本卡完成條件。
- 開工 253 檔雜湊快照中，245 檔未變；以下 8 檔有差異：

  - `docs-internal/SXJ-VERSION-REGISTRY-20261029.md`
  - `docs-internal/cards/A3-RESULT.md`
  - `docs-internal/cards/A3-shop-notify-verify.md`
  - `docs-internal/cards/A4-2-shop-tunnel-observability.md`
  - `shop-pc/fxwash/runtime/test_tunnel_events.py`
  - `shop-pc/fxwash/runtime/test_webhook_log_ts.py`
  - `shop-pc/fxwash/runtime/tunnel_supervisor.py`
  - `shop-pc/fxwash/runtime/webhook_server.py`

- 以上與本卡 82 個輸入來源交集只有 `shop-pc/fxwash/runtime/webhook_server.py`；已重新讀取相關圖片、電話／客號查件、綁定與一般文字路由，目前行號仍相同，引用與抽核再次通過。其他差異未回退、未覆寫。
- 共享 status 另出現 `reports/daily-progress.md` 的修改及 `docs-internal/cards/A4-2-codex-last-message.md` 等並行紀錄；本席寫入清單仍僅 `docs-internal/SHOP-FACTS.md`、`docs-internal/cards/B1-RESULT.md`。
- 82 個輸入來源的 SHA-256 清單，以完整路徑排序後作 ASCII JSON（排序 key、緊湊分隔符）再取 SHA-256，指紋為 `7cda9176894d5c2fc898c009697bb04430a36f96e434e03448fc89f07d526117`。此指紋不含兩份交付檔，供當次輸入一致性核對，不是店機版本證明。
- 主事實檔 SHA-256：`1c7511fb95b2c6606cfd80cf1117dc3b7686d1bd4675252fd49427a583a75073`。結果檔保存驗證與操作摘要；不將自評稱為獨立跨席複審。

### 工具問題與修正

- 首輪回讀發現 B1 任務卡的引用行號偏移一行，已依原文改正；10 條抽核與 49 段引文隨後全部通過。
- PowerShell 管線傳送含中文的 Python 原始碼時，曾使正規表示式字元損壞；改用 ASCII 傳輸與 Unicode escape，讀檔仍用 UTF-8。另一個 regex replacement escape 問題改以函式回傳字串處理，後續擷取成功。
- 大量 HTML 擷取的 JSON 曾超出工具輸出上限；改為去重、縮減回傳欄位及分段查看，重新成功解析 50 檔。另有一次過大的內嵌檢核參數被 Windows 以錯誤 206 拒絕啟動；改由檢核器直接讀兩份交付檔，沒有新增暫存檔。
- `git status` 提示既有 `.a4-2-*` 暫存測試目錄存取受限；未進入、修改或清理該目錄。搜尋時先前有兩個猜測的 Graphify 路徑不存在；已定位真正現有圖後完成唯讀查詢，不影響題卡來源可讀性。

## 完成邊界與接手

本卡只交事實盤點；沒有修正任何下游程式、既有圖文或網站。後續若要動手，應由總指揮另依店主確認值開卡，不由本卡自行擴權。所有未決店務事項集中在主檔的 20 條「待店主確認」與 C06–C10 的判讀中，已由本卡明定的交期與禁語無須重問。

九格缺：本次未做獨立跨席複審；本席來源回讀與機械驗證不冒充獨立驗收。驗收材料全部在這兩份文件。
