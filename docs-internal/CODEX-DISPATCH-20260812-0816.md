# 【Codex 五天派工單】2026-08-12 → 08-16 私享家產線接管

> 交接人:Claude(總指揮)。老闆這幾天換電腦,由 Codex 全權執行本單。
> 本單是唯一正本。與其他文件衝突時,以本單為準;本單沒寫的,照下方「鐵則」判斷。
> 工作目錄:`C:\Users\cyc39\Documents\New project 5`

---

## 零、系統現況一句話

發布鏈全自動(Task Scheduler),Day 1-2 連續全綠。Codex 的工作**不是重建,是看守+每日一件優化+處理本單排定的節點**。亂改控制面 = 最大風險。

## 一、鐵則(違反任何一條就是事故)

1. **表是正本**:`data/slot1-plan.json` 決定每天 slot1 主題。行事曆與表不符時,照表改行事曆,不是改表。
2. **改主題必須連 image_prompt 一起換,並親眼看生成圖**。只改文字不改 prompt = 文不配圖事故(已發生過一次,零容忍)。
3. **day-lock 流程**:改當天/明天內容前先刪 `data/day-locks/<date>.json`,改完+圖驗完立刻 `npm run day-lock -- --date <date>` 重鎖。鎖著的內容不准直接改。
4. **published = 不可重試**:`media_publish` 進 commit point 後任何錯誤都不准重發(NonRetryableError 機制已內建,不要繞過)。
5. **posted-log 是發布真相**,退出碼不是。判斷有沒有發成功,只看 `data/posted-log/<date>.json`。
6. **不碰控制面**:`scripts/watchdog-patrol.ps1`、`scripts/day-audit.ps1`、`src/autoApprove.ts`、fingerprints 機制、Task Scheduler 排程定義。要改必須先留單給老闆,等 Claude 回來審。
7. **驗證同源**:任何「完成」宣告都要有當場跑出來的證據(檔案存在+ffprobe 時長+親眼看圖/看幀)。
8. **PS 5.1 cp950 陷阱**:中文比對一律用 Python 單一程序做(讀檔+比對同一個程序內),不准經過 shell 管線傳中文。Write 出的 `.ps1` 含中文要補 UTF-8 BOM。
9. **一天只改一個變數**:內容優化根據 72 小時數據,每批只動一項,否則歸因全毀。
10. **時間以 PowerShell 為準**,bash 的時鐘在這台機器會偏移。

## 二、每天自動排程表(已註冊,Codex 只驗不跑)

| 時間 | 任務 | Codex 要做的 |
|---|---|---|
| 06:30 | Daily-Generate(生成當日圖文) | 07:30 前看一眼 `data/content-calendar/<今天>.json` 生出來沒 |
| 09:00 | 審核提醒 | 無 |
| 10:20/11:15 | Auto-Approve(閘門+核准) | 10:30 看 `data/approved-log/<今天>.json` 有 [1,2,3];沒有→讀 stdout 找哪個閘攔的 |
| 11:35 | slot1 圖文發布 | 12:00 看 posted-log |
| 12:05 | 中午 Reel 發布 | 同上 |
| 13:30/13:50 | 補跑鏈 | 無(它自己判斷) |
| 14:00 | Reel 生產(下一支素材) | 15:30 看 `output/reel-production-logs/<今天>.log` 尾部,新檔在 `output/reels-run/2026-07-29/reels/` |
| 20:35 | 晚間 Reel 發布 | 21:00 看 posted-log |
| 21:00/22:15 | YT Shorts 上傳 | 21:30 看 `data/youtube-log/<今天>.json` 兩筆 video_id |
| 22:50 | day-audit 結算 | 23:00 讀 `output/day-reports/<今天>.json`,`ok:false` 才動手 |
| 每 30 分 | watchdog 巡邏(含救援) | 無 |

**排錯順序**:day-report 的 `missing_posts` → 對應 log → 只有在 watchdog 兩輪(1 小時)沒救回來時才手動跑 `powershell -File scripts/catchup-publish.ps1`。

## 三、逐日任務(核心)

