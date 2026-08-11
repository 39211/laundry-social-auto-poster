# 30個direct案例蒸餾：私享家待驗證的Codex＋豆包／Seedance製片假設

## 核心結論

Codex不應扮演「一句prompt生整片」的角色。它最有價值的位置是：管理劇本與版本、拆分語意／物理事件、組織reference與manifest、保存生成紀錄、讀取失敗、建立回歸規則，以及協調剪輯與QA。

Seedance類影片模型最適合處理看得見的動作、表演、光線、物理與鏡頭連續；角色慾望、心理轉折、伏筆、笑點、品牌承諾、清潔事實與因果結局必須由劇本和專業角色固定。

## 三十條待驗證假設

1. **劇本先於prompt。** 先鎖人物、欲望、阻礙、衝突、轉折、行動與結局，再派生導演方案與生成描述。
2. **語意事件與物理事件分離。** 語意事件明確寫死；物理事件給模型適度自由，避免過度微操。
3. **每個artifact只有一個owner。** 統籌不能改稿，導演不能偷改劇情，生成Agent不能自改prompt，QA不能修自己的受測素材。
4. **reference必須分工。** 每張圖、影片與音訊只負責明確的identity、environment、motion、camera或audio角色。
5. **先核首幀，再核raw clip。** 首幀只是生成token的前提，不是成片通過。
6. **一個raw clip只承載一個主要可觀察事件。** 多個心理與因果節點先拆鏡。
7. **已接受素材才是continuity真相。** 下一段以接受take的末狀態為起點，不以原始prompt想像狀態。
8. **同一場建立三版候選。** Model-led、hybrid、fully-fixed三版比較，記錄哪一種在哪類事件最穩。
9. **每次retake只改一個主要變數。** 否則無法知道改善原因，也無法累積經驗。
10. **多take和廢片率必須進預算。** Hero take常需多次生成；把不可用片比例與實際成本寫進ledger。
11. **文字、Logo、CTA與精準字幕留給確定性後製。** 不要求生成模型在畫面中寫正確繁中。
12. **聲音是獨立製作線。** 對白、TTS、口型、環境、SFX、BGM與混音分層；native audio也必須另驗。
13. **prompt成功不等於影片成功。** 需要正常速度人審、完整source-fps逐幀、PTS、物理、連戲、手部、材質、聲音與provenance。
14. **真實品牌證據優先。** 網路示意、AI reference與生成物不能冒充私享家門市、職人、物件、案例或before/after。
15. **把成功與失敗寫回規則。** 保存prompt、reference、input/output hash、成本、take結果、失敗taxonomy、修正版與最終採用原因。
16. **靜態幾何與動態敘事分開。** 先固定站位、視線、遮擋、深度、物件座標與工具距離，再指定單一主要動作。
17. **劇本、角色資產與物件資產各自批准。** 任一尚未核准，都不能因其他階段完成而跳過。
18. **片長來自內容與聲音量測。** 鎖定必要文案後以正常語速TTS／走戲量測，再配置鏡長；模型最小輸出只影響raw素材切取。
19. **視覺 EDL 先鎖，最終音軌後建。** 長片不應讓每段 native audio 各自為政；先接受視覺 take 與裁點，再從初始分鏡＋edit facts 重建最終音訊分鏡（CSD-41）。
20. **Disposable subagent 審片。** 主線不塞 contact sheet；分段 QA 與最終組接各用一次性子代理，回傳文字 verdict／EDL，用完即棄（CSD-41）。
21. **Keyframe 便宜審、I2V 付費。** 先生成並審靜態 keyframe／storyboard still，通過後才做 Seedance I2V（CSD-47）。
22. **Character sheet 一次、跨 beat 重用。** 人物 identity 在分鏡 frontmatter 固定，不在每鏡重發明（CSD-47）。
23. **Prompt 結構來自真實 corpus。** 搜 Seedance 社群骨架（時間戳／散文／結構化 header），只借結構不抄字面（CSD-43）。
24. **Storyboard prompt 與 video prompt 分產。** 圖像分鏡提示與 Seedance 執行提示分技能、分輸出、分驗收（CSD-42）。
25. **付費 preflight 時機。** 粗估與分鏡迭代不算；shot plan 鎖定後、第一筆付費生成前才查資源包／餘額（CSD-41）。
26. **宣傳片先定義顧客行動。** 客群、痛點、可信證據與單一 CTA 先鎖，再讓劇本決定鏡頭與長度（CSD-61、63、67）。
27. **TTS／走戲是剪輯主時鐘。** 先量測語音與表演，再把每個 Seedance raw take 裁進時間軸；模型最小秒數不是成片鏡長（CSD-62、65、68）。
28. **讀片蒸餾要保存動作因果。** 每個關鍵行為記錄前態、接觸與後態，並分開 POV、對白、旁白和環境聲（CSD-64）。
29. **角色與物件 bible 先於多鏡生成。** 身份、材質、損傷、工作桌座標和已接受尾幀要成為後續鏡頭的固定狀態（CSD-66、68、69）。
30. **第三方完成不等於可追溯。** 即使服務能自動生成、評分或組接，缺 Codex session、provider task、輸入輸出 hash 與 final mapping 仍不能標為 executed（CSD-61～69）。

