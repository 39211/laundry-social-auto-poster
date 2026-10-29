# B2 結果：來源到收件的唯讀設計

日期：2026-10-30。執行者：Codex。工作目錄：`C:/Users/cyc39/AI-Lanes/integ/repo`。任務卡：[B2-source-to-order-design.md](B2-source-to-order-design.md)。設計成果：[B2-DESIGN.md](../B2-DESIGN.md)。

**文件設計已完成；未實作、未部署，尚無實際轉換量測。** 建議每篇內容一個公開來源碼，客人主動送出後記錄最少事件；店機本地對照有效綁定與唯讀收件，B3 只接無個資的彙總。OA 預填文字留作確認真正官方帳號 ID 後的增強；LIFF 暫不採用。

## 1. 本輪結論與交付

- 目前社群連結共用 `source=post`，tracking 的 campaign 沒有進入這條 caption 連結；網站 slug、GA4 source_clicks 與 LINE 身分之間仍缺橋梁。
- 加好友連結的任意 query 沒有官方 webhook 透傳保證；不能拿點擊推定某位客人。官方支持 OA 聊天預填文字，但客人仍須按送出，且實際 OA ID 尚未驗明。
- 詢問採「同一使用者的台北客日」去重；不冒充唯一新客數。來源碼後補不得領取先前收件。
- 卡片有「詢問後七日」與「綁定後七日」兩種起算點，設計分列 I7／B7，B3 三欄使用 B7，另附 I7。未滿窗、無綁定、只有查詢建立的未核實綁定、資料缺口都保留未知。
- Det 是收件明細依據，不是付款或正式訂單張數。未驗證 Det 歷史完整性前，只能說當次可見的關聯下限，不能報完整轉換率。
- 舊 staff inbox 並非完整詢問帳，店機快照也未證明已接通舊 handoff；選時間的 bot 回覆不是預約確認。本設計另列人工 confirmed／cancelled 事件。

兩份文件以當前 integration 原碼為主；A3／SHOP-FACTS 與 Vault 筆記只作脈絡，未把它們的歷史行號、部署敘述或風險接受當作本輪現場驗收／新增授權。

## 2. 實際讀取範圍

以下程式為定位後的相關段落查閱，不宣稱逐行審過整個專案。

| 檔案 | 實際用途與主要位置 |
|---|---|
| `docs-internal/cards/B2-source-to-order-design.md` | 全文，目的、六題、寫入白名單。 |
| `src/contentPlan.ts` | `:1603` 來源路徑；`:1636` tracking；`:1656` withLineContact；`:1676` GBP helper；其餘 LINE／tracking 命中定位。 |
| `src/generatePublicSite.ts` | `:3432` 文章觸點；`:3444` trackedLineUrl；`:3514` buildLineRedirectHtml 與 GA4 source。確認應修改生成器，不能只改產物。 |
| `docs/go/line.html` | 全文 68 行；固定目的地、source／link_source、跳轉行為。未開真正店家 LINE 入口。 |
| `src/ga4Report.ts` | 搜尋事件／來源統計定位；`:231`–`:265` 日帳與 measured／total_only／unmeasured 分支。未執行 collector。 |
| `scripts/ga4-collect.ps1` | 全文 61 行；台北日期與現有排程呼叫用途，未執行。 |
| `shop-pc/fxwash/runtime/webhook_server.py` | `:134` 綁定讀寫；`:551` handler；`:575` 先 200；`:602` token 去重；`:610` 選時間；`:627` 圖片；`:643`、`:655` 查詢即綁定；`:781` 末路由。 |
| `shop-pc/fxwash/runtime/lookup_service.py` | 電話／客號相關定位；`:78`–`:115` 多客號選擇與斜線串接格式。 |
| `line-bot/staff_notify.py` | `:19` inbox／book 路徑；`:24`–`:135` handoff 結構；`:220`–`:311` append／通知與去重；`:705`–`:722` status。未呼叫其函式。 |
| `shop-pc/fxwash/bridge/ai_engine/db_manager.py` | 全文 114 行；只確認 SELECT／Mode=Read／日期字串處理，不記錄或重述原碼內任何秘密值，未匯入或執行。 |
| `shop-pc/fxwash/connectors/base.py` | `:183`–`:213` 唯讀 connector／cache；`:240`–`:350` Cus／Det 投影、客號 fallback、明細欄位。 |
| `docs-internal/cards/A3-RESULT.md` | 第 1 節與綁定風險相關段落，對照當前原碼；沒有照其連結去讀未授權的店機營運複本。 |
| `docs-internal/SHOP-FACTS.md` | 店務、人工接手、預約、隱私與未知條目，主要 `:21`、`:60`、`:112`、`:114`。 |
| `docs-internal/cards/B3-weekly-report.md` | 全文 31 行，確認週報限制與未知語義。 |
| `scripts/weekly-report.py` | `:130`–`:161` leads；`:404`–`:412` inventory；`:475`–`:520` 結論／未知／60 行限制與輸入。沒有執行產報。 |

