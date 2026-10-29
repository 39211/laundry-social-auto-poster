# 洗衣 LINE 商品包 v1.1（模組與風格選配候選）

這一包把「每家門市不同的資料與系統」抽成設定檔、唯讀連接器、模組目錄與風格目錄，並提供一鍵建立門市實例、健檢與交機門檻。它是可交給第二家店做安裝驗證的商品骨架，還不是已經替任何店正式上線的 SaaS。


## 本輪交付範圍（請先讀）

- **試裝成功 ≠ handover ready**：`Install.ps1` 通過只代表示範實例可建立與本機 validate；交機仍須現場驗收門檻。
- **未含本輪交付**：Pay confirm／callback／核帳、選單發布。adapter 可能已有 reserve／confirm 簽名能力，但**未接成產品驗收流程**。
- **Pack 閘**：`pack_product_kit.py`（或 `Pack-ProductKit.ps1`）打包時若 zip 含 `secrets/*.json`（非 `*.example`）、`__pycache__`、`.pyc`／`.pyo` 會直接失敗；交付包應為潔淨檔（不含 `_tmp*` 雜訊）。
- **INSTALL-REPORT.json**：安裝結束後寫入，含 `store_path`、`installed_at_utc`，以及 `validate`（`exit_code`／`ok`／stdout 摘要）。validate 失敗仍會留下報告再拋錯。

## 商品化選配：先選模組，再選風格

新門市的 `shop.json` 會帶入一組可驗證的 starter 預設：品牌選單、真人感客服、店員接手、查件進度與金額摘要。客戶可以改成 `growth`、`pro` 或 `custom`，再從 `product_catalog.py` 的目錄選擇模組與風格。

列出可販售選項：

```powershell
python -B laundry.py catalog
```

查看某一家店目前選了什麼、哪些資料還沒補齊：

```powershell
python -B laundry.py selection --shop .\shop.json
```

選擇會寫在 `shop.json` 的 `product` 區塊。建議使用商品包提供的安全修改器，不要用 PowerShell 重新序列化整份 JSON：

```powershell
python -B patch_shop_json.py `
  --shop .\shop.json `
  --product-plan growth `
  --product-style heritage_green_gold `
  --product-modules brand_oa,human_faq,staff_handoff,progress_lookup,pickup_booking,photo_quote,line_pay_qr `
  --payment-mode merchant_qr `
  --payment-url "https://qrcodepay.line.me/你的店家路徑" `
  --validate
