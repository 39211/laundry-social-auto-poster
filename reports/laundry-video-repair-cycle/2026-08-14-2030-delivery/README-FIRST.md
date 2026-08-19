# Laundry Video Repair Cycle — 2026-08-14 20:30

## 判定

- 24 筆佇列全部維持 `VIDEO_DEFERRED`；`ready=0`、`RESOLVED=0`。
- 2026-08-14 Slot 1：首幀仍有卡片與橫桿分離／物件數錯誤，未送出影片生成。
- 2026-08-14 Slot 2：首幀幾何通過，僅送出一次新 generation；原始影片為 1088×1920，因不符合原生 1080×1920 而拒收，未縮放、未重送。
- 未發布 FB/IG、未重發歷史貼文、未手寫 `posted-log`、未執行 `resolve-video-repair --ready`。

## 複核順序

1. `run-report.md`：本次結論與未執行動作。
2. `audit.json`：24 筆佇列、13 筆已提交 raw、發布觀察與雜湊摘要。
3. `queue-snapshot.json`：本次結束時的佇列快照。
4. `slot-02-first-frame-v02.png` 與 `slot-02-contact-sheet.jpg`：首幀與僅供視覺分流的接觸表。
5. `slot-02-manifest.json`、`slot-02-job.json`、`slot-02-generation-report.json`：單次提交與原生尺寸拒收證據。
6. `hermes-inspect.json`：Hermes xAI OAuth 路徑檢查結果。
7. `CHECKSUMS.sha256`：逐檔 SHA-256。

## 邊界

此包不含被拒收的 raw MP4，也不代表影片已準備、已發布或已解決。下一步只能建立新版本，並先確認供應端能輸出原生 1080×1920；不得縮放既有 raw 或重送既有 generation ID。
