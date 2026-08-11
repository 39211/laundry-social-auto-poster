# GBP API 申請 — 已送出,等審查

## 現況(2026-08-12)

| 項目 | 狀態 |
|---|---|
| 申請 | ✅ 已送出,**案件 ID 4-3697000041994**,審查約 7-10 工作天 |
| Business Information API | ✅ 已啟用(配額 0,核准後變 300) |
| Cloud 專案編號 | 263073074704 |
| 送出時填的網站 | `https://39211.github.io`(與商家檔案登記一致) |
| 選定商家 | 私享家 旗艦總店(已驗證) |

## 🔴 審查期間的唯一風險:網站欄位不一致

`sixiangjialaundry.com` 已購買、等 PowerWeb 開通。**網域一上線,第一件事是去 Google 商家檔案把網站欄改成新網域** ——
申請表填的是 `39211.github.io`,審查員會比對商家檔案上的網址;兩邊對不上會被打回。

順序不能反:**先改商家檔案,再對外宣告新網址**。改完在這裡記一行日期。

## 核准後我接手的部分(老闆完全不用碰)
OAuth 憑證 → 發布程式 → 每週貼文與回評自動化 → 貼文帶渠道碼 `source=gbp` 進 GA4。

## 核准前的替代方案
`docs-internal/gbp-weekly-pack.md` 的週貼包,老闆每週手貼一次(5 分鐘)。

---

<details><summary>送出時的申請理由全文(存查)</summary>

We operate a single physical laundry shop in Taichung, Taiwan (私享家洗衣店 / Sixiangjia Laundry,
No. 365, Sec. 2, Qinghai Rd., Xitun District), and we are requesting access for that one verified
location only — we are not a reseller, agency, or aggregator, and we will not manage locations we do
not own. We already maintain our business facts (address, opening hours, holiday closures, service
descriptions, FAQs) as a single source of record that publishes structured data to our website. We
want API access so that: (1) opening hours and holiday closures stay synchronized between that source
of record and our Business Profile, so the two can never disagree; (2) we can publish Business Profile
posts about seasonal garment and shoe care from the same content pipeline instead of re-entering them
by hand; (3) we can read our own review and performance data to measure whether the content we publish
actually results in calls, direction requests, and bookings. Access would be used only for our own
business data.

</details>

---

<details><summary>原始申請指引(已完成,存查)</summary>


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

</details>
