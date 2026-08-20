# GSC Search Analytics 讀取端設定(2026-08-20)

寫入端(sitemap、IndexNow)一直都在跑,但沒有人問過 Google「這些頁面實際上
有沒有被搜尋看到」。這條線補上讀取端:每天記錄查詢詞、頁面曝光與點擊。

## 憑證

用**獨立的 GSC 專用 client**,不是 YT_CLIENT_ID(那組憑證所屬的 Cloud 專案
這個帳號沒有管理權限,打不開 Search Console API)。實際上就是 GBP 那組
OAuth client(`secrets/gbp-oauth-client.json`,專案 `My First Project`,
編號 263073074704),多開一個 scope。

`.env` 需要四個變數:

```
GSC_CLIENT_ID=(同 secrets/gbp-oauth-client.json 的 client_id)
GSC_CLIENT_SECRET=(同上,client_secret)
GSC_REFRESH_TOKEN=(一次性同意流程換到的,見下)
GSC_SITE_URL=sc-domain:sixiangjialaundry.com
```

## 一次性同意流程(已完成,重做才需要看這段)

1. 確認 `https://console.cloud.google.com/apis/library/searchconsole.googleapis.com`
   在 My First Project 底下顯示「已啟用」。
2. 用 GSC_CLIENT_ID/SECRET 起一個 localhost OAuth 流程,scope 是
   `https://www.googleapis.com/auth/webmasters.readonly`,`access_type=offline`
   `prompt=consent`。
3. 用 `cyc39211@gmail.com` 同意,寫入 GSC_REFRESH_TOKEN。
4. 若 invalid_grant:代表同意被收回,重跑第 2-3 步。

## 資料延遲(不是 bug)

GSC 的 Search Analytics 數字在當天結束後還會**滾動 2-3 天才穩定**。
`src/gscSearchAnalytics.ts` 因此**預設抓 3 天前**(`--date` 可覆蓋),
並且用查詢當天當檔名(`data/insights/gsc/<date>.json`),不是收集當天——
同一天的數字之後重抓也不會因為排程時間點不同而變動。

`totals` 一律走**無 dimension 的聚合查詢**,不是加總 `top_queries`——
GSC 對稀有查詢詞會做隱私過濾,只加總逐詞列表會低估真實總量
(`test/gscSearchAnalytics.test.ts` 有突變測試釘住這條)。

## 現況(2026-08-20 首次拉取,誠實記錄)

網站曝光量非常低:8/14-8/19 六天裡只有 8/18 有一筆非零紀錄
(品牌詞「私享家」曝光 1 次,三個頁面共曝光 6 次,零點擊,排名 7.5-12)。
這不是程式錯誤——API 呼叫方式已用非零值驗證過——而是網站才剛完成網域
驗證與 sitemap 提交,索引本來就需要時間累積。

## 排程

尚未加排程任務(2026-08-20 完成當下只驗證了手動執行)。下一步比照
`Laundry-GA4-Collect` 的模式加一個 `Laundry-GSC-Collect`,同樣排在
23:10 前後、預設抓 3 天前。
