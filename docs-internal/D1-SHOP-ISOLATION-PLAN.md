# D1 每店設定隔離計畫（Level 3 準備：只做盤點與設計，不改程式）

> 狀態：設計稿。依店主決定 D20，在獨立分支進行。Level 1 通過前，不部署到店 PC 與 ai PC。
> 依據：`.tmp/d1-inventory.md`（191 檔 grep 結果，密鑰值已遮蔽）、`shop-pc/fxwash/shop_config.py`、`shop-pc/fxwash/config/shop.template.json`、`line-bot/handover.json`。
> 本文所列的 sxj 現值一律抄自 inventory 的行內容。inventory 看不到的值寫「待店主確認」。本文不含任何密鑰。
> 個人路徑中的 Windows 使用者名稱一律寫成 `<user>`。

---

## 1. 結論先行

1. 規模：inventory 有 191 檔命中，其中約 70 檔會讓第二家店「回錯店名、地址或電話，或讀錯密鑰與 POS」。shop-pc 已有每店 `shop.json`，最接近完成；line-bot 中等；內容管線最大，因為文案、SEO 頁和 hashtag 本身就是私享家的內容。
2. 安全順序：先加 `shops/` 與嚴格 loader（還沒有程式使用）→ 錄 golden 基準 → line-bot → 內容管線識別常數 → shop-pc → ops 備份與排程 → 內容分店 → 兩店演練。每張卡對 sxj 都必須 byte-identical。
3. 每店各自擁有：`shop.json` 事實、`secrets/`、`data/`、價目與品名對照、語料、提示詞、選單與文案。共用：程式碼、loader、schema、測試。
4. 原則是「先指路、後搬家」：sxj 以 `legacy_layout: true` 指向今天的檔案位置。D1 期間不搬任何密鑰或客戶資料。
5. 找不到店或缺欄位時，一律停下報錯，不回退到 sxj。所有工作只在分支進行，Level 1 通過後才部署。

---

## 2. 盤點表

類別代號：
- **(a)** 店家事實：店名、地址、營業時間、電話、LINE、網站、服務範圍、命名前綴
- **(b)** 環境路徑：POS、mdb、密鑰、機器上的資料夾
- **(c)** 營業資料：價目、品項、品名對照、含價格的語料
- **(d)** 不是店家專屬：誤判，或所有店共用的規則

「第二店影響」欄說明不處理時會發生什麼事。

### 2.1 店名與命名前綴

| 檔案:行 | 常數 | 類別 | 第二店影響 |
|---|---|---|---|
| `shop-pc/fxwash/shop.json:6` | `"name": "私享家"` | (a) | 已是每店設定，可沿用 |
| `line-bot/conversation.py:2,148,1126` | 回覆「我是私享家的小幫手…」、altText「私享家服務價目」 | (a) | 第二店會自稱私享家 |
| `line-bot/photo_estimate.py:157` | AI 提示「台中「私享家專業洗衣」門市的資深洗衣師傅」 | (a) | 估價回覆冒用店名與城市 |
| `shop-pc/fxwash/runtime/chat_service.py:92,127` | 系統提示「台灣台中市「私享家專業洗衣」」 | (a) | 同上 |
| `shop-pc/fxwash/runtime/vision_service.py:279` | 系統提示「私享家專業洗衣」 | (a) | 同上 |
| `shop-pc/fxwash/runtime/webhook_server.py:299,310,386` | altText「私享家 常見洗滌價目表」等 | (a) | 卡片標題錯店 |
| `shop-pc/fxwash/runtime/lookup_service.py:292` | 「【私享家專業洗衣】洗滌進度」 | (a) | 查進度回覆錯店 |
| `shop-pc/fxwash/config/Dialog_Phrases.json`（38 處）、`config/dialog_corpus.py`（38 處） | 整份語料以私享家口吻撰寫 | (a) | 整份語料要分店，**這兩份目前在商品包內** |
| `shop-pc/fxwash/runtime/attribution_service.py:90-91` | 歸因碼 `SXJ-<6 digits>-…` | (a) 前綴 | 兩店歸因碼會混在一起；sxj 已發出的碼不可改 |
| `line-bot/upload_tabs.py:35-38`、`line-bot/upload_default.py:28,103,109` | Rich Menu alias `sxj-service`、`sxj-member`、`sxj-v6` | (a) 前綴 | 同一個 LINE 頻道的 alias 會被覆蓋 |
| `scripts/_pipeline-lock.ps1:60`、`scripts/daily-generate.ps1:63`、`scripts/catchup-publish.ps1:273`、`scripts/backfill-publish.ps1:352` | mutex `sxj-publish` | (a) 前綴 | 同一台機器兩店會互鎖 |
| `ops/Recovery.Common.ps1:159,257,264`、`ops/register-backup-task.ps1:9` | 排程前綴 `SXJ-`、`SXJ-Live-Daily-Backup` | (a)/(b) | 備份與還原只認 sxj 的排程 |
| `ops/backup-sxj-live.ps1:79`、`ops/restore-sxj-live.ps1:92,95` | manifest Kind `sxj-live-backup`、`sxj-pre-restore` | (a) 前綴 | 兩店備份無法區分 |
| `src/contentPlan.ts:59`、`src/growthPlaybook.ts:140`、`src/scheduleReel.ts:220,373`、`src/postYouTube.ts:149` | `brandLine`、`brand = "私享家洗衣店"`、hashtag | (a) | 貼文落款錯店 |
| `src/gscSeoCandidateAutopilot.ts:218`、`src/seoExposureReview.ts:209`、`src/gscPerformance.ts:338` | 品牌查詢 regex `私享家\|思想家\|si\s*xiang`、`私享家\|私享\|享家` | (a) | SEO 報表把品牌字與非品牌字分錯 |
| `line-bot/laundry_lookup.py:96` | `REPO / "data" / "私享家.db"` | (b) | 客戶資料檔名寫死店名 |

### 2.2 地址、地標、服務地區

| 檔案:行 | 常數 | 類別 | 第二店影響 |
|---|---|---|---|
| `shop-pc/fxwash/shop.json:7` | `"address": "台中市西屯區青海路二段365號"` | (a) | 已是設定，可沿用 |
| `line-bot/conversation.py:74` | `LANDMARK = BIZ.get("landmark") or "至善國中對面"` | (a) | **靜默回退**：缺值時會講私享家的地標 |
| `shop-pc/fxwash/runtime/webhook_server.py:357,555,673` | 「407 臺中市西屯區至善里青海路二段365號（至善國中對面）」 | (a) | 位置卡錯店 |
| `shop-pc/fxwash/runtime/inbound_monitor.py:297` | 取件通知內的地址 | (a) | 推播給客人的地址錯誤 |
| `shop-pc/fxwash/runtime/chat_service.py:98,110,196` | 提示內的地址、至善國中、停車 | (a) | 同上 |
| `shop-pc/fxwash/runtime/lookup_service.py:318,362,364`、`vision_service.py:353,440` | 「至善國中對面好停車」 | (a) | 同上 |
| `scripts/build-poster-knowledge.py:118-119`、`scripts/build-poster-process.py:44-45`、`scripts/build-social-promo.py:53-54` | `"addr"`、`"near"` | (a) | 海報錯店 |
| `src/postYouTube.ts:153`、`src/indexGrowthPages.ts:594` | 影片說明與索引頁的地址 | (a) | 公開內容錯店 |
| `line-bot/conversation.py:1171,1682-1683`、`chat_service.py:114` | 「台中市免費到府收送」 | (a) 服務範圍 | 收送承諾錯誤 |
| `src/generateDailyContext.ts:25` | `location: "Taichung"` | (a) | 生成情境錯城市 |
| `scripts/verify_calendar_copy.py:51` | `REQUIRED_TAGS = ["#私享家洗衣店", "#台中洗衣店"]` | (a) | 第二店貼文全被擋下 |

