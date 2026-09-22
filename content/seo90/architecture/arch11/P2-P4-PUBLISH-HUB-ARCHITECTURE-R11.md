# 私享家 P2／P4 與一站式發布｜ARCH11

版本：2026-09-22，ARCH11-r1。依指定 Pro 的 `SXJ-ARCH11-R1` 裁定整理，待第二輪精確版本複核。
**本輪只更新計畫與紀錄；不改產品程式、不派實作、不切換發送權、不部署或發文。Pro 的設計裁定不等於老闆核准內容或產品驗收。**

## 一、總目標與商品邊界

讓洗衣同行選購可獨立交付、可重複建置的服務；整合時由同一入口掌握內容、核稿、發布和結果，不重做洗衣POS。

| 商品 | 獨立交付責任 | 與共同入口的關係 |
|---|---|---|
| P1 | 唯讀可信入庫事件及既有合格通路的主動通知 | 可選事件來源；不恢復員工操作跟隨／操控，新增範圍仍待老闆確認 |
| P2 | 在地SEO、母文章、網站release／內鏈、GSC及30／60／90天交付 | 提供網站內容版本、發行狀態與搜尋觀測 |
| P3 | LINE OA建置、客服／真人接手、綁定查件及POS原值金額 | 提供詢問承接入口；交易查件、完工通知與行銷同意分開 |
| P4 | 品牌圖片／影片、平台變體、社群核稿、派送、逐帳號回讀 | 承載薄Publish Hub／Gateway，沿用既有實作 |

**Publish Hub 是 P2／P4 共用操作入口，不是第五條商品線，也不另建repository。**各商品仍有獨立入口、交付包與驗收，不強迫整套購買。P1客人不能因完工通知綁定就自動成為P4活動收件者。

## 二、現況、已保存成果與可直接複用部分

W10已完成7篇完整母文、28張配圖；新兩篇逐文逐圖GPT独立複核。83/83相關測試、2組行為突變；156件ZIP開箱；兩店各37個輸出搬移後相同。第二店是合成隔離fixture，不是真店文稿或交機。這些是工程／核稿候選證據，不能把Pro閱讀摘要當獨立實測。

私享家七篇另跑public gate為0頁、0sitemap、7held；0店主核准、0新release、0部署。**本次W10沒有新增社群發文**，不抹除更早FB／IG真四圖技術試發。老闆後續刪除兩帖的聲明仍保留，不能自動補發。W8的115項是歷史另一版本結果，不和本輪83相加。

| 既有來源 | 複用方式 | 不可冒充的能力 |
|---|---|---|
| W10私有bundle／七天ZIP／Vault七篇附圖 | 固定來源與SHA，引用入共同核稿清單，保留來源日期 | 不是90天成品，不是店主核准 |
| 網站repo SEO90 generator／release引擎 | P2網站發行仍走原路；不交Postiz發布網站 | 本機測試不是正式部署或搜尋收錄 |
| `storeReview.ts`＋外部store/policy ticket | 跨店私有重建入口；沿用歸屬與版本檢查 | 原core preview API沒有因此變成多租戶授權服務 |
| P2 `p2_p4_daily_bridge.py` | 沿用店別、題號、日期、brief与CTA映射 | brief不是完整文章 |
| P4 `campaign-production` | 沿用封包、來源、核稿清單與平台文案結構 | 舊SVG短片／模板不直接抵高品質圖片或影片交付 |
| P4 `oneclick-live`、native FB／IG、固定journal | 保留已驗的原生路線、防重與回條，先做接縫整合 | 真測過adapter不等於帳號已獲新的唯一發送權 |
| Hermes→Grok訂閱影片 | 沿用現有生成通路與首幀素材 | 不改付費API、不把decode成功當品質核准 |

七天的閱讀、重建、第二店套用步驟另見 `W10-使用與複用.md`。未核稿全文／圖片留私有區與Obsidian；公開GitHub只放通用程式、架構與去敏證據。

## 三、共同流程與資料正本

```text
P4題庫／brief → P2母文版本 + P4圖像／影片及社群variant
                      ↓ 引用精確來源，不複製出第二份可變正本
              Publish Hub：選店 → 預覽 → 選通道／帳號 → 核准
                 ├─ P2網站approval → 原release引擎 → 網站回讀
                 └─ P4社群approval → Gateway → 有效adapter → 平台回讀
                                 ↓
                  分開展示發布結果、GSC／GA4、LINE詢問
```

實作前先做既有欄位對照，不先重造資料庫：P2持有母文及網站發行正本；P4持有媒體、社群variant與派送正本；Hub只保存必要引用／映射，不另維護可與兩者互相覆蓋的全文或成功旗標。W10版本先以來源bundle與SHA匯入引用，不改原文、圖或歷史核准。

