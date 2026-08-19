# Laundry Daily Content Images — 2026-08-07

## 判決

`MATERIAL_NO_GO_VIDEO_DEFERRED`

這是秘密安全的店主審核包，不是核准、發佈或已完成影片證明。今日兩個 mixed-carousel slot 的結構檢查通過，但人工視覺 QA 均因跨圖物件連續性失敗而判定 `MATERIAL_NO_GO`。兩支影片均在付費送出前停止，生成送出次數為 0。

## 請先看

1. `evidence/image-manual-review.json`：四圖逐 slot 的具體阻擋項目。
2. `evidence/first-frame-review.json`：兩輪 9:16 首幀為何未通過。
3. `evidence/media-readiness.json`：結構驗證、人工上位判決與 `VIDEO_DEFERRED` 原因。
4. `media/images/`：今日 8 張 1080×1350 實景候選圖，僅供審核，不可發佈。
5. `media/first-frames/`：今日 4 張 1080×1920 首幀候選，僅供比較，不可送片。

## 今日兩個 slot

- Slot 1 / reach-answer：化妝包拉鍊邊卡粉，先看內袋縫線。主要實驗變因為 `single_card_conflict_visibility`。
- Slot 2 / evidence-conversion：帆布鞋送洗前，把兩隻鞋對齊拍清楚。主要實驗變因為 `paired_shoe_count_anchor`。

兩個變因都只是 hypothesis；72 小時資料仍不足以宣稱有效。

## 阻擋摘要

- Slot 1 圖片：化妝包、拉鍊、內裡、卡片、托盤與粉痕跨圖漂移。
- Slot 2 圖片：卡片消失、止擋數量改變、出現假測量圖形，鞋體與鞋帶連續性漂移。
- Slot 1 影片：首幀未鎖定滑軌放卡與可追蹤五指；今日 MP4 不存在。
- Slot 2 影片：首幀五指不可完整追蹤；現有 MP4 是舊 prompt hash，不屬於今日 manifest。
- Hermes：當次 readiness 檢查未完成，因此 OAuth、video capability 與 dependencies 未被證明；未呼叫 paid generation。

## 治理邊界

- 未核准任何 slot。
- 未發佈 Facebook 或 Instagram。
- 未寫入 `approved-log` 或 `posted-log`。
- 未建立 TTS、master、current video source/review 或假 completed run。
- 修復佇列新增今日兩筆 `VIDEO_DEFERRED`；沒有任何舊項目被標成 `RESOLVED`。

## 完整性

請用 `SHA256SUMS.txt` 驗證包內檔案。`MANIFEST.json` 列出交付內容與用途。