### 2.3 電話與 LINE

| 檔案:行 | 常數 | 類別 | 第二店影響 |
|---|---|---|---|
| `shop-pc/fxwash/shop.json:8` | `"phone": "0968-327-653"` | (a) | 已是設定 |
| `line-bot/conversation.py:70` | `PHONE = BIZ.get("telephone_local") or "04-2452-7411"` | (a) | **靜默回退** |
| `line-bot/upload_tabs.py:12` | `TEL = "tel:0424527411"` | (a) | 選單撥打鍵打到私享家 |
| `src/autoApprove.ts:320` | 要求 caption 包含 `"0968327653"` | (a) 品質閘門 | 第二店所有貼文都不會核准 |
| `src/contentPlan.ts:1627,1717`、`src/firstComment.ts:49`、`src/postYouTube.ts:153`、`src/indexGrowthPages.ts:598` | 「加 LINE:0968327653」 | (a) | 導流到私享家 |
| `scripts/build-poster-*.py`、`build-social-promo.py`（117/43/52 行） | `"phone": "0968-327-653"` | (a) | 海報錯號 |
| `shop-pc/fxwash/config/Dialog_Phrases.json:296`、`dialog_corpus.py:287`、`build_expanded_corpus.py:156` | 語料內的電話 | (a) | 語料錯號 |

### 2.4 營業時間與時區

| 檔案:行 | 常數 | 類別 | 第二店影響 |
|---|---|---|---|
| `line-bot/handover.json:2-6` | `day_start`、`day_end`、`days`、`tz` | (a) | 夜間接手時段錯誤；本計畫把它併入 `shop.json.hours` |
| `shop-pc/fxwash/runtime/tunnel_supervisor.py:62-65` | 內嵌一份 handover 格式的營業時間 | (a) | **第三份重複**，會與設定不同步 |
| `shop-pc/fxwash/shop.json:11,16-17` | `turnaround_note`、`hours` | (a) | 已是設定（shop_config 格式） |
| `shop-pc/fxwash/runtime/webhook_server.py:350,557`、`inbound_monitor.py:298` | 「週一至週五 10:00-20:00；週六 12:00-18:00；週日公休」 | (a) | 回覆時間錯誤 |
| `scripts/level1_gates.py:137,198` | 讀 `line-bot/handover.json`，預設 `"Asia/Taipei"` | (a) | Level 1 閘門只看 sxj |
| `line-bot/register-night-handover-task.ps1:37` | 檢查 `$schedule.tz -ne 'Asia/Taipei'` | (a) | 排程只認 sxj 的檔 |
| `src/auditPublicSite.ts:316-317` | 首頁必須包含 `"10:00-20:00"`、`"12:00-18:00"` | (a) | 第二店網站稽核會失敗 |
| `scripts/build-poster-knowledge.py:120` 等海報 | `"hours": "10:00-20:00・週日公休"` | (a) | 海報錯誤（見 2.10） |
| `line-bot/a43_test_support.py:18-21` | 測試替身用的營業時間 | (d) 測試 | 不影響正式運作 |
| 共 48 檔的 `"Asia/Taipei"`、`"Taipei Standard Time"` | 時區 | (a)，但台灣的店都相同 | D1 不拆；loader 先限定 `tz` 必須是 `Asia/Taipei`，其他值直接報錯 |

### 2.5 網站、GSC、GA4

| 檔案:行 | 常數 | 類別 | 第二店影響 |
|---|---|---|---|
| `src/publicSiteTypes.ts:6` | `PRODUCTION_PUBLIC_SITE_BASE_URL = "https://sixiangjialaundry.com"` | (a) | 網站與連結錯店 |
| `src/firstComment.ts:9`、`src/gbpPost.ts:21`、`src/contentPlan.ts:1618`、`src/auditPublicSite.ts:329`、`src/indexingPush.ts:176` | 舊網域 `https://39211.github.io` | (a) | 同上（另見 2.10） |
| `scripts/check-sitemap-links.ts:5`、`scripts/finish-social-poster.py:30`、`scripts/verify_calendar_copy.py:372`、`scripts/catchup-publish.ps1:375`、`scripts/nightly_optimize.py:478` | 網址寫死 | (a) | 同上 |
| `scripts/gsc-authorize.mjs:146` | `GSC_SITE_URL ?? "sc-domain:sixiangjialaundry.com"` | (a) | **靜默回退**到 sxj 的 GSC 資源 |
| `src/gscPerformance.ts:117-122` | 舊網址對應與上線日期表 | (a) 網站資料 | 只對 sxj 有意義 |
| GA4 property id | inventory 沒有命中 | — | 推測放在環境變數或密鑰，待店主確認 |

### 2.6 POS 與環境路徑

| 檔案:行 | 常數 | 類別 | 第二店影響 |
|---|---|---|---|
| `shop-pc/fxwash/connectors/base.py:215` | `live_mdb = Path(r"C:\FXwash\eHank.mdb")` | (b) | 讀到 sxj 的 POS 路徑 |
| `shop-pc/fxwash/shop.json:79-81` | `ehank_readonly`、`root_path: C:\LaundryStores\fxwash\bridge` | (b) | 已是設定 |
| `shop-pc/fxwash/runtime/attribution_weekly.ps1:21-22` | `$Root = 'C:\LaundryStores\fxwash'`、python 路徑 | (b) | 跑到 sxj 的資料夾 |
| `shop-pc/fxwash/watchdog.py:22` | `PYTHON_PORTABLE = C:\LaundryStores\python-portable` | (b) 機器共用 | 屬於機器，不屬於店；不進 `shop.json` |
| `shop-pc/fxwash/build_expanded_corpus.py:7`、`build_expanded_corpus_v5.py:7` | `shop_root = C:\LaundryStores\fxwash` | (b) | 語料產生器寫進 sxj 的資料夾 |
| `line-bot/ehank_prices.py:19` | 「預設指到店裡的 eHank 根目錄」（env `LAUNDRY_EHANK_ROOT`） | (b) | **靜默預設**；實際值在 inventory 看不到 |
| `line-bot/laundry_lookup.py:19` | `REPO / "secrets" / "ehank-0626" / "lookup.json"` | (b) | 讀到 sxj 的查詢資料 |
| `line-bot/pull_shop_mdb.ps1:14,18,20` | `Destination C:\FXwash\eHank.mdb`、`ShopRoot C:/LaundryStores/fxwash` | (b) | 拉到別店的 mdb |
| `line-bot/pull_shop_conversions.ps1:5-8` | `C:\LaundryStores\fxwash\data\conversions\…` | (b) | 同上 |
| `ops/backup-sxj-live.ps1:6-7`、`ops/register-backup-task.ps1:6-7`、`ops/restore-sxj-live.ps1:7-8` | mdb 路徑、`D:\AI-Lanes-work\_backups\sxj-live` | (b) | 備份或還原到錯的店，**風險最高** |
| `scripts/level1_gates.py:76` | `line-bot/mdb_pull.jsonl` | (b) | 日誌不分店 |

