先對照洗衣店圖片 skill 與既有提示詞慣例，再對這段模板做紅隊拆解。# 紅隊報告：`PHONE_REALISM` 提示詞模板

---

## 1) 會讓圖看起來假的殘留問題

| # | 問題 | 為何假 | 修正建議 |
|---|------|--------|----------|
| 1.1 | 「subtle film grain」＋「phone JPEG 語感」疊加 | 真手機是陰影區亮度噪點／輕微色噪，不是 Portra 均勻膠片顆粒。模型常整圖灑一層 gritty overlay，IG 一刷就認 AI。 | 刪 film grain。改：`phone sensor noise only in deep shadows, clean midtones, no film grain overlay` |
| 1.2 | 「Kodak Portra 400 inspired warm tone」當唯一色調錨 | Portra 暖調是「精修／廣告／電影感」捷徑；跟「店內螢光燈偏綠」的真實台中店面衝突，易出奶油膚色＋假懷舊。 | 改雙色溫描述：`daylight from window (slightly cool) + ceiling fluorescent (faint green-magenta cast), imperfect phone auto white balance, not a film LUT` |
| 1.3 | 「gentle shadow falloff, natural highlight roll-off」 | 典型 AI 寫實黑話；模型會把中間調抹平、高光像空氣刷過，缺硬邊接觸、缺反射。 | 刪這兩句。改具體光學行為：`hard contact shadow under the object on the mat; soft ambient fill from the mat bounce; window side brighter than shop depth` |
| 1.4 | 磨損清單 `dust, scuffs, creases or slight discolouration` | 模型常**全套套用**，變成「做舊道具」而非單一使用痕跡。 | 磨損只留一句錨：`only the wear the topic names; do not add extra damage`。具體類型丟給 topic 層，不在 master 列清單 |
| 1.5 | 「believable weight」太抽象 | 模型不懂質量；物常略浮、陰影與底座脫節。 | 改可驗條件：`object rests fully on the mat with continuous contact shadow; no floating rim light; base edge occludes the mat texture` |
| 1.6 | 「visible material grain」＋場景材質混用 | 布料、塑膠袋、墊板一齊「grain」會糊成同一層噪點皮。 | 分材質：`fabric weave / leather pores / rubber sole texture only on the featured item; mat is smooth PVC; garment bags are thin translucent PE` |
| 1.7 | 場景永遠同一套 DNA（粉墊＋百葉牆＋衣架輸送） | 每帖同構圖同背景＝流水線合成，人眼與演算法都當「模板圖」。 | master 只鎖 1–2 個店內錨點；第三錨改輪替：`counter+mat` 固定，背景在 `conveyor / metal rack / tiled floor edge / partial steam area` 輪換（由 slot 注入） |
| 1.8 | 「everyday Taiwanese laundry shop clutter」無列舉 | 模型補西式 laundry basket、假中文立牌、家用洗衣機，反而更假。 | 白名單＋黑名單：`ok: hangers, receipt roll, soft brush, microfiber cloth, tagged garment bag edge`；`never: laundry basket as hero, washing machine, boutique plant wall, marble vanity` |
| 1.9 | 主體銳利＋背景「柔」但無距離層級 | 易出 AI 奶油 bokeh、主體像扣圖貼上。 | 寫距離：`subject 40–70cm from lens; background elements 1.5–3m back; depth from distance not from fake bokeh discs` |
| 1.10 | 缺「手機運算攝影」特徵 | 真店家 iPhone／Android：邊緣過銳、輕微 HDR 壓高光、窗常微爆。現模板追求「完美 roll-off」反而像相機廣告。 | 加：`slight phone HDR, window highlights may clip a little, mild edge sharpening, not perfect exposure` |

---

## 2) 自相矛盾的指令

