# GA4 讀取端 — 部分完成，待擁有者驗收（2026-08-19）

> OAuth 與總 `line_click` 讀取已驗證；這不等於來源歸因或轉換漏斗已完成。
> 2026-08-19 的唯讀 API 查詢顯示 `customEvent:link_source` 尚未在 GA4
> property 註冊，讀取端因此只能誠實回報 total-only。下面保留可重做的設定步驟。

## 現況

| 項目 | 狀態 |
|---|---|
| OAuth + Data API 唯讀查詢 | ✅ 已能取得總 `line_click` |
| `GA4_REFRESH_TOKEN`／`GA4_PROPERTY_ID` | ✅ 已設定；不得貼入文件或聊天 |
| 自訂維度 | ❌ `link_source` 尚未註冊；舊 `source` 不能代表目前事件 |
| 來源拆分 | ❌ API 會明確回報 `total_only`，不可猜測或沿用舊 ledger |
| inquiry／booking／revenue 漏斗 | ❌ 尚無實際 conversion event 資料 |
| 接進日結 | ⚠ 有程式路徑，但排程 exit 0 不代表量測或歸因已驗收 |

## 目前可用的真實基準

```
2026-08-14   total_line_clicks = 15（本次唯讀 API）
             by_source = 無；GA4 拒絕 customEvent:link_source 維度
```

`data/leads/2026-08.json` 內同日的 14 次／`post:11`／`ig-comment:3` 是舊欄位
快照，已與本次 API 總數不一致，不能作為目前可信的來源分拆。

## 必須由 GA4 擁有者完成的動作

在 GA4「管理 → 自訂定義」建立事件範圍自訂維度：

- 維度名稱：`link_source`
- 事件參數：`link_source`
- 範圍：事件

等待新的事件產生後，以唯讀 `npm run ga4-report -- --date YYYY-MM-DD` 驗證總數
與來源列均出現。只有 `source_clicks_status: "measured"` 才表示來源分拆可用；
`recorded` 或 Task Scheduler 的 exit 0 都不是此驗收的替代品。

---

<details><summary>設定與重做步驟（不是目前完成狀態）</summary>


> 程式已經寫好、測過；若 OAuth 值失效，依此步驟重做。
> OAuth 可取得總數，但來源歸因仍必須先完成上方的 `link_source` 自訂維度驗收。
> 日結排程只能觸發讀取，不能代替 total／來源列的實際證據。

---

## 為什麼需要這個

網站上的帶碼連結(`/go/line.html?source=…`)**一直都有在送 `line_click` 事件到 GA4**,
這條線是通的。缺的是**反方向**:沒有任何程式去問 Google「今天各渠道被點了幾次」。

來源拆分使用事件參數 `link_source`。請在 GA4 管理 → 自訂定義，建立同名的
**事件範圍自訂維度**；未建立時，程式會保留總點擊數、把來源拆分標成
`total_only`，不會用舊的 `source` 欄位猜測來源。

若 OAuth 讀取端未設好，任何 `line_click = 0` 都可能是未量測，而不是沒人點。
若自訂維度未設好，只有總數可用，來源分拆不可成立。

## 好消息:不用建服務帳戶

沿用你當初為 YouTube 上傳建的那組 OAuth 用戶端,只是多授權一個唯讀範圍
(`analytics.readonly`)。而且**存成另一個 refresh token**——
這樣就算 GA4 這邊授權出問題,也絕對不會弄壞已經在跑的 YouTube 上傳。

---

## 步驟

### 1️⃣ 先拿「資源 ID」(30 秒)

GA4 後台 → 左下角**管理** → **資源設定** → **資源詳細資料**

右上角有一串**純數字**(例如 `498273615`),那就是資源 ID。
⚠ **不是** `G-ZKHW4MTBZJ` 那個——那是「評估 ID」,是寫入端用的,兩者不同。

### 2️⃣ 授權(3 分鐘)

在專案目錄跑:

```bash
npm run ga4-authorize
```

它會印一個網址。**用「管理這個 GA4 資源的那個 Google 帳號」打開**,按同意。
同意後瀏覽器自動跳回本機,終端機就會印出 refresh token。

> **如果 Google 說 redirect_uri 不符**:到 Google Cloud Console →
> API 和服務 → 憑證 → 點那個 OAuth 用戶端 → 「已授權的重新導向 URI」
> 加入 `http://localhost:8731/oauth2callback` → 儲存 → 重跑一次。
>
> **如果說沒拿到 refresh token**:到 [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
> 把這個應用的存取權移除,再重跑(Google 對已授權過的用戶端預設不再發新的)。

### 3️⃣ 貼進 `.env`(30 秒)

把終端機印出的兩行貼進 `.env`,第二行填步驟 1 拿到的數字:

```
GA4_REFRESH_TOKEN=1//0e...(腳本印出來的那串)
GA4_PROPERTY_ID=498273615
```

### 4️⃣ 驗證(30 秒)

```bash
npm run ga4-report -- --date 2026-08-11
```

- 看到 `"status": "recorded"` 且 ledger 為 `source_clicks_status: "measured"`
  → 總數與來源拆分都可用。
- 看到 `"status": "recorded"` 但 ledger 為 `total_only` → 總數可用，
  `link_source` 維度尚未完成或尚未有新資料；不可把空來源當成 0。
- 看到 `"status": "unmeasured"` → 沒成功,`reason` 會說是哪一步的問題,照著修。

---

## 成功之後會發生什麼

- 只有 `source_clicks_status: "measured"` 時，`data/leads/2026-08.json`
  才會有 `source_clicks`，像這樣：
  `{"ig-comment": 7, "poster-front": 2, "(not set)": 3}`
- `unknown` 是重導頁缺少 `source` query parameter 時送出的值；其他例如
  `(not set)` 必須依 GA4 實際回傳判讀，不能預先歸因。
- 日結可排程觸發，但仍要驗證當日 API 結果與 `source_clicks_status`，不能只看
  Task Scheduler 的 exit code。
- 你每日 10 秒回填的「詢問幾件」跟這個並排,就能分辨
  **「有人點但沒問」**(內容有效、LINE 那關卡住)和 **「根本沒人點」**(內容無效)——
  這兩件事的解法完全相反,現在分不出來。

## 沒做這一步會怎樣(誠實說)

缺 OAuth／讀取權限時，ledger 會標 `source_clicks_status: "unmeasured"`；
缺 `link_source` 維度時，則是 `total_only`。兩者都不會偷偷填 0。

代價是:90 天計畫 P1 階段的三個基準數字裡,「詢問來自哪個渠道」這一個永遠建不起來,
之後所有「哪個渠道有效」的判斷都只能靠你回填時憑印象講。

</details>
