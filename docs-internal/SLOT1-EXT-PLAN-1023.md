# Slot 1 外延題材與格式試驗（2026-10-23 至 2026-11-05）

## 編輯題材

在 data/slot1-plan-ext.json 以日期為 key 新增或修改一筆，欄位如下：

- topic：早上圖的問句標題。
- format：carousel 或 single。
- family：home-textile、season-weather、pickup-delivery、shoes 或 luxury-leather。
- object：寫明早上圖與影片要拍的同一件具體物件。
- note：選填。
- needs_review：選填的布林值；精品品牌與型號待人工核對時設為 true。

改完先確認日期連續、格式交替、任意七日的家族配比，以及題目沒有和近 60 天題目重複。單圖日會保留一筆封面 carousel_items 作為圖片來源，但輸出 media_type: image，不輸出 media_package。

## 已有鎖檔

若該日期已經有 data/day-locks/YYYY-MM-DD.json，先確認可以重建該日，再刪除該日鎖檔並重新產生日曆。src/dayLock.ts 的 healDay 會把鎖檔中的完整舊 slot 1 還原；只改計畫檔不會換掉已鎖題目。此工作不會刪除或重生任何既有鎖檔。

## 排程期限

2026-10-23 的貼文最晚必須在 **2026-10-20 21:40（台灣時間）**前定案，供 Meta 排 D+3。

## 回退

刪除 data/slot1-plan-ext.json 與 data/slot1-format-experiment.json，生成器就回到原先的輪替／舊計畫行為；既有鎖檔仍會按原樣生效。

## 已知限制

- 這是 14 天、每格式 7 篇的小樣本，只適合方向判讀；成效需等 card_check 的 72 小時觸及快照。
- 單圖資料會按發布端目前的 image/photo 分流建構，但本工作沒有執行 Meta 發布，也沒有 live API 驗證。
- 單圖鎖檔只按 DayLock.slot1: DailySlot 的結構生成；heal 是完整 slot JSON 比對及還原，這裡沒有修改或實跑既有鎖檔。
- Chanel Classic Flap 與 Gucci Jackie 1961 型號欄位標為 needs_review: true，定案前須人工核對。
