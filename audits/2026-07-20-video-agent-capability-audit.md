# 私享家影片 Agent、資料、驗證與路由稽核

日期：2026-07-20

## 判決

- 多 Agent 系統：先前不存在。本次稽核才首次建立三個 Sol-only唯讀分工；它們沒有永久知識，必須靠版本化knowledge pack與測驗才能取得審查資格。
- 知識注入：先前不存在。`.agents/skills`只有日常自動化、洗衣文案、洗衣圖片與Meta發布；沒有影片專業技能。
- 資料量：目前不能證明1500＋500＋500。舊run的Markdown/JSON只抽到21個不完全乾淨的唯一URL；研究ledgers雖有多小時素材，但沒有統一registry、去重、來源分級與規則對應。
- APK：目前工作區沒有APK、AndroidManifest或Gradle Android專案；不能宣稱已把研究整合到APK。
- 對客影片：只有C01通過、C02 V1/V2拒絕；C03–C08、正式尾卡與38.632秒母片不存在。

## 瀏覽器與外部模型事實

- 本輪稽核與最近C01/C02製片沒有操作grok.com或chatgpt.com瀏覽器，也沒有使用GPT Pro。
- 最近影片由manifest送到`grok-imagine-video-1.5`；job record保存request ID、一次submit、poll、download與技術QC。
- 歷史資料夾確實有`09-grok-adversarial-review.md`與`16-gpt-pro-final-review.md`，後者含ChatGPT Pro瀏覽器對話連結。因此只能說「本輪沒用」，不能否認過去專案記錄曾使用外部瀏覽器複審。
- 歷史外部複審多為摘要，缺完整可重播原始輸出，不能視為充分審計證據。

## 已真正驗證

- Grok job具有idempotency key、prompt hash、input hash、request ID、實際model、submit/poll/download次數與技術QC。
- 管線以ffprobe檢查解析度、方向、時長、codec，並執行完整decode。
- C01正規化素材為720×1280、24fps、6.000秒、無音軌。
- 新版TTS為35.832秒、MP3、24kHz、mono。
- 舊內部母片為1080×1920、30fps、AAC 48kHz、38.766秒；它不是新版對客母片。

## 尚未驗證

- C01沒有完整24fps frame＋PTS＋逐格問題帳本；contact sheet只能快速抽查。
- 沒有n≥5盲測、AI辨識率、手部異常率、跨幀漂移分數或真人實拍對照組。
- 沒有客人導向廣告的Meta A/B、2/6秒觀看、四分位完播、CTR、訊息開啟、有效諮詢或成本資料。
- 沒有本run可一鍵重建母片的EDL／filter graph／混音與安全區證據。
- 沒有正式Logo、聯絡CTA、門市確認與發布批准。

## 新增的硬性路由Gate

xAI AUP自2026-06-26禁止以程式或bot等非人工方式存取消費者服務。Hermes OAuth技術上能成功取得憑證並送出影片，但成功不等於條款允許。取得xAI書面允許或改用明確核准的官方API／企業合約前，後續Hermes consumer OAuth自動生成狀態為`LEGAL_TERMS_NO_GO`。

## 建立的修復基礎

- 新技能：`.agents/skills/sixiangjia-video-evidence/`
- 來源政策、evidence schema、完整驗證rubric與registry validator。
- 基線registry：`research/video-knowledge/evidence.jsonl`
- knowledge pack manifest明確標示`baseline_only_not_complete`，禁止虛報完成數量。

## 下一個可驗證里程碑

1. 驗證registry與skill格式。
2. 建立完整24fps frame/PTS ledger工具與C01/C02回歸fixture。
3. 完成首批150筆去重evidence units並做域覆蓋與10%雙重複核。
4. 為影片研究、劇本／戲劇結構、導演、拍攝腳本、材質、生成、QA與成效角色建立資格測驗；未達90%不得審批。
5. 釐清合法Grok生成路由後才繼續C03–C08。