| # | 矛盾對 | 模型會怎麼崩 | 修正建議 |
|---|--------|--------------|----------|
| 2.1 | `Shot on a phone` **vs** `35mm documentary perspective` | 手機主鏡頭約 24–26mm 等效；「35mm documentary」拉向底片／報導鏡頭語言，輸出常成混合體：手機構圖＋偽底片景深。 | 二選一。社群店拍建議：`shot on a phone main camera, ~26mm equivalent, documentary casual framing`。刪「35mm」。 |
| 2.2 | `f/2.8 feel` ＋ `background still recognizable` **vs** `softly blurred` **vs** `no artificial background blur` | 三指令互咬。模型要嘛全糊（AI 簽名），要嘛全清，要嘛忽略 negative。 | 整併成一句：`shallow but modest depth of field: subject sharp, background readable (not creamy bokeh, no orb blur)`。刪 `softly blurred` 與 `no artificial background blur` 的對打寫法。 |
| 2.3 | `plastic-covered clothes` **vs** `no plastic or waxy surfaces` | 背景明確要塑膠衣套，negative 又禁 plastic → 衣套變蠟、布、或消失。 | 收窄 negative：`no waxy or melted-looking materials on the featured item; background garment poly bags OK as thin translucent plastic` |
| 2.4 | `Kodak Portra 400` ＋ grain **vs** `Not editorial, not cinematic` | Portra／grain／roll-off 就是電影／編輯色票訊號；negative 擋不住正面錨的權重。 | 刪 Portra 與 cinematic 相關正面詞；negative 保留 `not editorial, not cinematic` 即可。 |
| 2.5 | `Not studio lighting` **vs** 精密燈光配方（雙光源＋falloff＋roll-off） | 讀起來仍是棚燈方案，模型出「很軟的產品棚燈」。 | 燈光改「失敗的真實」：`uneven store light, one side of counter brighter, ceiling fluorescent slightly ugly, not a softbox setup` |
| 2.6 | `honest everyday use - dust, scuffs, creases or…` **vs** `exactly where the topic describes them` | 破折號清單＝預設全要；後面又說跟 topic 對齊 → 常「全要＋位置亂貼」。 | 刪列舉。寫：`wear limited to what the topic states; if topic states none, light natural use only (not pristine, not trashed)` |
| 2.7 | 高度設計的固定場景 **vs** 紀實／非編輯 | 固定英雄台＝靜物棚拍 DNA，跟 documentary 口號對沖。 | 加紀實構圖約束：`slightly messy framing, subject not perfectly centered, one edge of mat may be cut off`（你們已有 handheld，但缺「裁切不完美」的具體化） |

---

## 3) 缺的關鍵攝影變數

現模板有：大致景深感覺、場景道具、混合光口頭描述、色調錨、磨損、一串 negative。  
缺這些（對「像店員隨手拍」影響最大）：

| # | 缺的變數 | 為何關鍵 | 建議補上的寫法（可進 master 或 slot 層） |
|---|----------|----------|----------------------------------------|
| 3.1 | **長寬比／構圖框** | 方圖／4:5／9:16 構圖邏輯不同；缺了模型亂裁。 | 由 format 前綴負責且不可省：`square 1:1` / `portrait 4:5` / `vertical 9:16` |
| 3.2 | **機位高度與俯仰** | 店內手機多半站姿略俯看櫃面；平視桌面易變電商。 | `phone held at chest height, 20–35° looking down at the counter` |
| 3.3 | **主體佔比** | 無比例 → 常變居中小物或極端特寫。 | `featured item fills ~45–65% of frame` |
| 3.4 | **正確等效焦段** | 見 2.1 | `~24–28mm phone wide, slight edge distortion OK` |
| 3.5 | **主光方向優先** | 「window + fluorescent」無主次 → 平光、無體積。 | `key: storefront window from camera-left; fill: weak ceiling fluorescent; no rim light` |
| 3.6 | **時段／窗光狀態** | 同店早晚色溫差很大；不寫就永遠「柔美窗光」。 | slot 注入：`overcast midday` / `late afternoon warm window` / `after dark, fluorescent only` |
| 3.7 | **人／手是否入鏡** | 純物靜置＝產品圖；店員手是真實度最強訊號之一。 | 依內容：`no full person` 可；但 care 類加 `partial hand or tool entering from frame edge`（非每帖強制） |
| 3.8 | **主體方位** | 無 3/4、頂視等 → 預設正面商品照。 | `3/4 view, not dead-on catalog frontality`（鞋／包尤其） |
| 3.9 | **尺度參照** | 無手／工具時，鞋包大小常失真。 | `include a known shop tool for scale when no hand` |
| 3.10 | **材質光學（高光類型）** | 只禁 waxy 不夠；皮革／膠底／布的反光規則不同。 | 在 topic 層寫材質：`matte canvas / oily leather sheen only in highlights / rubber not glossy plastic` |
| 3.11 | **背景可讀文字策略** | `no readable text` 過寬：衣物吊牌、螢光燈反光字、輸送帶標都可能被「抹成亂碼」——亂碼比沒字更像 AI。 | 改：`no legible logos, signage, or labels; if tags exist, keep them out of focus or cropped, no gibberish glyphs` |
| 3.12 | **前景／中景／背景分層** | 只有「邊緣 clutter」→ clutter 亂長在主體上。 | `midground: item on pink mat; background: wall + conveyor; clutter only at extreme edges, not overlapping the hero` |

---

## 4) 會觸發平台限流／降流的風險

此處「平台」以 **Meta／IG 分發** 為主，並附 **生圖 API 安全／配額** 側車風險。