### 2.7 價目與品項

| 檔案:行 | 常數 | 類別 | 第二店影響 |
|---|---|---|---|
| `line-bot/conversation.py:36,47` | `data/prices.json`、`price-align.json` | (c) | 報 sxj 的價錢 |
| `line-bot/ehank_prices.py:25` | bot 品名 ↔ eHank 品名對照（「不得自行增刪」） | (c) | 各店 POS 品名不同 |
| `shop-pc/fxwash/config/prices.json:4`、`shop.json:65`、`chat_service.py:48`、`vision_service.py:199` | `config/prices.json` | (c) | 已相對於 `shop.root`，可沿用 |
| `scripts/build-poster-knowledge.py:54`、`scripts/build-social-promo.py:48` | `data/prices.json` | (c) | 海報上的價錢錯誤 |
| `shop-pc/fxwash/build_expanded_corpus.py:132`、`config/Clothing_Memory.md`、`config/Memory.md` | 語料與知識庫內含價格與門市指引 | (c)+(a) | 整份要分店 |

### 2.8 密鑰路徑（只列路徑，不列值）

| 檔案:行 | 常數 | 類別 | 第二店影響 |
|---|---|---|---|
| `line-bot/line_webhook.py:20,43`、`staff_notify.py:18`、`upload_tabs.py:9`、`upload_default.py:199-200` | `REPO/secrets/line-channel.json` | (b) | 用 sxj 的 LINE 頻道發訊 |
| `line-bot/tunnel_manager.py:20` | `C:/Users/<user>/laundry-repo/secrets/line-channel.json`（絕對路徑） | (b) | 換機器或換店都會壞 |
| `ops/Get-LineEndpoint.ps1:4`、`ops/Set-LineEndpoint.ps1:5` | 另一個專案資料夾下的 `secrets\line-channel.json` | (b) | 同上 |
| `line-bot/line_pay.py:2` | `secrets/line-pay.json` | (b) | 收款進錯商戶 |
| `line-bot/photo_estimate.py:78,337` | env `GEMINI_API_KEY` | (b) | 改用每店的 env 檔 |
| `src/gbpAuth.ts:7`、`scripts/gbp-authorize.mjs:10` | `secrets/gbp-oauth-client.json` | (b) | 授權到錯的商家檔案 |
| `shop-pc/fxwash/runtime/line_api.py:34`、`laundry.py:92`、`Configure-Connections.ps1:129,186`、`chat_service.py:34`、`vision_service.py:41`、`attribution_service.py:74` | 相對於 `shop.root` 的 `secrets/…` | (b) | **已經隔離**，可沿用 |

### 2.9 其餘檔案摘要（依 inventory 逐檔計數）

- **line_id 類 29 檔，全部是誤判 (d)**：`@dataclass`、`@property`、`@staticmethod`、`@classmethod`、`@contextmanager`、`functools.wraps`、PowerShell splatting（`@args`、`@common`）、`mailto:`、`nokey@localhost.run`、通用 LINE 相機 URI（`webhook_server.py:540`）。真正的 LINE ID 是在 phone 類被找到的。
- **phone 類誤判 (d)**：sha256 雜湊（`ops/evidence/*`）、GCP 專案編號（`scripts/gsc-authorize.mjs:9,16,34`）、x.com 貼文編號（`src/searchVisibilityStrategy.ts`、`src/videoScriptQuality.ts`）、時間常數（`attribution_service.py:88`）、合成測試號碼（`run_a2b_tests.py:39-40`、`snapshot.fixture.json:3`）。
- **address 類誤判 (d)**：雜湊（`src/indexGrowthPages.ts:169`、`ops/evidence/final-scope.json:61,78`）、競業 regex（`indexGrowthPages.ts:585`）。
- **secrets 類約 20 檔只是 token 欄位名或遮蔽 regex (d)**：例如 `src/postFacebook.ts`、`src/postInstagram.ts`、`src/repairMetaToken.ts`、`scripts/catchup-publish.ps1:57`、`ops/deploy-ai-linebot.ps1:210`。程式碼本身共用，只需要每店各自的 env 或密鑰來源。
- **pos_paths 與 price_files 誤判 (d)**：`ehank_reads` 計數器（`arrival_notify.py`）、`import ehank_prices`、SQL 欄名 `Dcolor`、`DCO_SQL`（POS schema 屬共用規則）、`Recovery.Common.ps1:296,299`（還原目的地驗證規則）。
- **通知標題「私享家每日生成」等，約 17 支 `scripts/*.ps1`**：屬 (a)，在 D1-9 處理。
- **`scripts/reel-v3/*` 共 17 檔**：生成 ID 前綴 `SXJ-…`、刺繡「私享家」、台中場景。這些是 sxj 的創作素材腳本，不屬於程式常數，D1 不搬，視為 sxj 的內容。
- **`ops/evidence/*` 共 7 檔**：歷史稽核證據，(d)，絕對不改。
- **`ops/b1-3-phrase-map.json`（60 處地區字）**：一次性修稿對照表，(d)，不搬。
- **內容管線的編輯內容**：`src/contentPlan.ts`、`growthPlaybook.ts`、`indexGrowthPages.ts`、`searchVisibilityStrategy.ts`、`performanceOptimization.ts`、`reelConcepts.ts`、`multimediaOperationsPlan.ts`、`generateVideoCandidate.ts`（地區字合計 250 處以上）。屬 (a)，但它們是私享家的文章與 SEO 內容，不能用「換變數」解決，D1-9 整份移入 `shops/sxj/content/`。

### 2.10 盤點發現（需要店主注意，D1 不修）

1. 兩個網站網域並存：`https://sixiangjialaundry.com` 與 `https://39211.github.io`。為了 byte-identical，D1 兩者都保留，是否統一由店主決定。
2. 海報寫「10:00-20:00・週日公休」（`build-poster-knowledge.py:120` 等），沒寫週六 12:00-18:00，與 `webhook_server.py:350` 不一致。
3. 有兩支電話：`04-2452-7411`（`conversation.py:70` 的回退值、`upload_tabs.py:12` 的撥打鍵）與 `0968-327-653`（`shop.json:8`、海報、語料）。各自用在哪裡，待店主確認。
4. `build-poster-process.py:63` 仍寫「台中市全區免費收送」，而 `ops/b1-3-phrase-map.json` 顯示「全區」正被改成「台中市免費」。
5. **商品包內含私享家事實**：`shop-pc/fxwash/config/Dialog_Phrases.json`、`dialog_corpus.py`、`Clothing_Memory.md`、`Memory.md` 都在 `shop-pc/fxwash/config/` 底下。如果直接交給第二店，會回出私享家的地址。
6. **程式內的 sxj 預設值等於靜默回退**：`conversation.py:70,74`（`or "04-2452-7411"`、`or "至善國中對面"`）、`gsc-authorize.mjs:146`、`ehank_prices.py:19`。第二店缺設定時，會悄悄套用私享家的資料。
7. 看起來像真實手機號碼的範例：`lookup_service.py:16-18`、`webhook_server.py:433`（顯示給客人）。建議另開卡改成明顯的假號，不在 D1 範圍。
8. 要確認 `data/私享家.db`（`laundry_lookup.py:96`）沒有被 git 追蹤。D1 不動它。
9. `tunnel_supervisor.py:62-65`、`line-bot/handover.json`、`shop-pc/fxwash/shop.json` 三處各有一份營業時間。
10. 排程名稱 `Laundry-*` 與 `AI-Daily-*` 不帶店代號（`Recovery.Common.ps1:159`、`register-catchup-task.ps1:9`）。同一台 ai PC 跑兩家店時會撞名。

