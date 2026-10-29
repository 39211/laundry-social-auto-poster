# 私享家洗衣門市 —— 給家裡電腦 Agent 之 24H 雙機協作建置指南

這份文件是專門寫給家裡電腦（`ai`，IP: `100.77.152.80`）上的 AI Agent（Claude / Codex / Grok）的交接文件。

---

## 🎯 任務目標
店長希望**店裡的電腦（`100.116.147.80`）在每晚打烊後可以放心關機**，而 LINE 官方帳號依然能在**家裡的電腦 24 小時不間斷回覆**顧客的訊息、照片估價與進度查詢。

---

## 🌐 雙機網路與連線現況
- **兩台電腦皆在 Tailscale 內網中**：
  - 店裡電腦（本機）：`100.116.147.80`，帳號 `AN`。
  - 家裡電腦（你）：`100.77.152.80`。
- **免密碼 SSH 已建立完成**：
  - 店裡的 OpenSSH Server 正在 Port 22 正常監聽。
  - 家裡電腦的公鑰 `ai-to-shop-pc-20261009` 已成功登錄於店裡電腦的 `C:\ProgramData\ssh\administrators_authorized_keys`。
  - **你在家裡電腦已可直接免密碼連入店裡電腦**：
    ```bash
    ssh AN@100.116.147.80
    ```

---

## 📦 第一步：在家裡電腦同步店裡最新代碼庫
店裡的程式碼已完成全新升級（包含 8 層視覺深度分析、659 句專業真人對話庫、Photo Session Context 快取記憶）。
請在家裡電腦直接執行 `scp` 將專案複製過去：
```bash
# 在家裡電腦終端機執行：
scp -r AN@100.116.147.80:C:/LaundryStores/fxwash C:/LaundryStores/fxwash
```
**關鍵檔案清單**：
- `runtime/webhook_server.py`：LINE Webhook HTTP 伺服器 (Port 18791)
- `runtime/vision_service.py`：Gemini Vision 8 層全方位深度估價服務
- `runtime/chat_service.py`：真人引導式對話核心 (支援照片多輪上下文延續)
- `runtime/photo_session.py`：照片上下文快取管理
- `config/prices.json`：門市官方現役 Dco 價目表 (113項)
- `config/Clothing_Memory.md`：衣物 8 層辨識記憶與避坑對照表
- `config/Memory.md`：鞋類與皮件 8 層辨識記憶庫
- `config/Dialog_Phrases.json` & `config/dialog_corpus.py`：659 句師傅真人引導對話庫
- `secrets/line-channel.json`：LINE Official 金鑰
- `secrets/vision.json`：Gemini API Key

---

## 🔄 第二步：建立「店裡關機感知與快照拉取器」
店裡的 Access 洗衣資料庫（`eHank.mdb`）位於店裡本機硬碟，店裡背景會定時產出 `data/snapshot.json`。
請在家裡電腦建立一個簡單的排程腳本 `pull_shop_snapshot.py`（每 5 分鐘執行一次）：

```python
import subprocess
import time
from pathlib import Path

SHOP_IP = "100.116.147.80"
LOCAL_SNAPSHOT = Path("C:/LaundryStores/fxwash/data/snapshot.json")
STATE_FILE = Path("C:/LaundryStores/fxwash/data/shop_status.json")

def sync_from_shop():
    # 測試店裡電腦是否開機 (Ping 100.116.147.80)
    res = subprocess.run(["ping", "-n", "1", "-w", "1000", SHOP_IP], capture_output=True)
    is_online = (res.returncode == 0)
    
    if is_online:
        try:
            # 開機狀態：拉取最新快照
            subprocess.run([
                "scp", f"AN@{SHOP_IP}:C:/LaundryStores/fxwash/data/snapshot.json",
                str(LOCAL_SNAPSHOT)
            ], check=True, timeout=10)
            STATE_FILE.write_text('{"shop_online": true}', encoding="utf-8")
            print("[Sync] 成功自店裡同步最新快照 snapshot.json")
        except Exception as e:
            print(f"[Sync] 拉取快照失敗: {e}")
    else:
        # 關機狀態：標記店裡已打烊關機
        STATE_FILE.write_text('{"shop_online": false}', encoding="utf-8")
        print("[Sync] 店裡電腦目前離線 (已打烊休息)")

if __name__ == "__main__":
    sync_from_shop()
```

---

## 💬 第三步：查件時之「打烊前進度回覆」設計
當店裡電腦為 `shop_online == false`（關機打烊）時，家裡電腦的 `lookup_service.py` 讀取本地快取的 `snapshot.json`，並在回覆文字開頭附上貼心提醒：

> 「您好，西屯門市目前為夜間打烊休息時間（平日營業時間 10:00-20:00、週六 12:00-18:00，週日公休）。
> 
> 系統為您調閱今日打烊前的最新洗滌紀錄如下：
> 📱 手機號碼：0912-xxx-xxx（會員：王小明）
> 👔 送洗品項：
> 1. 深藍色西裝一套（已完工）
> 2. 羊毛長大衣一件（清洗整燙中，預計 10/12 完工）
> 
> 已完工的西裝於明日上午 10:00 門市開門後即可前來取件（至善國中正對面，門口好停車）。若有急件需要提早，歡迎明天上午來電門市，謝謝您！」

---

## 🚀 第四步：啟動服務與切換 Webhook
1. 在家裡電腦背景啟動：
   ```powershell
   python C:\LaundryStores\fxwash\runtime\webhook_server.py 18791
   ```
2. 在家裡電腦開啟公網通道（例如使用 `tunnel_supervisor.py` 或 Cloudflare Tunnel），獲得固定的 HTTPS 網址。
3. 將該 HTTPS 網址填入 LINE Developers 後台的 Webhook URL。
4. 測試：將店裡電腦關機，用手機傳照片和文字給 LINE 官方帳號，驗證家裡電腦是否 100% 正常秒回！
