# 影片吸引力強化待辦(G1 深挖產出,2026-08-17)

來源:BOARD0817-VFP 偵查卷(grok,11/11 檔逐檔精讀,留底 `_bridge\runs\BOARD0817-VFP\`)。
規則:**一批只動一個變數**,對 `ig_reels_avg_watch_time`(基線 3.9s)與觀看數驗收。
目前進行中的批:全旁白字幕(8/17-19)。以下依「預期效果 × 成本」排序,逐批消化。

## 已在做/已對齊(不重複開批)

- zh-TW 在地音色(TECH14):產線已用 zh-TW-YunJheNeural 男聲 ✓
- hook 前 2 秒(TECH1 部分):hook 字卡 0-2.6s 已存在 ✓
- 直式 720x1280(TECH11 的反面教訓):產線原生直式 ✓

## 待開批(每批一變數)

| 批 | 技術(來源錨點) | 做法 | 驗收 | 成本 |
|---|---|---|---|---|
| B1 | 場次時長加權(TECH13,script.py 均分是反模式) | 治療結構再壓:hook 佔 30-40%、揭示 25%、過程擠中間;對照現行 4/6/4 | 完播率/停留 vs 現行治療 A | S |
| B2 | 標題/hook 公式(TECH8,topic.py 點開模板) | 概念 hook 引入「數字+反直覺」型:「3 種洗衣店不會講的漬」;新概念批寫入 | 觸及與點開(reach/views 比) | S |
| B3 | BGM 閃避(TECH5,templates 音量表) | 旁白段 BGM 低 8-12dB(sidechain 或分段 volume);現行 amix 無 duck | 停留;聽感抽查 | M |
| B4 | 鏡頭文法(TECH2,VISUAL_TEMPLATES) | development 段用左右分屏 髒/淨;climax 慢鏡揭示 | 停留曲線中段流失率 | M |
| B5 | 轉場紀律(TECH7) | 轉場中位數 ≤200ms、結尾不 fade_out(吃掉揭示幀);檢查現行 xfade 時長 | 尾段流失率 | S |
| B6 | 語速實驗(TECH9) | 現行 +8%;試 +12~15%(15s 塞 hook+揭示) | 停留、完播 | S |
| B7 | 場景色拍對比(TECH4) | before 暖污色/after 冷白高光的分級方向寫進生圖 prompt | 抽幀 ΔE 可辨;停留 | M |
| B8 | 一題多鉤 A/B(TECH12 的並行思想) | 同一概念產 2 條 hook 變體封面,發布端 A/B | 點開率差 | M |

## 不搬清單(已判定,勿回鍋)

composer 的假轉場/佔位圖/正弦波旁白/死欄位 bitrate/checkpoint 假續跑/exporters 報告層
(詳 run 留底 NOT_WORTH 節,53 行)。字幕引擎想法已採收自建,PlayRes 直式地雷已入 ERROR-BOOK。

## 追加(R4 船長稽核 + R6 視覺QA偵查,2026-08-17 02:30)

| 批 | 來源 | 做法 | 驗收 | 成本 |
|---|---|---|---|---|
| B9 | R4-TOP1+MOTIONSPEC | **分鏡真相化**:行事曆/freshness 停寫舊 REEL_MOTION_PROMPT,改寫真實分幕 prompt;12 個舊文概念按上播日分批重產 | 前 2 秒視線落點+停留;行事曆 prompt=實際 prompt | L |
| B10 | R4-TOP2 | 泛稱磨損改「部位事件」(膠邊氧化帶/提把握痕),寫進 before_subject 與靜圖 prompt | 首秒衝突可讀;1s 滑走率 | S-M |
| B11 | R4-TOP3 | 中段 [Core physics] 改當日可見機制(刷毛壓彎/濕痕邊界/泡沫停縫,禁魔法變乾淨) | 4-10s 中段流失率 | S |
| B12 | R6 | 兩道視覺 QA 閘(靜態閘先殺、成片閘幕感知抽幀),七軸 PASS/FAIL;**探針+校準先行,無鑑別力不上線** | suede 必 FAIL、新產健康片必 PASS | M |

R6 重要發現:白鞋等舊「健康」片中段換物件 —— 連戲病是舊庫系統病。綠例集用新分幕 prompt 產的片建,舊庫按重播日逐批重產+過閘。