### 8/12(三)
- [ ] 例行看守(上表)。今日內容已備妥上鎖:slot1=午睡枕套(圖已驗)、中午=襯衫領 15s、晚間=白鞋 15s。
- [ ] **14:00 治療 A 首次實產**:今天生產的是治療 A(快節奏旁白)版本。產完後必驗:`ffprobe` 時長、聽 TTS 有沒有斷句錯誤、抽 3 幀親眼看(第 1 秒/第 4 秒/最後 1 秒)。治療對照表:`data/mid-treatment-plan.json`(8/12=A、8/13=B、8/14=C)。
- [ ] **16:00 一次性補產觸發會自己跑**(已註冊),驗證 `luggage-wheel-15s.mp4` 之外還產了什麼,對 `data/ab-test-plan.json` 檢查 8/15-16 素材齊不齊。
- [ ] 每日研究(常設):X 搜尋「洗鞋」「開學 洗衣」等關鍵詞 10 分鐘,發現可用鉤子就 append 進 `data/hooks-bank.json`(格式照現有條目)。
- [ ] 22:50 後把 day-report 濃縮三行回報老闆。

### 8/13(四)
- [ ] 例行看守。治療 B(第 4 秒給答案)生產與驗證,方法同上。
- [ ] **72h 數據迭代日**:跑 `npx tsx src/instagramInsights.ts --limit 6`,對照 8/10-11 各貼文的 reach/ig_reels_avg_watch_time。規則:哪支 watch-time 最高,把它的開頭句式(前 5 個字的結構)寫進 `data/hooks-bank.json` 置頂;**只改這一個變數**。
- [ ] 檢查 GSC 索引數:`npx tsx src/searchConsole.ts --report coverage`(若腳本不存在改用 GSC 網頁版,讀 sitemap 已提交/已索引數),記錄到 `output/seo-tracking.json`(date, submitted, indexed 三欄,append)。

### 8/14(五)
- [ ] 例行看守。治療 C(中段插入第二鉤)生產與驗證。
- [ ] **A/B 資料收官前檢查**:確認 8/12-14 三天的 posted-log 與 treatment manifest(`output/reels-run/2026-07-29/treatments/`)對得上——哪天發的是哪個治療,不能有含糊。
- [ ] 準備長片素材:`data/longform-ep1-spec.json` 的 `new_stills_needed` 四張特寫,用 Codex 圖像生成(風格規則照 `data/style-master.md`,**手機感、不准電影感**),存 `output/longform/ep1/stills/`,親眼驗每一張。

### 8/15(六)
- [ ] 例行看守。**15:00 長片生產觸發會自己跑**;若 produce 腳本不支援長片(它目前只做 Reel),就手動組裝:照 `content-playbooks/longform-ep1-script.md` 的六場腳本,用已有素材+新特寫,ffmpeg concat,TTS 旁白(聲音照 spec),目標 85-95 秒,9:16。
- [ ] **三治療首批數據**(8/12 的 A 已滿 72h?未滿就只看 24-48h 趨勢,不下結論):記進 `data/mid-treatment-results.json`(date, treatment, avg_watch_time, reach)。**8/17 才做裁決,不要提前**。
- [ ] 驗證 8/15 起統一 15s 的排程正確發布(中午+晚間都應是 15s 檔)。

### 8/16(日)
- [ ] 例行看守(週日店休,發布照常)。
- [ ] **長片 ep1 發布**:YT 正片(不是 Shorts)+ FB/IG。標題與描述照 `data/longform-ep1-spec.json` 的 yt 欄(渠道碼 `source=yt-long`)。上傳後親自打開連結驗證公開可看+描述六要素(參考價/至善國中/儲值/source=/電話/指南連結)——**驗證用 Python 單程序抓頁面比對,不要用 shell 管線**。
- [ ] 週結:五天 day-reports 彙整一頁給老闆(發布率/素材產出/治療初步觀察/索引數變化)。

## 四、影片生產規格(完整,照抄即可)

### 4.1 提示詞正本(不准另創)
- **場景 DNA**:`data/style-master.md` — 粉紅裁切墊+白條板牆+第三錨點按日期輪替;手機 15° 俯角;物件佔畫面高 35-50%;窗光主光;禁底片感/禁攝影棚感/禁可讀文字。
- **物件配方**:`data/object-recipes.md` — 每類物件的磨損詞彙(topic-bound wear:主題講什麼,磨損就長在哪)。
- **人設**(老闆選臉後才啟用):`data/persona-master.md` — 台灣男性 40 出頭、橢圓臉微方下顎、鬢角灰、單眼皮、深藍帆布圍裙。**選臉前影片一律不出人臉**。
- **三幕相機節拍**(已寫進 `scripts/produce-next-reel.ps1` 的 $actDirection,不用手動):before=push-to-defect / middle=hold-on-contact / after=pull-back-settle。

