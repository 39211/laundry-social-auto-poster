# Laundry Video Repair Cycle — Read First

判決：`NO_GO_VIDEO_DEFERRED`。

- Queue 為 14 筆 `VIDEO_DEFERRED`、0 筆 `RESOLVED`、0 個 ready link。
- 2026-08-06 兩支新 raw 都是 Hermes xAI OAuth 一次性 submission，provider 已完成，但原生輸出為 1088x1920，不是 1080x1920。
- 本輪未生成、未重送、未做 TTS／master、未執行 `--ready`、未發布 FB/IG、未寫 `posted-log`。
- Slot 1 當日只有 Facebook 四圖 carousel 成功；Instagram 無成功紀錄。不得把它改標為影片成功。
- 先讀 `report.md`，再用 `CHECKSUMS.sha256` 驗證包內檔案。此包不含 raw MP4、Token、Cookie 或 OAuth 憑證。

