# 私享家影片製作 LOOP

## 模型路由

Grok 4.5 是這個影片專案的主責：研究收斂、劇本、導演、逐鏡、生成提示與剪輯版本都先由它定稿。GPT-5.6 Sol 只做複審、官方事實／政策查核、檔案一致性驗證與安全套用；若複審發現問題，回交 Grok 4.5 改主稿，不由 Sol 另寫一套創意。真正的影片素材使用 Grok Imagine Video 1.5，語音使用 xAI TTS；文字模型 Grok 4.5 不等於影片或語音模型。

## 狀態機

`idea → researched → script_locked → timed → shot_locked → assets_locked → generating_or_shooting → rough_cut → sound_and_captions → qa → approved → published → measured → learned`

任何階段未過 gate 就回上一階段修正，不用剪輯或更多生成掩蓋劇本問題。

## 0. Business truth gate

先建立可說與不可說清單：服務區域、收送條件、可處理品項、交期、可能結果、品牌名稱、聯絡方式。案例物件要有物主同意；客人臉、住址、LINE 畫面、車牌與收件單個資先決定如何避開或遮蔽。

通過條件：每一句服務主張都能指向業主確認或真實流程。

## 1. Research gate

每個題材至少看三類來源：同業／服務案例、電影或廣告敘事、平台原生格式。只摘可執行的做法，不直接抄創意或台詞。將平台自報數字、商業案例與社群經驗分開標示。

通過條件：能回答「這支片與上一支有何不同」及「為何觀眾會在意」。

## 1A. Item profile gate

先從 `src/videoItemProfiles.ts` 判定一個主類別：`clothing`、`shoes`、`bags`、`bedding` 或 `leather`。每支影片必須同步記錄物件類別、材質觀察錨點、允許的單一動作、禁用宣稱與主要 KPI；若同一支同時有兩個主物件，拆成兩支或改成「送洗前分開拍」的情境，不把兩種材質混在同一個清潔承諾裡。

通過條件：前一秒看得到該類別的具體部位，提示詞含有 profile directive，首幀與腳本的物件類別一致，且 CTA 只對應一個主要行動。

## 2. Script lock

先寫無秒數版：

```text
Logline = 誰 + 想要什麼 + 阻力 + 失敗代價
Opening image = 問題已經可見
Turn = 主角做出選擇
Proof = 私享家做出可驗證行為
Payoff = 主角或物件的狀態改變
Closing image = 與開場形成對照
CTA = 一個下一步
```

每段 action 只能寫看得到或聽得到的事。形容詞若無法轉成光線、動作、構圖、材質或聲音，就刪掉。

通過條件：遮掉旁白後，仍能用分鏡說出故事。

## 3. Timing gate

由真人朗讀或 TTS 草讀，加上走位、停頓、物件操作與 CTA 停留時間，做三次排演。取自然版本，不把旁白加速塞進預設秒數。記錄：

- 語音實際長度。
- 無台詞動作所需時間。
- 觀眾看清洗標、污漬或 CTA 的最低停留。
- 需要 room tone 的呼吸段。

通過條件：得到故事自然片長與可接受浮動範圍。

## 4. Shot lock

每鏡必填：purpose、visual、action、camera、sound、continuity、source、constraints、fallback、acceptance。生成模型若一次只能做 6 或 10 秒，就生成可剪素材，再取劇本需要的 2.7 或 4.8 秒；不能反向把故事硬湊成固定區塊。

通過條件：沒有「只是好看、沒有敘事功能」的鏡頭。

## 5. Source map

依可信度分配來源：

1. 證據：門市、職人、顧客、收送、清潔、前後狀態，一律實拍。
2. 說明：真實 UI、圖卡、字幕、示意線條，可由後期完成。
3. 情境：非人物轉場、物件隱喻、無法補拍的環境，可由 Codex 首幀＋Grok 動畫，但不得冒充案例。

通過條件：每個 AI 鏡頭都能回答「若觀眾知道它是 AI，是否仍不傷害主張」。

## 6. Asset lock

先拍角色、物件、場景 reference pack：正面、左右 45 度、背面、手部、材質、重要瑕疵、場景廣角與光源。Codex 只據此做預視或 AI 鏡頭首幀。生成前鎖定固定描述、服裝、配色、道具方向和鏡頭軸線。

通過條件：同一人物與物件有足夠多角度，不靠文字猜外觀。

## 7. Shoot／Generate loop

```text
for each shot in shot_plan:
    take_or_generate v01
    technical_check(duration, resolution, codec, decode)
    story_check(purpose, action, emotion)
    realism_check(hands, physics, weight, light, focus, text, logos)
    continuity_check(identity, prop_position, screen_direction, time_of_day)
    if accepted:
        freeze asset and record provenance
    else:
        change one variable only
        create v02; never overwrite v01
```

Grok 消費者網站由人手動上傳、送出與下載。若改走官方 API，必須先取得 xAI API 金鑰與單獨付費確認；不使用 cookie、token 或瀏覽器機器人繞過消費者服務限制。

通過條件：素材有版本、來源、提示、日期、技術檢查與接受理由。

## 8. Rough cut gate

先用 production sound 與 room tone 剪無旁白版；再調整鏡頭長度、視線方向、動作接點。若內容依賴旁白才能理解，先回 script／shot，而不是加更多字幕。

通過條件：靜音觀看仍能辨識問題、服務與結果。

## 9. TTS、字幕與聲音

1. 真實人物說話優先保留；旁白才評估真人或 xAI TTS。
2. TTS 分段輸出並取得 timestamps，避免整段重做。
3. 繁中字幕每行盡量不超過 16 個中文字、最多兩行，斷在語意單位。
4. 旁白出現時音樂 ducking；刷毛、蒸氣、紙張、門鈴等真實聲音保留。
5. 先做無音樂版本驗收，避免音樂掩蓋空洞畫面。

通過條件：聽不出機械式連續語調，字幕不遮物件與平台 UI，聲音不暗示不存在的工序。

## 10. Final QA

- 事實：服務、區域、流程、CTA、聯絡方式無誤。
- 影像：無融手、變形五金、亂碼、假 logo、錯誤污漬消失、跳軸。
- 聲音：對嘴、環境、旁白、字幕時間一致。
- 技術：9:16、H.264／AAC、完整 decode、無黑幀、safe zone。
- 權利：人物／物件／音樂／場地可用，AI 來源與平台揭露保留。
- 品牌：不誇大、不恐嚇、不假裝官方精品合作。

## 11. Publish／Learn loop

每支母片最多先做三個 A/B 開場，一次只改一個主變因。48–72 小時記初步留存，七天記 LINE 有效詢問與成交。將勝負原因寫成下一支的「可重複假設」，不是把整支影片複製換物件。

## 檔名規則

`{project}_{shot}_{source}_{version}_{status}.{ext}`

例如：`pickup01_s06_real_v03_accepted.mov`、`pickup01_g01_grok_v02_rejected.mp4`。accepted 素材不可覆寫；重試一定升版。
