# GBP API 申請 — 我查完了,結論與逐字填答(2026-08-11)

## 先說結論:我們的條件全數符合,但有一個關鍵風險

**符合的**:商家檔案已驗證且遠超 60 天、有可用的商業網站、你是商家擁有者、API 免費無按次計費。

**風險(最常見的退件原因)**:Google 偏好「email 網域 = 網站網域」。我們現在是 gmail + github.io,兩個都不是自有網域 → 這是唯一可能被打回的點。

**所以順序建議**:先申請,被打回再補網域。理由:審核 2 週到數週,先排隊不吃虧;真被拒,那時網域也買好了可以重送。

## 申請路徑(你回家照做,約 15 分鐘)

**步驟 1**:用「商家檔案的擁有者帳號」登入 Google
**步驟 2**:到 https://console.cloud.google.com/ → 建立專案,名稱填 `sixiangjia-gbp`
**步驟 3**:到 GBP API 存取申請表(developers.google.com/my-business → Request access),下拉選 **Application for Basic API Access**

## 表單逐字填答(直接複製)

| 欄位 | 填這個 |
|---|---|
| Company/Organization name | 私享家洗衣店 (Si Xiang Jia Laundry) |
| Business website | https://39211.github.io/ |
| Contact email | (你商家檔案的擁有者 email,務必一致) |
| Google Cloud Project ID | 步驟 2 建立的專案 ID |
| Number of locations managed | 1 |
| Are you managing your own locations? | Yes — own single location |

**Use case 說明(英文,直接貼)**:
```
We operate a single-location laundry and shoe-care shop in Taichung, Taiwan
(verified Business Profile, operating since 2022). We have built an internal
content automation system that already publishes daily posts to our own
Instagram, Facebook and YouTube channels, and maintains our website at
https://39211.github.io/.

We are requesting Basic API access to automate two tasks for our own single
location only: (1) publishing weekly Business Profile posts about our
services and seasonal care topics, and (2) replying to customer reviews
promptly. We do not manage third-party locations and do not intend to
resell this access. All content is written by the business owner's team and
reviewed before publishing.
```

## 核准後我接手的部分(你完全不用碰)
OAuth 憑證建立 → 我寫發布程式 → 每週貼文與回評全自動 → 貼文帶渠道碼 source=gbp 進 GA4 歸因。

## 在核准前的替代方案(已備好)
`docs-internal/gbp-weekly-pack.md` 的週貼包 + 海報 v2 圖檔,你每週貼一次 5 分鐘。
