# F21 發佈可靠性狀態機與裁決（2026-08-19）

## 結論

這不是單一 API 壞掉，而是「素材、發布、對帳、修復」混成一條會把日誌簡化成
成功旗標的鏈。F21 的行事曆旗標污染已修，但 8/18 的實際事故主要是監控把
`slot=2|3` 當作 Reel，遺失了真實媒體型別。

**當前禁止宣稱已穩定自動發布。** 8/18 是圖片 fallback，8/19 的 Slot 3 Reel
仍未通過雙審；本文件定義的修補只讓系統如實報紅、阻止重複 YouTube Short，
不會補造影片或重發既有貼文。

## 真實狀態流

```text
已鎖定行事曆
  -> 圖片 / Reel 候選素材
  -> Reel 來源、metadata、雙審、visual QA 都通過
  -> 人工或既有核准流程
  -> FB 與 IG 各自的遠端 Reel read-back（ID、正確平台 permalink、原文完全一致、狀態）
  -> 合格 IG Reel（同日、同 slot、非 dry-run、success|posted、media_type=reel、
     published、64 位 local video SHA、remote evidence 與 post_id 一致）
  -> YouTube durable intent
  -> YouTube 遠端回應含 video_id
  -> YouTube videos.list read-back（ID、public、title、description 完全一致）
  -> 同日同 slot 的 YouTube ledger
  -> 日結對帳
```

兩條不可混淆的分支：

```text
圖片 / carousel / VIDEO_DEFERRED
  -> FB/IG transport 可成功
  -> 不產生 YouTube Short 義務

YouTube 回應遺失、5xx、成功但沒有有效 video_id、read-back 不符、或本機 ledger 寫入失敗
  -> durable intent 保留為 pending / uncertain
  -> 日結維持紅燈
  -> 禁止自動重傳；先以遠端證據人工恢復
```

## 8/18 已證實的根因

| 觀測 | 證據 | 正確裁決 |
|---|---|---|
| Slot 2 FB/IG 已有 transport 成功 | `data/posted-log/2026-08-18.json` 是 `image` + `VIDEO_DEFERRED` | 不是 live Reel，也不欠 YouTube |
| watchdog 在 23:00、23:30 啟動 YouTube | `output/watchdog-logs/2026-08-18.log` | 錯誤 slot 推論，屬虛報／無效修復 |
| uploader 沒有上傳 | `output/youtube-logs/2026-08-18.log` 正確拒絕無 IG Reel | 沒有把圖片錯傳到 YouTube |
| 8/19 Slot 3 | `data/video-reviews/2026-08-19.json` 尚 pending | 明日 Reel 不 ready，不得當作素材齊備 |

## 已收斂的系統契約

1. `src/publishingReconciliation.ts` 是唯一 Reel-to-Short 對帳語義：來源與 YouTube
   紀錄均需是 array、來源日期必須等於請求日期、完成 Short 必須同日同 slot 且有
   `video_id`、`title`、`uploaded_at`。
2. `watchdog-patrol.ps1`、`day-audit.ps1`、`youtube-upload.ps1` 都呼叫同一份契約；
   不再由 slot 編號推論影片。
3. 三支排程腳本都有 `-ObserveOnly`：不寫報告、不啟動排程、不發文、不執行 GA4
   ledger 寫入，僅輸出可重放的判決。
4. 明日 readiness 使用真實 Reel 發佈閘門；即使既有發布流程的 visual QA 尚為
   warning 模式，readiness 必須將缺失／FAIL 視為 blocked。
5. Meta Reel 成功必須有遠端 read-back；IG 僅接受 `instagram.com`、FB 僅接受
   `facebook.com`／`fb.watch` 的 permalink，避免任意 HTTPS 字串污染本機帳本。
   read-back 失敗一律 non-retryable，不可把 transport 當成已上線。
6. YouTube POST 前先持久化 intent。任一非 2xx、回應不完整、read-back 不符或本機
   完成 log 寫失敗時，intent 會阻擋下一次 POST；只有明確、可判定的 4xx 拒絕才可清除
   intent 並重試。
7. 遠端路徑的 single-flight lock 不自動回收 stale lock，且 owner marker 只能由
   自己釋放；通用 JSON lock 僅在可解析 PID 已確認死亡時可回收。未知／舊／活躍鎖都
   fail-closed，先人工核對遠端狀態再處理。

## 目前尚未完成、不得粉飾為完成

- **影片生產與雙審：阻塞。** 8/19 Slot 3 未通過；DPAPI／生成來源與審核問題不能
  用排程或 fallback 掩蓋。
- **FB + IG 主題／媒體正確性：仍未在正式帳號 smoke。** 程式已要求遠端 ID、平台
  permalink、原文與 Reel 狀態 read-back，但 Graph 正式欄位（尤其 FB
  `permalink_url`／`description`）尚未實測；且遠端讀回不能單獨證明遠端影片 bytes
  與批准本機 SHA 完全相同，啟用前仍需人工視覺／來源驗收。
- **YouTube uncertain recovery：需要人工遠端確認。** intent 中會保留 remote video ID；
  在取得該影片實際存在且屬於本來源的證據前，不允許自動補發。
- **GA4：部分完成。** `line_click` 總數可唯讀取得，但目前 GA4 property 沒有
  `customEvent:link_source` 維度，來源拆分會明確顯示 `total_only`，不可猜用舊欄位。
- **Google Search Console／索引：未證明。** 目前網域有 robots、sitemap 與 HTML 驗證檔，
  但沒有現行 `https://sixiangjialaundry.com/` owner 或 URL Inspection 證據。IndexNow 回應
  不是 Google 索引證明。

## 下一個可驗收關卡

1. 以隔離 fixture 驗收所有負面分支：圖片 fallback、跨日 source、壞 ledger、漏一支
   Short、成功回應但 log 寫失敗、兩程序 stale-read。
2. 在不發布的情況下，對 Windows Task Scheduler 做一次 real task registration／last-run
   smoke 驗證；`Ready`、exit 0 或 toast 都不算成功。
3. 先用正式帳號的**唯讀** Meta／YouTube read-back smoke 驗證所需欄位及 OAuth scope；
   未取得人類核准不得建立測試貼文或 Short。
4. 影片先補齊來源、metadata、雙審、visual QA 與人工連續性驗收，才允許出現新的
   合格 IG Reel。
5. 由網站擁有者在 Search Console 驗證 URL-prefix property，提交／確認 sitemap，並保存
   首頁與三個服務頁的 URL Inspection 證據。
6. 在 GA4 建立事件範圍 `link_source` custom dimension 後，以唯讀 `ga4-report` 驗證
   總數與來源列；再把 inquiry／booking／revenue 回填或串接，才可稱轉換漏斗完成。
