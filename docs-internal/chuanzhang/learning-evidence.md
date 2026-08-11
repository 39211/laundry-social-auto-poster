# 船長AI視界 → 私享家:學習移植對照表(證據版)

回答老闆的質疑:「你到底有沒有讀?學了沒有?影片有沒有進步?」
逐條列出:**學到什麼 → 改在哪個檔案 → 改前 vs 改後**。全部可用 git log 驗證。

## 一、七個模組全文已讀的證據
- 精讀報告(45 條技法+20 條可貼片段,逐條標出處檔名):`docs-internal/chuanzhang/digest.md`
- 該報告由 Grok 通宵逐檔精讀 skills/ 下 7 模組全部 references 與 templates 產出

## 二、已經用進產線的(改前 vs 改後)

### 1. 圖片提示詞(船長「真人感變數」+「拍攝簡報式寫法」)
**改前**(generic,7/20 版):
> Shot on a phone by shop staff... ordinary Taiwanese shop interior with tiled floor and metal racks, fluorescent ceiling light mixed with daylight...

**改後**(style master v2,8/11 版,src/contentPlan.ts phoneRealism):
> Shot on a phone, slightly high handheld angle looking down about 15 degrees, the featured object filling roughly 35-50% of the frame height... Scene: a light counter with a PINK CUTTING MAT, white slat-wall panels behind, [三選一背景錨按日輪替]... Key light from the storefront window on one side, fluorescent ceiling fill, gentle shadow falloff...

**用了船長的哪條**:鏡頭寫成「可見效果」(digest B-19/20)、光線=方向+質地+落點(E-31)、一景深一光一色調(E-33)、場景鎖定自己店的實景(風格母版概念)
**看得到的差別**:8/10 前的圖=隨機洗衣店;8/11 書包圖=你店的粉紅切割墊+溝槽牆+掛衣架,背帶汗漬在船長式「污損寫在具體位置」的指定點上

### 2. 影片三幕分鏡(船長「分鏡+情緒融合」)
**改前**:三段共用同一句 "an extremely gentle push-in with slight natural handheld shake"
**改後**(scripts/produce-next-reel.ps1,8/11):
- 第一幕:推進到「主題講的那個磨損處」收框 —— 前兩秒眼睛落在問題上(digest F-37 前5秒建規則)
- 中段:鏡頭幾乎不動,咬住工具與物件的接觸點,接觸陰影跟著移動、五指解剖正確(digest B-12/13、片段3/4)
- 第三幕:輕拉開讓乾淨物件落定,末幀穩定(digest C-17 運鏡綁節拍、完成即停)
- 三幕都鎖焦:「focal plane locked from first frame to last, no focus drift」(digest 片段1)

### 3. 中景圖生成(船長「道具句柄寫狀態」)
**改前**:提示詞自相矛盾(叫它別讀檔又叫它編輯參考圖)→ 連續三天交白卷
**改後**:純生成+狀態描述(partial cleaning progress at a specific spot、hand and tool entering in a natural work moment)→ 8/10 起三次實測全成功

### 4. 手入鏡規範(船長 portrait-planning)
已入 `data/object-recipes.md`:五指完整、右手動作左手穩定、動作正在發生(布剛壓下、拉鍊拉一半)

## 三、還沒用進去的(誠實列出,排進架構)
- 分鏡六道 Gate(先確認資產/位置/時間劃分再寫提示詞)→ 排入影片產線 v3
- 風格四段前置(【全局畫質】【人物材質】【燈光風格】【核心特效】)→ 影片提示詞層
- 情緒因果鏈五步(trigger→goal→obstacle→strategy→subtext)降階到「手+物件」→ 旁白改版用
- 音效三層(環境/Foley/表演)→ 目前 TTS 蓋全場,待留存數據指路後試

## 四、下一步的量測(證明「有進步」要用數字)
新素材(8/12 起)vs 舊素材:平均觀看秒數(已開始收 ig_reels_avg_watch_time,基線=4.2秒)、完成率(基線 10s=43%/15s=30%)、收藏+分享(基線=0)
