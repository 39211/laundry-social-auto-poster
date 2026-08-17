# GBP API 接線:老闆的 5 分鐘 + 我的其餘全部

> 前提:GBP API 已核准(2026-08-16 核准信,案件 4-3697000041994)。
> Cloud 專案 `263073074704`,Business Information API 配額 300/日。
> 鐵則:token/secret 永不經過對話貼文;全部落在本機 `.env`(已 gitignore)。

## 你要做的(唯一需要你 Google 帳號的部分)

1. 開 https://console.cloud.google.com/apis/credentials?project=263073074704
2. 上方「+ 建立憑證」→「OAuth 用戶端 ID」
   - 若先要求設定「同意畫面」:User Type 選**外部**,應用程式名稱填「私享家貼文助手」,
     支援信箱選你的,其餘留白直接儲存;「測試使用者」加你自己的 Gmail。
3. 應用程式類型選「**電腦版應用程式**」,名稱「sixiangjia-gbp」→ 建立
4. 跳出的視窗按「下載 JSON」,把檔案存到:
   `C:\Users\cyc39\Documents\New project 5\secrets\gbp-oauth-client.json`
   (secrets/ 已在 .gitignore;沒有這個資料夾就建一個)
5. 跟我說「放好了」。

## 之後我接手(不用你)

- 寫 `scripts/gbp-authorize.mjs`(仿現有 `scripts/ga4-authorize.mjs` 的本機同意流程):
  你只要在跳出的瀏覽器按一次「允許」,refresh token 直接寫進 `.env` 的
  `GBP_REFRESH_TOKEN`,不顯示在畫面上。
- 寫 `src/gbpPost.ts`:週貼文(從當週最佳圖文改寫,CTA 帶 `go/line.html?source=gbp`)
  +回評草稿;掛排程(每週一 10:00 貼文、每日檢查新評論)。
- `data/gbp-reviews.json` 基準檔(星等/則數/週增),進每日進步帳。

## 額度與安全

- Business Information API 300/日,週貼文+回評用量 <10/日,離限很遠。
- scope 只申請 `https://www.googleapis.com/auth/business.manage`(最小必要)。
- client JSON 與 refresh token 都不進 git、不進 Vault、不進對話。

## 2026-08-18 凌晨增補:配額申請
- Account Management API 配額(Requests/min)預設 0;console 自助路對 GBP 家族封死。
- 已透過 GBP API Support 表單送出 Quota Increase Request:**案件 9-9473000041988**
  (API=Account Management;專案 263073074704;公司=私享家洗衣店;上次核准案 4-3697000041994 走了約 4 天)。
- 核准後煙測 `scratchpad/gbp-smoke.mjs` 應回 ACCOUNTS>=1,即抓 GBP_ACCOUNT_ID 入 .env,首篇週貼文照 v5 檢查單發。
