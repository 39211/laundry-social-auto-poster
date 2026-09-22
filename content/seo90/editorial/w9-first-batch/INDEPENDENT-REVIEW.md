# W9 六篇母文章與素材獨立審查

時間：2026-09-22T10:14:14+08:00。GPT 不同席獨立審查，不是跨家族。僅審本批內容、素材接線與兩支 task-local 預覽工具，未修改稿件、產品、核准或正式資料。

結論：
- **Can ship：五篇 internal editorial passed；005 held。** 這是內部內容驗收，並非店主核准、公開資格、SEO 排名或 Google 收錄證明。
- 本版 first-six.json SHA256：`a655317df4bfdeb69f7f91c6512c2cd846d38bb57a8fdf01cf65ecba0fa34102`。六篇仍 state=preview、article_complete=false、public_eligible=false；0 approvals、0 releases。後續若改正文、素材或輸出，應使用新版本證據。

## 逐篇裁定

| 文章 | 裁定 | 理由與保留事項 |
|---|---|---|
| 001 烤肉外套 | pass | 能區分氣味與可見沾點，提供位置描述、洗標用途、可直接改寫的詢問範例及交期確認。無去味、去漬或時限保證；四圖相符。氣味兩節略重複，可合併但不阻擋本批內部核稿。 |
| 002 包包內裡 | pass | 有不強拉內襯、清空個人物品、區分清潔/破損/配件、附件及報價範圍清單，內容可執行。無把修補補色列為既定服務；四圖對題。 |
| 003 白襯衫 | pass | 有領口/左右腋下定位、自然色彩、處理紀錄、發現時間與形成時間的區別；未診斷原因或提供漂白配方。新版第三張已真圖檢視：袖子展開、袖身交接與腋下 T 字接縫可辨；AI 示意標示存在，可作拍攝位置示意，不能當洗護結果。 |
| 004 外套材質 | pass | 清楚區分成分與照護標示，提供 A/B 分件配對、拼接/附件與既有損傷資訊，沒有外觀推定材質/價格。四圖相符。『同款曾經洗過』與末節『同一件以前洗過』語意重複，建議合併；並非一篇完整洗滌技術教程。 |
| 005 安全帽 | held | 本輪找到的兩段外套帽沿正文已修掉；最新版文字可供內部核稿。服務未確認，全組四圖仍 held；第三圖明確是外套帽沿，1/2/4 也有外套帽子同框。不能只換第三張就宣稱全組通過。當前 preview 已移除第三圖、保留 held 提示且無 LINE CTA，這不解除 held。 |
| 006 LINE 照片 | pass（修後） | 初版三主項及兩個小標錯位，已回報並獨立複核修正：材質/發現時間/做過處理一致，需要日期另補。圖片三項與正文一致；分件代號、訊息範例、已讀不等於收件及費用核對有實際用途。 |

必修問題：
1. 本版五篇內部核稿無剩餘 blocker。005 的未確認服務及混題全組素材是解除 held 前必修，不能因文字已修或預覽頁能開啟而放行。
2. 006 初版的三件事不一致、005 初版正文混題均已修；以上為修後裁定，不把舊缺陷當新狀態。

可選改善：
1. 001/003/004 有短導入與後文重複提醒；以合併小節改善閱讀，不應為維持 900 字門檻保留冗句。本批包含清單、場景和範例，未發現跨篇整段複製，但共用送洗溝通框架明顯。
2. 24 張 alt 現為題名加序號的泛用描述；對第三張腋下接縫、包內裡等關鍵畫面可寫具體位置。此項不影響本批私有核稿。
3. prepare_w9_review.py:30 以 assets[18] 選錯題圖、23 以 basename 配頁；verify_w9.mts 未斷言錯題圖 hash 確實不在頁面。當前固定六篇順序正確且本審查已核實移除；若用於重排序/新批，改以 assetId/canonicalPath 精確匹配並驗證移除，再重用。

測試與證據：
- 已執行 git status --short、git diff --stat、git diff；site 當時乾淨。W9 資料與工具位於 site Git 根外，因此另外檢查實際檔案，未以空 diff 宣稱 W9 無改動。
- 獨立 decode 24/24、SHA 24/24、尺寸 24/24、decoded pixels 24/24 不重複；6 篇各四個 assetRef 均歸屬正確。真圖檢視兩張 contact sheet（全 24 張）與白襯衫第三張原尺寸。
- 最新六篇 JSON 正文、Markdown、preview-r2 逐段吻合；實算 Han 字數依序 1230/1165/1184/1150/1231/1264，與 editorial-counts.json 一致。字數只作一致性證據。
- 六篇 preview 都有 noindex,nofollow 與對應來源；001/002/003/004/006 各四圖，005 三圖且 held 提示存在，無 active LINE CTA。
- 主代理 W9-CANDIDATE-R2.log/exit 顯示真候選 public pages=0、sitemap=0、held=6、exit0；W9-PREVIEW-R2-NEW-ROOT.log/exit 顯示7頁、exit0。未重跑 renderer 或舊產品 suite；原 OUTPUT_MUST_BE_EMPTY 拒絕紀錄保留。
- 兩支工具唯讀 code review：prepare 只改 w9-first-batch/preview-r2 與 image-qa.json；verify 以本批0核准輸入作 public 負向驗證，寫 task-local 新輸出及證據。不改 production source、docs、核准/release。這是固定本批工具，不是通用發布或安全閘。
- 本機來源證據中 GINETEX 內容支持照護符號分組；另唯讀開啟 [SHOEI 原廠維護頁](https://www.shoei.com/worldwide/en/support/maintenance.html) 及 [私享家官網](https://sixiangjialaundry.com/) 核實對應部位與照片詢問資訊。未見金額、洗淨程度、保證交期或收錄承諾。一般來源與 SEO 格式都不等於可收錄或門市核准。
- 白襯衫新版第三圖 SHA256：`25de45be0ae3fff4f96577406883ed9aa3ed20734c0256ef0a7cfe7af70c8d2e`。
- 原始本地審查證據：`C:/Users/cyc39/AppData/Local/Temp/w9-editorial-independent-20260922`（asset-audit.json、final-input-proof.json、兩張 contact sheet、web-source-readback.txt、git 三命令及退出碼）。

同類錯誤搜尋：
- Pattern：主題/圖文錯配、三項清單錯位、效果及服務承諾、內部流程文字進正文、字數與實質內容混算。
- Searched：全部六篇 JSON/MD/輸出正文、24 圖及 metadata、兩支 task-local 工具。
- Found：005/006 已如上處理；跨篇完全相同 section body=0；無正文核准/已發布/保證收錄說法。
- Remaining risk：未做真公開站/搜尋引擎收錄驗證、客戶核准、實際洗護效果或服務承接確認；均不在本輪授權。

是否重犯 .Codex/mimo-lessons.md 內的舊錯：
- No（本輪可觀察範圍）。未改碼、未派工、未用 numstat 取代內容核對；不把退出碼或長度當內容合格。

最終建議：保留 5 篇 internal editorial passed、1 篇 held 的分開狀態；目前只可交付私有核稿候選，不公開。