```

選了 `line_pay_qr` 時，`payment.mode` 必須是 `merchant_qr`，且要有合法 QR URL（prefix 後至少一段路徑）。若省略 `--payment-mode`／`--payment-url`，`patch_shop_json.py` 在 modules 含 `line_pay_qr` 時會自動設 `merchant_qr`，但仍**要求**已有或一併傳入可用的 `--payment-url`。

模組的 `ready`、`prepared`、`integration_required` 是實作／接線清單狀態；它們不是正式交付狀態，也**不代表已在 LINE 平台發布選單**（選單發布仍列在 not_included）。照片辨識、外收送、店員群、查件資料源與付款入口都還要在該門市補資料並做平台回讀、手機操作和交機驗收。`line_pay_qr` 是客人自行輸入／掃碼的入口；`line_pay_online` 另列為高風險整合，預設不開啟。

五種預設風格：

- `heritage_green_gold`：雅緻深綠金，適合精品與重視信任感的門市。
- `warm_cream`：奶油暖生活，適合社區、家庭與長輩客群。
- `clean_teal`：清爽專業藍綠，適合快速查價查件與連鎖門市。
- `friendly_sun`：明亮親切橘綠，適合需要大字級引導的客群。
- `modern_mono`：黑白俐落銅色，適合商辦區與高端品牌。

風格會影響選單版型、色彩、字體建議與客服語氣；店名、地址、電話、營業時間、價格與付款規則不會因套用風格而被虛構或改寫。完整選擇表與交付流程見 [商品模組與風格目錄](docs/商品模組與風格目錄.md) 和 [商品化交付流程](docs/商品化交付流程.md)。


## Windows 主控台 UTF-8

`laundry.py` / `connections.py` 會盡量把 stdout／stderr 設成 UTF-8，避免 cp950 把中文印成 `?`。若仍亂碼，請優先使用 **Windows Terminal**，或先執行 `chcp 65001` 再開 PowerShell。

## 這一版真的能做什麼

- `shop.json` 集中管理店名、地址、電話、營業時間、外收送、埠號、查件來源、付款模式、隱私與驗收狀態。
- `connectors/base.py` 定義唯讀資料邊界，現在有 `manual`、`fixture`、`verified_sqlite`、`ehank_readonly` 四種來源。
- `ehank_readonly` 會以現場設定的 eHank 根目錄載入 `ai_engine.db_manager`，只執行既有的 `SELECT` 查詢；連不上時回傳人工處理，不會把「查不到」冒充成「沒有案件」。
- `laundry.py health` 顯示來源狀態、讀取時間、資料筆數與快照雜湊。
- `laundry.py handover` 只有在門市資料、連接器、LINE 憑證、HTTPS、手機、照片、位置、店員群、查件授權、付款、備份還原與斷線復原等條件都具備時才會通過。
- `Install.ps1` 只在空資料夾建立一個乾淨示範實例，不覆蓋既有資料、不帶入私享家客資、不帶入金鑰、不登入 LINE、不發布選單。
- `Configure-Connections.ps1` 在門市現場快速設定 LINE 官方與 LINE Pay；密鑰用隱藏輸入寫入本機 `secrets`，不接受放進 ZIP 或聊天。它可先做本機欄位檢查，再由店主明確要求平台回讀或套用 webhook。

## 安裝一個新門市

在 PowerShell 執行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\Install.ps1 -StorePath "C:\LaundryStores\demo-shop" -Python "C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\python.exe"
```

安裝器拒絕寫入非空資料夾。安裝完成後會有 `shop.json`、`config`、`data`、`logs`、`backups`、`secrets`，但 `secrets` 是空的。先改 `shop.json`，再執行：

```powershell
python -B laundry.py validate --shop shop.json
python -B laundry.py health --shop shop.json
python -B laundry.py handover --shop shop.json
python -B connections.py validate --shop shop.json
```

`handover` 回傳 `blocked` 和 exit code 2 是預期行為，代表還沒有把真門市驗完；不能把它當成安裝失敗。

## 快速接 LINE 官方帳號

先在 LINE Developers Console 準備 Channel access token、Channel secret 和公開 HTTPS webhook URL，再在門市電腦執行：

```powershell
.\Configure-Connections.ps1 `
  -ShopPath .\shop.json `
  -Python "C:\Path\to\python.exe" `
  -ConfigureLine `
  -LineWebhookUrl "https://your-domain.example/line/webhook" `
  -ApplyWebhook `
  -TestWebhook
```

腳本會在本機隱藏輸入兩個密鑰、備份 `shop.json`、寫入 `secrets/line-channel.json`，最後執行本機欄位檢查。若要實際回讀 LINE 官方帳號與目前 webhook：

```powershell
python -B connections.py verify-line --shop shop.json
python -B connections.py test-webhook --shop shop.json
```

若確認要把 webhook 寫入 LINE 平台，才執行：

```powershell
python -B connections.py apply-webhook --shop shop.json --confirm
```