任務卡的 `connectors/base.py` 實際落在 `shop-pc/fxwash/connectors/base.py`。`shop-pc/fxwash/data/customer_bindings.json` 不存在；在限定真實資料根目錄也沒有該檔。本輪以 save_binding 原碼取得格式，**沒有讀取其他目錄的綁定實值**，也沒有杜撰綁定樣本。

### 真實資料只取結構／彙總

全部位於 `C:/Users/cyc39/Documents/New project 5/data/`；沒有讀店機、MDB、客戶照片、憑證或登入狀態。

| 資料 | 實際觀察 |
|---|---|
| `leads/2026-10.json` | 根為 month／days，29 個日帳；來源狀態 28 筆 measured、1 筆 unmeasured。只取欄位型別與來源標籤，不據此宣稱詢問或訂單。 |
| leads 日帳欄位 | line_clicks_total、search_funnel_events、search_funnel_status、line_clicks_recorded_at、source_clicks、source_clicks_status；讀到來源含 post、站內 slug、unknown 等。 |
| `posted-log/2026-10-26.json` | list 結構，記錄欄位 date、slot、platform、status、dry_run、attempts、published_media_type、video_status、post_id、created_at。未把發布記錄當 LINE 詢問證據。 |
| `feature-posted-log/2026-10-22.json` | list 結構，欄位 platform、slug、status、post_id、at。只讀結構，不複製實際貼文 ID。 |
| `staff-inbox.jsonl` | 解析後只輸出 kind→欄位名。現存類型 ask／photo／query／estimate；欄位含 uid、case_id、event_id、when 等，未抄姓名、訊息、電話或照片路徑。 |
| `line-bookings.jsonl` | 檔案存在但為空；只檢查檔案大小。不能據此推論現場預約是 0。 |
| `ga4-exports/` | 僅 README.md，讀其匯出格式；沒有 CSV 可驗證。 |
| `conversions/` | 目錄存在、檔案數 0；沒有已驗收的來源→收件彙總。 |
| `inquiries.jsonl`／`customer_bindings.json` | 在該資料根目錄未找到，未建立。 |

另讀了已注入的 Obsidian `00-Start-Here.md`；取得 live `02-Current/Current-Context.md`，並用短關鍵字搜尋後讀取 `04-Tasks/2026-10-29-Claude-私享家總計畫整合與現役主幹盤點.md` 的當前工作段落，以及 `05-Decisions/Active/2026-08-30-AI工作閉環與崗位分工.md:51` 開工契約。筆記只提供背景，不擴充權限。

## 3. 查閱的 LINE 官方頁

查閱日：2026-10-30。只讀官方公開網頁；URL 文件內的 API 範例均未執行。