| 契約層 | 必須綁定 |
|---|---|
| 內容／來源 | tenant/store、contentId/sourceId、原始日期、revision、store/policy SHA、來源bundle |
| 平台variant | platform、account、variant、文案／素材hash及順序、CTA、slot、發布時間／時區 |
| 核准 | 通道、核准者、精確版本及目的帳號；字／圖／帳號／時間／政策改變即失效 |
| 派送意圖 | 穩定intent、external_dispatch_key、sender、authority版本；外部呼叫前持久化 |
| 回讀 | 真平台貼文ID、permalink、帳號、預期可見性、內容／素材對應、觀測時間 |
| 成效 | source/property、期間、filter、as_of；缺資料為null＋原因，不造0或成功 |

網站approval/release/journal與社群approval/posted-log分帳。LINE click、有效詢問、成交分帳。Owner刪文是追加觀測／抑制記錄，不改寫先前真實成功；UNKNOWN不能換revision、UUID、adapter繞過。

## 四、發送權威與Postiz取捨

保留native Facebook／Instagram優先路線，Postiz作可替換、選擇性adapter；不全面遷移，不混裝六套引擎。
唯一性以 **tenant＋platform＋account** 為單位，不只看平台名：每個帳號同時僅一個有效發送權威。現有本地與遠端排程、在途工作、舊worker須先盤點；「UI只按一次」不是跨執行器防重證明。

權威切換／回滾：凍結新派單 → 等待或查清在途與遠端排程 → 排除UNKNOWN → 記錄新authority版本 → 切換 → 驗收。未確認取消的遠端工作不得轉投別路；持舊權威版本的worker不得再送。如何在舊程式與外部引擎落實fencing，屬後續契約／實測工作，尚未完成。

Gateway→Postiz建工作本身也要防重；外部已收件但本地未得回應時，不可重建新intent。不假設Postiz現有API原生滿足所需external_dispatch_key；須沿controller/service/database確認，缺口再做最小擴充。Postiz回條、個人頁、container ID或releaseURL欄位只是線索，不能取代平台端回讀。

目前唯讀設定觀測：FB=`native_facebook`、IG=`native_instagram`且各有帳號設定；Threads／YT／TikTok=`postiz`但帳號ID空白。未讀遠端待發佇列，未驗排程間互斥，authority版本未證實；因此**現役唯一發送權映射仍為未驗證**。本輪不授權任何新發送者。

| 平台 | 此版本架構位置 | 下一個必要驗收 |
|---|---|---|
| FB／IG | 既有native優先，Postiz僅可選替代 | 跨路由同intent、固定journal、帳號／真貼文回讀、小量另授權試點 |
| Threads／YouTube | Postiz候選，尚未真發驗收 | 實際OAuth／帳號／app權限、公開可見性、外部建工作防重与平台回讀 |
| TikTok | HOLD，不承諾單店自架即可公開發 | 先確認Direct Post用途／審核適用性，不能因Postiz支援圖示而放行 |
| Google商家等 | 後續能力盤點，不在首批承諾 | 逐項權限、內容類型與回讀能力 |
| LINE | P3独立Messaging通道，不把VOOM當已接平台 | 交易／行銷授權、身分綁定與收件範圍 |

一鍵表示一次操作管理選定帳號的整組工作，不表示每个平台相同能力或同時成功。UI至少分開已回讀、處理中、結果不明、可安全重試、需人工處理、老闆刪除；成功的目的地不随失敗者重發。

## 五、30／60／90天與品質、計費單位

- 第1–30天：包含已完成7個母文單位，補其餘23；用真店每週批次跑通產製、核稿、到期發布及週報。
- 第31–60天：依同窗GSC query×page與客人問題，新增、擴寫、更新或合併意圖，不為湊數造重複網址。
- 第61–90天：長青更新、成效與續約、冷啟動及第二真店交機；合成店測試不能抵真店驗收。

沿用13週主題與原題库來源，網站一日一篇和社群slot分別規劃，不改既有正式排程。90個交付單位不保證90個新公開URL；新母文、實質更新／合併、社群variant、圖片、影片及代發布各列計價與驗收，不重複算母文。
每週展示：planned／素材完成／內部QA／店主核准／網站部署回讀／逐平台回讀／成效觀測，不能互相充數。內容服務與代發布可分售。