這 30 條目前只可用於設計測試與草案，不可直接升格為生產硬規則。案例仍是 candidate；每條都必須以私享家 fixture 驗證，並由獨立 QA 通過後才能採用。嚴格稽核目前確認 **30個 direct：4 executed、19 runnable、7 preproduction**；accepted／本機重現仍為0。

## 假設到案例的追溯矩陣

| 假設 | 支撐案例ID | 來源內定位 | 目前限制／私享家驗證fixture |
|---|---|---|---|
| 1 劇本先於prompt | CSD-01、04、05、12、22、23 | 各案README／workflow的script→storyboard→generation階段 | 多數非洗衣廣告；以本片G2→G4順序與change log驗證 |
| 2 語意／物理分離 | CSD-14 | CreativeEdge文中semantic/physical event與三版prompt段落 | 單一創作者經驗；同場做三版6秒fixture比較 |
| 3 單一owner | CSD-02、04、22 | state machine、多Agent角色與review stages | 來源沒有私享家權責；以RACI每列單一A與CR回歸測試驗證 |
| 4 reference分工 | CSD-03、06、08、16、18 | reference role／I2V inputs／multi-reference文件 | prompt通過不等於物件一致；以identity/environment/motion互換負測試驗證 |
| 5 首幀先於raw clip | CSD-01、05、06、13、17 | key visual／storyboard／first-frame approval流程 | 需避免token循環；先核`FIRST_FRAME_RENDER_TOKEN`再做首幀 |
| 6 一clip一主要事件 | CSD-07、09、16、27 | single action／segment／single beat方法 | 非官方模型限制；以6秒手勢與刷毛不接觸fixture驗證 |
| 7 accepted footage為連戲真相 | CSD-06、15、17、30 | accepted-footage continuation／last-frame chaining | skill與程式證據為主；以take末幀hash接續下一鏡驗證 |
| 8 三版候選比較 | CSD-14 | model-led／hybrid／fully-fixed generation log | 只有一案；先做單一低風險鏡頭的三版盲評 |
| 9 retake只改一變數 | CSD-06、08、14 | retake／eval／failure-log規則 | 未證實降低本案成本；以同一defect ID單變量回歸驗證 |
| 10 多take與廢片率入預算 | CSD-09、11、21、23、26 | take selection／成本復盤／廢片與取用比例 | 樣本平台不同；逐鏡記錄attempt、可用秒數與實際成本 |
| 11 文字Logo CTA確定性後製 | CSD-01、19、20、24 | FFmpeg／CapCut／HyperFrames caption與brand layer | 仍需正式品牌檔；以逐字字幕與safe-zone檢查驗證 |
| 12 聲音獨立製作線 | CSD-01、12、18、20、24、26 | TTS／audio／ASR／mix stages | native audio與繁中口型證據不足；以獨立WAV、ASR、口型抽查驗證 |
| 13 prompt PASS不等於影片PASS | CSD-01、02、06、12、21、28 | ffprobe／delivery QC／eval／公開失敗 | 機器QA仍抓不到所有物理錯誤；結合source-fps逐格與正常速度人審 |
| 14 真實品牌證據優先 | CSD-01、02、19、28 | brand asset／real reference／product-page inputs | 外部案例不能證明私享家；只接受門市核准原始素材 |
| 15 失敗寫回規則 | CSD-06、12、14、21、23 | trace／generation log／failure taxonomy／廢片紀錄 | 規則可能過擬合；每條需defect ID、反例與下一輪回歸fixture |
| 16 靜態幾何／動態敘事分離 | CSD-40 | structured storyboard、static visual condition、dynamic narrative condition | 學術流程非商業保證；以三場站位／工具距離板與逐格連戲驗證 |
| 17 分階段批准 | CSD-31、32、33、35 | storyboard/design、script approval、character approval、accepted assets | 各repo gate不同；以本案G1/G2/G6獨立token與負測試驗證 |
| 18 聲音量測決定片長 | CSD-34、39 | TTS duration、word timestamps、storyboard timing | 非Seedance官方限制；以鎖定文案正常語速量測與剪輯可讀性驗證 |
| 19 視覺EDL先於最終音軌 | CSD-41 | visual-first loop、summarize-edl、final_storyboard_for_audio | 需本片走戲驗證；不得在 EDL 前生成整片音軌 |
| 20 disposable 審片子代理 | CSD-41 | pack frames + segment/assembly subagent | Codex 環境需使用者明示授權 spawn subagent |
| 21 keyframe 先於 I2V | CSD-47、05 | `--skip-video`／key visual approval | 多 provider；Seedance 路徑需鎖定 provider 名 |
| 22 character sheet 跨 beat | CSD-47、06、17 | characters frontmatter + I2V reference | 需真實物件／演員授權，不可 AI 冒充職人 |
| 23 corpus 結構骨架 | CSD-43 | structure-guide + search.py | 社群 prompt 可能含 IP／名人風險，需過濾 |
| 24 storyboard≠video prompt | CSD-42、05 | two-stage skill outputs | 無 runtime；只驗 prompt 可讀性與 gate |
| 25 付費 preflight 時機 | CSD-41、31 | resource-package／cost gate after plan lock | 帳單查詢憑證與生成憑證分離 |
| 26 宣傳片先定義顧客行動 | CSD-61、63、67 | cinematic／marketing／feed-ad brief與approval stages | 用`qualified_inquiry_start`、單一CTA與品牌證據gate驗證，不能用觀看數代替詢問 |
| 27 TTS／走戲為主時鐘 | CSD-62、65、68 | 豆包TTS timestamps、timing、storyboard-to-edit stages | 用鎖定台詞正常語速三次量測；6秒raw clip可裁短但不可拉慢掩飾 |
| 28 動作因果蒸餾 | CSD-64 | character／scene／continuous timeline／action／sound distillation | 對每個工序記前態→接觸→後態；無法讀取的參考片標`unobserved` |
| 29 角色物件bible | CSD-66、68、69 | character bible、shot manifest、tail-frame、role／scene assets | 同一真實物件三定位點與末幀hash回歸；AI圖不得當真實門市證據 |
| 30 第三方完成不等於可追溯 | CSD-61～69 | provider adapters、submit/poll、auto score／compose | 要求session、task ID、input/output hash、selected take與final EDL一一對應 |