| 官方頁 | 本輪確認與限制 |
|---|---|
| [Use LINE features with the LINE URL scheme](https://developers.line.biz/en/docs/messaging-api/using-line-url-scheme/) | ti/p 開帳號頁／聊天，oaMessage 預填文字與 encoding，手機與 PC 的差異；未找到任意 query 透傳給 webhook 的保證。 |
| [Opening a LIFF app](https://developers.line.biz/en/docs/liff/opening-liff-app/) | liff.state、初始化與兩次跳轉、環境差異；不是一個 OA message 的送出證明。 |
| [Messaging API reference](https://developers.line.biz/en/reference/messaging-api/) 與 [完整 nojs 版](https://developers.line.biz/en/reference/messaging-api/nojs/) | common properties、message／follow／postback；timestamp、userId、webhookEventId、redelivery。沒有可把自訂加好友 query 當 campaign 的 event 欄位契約。 |
| [Receive messages (webhook)](https://developers.line.biz/en/docs/messaging-api/receiving-messages/) | 驗簽、message 與 follow 差異、重送亂序與去重、收回訊息；不把 follow 當詢問。 |
| [Using user data in LIFF apps and servers](https://developers.line.biz/en/docs/liff/using-user-profile/) | LIFF 日後若使用，伺服器端驗 token；不能用前端 userId 宣稱已驗身分。 |
| [Get user IDs](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/) | provider 不同會有不同 userId，同 provider 跨 channel 可同值；沒有檢查實際店家 Console。 |

官方搜尋結果也讀到 provider design、token 傳送與 account linking 的官方說明摘要；本設計核心依據為上表頁面，不以搜尋摘要宣稱店家已具備設定。技術結論區分「文件明載支持」與「未找到保證」，未以未實測推論所有 LINE 客戶端一定丟棄參數。

## 4. 驗證、權限與限制

- 開工 `git status --short --untracked-files=all` 為空；分支與 HEAD 已讀取。交付前重新核對只新增本卡允許的兩份文件、沒有 staged 變更，並檢查 Markdown／相對連結與內容必要段落。
- 設計以合成情境逐項推演：同人多日、事件重送、晚綁定、兩種七天、前導零／複合客號、收件日期精度、資料移表／缺口與預約取消；這是設計推演，**不是程式測試通過或現場驗收**。
- 沒有改動任何程式；沒有啟動專案測試套件、GA4 collector、LINE 通知、webhook、monitor、POS connector 或週報。本輪只執行檔案讀取／結構檢查、唯讀搜尋、warboard show、公開文件查閱與 Git 唯讀檢查。沒有店機連線、營運 API 呼叫、Git commit／stage／push、排程或發布。
- 沒有建立任何客戶事件、來源碼 registry、彙總 JSON 或其他檔案；設計中的行數、資料檔與部署步驟全是未執行提案。
- 已讀 Graphify SKILL／ADOPTION；專案內與按規則推得的專屬 D 槽位置均未找到既有圖。本輪遵守「只能新增兩文件」，不建圖、不安裝、不派工，改以指定原碼核對。
- 已讀 open-seo-advisor SKILL、ADOPTION、capability-map 與相關商務驗收參考；只採「點擊、詢問、預約、收件分層驗證、缺資料標未知」的方法，沒有執行 SEO CLI 或連接帳號。
- D:/C-moved 與 D:/AI-Lanes-work 均存在，C 槽空間足夠；本輪沒有大型生成物或 D 槽寫入。
- 本次最新授權僅兩份文件，因此不另外執行會寫 Vault 的 manual task_summary、不更新戰情板、不另建 Vault 筆記；留痕集中在本 RESULT，既有自動 hook 是否成功不由本卡推定。

尚無把握／待後續證明：真正 OA ID、預填在實際手機／非好友／WebView 的行為、人工確認入口、日夜事件合併與資料交付方式、HMAC 金鑰與保留期限、Indate 精度／locale、Did 唯一性、Det 歷史保存與作廢規則、實際部署版本。**這些未知不影響本輪文件交付，但限制後續何時能把週報的「未知」改成數字。**

交付驗收由 Claude commander 依卡片審閱；後續實作、店機部署或現場測試仍需各自授權。本輪沒有代替店主批准任何方案上線。