LINE 官方提供 `GET /v2/bot/info` 作為 Bot 資訊回讀，並提供 webhook endpoint 的 GET／PUT；商品包把讀取和修改拆成兩個指令，避免安裝時誤改正式帳號。詳見 [LINE Messaging API reference](https://developers.line.biz/en/reference/messaging-api)。

`test-webhook` 會請 LINE 平台送一個沒有事件的測試 POST 到門市端，用來確認 HTTPS、路由和回應碼；它不是客人訊息，也不會修改選單。

## 快速接 LINE Pay

有兩種交付模式，不能混在一起：

### 客人自行輸入金額的 QR

```powershell
.\Configure-Connections.ps1 `
  -ShopPath .\shop.json `
  -LinePayMode merchant_qr `
  -LinePayQrUrl "https://qrcodepay.line.me/店家網址"
```

這只設定付款入口；店員仍要在商店後台核對金額和交易。

### LINE Pay Online API

先用 LINE Pay 商店後台的「開發者工具」取得 Channel ID、Channel Secret，並完成測試／正式環境的伺服器 IP 設定，再在門市電腦執行：

```powershell
.\Configure-Connections.ps1 `
  -ShopPath .\shop.json `
  -ConfigureLinePay `
  -LinePayMode line_pay_online `
  -LinePayEnvironment sandbox
```

這會把商戶密鑰寫到本機 `secrets/line-pay.json`，不會印出密鑰，也不會自動發出付款。先檢查本機設定：

```powershell
python -B connections.py validate --shop shop.json
python -B connections.py verify-linepay --shop shop.json
```

也可以在設定腳本中明確執行一次 sandbox reserve；只有提供 `-LinePayReserveAmount` 才會送出測試付款請求，沒有這個參數不會送出交易：

```powershell
.\Configure-Connections.ps1 `
  -ShopPath .\shop.json `
  -VerifyLinePay `
  -LinePayReserveAmount 140 `
  -LinePayOrderId DEMO-001
```

若要做一次 sandbox reserve，需由店主明確提供測試金額與訂單號：

```powershell
python -B connections.py verify-linepay `
  --shop shop.json `
  --reserve-amount 140 `
  --order-id DEMO-001
```

reserve 成功不等於已收款；後續仍需 confirm、金額核對、冪等、退款／異常 HOLD 與案件狀態接線。LINE Pay 官方說明測試環境與正式環境的 endpoint、商戶連結金鑰及 IP 白名單都要分開設定，正式交易會產生實際金流，因此商品包預設只讓安裝完成，不代替店主執行正式付款。參考 [LINE Pay 台灣商店 FAQ](https://pay.line.me/portal/tw/customer/faq?categoryId=cashflow) 與 [LINE Pay Merchant](https://pay.line.me/portal/global/business/merchant)。

## 查件連接器

### eHank 唯讀連接器

門市的 `shop.json` 只放本機連接方式，例如：

```json
"lookup": {
  "mode": "ehank_readonly",
  "connector": "ehank_mdb",
  "root_path": "C:\\FXwash",
  "root_env": "",
  "max_age_seconds": 300
}
```

商品包不包含 eHank 的資料庫、程式、客戶資料或任何帳密。另一種做法是把 `root_path` 留白並設定 `LAUNDRY_EHANK_ROOT` 環境變數。連接器目前對 `Cus` 和 `Det` 做唯讀查詢，將完工、處理中、已取件轉成統一狀態；正式交付仍要在另一家店實測「資料變動後多久能查到」以及斷線時的人工接手。

### SQLite 唯讀連接器

`verified_sqlite` 使用 `mode=ro` 連線，要求門市提供 `customers(customer_id,name,phone)` 與 `pieces(piece_id,customer_id,order_no,item,status,price,received_at,ready_at)` 兩張唯讀資料表。這是通用介面，不代表任意洗衣系統都已經接通。

## 安全邊界

這一版不會在安裝時自動登入或發布 LINE 選單，也不會偷偷修改 webhook 或發出付款；它已包含 LINE 官方回讀／webhook 指令與 LINE Pay Online reserve/confirm adapter。**Pay confirm／callback／核帳／選單發布不在本輪產品驗收範圍**（adapter 存在 ≠ 已接線交付）。LINE Pay 回呼、金額核對、案件狀態自動更新仍要在每家店以 sandbox 和手機實測後才能標記正式交付。

手機逐格、真 LINE webhook、店員群、查件授權、付款、備份還原和斷線復原都必須在門市現場留證，不能用本機測試取代。**試裝成功 ≠ handover ready。**

### 打包交付包

```powershell
python -B pack_product_kit.py
# 或
.\Pack-ProductKit.ps1
```

預設輸出 `../output/p3-line-oa-product-kit-v1.1.zip`。Pack 閘會拒絕任何 `secrets/*.json`（僅允許 `*.example`）。