| # | 風險 | 機制 | 修正建議 |
|---|------|------|----------|
| 4.1 | **視覺指紋重複** | 每日同粉墊＋同牆＋同輸送帶＋同暖調＝近複製貼圖；IG 對低原創、高相似媒體降觸及。 | 固定最多 2 錨；角度、時段、背景第三錨、是否有手，每日強制差分（程式層 rotate，不靠模型自由發揮） |
| 4.2 | **「AI 美感簇」特徵過密** | Portra＋grain＋柔光＋完美靜物是 2024–26 合成圖高頻特徵；與「原生手機貼文」分布偏離。 | 刪 Portra／grain／roll-off；改醜一點的店燈與手機 HDR（見 1.x） |
| 4.3 | **零人物、零動作的靜物連發** | 純商品靜物序列像型錄／廣告庫，完播與互動差 → 後續觸及被壓。 | 內容輪替：靜物／局部手部作業／工具＋物；Reel 封面不要與 feed 靜物同構圖 |
| 4.4 | **長 negative 清單仍出假 logo／亂碼字** | 亂碼中文、假店名一出，檢舉與「誤導商業」風險上升；也像垃圾圖。 | 見 3.11；出圖後硬驗：OCR 有字就重跑或裁掉（你們 validate 流程應擋） |
| 4.5 | **品牌名 `Kodak Portra 400`** | 生圖端偶發品牌／風格詞過濾或改寫；不是 Meta 限流主因，但會讓批次失敗重試→撞 API rate。 | 刪品牌名；用行為描述色溫即可 |
| 4.6 | **過度「同一 prompt 骨架」批次生圖** | 短時間大量近同 prompt → 生圖服務 429；發文端若排程過密＋媒體極相似，也像自動化。 | 每 slot 至少改 3 個可控變數（角度／背景錨／時段）；發文間隔維持現有 scheduler，勿為補圖爆量連打 |
| 4.7 | **磨損描寫過狠或像「損壞商品」展示** | 一般洗衣內容風險低；若 topic 碰到精品包嚴重毀損特寫，較易被當低質／引爭議，非典型限流但傷信任。 | 磨損跟 caption 一致且克制；hero 不要「全毀展示」 |
| 4.8 | **`no oversaturated colors` 單獨無力** | 模型仍可能高飽和粉墊＋暖 LUT；高飽和網美風在本地生活帳會被當廣告。 | 加可測描述：`muted real store colors, pink mat not neon, whites slightly warm-gray not pure RGB white` |

---

## 建議重寫骨架（合併以上，仍保持可進 `PHONE_REALISM`）

以下是去矛盾後的 master 方向（非完整 production 文案，是紅隊結論的可直接改版形）：

```text
Shot on a phone main camera (~26mm), chest height, 20–35° down at the counter,
handheld with slight imperfect framing (subject not perfectly centered; mat edge may clip).
Modest depth of field: featured item sharp and fills ~45–65% of frame;
background still readable from distance, no creamy bokeh orbs.
Scene anchors: light counter, pink cutting mat; white slat-wall; one background shop element
(garment conveyor with thin translucent poly-covered clothes OR metal rack OR tiled floor edge).
Everyday shop-edge clutter only (hangers, cloth, soft brush) — never a laundry basket as hero.
Light: window as key from one side, weak fluorescent fill with faint green cast,
uneven brightness, slight phone HDR, window highlights may clip a little;
imperfect auto white balance. No film LUT, no film grain (shadow phone noise only).
Featured item: honest use limited to what the topic states; full contact with mat and
continuous contact shadow; real material texture for that item only; must not look brand-new
or freshly styled. Not editorial, not cinematic, not softbox studio.
No waxy/melted surfaces on the hero; no fake logos; no legible signage or labels
(no gibberish text); no watermark; no boutique/showroom look.
```

**格式／時段／第三背景錨／是否入手** 不要塞進這段 master——用 slot 注入，否則又走回「每日同一張假照片」。

---

## 優先砍／改（影響最大的 5 刀）

1. **刪** `35mm`、`Kodak Portra 400`、`subtle film grain`、`highlight roll-off`  
2. **拆開** plastic：背景衣套允許／hero 禁 waxy  
3. **景深三句合一**，消滅 blur 自我矛盾  
4. **磨損列舉移出 master**，改 topic 綁定  
5. **補** 機位俯角、主體佔比、主光方向、亂碼字策略；**背景第三錨輪替** 防 Meta 降流  

以上可直接當 `contentPlan.ts` 的 `PHONE_REALISM` 改版 checklist；若要我依此改程式碼並跑 `imagePromptRealism` 測試，再說一聲。