### 4.2 老闆選臉之後(若這幾天回覆 1/2/3)
1. 把 `data/reference-photos/persona-candidate-<N>.png` 複製為 `data/reference-photos/persona-locked.png`
2. 在 `data/persona-master.md` 末尾加一行:`LOCKED: candidate-<N>, <日期>`
3. **先做一支測試 Reel**(不發布):在生產 prompt 的人物段引用 persona-master 的 identity anchor 全文,產出後抽 5 幀驗臉一致性(同一人、同圍裙、鬢角灰位置一致)
4. 一致性通過才在下一天的正式生產啟用;不通過就記錄差異,回報老闆,**不強行上線**
5. 治療 A/B/C 測試期間(8/12-14)**不要同時**引入人設——一次一個變數

### 4.3 新素材生產(如需新概念)
概念清單與已產素材:`output/reels-run/2026-07-29/reels/`(檔名=conceptId)。新概念三張靜態(before/middle/after)生成規則:style-master 場景 + object-recipes 磨損 + 三幕構圖;中景是**純生成**(不做 img2img)。生成後必須人眼驗:同一物件、同一場景、光源方向一致。

## 五、發生這些事怎麼辦

| 狀況 | 動作 |
|---|---|
| 某 slot 沒發(day-report missing) | 等 watchdog 兩輪;沒救回→`scripts/catchup-publish.ps1`;再失敗→留單老闆,**不硬改** |
| 閘門攔截(approve 失敗) | 讀 stdout 判斷:重複閘→換開頭句;文不配圖→重生圖(鐵則 2);日期閘→查 day-lock |
| 圖生成失敗 | 重跑 `scripts/generate-missing-images.ps1 -Date <date>` 一次;再失敗記錄,當日 slot 用行事曆已有圖 |
| YT 上傳 401/403 | token 過期→留單老闆(OAuth 只有他能重授權),當日 YT 記缺口,不阻其他平台 |
| Meta API 5xx 或 network loss 在 media_publish 後 | **絕對不重試**,看 posted-log 與 IG 後台確認實際狀態 |
| 磁碟/OOM/超時警告 | 停止當前批次,不准擴大範圍重試 |

## 六、等老闆的四件(每天提醒一次,回了就執行對應動作)

1. **選臉 1/2/3** → 執行 4.2
2. **LINE OA 設定**(5 分鐘,教學:`docs-internal/line-oa-setup.md`)
3. **GBP API 申請**(逐字填答:`docs-internal/gbp-api-application.md`);申請前每週貼文照 `docs-internal/gbp-weekly-pack.md` 老闆手貼
4. **海報送印**:正式檔 `output/print/poster-A4-shoes-sixiangjia-v3.png`(私享家版)、`poster-A4-shoes-partner-v3.png`(同業版)。若老闆對 v3 仍有意見,記下逐字意見,**不要自行再設計**,留給 Claude 回來處理

## 七、不要做的事(明確負面清單)

- 不投廣告(A0 條件未觸發:`data/ads-playbook.json` 的 inquiry trigger 未達標)
- 不改 90 天計畫正本(`content-playbooks/2026-08-07-90day-full-plan.md`、`2026-08-11-master-architecture-v3.1.md`)
- 不新增/刪除 Task Scheduler 排程(本單已排好的一次性觸發除外)
- 不動 `_bridge/` 下任何東西
- 不把「瀏覽數/觸及」當成果回報——本案唯一北極星是 **line_click(GA4)與詢問數**
- 不因為「看起來沒問題」跳過親眼驗圖/驗幀

## 八、每日回報格式(貼給老闆,三行)

```
8/1X:發布 N/N(缺口:無|哪個+原因),YT N/2,治療X產出已驗
數據:昨日最佳=<主題>(watch Xs / reach N),今日改的一個變數=<什麼>
等你:<四件裡還沒回的>
```
