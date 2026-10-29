# 洗衣平台：SEO／營運模組銜接附錄

日期2026-09-08。維護者：SEO Codex任務01a049b6-1a35-7fd0-8663-bdbaa899a1ff。狀態：設計提案，非已整合、已通過多門市隔離或可正式販售。

## 共用正本

- 整合架構：C:/Users/cyc39/Documents/AI_Agency/ehank-ai-plugin/specs/product-platform-20260908/，由eHank任務維護，本附錄不另立架構正本。
- 跨任務協調：C:/Users/cyc39/Documents/Hermes/laundry-platform-coordination/00-共同方向與分工.md。
- 本模組實作：C:/Users/cyc39/Documents/New project 5；origin為39211/laundry-social-auto-poster。工作目錄不等於部署版本。

## 實查模組入口

package.json對應：generate-public-site→src/generatePublicSite.ts；publish-pages→src/publishPages.ts；indexing-push→src/indexingPush.ts；ga4-report→src/ga4Report.ts；ga4-ai-traffic→src/ga4AiTraffic.ts；gsc-search-analytics→src/gscSearchAnalytics.ts；gsc-index-inspect→src/gscIndexInspection.ts；gsc-seo-candidates→src/gscSeoCandidateAutopilot.ts；seo-exposure-review→src/seoExposureReview.ts。

社群：src/postCurrentSlot.ts、src/scheduleAhead.ts、src/scheduleReel.ts、src/postYouTube.ts；批准src/approvePost.ts；媒體驗證src/generateImage.ts、src/generateVideo.ts、src/videoReviewGate.ts；履約src/publishingSla.ts。此輪僅核對入口，不宣稱各模組生產驗收通過。

## 契約提案

採tenant_id/shop_id。先前store_id用語必須透過核實mapping轉成shop_id，未知或非唯一映射拒絕處理。操作契約包含brand_profile_version、resource_refs、secret_ref、approval_scope/expires_at、operation_id/idempotency_key、artifact_hash、event_time/ingested_at/data_through、status/error/freshness、outcome_evidence。

LINE只交去識別化聚合詢問、預約及成單數，附日期窗、時區、定義與來源；不交原始訊息、識別碼、姓名、電話或顧客照片給分析模組。即使聚合也需抑制可重新識別的小樣本細分，不以匿名字樣當隱私已驗證。

src/paths.ts目前以PROJECT_ROOT或cwd根目錄、date/slot命名素材與營運紀錄；這不是多租戶隔離保證。逐店資料、鎖、主機名、平台資源、憑證、品牌事實、預算及授權需隔離且驗證。docs/屬公開產物，不作共用品牌設定正本。approved-log、posted-log、scheduled-log及實際素材不得直接當公版種子。

## 對應商品閉環

主要對應「獲客與回訪」提案：內容→曝光/點擊→LINE聚合詢問→有證據的預約/成單。其他接待、履約、收款仍由LINE/POS契約負責，本模組不寫POS、決定收費或代發可取通知。

## 驗收條件（尚未執行）

- 兩店合成資料、相同日期/slot/operation ID情境不串檔、不串帳號、不互相去重。
- 缺tenant/shop或錯resource映射拒絕；授權過期、來源變更或artifact hash改變須停止外部操作。
- 缺值null；事件時間、資料截至日、資料新鮮度保留；不把缺OAuth或缺報表記0。
- 提交不等於收錄，曝光不等於點擊，LINE點擊不等於有效詢問，API接受不等於公開展示。
- 網站與社群發布各店逐項授權；對應公開頁面/平台結果另驗證，失敗重試需同operation reconciliation。
- 付費API、客戶照片行銷用途、站點設定變更不由架構文件新增授權。

## 保留事項

GAS未定義，不推定為Google Apps Script、GSC或GEO。活躍Claude commander收件窗口尚未確認，僅已知共享交接文；不宣稱Claude/Grok開工。

90秒私享家品牌片與其特定發布授權、素材保留在原任務，不挪作其他門市公版。此附錄未修改LINE/eHank、排程、憑證、程式或發布。共用方案尚未凍結，不承諾搜尋排名、曝光、詢問或營收成效。