---

## 3. 設計

### 3.1 `shops/<shop_id>/` 版面（三個 codebase 共用）

```
shops/
  README.md
  shop.schema.json         # 欄位清單：Python 與 TS loader 的共同依據
  _lib/shopctx.py          # Python loader（只用 stdlib，相容 Python 3.11+）
  _fixtures/               # 合成測試店 synth-a、synth-b、invalid-*（無任何真實資料）
  sxj/
    shop.json              # 非機密事實與設定（git 追蹤）
    content/               # 每店文案：語料、提示詞、Rich Menu、海報與貼文素材（D1-6、D1-9 起才放）
    catalog/               # 價目、price-align、品名對照（D1 期間 sxj 仍指向舊路徑）
    secrets/               # git-ignored。D1 期間 sxj 不使用，legacy 指回現有位置
    data/                  # git-ignored。客戶資料，只留在本店機器
  <id>/                    # 結構同上；legacy_layout 必須是 false
src/shopContext.ts         # TS loader
```

各機器上的位置：
- **ai PC**：repo checkout 底下的 `<repo>/shops/`。line-bot、`scripts/*.py`、`src/` 都從這裡讀。
- **店 PC**：新店部署到 `C:\LaundryStores\shops\<id>\`。shop-pc 的實例設定放在 `shops/<id>/shop-pc.json`，沿用 `shop_config.py` 的 schema。`ShopConfig.root` 是檔案所在的資料夾，所以 `secrets/`、`data/`、`config/prices.json` 都會落在 `shops/<id>/` 內，不必改 `shop_config.py` 的路徑規則。
  - **sxj 不搬**：`shops/sxj/shop.json` 的 `env_paths.shop_pc.instance_config` 指向現有的 `C:\LaundryStores\fxwash\shop.json`。
  - 一台店 PC 只收到自己那家店的資料夾，由打包規則保證，見 D1-6。

### 3.2 `shops/<id>/shop.json` schema

通則：
- 所有字串都必須非空。
- 值只有在 `pending_owner_confirmation` 有列出該欄位路徑時，才可以是 `null`。讀取待確認欄位時會報 `FIELD_PENDING`。
- 不允許未知欄位或重複欄位，比照 `shop_config._duplicates`。
- 路徑欄位：`legacy_layout: false` 的店只能用 `shops/<id>/` 內的相對路徑。`legacy_layout: true` 可以用 `@repo/…`（相對於 repo 根目錄）。
- 只有 `env_paths` 可以放本機絕對路徑。

| 欄位 | 型別 | 取代或對應的現有檔案 | sxj 現值（出處） |
|---|---|---|---|
| `schema_version` | int，固定 1 | 新欄位 | `1` |
| `shop_id` | str，`^[a-z0-9][a-z0-9-]{2,63}$`，必須等於資料夾名稱 | 對應 `shop-pc/fxwash/shop.json` 的 `shop_id`（現值 inventory 看不到） | `"sxj"`（店主指定） |
| `legacy_layout` | bool；只有 `shop_id == "sxj"` 可以是 true | 新欄位 | `true` |
| `pending_owner_confirmation` | list[str]，內容為欄位路徑 | 新欄位 | 見下方各「待店主確認」 |
| `identity.name_short` | str | `shop-pc/fxwash/shop.json:6` | `"私享家"` |
| `identity.brand_name` | str | `src/contentPlan.ts:59`、`scripts/build-poster-knowledge.py:121` | `"私享家洗衣店"` |
| `identity.service_name` | str | `runtime/lookup_service.py:292`、`runtime/chat_service.py:92` | `"私享家專業洗衣"` |
| `identity.slug` | str（ASCII） | Rich Menu、mutex 前綴 | `"sxj"` |
| `identity.slug_long` | str（ASCII） | `src/postYouTube.ts:85`、`scripts/produce-next-reel.ps1:712` | `"sixiangjia"` |
| `identity.brand_query_patterns.seo` | str（regex 原文，flags `iu`） | `src/gscSeoCandidateAutopilot.ts:218`、`src/seoExposureReview.ts:209` | `"私享家\|思想家\|si\\s*xiang"` |
| `identity.brand_query_patterns.gsc_classify` | str（regex 原文，flags `u`） | `src/gscPerformance.ts:338` | `"私享家\|私享\|享家"` |
| `contact.address` | str | `shop-pc/fxwash/shop.json:7` | `"台中市西屯區青海路二段365號"` |
| `contact.address_full` | str | `runtime/webhook_server.py:357` | `"407 臺中市西屯區至善里青海路二段365號"` |
| `contact.address_poster` | str | `scripts/build-poster-knowledge.py:118` | `"西屯區青海路二段365號"` |
| `contact.landmark` | str | `line-bot/conversation.py:74` | `"至善國中對面"` |
| `contact.mobile_local` | str | `shop-pc/fxwash/shop.json:8` | `"0968-327-653"` |
| `contact.telephone_local` | str | `line-bot/conversation.py:70` | `"04-2452-7411"` |
| `contact.tel_uri` | str，`tel:` 開頭 | `line-bot/upload_tabs.py:12` | `"tel:0424527411"` |
| `contact.line_id` | str | `src/autoApprove.ts:320`、`src/contentPlan.ts:1627` | `"0968327653"` |
| `contact.line_url` | str \| null | `data/business-profile.json`（inventory 未掃到） | 待店主確認 |
| `contact.map_url` | str \| null | `shop-pc/fxwash/shop.json` 的 `business.map_url`（值未顯示） | 待店主確認 |
| `service_area.city` | str | `line-bot/conversation.py:1682` | `"台中市"` |
| `service_area.pickup_phrase` | str | `src/scheduleReel.ts:220` | `"台中市免費到府收送"` |
| `hours.day_start` | str `HH:MM` | `line-bot/handover.json:2` | `"10:00"` |
| `hours.day_end` | str `HH:MM` | `line-bot/handover.json:3` | `"20:00"` |
| `hours.days` | object：鍵為 `"0"`–`"6"`（Python `weekday()`，0＝週一）；值為 `null`（公休）或 `[開始, 結束]` | `line-bot/handover.json:4` | `{"5": ["12:00", "18:00"], "6": null}` |
| `hours.tz` | str；D1 限定 `"Asia/Taipei"` | `line-bot/handover.json:6` | `"Asia/Taipei"` |
| `hours.night_takeover_delay_min` | int（選填，與 handover.json 同名） | `line-bot/handover.json`（這一行不在 inventory） | 逐字沿用 `line-bot/handover.json` 現值，本文不抄寫 |
| `hours_text.full` | str | `runtime/webhook_server.py:350` | `"週一至週五 10:00-20:00；週六 12:00-18:00；週日公休"` |
| `hours_text.corpus` | str | `config/Clothing_Memory.md:100` | `"週一至五 10:00-20:00、週六 12:00-18:00，週日公休"` |
| `hours_text.poster` | str | `scripts/build-poster-knowledge.py:120` | `"10:00-20:00・週日公休"` |
| `hours_text.turnaround_note` | str | `shop-pc/fxwash/shop.json:11` | `"營業時間:10:00~20:00 星期六12:00~18:00 (星期日公休)"` |
| `platform.windows_tz_id` | str | `scripts/catchup-publish.ps1:12` | `"Taipei Standard Time"` |
| `site.production_base_url` | str，https | `src/publicSiteTypes.ts:6` | `"https://sixiangjialaundry.com"` |
| `site.legacy_base_url` | str \| null | `src/firstComment.ts:9` | `"https://39211.github.io"` |
| `site.line_redirect_path` | str，`/` 開頭 | `src/gbpPost.ts:21` | `"/go/line.html"` |
| `site.gsc_property` | str | `scripts/gsc-authorize.mjs:146` | `"sc-domain:sixiangjialaundry.com"` |
| `site.ga4_property_id` | str \| null | inventory 無命中 | 待店主確認 |
| `content.required_hashtags` | list[str] | `scripts/verify_calendar_copy.py:51` | `["#私享家洗衣店", "#台中洗衣店"]` |
| `naming.richmenu_alias_prefix` | str | `line-bot/upload_default.py:28` | `"sxj-"` |
| `naming.attribution_code_prefix` | str，大寫 ASCII | `runtime/attribution_service.py:91` | `"SXJ"` |
| `naming.task_prefix` | str | `ops/Recovery.Common.ps1:159` | `"SXJ-"` |
| `naming.pipeline_mutex` | str | `scripts/_pipeline-lock.ps1:60` | `"sxj-publish"` |
| `naming.backup_kind` | str | `ops/backup-sxj-live.ps1:79` | `"sxj-live-backup"` |
| `naming.pre_restore_kind` | str | `ops/restore-sxj-live.ps1:92` | `"sxj-pre-restore"` |
| `paths.secrets_dir` | path | 新欄位（line-bot 今天用 `REPO/secrets`） | `"@repo/secrets"` |
| `paths.data_dir` | path | 新欄位 | `"@repo/data"` |
| `paths.prices` | path | `line-bot/conversation.py:36` | `"@repo/data/prices.json"` |
| `paths.business_profile` | path | `line-bot/run_a2b_tests.py:35`（data/ 下） | `"@repo/data/business-profile.json"` |
| `env_paths.shop_pc.instance_config` | 絕對路徑 | `shop-pc/fxwash/INSTALL-REPORT.json:10` | `"C:\\LaundryStores\\fxwash\\shop.json"` |
| `env_paths.shop_pc.store_root` | 絕對路徑 | `runtime/attribution_weekly.ps1:21` | `"C:\\LaundryStores\\fxwash"` |
| `env_paths.shop_pc.ehank_mdb` | 絕對路徑 | `connectors/base.py:215` | `"C:\\FXwash\\eHank.mdb"` |
| `env_paths.shop_pc.bridge_root` | 絕對路徑 | `shop-pc/fxwash/shop.json:81` | `"C:\\LaundryStores\\fxwash\\bridge"` |
| `env_paths.ai_pc.mdb_copy` | 絕對路徑 | `line-bot/pull_shop_mdb.ps1:14` | `"C:\\FXwash\\eHank.mdb"` |
| `env_paths.ai_pc.backup_root` | 絕對路徑 | `ops/backup-sxj-live.ps1:7` | `"D:\\AI-Lanes-work\\_backups\\sxj-live"` |
| `env_paths.ai_pc.ehank_root` | 絕對路徑 \| null | `line-bot/ehank_prices.py:19`（該行只有註解） | 待店主確認 |

刻意**不放**進 `shop.json` 的項目：
- 機器共用的 runtime 路徑，例如 `C:\LaundryStores\python-portable`（`watchdog.py:22`、`pull_shop_mdb.ps1:20`）。它屬於機器，不屬於店，維持程式預設值並可用 env 覆寫。
- 發文時段（`scripts/publish-slot-times.ps1:21`、`src/scheduler.ts:9`）。屬於管線設定 (d)，之後如有需要再另開欄位。
- 任何密鑰值。

**`hours` 換算**：shop-pc 的 `shop_config` 使用「0–6 每天時段陣列」格式（`shop.template.json:14-16`）。`shopctx` 提供 `weekly_windows()`，把 handover 格式換算成這種格式。shop-pc `hours` 的星期鍵慣例（0 是週一還是週日）必須在 D1-6 從程式碼確認，不可以假設。TS 的 `Date.getDay()` 以 0 代表週日，所以 TS loader 一定要透過 `windowFor(date)` 換算，並有測試覆蓋（週六 12:00-18:00、週日公休）。

### 3.3 `secrets/` 與 `data/`

- `.gitignore` 新增 `shops/*/secrets/` 與 `shops/*/data/`。測試以 `git check-ignore` 驗證。
- `secrets/` 內的檔名沿用今天的名稱：`line-channel.json`、`line-pay.json`、`vision.json`、`attribution_hmac.key`、`gbp-oauth-client.json`、`ehank-0626/lookup.json`、`.env`（內容管線的 token）。每家店各有自己的 LINE 頻道、LINE Pay 商戶、Meta、GSC、GA4、Gemini 憑證。
- **loader 只回傳路徑，不讀密鑰內容**。所以 loader 本身永遠碰不到密鑰值。
- `data/` 放客戶資料：查詢日誌、轉換紀錄、mdb 副本、歸因帳本、`*.db`。這些資料只在「本店的機器」（本店的店 PC 與本店的 ai PC）之間流動，不進 git、不進共用伺服器、不跨店。
- **sxj 在 D1 期間**：`legacy_layout` 指回 `<repo>/secrets`、`<repo>/data`、`C:\LaundryStores\fxwash\secrets`。D1 不搬任何檔案。是否搬移，等部署後由店主另開卡決定。

### 3.4 選店規則與 loader

選店規則：
- 環境變數 `SXJ_SHOP_ID`：
  - 未設定時用 `sxj`。
  - 有設定但是空白時報錯 `SHOP_ID_INVALID`，**不會**改用預設值。
  - 格式與 `shop_config.SHOP_ID_RE` 相同。
- 環境變數 `SXJ_SHOPS_ROOT`：有設定就用它。沒設定時，由呼叫端傳入 `default_shops_root`，loader 本身不猜：
  - line-bot、`scripts/`、`src/` 傳 `<repo>/shops`。
  - shop-pc 傳 `<實例資料夾>.parent / "shops"`。
- **一個 process 只綁一家店**。第二次以不同 id 載入會報 `SHOP_ALREADY_BOUND`。

Python（`shops/_lib/shopctx.py`，line-bot 與 shop-pc 共用）：
- 只用 stdlib，以 `from __future__ import annotations` 撰寫，不使用 3.12 以後的語法，以便同時在 3.11 embedded 與 3.14 venv 上執行。
- line-bot 與 `scripts/` 從 repo 直接 import。shop-pc 使用 vendored 複本 `shop-pc/fxwash/shopctx.py`，以 sha256 測試保證與來源完全相同，並列入 `package-manifest.json`（D1-6 處理）。
- 介面：

```python
ctx = shopctx.load_shop_context(default_shops_root=REPO / "shops")
ctx.shop_id                          # "sxj"
ctx.get("contact.landmark")          # 待確認欄位 → ShopContextError(FIELD_PENDING)
ctx.hours                            # 唯讀 dict（handover 格式）
ctx.weekly_windows()                 # 換算成 shop_config 格式
ctx.path("paths.prices")             # 已驗證的 Path，不會越界
ctx.secret_file("line-channel.json") # 只會落在本店 secrets_dir 內；只回傳路徑
ctx.data_dir                         # 本店 data 資料夾
```

- CLI：
  - `python shops/_lib/shopctx.py validate [--shop ID]`
  - `python shops/_lib/shopctx.py check-all`：跨店唯一性檢查，只在離線或 CI 執行
  - `python shops/_lib/shopctx.py show --json`：只輸出非機密欄位，給 PowerShell 使用
  - 失敗時 exit code 為 2。

TS（`src/shopContext.ts`）：
- `loadShopContext({ env, defaultShopsRoot })` 回傳深度凍結的 `ShopContext`，提供 `get(path)`、`hours`、`windowFor(date)`、`path(key)`、`secretFile(name)`。驗證規則與 Python 完全相同。
- 一致性測試：兩個 loader 對同一組 `_fixtures` 必須得到相同的結果（相同的成功值、相同的錯誤代碼）。兩邊認得的欄位集合，必須等於 `shop.schema.json` 列出的集合。

PowerShell（`ops/`、`scripts/*.ps1`）：不另寫第三套 loader。D1-8 新增 `ops/ShopContext.ps1`，呼叫 `shopctx.py show --json` 後再 `ConvertFrom-Json`。

### 3.5 驗證與失敗行為（明確報錯，不靜默回退）

| 代碼 | 情況 |
|---|---|
| `SHOP_ID_INVALID` | env 有設定但空白，或格式不符 |
| `SHOP_NOT_FOUND` | `shops/<id>/shop.json` 不存在。訊息為：「找不到店家設定 shops/<id>/shop.json（SXJ_SHOP_ID=<id>）；不會改用其他店」 |
| `SHOP_ID_MISMATCH` | 檔內 `shop_id` 與資料夾名稱或 env 不同 |
| `SCHEMA_INVALID` | 缺欄位、型別錯誤、未知欄位、重複欄位、時間格式錯誤、`tz` 不是 `Asia/Taipei` |
| `FIELD_PENDING` | 讀到 `pending_owner_confirmation` 內的欄位 |
| `LEGACY_NOT_ALLOWED` | 不是 sxj 卻宣告 `legacy_layout: true`，或使用 `@repo/` |
| `PATH_ESCAPE` | 路徑或密鑰檔名離開本店資料夾（含絕對路徑、`..`） |
| `CROSS_SHOP_PATH` | 解析後的路徑落在 `SXJ_SHOPS_ROOT/<其他 id>/` 底下。比對前先做 `normcase`，以處理 Windows 不分大小寫 |
| `SHOP_ALREADY_BOUND` | 同一個 process 想改綁另一家店 |

各程式遇到這些錯誤時的行為：
- 啟動時就停下，不送出任何回覆或貼文，並由現有的看門狗通知。
- 寧可不回，也不要用別店的資料回覆。
- 程式內原本的 `or "<sxj 值>"` 預設值，都改成必填欄位（見 2.10 第 6 點）。

### 3.6 隔離規則（`check-all` 檢查跨店唯一性）

同一個 `SXJ_SHOPS_ROOT` 底下的每一家店，下列項目都不可重複，也不可以有一個是另一個的前綴：
- `shop_id`
- `naming.*` 全部前綴與名稱
- `env_paths.*` 的每一個路徑
- 解析後的 `secrets_dir` 與 `data_dir`
- shop-pc 的 `server.webhook_port` 與 `staff_port`（同一台機器）

`check-all` 只讀各店的 `shop.json`，從不讀 `secrets/` 與 `data/`。執行期的 loader 只讀自己這家店。

### 3.7 向後相容（只有 sxj、其他都不改時，行為與今天完全相同）

1. 每個常數都用兩步替換：
   - 第一步：加上測試，斷言 `ctx.get(x) == "<舊字面值>"`。
   - 第二步：才把字面值換成 `ctx`。
   - 字串組裝必須逐字重現原句，例如 `f"我是{name_short}的小幫手，…"`。
2. **golden 基準**（D1-2）：
   - 錄下今天的輸出：line-bot 回覆、shop-pc fixture 模式回覆、內容管線離線產物、海報文字。
   - 之後每張卡，在 `SXJ_SHOP_ID` 未設定與 `=sxj` 兩種情況下，比對結果都必須是 0 byte 差異。
3. `legacy_layout` 讓 sxj 讀的檔案和今天完全相同，D1 不搬檔案。
4. 不改名：`sxj-*` alias、`SXJ-` 歸因碼、`SXJ-*` 與 `Laundry-*` 排程名稱、`sxj-publish` mutex、備份 Kind、`C:\LaundryStores\fxwash`、`C:\FXwash\eHank.mdb` 全部維持原樣。
5. shop-pc 現有的 `shop.json` 在 D1 不重新產生，只加一致性測試，確認它與 `shops/sxj/shop.json` 重疊的欄位相同。`line-bot/handover.json` 先保留當鏡像，並加相等測試。

---

## 4. 遷移步驟（風險由低到高）

共通規則：
- 每張卡都只在分支進行。
- 共通測試三件套：
  1. **golden byte-identical**：`SXJ_SHOP_ID` 未設定與 `=sxj` 各跑一次。
  2. **兩家合成店並行**：`synth-a` 與 `synth-b` 同時跑在兩個 process，各自的 temp `SXJ_SHOPS_ROOT` 裡放 canary 事實、canary 密鑰與 canary 資料。必須確認：
     - 輸出只含自己的 canary。
     - Python 以 `sys.addaudithook` 記錄的 `open` 事件，從未碰到另一家店的資料夾。
     - Node 以測試內的 fs 包裝記錄讀檔，結果相同。
  3. **fail-closed**：不存在的 id、空白 id、`tz` 錯誤、待確認欄位，都必須 exit 2，而且沒有任何輸出。
- 回復（rollback）：
  - 部署前：在分支上 `git revert` 該卡。
  - 部署後：重新部署前一個 release tag。
  - 因為 D1 不搬任何檔案，回復時永遠不需要把檔案搬回去。

| 卡 | 風險 | 動到的檔案 | 搬什麼 | 額外測試 | 回復 |
|---|---|---|---|---|---|
| **D1-1** 骨架與 loader | 0（沒有程式使用） | 新增 `shops/**`、`src/shopContext.ts` 與測試、`.gitignore` | 無；建立 `shops/sxj/shop.json` | sxj 值逐一能在出處檔案找到；hours 等於 `handover.json`；Python 3.11 語法檢查 | 刪除新檔 |
| **D1-2** golden 基準 | 0（只加測試） | 新增 `tests/golden/**` 與錄製腳本 | 錄下今天的輸出。先盤點各管線的離線或乾跑入口：`line-bot/run_a2b_tests.py` 的 sandbox、shop-pc `lookup.mode=fixture`、內容管線的離線產生；沒有乾跑入口的模組只做單元層 golden | 基準本身連跑兩次必須一致 | 刪除測試 |
| **D1-3** line-bot 店家事實 | 低（ai PC 夜間 bot） | `line-bot/conversation.py`、`photo_estimate.py`、`upload_tabs.py`、`upload_default.py`、`make_richmenu.py`、`journey_ux.py`；讀 hours 的地方；`scripts/level1_gates.py`（hours 改讀 loader） | 店名、地址、電話、地標、服務範圍、Rich Menu 前綴、hours。移除 `or "至善國中對面"` 這類回退 | 合成店的回覆不得出現任何 sxj 字串；`handover.json` 與 `shop.json.hours` 相等 | revert |
| **D1-4** line-bot 密鑰與資料路徑 | 低到中 | `line_webhook.py`、`staff_notify.py`、`line_pay.py`、`laundry_lookup.py`、`ehank_prices.py`、`tunnel_manager.py`、`conversation.py`（prices、price-align） | 改用 `ctx.secret_file()`、`ctx.path()`；`tunnel_manager.py:20` 的絕對路徑改走 loader；`私享家.db` 改走 `paths` | audit hook：synth-a 從未開啟 synth-b 的 secrets 或 data；sxj 開啟的檔案清單與今天完全相同 | revert |
| **D1-5** 內容管線識別常數 | 中（公開貼文，但能離線比對） | `src/publicSiteTypes.ts`、`firstComment.ts`、`gbpPost.ts`、`autoApprove.ts`、`indexingPush.ts`、`auditPublicSite.ts`、`postYouTube.ts`、`gbpAuth.ts`、`gscPerformance.ts`、`gscSeoCandidateAutopilot.ts`、`seoExposureReview.ts`、`contentPlan.ts`（只動 LINE 與網址）；`scripts/check-sitemap-links.ts`、`finish-social-poster.py`、`verify_calendar_copy.py`、`gsc-authorize.mjs`、`build-poster-*.py`、`build-social-promo.py`、`_pipeline-lock.ps1`（mutex 預設值） | 網域、LINE ID、品牌 regex、hashtag、GSC 資源、mutex 名稱、海報上的店家欄位 | 合成店的離線產物只含自己的網域與 LINE；`autoApprove` 對合成店檢查的是合成店的 LINE ID | revert |
| **D1-6** shop-pc 事實與文案 | 中（白天的客服 bot） | vendored `shop-pc/fxwash/shopctx.py`、`package-manifest.json`、`pack_product_kit.py`；`runtime/webhook_server.py`、`inbound_monitor.py`、`lookup_service.py`、`chat_service.py`、`vision_service.py`、`tunnel_supervisor.py`；`config/Dialog_Phrases.json`、`dialog_corpus.py`、`Clothing_Memory.md`、`Memory.md` | 語料與知識庫原封不動移到每店實例（sxj 位置不變），商品包不再夾帶店家事實；`tunnel_supervisor.py` 的內嵌 hours 改讀設定 | `pack_product_kit` 新增檢查：包內不得出現 sxj 的地址或電話 canary；vendored 檔 sha256 與來源相同；確認 shop-pc hours 的星期慣例並與 `weekly_windows()` 相等 | revert，並重新打前一版的包 |
| **D1-7** shop-pc 環境與 POS 路徑 | 中高（POS 讀取路徑） | `connectors/base.py`、`watchdog.py`（python 路徑改 env 覆寫，預設值不變）、`runtime/attribution_weekly.ps1`、`build_expanded_corpus*.py` | mdb 與 store_root 改由 `shop-pc.json`、`env_paths` 提供。只讀規則不變 | connector 只用 fixture 測試，不碰真實 mdb；合成店的 mdb 路徑解析後不同，而且都在自己的資料夾內 | revert |
| **D1-8** ops 備份、還原、排程 | 高（資料保護與排程） | 新增 `ops/ShopContext.ps1`；`ops/backup-sxj-live.ps1`、`restore-sxj-live.ps1`、`register-backup-task.ps1`、`Recovery.Common.ps1`、`Get-LineEndpoint.ps1`、`Set-LineEndpoint.ps1`；`line-bot/pull_shop_mdb.ps1`、`pull_shop_conversions.ps1`、`register-night-handover-task.ps1` | 參數預設值改從 shop context 取得；排程前綴改用每店的 `naming.task_prefix`；sxj 名稱不變 | 沿用 `ops/tests/Recovery.Tests.ps1`（Pester）在 temp 跑來回演練；合成店 A 的備份不得包含 B 的任何檔案；A 的還原只能寫進 A 的路徑 | revert，排程以前一版重新註冊 |
| **D1-9** 內容分店 | 高（量最大，編輯內容） | `src/contentPlan.ts`、`growthPlaybook.ts`、`indexGrowthPages.ts`、`searchVisibilityStrategy.ts`、`performanceOptimization.ts`、`reelConcepts.ts`、`multimediaOperationsPlan.ts`、`generateVideoCandidate.ts`、`scheduleReel.ts`、`generateDailyContext.ts`；約 17 支 `scripts/*.ps1` 的通知標題；`register-catchup-task.ps1` 的排程名稱 | 編輯內容原樣移到 `shops/sxj/content/*.json`。第二家店沒有自己的內容檔時直接報錯（需要另外撰稿）。可拆成 D1-9a、9b、9c | golden；合成店使用極小的合成內容檔，輸出只含合成內容 | revert |
| **D1-10** 兩店全線演練與部署準備 | 0（演練環境） | 新增演練腳本與部署檢查表 | 無 | 三個 codebase 同時跑兩家合成店；`check-all` 通過；寫好店 PC 與 ai PC 的部署及回復步驟 | 刪除演練檔 |

部署卡 **D1-D1**（ai PC）與 **D1-D2**（店 PC）**只在 Level 1 通過後**才發出：
- 每張部署卡都附帶前一個 release tag 的重新部署步驟。
- sxj 的 `SXJ_SHOP_ID` 不必設定。

---

## 5. 風險與不做的事

**不做**
- 不改 POS 資料、不改 eHank schema、不寫 mdb。connector 仍然只讀。
- 不共享客戶資料：沒有共用資料庫，沒有跨店報表，ai PC 不會把一家店的資料給另一家店的程式讀。
- 不做多租戶伺服器：每家店各自跑自己的 process 與排程，一個 process 只服務一家店。
- 不把長語料改成樣板：語料、提示詞、SEO 頁是各店自己的內容，整份複製後由該店改寫。
- D1 期間不修 2.10 列出的不一致（兩個網域、海報時間、兩支電話、「全區」措辭），只記錄並交給店主決定。
- 不改 sxj 任何已經對外的名稱：alias、歸因碼前綴、排程、備份 Kind、資料夾。
- 不動 `ops/evidence/*`、`scripts/reel-v3/*`、`ops/b1-3-phrase-map.json`。
- 不自動搬移密鑰；不在任何輸出、日誌或測試中印出密鑰。
- Level 1 通過前不部署。

**風險與對策**

| 風險 | 對策 |
|---|---|
| 靜默套用 sxj 的值 | 移除程式內的 sxj 預設值；loader 嚴格驗證；合成店測試掃描所有輸出中的 sxj 字串 |
| grep 抓不到的常數：圖片或選單 PNG 上的字、站台 HTML 模板、已產出的頁面 | D1-10 用合成店做全線檢查，並另外盤點素材資料夾（不在本次 inventory 範圍） |
| 三份營業時間不同步 | 單一來源加上相等測試，鏡像檔逐步退場 |
| 星期鍵慣例混淆（Python 0＝週一，JS 0＝週日，shop-pc 待確認） | 只透過 loader 的 `windowFor`、`weekly_windows` 換算，並有週六與週日的測試 |
| Python 3.11 embedded 不相容 | `shopctx` 只用 stdlib；測試時以 `ast.parse(..., feature_version=(3, 11))` 檢查，可用時再以 3.11 實跑 |
| vendored 複本漂移 | sha256 相等測試 |
| 同一台 ai PC 跑兩家店：排程、mutex、mdb 副本撞名 | `check-all` 唯一性檢查；`Laundry-*` 與 `AI-Daily-*` 改名只對新店生效。**一台 ai PC 是否可以服務兩家店，由店主決定** |
| Windows 路徑大小寫造成隔離檢查失效 | 比對前先做 `os.path.normcase` 與 resolve |
| 每家店需要自己的 LINE OA、LINE Pay、Meta、GSC、GA4 帳號 | 列入第二家店上線的前置清單，不在 D1 程式範圍 |

---

## 6. D1-1 任務卡（可直接發送）

```markdown
# Task card D1-1: shops/ 骨架、sxj shop.json、嚴格 loader（Python + TS），尚無程式使用

## Context
依 docs-internal/D1-SHOP-ISOLATION-PLAN.md（D20，Level 3 準備，獨立分支，Level 1 通過前不部署）。
本卡只新增檔案，沒有任何現有程式 import 它們，所以現役行為不可能改變。shop_id 為 `sxj`。
參考：`shop-pc/fxwash/shop_config.py`（SHOP_ID_RE、重複欄位檢查、路徑越界檢查的寫法）、
`line-bot/handover.json`（hours 格式）。

## Deliverable
只新增或修改下列檔案：
1. `shops/README.md`：版面、選店規則（SXJ_SHOP_ID 預設 sxj；SXJ_SHOPS_ROOT）、禁止事項
   （不放密鑰、不放客戶資料、不靜默回退）。20 行內。
2. `shops/shop.schema.json`：計畫 §3.2 的完整欄位清單（JSON Schema draft 2020-12，作為
   文件與一致性測試的依據；執行期不依賴 jsonschema 套件）。
3. `shops/sxj/shop.json`：
   - 只填計畫 §3.2 表中有出處的 sxj 值，逐字照抄。
   - `contact.line_url`、`contact.map_url`、`site.ga4_property_id`、`env_paths.ai_pc.ehank_root`
     填 null，並列入 `pending_owner_confirmation`。
   - `hours` 逐字複製 `line-bot/handover.json` 的全部欄位（含 night_takeover_delay_min）。
   - `legacy_layout: true`。
4. `shops/_lib/shopctx.py`：
   - 只用 stdlib，相容 Python 3.11+（`from __future__ import annotations`，不用 3.12+ 語法）。
   - API：`load_shop_context(*, default_shops_root, env=None)`、`ShopContext.shop_id`、`.get(dotted)`、
     `.hours`、`.weekly_windows()`、`.path(key)`、`.secret_file(name)`、`.data_dir`；
     `ShopContextError(code, message)`。
   - 錯誤代碼依計畫 §3.5。一個 process 只綁一家店（`SHOP_ALREADY_BOUND`）。
   - 只回傳路徑，不讀密鑰內容。
   - CLI：`validate [--shop ID]`、`check-all`、`show --json`（只輸出非機密欄位）。失敗時 exit 2。
5. `shops/_lib/test_shopctx.py`：使用 unittest，見下方 Tests。
6. `shops/_fixtures/synth-a/shop.json`、`shops/_fixtures/synth-b/shop.json`：
   - 純合成資料，事實欄位內含 `CANARY-A`、`CANARY-B`；`legacy_layout: false`；路徑全部相對。
7. `shops/_fixtures/invalid/*.json`：涵蓋計畫 §3.5 每一種錯誤代碼，每種至少一個。
8. `src/shopContext.ts` 與 `src/shopContext.test.ts`：
   - 驗證規則與錯誤代碼和 Python 相同；`windowFor(date)` 正確換算 JS getDay。
   - 沿用 repo 既有的 TS 模組格式與測試方式（先看 package.json 的 test script；沒有的話用
     node:test 搭配 tsx）。
9. `.gitignore`：新增 `shops/*/secrets/`、`shops/*/data/`。

## Constraints
- 除了 `.gitignore`，不修改任何既有檔案。不 import、不呼叫任何現役程式。
- 不放任何密鑰值、個人資料、真實客戶資料。不自行猜測任何店家數值。
- 不連網路。測試用的 canary 密鑰與資料一律在測試執行時寫進 temp 資料夾，不進 git。
- 錯誤訊息用繁體中文，並附上錯誤代碼。絕對不可以回退到其他店。

## Tests
1. sxj 載入成功：`SXJ_SHOP_ID` 未設定時 `ctx.shop_id == "sxj"`；`=sxj` 時結果完全相同。
2. 出處一致：每個有出處的 sxj 值，都必須能在計畫標示的來源檔案中以字面找到（唯讀比對）。
   `shop.json.hours` 必須等於 `line-bot/handover.json` 解析後的物件。
3. fail-closed：`invalid/*` 每一種都得到預期的錯誤代碼；空白 `SXJ_SHOP_ID` 報錯，而不是用 sxj；
   不存在的 id 報 `SHOP_NOT_FOUND`，而且沒有讀取 `shops/sxj/` 的任何檔案（以 audit hook 證明）。
4. 兩家合成店並行：
   - 同時啟動兩個子 process（SXJ_SHOP_ID 分別為 synth-a 與 synth-b，共用同一個 temp SXJ_SHOPS_ROOT）。
   - 每個子 process 載入 ctx，讀取自己的 `secret_file("canary.txt")` 與 `data_dir/canary.txt`，
     輸出事實欄位。
   - 斷言 A 的輸出只含 CANARY-A，B 的輸出只含 CANARY-B。
   - 斷言 `sys.addaudithook` 記錄的 open 事件中，沒有任何路徑落在對方的資料夾。
   - `secret_file("../synth-b/secrets/canary.txt")` 必須報 `PATH_ESCAPE`。
   - TS 版本以 fs 包裝做同樣的檢查。
5. `check-all`：synth-a 與 synth-b 通過；故意讓兩店使用相同的 `naming.pipeline_mutex` 時必須失敗。
6. 星期換算：Python 與 TS 都要測：週六只有 12:00-18:00；週日公休；週一 10:00-20:00。
7. Python 3.11 相容：以 `ast.parse(source, feature_version=(3, 11))` 檢查 `shopctx.py`。
   有 Python 3.11 可用時再實跑一次。
8. 兩個 loader 一致：對所有 `_fixtures` 輸出相同的成功值或錯誤代碼；兩邊的欄位集合都等於 schema。
9. `git check-ignore` 確認 `shops/synth-x/secrets/a.json` 與 `shops/synth-x/data/a.json` 會被忽略。
10. 驗收：`git status` 只顯示上列檔案；repo 既有的測試指令全部照跑並通過。

## Rollback
刪除新增的檔案並還原 `.gitignore`。現役行為從未改變。

## Output format
每個檔案各一段：`=== FILE: <path> ===` 加上一個 fenced block。除上列檔案外不修改任何檔案。
```