## 私享家候選採用矩陣

| 採用 | 用途 |
|---|---|
| CreativeEdge的語意／物理拆分 | 保護心理轉折與品牌因果，不讓模型亂補故事 |
| Emily Skill OS的accepted-footage continuity與single-variable retake | 多鏡人物、物件、桌面與動作連戲 |
| paper-collage-ad的manifest、audio與ffprobe QA | 每鏡提交、下載、後製與技術驗證 |
| VideoWeaver的trace＋中間素材＋final eval | 可重現研究與Agent技能驗證 |
| video-production-buddy的狀態機與checkpoint | 阻止未過稿、未過首幀就批量生成 |
| FELIGUARD／Toonflow的成本與廢片紀錄 | 建立真實生成預算與可用率 |
| HyperFrames的確定性文字/UI後製 | 保證繁中字幕、Logo、CTA與品牌版面正確 |
| Edit Illusions的storyboard概念測試 | 只做pitch／預演，不拿一鍵長片當交付母片 |

## 私享家拒絕矩陣

- 拒絕「先生成全部，再補劇本」。
- 拒絕一個Agent同時寫、導、生成、自審與發布。
- 拒絕把模型規定秒數當故事長度。
- 拒絕沒有直接來源的清潔工法、藥劑、保證與before/after。
- 拒絕以HTTP成功、prompt分數、contact sheet或剪掉瑕疵證明raw clip通過。
- 拒絕消費者網頁自動化、逆向私有端點與未核准付費路由。
- 拒絕用名人、名牌或他人作品reference而沒有權利與揭露。

## 目前仍未放行

- 30個direct案例尚是研究候選；稽核只校正證據強弱，尚未升入accepted evidence registry。
- 私享家正式Logo、同一物件原始照、工作桌、職人手／袖與門市逐字確認仍是品牌真實素材gate。
- 未核發`VIDEO_GENERATION_TOKEN`，本階段不得生成或發布影片。