品質以W10逐文逐圖標準維持，不用短caption充母文，不用同圖改檔名充四圖，不以字數或PNG格式當全部品質驗收。影片沿用Hermes→Grok訂閱；生成、完整decode、動作／語意、字幕／聲音、店主核准各自留證據，劣質靜態動畫不抵已承諾影片。若以四圖替代，須另符合該期已授權交付約定。
材料來源／AI示意揭露／服務事實／品牌CTA逐店確認；不承諾排名、AI收錄、詢問數或成交額。

## 六、UX與可重複交機

既有P4內逐步整合：店家選擇、內容日曆、全文與四圖／影片核稿、平台版本、目的帳號預檢、發布結果、成效週報。每個綠色狀態需對應可查證據；把缺件、待核稿、帳號未連接、未知結果分清楚。
第二店以品牌／服務／CTA／權利／帳號／核稿人／量測property收件表開始；共用schema、工具與流程，不複製私享家地址、LINE或品牌圖片。交機要有版本manifest、來源、缺件、核准狀態、備份還原、冷啟動及回滾SOP。

## 七、後續工單順序（全部未派）

| 順序 | 工作包 | 出關證據 |
|---|---|---|
| A0 | 本文件R2複核＋老闆確認範圍 | 精確版本SHA、決策與未決項，無實作副作用 |
| A1 | native接縫及發送權盤點 | 帳號／排程／在途／authority映射，保留所有writer修改及既有journal |
| A2 | W10固定七天包→共同核稿／逐通道派單映射 | 引用來源，不改原稿；改圖文／帳號／時間使核准失效；無核准零外呼 |
| A3 | 接縫與故障獨立驗收 | 跨路由重播、UNKNOWN、撤准、晚期失敗、刪文不補、跨店污染皆有反例 |
| A4 | 另取得授權的FB＋IG小量真試點 | 真帳號／貼文／可見性回讀；部分失敗僅處理失敗目的地，成功不重送 |
| A5 | 週期交付與第二真店 | 連續週包品質、真店核准／開箱／回復、透明成效與續約交付 |
| A6 | Postiz新增平台獨立工作包 | 權限／授權適用性、建立工作冪等、首次heartbeat前故障實驗、逐帳號回讀 |

A6的唯讀研究／契約可在A1之後另定不重疊工作範圍，但未過平台閘不進共同發送；不阻塞P2／P4已能獨立交付的內容服務。
六套上游研究分級採用：Postiz候選adapter；Post for Me素材順序、TryPost逐目的地結算、Mixpost限流、AiToEarn能力分類作研究來源；瀏覽器操作工具不直接取代官方API主幹。版本、授權與依賴義務在採用前逐檔核對，本輪未匯入上游程式。

後續主要實作依既有規則交Grok4.7（經Claude commander共用路由、單writer與lease）；Codex做契約核實與必要獨立驗收，Pro主導設計／裁定。影片模型路徑不隨程式模型遷移。**本輪沒有啟動任何工單。**

## 八、版本、風險與記錄

- 網站基準：`e2ac1e33c305b88e04181efa1e45dffdc33f0e08`，`codex/seo-daily-90d-20260922`，盤點時clean。
- P2基準：`14c5816d49adfe8a9130c61cc4e575936d3d7297`，`sync/local-20260918`，盤點時clean。
- P4基準：`64fbc2e2dae81395e57326ec1dbd4c0f77da1ab2`，同名sync branch；`versions/production-v3/workflow.py`有一筆他人未提交修改，本輪不改、不還原、不稱已審。
- 發送權盤點尚未完成；Postiz建工作冪等、首次heartbeat前故障為待實驗，不冒稱已修。不同GPT席不是跨模型家族審查。
- GitHub保存去敏架構／版本／驗收；Obsidian引用同一文件SHA並保存私有素材與完整討論。舊架構加「由ARCH11接續」指標，保留歷史，不刪舊FAIL或改寫舊驗收。
- 若後續更動本文實質決定，重新形成版本與複核；架構通過不自動授權部署、付款、帳號權限或正式發送。

來源：主Pro `https://chatgpt.com/c/6aa2d802-dcac-83ee-9a0e-26d1784fd66b`（SXJ-ARCH11）；多平台研究 `https://chatgpt.com/c/6ab1736a-f2bc-83ee-985f-076491c103b8`。本機狀態由本輪唯讀Git／設定摘要核對，Pro沒有親讀本機或執測。

官方核對：[Postiz API](https://docs.postiz.com/public-api/introduction)、[YouTube上傳與可見性限制](https://developers.google.com/youtube/v3/docs/videos/insert)、[TikTok用途條件](https://developers.tiktok.com/docs/en/content-sharing-guidelines)。官方支援範圍與每家店實際取得的權限分開。
