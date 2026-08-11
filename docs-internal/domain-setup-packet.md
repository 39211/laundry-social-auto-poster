＃ 網域購買與搬遷包(付費 .com 版)

更新:2026-08-10。決定:買自有網域,取代 `39211.github.io`。

---

## 先講一個壞消息

**`sixiangjia.com` 已經被別人註冊了**(RDAP 查詢狀態 active,只是對方沒架站)。所以要選替代方案。

---

## 我查證過的可用網域(全部即時查過 RDAP)

| 候選 | 狀態 | 我的評價 |
|---|---|---|
| **`sixiangjialaundry.com`** | ✅ 可註冊 | **首選**。品牌全名 + laundry,客人和搜尋引擎都看得懂,無連字號 |
| `sixiangjiacare.com` | ✅ 可註冊 | 次選。care 對應「洗護」,比 laundry 柔和,但語意稍模糊 |
| `sixiangjia.net` | ✅ 可註冊 | 品牌名最完整,但 .net 對台灣一般消費者的信任度低於 .com |
| `sixiangjiaclean.com` | ✅ 可註冊 | 可以,但 clean 比 laundry 通用、辨識度略低 |
| `sixiangjia-laundry.com` | ✅ 可註冊 | 不建議。連字號讀起來廉價,也容易口述時漏掉 |
| `taichunglaundry.com` | ✅ 可註冊 | **不要選**。純關鍵字無品牌,Grok 和我都反對——換網域的目的就是讓人認出是你 |
| `sixiangjia.tw` / `.com.tw` | ❓ 查不到 | TWNIC 不支援程式查詢(HTTP 501),要到註冊商網站查。`.tw` 年費通常 NT$400–800,比 .com 貴 |

**我的建議:`sixiangjialaundry.com`。**

---

## 購買步驟(約 5 分鐘,你操作)

### Cloudflare Registrar(推薦,成本價無加價)

1. 到 https://dash.cloudflare.com/sign-up 註冊免費帳號
2. 左側選單 → **Domain Registration** → **Register Domain**
3. 搜尋 `sixiangjialaundry.com` → 加入購物車 → 結帳
4. 結帳後在 **Websites** 應該會自動出現這個網域(Cloudflare 同時是註冊商和 DNS,不用再另外設 name server)

年費約 US$10 上下(接近成本價,約 NT$300)。

> **買完立刻做兩件事**:開啟「自動續約」、確認 WHOIS 隱私是開的(Cloudflare 預設開)。網域過期被搶走,現有排名會全部歸零。

### 如果你想要 `.tw`

到 [Gandi](https://www.gandi.net/) 或台灣註冊商(遠振、戰國策)查 `sixiangjia.tw`。`.tw` 可能需要身分證明文件,年費也較高。**我建議先買 .com 就好**,`.tw` 之後想加再說。

---

## 買完之後:跟我說一聲,剩下我全做

你只要告訴我「買好了,網域是 XXX」,我就執行:

1. **Cloudflare DNS 設定**(記錄值我已查證,見下)
2. **GitHub Pages 綁定自訂網域**
3. **全站網址切換**——已盤點過:`.env` 一個變數 + 程式碼 7 處硬編碼
4. **舊網址 301 轉址**:`39211.github.io/任何路徑` → 新網域同路徑,現有收錄與排名不會掉
5. **全站設定更新**:sitemap、canonical、og:url、結構化資料的 `url`、`llms.txt`、IndexNow 金鑰、GA4 資料串流網址
6. **重新提交**:GSC 加新資源並提交 sitemap、IndexNow 用新網域推送

### 要加的 DNS 記錄(GitHub Pages 官方位址)

| 類型 | 名稱 | 值 |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `39211.github.io` |

主網址用 apex(`sixiangjialaundry.com`,不帶 www),`www` 自動轉過去。
Cloudflare 的橘色雲(Proxy)先關成灰色,等 GitHub 發完 HTTPS 憑證再說。

---

## 搬遷的風險與我的因應

| 風險 | 因應 |
|---|---|
| 排名暫時波動 | 301 是 Google 官方認可的搬遷方式,權重會轉移。通常 2–4 週回穩,小站更快 |
| 舊網址失效 | `39211.github.io` 保留不刪,永久 301。不會有 404 |
| GSC 資料斷掉 | 新舊網域都保留在 GSC,用「網站遷移工具」正式通知 Google |
| 社群連結指向舊址 | 我會列出 IG/FB/YouTube 個人檔案要改的欄位給你(那幾個要你改) |

---

## 我不能代做的部分

購買本身必須你操作——輸入信用卡資料這件事我不會做,不論在哪個網站。這是我對你金流安全的底線,不是能力問題。

除此之外從 DNS 到 301 到重新提交索引,全部我來。
