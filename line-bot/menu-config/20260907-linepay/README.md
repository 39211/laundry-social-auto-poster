# 私享家目前選單設定

2026-09-07 經使用者選定樣式及確認「客人自行輸入付款金額」後，透過 Messaging API 設為預設選單。

- `menu.json`：尺寸、名稱、六個點擊區域及正式動作。
- `menu.jpg`：使用者選定圖片，維持原構圖，僅轉 JPEG 符合上傳大小。
- `deployment.json`：正式選單 ID、前版 ID 與遠端核對結果。
- `previous-menu.json`：前版選單設定；前版雲端物件未刪除，可重新設為預設。

付款使用原有商店固定 QR 目的網址，客人自行輸入金額。沒有 Online API、自動帶金額、自動核銷或推送測試交易。

驗證：LINE 物件 validate 通過、遠端六區設定一致、圖片 hash 一致、預設 ID 一致。手機 LINE 付款頁尚待確認，不等於已做交易驗收。

維護此選單時，以本目錄的 `menu.json` 及 `menu.jpg` 為準。既有 `upload_default.py` 的 main 仍為歷史 v5/v6 圖片與三欄配置；不要直接執行該 main，否則會把目前核准選單換回歷史版本。既有 `upload_default.api` 可用來操作 Messaging API，正式選單修改後應再次讀回核對。此輪未修改 Python 程式碼。
